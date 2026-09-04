import { Controller, Get } from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { ProctoringService } from './proctoring.service';

/**
 * The read side of proctoring. Events are written over the WebSocket gateway by
 * the candidate's own browser; this is where a recruiter reads them back.
 *
 * Recruiter-only, like reports. A candidate never sees their own signal counts —
 * telling somebody mid-hiring-process how many times their face left frame is
 * neither actionable nor kind, and it would also describe the detector precisely
 * enough to work around.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('proctoring')
export class ProctoringController {
  constructor(private readonly proctoring: ProctoringService) {}

  /**
   * Every signal the platform watches for, with this organisation's counts.
   *
   * The catalogue rather than one candidate's timeline: a recruiter reading a
   * report needs to know what a signal means and what it cannot mean before the
   * count in front of them is worth anything. Per-attempt detail already lives
   * on the report page.
   */
  @Get('signals')
  signals(@CurrentOrg() organisationId: string) {
    return this.proctoring.signalsForOrganisation(organisationId);
  }
}
