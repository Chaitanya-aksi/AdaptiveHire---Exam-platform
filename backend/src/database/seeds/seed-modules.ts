import { ScoringType } from '../../common/enums';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import dataSource from '../data-source';

/**
 * The starting subject catalogue. Modules are reference data — adding more
 * later is an INSERT, not a code change.
 *
 * The trait module keeps Big Five keys as the engine-facing identifiers
 * (stable, conventional, what every question option weights against) and
 * carries workplace-facing labels for the report layer alongside them.
 */
export const SEED_MODULES = [
  {
    name: 'Aptitude',
    slug: 'aptitude',
    description:
      'Numerical reasoning, arithmetic and data interpretation under time pressure.',
    scoringType: ScoringType.OBJECTIVE,
    traits: null,
  },
  {
    name: 'Logical Reasoning',
    slug: 'logical-reasoning',
    description:
      'Pattern recognition, sequences, syllogisms and deductive reasoning.',
    scoringType: ScoringType.OBJECTIVE,
    traits: null,
  },
  {
    name: 'Verbal Ability',
    slug: 'verbal-ability',
    description:
      'Reading comprehension, vocabulary, grammar and sentence correction.',
    scoringType: ScoringType.OBJECTIVE,
    traits: null,
  },
  {
    name: 'Personality',
    slug: 'personality',
    description:
      'Workplace behavioural profile measured through situational, forced-choice, trade-off and ranking questions.',
    scoringType: ScoringType.TRAIT,
    // Workplace-facing traits rather than Big Five factors: the report has to
    // speak about Leadership, Ownership and Integrity, none of which the Big
    // Five expresses. Every one is stated positively, so no trait needs
    // inverting for the report.
    traits: [
      { key: 'leadership', label: 'Leadership' },
      { key: 'ownership', label: 'Ownership' },
      { key: 'accountability', label: 'Accountability' },
      { key: 'teamwork', label: 'Teamwork' },
      { key: 'communication', label: 'Communication' },
      { key: 'empathy', label: 'Empathy' },
      { key: 'integrity', label: 'Integrity' },
      { key: 'adaptability', label: 'Adaptability' },
      { key: 'resilience', label: 'Resilience' },
      { key: 'risk_tolerance', label: 'Risk Tolerance' },
    ],
  },
];

async function run(): Promise<void> {
  await dataSource.initialize();
  const modules = dataSource.getRepository(ModuleCatalogEntry);

  for (const seed of SEED_MODULES) {
    const existing = await modules.findOne({ where: { slug: seed.slug } });
    if (existing) {
      console.log(`· ${seed.slug} already exists — skipped`);
      continue;
    }
    await modules.save(modules.create(seed));
    const detail =
      seed.scoringType === ScoringType.TRAIT
        ? `${seed.traits?.length ?? 0} traits`
        : 'Elo-scored';
    console.log(
      `✓ ${seed.slug.padEnd(18)} ${seed.scoringType.padEnd(10)} ${detail}`,
    );
  }

  await dataSource.destroy();
}

run().catch((error) => {
  console.error('Module seeding failed:', error);
  process.exit(1);
});
