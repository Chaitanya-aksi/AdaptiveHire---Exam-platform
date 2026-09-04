// Must be first: the Sentry SDK patches the modules it instruments as they are
// loaded, so anything imported above it would be missed.
import { initSentry } from './common/logging/sentry';
const sentryEnabled = initSentry();

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Holds start-up logs until the pino logger is attached below, so the first
    // few lines of every boot are not in a different format from the rest.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  // A hosting platform terminates TLS in front of the app and forwards the real
  // client address in `X-Forwarded-For`. Without this the throttler reads the
  // proxy's address for every request, so one shared bucket rate-limits the
  // whole room and candidates starting together 429 each other.
  //
  // `1`, not `true`: trusting every hop lets a client prepend its own
  // `X-Forwarded-For` and opt out of the rate limit entirely.
  if (config.get<boolean>('trustProxy')) {
    app.set('trust proxy', 1);
    logger.log('Trusting one proxy hop for the client address');
  }

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());

  // credentials:true is required for the httpOnly refresh cookie to travel.
  app.enableCors({
    origin: config.getOrThrow<string[]>('corsOrigins'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');

  logger.log(`AdaptiveHire API listening on http://localhost:${port}/api`);
  // ASCII only: a Windows console renders the em-dash this line used to carry
  // as mojibake, so the very first thing you see looks like a broken build.
  logger.log(
    sentryEnabled
      ? 'Error tracking is on (SENTRY_DSN is set)'
      : 'Error tracking is off. Set SENTRY_DSN to enable it.',
  );
}

void bootstrap();
