import { AssessmentModule } from '../../assessments/entities/assessment-module.entity';
import { Assessment } from '../../assessments/entities/assessment.entity';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { UserRole } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import dataSource from '../data-source';

/**
 * One live assessment so the invite flow has a real target to point at during
 * development. Depends on seed-modules having run first (it references modules
 * by slug). Run order is enforced by the `seed` script in package.json.
 */
const SEED_TITLE = 'Graduate Aptitude & Personality Screen';

const MODULE_CONFIG: Record<
  string,
  { minQuestions: number; maxQuestions: number; timeLimitSeconds: number }
> = {
  aptitude: { minQuestions: 5, maxQuestions: 12, timeLimitSeconds: 600 },
  'logical-reasoning': {
    minQuestions: 5,
    maxQuestions: 12,
    timeLimitSeconds: 600,
  },
  personality: { minQuestions: 8, maxQuestions: 15, timeLimitSeconds: 480 },
};

async function run(): Promise<void> {
  await dataSource.initialize();
  const assessments = dataSource.getRepository(Assessment);
  const modules = dataSource.getRepository(ModuleCatalogEntry);

  // Assessments are owned by a company, so the seed needs one to hang this on.
  // The seeded recruiter's workspace is the right home for it.
  const recruiter = await dataSource.getRepository(User).findOne({
    where: { role: UserRole.RECRUITER_ADMIN },
    order: { createdAt: 'ASC' },
  });
  if (!recruiter?.organisationId) {
    console.error(
      'No recruiter with an organisation found — run `npm run seed:users` first.',
    );
    await dataSource.destroy();
    process.exit(1);
  }

  const existing = await assessments.findOne({ where: { title: SEED_TITLE } });
  if (existing) {
    console.log(`· "${SEED_TITLE}" already exists — skipped`);
    await dataSource.destroy();
    return;
  }

  const assessmentModules: AssessmentModule[] = [];
  let order = 0;
  for (const [slug, config] of Object.entries(MODULE_CONFIG)) {
    const module = await modules.findOne({ where: { slug } });
    if (!module) {
      console.warn(`! module "${slug}" not found — run seed:modules first`);
      continue;
    }
    assessmentModules.push(
      Object.assign(new AssessmentModule(), {
        moduleId: module.id,
        minQuestions: config.minQuestions,
        maxQuestions: config.maxQuestions,
        timeLimitSeconds: config.timeLimitSeconds,
        displayOrder: order++,
      }),
    );
  }

  if (assessmentModules.length === 0) {
    console.error('No modules resolved — seed the module catalogue first.');
    await dataSource.destroy();
    process.exit(1);
  }

  const assessment = assessments.create({
    title: SEED_TITLE,
    organisationId: recruiter.organisationId,
    createdById: recruiter.id,
    description:
      'Sample assessment for development and testing — aptitude, logical reasoning and a personality profile.',
    modules: assessmentModules,
  });
  const saved = await assessments.save(assessment);

  console.log(
    `✓ Created "${SEED_TITLE}" (${saved.id}) with ${assessmentModules.length} modules`,
  );

  await dataSource.destroy();
}

run().catch((error) => {
  console.error('Assessment seeding failed:', error);
  process.exit(1);
});
