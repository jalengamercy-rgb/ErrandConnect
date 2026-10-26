import { INestApplication } from '@nestjs/common';
import { auth, createStaff, createTestApp, http, registerUser, TINY_PNG, type TestUser } from './helpers.js';

const NEXT_YEAR = `${new Date().getFullYear() + 1}-06-30`;

/** Every onboarding step for a motorcycle runner, with valid answers. */
async function completeOnboarding(app: INestApplication, runner: TestUser, plate: string) {
  const put = (path: string, body: object) => http(app).put(`/runners/me/onboarding/${path}`).set(auth(runner)).send(body).expect(200);
  const upload = (type: string) =>
    http(app).post('/documents').set(auth(runner)).field('type', type).attach('file', TINY_PNG, 'photo.png').expect(201);

  await put('personal', {
    dateOfBirth: '1995-04-12',
    gender: 'MALE',
    nationality: 'Kenyan',
    nationalIdNumber: '12345678',
    email: `${plate.toLowerCase()}@example.com`,
  });
  await put('service-area', {
    county: 'Nairobi',
    city: 'Nairobi',
    area: 'Kilimani',
    preferredAreas: ['Kilimani', 'CBD'],
    lat: -1.29,
    lng: 36.78,
  });
  await put('delivery-types', { deliveryTypes: ['MOTORCYCLE', 'WALKING'] });
  await http(app)
    .post('/runners/me/vehicles')
    .set(auth(runner))
    .send({
      type: 'MOTORCYCLE',
      make: 'Bajaj',
      model: 'Boxer',
      color: 'Red',
      registrationNumber: plate,
      year: 2022,
      licenceNumber: 'DL123456',
      licenceExpiry: NEXT_YEAR,
      insuranceNumber: 'INS-9988',
      insuranceExpiry: NEXT_YEAR,
    })
    .expect(201);
  for (const type of ['VEHICLE_PHOTO', 'NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'SELFIE', 'SELFIE_WITH_ID']) await upload(type);
  await put('identity', { kraPin: 'A123456789B' });
  await http(app)
    .put('/me/emergency-contact')
    .set(auth(runner))
    .send({ fullName: 'Mary Wanjiku', relationship: 'Sister', phone: '0722000111' })
    .expect(200);
  await put('payout', { type: 'MPESA', accountName: 'Test Runner', phone: runner.phone });
  await put('work-preferences', {
    availability: 'FULL_TIME',
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    workStartTime: '08:00',
    workEndTime: '18:00',
    maxDistanceKm: 10,
  });
  await put('services', { servicesOffered: ['grocery-shopping', 'parcel-delivery'] });
  await put('background', {
    hasCriminalRecord: false,
    canLiftHeavy: true,
    willingToHandleCash: true,
    agreeToIdVerification: true,
    agreeToBackgroundCheck: true,
  });
  return put('agreements', { terms: true, privacyPolicy: true, gpsTracking: true, commissionRates: true, infoIsTrue: true });
}

function randomPlate() {
  return `KM${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(100 + Math.random() * 900)}X`;
}

describe('Runner onboarding & admin review (e2e)', () => {
  let app: INestApplication;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await createStaff(app, 'RUNNER_MANAGER');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts at 7% (account security done at sign-up) and cannot submit', async () => {
    const runner = await registerUser(app, 'RUNNER');
    const res = await http(app).get('/runners/me/onboarding').set(auth(runner)).expect(200);
    expect(res.body.applicationStatus).toBe('DRAFT');
    expect(res.body.percentComplete).toBe(7);
    expect(res.body.steps).toHaveLength(15);
    expect(res.body.runnerCode).toMatch(/^EC-R-\d{7}$/);

    const submit = await http(app).post('/runners/me/onboarding/submit').set(auth(runner)).expect(400);
    expect(submit.body.missingRequired).toContain('identity');
  });

  it('validates step input', async () => {
    const runner = await registerUser(app, 'RUNNER');
    const put = (path: string, body: object) => http(app).put(`/runners/me/onboarding/${path}`).set(auth(runner)).send(body);

    // Under 18
    await put('personal', {
      dateOfBirth: '2015-01-01',
      gender: 'MALE',
      nationality: 'Kenyan',
      nationalIdNumber: '12345678',
      email: 'kid@example.com',
    }).expect(400);
    await put('services', { servicesOffered: ['teleportation'] }).expect(400);
    await put('payout', { type: 'BANK', accountName: 'Test' }).expect(400);
    await put('agreements', { terms: true, privacyPolicy: true, gpsTracking: false, commissionRates: true, infoIsTrue: true }).expect(400);
  });

  it('rejects uploads that are not images or PDFs', async () => {
    const runner = await registerUser(app, 'RUNNER');
    await http(app)
      .post('/documents')
      .set(auth(runner))
      .field('type', 'NATIONAL_ID_FRONT')
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'id.png', contentType: 'image/png' })
      .expect(400);
  });

  it('keeps documents private to their owner and staff', async () => {
    const runner = await registerUser(app, 'RUNNER');
    const doc = await http(app).post('/documents').set(auth(runner)).field('type', 'SELFIE').attach('file', TINY_PNG, 'me.png').expect(201);
    expect(doc.body).not.toHaveProperty('storageKey');

    await http(app).get(`/documents/${doc.body.id}/file`).set(auth(runner)).expect(200).expect('content-type', 'image/png');
    await http(app).get(`/documents/${doc.body.id}/file`).set(auth(admin)).expect(200);
    const stranger = await registerUser(app, 'CUSTOMER');
    await http(app).get(`/documents/${doc.body.id}/file`).set(auth(stranger)).expect(404);
  });

  it('runs the full journey: onboarding → submit → review → approve → go online', async () => {
    const runner = await registerUser(app, 'RUNNER');
    const plate = randomPlate();

    // Not approved yet, so can't go online.
    await http(app).put('/runners/me/online').set(auth(runner)).send({ online: true, lat: -1.29, lng: 36.78 }).expect(403);

    const progress = await completeOnboarding(app, runner, plate);
    expect(progress.body.percentComplete).toBe(80); // experience, equipment, skills skipped (optional)
    // Saved answers come back so the app can prefill forms; secrets never do.
    expect(progress.body.answers.profile.deliveryTypes).toEqual(['MOTORCYCLE', 'WALKING']);
    expect(progress.body.answers.payoutMethod.type).toBe('MPESA');
    expect(progress.body.answers.documents.SELFIE.status).toBe('PENDING');
    expect(progress.body.answers.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(progress.body)).not.toContain('storageKey');
    expect(progress.body.canSubmit).toBe(true);

    const submitted = await http(app).post('/runners/me/onboarding/submit').set(auth(runner)).expect(200);
    expect(submitted.body.applicationStatus).toBe('SUBMITTED');
    expect(submitted.body.tracker.find((t: { key: string }) => t.key === 'submitted').done).toBe(true);
    // Details are locked after submitting.
    await http(app)
      .put('/runners/me/onboarding/delivery-types')
      .set(auth(runner))
      .send({ deliveryTypes: ['CAR'] })
      .expect(403);

    // Customers and runners can't use admin routes.
    await http(app).get('/admin/runners').set(auth(runner)).expect(403);

    const list = await http(app).get('/admin/runners?status=SUBMITTED&pageSize=100').set(auth(admin)).expect(200);
    expect(list.body.items.some((r: { user: { id: string } }) => r.user.id === runner.id)).toBe(true);

    await http(app).post(`/admin/runners/${runner.id}/approve`).set(auth(admin)).expect(409);
    await http(app).post(`/admin/runners/${runner.id}/start-review`).set(auth(admin)).expect(200);

    // Identity can't pass until the ID documents are approved.
    await http(app).post(`/admin/runners/${runner.id}/checks`).set(auth(admin)).send({ check: 'IDENTITY', passed: true }).expect(400);
    const detail = await http(app).get(`/admin/runners/${runner.id}`).set(auth(admin)).expect(200);
    expect(detail.body).not.toHaveProperty('passwordHash');
    for (const doc of detail.body.documents) {
      await http(app).post(`/admin/documents/${doc.id}/review`).set(auth(admin)).send({ decision: 'APPROVED' }).expect(200);
    }

    // Approval needs every check.
    await http(app).post(`/admin/runners/${runner.id}/checks`).set(auth(admin)).send({ check: 'IDENTITY', passed: true }).expect(200);
    await http(app).post(`/admin/runners/${runner.id}/approve`).set(auth(admin)).expect(400);
    for (const check of ['VEHICLE', 'BACKGROUND', 'PAYOUT']) {
      await http(app).post(`/admin/runners/${runner.id}/checks`).set(auth(admin)).send({ check, passed: true }).expect(200);
    }
    const approved = await http(app).post(`/admin/runners/${runner.id}/approve`).set(auth(admin)).expect(200);
    expect(approved.body.runnerProfile.applicationStatus).toBe('APPROVED');
    expect(approved.body.progress.tracker.every((t: { done: boolean }) => t.done)).toBe(true);

    const online = await http(app).put('/runners/me/online').set(auth(runner)).send({ online: true, lat: -1.29, lng: 36.78 }).expect(200);
    expect(online.body.isOnline).toBe(true);
  });

  it('lets a rejected runner fix details and resubmit', async () => {
    const runner = await registerUser(app, 'RUNNER');
    await completeOnboarding(app, runner, randomPlate());
    await http(app).post('/runners/me/onboarding/submit').set(auth(runner)).expect(200);

    await http(app).post(`/admin/runners/${runner.id}/reject`).set(auth(admin)).send({ reason: 'ID photo is blurry' }).expect(200);
    const after = await http(app).get('/runners/me/onboarding').set(auth(runner)).expect(200);
    expect(after.body.applicationStatus).toBe('REJECTED');
    expect(after.body.rejectionReason).toBe('ID photo is blurry');

    await http(app).put('/runners/me/onboarding/identity').set(auth(runner)).send({}).expect(200);
    const resubmitted = await http(app).post('/runners/me/onboarding/submit').set(auth(runner)).expect(200);
    expect(resubmitted.body.applicationStatus).toBe('SUBMITTED');
    expect(resubmitted.body.rejectionReason).toBeNull();
  });

  it('prevents registering the same vehicle twice', async () => {
    const plate = randomPlate();
    const first = await registerUser(app, 'RUNNER');
    await completeOnboarding(app, first, plate);
    const second = await registerUser(app, 'RUNNER');
    await http(app)
      .post('/runners/me/vehicles')
      .set(auth(second))
      .send({
        type: 'MOTORCYCLE',
        make: 'TVS',
        model: 'HLX',
        color: 'Black',
        registrationNumber: plate,
        year: 2021,
        licenceNumber: 'DL654321',
        licenceExpiry: NEXT_YEAR,
        insuranceNumber: 'INS-1',
        insuranceExpiry: NEXT_YEAR,
      })
      .expect(409);
  });

  it('suspends a user, signs them out, and records it in the audit log', async () => {
    const opsManager = await createStaff(app, 'OPERATIONS_MANAGER');
    const user = await registerUser(app, 'CUSTOMER');

    // A runner manager may not suspend accounts.
    await http(app).post(`/admin/users/${user.id}/suspend`).set(auth(admin)).send({ reason: 'Fraud report' }).expect(403);
    await http(app).post(`/admin/users/${user.id}/suspend`).set(auth(opsManager)).send({ reason: 'Fraud report' }).expect(200);
    await http(app).get('/me').set(auth(user)).expect(401);

    const superAdmin = await createStaff(app, 'SUPER_ADMIN');
    const logs = await http(app).get(`/admin/audit-logs?entityType=user&entityId=${user.id}`).set(auth(superAdmin)).expect(200);
    expect(logs.body.items[0]).toMatchObject({ action: 'user.suspend', actorId: opsManager.id, metadata: { reason: 'Fraud report' } });

    await http(app).post(`/admin/users/${user.id}/activate`).set(auth(opsManager)).expect(200);
  });

  it('verifies a customer ID to reach level 3', async () => {
    const support = await createStaff(app, 'CUSTOMER_SUPPORT');
    const customer = await registerUser(app, 'CUSTOMER');
    await http(app).post(`/admin/customers/${customer.id}/verify-id`).set(auth(support)).expect(400);

    const doc = await http(app)
      .post('/documents')
      .set(auth(customer))
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(201);
    await http(app).post(`/admin/documents/${doc.body.id}/review`).set(auth(support)).send({ decision: 'APPROVED' }).expect(200);
    const verified = await http(app).post(`/admin/customers/${customer.id}/verify-id`).set(auth(support)).expect(200);
    expect(verified.body.customerProfile.verificationLevel).toBe(3);
  });
});
