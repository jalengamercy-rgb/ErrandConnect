import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  auth,
  createApprovedRunner,
  createStaff,
  createTestApp,
  http,
  NAIROBI_CBD,
  registerUser,
  WESTLANDS,
  type TestUser,
} from './helpers.js';

const SECRET = 'test-callback-secret';

const errand = (paymentMethod: 'MPESA' | 'WALLET' | 'CASH', overrides: Record<string, unknown> = {}) => ({
  categorySlug: 'parcel-delivery',
  description: 'Deliver an envelope to the Westlands office',
  pickup: { address: 'Kenyatta Avenue', ...NAIROBI_CBD },
  dropoff: { address: 'Westlands Square', ...WESTLANDS },
  deliveryType: 'MOTORCYCLE',
  paymentMethod,
  ...overrides,
});

/** The body Safaricom posts after the customer answers the payment prompt. */
function stkCallback(checkoutRequestId: string, amount: number, resultCode = 0) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'test',
        CheckoutRequestID: checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
        ...(resultCode === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: amount },
                  { Name: 'MpesaReceiptNumber', Value: `TST${checkoutRequestId.slice(-6)}` },
                ],
              },
            }
          : {}),
      },
    },
  };
}

function b2cResult(conversationId: string, resultCode = 0) {
  return {
    Result: {
      ResultType: 0,
      ResultCode: resultCode,
      ResultDesc: resultCode ? 'Insufficient funds' : 'OK',
      ConversationID: conversationId,
      OriginatorConversationID: 'x',
      TransactionID: 'TSTB2C123',
    },
  };
}

describe('Payments, escrow and wallets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const balance = async (userId: string, type: 'CUSTOMER' | 'RUNNER') =>
    (await prisma.wallet.findUnique({ where: { type_userId: { type, userId } } }))?.balance ?? 0;
  const systemBalance = async (type: 'ESCROW' | 'PLATFORM_REVENUE' | 'PAYOUT_PENDING') =>
    (await prisma.wallet.findFirstOrThrow({ where: { type, userId: null } })).balance;
  const checkoutId = async (orderId: string) =>
    (await prisma.payment.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } })).providerRequestId!;
  const pay = (checkout: string, amount: number, resultCode = 0) =>
    http(app)
      .post(`/payments/mpesa/stk-callback/${SECRET}`)
      .send(stkCallback(checkout, amount, resultCode))
      .expect(200);

  /** Customer posts an M-Pesa errand and pays it. */
  async function paidErrand(customer: TestUser) {
    const order = await http(app).post('/orders').set(auth(customer)).send(errand('MPESA')).expect(201);
    await pay(await checkoutId(order.body.id), order.body.total);
    return order.body;
  }

  /** Runner with an approved M-Pesa payout account. */
  async function payoutReadyRunner() {
    const runner = await createApprovedRunner(app);
    await prisma.payoutMethod.create({
      data: { userId: runner.id, type: 'MPESA', accountName: 'Test Runner', phone: runner.phone, isDefault: true, status: 'APPROVED' },
    });
    return runner;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // The books must always balance: all wallet balances add up to zero.
    const total = await prisma.wallet.aggregate({ _sum: { balance: true } });
    expect(total._sum.balance).toBe(0);
  });

  it('holds an M-Pesa payment in escrow and releases it on delivery', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const escrowBefore = await systemBalance('ESCROW');
    const revenueBefore = await systemBalance('PLATFORM_REVENUE');

    const created = await http(app).post('/orders').set(auth(customer)).send(errand('MPESA')).expect(201);
    expect(created.body.status).toBe('AWAITING_PAYMENT');
    expect(created.body.paymentRequest).toMatchObject({ requested: true });
    expect(created.body.payment).toMatchObject({ status: 'PENDING', phone: customer.phone });

    // Not visible to runners before payment.
    let jobs = await http(app).get('/runners/me/jobs').set(auth(runner)).expect(200);
    expect(jobs.body.some((j: { id: string }) => j.id === created.body.id)).toBe(false);
    await http(app).post(`/orders/${created.body.id}/accept`).set(auth(runner)).expect(409);

    // Callbacks need the secret.
    const checkout = await checkoutId(created.body.id);
    await http(app).post('/payments/mpesa/stk-callback/wrong').send(stkCallback(checkout, created.body.total)).expect(404);

    await pay(checkout, created.body.total);
    await pay(checkout, created.body.total); // Safaricom may repeat callbacks
    const paid = await http(app).get(`/orders/${created.body.id}`).set(auth(customer)).expect(200);
    expect(paid.body).toMatchObject({
      status: 'PENDING',
      escrowStatus: 'HELD',
      payment: { status: 'SUCCEEDED', providerReceipt: `TST${checkout.slice(-6)}` },
    });
    expect(await systemBalance('ESCROW')).toBe(escrowBefore + created.body.total);

    jobs = await http(app).get('/runners/me/jobs').set(auth(runner)).expect(200);
    expect(jobs.body.some((j: { id: string }) => j.id === created.body.id)).toBe(true);
    await http(app).post(`/orders/${created.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${created.body.id}/deliver`).set(auth(runner)).send({ pin: created.body.deliveryPin }).expect(200);

    expect(await balance(runner.id, 'RUNNER')).toBe(created.body.runnerEarnings);
    expect(await systemBalance('ESCROW')).toBe(escrowBefore);
    expect(await systemBalance('PLATFORM_REVENUE')).toBe(revenueBefore + created.body.platformFee);
    const done = await http(app).get(`/orders/${created.body.id}`).set(auth(customer)).expect(200);
    expect(done.body.escrowStatus).toBe('RELEASED');

    const history = await http(app).get('/wallets/runner/transactions').set(auth(runner)).expect(200);
    expect(history.body[0]).toMatchObject({ amount: created.body.runnerEarnings, type: 'ESCROW_RELEASE', order: { id: created.body.id } });
  });

  it('keeps the order unpaid when the customer cancels the prompt, and lets them retry', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app).post('/orders').set(auth(customer)).send(errand('MPESA')).expect(201);
    await pay(await checkoutId(order.body.id), order.body.total, 1032);

    const after = await http(app).get(`/orders/${order.body.id}`).set(auth(customer)).expect(200);
    expect(after.body).toMatchObject({
      status: 'AWAITING_PAYMENT',
      payment: { status: 'CANCELLED', failureReason: 'Request cancelled by user' },
    });

    await http(app).post(`/orders/${order.body.id}/pay`).set(auth(customer)).send({}).expect(200);
    // A second prompt straight away is refused.
    await http(app).post(`/orders/${order.body.id}/pay`).set(auth(customer)).send({}).expect(429);
    await pay(await checkoutId(order.body.id), order.body.total);
    const paid = await http(app).get(`/orders/${order.body.id}`).set(auth(customer)).expect(200);
    expect(paid.body.status).toBe('PENDING');
  });

  it('refunds to the wallet on cancellation, and the wallet can pay the next errand', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await paidErrand(customer);
    const cancelled = await http(app).post(`/orders/${order.id}/cancel`).set(auth(customer)).send({ reason: 'Plans changed' }).expect(200);
    expect(cancelled.body.escrowStatus).toBe('REFUNDED');
    expect(await balance(customer.id, 'CUSTOMER')).toBe(order.total);

    const second = await http(app).post('/orders').set(auth(customer)).send(errand('WALLET')).expect(201);
    expect(second.body).toMatchObject({ status: 'PENDING', escrowStatus: 'HELD' });
    expect(await balance(customer.id, 'CUSTOMER')).toBe(order.total - second.body.total);

    // Not enough left for a bigger errand: nothing is created.
    const before = await prisma.order.count({ where: { customerId: customer.id } });
    await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('WALLET', { itemsCost: 3000 }))
      .expect(400);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(before);
  });

  it('credits the wallet if payment arrives after the customer cancelled', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app).post('/orders').set(auth(customer)).send(errand('MPESA')).expect(201);
    await http(app).post(`/orders/${order.body.id}/cancel`).set(auth(customer)).send({ reason: 'Too slow' }).expect(200);
    await pay(await checkoutId(order.body.id), order.body.total);
    expect(await balance(customer.id, 'CUSTOMER')).toBe(order.body.total);
  });

  it('charges the platform fee to runners on cash errands and blocks cash jobs when they owe too much', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const cash = await http(app).post('/orders').set(auth(customer)).send(errand('CASH')).expect(201);
    await http(app).post(`/orders/${cash.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${cash.body.id}/deliver`).set(auth(runner)).send({ pin: cash.body.deliveryPin }).expect(200);
    expect(await balance(runner.id, 'RUNNER')).toBe(-cash.body.platformFee);

    // Pretend they've built up more cash fees than allowed (moved from revenue so the books still balance).
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { type_userId: { type: 'RUNNER', userId: runner.id } } });
    const revenue = await prisma.wallet.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE', userId: null } });
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: 2000 } } });
    await prisma.wallet.update({ where: { id: revenue.id }, data: { balance: { increment: 2000 } } });

    const nextCash = await http(app).post('/orders').set(auth(customer)).send(errand('CASH')).expect(201);
    const refused = await http(app).post(`/orders/${nextCash.body.id}/accept`).set(auth(runner)).expect(403);
    expect(refused.body.message).toContain('in fees from cash errands');
    const mpesa = await paidErrand(customer);
    await http(app).post(`/orders/${mpesa.id}/accept`).set(auth(runner)).expect(200);

    // Undo the test adjustment.
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: 2000 } } });
    await prisma.wallet.update({ where: { id: revenue.id }, data: { balance: { decrement: 2000 } } });
  });

  it('pays runners out to M-Pesa with their PIN', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await payoutReadyRunner();
    const order = await paidErrand(customer);
    await http(app).post(`/orders/${order.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(200);
    const earned = order.runnerEarnings;

    await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 200, pin: '0000' }).expect(401);
    await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 50, pin: '4821' }).expect(400);
    await http(app)
      .post('/wallets/runner/withdrawals')
      .set(auth(runner))
      .send({ amount: earned + 1, pin: '4821' })
      .expect(400);

    const withdrawal = await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 200, pin: '4821' }).expect(201);
    expect(withdrawal.body).toMatchObject({ status: 'APPROVED', amount: 200, destination: { phone: runner.phone } });
    expect(await balance(runner.id, 'RUNNER')).toBe(earned - 200);

    const wallets = await http(app).get('/wallets').set(auth(runner)).expect(200);
    expect(wallets.body.find((w: { type: string }) => w.type === 'RUNNER')).toMatchObject({
      balance: earned - 200,
      pendingWithdrawals: 200,
    });

    const conversationId = (await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.body.id } })).providerReference!;
    await http(app).post(`/payments/mpesa/b2c-result/${SECRET}`).send(b2cResult(conversationId)).expect(200);
    const list = await http(app).get('/wallets/withdrawals').set(auth(runner)).expect(200);
    expect(list.body[0]).toMatchObject({ id: withdrawal.body.id, status: 'PAID', providerReceipt: 'TSTB2C123' });

    // A failed payout returns the money.
    const second = await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 100, pin: '4821' }).expect(201);
    const secondRef = (await prisma.withdrawal.findUniqueOrThrow({ where: { id: second.body.id } })).providerReference!;
    await http(app).post(`/payments/mpesa/b2c-result/${SECRET}`).send(b2cResult(secondRef, 2001)).expect(200);
    expect(await balance(runner.id, 'RUNNER')).toBe(earned - 200);
  });

  it('needs finance approval for large withdrawals', async () => {
    const finance = await createStaff(app, 'FINANCE_MANAGER');
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await payoutReadyRunner();
    // Give the runner a big balance from a large paid errand (ID-verified customer, so no order limit).
    await prisma.customerProfile.update({ where: { userId: customer.id }, data: { verificationLevel: 3 } });
    const big = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('MPESA', { itemsCost: 12000 }))
      .expect(201);
    await pay(await checkoutId(big.body.id), big.body.total);
    await http(app).post(`/orders/${big.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${big.body.id}/deliver`).set(auth(runner)).send({ pin: big.body.deliveryPin }).expect(200);

    const large = await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 6000, pin: '4821' }).expect(201);
    expect(large.body.status).toBe('REQUESTED');
    const queue = await http(app).get('/admin/withdrawals?status=REQUESTED&pageSize=100').set(auth(finance)).expect(200);
    expect(queue.body.items.some((w: { id: string }) => w.id === large.body.id)).toBe(true);
    await http(app).get('/admin/withdrawals').set(auth(runner)).expect(403);

    const approved = await http(app).post(`/admin/withdrawals/${large.body.id}/approve`).set(auth(finance)).expect(200);
    expect(approved.body.status).toBe('APPROVED');

    const another = await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 5500, pin: '4821' }).expect(201);
    const before = await balance(runner.id, 'RUNNER');
    await http(app)
      .post(`/admin/withdrawals/${another.body.id}/reject`)
      .set(auth(finance))
      .send({ reason: 'Name mismatch on M-Pesa' })
      .expect(200);
    expect(await balance(runner.id, 'RUNNER')).toBe(before + 5500);

    const summary = await http(app).get('/admin/finance/summary').set(auth(finance)).expect(200);
    expect(summary.body).toEqual(
      expect.objectContaining({
        platformRevenue: expect.any(Number),
        escrowHeld: expect.any(Number),
        payoutsPending: expect.any(Number),
        mpesaFloat: expect.any(Number),
      }),
    );
  });

  it('only lets runners withdraw to an approved payout account', async () => {
    const runner = await createApprovedRunner(app);
    await prisma.wallet.upsert({
      where: { type_userId: { type: 'RUNNER', userId: runner.id } },
      update: {},
      create: { type: 'RUNNER', userId: runner.id },
    });
    await http(app).post('/wallets/runner/withdrawals').set(auth(runner)).send({ amount: 100, pin: '4821' }).expect(403);
  });
});
