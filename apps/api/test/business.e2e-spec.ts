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

const companyErrand = (businessId: string, overrides: Record<string, unknown> = {}) => ({
  categorySlug: 'document-delivery',
  description: 'Deliver signed contracts to the Westlands office',
  pickup: { address: 'Kenyatta Avenue', ...NAIROBI_CBD },
  dropoff: { address: 'Westlands Square', ...WESTLANDS },
  deliveryType: 'MOTORCYCLE',
  paymentMethod: 'BUSINESS_INVOICE',
  businessId,
  ...overrides,
});

describe('Business accounts, shops and invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let finance: TestUser;
  let merchantManager: TestUser;

  const businessBalance = async (businessId: string) =>
    (await prisma.wallet.findUnique({ where: { type_businessId: { type: 'BUSINESS', businessId } } }))?.balance ?? 0;
  const merchantBalance = async (merchantId: string) =>
    (await prisma.wallet.findUnique({ where: { type_merchantId: { type: 'MERCHANT', merchantId } } }))?.balance ?? 0;

  /** Registers a company and has finance approve it with credit and invoicing. */
  async function activeCompany(creditLimit = 20_000) {
    const owner = await registerUser(app, 'CUSTOMER');
    const res = await http(app)
      .post('/businesses')
      .set(auth(owner))
      .send({ name: 'Acme Logistics Ltd', kraPin: 'P051234567X', companySize: 'SIZE_11_50', servicesNeeded: ['DOCUMENT_DELIVERY'] })
      .expect(201);
    await http(app)
      .post(`/admin/businesses/${res.body.id}/approve`)
      .set(auth(finance))
      .send({ creditLimit, monthlyInvoicing: true })
      .expect(200);
    return { owner, businessId: res.body.id as string };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    finance = await createStaff(app, 'FINANCE_MANAGER');
    merchantManager = await createStaff(app, 'MERCHANT_MANAGER');
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    const total = await prisma.wallet.aggregate({ _sum: { balance: true } });
    expect(total._sum.balance).toBe(0);
  });

  it('registers a company that can only order once approved', async () => {
    const owner = await registerUser(app, 'CUSTOMER');
    const created = await http(app).post('/businesses').set(auth(owner)).send({ name: 'Pending Co' }).expect(201);
    expect(created.body.status).toBe('PENDING');

    const mine = await http(app).get('/businesses/mine').set(auth(owner)).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: created.body.id, role: 'OWNER', status: 'PENDING' })]);

    const refused = await http(app).post('/orders').set(auth(owner)).send(companyErrand(created.body.id)).expect(403);
    expect(refused.body.message).toMatch(/not active/);

    // Customers cannot use the admin endpoints; support staff without the role cannot either.
    await http(app)
      .post(`/admin/businesses/${created.body.id}/approve`)
      .set(auth(owner))
      .send({ creditLimit: 1, monthlyInvoicing: true })
      .expect(403);
    const support = await createStaff(app, 'CUSTOMER_SUPPORT');
    await http(app).get('/admin/businesses').set(auth(support)).expect(403);

    // Non-finance staff can approve, but not grant credit.
    const other = await http(app).post('/businesses').set(auth(owner)).send({ name: 'Other Co' }).expect(201);
    const approved = await http(app)
      .post(`/admin/businesses/${other.body.id}/approve`)
      .set(auth(merchantManager))
      .send({ creditLimit: 50_000, monthlyInvoicing: true })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'ACTIVE', creditLimit: 0, monthlyInvoicing: false });
    await http(app).patch(`/admin/businesses/${other.body.id}`).set(auth(merchantManager)).send({ creditLimit: 50_000 }).expect(403);

    await http(app)
      .post(`/admin/businesses/${created.body.id}/reject`)
      .set(auth(merchantManager))
      .send({ reason: 'Could not verify the company' })
      .expect(200);
    const notes = await http(app).get('/me/notifications').set(auth(owner)).expect(200);
    expect(notes.body[0].title).toBe('Company account not approved');
  });

  it('bills company errands to credit, with approvals above a member limit', async () => {
    const { owner, businessId } = await activeCompany(2_000);
    const member = await registerUser(app, 'CUSTOMER');
    await http(app)
      .post(`/businesses/${businessId}/members`)
      .set(auth(owner))
      .send({ phone: member.phone, role: 'MEMBER', approvalLimit: 100 })
      .expect(201);
    // Members cannot add people.
    await http(app).post(`/businesses/${businessId}/members`).set(auth(member)).send({ phone: owner.phone, role: 'MEMBER' }).expect(403);

    // Above the member's limit: waits for approval with nothing held.
    const pending = await http(app).post('/orders').set(auth(member)).send(companyErrand(businessId)).expect(201);
    expect(pending.body.status).toBe('PENDING_APPROVAL');
    expect(await businessBalance(businessId)).toBe(0);
    const runner = await createApprovedRunner(app);
    await http(app).post(`/orders/${pending.body.id}/accept`).set(auth(runner)).expect(409);

    const approvals = await http(app).get(`/businesses/${businessId}/orders?view=PENDING_APPROVAL`).set(auth(owner)).expect(200);
    expect(approvals.body.items.map((o: { id: string }) => o.id)).toEqual([pending.body.id]);
    await http(app).post(`/orders/${pending.body.id}/approve`).set(auth(member)).expect(403);
    // The owner can open the member's errand.
    await http(app).get(`/orders/${pending.body.id}`).set(auth(owner)).expect(200);

    const approved = await http(app).post(`/orders/${pending.body.id}/approve`).set(auth(owner)).expect(200);
    expect(approved.body.status).toBe('PENDING');
    expect(approved.body.business.name).toBe('Acme Logistics Ltd');
    expect(await businessBalance(businessId)).toBe(-pending.body.total);

    await http(app).post(`/orders/${pending.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${pending.body.id}/deliver`).set(auth(runner)).send({ pin: pending.body.deliveryPin }).expect(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: pending.body.id } });
    expect(order.status).toBe('COMPLETED');

    // A second errand rejected by the owner.
    const second = await http(app).post('/orders').set(auth(member)).send(companyErrand(businessId)).expect(201);
    await http(app).post(`/orders/${second.body.id}/reject`).set(auth(owner)).send({ reason: 'Use the office courier' }).expect(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.body.id } })).status).toBe('CANCELLED');

    // The owner's own errands skip approval; the credit limit is enforced.
    const credit = await http(app).get(`/businesses/${businessId}`).set(auth(owner)).expect(200);
    expect(credit.body.creditUsed).toBe(pending.body.total);
    const tooBig = await http(app)
      .post('/orders')
      .set(auth(owner))
      .send(companyErrand(businessId, { itemsCost: 5_000 }))
      .expect(400);
    expect(tooBig.body.message).toMatch(/credit limit/);

    // Cancelling an unassigned company errand gives the credit back.
    const own = await http(app).post('/orders').set(auth(owner)).send(companyErrand(businessId)).expect(201);
    expect(own.body.status).toBe('PENDING');
    await http(app).post(`/orders/${own.body.id}/cancel`).set(auth(owner)).send({ reason: 'Not needed any more' }).expect(200);
    expect(await businessBalance(businessId)).toBe(-pending.body.total);
  });

  it('places bulk orders from one pickup within the available credit', async () => {
    const { owner, businessId } = await activeCompany(3_000);
    const branch = await http(app)
      .post(`/businesses/${businessId}/branches`)
      .set(auth(owner))
      .send({ label: 'Westlands branch', building: 'Square Mall', ...WESTLANDS })
      .expect(201);
    const item = (n: number) => ({
      description: `Parcel number ${n} for a client`,
      dropoffAddressId: branch.body.id,
      recipientName: `Client ${n}`,
    });

    const batch = await http(app)
      .post(`/businesses/${businessId}/bulk-orders`)
      .set(auth(owner))
      .send({
        categorySlug: 'parcel-delivery',
        pickup: { address: 'Warehouse, Industrial Area', ...NAIROBI_CBD },
        deliveryType: 'MOTORCYCLE',
        items: [item(1), item(2)],
      })
      .expect(201);
    expect(batch.body.count).toBe(2);
    expect(await businessBalance(businessId)).toBe(-batch.body.total);

    // A batch bigger than the remaining credit creates nothing.
    const before = await prisma.order.count({ where: { businessId } });
    const tooMany = await http(app)
      .post(`/businesses/${businessId}/bulk-orders`)
      .set(auth(owner))
      .send({
        categorySlug: 'parcel-delivery',
        pickup: { address: 'Warehouse', ...NAIROBI_CBD },
        deliveryType: 'MOTORCYCLE',
        items: Array.from({ length: 20 }, (_, i) => item(i)),
      })
      .expect(400);
    expect(tooMany.body.message).toMatch(/credit is available/);
    expect(await prisma.order.count({ where: { businessId } })).toBe(before);
  });

  it('lists approved shops and charges them commission on completed orders', async () => {
    const shopOwner = await registerUser(app, 'CUSTOMER');
    const shop = await http(app)
      .post('/merchants')
      .set(auth(shopOwner))
      .send({ name: 'Mama Mboga Fresh', categorySlug: 'grocery-shopping', addressLine: 'Moi Avenue', ...NAIROBI_CBD })
      .expect(201);
    const customer = await registerUser(app, 'CUSTOMER');
    const listed = async () =>
      (await http(app).get(`/merchants?lat=${WESTLANDS.lat}&lng=${WESTLANDS.lng}`).set(auth(customer)).expect(200)).body;
    expect((await listed()).some((m: { id: string }) => m.id === shop.body.id)).toBe(false);

    await http(app).post(`/admin/merchants/${shop.body.id}/approve`).set(auth(merchantManager)).expect(200);
    await http(app)
      .patch(`/admin/merchants/${shop.body.id}`)
      .set(auth(merchantManager))
      .send({ commissionRate: 0.05, isFeatured: true })
      .expect(200);
    const directory: { id: string; isFeatured: boolean; distanceKm: number }[] = await listed();
    // Featured shops come first (other test runs may have added more).
    const listing = directory.find((m) => m.id === shop.body.id)!;
    expect(listing.distanceKm).toBeGreaterThan(0);
    expect(directory.slice(0, directory.indexOf(listing)).every((m) => m.isFeatured)).toBe(true);

    const order = await http(app)
      .post('/orders')
      .set(auth(customer))
      .send({
        categorySlug: 'grocery-shopping',
        description: 'Sukuma wiki, tomatoes and onions',
        merchantId: shop.body.id,
        dropoff: { address: 'Westlands Square', ...WESTLANDS },
        deliveryType: 'MOTORCYCLE',
        itemsCost: 1_000,
        paymentMethod: 'CASH',
      })
      .expect(201);
    expect(order.body.pickupLabel).toBe('Mama Mboga Fresh');
    expect(order.body.merchantCommission).toBe(50);

    const runner = await createApprovedRunner(app);
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);

    // The shop sees the order and tells the runner it is ready.
    const shopOrders = await http(app).get(`/merchants/${shop.body.id}/orders`).set(auth(shopOwner)).expect(200);
    expect(shopOrders.body.items[0]).toMatchObject({ id: order.body.id, runner: { phone: runner.phone } });
    await http(app).post(`/merchants/${shop.body.id}/orders/${order.body.id}/ready`).set(auth(customer)).expect(404);
    await http(app).post(`/merchants/${shop.body.id}/orders/${order.body.id}/ready`).set(auth(shopOwner)).expect(200);
    const runnerNotes = await http(app).get('/me/notifications').set(auth(runner)).expect(200);
    expect(runnerNotes.body[0].title).toBe('Order ready at the shop');

    await http(app).post(`/orders/${order.body.id}/deliver`).set(auth(runner)).send({ pin: order.body.deliveryPin }).expect(200);
    expect(await merchantBalance(shop.body.id)).toBe(-50);
    const dashboard = await http(app).get(`/merchants/${shop.body.id}/dashboard`).set(auth(shopOwner)).expect(200);
    expect(dashboard.body).toMatchObject({ commissionOwed: 50, thisMonth: { orders: 1, sales: 1_000, commission: 50 } });

    // Monthly commission invoice, paid by bank transfer.
    const period = { periodStart: new Date(Date.now() - 86_400_000).toISOString(), periodEnd: new Date(Date.now() + 60_000).toISOString() };
    const invoice = await http(app)
      .post('/admin/invoices/generate')
      .set(auth(finance))
      .send({ merchantId: shop.body.id, ...period })
      .expect(201);
    expect(invoice.body).toMatchObject({ amount: 50, status: 'ISSUED' });
    expect(invoice.body.merchantOrders).toHaveLength(1);
    await http(app)
      .post('/admin/invoices/generate')
      .set(auth(finance))
      .send({ merchantId: shop.body.id, ...period })
      .expect(400);
    await http(app).post(`/admin/invoices/${invoice.body.id}/mark-paid`).set(auth(finance)).send({ reference: 'BANK-0001' }).expect(200);
    expect(await merchantBalance(shop.body.id)).toBe(0);
  });

  it('invoices a company and accepts payment by M-Pesa', async () => {
    const { owner, businessId } = await activeCompany();
    const runner = await createApprovedRunner(app);
    const order = await http(app).post('/orders').set(auth(owner)).send(companyErrand(businessId)).expect(201);
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${order.body.id}/deliver`).set(auth(runner)).send({ pin: order.body.deliveryPin }).expect(200);

    const period = { periodStart: new Date(Date.now() - 86_400_000).toISOString(), periodEnd: new Date(Date.now() + 60_000).toISOString() };
    const voided = await http(app)
      .post('/admin/invoices/generate')
      .set(auth(finance))
      .send({ businessId, ...period })
      .expect(201);
    await http(app).post(`/admin/invoices/${voided.body.id}/void`).set(auth(finance)).send({ reason: 'Wrong period' }).expect(200);
    const invoice = await http(app)
      .post('/admin/invoices/generate')
      .set(auth(finance))
      .send({ businessId, ...period })
      .expect(201);
    expect(invoice.body.amount).toBe(order.body.total);
    expect(invoice.body.number).toMatch(/^INV-\d{6}-\d{4}$/);

    const mine = await http(app).get('/invoices').set(auth(owner)).expect(200);
    expect(mine.body.map((i: { id: string }) => i.id)).toContain(invoice.body.id);
    const stranger = await registerUser(app, 'CUSTOMER');
    await http(app).get(`/invoices/${invoice.body.id}`).set(auth(stranger)).expect(404);

    await http(app).post(`/invoices/${invoice.body.id}/pay`).set(auth(owner)).send({ phone: owner.phone }).expect(200);
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.body.id } });
    const callback = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'test',
          CheckoutRequestID: payment.providerRequestId,
          ResultCode: 0,
          ResultDesc: 'OK',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: invoice.body.amount },
              { Name: 'MpesaReceiptNumber', Value: `INV${payment.id.slice(0, 7)}` },
            ],
          },
        },
      },
    };
    await http(app).post(`/payments/mpesa/stk-callback/${SECRET}`).send(callback).expect(200);
    await http(app).post(`/payments/mpesa/stk-callback/${SECRET}`).send(callback).expect(200);

    const paid = await http(app).get(`/invoices/${invoice.body.id}`).set(auth(owner)).expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(await businessBalance(businessId)).toBe(0);
  });
});
