import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AssessmentsModule } from './assessments/assessments.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { OrgRolesGuard } from './auth/guards/org-roles.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AuditLogEntry } from './common/audit/audit-log.entity';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { LoggingModule } from './common/logging/logging.module';
import { SessionContextInterceptor } from './common/logging/session-context.interceptor';
import { entities } from './database/entities';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { ModulesCatalogModule } from './modules-catalog/modules-catalog.module';
import { ProctoringModule } from './proctoring/proctoring.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { QueueErrorsModule } from './queues/queue-errors.module';
import { RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { SessionsModule } from './sessions/sessions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // First, so its error handling wraps everything below. A no-op unless
    // SENTRY_DSN is set — see `common/logging/sentry.ts`.
    SentryModule.forRoot(),
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      // Repo root first, so one .env drives both host and compose runs.
      envFilePath: ['../.env', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.getOrThrow<string>('database.host'),
        port: config.getOrThrow<number>('database.port'),
        username: config.getOrThrow<string>('database.username'),
        password: config.getOrThrow<string>('database.password'),
        database: config.getOrThrow<string>('database.database'),
        entities,
        // Schema changes go through migrations, always.
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    // Registered at the root because the audit interceptor is global — it has
    // no module of its own to hang the repository off.
    TypeOrmModule.forFeature([AuditLogEntry]),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('throttle.ttlSeconds') * 1000,
            limit: config.getOrThrow<number>('throttle.limit'),
          },
        ],
      }),
    }),
    // The Redis instance every queue runs on — invite-emails, auto-submit and
    // report generation. These are connection *options*, so BullMQ builds its
    // own clients from them rather than sharing the one in `RedisModule`: a
    // worker blocks on its connection waiting for jobs, and blocking the
    // application's client would stall every session read behind it.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('redis.host'),
          port: config.getOrThrow<number>('redis.port'),
        },
      }),
    }),
    RedisModule,
    // After the queues are registered: it discovers them on bootstrap and
    // gives each one the error handling BullMQ does not attach itself.
    QueueErrorsModule,
    MailModule,
    UsersModule,
    AuthModule,
    ModulesCatalogModule,
    QuestionBankModule,
    AssessmentsModule,
    InvitationsModule,
    SessionsModule,
    ProctoringModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: authenticate, then check the role, then rate-limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // After RolesGuard: which audience may reach the route is settled first,
    // then what this member of the workspace may do with it.
    { provide: APP_GUARD, useClass: OrgRolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Both run after the guards, so `req.user` is populated and each can name
    // who was acting.
    { provide: APP_INTERCEPTOR, useClass: SessionContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
