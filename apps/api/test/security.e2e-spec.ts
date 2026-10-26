import { INestApplication } from '@nestjs/common';
import { totpCode, totpStep } from '../src/common/totp.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { auth, createStaff, createTestApp, http, PASSWORD, registerUser, type TestUser } from './helpers.js';

const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const header = res.headers['set-cookie'] as string[] | undefined;
  return header?.find((c) => c.startsWith('ec_refresh='));
};

describe('Security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    delete process.env.STAFF_MFA_REQUIRED;
    await app.close();
  });

  it('sends security headers and a request ID, and hides internals in errors', async () => {
    const res = await http(app).get('/health').expect(200);
    expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);

    const error = await http(app).get('/me').set('X-Request-Id', 'support-ref-12345').expect(401);
    expect(error.body).toMatchObject({ statusCode: 401, requestId: 'support-ref-12345' });
  });

  it('keeps the admin refresh token in an httpOnly cookie and rotates it', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    const login = await http(app).post('/auth/login').send({ phone: user.phone, password: PASSWORD, useCookie: true }).expect(200);
    expect(login.body.tokens.refreshToken).toBeUndefined();
    expect(login.body.tokens.accessToken).toBeTruthy();
    const cookie = cookieFrom(login)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);

    const first = cookie.split(';')[0];
    const refreshed = await http(app).post('/auth/refresh').set('Cookie', first).send({}).expect(200);
    expect(refreshed.body.refreshToken).toBeUndefined();
    const next = cookieFrom(refreshed)!.split(';')[0];
    expect(next).not.toBe(first);
    // The old cookie value no longer works (rotation).
    await http(app).post('/auth/refresh').set('Cookie', first).send({}).expect(401);
    await http(app).post('/auth/refresh').send({}).expect(401);

    const logout = await http(app).post('/auth/logout').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
    expect(cookieFrom(logout)).toMatch(/ec_refresh=;/);
  });

  it('protects admin routes with two-factor sign-in for staff', async () => {
    const staff = await createStaff(app, 'OPERATIONS_MANAGER');
    await http(app).get('/admin/dashboard').set(auth(staff)).expect(200);
    const customer = await registerUser(app, 'CUSTOMER');
    await http(app).post('/auth/mfa/setup').set(auth(customer)).expect(403);

    // Required for everyone: staff without it are sent to set it up.
    process.env.STAFF_MFA_REQUIRED = 'true';
    const blocked = await http(app).get('/admin/dashboard').set(auth(staff)).expect(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');

    const setup = await http(app).post('/auth/mfa/setup').set(auth(staff)).expect(200);
    expect(setup.body.uri).toContain(`secret=${setup.body.secret}`);
    const stored = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: staff.id } });
    expect(stored.twoFactorSecret).not.toContain(setup.body.secret);

    await http(app).post('/auth/mfa/enable').set(auth(staff)).send({ code: '000000' }).expect(400);
    const step = totpStep();
    const enabled = await http(app)
      .post('/auth/mfa/enable')
      .set(auth(staff))
      .send({ code: totpCode(setup.body.secret, step) })
      .expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    // The session that set it up is already verified.
    await http(app).get('/admin/dashboard').set(auth(staff)).expect(200);

    // A new sign-in must enter a code before using admin routes; other routes work.
    const login = await http(app).post('/auth/login').send({ phone: staff.phone, password: PASSWORD }).expect(200);
    const session: TestUser = { ...staff, accessToken: login.body.tokens.accessToken };
    const needs = await http(app).get('/admin/dashboard').set(auth(session)).expect(403);
    expect(needs.body.code).toBe('MFA_REQUIRED');
    await http(app).get('/me').set(auth(session)).expect(200);
    // The code already used to enable can't be used again.
    await http(app)
      .post('/auth/mfa/verify')
      .set(auth(session))
      .send({ code: totpCode(setup.body.secret, step) })
      .expect(400);
    await http(app)
      .post('/auth/mfa/verify')
      .set(auth(session))
      .send({ code: totpCode(setup.body.secret, step + 1) })
      .expect(200);
    await http(app).get('/admin/dashboard').set(auth(session)).expect(200);

    // Recovery codes work once each.
    const third = await http(app).post('/auth/login').send({ phone: staff.phone, password: PASSWORD }).expect(200);
    const thirdSession: TestUser = { ...staff, accessToken: third.body.tokens.accessToken };
    const recovery = enabled.body.recoveryCodes[0];
    expect(recovery).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const status = await http(app)
      .post('/auth/mfa/verify')
      .set(auth(thirdSession))
      .send({ code: recovery.toLowerCase().replace('-', ' ') })
      .expect(200);
    expect(status.body).toMatchObject({ enabled: true, sessionVerified: true, recoveryCodesLeft: 9 });
    const fourth = await http(app).post('/auth/login').send({ phone: staff.phone, password: PASSWORD }).expect(200);
    await http(app)
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${fourth.body.tokens.accessToken}`)
      .send({ code: recovery })
      .expect(400);

    // A super admin can reset it; the staff member is signed out everywhere.
    const superAdmin = await createStaff(app, 'SUPER_ADMIN');
    process.env.STAFF_MFA_REQUIRED = 'false';
    await http(app).delete(`/admin/staff/${staff.id}/mfa`).set(auth(superAdmin)).expect(200);
    await http(app).get('/me').set(auth(session)).expect(401);
    delete process.env.STAFF_MFA_REQUIRED;
  });

  it('exports and deletes an account, keeping financial records', async () => {
    const user = await registerUser(app, 'CUSTOMER', { email: `del${Date.now()}@example.com` });
    await http(app).post('/me/addresses').set(auth(user)).send({ label: 'Home', lat: -1.28, lng: 36.81 }).expect(201);

    const exported = await http(app).get('/me/export').set(auth(user)).expect(200);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.body.account).toMatchObject({ phone: user.phone, addresses: [expect.objectContaining({ label: 'Home' })] });
    expect(exported.body.account.passwordHash).toBeUndefined();

    await http(app).post('/me/delete').set(auth(user)).send({ password: 'Wrong123' }).expect(401);
    await prisma.wallet.upsert({
      where: { type_userId: { type: 'CUSTOMER', userId: user.id } },
      update: {},
      create: { type: 'CUSTOMER', userId: user.id },
    });
    const deleted = await http(app).post('/me/delete').set(auth(user)).send({ password: PASSWORD }).expect(200);
    expect(deleted.body).toEqual({ deleted: true });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { addresses: true } });
    expect(row).toMatchObject({ status: 'DELETED', firstName: 'Deleted', email: null, passwordHash: null, addresses: [] });
    await http(app).get('/me').set(auth(user)).expect(401);
    await http(app).post('/auth/login').send({ phone: user.phone, password: PASSWORD }).expect(401);
    // The phone number is free to sign up again.
    expect(await prisma.user.findUnique({ where: { phone: user.phone } })).toBeNull();
  });

  it('refuses to delete an account with money or errands outstanding', async () => {
    const user = await registerUser(app, 'CUSTOMER');
    await prisma.wallet.upsert({
      where: { type_userId: { type: 'CUSTOMER', userId: user.id } },
      update: {},
      create: { type: 'CUSTOMER', userId: user.id },
    });
    // Simulate a balance by moving money from the platform (the ledger stays balanced).
    const platform = await prisma.wallet.findFirstOrThrow({ where: { type: 'PLATFORM_REVENUE', userId: null } });
    await prisma.$transaction([
      prisma.wallet.update({ where: { type_userId: { type: 'CUSTOMER', userId: user.id } }, data: { balance: 150 } }),
      prisma.wallet.update({ where: { id: platform.id }, data: { balance: { decrement: 150 } } }),
    ]);
    const refused = await http(app).post('/me/delete').set(auth(user)).send({ password: PASSWORD }).expect(400);
    expect(refused.body.message).toBe('Withdraw the KES 150 in your customer wallet first');
    await prisma.$transaction([
      prisma.wallet.update({ where: { type_userId: { type: 'CUSTOMER', userId: user.id } }, data: { balance: 0 } }),
      prisma.wallet.update({ where: { id: platform.id }, data: { balance: { increment: 150 } } }),
    ]);
  });
});
