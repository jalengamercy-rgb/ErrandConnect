import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { auth, createTestApp, http, lastCodeSentTo, PASSWORD, randomPhone, registerUser } from './helpers.js';

describe('Auth & customer accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a customer with phone OTP', async () => {
    const tag = Date.now();
    const user = await registerUser(app, 'CUSTOMER', { email: `Jane${tag}@Example.com`, allowMarketing: false });
    const me = await http(app).get('/me').set(auth(user)).expect(200);

    expect(me.body.phone).toBe(user.phone);
    expect(me.body.email).toBe(`jane${tag}@example.com`);
    expect(me.body.customerProfile.verificationLevel).toBe(1);
    expect(me.body.customerProfile.customerCode).toMatch(/^EC-C-\d{7}$/);
    expect(me.body).not.toHaveProperty('passwordHash');

    const wallet = await prisma.wallet.findFirst({ where: { userId: user.id, type: 'CUSTOMER' } });
    expect(wallet?.balance).toBe(0);
    const consents = await prisma.consent.findMany({ where: { userId: user.id } });
    expect(consents.map((c) => c.type).sort()).toEqual(['MARKETING', 'PRIVACY_POLICY', 'TERMS']);
  });

  it('accepts local phone formats and normalises them', async () => {
    const local = '0' + randomPhone().slice(4);
    await http(app).post('/auth/otp/request').send({ phone: local, purpose: 'REGISTER' }).expect(200);
    expect(() => lastCodeSentTo(app, '+254' + local.slice(1))).not.toThrow();
  });

  it('refuses to register the same phone twice', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    await http(app).post('/auth/otp/request').send({ phone: user.phone, purpose: 'REGISTER' }).expect(409);
  });

  it('rejects a wrong OTP and limits resends', async () => {
    const phone = randomPhone();
    await http(app).post('/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(200);
    const code = lastCodeSentTo(app, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    await http(app).post('/auth/otp/verify').send({ phone, purpose: 'REGISTER', code: wrong }).expect(400);
    await http(app).post('/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(429);
    await http(app).post('/auth/otp/verify').send({ phone, purpose: 'REGISTER', code }).expect(200);
    // A code can only be used once.
    await http(app).post('/auth/otp/verify').send({ phone, purpose: 'REGISTER', code }).expect(400);
  });

  it('logs in, refreshes with rotation, and logs out', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    const login = await http(app).post('/auth/login').send({ phone: user.phone, password: PASSWORD }).expect(200);
    const { refreshToken, accessToken } = login.body.tokens;

    const refreshed = await http(app).post('/auth/refresh').send({ refreshToken }).expect(200);
    // The old refresh token no longer works.
    await http(app).post('/auth/refresh').send({ refreshToken }).expect(401);

    await http(app)
      .post('/auth/logout')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);
    await http(app)
      .get('/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(401);
    await http(app).post('/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('locks the account after 5 wrong passwords', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    for (let i = 0; i < 5; i++) {
      await http(app).post('/auth/login').send({ phone: user.phone, password: 'Wrong1234' }).expect(401);
    }
    await http(app).post('/auth/login').send({ phone: user.phone, password: PASSWORD }).expect(403);
  });

  it('resets the password with an OTP and signs out other devices', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    await http(app).post('/auth/otp/request').send({ phone: user.phone, purpose: 'RESET_PASSWORD' }).expect(200);
    const verify = await http(app)
      .post('/auth/otp/verify')
      .send({ phone: user.phone, purpose: 'RESET_PASSWORD', code: lastCodeSentTo(app, user.phone) })
      .expect(200);
    await http(app)
      .post('/auth/password/reset')
      .send({ verificationToken: verify.body.verificationToken, newPassword: 'NewSecret456' })
      .expect(200);

    await http(app).get('/me').set(auth(user)).expect(401);
    await http(app).post('/auth/login').send({ phone: user.phone, password: PASSWORD }).expect(401);
    await http(app).post('/auth/login').send({ phone: user.phone, password: 'NewSecret456' }).expect(200);
  });

  it('does not reveal whether a number is registered when resetting', async () => {
    const phone = randomPhone();
    await http(app).post('/auth/otp/request').send({ phone, purpose: 'RESET_PASSWORD' }).expect(200);
    expect(() => lastCodeSentTo(app, phone)).toThrow();
  });

  it('verifies email to reach level 2', async () => {
    const user = await registerUser(app, 'CUSTOMER', { email: `user${Date.now()}@example.com` });
    const me = await http(app).get('/me').set(auth(user)).expect(200);
    await http(app).post('/me/email/verify/request').set(auth(user)).expect(200);
    const code = lastCodeSentTo(app, me.body.email);
    const verified = await http(app).post('/me/email/verify/confirm').set(auth(user)).send({ code }).expect(200);
    expect(verified.body.customerProfile.verificationLevel).toBe(2);
  });

  it('manages saved addresses with a single default', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    const home = await http(app)
      .post('/me/addresses')
      .set(auth(user))
      .send({ label: 'Home', area: 'Kilimani', lat: -1.2921, lng: 36.7856 })
      .expect(201);
    expect(home.body.isDefault).toBe(true);

    const office = await http(app)
      .post('/me/addresses')
      .set(auth(user))
      .send({ label: 'Office', area: 'Westlands', lat: -1.2676, lng: 36.8108, isDefault: true })
      .expect(201);

    const list = await http(app).get('/me/addresses').set(auth(user)).expect(200);
    expect(list.body.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault])).toEqual([
      ['Office', true],
      ['Home', false],
    ]);

    await http(app).delete(`/me/addresses/${office.body.id}`).set(auth(user)).expect(200);
    const other = await registerUser(app, 'CUSTOMER');
    await http(app).delete(`/me/addresses/${home.body.id}`).set(auth(other)).expect(404);
  });

  it('lets a customer also become a runner', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    await http(app).get('/runners/me/onboarding').set(auth(user)).expect(403);
    await http(app).post('/me/roles/runner').set(auth(user)).expect(201);
    await http(app).get('/runners/me/onboarding').set(auth(user)).expect(200);
    await http(app).post('/me/roles/runner').set(auth(user)).expect(409);
  });
});
