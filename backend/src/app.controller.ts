import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from './common/decorators/public.decorator';
import { REDIS_CLIENT } from './redis/redis.module';

/**
 * How long a dependency gets to answer before it is reported as down.
 *
 * Both probes are a single round trip to something on the same host or the same
 * network, so anything past a second is already a fault — and reporting the
 * fault is the entire job of this endpoint.
 */
const PROBE_TIMEOUT_MS = 1500;

@Controller()
export class AppController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Used to confirm the compose stack is wired end to end. */
  @Public()
  @Get('health')
  async health() {
    const [postgres, redis] = await Promise.all([
      probe(() => this.dataSource.query('SELECT 1')),
      probe(() => this.redis.ping()),
    ]);

    return {
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
      postgres,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Runs one dependency check, and treats "no answer" as an answer.
 *
 * The timeout is not belt-and-braces; without it this endpoint cannot do its
 * job. The shared client sets `maxRetriesPerRequest: null` — which BullMQ
 * requires — and that makes a command issued while Redis is unreachable sit in
 * the offline queue *indefinitely* rather than reject. A `ping` awaited with no
 * deadline therefore does not report Redis as down; it hangs, and takes the
 * whole response with it. Measured at 104 seconds during a real outage, on the
 * one endpoint whose purpose is to say "degraded" straight away — and a health
 * check that hangs reads to whatever is polling it as a dead process rather
 * than a degraded one, which is a worse and less actionable answer than the
 * truth.
 *
 * `Promise.race` leaves the original call running; that is intended and
 * harmless. It settles or it does not, nothing is chained onto it, and its
 * rejection is swallowed here so a late failure cannot surface as an unhandled
 * rejection minutes after the response went out.
 */
async function probe(run: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<'down'>((resolve) => {
    timer = setTimeout(() => resolve('down'), PROBE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      run().then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      deadline,
    ]);
  } finally {
    // Otherwise the pending timer holds the event loop open for its full
    // duration on every healthy request.
    if (timer) clearTimeout(timer);
  }
}
