import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { SessionState } from './session-state';

/** Kept around after the deadline so a candidate who submits late still gets
 * a coherent answer instead of "session not found". */
const GRACE_SECONDS = 6 * 60 * 60;

/**
 * The only thing that reads or writes live session state. Two kinds of key:
 *
 * - `session:{id}` — the JSON state blob.
 * - `session:{id}:module:{moduleId}:clock` — an empty key whose TTL *is* the
 *   module timer. The remaining time a candidate sees comes from PTTL on this
 *   key, so the countdown is the server's, not a client `setInterval`.
 */
@Injectable()
export class RedisSessionService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(sessionId: string): Promise<SessionState | null> {
    const raw = await this.redis.get(this.stateKey(sessionId));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  }

  /** Writes the state and (re)sets its expiry to the session deadline + grace. */
  async save(state: SessionState): Promise<void> {
    const ttlSeconds =
      Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)) +
      GRACE_SECONDS;

    await this.redis.set(
      this.stateKey(state.sessionId),
      JSON.stringify(state),
      'EX',
      ttlSeconds,
    );
  }

  /** Starts a module's clock. The TTL is the timer. */
  async startModuleClock(
    sessionId: string,
    moduleId: string,
    seconds: number,
  ): Promise<void> {
    await this.redis.set(
      this.clockKey(sessionId, moduleId),
      '1',
      'EX',
      Math.max(1, Math.ceil(seconds)),
    );
  }

  /**
   * Milliseconds left on a module's clock, or null when the key is gone.
   *
   * Null is ambiguous by design — it means "expired, or Redis lost the key" —
   * so callers cross-check it against the module's stored `deadlineAt` rather
   * than treating a missing key as proof the time ran out.
   */
  async moduleRemainingMs(
    sessionId: string,
    moduleId: string,
  ): Promise<number | null> {
    const ttl = await this.redis.pttl(this.clockKey(sessionId, moduleId));
    // -2: no such key. -1: key exists with no expiry (shouldn't happen here).
    return ttl >= 0 ? ttl : null;
  }

  async clearModuleClock(sessionId: string, moduleId: string): Promise<void> {
    await this.redis.del(this.clockKey(sessionId, moduleId));
  }

  /** Called on finalisation — the state blob is no longer authoritative. */
  async drop(sessionId: string, moduleIds: string[]): Promise<void> {
    await this.redis.del(
      this.stateKey(sessionId),
      ...moduleIds.map((moduleId) => this.clockKey(sessionId, moduleId)),
    );
  }

  private stateKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private clockKey(sessionId: string, moduleId: string): string {
    return `session:${sessionId}:module:${moduleId}:clock`;
  }
}
