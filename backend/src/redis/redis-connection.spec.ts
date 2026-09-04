import type { ConfigService } from '@nestjs/config';
import {
  describeRedisTarget,
  redisConnectionOptions,
} from './redis-connection';

/**
 * The application client and BullMQ both build their connections from this, so
 * a mistake here reaches production as "BullMQ cannot connect" well after the
 * app's own health check reports green.
 */
describe('redisConnectionOptions', () => {
  const config = (map: Record<string, unknown>) =>
    ({
      get: (key: string) => map[key],
      getOrThrow: (key: string) => {
        if (map[key] === undefined) throw new Error(`missing ${key}`);
        return map[key];
      },
    }) as unknown as ConfigService;

  describe('with a managed provider URL', () => {
    const options = redisConnectionOptions(
      config({ 'redis.url': 'rediss://user:p%40ss@redis.example.com:28000' }),
    );

    it('takes host and port from the URL', () => {
      expect(options.host).toBe('redis.example.com');
      expect(options.port).toBe(28000);
    });

    // Managed providers issue passwords containing characters that must be
    // percent-encoded in a URL; handing the encoded form to ioredis fails auth.
    it('percent-decodes the credentials', () => {
      expect(options.username).toBe('user');
      expect(options.password).toBe('p@ss');
    });

    it('enables TLS for rediss://', () => {
      expect(options.tls).toBeDefined();
    });

    it('leaves TLS off for plain redis://', () => {
      expect(
        redisConnectionOptions(config({ 'redis.url': 'redis://h:6380' })).tls,
      ).toBeUndefined();
    });
  });

  describe('without a URL', () => {
    const options = redisConnectionOptions(
      config({
        'redis.url': '',
        'redis.host': 'localhost',
        'redis.port': 6379,
      }),
    );

    it('falls back to the discrete host and port', () => {
      expect(options.host).toBe('localhost');
      expect(options.port).toBe(6379);
    });

    it('sends no credentials and no TLS to a compose Redis', () => {
      expect(options.password).toBeUndefined();
      expect(options.tls).toBeUndefined();
    });
  });

  // BullMQ requires this of its connections; the app client matches it so both
  // behave the same way when Redis goes away mid-request.
  it.each([
    ['a URL', { 'redis.url': 'rediss://h:1' }],
    ['host and port', { 'redis.url': '', 'redis.host': 'h', 'redis.port': 1 }],
  ])('sets maxRetriesPerRequest to null given %s', (_label, map) => {
    expect(redisConnectionOptions(config(map)).maxRetriesPerRequest).toBeNull();
  });

  it('describes the target without leaking the password', () => {
    const described = describeRedisTarget(
      redisConnectionOptions(
        config({ 'redis.url': 'rediss://user:hunter2@h.example.com:28000' }),
      ),
    );
    expect(described).toBe('h.example.com:28000');
    expect(described).not.toContain('hunter2');
  });
});
