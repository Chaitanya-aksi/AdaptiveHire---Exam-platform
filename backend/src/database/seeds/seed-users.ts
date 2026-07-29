import * as argon2 from 'argon2';
import { UserRole } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import dataSource from '../data-source';

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

  for (const seed of SEED_USERS) {
    const existing = await users.findOne({ where: { email: seed.email } });
    if (existing) {
      console.log(`· ${seed.email} already exists — skipped`);
      continue;
    }
    await users.save(
      users.create({ ...seed, passwordHash: await argon2.hash(password) }),
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
