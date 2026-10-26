import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // One JSON object per line in production, for log collectors (Cloud Logging, Loki, Datadog...).
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', colors: process.env.NODE_ENV !== 'production' }),
    bodyParser: false,
  });
  setupApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
