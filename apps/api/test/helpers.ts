import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import type { StaffRole } from '../src/generated/prisma/client.js';
import { MessagingService } from '../src/notifications/messaging.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = setupApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());

/** A random, valid, unused-looking Kenyan mobile number in +254 form. */
export function randomPhone(): string {
  return `+2547${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

/** Reads the 6-digit code from the last SMS/email "sent" to an address. */
export function lastCodeSentTo(app: INestApplication, to: string): string {
  const message = app.get(MessagingService).lastMessageTo(to);
  const code = message?.body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No code was sent to ${to}`);
  return code;
}

export const PASSWORD = 'Secret123';

export interface TestUser {
  id: string;
  phone: string;
  accessToken: string;
  refreshToken: string;
}

/** Signs up through the real OTP + register endpoints. */
export async function registerUser(
  app: INestApplication,
  accountType: 'CUSTOMER' | 'RUNNER',
  overrides: Record<string, unknown> = {},
): Promise<TestUser> {
  const phone = randomPhone();
  await http(app).post('/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(200);
  const verify = await http(app)
    .post('/auth/otp/verify')
    .send({ phone, purpose: 'REGISTER', code: lastCodeSentTo(app, phone) })
    .expect(200);
  const res = await http(app)
    .post('/auth/register')
    .send({
      verificationToken: verify.body.verificationToken,
      accountType,
      firstName: 'Test',
      lastName: accountType === 'CUSTOMER' ? 'Customer' : 'Runner',
      password: PASSWORD,
      pin: '4821',
      acceptTerms: true,
      acceptPrivacy: true,
      ...overrides,
    })
    .expect(201);
  return { id: res.body.user.id, phone, accessToken: res.body.tokens.accessToken, refreshToken: res.body.tokens.refreshToken };
}

/** Creates a staff member by registering a user and granting a staff role directly in the database. */
export async function createStaff(app: INestApplication, role: StaffRole): Promise<TestUser> {
  const user = await registerUser(app, 'CUSTOMER');
  await app.get(PrismaService).staffProfile.create({ data: { userId: user.id, role } });
  return user;
}

export const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });

/** Smallest valid PNG (1x1 pixel), for document upload tests. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
