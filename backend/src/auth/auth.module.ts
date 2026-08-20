import { Module } from '@nestjs/common';
import { MailQueueModule } from '../queues/invite-emails/mail-queue.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationsModule } from '../invitations/invitations.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    // Registration is gated on an existing invitation, so AuthService needs it.
    InvitationsModule,
    // Recruiter registration creates the company workspace alongside the account.
    OrganisationsModule,
    TypeOrmModule.forFeature([PasswordResetToken]),
    // Producer only — the worker for this queue lives in InvitationsModule,
    // which is where it was when invites were all it carried.
    MailQueueModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
