import { INestApplication } from '@nestjs/common';
import { createTestApp, http } from './helpers.js';

describe('Public endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the database is up', () => {
    return http(app).get('/health').expect(200).expect({ status: 'ok', database: 'up' });
  });

  it('POST /pricing/quote returns a balanced price breakdown', async () => {
    const res = await http(app).post('/pricing/quote').send({ errandFee: 2000, distanceKm: 2, deliveryType: 'MOTORCYCLE' }).expect(200);

    expect(res.body.customer.total).toBe(2250);
    expect(res.body.runner.total + res.body.platform.total).toBe(res.body.customer.total);
  });

  it('POST /pricing/quote rejects invalid input', () => {
    return http(app).post('/pricing/quote').send({ errandFee: -5, distanceKm: 2, deliveryType: 'ROCKET' }).expect(400);
  });

  it('GET /categories lists errand types in order', async () => {
    const res = await http(app).get('/categories').expect(200);
    expect(res.body[0]).toEqual({ slug: 'grocery-shopping', name: 'Grocery Shopping', icon: null });
    expect(res.body).toHaveLength(15);
  });

  it('protected routes require login', () => {
    return http(app).get('/me').expect(401);
  });
});
