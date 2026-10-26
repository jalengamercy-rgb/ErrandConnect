import { INestApplication } from '@nestjs/common';
import { defaultEtaModel, predictMinutes } from '@errandconnect/shared';
import { RiskService } from '../src/insights/risk.service.js';
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

const DAY_MS = 86_400_000;

const errand = (overrides: Record<string, unknown> = {}) => ({
  categorySlug: 'parcel-delivery',
  description: 'Deliver an envelope to the Westlands office',
  pickup: { address: 'Kenyatta Avenue', ...NAIROBI_CBD },
  dropoff: { address: 'Westlands Square', ...WESTLANDS },
  deliveryType: 'MOTORCYCLE',
  paymentMethod: 'CASH',
  ...overrides,
});

describe('Insights: risk rules and predictions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ops: TestUser;
  let runner: TestUser;

  const flagsFor = async (userId: string) =>
    (await http(app).get(`/admin/insights/risk-flags?userId=${userId}`).set(auth(ops)).expect(200)).body.items as {
      id: string;
      rule: string;
      severity: string;
      status: string;
      title: string;
    }[];
  /** Runner at the CBD, seen just now (so their location counts). */
  const freshRunner = () =>
    prisma.runnerProfile.update({
      where: { userId: runner.id },
      data: { lastLat: NAIROBI_CBD.lat, lastLng: NAIROBI_CBD.lng, lastSeenAt: new Date() },
    });
  async function complete(order: { id: string; deliveryPin: string }) {
    await http(app).post(`/orders/${order.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${order.id}/deliver`).set(auth(runner)).send({ pin: order.deliveryPin }).expect(200);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ops = await createStaff(app, 'OPERATIONS_MANAGER');
    runner = await createApprovedRunner(app);
  });

  afterEach(async () => {
    await prisma.order.updateMany({
      where: { runnerId: runner.id, status: { in: ['ACCEPTED', 'RUNNER_ASSIGNED'] } },
      data: { status: 'CANCELLED' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('predicts delivery time when a runner accepts and lists late errands', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    expect(order.body.expectedBy).toBeNull();
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);

    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    // Test errands finish in milliseconds, so there is no history: the default speeds are used.
    expect(saved.predictedMinutes).toBe(predictMinutes(defaultEtaModel('MOTORCYCLE'), saved.distanceKm));
    const view = await http(app).get(`/orders/${order.body.id}`).set(auth(customer)).expect(200);
    expect(new Date(view.body.expectedBy).getTime()).toBe(saved.acceptedAt!.getTime() + saved.predictedMinutes! * 60_000);

    // Three hours later it's clearly late.
    await prisma.order.update({ where: { id: saved.id }, data: { acceptedAt: new Date(Date.now() - 3 * 3_600_000) } });
    const times = await http(app).get('/admin/insights/delivery-times').set(auth(ops)).expect(200);
    expect(times.body.models.MOTORCYCLE).toMatchObject({ samples: 0 });
    const late = times.body.late.find((o: { id: string }) => o.id === saved.id);
    expect(late.minutesLate).toBeGreaterThan(100);
    expect(late.runner.id).toBe(runner.id);
  });

  it('flags a big first errand from a brand-new account', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    await http(app)
      .post('/orders')
      .set(auth(customer))
      .send(errand({ itemsCost: 3_000 }))
      .expect(201);
    const flags = await flagsFor(customer.id);
    expect(flags).toEqual([expect.objectContaining({ rule: 'NEW_ACCOUNT_BIG_ORDER', severity: 'LOW', status: 'OPEN' })]);
  });

  it('flags deliveries confirmed far from the drop-off', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    await freshRunner();
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    await complete(order.body);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    // The runner is still at the CBD, about 2 km from Westlands.
    expect(saved.deliveryDistanceKm).toBeGreaterThan(1.5);
    const flags = await flagsFor(runner.id);
    expect(flags.some((f) => f.rule === 'FAR_FROM_DROPOFF' && f.severity === 'MEDIUM')).toBe(true);
  });

  it('finds customers who keep cancelling after a runner accepts; staff review the flag', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    for (let i = 0; i < 5; i++) {
      const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
      await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);
      await http(app).post(`/orders/${order.body.id}/cancel`).set(auth(customer)).send({ reason: 'Changed my mind' }).expect(200);
    }
    await http(app).post('/admin/insights/risk/scan').set(auth(ops)).expect(200);
    const [flag] = await flagsFor(customer.id);
    expect(flag).toMatchObject({ rule: 'CUSTOMER_CANCELS', title: 'Cancels a lot after a runner accepts', status: 'OPEN' });

    const support = await createStaff(app, 'CUSTOMER_SUPPORT');
    await http(app).get(`/admin/insights/risk-flags?userId=${customer.id}`).set(auth(support)).expect(200);
    await http(app).post(`/admin/insights/risk-flags/${flag.id}/review`).set(auth(support)).send({ decision: 'DISMISSED' }).expect(403);
    await http(app)
      .post(`/admin/insights/risk-flags/${flag.id}/review`)
      .set(auth(ops))
      .send({ decision: 'DISMISSED', note: 'Testing the app' })
      .expect(200);

    // Scanning again doesn't bring back a dismissed flag the same week.
    await app.get(RiskService).scan();
    expect((await flagsFor(customer.id)).map((f) => f.status)).toEqual(['DISMISSED']);
  });

  it('holds withdrawals for review while a high-risk flag is open', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const ledger = app.get(LedgerService);
    await prisma.$transaction(async (tx) => {
      const [platform, wallet] = await Promise.all([
        ledger.systemWallet(tx, 'PLATFORM_REVENUE'),
        ledger.userWallet(tx, customer.id, 'CUSTOMER'),
      ]);
      await ledger.post(tx, {
        type: 'REFERRAL_REWARD',
        description: 'Test credit',
        entries: [
          { walletId: platform.id, amount: -1_000 },
          { walletId: wallet.id, amount: 1_000 },
        ],
      });
    });
    await app.get(RiskService).raise({ rule: 'REFERRAL_BURST', userId: customer.id, summary: '6 referral rewards in 7 days' });

    const held = await http(app).post('/wallets/customer/withdrawals').set(auth(customer)).send({ amount: 300, pin: '4821' }).expect(201);
    expect(held.body.status).toBe('REQUESTED');

    const [flag] = await flagsFor(customer.id);
    await http(app).post(`/admin/insights/risk-flags/${flag.id}/review`).set(auth(ops)).send({ decision: 'DISMISSED' }).expect(200);
    const paid = await http(app).post('/wallets/customer/withdrawals').set(auth(customer)).send({ amount: 300, pin: '4821' }).expect(201);
    expect(paid.body.status).toBe('APPROVED');
  });

  it('forecasts demand from the same hour in past weeks', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const lastWeek = new Date(hourStart - 7 * DAY_MS + 10 * 60_000);
    for (let i = 0; i < 3; i++) {
      const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
      await prisma.order.update({ where: { id: order.body.id }, data: { createdAt: lastWeek, status: 'CANCELLED' } });
    }
    const demand = await http(app).get('/admin/insights/demand?hours=6').set(auth(ops)).expect(200);
    expect(demand.body.forecast).toHaveLength(6);
    expect(demand.body.forecast[0].expected).toBeGreaterThan(0);
    const cbd = demand.body.hotspots.find(
      (h: { lat: number; lng: number }) => Math.abs(h.lat - NAIROBI_CBD.lat) < 0.02 && Math.abs(h.lng - NAIROBI_CBD.lng) < 0.02,
    );
    expect(cbd).toMatchObject({ name: 'Kenyatta Avenue' });
    expect(cbd.runnersNeeded).toBeGreaterThan(0);

    const summary = await http(app).get('/admin/insights/summary').set(auth(ops)).expect(200);
    expect(summary.body).toMatchObject({ nextHours: expect.any(Array), openFlags: expect.any(Number), lateErrands: expect.any(Number) });
  });

  it('lists customers and runners drifting away, and sends win-back messages', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    for (const daysAgo of [40, 30]) {
      const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
      await complete(order.body);
      await prisma.order.update({ where: { id: order.body.id }, data: { completedAt: new Date(Date.now() - daysAgo * DAY_MS) } });
    }
    const marketing = await createStaff(app, 'MARKETING_MANAGER');
    const churn = await http(app).get('/admin/insights/churn/customers?risk=AT_RISK').set(auth(marketing)).expect(200);
    expect(churn.body.items.find((c: { userId: string }) => c.userId === customer.id)).toMatchObject({
      orders: 2,
      daysSinceLast: 30,
      usualGapDays: 10,
      risk: 'AT_RISK',
    });

    await http(app)
      .post('/admin/insights/churn/win-back')
      .set(auth(marketing))
      .send({ userIds: [customer.id], title: 'We miss you', message: 'Your next errand is on us', promoCode: 'NOTACODE' })
      .expect(400);
    const sent = await http(app)
      .post('/admin/insights/churn/win-back')
      .set(auth(marketing))
      .send({ userIds: [customer.id], title: 'We miss you', message: 'Come back for your next errand' })
      .expect(200);
    expect(sent.body.sent).toBe(1);
    const inbox = await http(app).get('/me/notifications').set(auth(customer)).expect(200);
    expect(inbox.body[0].title).toBe('We miss you');

    // The runner did all those jobs; make them look 20 days old and add three more.
    for (let i = 0; i < 3; i++) {
      const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
      await complete(order.body);
    }
    await prisma.order.updateMany({
      where: { runnerId: runner.id, status: 'COMPLETED' },
      data: { completedAt: new Date(Date.now() - 20 * DAY_MS) },
    });
    const runners = await http(app).get('/admin/insights/churn/runners').set(auth(ops)).expect(200);
    expect(runners.body.find((r: { userId: string }) => r.userId === runner.id)).toMatchObject({ daysSinceLast: 20 });
  });
});
