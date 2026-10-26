import { INestApplication, ValidationPipe } from '@nestjs/common';

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
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : process.env.NODE_ENV !== 'production' });
  app.enableShutdownHooks();
  return app;
}
