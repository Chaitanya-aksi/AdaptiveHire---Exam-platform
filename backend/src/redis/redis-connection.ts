import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * The one place Redis connection details are assembled.
 *
 * The application's own client (`redis.module.ts`) and every BullMQ connection
 * (`app.module.ts`) are both built from this, so a provider's auth and TLS
 * requirements cannot be satisfied for one and missed for the other. That split
 * is worth avoiding specifically: it surfaces as "BullMQ cannot connect" long
 * after the app itself reports healthy, because the app client is the one the
 * health check exercises.
 *
 * `REDIS_URL` wins when set. The discrete `REDIS_HOST`/`REDIS_PORT` pair stays
 * the path for docker compose, which needs neither credentials nor TLS.
 */
export function redisConnectionOptions(config: ConfigService): RedisOptions {
  const url = config.get<string>('redis.url')?.trim();

  // BullMQ requires `maxRetriesPerRequest: null` of its connections. The app
  // client takes it too, so both behave the same way when Redis goes away
  // mid-request rather than one erroring while the other retries.
  if (!url) {
    return {
      host: config.getOrThrow<string>('redis.host'),
      port: config.getOrThrow<number>('redis.port'),
      maxRetriesPerRequest: null,
    };
  }

  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    // Both arrive percent-encoded; managed providers issue passwords that
    // routinely contain characters requiring it.
    username: decodeURIComponent(parsed.username) || undefined,
    password: decodeURIComponent(parsed.password) || undefined,
    // `rediss://` is the managed-provider convention for "TLS required".
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/** host:port for logs and error messages — never the credentials. */
export function describeRedisTarget(options: RedisOptions): string {
  return `${options.host ?? 'localhost'}:${options.port ?? 6379}`;
}
