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
  app.enableShutdownHooks();
  return app;
}
