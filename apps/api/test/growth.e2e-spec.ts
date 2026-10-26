import { INestApplication } from '@nestjs/common';
import { DEFAULT_GROWTH_CONFIG, DEFAULT_PRICING_CONFIG } from '@errandconnect/shared';
import { SubscriptionsService } from '../src/growth/subscriptions.service.js';
import { LedgerService } from '../src/payments/ledger.service.js';
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

/** Quotes take the errand details without a payment method. */
const details = (overrides: Record<string, unknown> = {}) => {
  const { paymentMethod: _paymentMethod, description: _description, ...rest } = errand('CASH', overrides);
  return rest;
};

function stkCallback(checkoutRequestId: string, amount: number) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'test',
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'OK',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: `GRW${checkoutRequestId.slice(-7)}` },
          ],
        },
      },
    },
  };
}

describe('Growth and revenue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketing: TestUser;
  let finance: TestUser;
  let runner: TestUser;
  const uniqueCode = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const walletBalance = async (userId: string) =>
    (await prisma.wallet.findUnique({ where: { type_userId: { type: 'CUSTOMER', userId } } }))?.balance ?? 0;
  /** Simulates the customer topping up their wallet with M-Pesa. */
  async function topUp(userId: string, amount: number) {
    const ledger = app.get(LedgerService);
    await prisma.$transaction(async (tx) => {
      const [clearing, wallet] = await Promise.all([
        ledger.systemWallet(tx, 'EXTERNAL_CLEARING'),
        ledger.userWallet(tx, userId, 'CUSTOMER'),
      ]);
      await ledger.post(tx, {
        type: 'PAYMENT_IN',
        description: 'Test top-up',
        entries: [
          { walletId: clearing.id, amount: -amount },
          { walletId: wallet.id, amount },
        ],
      });
    });
  }
  async function complete(order: { id: string; deliveryPin: string }) {
    await http(app).post(`/orders/${order.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(200);
  }
  const payStk = async (where: { subscriptionId?: string; invoiceId?: string }, amount: number) => {
    const payment = await prisma.payment.findFirstOrThrow({ where, orderBy: { createdAt: 'desc' } });
    await http(app).post(`/payments/mpesa/stk-callback/${SECRET}`).send(stkCallback(payment.providerRequestId!, amount)).expect(200);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    marketing = await createStaff(app, 'MARKETING_MANAGER');
    finance = await createStaff(app, 'FINANCE_MANAGER');
    runner = await createApprovedRunner(app);
    await http(app).put('/admin/settings/growth').set(auth(finance)).send(DEFAULT_GROWTH_CONFIG).expect(200);
  });

  afterEach(async () => {
    // A runner can only hold one job; free them for the next test.
    await prisma.order.updateMany({
      where: { runnerId: runner.id, status: { in: ['ACCEPTED', 'RUNNER_ASSIGNED'] } },
      data: { status: 'CANCELLED' },
    });
    const total = await prisma.wallet.aggregate({ _sum: { balance: true } });
    expect(total._sum.balance).toBe(0);
  });

  afterAll(async () => {
    await http(app).put('/admin/settings/pricing').set(auth(finance)).send(DEFAULT_PRICING_CONFIG).expect(200);
    await app.close();
  });

  it('applies promo codes paid for by the platform, not the runner', async () => {
    const code = uniqueCode('SAVE');
    await http(app).post('/admin/promos').set(auth(finance)).send({ code, description: '20% off', type: 'PERCENT', value: 20 }).expect(403);
    await http(app)
      .post('/admin/promos')
      .set(auth(marketing))
      .send({ code: code.toLowerCase(), description: '20% off, up to KES 100', type: 'PERCENT', value: 20, maxDiscount: 100 })
      .expect(201);

    const customer = await registerUser(app, 'CUSTOMER');
    const bad = await http(app)
      .post('/orders/quote')
      .set(auth(customer))
      .send(details({ promoCode: 'NOSUCHCODE' }))
      .expect(200);
    expect(bad.body.promo).toEqual({ code: 'NOSUCHCODE', discount: 0, error: 'This promo code is not valid' });

    const plain = await http(app).post('/orders/quote').set(auth(customer)).send(details()).expect(200);
    const quoted = await http(app)
      .post('/orders/quote')
      .set(auth(customer))
      .send(details({ promoCode: code }))
      .expect(200);
    const fees = plain.body.quote.customer.total - plain.body.quote.customer.itemsCost;
    const expected = Math.min(100, Math.round(fees * 0.2));
    expect(quoted.body.promo).toEqual({ code, discount: expected });
    expect(quoted.body.quote.customer.total).toBe(plain.body.quote.customer.total - expected);
    expect(quoted.body.quote.runner.total).toBe(plain.body.quote.runner.total);

    await topUp(customer.id, 2_000);
    const order = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('WALLET', { promoCode: code }))
      .expect(201);
    expect(order.body).toMatchObject({ discount: expected, total: plain.body.quote.customer.total - expected });
    expect(await walletBalance(customer.id)).toBe(2_000 - order.body.total);

    // One use per customer, until that order is cancelled.
    const again = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('CASH', { promoCode: code }))
      .expect(400);
    expect(again.body.message).toBe('You have already used this promo code');
    await http(app).post(`/orders/${order.body.id}/cancel`).set(auth(customer)).send({ reason: 'Changed my mind' }).expect(200);
    expect(await walletBalance(customer.id)).toBe(2_000);
    const reused = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('CASH', { promoCode: code }))
      .expect(201);

    // The runner still earns in full; the platform's share pays for the discount.
    await complete(reused.body);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: reused.body.id } });
    expect(done.runnerEarnings).toBe(plain.body.quote.runner.total);
    expect(done.platformFee).toBe(plain.body.quote.platform.total - expected);

    // First-order codes don't work after a completed errand.
    const welcome = uniqueCode('NEW');
    await http(app)
      .post('/admin/promos')
      .set(auth(marketing))
      .send({ code: welcome, description: 'KES 50 off your first errand', type: 'FIXED', value: 50, firstOrderOnly: true })
      .expect(201);
    const refused = await http(app)
      .post('/orders/quote')
      .set(auth(customer))
      .send(details({ promoCode: welcome }))
      .expect(200);
    expect(refused.body.promo.error).toBe('This code is only for your first errand');

    const list = await http(app).get(`/admin/promos?search=${code}`).set(auth(finance)).expect(200);
    expect(list.body.items[0]).toMatchObject({ code, redemptions: 1, discountGiven: expected });
  });

  it('adds a surge fee when operations switch it on, mostly for the runner', async () => {
    await http(app)
      .put('/admin/settings/pricing')
      .set(auth(finance))
      .send({
        ...DEFAULT_PRICING_CONFIG,
        surge: { ...DEFAULT_PRICING_CONFIG.surge, enabled: true, maxMultiplier: 1.5, manualMultiplier: 1.5 },
      })
      .expect(200);
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app).post('/orders').set(auth(customer)).send(errand('CASH')).expect(201);
    expect(order.body.surgeFee).toBe(Math.round(order.body.deliveryFee * 0.5));
    const quote = order.body.quote;
    expect(quote.runner.surgeEarnings).toBe(Math.round(order.body.surgeFee * 0.8));

    const jobs = await http(app).get('/runners/me/jobs').set(auth(runner)).expect(200);
    expect(jobs.body.find((j: { id: string }) => j.id === order.body.id).surgeBonus).toBe(quote.runner.surgeEarnings);
    await http(app).post(`/orders/${order.body.id}/cancel`).set(auth(customer)).send({ reason: 'Too expensive now' }).expect(200);
    await http(app).put('/admin/settings/pricing').set(auth(finance)).send(DEFAULT_PRICING_CONFIG).expect(200);
  });

  it('sells ErrandCONNECT Plus, which waives the service fee and renews from the wallet', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const before = await http(app).post('/orders/quote').set(auth(customer)).send(details());
    console.log('DBG', JSON.stringify(before.body).slice(0, 300));
    expect(before.body.plus).toBe(false);
    expect(before.body.quote.customer.serviceFee).toBeGreaterThan(0);

    // Not enough in the wallet.
    const poor = await http(app).post('/me/plus').set(auth(customer)).send({ method: 'WALLET' }).expect(400);
    expect(poor.body.message).toMatch(/You need KES 499/);

    // Join with M-Pesa.
    const joining = await http(app).post('/me/plus').set(auth(customer)).send({ method: 'MPESA' }).expect(200);
    expect(joining.body).toMatchObject({ active: false, status: 'PENDING', price: 499 });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: customer.id } });
    await payStk({ subscriptionId: sub.id }, 499);
    const plus = await http(app).get('/me/plus').set(auth(customer)).expect(200);
    expect(plus.body).toMatchObject({ active: true, autoRenew: true });

    const after = await http(app).post('/orders/quote').set(auth(customer)).send(details()).expect(200);
    expect(after.body.plus).toBe(true);
    expect(after.body.quote.customer.serviceFee).toBe(0);
    await http(app).post('/me/plus').set(auth(customer)).send({ method: 'WALLET' }).expect(409);

    // Renewal from the wallet at the end of the month.
    await topUp(customer.id, 600);
    const subscriptions = app.get(SubscriptionsService);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await subscriptions.renewDue(later)).toMatchObject({ renewed: 1 });
    expect(await walletBalance(customer.id)).toBe(101);
    const renewed = await prisma.subscription.findUniqueOrThrow({ where: { userId: customer.id } });
    expect(renewed.currentPeriodEnd!.getTime()).toBeGreaterThan(later.getTime());

    // Cancelled: membership ends at the end of the period instead of renewing.
    await http(app).patch('/me/plus').set(auth(customer)).send({ autoRenew: false }).expect(200);
    await subscriptions.renewDue(new Date(renewed.currentPeriodEnd!.getTime() + 1000));
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: customer.id } })).status).toBe('EXPIRED');
    expect(await walletBalance(customer.id)).toBe(101);
  });

  it('pays referral rewards once, after the new user completes their first errand', async () => {
    const inviter = await registerUser(app, 'CUSTOMER');
    const code = (await http(app).get('/me/rewards').set(auth(inviter)).expect(200)).body.referral.code;
    const friend = await registerUser(app, 'CUSTOMER', { referralCode: code });

    const first = await http(app).post('/orders').set(auth(friend)).send(errand('CASH')).expect(201);
    await complete(first.body);
    expect(await walletBalance(inviter.id)).toBe(200);
    expect(await walletBalance(friend.id)).toBe(100);
    const second = await http(app).post('/orders').set(auth(friend)).send(errand('CASH')).expect(201);
    await complete(second.body);
    expect(await walletBalance(inviter.id)).toBe(200);

    const summary = await http(app).get('/me/rewards').set(auth(inviter)).expect(200);
    expect(summary.body.referral).toMatchObject({ invited: 1, rewarded: 1, earned: 200 });
    const notes = await http(app).get('/me/notifications').set(auth(inviter)).expect(200);
    expect(notes.body[0].title).toBe('You earned KES 200');
  });

  it('earns loyalty points on completed errands and redeems them for wallet credit', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand('CASH', { itemsCost: 1_500 }))
      .expect(201);
    await complete(order.body);
    const earned = Math.floor(order.body.total / 100);
    let rewards = await http(app).get('/me/rewards').set(auth(customer)).expect(200);
    expect(rewards.body.loyalty).toMatchObject({ points: earned, lifetimePoints: earned, tier: 'Bronze' });
    expect(rewards.body.loyalty.history[0]).toMatchObject({ points: earned, orderId: order.body.id });

    await http(app).post('/me/rewards/redeem').set(auth(customer)).send({ points: 100 }).expect(400);
    await prisma.customerProfile.update({ where: { userId: customer.id }, data: { loyaltyPoints: { increment: 230 } } });
    const redeemed = await http(app).post('/me/rewards/redeem').set(auth(customer)).send({ points: 250 }).expect(200);
    expect(redeemed.body).toMatchObject({ redeemed: 200, amount: 100 });
    expect(await walletBalance(customer.id)).toBe(100);
    rewards = await http(app).get('/me/rewards').set(auth(customer)).expect(200);
    expect(rewards.body.loyalty.points).toBe(earned + 30);
    expect(rewards.body.loyalty.lifetimePoints).toBe(earned);
  });

  it('shows banners to the right audience and records ad payments', async () => {
    await http(app)
      .post('/admin/banners')
      .set(auth(marketing))
      .send({ title: 'Bad', merchantId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    const banner = await http(app)
      .post('/admin/banners')
      .set(auth(marketing))
      .send({
        title: `Groceries in 30 min ${Date.now()}`,
        categorySlug: 'grocery-shopping',
        audience: 'CUSTOMERS',
        priority: 100,
        advertiser: 'Fresh Farms Ltd',
      })
      .expect(201);

    const customer = await registerUser(app, 'CUSTOMER');
    const seen = await http(app).get('/banners').set(auth(customer)).expect(200);
    expect(seen.body.map((b: { id: string }) => b.id)).toContain(banner.body.id);
    const runnerOnly = await registerUser(app, 'RUNNER');
    const notSeen = await http(app).get('/banners').set(auth(runnerOnly)).expect(200);
    expect(notSeen.body.map((b: { id: string }) => b.id)).not.toContain(banner.body.id);

    await http(app).post(`/banners/${banner.body.id}/events`).set(auth(customer)).send({ event: 'impression' }).expect(200);
    await http(app).post(`/banners/${banner.body.id}/events`).set(auth(customer)).send({ event: 'click' }).expect(200);

    const window = `from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 3_600_000).toISOString()}`;
    const advertising = async () =>
      (await http(app).get(`/admin/reports/revenue?${window}`).set(auth(finance)).expect(200)).body.streams.find(
        (s: { key: string }) => s.key === 'advertising',
      ).amount as number;
    const adsBefore = await advertising();
    await http(app)
      .post(`/admin/banners/${banner.body.id}/payments`)
      .set(auth(finance))
      .send({ amount: 5_000, reference: 'BANK-AD-1' })
      .expect(201);
    const list = await http(app).get('/admin/banners').set(auth(marketing)).expect(200);
    expect(list.body.find((b: { id: string }) => b.id === banner.body.id)).toMatchObject({ impressions: 1, clicks: 1, amountPaid: 5_000 });
    await http(app).patch(`/admin/banners/${banner.body.id}`).set(auth(marketing)).send({ isActive: false }).expect(200);

    expect(await advertising()).toBe(adsBefore + 5_000);
  });

  it('lets shops buy featured placement through an invoice', async () => {
    const owner = await registerUser(app, 'CUSTOMER');
    const shop = await http(app)
      .post('/merchants')
      .set(auth(owner))
      .send({ name: `Corner Shop ${Date.now()}`, categorySlug: 'grocery-shopping', addressLine: 'Tom Mboya St', ...NAIROBI_CBD })
      .expect(201);
    await http(app).post(`/merchants/${shop.body.id}/featured`).set(auth(owner)).send({ weeks: 2 }).expect(403);
    const manager = await createStaff(app, 'MERCHANT_MANAGER');
    await http(app).post(`/admin/merchants/${shop.body.id}/approve`).set(auth(manager)).expect(200);

    const bought = await http(app)
      .post(`/merchants/${shop.body.id}/featured`)
      .set(auth(owner))
      .send({ weeks: 2, phone: owner.phone })
      .expect(201);
    expect(bought.body.invoice).toMatchObject({ kind: 'FEATURED_LISTING', amount: 2_000, featuredWeeks: 2 });
    expect(bought.body.payment.requested).toBe(true);
    // Not featured until paid.
    expect((await http(app).get(`/merchants/${shop.body.id}`).set(auth(owner)).expect(200)).body.isFeatured).toBe(false);

    await payStk({ invoiceId: bought.body.invoice.id }, 2_000);
    const profile = await http(app).get(`/merchants/${shop.body.id}`).set(auth(owner)).expect(200);
    expect(profile.body.isFeatured).toBe(true);
    const until = (await prisma.merchant.findUniqueOrThrow({ where: { id: shop.body.id } })).featuredUntil!;
    expect(Math.round((until.getTime() - Date.now()) / 86_400_000)).toBe(14);
    expect((await prisma.wallet.findUnique({ where: { type_merchantId: { type: 'MERCHANT', merchantId: shop.body.id } } }))!.balance).toBe(
      0,
    );

    // A voided featured invoice gives the charge back.
    const unpaid = await http(app).post(`/merchants/${shop.body.id}/featured`).set(auth(owner)).send({ weeks: 1 }).expect(201);
    await http(app)
      .post(`/admin/invoices/${unpaid.body.invoice.id}/void`)
      .set(auth(finance))
      .send({ reason: 'Ordered by mistake' })
      .expect(200);
    expect((await prisma.wallet.findUnique({ where: { type_merchantId: { type: 'MERCHANT', merchantId: shop.body.id } } }))!.balance).toBe(
      0,
    );
  });

  it('validates growth settings and limits who can change them', async () => {
    const support = await createStaff(app, 'CUSTOMER_SUPPORT');
    await http(app).get('/admin/settings/growth').set(auth(support)).expect(403);
    const bad = await http(app)
      .put('/admin/settings/growth')
      .set(auth(marketing))
      .send({ ...DEFAULT_GROWTH_CONFIG, plus: { enabled: true, monthlyPrice: 0 } })
      .expect(400);
    expect(bad.body.message).toEqual(['plus.monthlyPrice must be 10 - 50,000 shillings']);
    await http(app)
      .put('/admin/settings/growth')
      .set(auth(marketing))
      .send({ ...DEFAULT_GROWTH_CONFIG, plus: { enabled: false, monthlyPrice: 499 } })
      .expect(200);
    const customer = await registerUser(app, 'CUSTOMER');
    const closed = await http(app).post('/me/plus').set(auth(customer)).send({ method: 'MPESA' }).expect(400);
    expect(closed.body.message).toBe('ErrandCONNECT Plus is not available right now');
    await http(app).put('/admin/settings/growth').set(auth(marketing)).send(DEFAULT_GROWTH_CONFIG).expect(200);
  });
});
