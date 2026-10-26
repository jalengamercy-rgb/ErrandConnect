import { INestApplication, ValidationPipe } from '@nestjs/common';
import { RealtimeAdapter } from './realtime/realtime.adapter.js';

/** App-wide settings, shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      // Reject unknown fields, and convert inputs (e.g. phone numbers, query numbers) to their declared types.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Browsers (the web build of the app, the admin panel) may call the API from
  // these origins. Native mobile apps aren't affected by CORS.
  const origins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const corsOrigin = origins?.length ? origins : process.env.NODE_ENV !== 'production';
  app.enableCors({ origin: corsOrigin });
  app.useWebSocketAdapter(new RealtimeAdapter(app, corsOrigin));
  app.enableShutdownHooks();
  return app;
}
