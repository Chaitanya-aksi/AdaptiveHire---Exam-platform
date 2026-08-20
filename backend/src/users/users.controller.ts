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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SetOrgRoleDto } from './dto/set-org-role.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

/**
 * Two groups of endpoints, deliberately in one controller.
 *
 * `me/*` is open to both roles and always scopes to the caller's own id, so one
 * user can never read or edit another's account through it.
 *
 * The directory routes carry `@Roles(RECRUITER_ADMIN)` individually — not at
 * class level, which would lock candidates out of their own profile.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.users.getProfile(userId);
  }

  /** Directory listing. Never exposes password or refresh-token columns. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Get()
  list(@Query() query: QueryUsersDto, @CurrentOrg() organisationId: string) {
    return this.users.list(query, organisationId);
  }

  /**
   * Provisions an account and returns its one-time password in the response.
   * That password is shown to the creating recruiter once and is never
   * retrievable again — only a hash is stored.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentOrg() organisationId: string) {
    // The organisation comes from the creating recruiter, never the payload — a
    // client-supplied one would let anybody add a member to another company.
    return this.users.createByAdmin({ ...dto, organisationId });
  }

  /**
   * Deletes someone and everything this organisation holds about them.
   *
   * Scoped to the caller's organisation throughout: a candidate's attempts,
   * reports and invitations are deleted only where the assessment belongs to
   * this company. The account itself goes too unless another organisation has
   * also invited them — one customer must not be able to erase another's
   * records. The response reports what was destroyed and whether the login
   * survived, rather than leaving the client to guess.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') actingUserId: string,
  ) {
    return this.users.deletePerson(id, organisationId, actingUserId);
  }

  /**
   * Changes what a colleague may do.
   *
   * Admin and above, because it is how a workspace is actually run — but the
   * service refuses to grant or remove Owner unless the caller is one, so
   * `MinOrgRole` here is the floor, not the whole rule.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id/org-role')
  setOrgRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrgRoleDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') actingUserId: string,
  ) {
    return this.users.setOrgRole(id, dto.orgRole, organisationId, actingUserId);
  }

  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateName(userId, dto.fullName);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
