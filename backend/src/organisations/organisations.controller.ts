import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { OrganisationsService } from './organisations.service';

/**
 * The caller's own workspace. There is deliberately no route that takes an
 * organisation id — the scope always comes from `@CurrentOrg()`, so there is no
 * id for anyone to substitute.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Get('mine')
  mine(@CurrentOrg() organisationId: string) {
    return this.organisations.profile(organisationId);
  }

  /**
   * Sets the logo and accent candidates see.
   *
   * Admin and above: branding is how the company presents itself to people it
   * is assessing, which is a workspace-level decision rather than something an
   * individual hiring manager changes for their own round.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Patch('mine/branding')
  updateBranding(
    @Body() dto: UpdateBrandingDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.organisations.updateBranding(organisationId, dto);
  }
}
