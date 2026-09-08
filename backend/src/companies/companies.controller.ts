import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/upsert-company.dto';

/**
 * The businesses inside one workspace.
 *
 * Every route takes its scope from `@CurrentOrg()` and none of them accepts an
 * organisation id, so there is nothing here for a caller to substitute. A
 * company belonging to another workspace answers 404 rather than 403 — a 403
 * would confirm the id exists, and one customer's group structure is not
 * another's to enumerate.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /**
   * The workspace's companies.
   *
   * `?active=true` is what the assessment form asks for — a retired business
   * must not be offered for new work. The settings screen omits it, because it
   * has to show a retired company in order to bring it back.
   *
   * Readable by any member, unlike the writes below: choosing which company a
   * round is for is ordinary recruiting work, so a hiring manager needs the
   * list even though they may not edit it.
   */
  @Get()
  list(
    @CurrentOrg() organisationId: string,
    @Query('active') active?: string,
  ) {
    return active === 'true'
      ? this.companies.activeFor(organisationId)
      : this.companies.listFor(organisationId);
  }

  /**
   * Admin and above for every write, matching workspace branding.
   *
   * Which businesses exist and what their logos are is how the whole company
   * presents itself to people it assesses — a workspace-level decision, not
   * something an individual hiring manager changes for their own round. What
   * they *can* do is pick from the list when creating an assessment.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentOrg() organisationId: string) {
    return this.companies.create(organisationId, dto);
  }

  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.companies.update(id, organisationId, dto);
  }

  /**
   * Deletes a company. Assessments naming it fall back to the organisation's
   * own branding rather than being deleted with it.
   *
   * Prefer retiring (`PATCH` with `isActive: false`) for a business that has
   * stopped hiring: that keeps finished attempts naming the company the
   * candidate actually applied to, which deleting does not.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    await this.companies.remove(id, organisationId);
  }
}
