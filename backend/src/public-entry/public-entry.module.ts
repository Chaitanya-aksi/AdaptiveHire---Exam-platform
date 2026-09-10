import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { UsersModule } from '../users/users.module';
import { PublicEntryController } from './public-entry.controller';
import { PublicEntryService } from './public-entry.service';

/**
 * A leaf: it imports four modules and nothing imports it.
 *
 * That is what keeps the wiring honest. `AuthModule` already depends on
 * `InvitationsModule` (registration is invite-gated) and `InvitationsModule` on
 * `AssessmentsModule`, so anything reaching back the other way would close a
 * cycle. Composing the flow in a module nobody depends on avoids the question
 * entirely — and is why `PublicLinkService` takes the invitation *repository*
 * rather than `InvitationsService`.
 */
@Module({
  imports: [
    // PublicLinkService: resolving a token to an assessment and judging whether
    // the link is open.
    AssessmentsModule,
    // Writing the self-registered invitation that the runtime then hangs a
    // session off.
    InvitationsModule,
    // Looking up whether an address already has an account — the only thing
    // that decides which of the two auth calls is made.
    UsersModule,
    // AuthService for register/login and SessionCookieService for the cookie.
    // Both are borrowed whole; no session is minted anywhere in this module.
    AuthModule,
  ],
  controllers: [PublicEntryController],
  providers: [PublicEntryService],
})
export class PublicEntryModule {}
