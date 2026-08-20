import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '../enums';

export const ORG_ROLES_KEY = 'orgRoles';

/**
 * The minimum workspace role a route needs. Enforced by `OrgRolesGuard`.
 *
 * A floor rather than a list, because permissions here are a ladder: anything
 * an Admin may do, an Owner may do. Listing roles explicitly would mean every
 * new role had to be added to every route that should already include it, and
 * the failure mode of forgetting is silent — somebody simply cannot use a page
 * and nobody knows why.
 *
 * Composes with `@Roles()` rather than replacing it: that one decides which
 * side of the platform may reach the route at all, this one decides what a
 * recruiter may do once inside.
 */
export const MinOrgRole = (role: OrgRole) => SetMetadata(ORG_ROLES_KEY, role);
