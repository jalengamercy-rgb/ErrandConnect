import { INestApplication } from '@nestjs/common';
import { DEFAULT_PRICING_CONFIG } from '@errandconnect/shared';
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
const errand = (paymentMethod: 'MPESA' | 'CASH' = 'MPESA') => ({
  categorySlug: 'parcel-delivery',
  description: 'Deliver a parcel to the office',
  pickup: { address: 'Kenyatta Avenue', ...NAIROBI_CBD },
  dropoff: { address: 'Westlands Square', ...WESTLANDS },
  deliveryType: 'MOTORCYCLE',
  paymentMethod,
});

describe('Admin operations, disputes and support (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ops: TestUser;
  let superAdmin: TestUser;

  const balance = async (userId: string, type: 'CUSTOMER' | 'RUNNER') =>
    (await prisma.wallet.findUnique({ where: { type_userId: { type, userId } } }))?.balance ?? 0;

  /** A paid M-Pesa errand accepted by a runner. */
  async function acceptedPaidErrand() {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.body.id } });
    await http(app)
      .post(`/payments/mpesa/stk-callback/${SECRET}`)
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: payment.providerRequestId,
            ResultCode: 0,
            ResultDesc: 'ok',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: order.body.total },
                { Name: 'MpesaReceiptNumber', Value: `TSTD${payment.id.slice(0, 8)}` },
              ],
            },
          },
        },
      })
      .expect(200);
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);
    return { customer, runner, order: order.body };
  }

  const openDisputeId = async (orderId: string) => (await prisma.dispute.findFirstOrThrow({ where: { orderId, status: 'OPEN' } })).id;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ops = await createStaff(app, 'OPERATIONS_MANAGER');
    superAdmin = await createStaff(app, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    const total = await prisma.wallet.aggregate({ _sum: { balance: true } });
    expect(total._sum.balance).toBe(0);
  });

  it('freezes a disputed errand and refunds the customer', async () => {
    const { customer, runner, order } = await acceptedPaidErrand();
    await http(app)
      .post(`/orders/${order.id}/disputes`)
      .set(auth(customer))
      .send({ type: 'NOT_DELIVERED', description: 'Runner stopped replying' })
      .expect(201);

    const frozen = await http(app).get(`/orders/${order.id}`).set(auth(customer)).expect(200);
    expect(frozen.body).toMatchObject({ status: 'DISPUTED', escrowStatus: 'ON_HOLD' });
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(409);
    await http(app)
      .post(`/orders/${order.id}/disputes`)
      .set(auth(customer))
      .send({ type: 'OTHER', description: 'Second report on same order' })
      .expect(409);

    const inbox = await http(app).get('/me/notifications').set(auth(runner)).expect(200);
    expect(inbox.body[0].title).toBe(`Problem reported on ${order.orderNumber}`);

    const list = await http(app).get('/admin/disputes?status=OPEN&pageSize=100').set(auth(ops)).expect(200);
    expect(list.body.items.some((d: { orderId: string }) => d.orderId === order.id)).toBe(true);
    const id = await openDisputeId(order.id);
    const detail = await http(app).get(`/admin/disputes/${id}`).set(auth(ops)).expect(200);
    expect(detail.body.order).not.toHaveProperty('deliveryPin');

    const resolved = await http(app)
      .post(`/admin/disputes/${id}/resolve`)
      .set(auth(ops))
      .send({ outcome: 'REFUND_CUSTOMER', resolution: 'Runner could not complete; full refund' })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', outcome: 'REFUND_CUSTOMER', order: { status: 'CANCELLED' } });
    expect(await balance(customer.id, 'CUSTOMER')).toBe(order.total);
    await http(app).post(`/admin/disputes/${id}/resolve`).set(auth(ops)).send({ outcome: 'NO_ACTION', resolution: 'again' }).expect(409);

    const customerInbox = await http(app).get('/me/notifications').set(auth(customer)).expect(200);
    expect(customerInbox.body[0]).toMatchObject({ title: `Problem on ${order.orderNumber} resolved`, link: `/orders/${order.id}` });
  });

  it('can pay the runner, or let the errand continue', async () => {
    const first = await acceptedPaidErrand();
    await http(app)
      .post(`/orders/${first.order.id}/disputes`)
      .set(auth(first.runner))
      .send({ type: 'CUSTOMER_BEHAVIOUR', description: 'Customer refuses to give the PIN' })
      .expect(201);
    await http(app)
      .post(`/admin/disputes/${await openDisputeId(first.order.id)}/resolve`)
      .set(auth(ops))
      .send({ outcome: 'PAY_RUNNER', resolution: 'Delivery confirmed by phone' })
      .expect(200);
    expect(await balance(first.runner.id, 'RUNNER')).toBe(first.order.runnerEarnings);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).status).toBe('COMPLETED');

    const second = await acceptedPaidErrand();
    await http(app)
      .post(`/orders/${second.order.id}/disputes`)
      .set(auth(second.customer))
      .send({ type: 'OTHER', description: 'Runner is taking very long' })
      .expect(201);
    await http(app)
      .post(`/admin/disputes/${await openDisputeId(second.order.id)}/resolve`)
      .set(auth(ops))
      .send({ outcome: 'NO_ACTION', resolution: 'Runner was stuck in traffic' })
      .expect(200);
    const restored = await http(app).get(`/orders/${second.order.id}`).set(auth(second.customer)).expect(200);
    expect(restored.body).toMatchObject({ status: 'ACCEPTED', escrowStatus: 'HELD' });
    await http(app).post(`/orders/${second.order.id}/deliver`).set(auth(second.runner)).send({ pin: second.order.deliveryPin }).expect(200);
  });

  it('credits customers from platform revenue for problems after payout', async () => {
    const { customer, runner, order } = await acceptedPaidErrand();
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(200);
    await http(app)
      .post(`/orders/${order.id}/disputes`)
      .set(auth(customer))
      .send({ type: 'DAMAGED', description: 'Parcel arrived torn open' })
      .expect(201);
    const id = await openDisputeId(order.id);
    await http(app)
      .post(`/admin/disputes/${id}/resolve`)
      .set(auth(ops))
      .send({ outcome: 'REFUND_CUSTOMER', resolution: 'Goodwill' })
      .expect(400);
    await http(app)
      .post(`/admin/disputes/${id}/resolve`)
      .set(auth(ops))
      .send({ outcome: 'REFUND_CUSTOMER', refundAmount: 100, resolution: 'Goodwill credit' })
      .expect(200);
    expect(await balance(customer.id, 'CUSTOMER')).toBe(100);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('COMPLETED');
  });

  it('runs support tickets between users and staff', async () => {
    const support = await createStaff(app, 'CUSTOMER_SUPPORT');
    const user = await registerUser(app, 'CUSTOMER');
    const ticket = await http(app)
      .post('/support/tickets')
      .set(auth(user))
      .send({ subject: 'Wrong charge', message: 'I was charged twice for one errand' })
      .expect(201);
    expect(ticket.body).toMatchObject({
      status: 'OPEN',
      number: expect.stringMatching(/^T-\d{6}$/),
      messages: [{ body: 'I was charged twice for one errand', fromStaff: false }],
    });

    const queue = await http(app).get('/admin/tickets?status=OPEN&assigned=unassigned&pageSize=100').set(auth(support)).expect(200);
    expect(queue.body.items.some((t: { id: string }) => t.id === ticket.body.id)).toBe(true);
    const replied = await http(app)
      .post(`/admin/tickets/${ticket.body.id}/messages`)
      .set(auth(support))
      .send({ message: 'Sorry! We have refunded the extra charge.' })
      .expect(200);
    expect(replied.body).toMatchObject({ status: 'PENDING', assignedTo: { id: support.id } });

    const inbox = await http(app).get('/me/notifications').set(auth(user)).expect(200);
    expect(inbox.body[0].link).toBe(`/support/${ticket.body.id}`);
    const back = await http(app)
      .post(`/support/tickets/${ticket.body.id}/messages`)
      .set(auth(user))
      .send({ message: 'Thanks!' })
      .expect(200);
    expect(back.body.status).toBe('OPEN');
    expect(back.body.messages).toHaveLength(3);

    await http(app).patch(`/admin/tickets/${ticket.body.id}`).set(auth(support)).send({ assignedToId: user.id }).expect(400);
    await http(app).patch(`/admin/tickets/${ticket.body.id}`).set(auth(support)).send({ status: 'CLOSED' }).expect(200);
    await http(app).post(`/support/tickets/${ticket.body.id}/messages`).set(auth(user)).send({ message: 'One more thing' }).expect(400);
    const stranger = await registerUser(app, 'CUSTOMER');
    await http(app).get(`/support/tickets/${ticket.body.id}`).set(auth(stranger)).expect(404);
  });

  it('edits pricing with validation and an audit trail', async () => {
    const finance = await createStaff(app, 'FINANCE_MANAGER');
    const customer = await registerUser(app, 'CUSTOMER');
    const current = await http(app).get('/admin/settings/pricing').set(auth(finance)).expect(200);
    expect(current.body.commissionRate).toBe(DEFAULT_PRICING_CONFIG.commissionRate);

    const invalid = await http(app)
      .put('/admin/settings/pricing')
      .set(auth(finance))
      .send({ ...current.body, commissionRate: 5 })
      .expect(400);
    expect(invalid.body.message).toContain('commissionRate must be between 0 and 1');
    await http(app).put('/admin/settings/pricing').set(auth(ops)).send(current.body).expect(403);

    try {
      await http(app)
        .put('/admin/settings/pricing')
        .set(auth(finance))
        .send({ ...current.body, commissionRate: 0.2 })
        .expect(200);
      const { categorySlug, pickup, dropoff, deliveryType } = errand();
      const quote = await http(app)
        .post('/orders/quote')
        .set(auth(customer))
        .send({ categorySlug, pickup, dropoff, deliveryType })
        .expect(200);
      expect(quote.body.quote.platform.commission).toBe(30); // 20% of the KES 150 errand fee
      const logs = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'settings.pricing.update', actorId: finance.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(logs.metadata).toMatchObject({ before: { commissionRate: 0.15 }, after: { commissionRate: 0.2 } });
    } finally {
      await http(app).put('/admin/settings/pricing').set(auth(finance)).send(DEFAULT_PRICING_CONFIG).expect(200);
    }
  });

  it('edits category fees', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const { categorySlug, pickup, dropoff, deliveryType } = errand();
    try {
      await http(app).patch('/admin/categories/parcel-delivery').set(auth(ops)).send({ baseFee: 250 }).expect(200);
      const quote = await http(app)
        .post('/orders/quote')
        .set(auth(customer))
        .send({ categorySlug, pickup, dropoff, deliveryType })
        .expect(200);
      expect(quote.body.quote.customer.errandFee).toBe(250);
    } finally {
      await http(app).patch('/admin/categories/parcel-delivery').set(auth(ops)).send({ baseFee: 150 }).expect(200);
    }
    await http(app).post('/admin/categories').set(auth(ops)).send({ slug: 'grocery-shopping', name: 'Dup', baseFee: 100 }).expect(409);
  });

  it('hides abusive reviews and recalculates the rating', async () => {
    const { customer, runner, order } = await acceptedPaidErrand();
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(200);
    await http(app).post(`/orders/${order.id}/review`).set(auth(customer)).send({ stars: 1, comment: 'rude words here' }).expect(201);
    expect((await prisma.runnerProfile.findUniqueOrThrow({ where: { userId: runner.id } })).ratingCount).toBe(1);

    const reviews = await http(app).get('/admin/reviews?maxStars=2&pageSize=100').set(auth(ops)).expect(200);
    const review = reviews.body.items.find((r: { orderId: string }) => r.orderId === order.id);
    await http(app).post(`/admin/reviews/${review.id}/visibility`).set(auth(ops)).send({ hidden: true }).expect(200);
    expect(await prisma.runnerProfile.findUniqueOrThrow({ where: { userId: runner.id } })).toMatchObject({ ratingCount: 0, ratingAvg: 0 });
  });

  it('manages staff roles (super admin only)', async () => {
    const newcomer = await registerUser(app, 'CUSTOMER');
    await http(app).post('/admin/staff').set(auth(ops)).send({ phone: newcomer.phone, role: 'CUSTOMER_SUPPORT' }).expect(403);
    await http(app).post('/admin/staff').set(auth(superAdmin)).send({ phone: newcomer.phone, role: 'CUSTOMER_SUPPORT' }).expect(201);
    await http(app).get('/admin/tickets').set(auth(newcomer)).expect(200);
    await http(app).patch(`/admin/staff/${newcomer.id}`).set(auth(superAdmin)).send({ role: 'MARKETING_MANAGER' }).expect(200);
    await http(app).get('/admin/tickets').set(auth(newcomer)).expect(403);
    await http(app).delete(`/admin/staff/${newcomer.id}`).set(auth(superAdmin)).expect(200);
    await http(app).get('/admin/dashboard').set(auth(newcomer)).expect(403);
    await http(app).delete(`/admin/staff/${superAdmin.id}`).set(auth(superAdmin)).expect(403);
  });

  it('sends announcements to the in-app inbox', async () => {
    const a = await registerUser(app, 'CUSTOMER');
    const b = await registerUser(app, 'CUSTOMER');
    const sent = await http(app)
      .post('/admin/notifications')
      .set(auth(ops))
      .send({ audience: 'USERS', userIds: [a.id, b.id], title: 'Easter offer', body: 'Free delivery this weekend' })
      .expect(201);
    expect(sent.body.recipients).toBe(2);
    const inbox = await http(app).get('/me/notifications').set(auth(a)).expect(200);
    expect(inbox.body[0]).toMatchObject({ title: 'Easter offer', readAt: null });
    expect((await http(app).post('/me/notifications/read-all').set(auth(a)).expect(200)).body).toEqual({ unread: 0 });
  });

  it('serves the dashboard, reports, CSV export and live map', async () => {
    const { order, runner } = await acceptedPaidErrand();
    const dashboard = await http(app).get('/admin/dashboard').set(auth(ops)).expect(200);
    expect(dashboard.body).toMatchObject({
      revenue: { total: expect.any(Number), today: expect.any(Number) },
      runners: { online: expect.any(Number), pendingApproval: expect.any(Number) },
      orders: { active: expect.any(Number) },
    });
    expect(dashboard.body.orders.active).toBeGreaterThan(0);

    const daily = await http(app).get('/admin/reports/daily?days=7').set(auth(ops)).expect(200);
    expect(daily.body).toHaveLength(7);
    expect(daily.body[6].orders).toBeGreaterThan(0);

    const today = new Date();
    const csv = await http(app)
      .get(
        `/admin/reports/orders.csv?from=${new Date(today.getTime() - 86_400_000).toISOString()}&to=${new Date(today.getTime() + 60_000).toISOString()}`,
      )
      .set(auth(ops))
      .expect(200)
      .expect('content-type', /text\/csv/);
    expect(csv.text.split('\n')[0]).toBe(
      'order_number,created_at,status,category,customer_phone,runner_phone,payment_method,items_cost,total,runner_earnings,platform_fee,distance_km',
    );
    expect(csv.text).toContain(order.orderNumber);

    await http(app).put('/runners/me/location').set(auth(runner)).send({ lat: -1.29, lng: 36.82 }).expect(200);
    const map = await http(app).get('/admin/live-map').set(auth(ops)).expect(200);
    expect(map.body.runners.find((r: { id: string }) => r.id === runner.id)).toMatchObject({ lat: -1.29, lng: 36.82, busy: true });
    expect(map.body.orders.some((o: { id: string }) => o.id === order.id)).toBe(true);
  });
});
