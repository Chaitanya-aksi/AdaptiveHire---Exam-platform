import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from './common/decorators/public.decorator';
import { REDIS_CLIENT } from './redis/redis.module';

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
      this.dataSource
        .query('SELECT 1')
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
      this.redis
        .ping()
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
    ]);

    return {
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
      postgres,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
