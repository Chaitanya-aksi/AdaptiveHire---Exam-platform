import { IsEnum } from 'class-validator';
import { OrgRole } from '../../common/enums';

export class SetOrgRoleDto {
  /**
   * The role to move this colleague to.
   *
   * Not nullable: a recruiter with no workspace role is refused everywhere by
   * `OrgRolesGuard`, so "no role" is a broken account rather than a demotion.
   * Removing someone is a delete, not a role change.
   */
  @IsEnum(OrgRole)
  orgRole!: OrgRole;
}
