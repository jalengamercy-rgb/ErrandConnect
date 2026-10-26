import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter, requestId, requestLogger, securityHeaders } from './common/http.js';
import { RealtimeAdapter } from './realtime/realtime.adapter.js';

/** App-wide settings, shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication) {
  const production = process.env.NODE_ENV === 'production';
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // Behind a load balancer / reverse proxy, use the client's real IP (rate limits, sessions, risk rules).
  // TRUST_PROXY = number of proxies in front of the API, e.g. 1.
  if (process.env.TRUST_PROXY) express.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  express.use(requestId);
  express.use(securityHeaders(production));
  express.use(requestLogger);
  express.useBodyParser('json', { limit: '200kb' });

  app.useGlobalPipes(
    new ValidationPipe({
      // Reject unknown fields, and convert inputs (e.g. phone numbers, query numbers) to their declared types.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  // Browsers (the web build of the app, the admin panel) may call the API from
  // these origins. Native mobile apps aren't affected by CORS. Credentials are
  // allowed so the admin panel's refresh cookie is sent.
  const origins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const corsOrigin = origins?.length ? origins : !production;
  app.enableCors({ origin: corsOrigin, credentials: true, exposedHeaders: ['X-Request-Id'] });
  app.useWebSocketAdapter(new RealtimeAdapter(app, corsOrigin));
  app.enableShutdownHooks();
  return app;
}
