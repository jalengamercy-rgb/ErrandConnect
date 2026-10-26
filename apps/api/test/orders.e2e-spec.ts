import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  appUrl,
  auth,
  createApprovedRunner,
  createStaff,
  createTestApp,
  http,
  MOMBASA,
  NAIROBI_CBD,
  registerUser,
  WESTLANDS,
  type TestUser,
} from './helpers.js';

const errand = (overrides: Record<string, unknown> = {}) => ({
  categorySlug: 'grocery-shopping',
  description: 'Buy 2kg sugar and 1L milk from Naivas',
  pickup: { address: 'Naivas, Moi Avenue', ...NAIROBI_CBD },
  dropoff: { address: 'Westlands Square', ...WESTLANDS },
  deliveryType: 'MOTORCYCLE',
  itemsCost: 400,
  paymentMethod: 'CASH',
  ...overrides,
});

/** Just the fields that affect price, for /orders/quote. */
const details = (overrides: Record<string, unknown> = {}) => {
  const { paymentMethod: _p, description: _d, ...rest } = errand(overrides);
  return rest;
};

/** Waits for one event on a socket, failing after 3 seconds. */
function nextEvent<T = Record<string, unknown>>(socket: Socket, event: string, match: (p: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 3000);
    const handler = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

describe('Errands (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sockets: Socket[] = [];

  const connect = async (user: TestUser) => {
    const socket = io(appUrl(app), { auth: { token: user.accessToken }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    return socket;
  };

  beforeAll(async () => {
    app = await createTestApp({ listen: true });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  });

  it('quotes using the category fee and estimated road distance', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const res = await http(app).post('/orders/quote').set(auth(customer)).send(details()).expect(200);
    expect(res.body.distanceKm).toBe(2.9);
    expect(res.body.quote.customer.errandFee).toBe(150);
    expect(res.body.quote.customer.itemsCost).toBe(400);
    expect(res.body.quote.customer.total).toBe(res.body.quote.runner.total + res.body.quote.platform.total);
  });

  it('delivers to a saved address', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const address = await http(app).post('/me/addresses').set(auth(customer)).send({ label: 'Office', area: 'Westlands', ...WESTLANDS }).expect(201);
    const { dropoff: _dropoff, ...rest } = errand();
    const order = await http(app).post('/orders').set(auth(customer)).send({ ...rest, dropoffAddressId: address.body.id }).expect(201);
    const { dropoff: _d2, ...quoteRest } = details();
    expect(order.body.dropoffLabel).toBe('Office');
    expect(order.body.dropoffAddress).toBe('Westlands');

    const stranger = await registerUser(app, 'CUSTOMER');
    await http(app).post('/orders/quote').set(auth(stranger)).send({ ...quoteRest, dropoffAddressId: address.body.id }).expect(404);
  });

  it('runs a full errand: post → match → accept → progress → chat → PIN → rate', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app, NAIROBI_CBD);
    const farRunner = await createApprovedRunner(app, MOMBASA);
    const otherRunner = await createApprovedRunner(app, NAIROBI_CBD);

    const runnerSocket = await connect(runner);
    const customerSocket = await connect(customer);
    const jobNew = nextEvent(runnerSocket, 'job.new');

    const created = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    const orderId = created.body.id;
    expect(created.body.status).toBe('PENDING');
    expect(created.body.orderNumber).toMatch(/^EC-\d{8}-\d{5}$/);
    expect(created.body.deliveryPin).toMatch(/^\d{4}$/);
    expect(await jobNew).toEqual({ orderId });

    // Nearby runner sees it with distance and earnings; far-away runner doesn't.
    const jobs = await http(app).get('/runners/me/jobs').set(auth(runner)).expect(200);
    const job = jobs.body.find((j: { id: string }) => j.id === orderId);
    expect(job).toMatchObject({ awayKm: 0, runnerEarnings: created.body.runnerEarnings, runnerFee: created.body.runnerEarnings - 400, category: 'Grocery Shopping' });
    expect(job).not.toHaveProperty('deliveryPin');
    const farJobs = await http(app).get('/runners/me/jobs').set(auth(farRunner)).expect(200);
    expect(farJobs.body.some((j: { id: string }) => j.id === orderId)).toBe(false);

    // Customers can't see each other's orders, and the runner can't see it before accepting.
    await http(app).get(`/orders/${orderId}`).set(auth(runner)).expect(404);

    const accepted = nextEvent(customerSocket, 'order.updated', (p: { status?: string }) => p.status === 'ACCEPTED');
    const accept = await http(app).post(`/orders/${orderId}/accept`).set(auth(runner)).expect(200);
    expect(accept.body.status).toBe('ACCEPTED');
    expect(accept.body).not.toHaveProperty('deliveryPin');
    expect(accept.body.customer.phone).toBe(customer.phone);
    await accepted;
    await http(app).post(`/orders/${orderId}/accept`).set(auth(otherRunner)).expect(409);

    // Customer sees the runner and their live location.
    await http(app).put('/runners/me/location').set(auth(runner)).send({ lat: -1.28, lng: 36.815 }).expect(200);
    const tracked = await http(app).get(`/orders/${orderId}`).set(auth(customer)).expect(200);
    expect(tracked.body.runner).toMatchObject({ id: runner.id, phone: runner.phone, location: { lat: -1.28, lng: 36.815 } });

    // Live location over the socket after subscribing to the order.
    expect(await customerSocket.emitWithAck('order.subscribe', { orderId })).toEqual({ ok: true });
    const located = nextEvent(customerSocket, 'runner.location', (p: { orderId?: string }) => p.orderId === orderId);
    await http(app).put('/runners/me/location').set(auth(runner)).send({ lat: -1.275, lng: 36.812 }).expect(200);
    expect(await located).toMatchObject({ lat: -1.275, lng: 36.812 });

    // Status can only move forward.
    await http(app).post(`/orders/${orderId}/progress`).set(auth(runner)).send({ status: 'AT_STORE' }).expect(200);
    await http(app).post(`/orders/${orderId}/progress`).set(auth(runner)).send({ status: 'PICKED_UP' }).expect(200);
    await http(app).post(`/orders/${orderId}/progress`).set(auth(runner)).send({ status: 'AT_STORE' }).expect(409);
    await http(app).post(`/orders/${orderId}/cancel`).set(auth(customer)).send({ reason: 'Changed my mind' }).expect(409);

    // Chat both ways.
    const chatEvent = nextEvent(runnerSocket, 'order.message');
    await http(app).post(`/orders/${orderId}/messages`).set(auth(customer)).send({ body: 'Please get Brookside milk' }).expect(201);
    expect(await chatEvent).toMatchObject({ orderId, message: { body: 'Please get Brookside milk', senderId: customer.id } });
    await http(app).post(`/orders/${orderId}/messages`).set(auth(runner)).send({ body: 'Sawa, on it' }).expect(201);
    const messages = await http(app).get(`/orders/${orderId}/messages`).set(auth(customer)).expect(200);
    expect(messages.body.map((m: { body: string }) => m.body)).toEqual(['Please get Brookside milk', 'Sawa, on it']);
    await http(app).get(`/orders/${orderId}/messages`).set(auth(otherRunner)).expect(404);

    // Wrong PIN, then the right one completes the order.
    const pin: string = created.body.deliveryPin;
    const wrong = pin === '0000' ? '1111' : '0000';
    const wrongRes = await http(app).post(`/orders/${orderId}/deliver`).set(auth(runner)).send({ pin: wrong }).expect(400);
    expect(wrongRes.body.message).toContain('4 attempts left');
    const done = await http(app).post(`/orders/${orderId}/deliver`).set(auth(runner)).send({ pin }).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.events.map((e: { status: string }) => e.status)).toEqual(['PENDING', 'ACCEPTED', 'AT_STORE', 'PICKED_UP', 'DELIVERED', 'COMPLETED']);
    // Phone numbers stop being shared once the errand is over.
    const after = await http(app).get(`/orders/${orderId}`).set(auth(customer)).expect(200);
    expect(after.body.runner.phone).toBeUndefined();

    // Both sides rate each other once.
    await http(app).post(`/orders/${orderId}/review`).set(auth(customer)).send({ stars: 5, comment: 'Fast!' }).expect(201);
    await http(app).post(`/orders/${orderId}/review`).set(auth(customer)).send({ stars: 4 }).expect(409);
    await http(app).post(`/orders/${orderId}/review`).set(auth(runner)).send({ stars: 4 }).expect(201);
    const profile = await prisma.runnerProfile.findUniqueOrThrow({ where: { userId: runner.id } });
    expect(profile).toMatchObject({ ratingAvg: 5, ratingCount: 1, jobsCompleted: 1 });

    const history = await http(app).get('/runners/me/orders?scope=past').set(auth(runner)).expect(200);
    expect(history.body[0]).toMatchObject({ id: orderId, status: 'COMPLETED' });
  });

  it('only matches runners with the right delivery type and services', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const walker = await createApprovedRunner(app, NAIROBI_CBD, { deliveryTypes: ['WALKING'] });
    const order = await http(app).post('/orders').set(auth(customer)).send(errand({ deliveryType: 'CAR' })).expect(201);
    const jobs = await http(app).get('/runners/me/jobs').set(auth(walker)).expect(200);
    expect(jobs.body.some((j: { id: string }) => j.id === order.body.id)).toBe(false);
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(walker)).expect(403);
  });

  it('lets a runner hold only one job and hand a job back', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const first = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    const second = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);

    await http(app).post(`/orders/${first.body.id}/accept`).set(auth(runner)).expect(200);
    await http(app).post(`/orders/${second.body.id}/accept`).set(auth(runner)).expect(409);

    await http(app).post(`/orders/${first.body.id}/release`).set(auth(runner)).send({ reason: 'Bike puncture' }).expect(200);
    const back = await http(app).get(`/orders/${first.body.id}`).set(auth(customer)).expect(200);
    expect(back.body).toMatchObject({ status: 'PENDING', runner: null });
    await http(app).post(`/orders/${second.body.id}/accept`).set(auth(runner)).expect(200);
  });

  it('lets customers cancel before pickup', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    const cancelled = await http(app).post(`/orders/${order.body.id}/cancel`).set(auth(customer)).send({ reason: 'No longer needed' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'No longer needed' });
    const active = await http(app).get('/orders?scope=active').set(auth(customer)).expect(200);
    expect(active.body.some((o: { id: string }) => o.id === order.body.id)).toBe(false);
  });

  it('limits order value by verification level', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const res = await http(app).post('/orders').set(auth(customer)).send(errand({ itemsCost: 6000 })).expect(403);
    expect(res.body.message).toContain('KES 5,000');
  });

  it('locks delivery after 5 wrong PINs', async () => {
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);
    await http(app).post(`/orders/${order.body.id}/accept`).set(auth(runner)).expect(200);
    const wrong = order.body.deliveryPin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) await http(app).post(`/orders/${order.body.id}/deliver`).set(auth(runner)).send({ pin: wrong }).expect(400);
    await http(app).post(`/orders/${order.body.id}/deliver`).set(auth(runner)).send({ pin: order.body.deliveryPin }).expect(423);
  });

  it('lets support assign and cancel orders', async () => {
    const ops = await createStaff(app, 'OPERATIONS_MANAGER');
    const customer = await registerUser(app, 'CUSTOMER');
    const runner = await createApprovedRunner(app);
    const order = await http(app).post('/orders').set(auth(customer)).send(errand()).expect(201);

    const list = await http(app).get(`/admin/orders?search=${order.body.orderNumber}`).set(auth(ops)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: order.body.id, status: 'PENDING' });

    const assigned = await http(app).post(`/admin/orders/${order.body.id}/assign`).set(auth(ops)).send({ runnerId: runner.id }).expect(200);
    expect(assigned.body).toMatchObject({ status: 'RUNNER_ASSIGNED', runner: { id: runner.id } });
    await http(app).post(`/admin/orders/${order.body.id}/cancel`).set(auth(ops)).send({ reason: 'Customer called support' }).expect(200);
    await http(app).get(`/admin/orders/${order.body.id}`).set(auth(customer)).expect(403);
  });

  it('rejects socket connections without a valid token', async () => {
    const socket = io(appUrl(app), { auth: { token: 'nope' }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    expect(socket.connected).toBe(false);
  });
});
