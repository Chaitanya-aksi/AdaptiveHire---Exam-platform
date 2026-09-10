import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { AssessmentsService } from './assessments.service';
import { PublicLinkService } from './public-link.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { PublicLinkSettingsDto } from './dto/public-link.dto';
import { SetCompanyDto } from './dto/set-company.dto';
import { SetQuestionPoolDto } from './dto/set-question-pool.dto';

/**
 * Assessment authoring is recruiter-only. Candidates never hit these routes —
 * they see the assessments they're invited to via GET /me/invitations.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly links: PublicLinkService,
  ) {}

  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Post()
  create(
    @Body() dto: CreateAssessmentDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessments.create(dto, organisationId, userId);
  }

  @Get()
  findAll(@CurrentOrg() organisationId: string) {
    return this.assessments.findAll(organisationId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.findOne(id, organisationId);
  }

  /**
   * Replaces which questions the engine may draw from.
   *
   * `PUT` rather than `PATCH` because the body is the whole intended set, not a
   * change to it. An empty list clears the pool, which means no restriction.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Put(':id/questions')
  setQuestionPool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetQuestionPoolDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.setQuestionPool(
      id,
      dto.questionIds,
      organisationId,
    );
  }

  /**
   * Sets which business in the group this round is for, or `null` for the
   * workspace itself.
   *
   * Hiring manager rather than admin, unlike creating the companies themselves:
   * choosing which of the group's businesses a round belongs to is ordinary
   * recruiting work, while deciding what those businesses are and how they look
   * is a workspace-level decision.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Patch(':id/company')
  setCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCompanyDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.setCompany(id, dto.companyId, organisationId);
  }

  /*
   * ── The public link ────────────────────────────────────────────────────
   *
   * A shareable URL that lets candidates reach this assessment without an
   * emailed invitation. The candidate-facing half is in `public-entry/`, which
   * is the only place on the platform that serves an unauthenticated route into
   * an assessment; these four are ordinary recruiter endpoints and scoped like
   * every other one here.
   *
   * Hiring manager throughout. Handing out a link is recruiting work, the same
   * as inviting somebody — and an admin-only gate would push a hiring manager
   * into asking someone else to run their own drive.
   */

  /** The link's current settings and state, or `configured: false`. */
  @Get(':id/public-link')
  publicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.links.view(id, organisationId);
  }

  /**
   * Mints a link, replacing any existing one.
   *
   * **The URL comes back exactly once.** Only its hash is stored, so a recruiter
   * who loses it has to mint another — the same bargain a password reset makes,
   * and for the same reason: a credential in the database is a credential in
   * every backup.
   *
   * That also makes this the way to revoke a link that has spread further than
   * intended: minting invalidates the previous one immediately.
   *
   * `POST` rather than `PUT` because it is not idempotent — calling it twice
   * gives two different links and kills the first.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Post(':id/public-link')
  rotatePublicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublicLinkSettingsDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.links.rotate(id, organisationId, dto);
  }

  /**
   * Changes the settings without touching the token, so a round can be closed
   * and reopened without reissuing a link a cohort already holds.
   *
   * `PATCH`, and the DTO distinguishes an omitted field from an explicit null:
   * absent leaves a setting alone, null clears it.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Patch(':id/public-link')
  updatePublicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublicLinkSettingsDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.links.update(id, organisationId, dto);
  }

  /**
   * Destroys the link. Attempts already made through it are untouched — the
   * recruiter is closing the door, not deleting the people who came through it.
   *
   * Distinct from `enabled: false`, which is reversible. This is not: there is
   * no stored token to switch back on afterwards.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Delete(':id/public-link')
  revokePublicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.links.revoke(id, organisationId);
  }

  /**
   * Deletes the assessment and every attempt made on it — answers, reports and
   * proctoring logs included. Candidate accounts survive; only their data for
   * this assessment goes.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.remove(id, organisationId);
  }
}
