import * as argon2 from 'argon2';
import { OrgRole, UserRole } from '../../common/enums';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { User } from '../../users/entities/user.entity';
import dataSource from '../data-source';

/**
 * The workspace the seeded recruiter works in.
 *
 * Recruiters need one: every recruiter-facing endpoint reads its scope from the
 * account's organisation and refuses an account without one, so a seeded
 * recruiter with no organisation could log in and do nothing at all.
 */
const SEED_ORGANISATION = { name: 'AdaptiveHire', slug: 'adaptivehire' };

/**
 * Seeds the accounts needed to exercise role-based access. Self-service
 * registration only ever creates candidates, so the first recruiter_admin has
 * to come from here.
 *
 * Idempotent — re-running leaves existing accounts untouched.
 */
const SEED_USERS = [
  {
    email: 'recruiter@adaptivehire.local',
    fullName: 'Seed Recruiter Admin',
    role: UserRole.RECRUITER_ADMIN,
  },
  {
    email: 'candidate@adaptivehire.local',
    fullName: 'Seed Candidate',
    role: UserRole.CANDIDATE,
  },
];

async function run(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2345';

  await dataSource.initialize();
  const users = dataSource.getRepository(User);
  const organisations = dataSource.getRepository(Organisation);

  // Reuse the organisation the tenancy migration created, if it is still there,
  // so re-seeding does not leave two workspaces with the same name.
  const organisation =
    (await organisations.findOne({
      where: { slug: SEED_ORGANISATION.slug },
    })) ?? (await organisations.save(organisations.create(SEED_ORGANISATION)));

  for (const seed of SEED_USERS) {
    const existing = await users.findOne({ where: { email: seed.email } });
    if (existing) {
      // One repair, not a general update: a recruiter seeded before org roles
      // existed has a null `orgRole`, and null is refused rather than assumed,
      // so that account 403s on every guarded endpoint. Only nulls are filled
      // — a recruiter deliberately set to `viewer` stays a viewer.
      if (
        existing.role === UserRole.RECRUITER_ADMIN &&
        existing.orgRole === null
      ) {
        existing.orgRole = OrgRole.OWNER;
        await users.save(existing);
        console.log(`↺ ${seed.email} had no org role — set to owner`);
        continue;
      }

      console.log(`· ${seed.email} already exists — skipped`);
      continue;
    }
    await users.save(
      users.create({
        ...seed,
        passwordHash: await argon2.hash(password),
        // Candidates belong to no company; only the recruiter gets the workspace.
        organisationId:
          seed.role === UserRole.RECRUITER_ADMIN ? organisation.id : null,
        // Owner, matching what self-registration grants the person who creates
        // a workspace. `orgRole` is nullable so a missing value is refused
        // rather than assumed, which means leaving it unset here does not
        // produce a limited recruiter — it produces one that 403s on every
        // guarded endpoint, and a seeded account that cannot do anything is
        // not a seed.
        orgRole: seed.role === UserRole.RECRUITER_ADMIN ? OrgRole.OWNER : null,
      }),
    );
    console.log(`✓ created ${seed.role.padEnd(15)} ${seed.email}`);
  }

  console.log(`\nSeed password: ${password}  (override with SEED_PASSWORD)`);
  await dataSource.destroy();
}

run().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
