import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

// These tests start the real API against the database in DATABASE_URL.
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the database is up', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok', database: 'up' });
  });

  it('POST /pricing/quote returns a balanced price breakdown', async () => {
    const res = await request(app.getHttpServer())
      .post('/pricing/quote')
      .send({ errandFee: 2000, distanceKm: 2, deliveryType: 'MOTORCYCLE' })
      .expect(200);

    expect(res.body.customer.total).toBe(2250);
    expect(res.body.runner.total + res.body.platform.total).toBe(res.body.customer.total);
  });

  it('POST /pricing/quote rejects invalid input', () => {
    return request(app.getHttpServer())
      .post('/pricing/quote')
      .send({ errandFee: -5, distanceKm: 2, deliveryType: 'ROCKET' })
      .expect(400);
  });
});
