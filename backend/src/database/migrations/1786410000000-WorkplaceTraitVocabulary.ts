import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Swaps the Personality module from Big Five keys to a workplace behavioural
 * vocabulary, and rewrites the legacy Likert questions onto it.
 *
 * The Big Five keys were psychometrically conventional but could not express
 * what the behavioural engine reports on — there is no Big Five factor for
 * Leadership, Integrity or Ownership. Traits are jsonb reference data, so the
 * catalogue change is an UPDATE; the questions have to follow, or their
 * weights would reference keys the module no longer declares and the engine
 * would tally them into nothing.
 *
 * The mapping fans one source key out to the traits it genuinely evidences,
 * and no further. Two candidate mappings were rejected as unearned:
 * extraversion -> leadership (sociability is not leadership) and
 * neuroticism -> risk tolerance (anxiety is not caution). Leadership,
 * Integrity and Risk Tolerance therefore start with no legacy coverage and are
 * measured purely by behavioural questions, which is the point of the engine.
 *
 * Only questions with a null pattern are rewritten — those are the legacy
 * items. Anything authored against the four behavioural patterns already uses
 * this vocabulary and must not be touched.
 */

interface TraitDefinition {
  key: string;
  label: string;
}

/** The reported behavioural profile, in report display order. */
const WORKPLACE_TRAITS: TraitDefinition[] = [
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
];

/** What the module declared before this migration. */
const BIG_FIVE_TRAITS = [
  { key: 'openness', label: 'Adaptability & Learning' },
  { key: 'conscientiousness', label: 'Reliability & Follow-Through' },
  { key: 'extraversion', label: 'Communication & Initiative' },
  { key: 'agreeableness', label: 'Teamwork & Cooperation' },
  {
    key: 'neuroticism',
    label: 'Resilience Under Pressure',
    invertForReport: true,
  },
];

/** Big Five key -> [workplace key, multiplier]. -1 flips the pole. */
const FORWARD: Record<string, [string, number][]> = {
  openness: [['adaptability', 1]],
  conscientiousness: [
    ['accountability', 1],
    ['ownership', 1],
  ],
  agreeableness: [
    ['teamwork', 1],
    ['empathy', 1],
  ],
  extraversion: [['communication', 1]],
  // High neuroticism is anxiety and rumination, so it reads as LOW resilience.
  neuroticism: [['resilience', -1]],
};

/**
 * Exact inverse. Where a source fanned out to two traits both carry the same
 * value, so reading either one back recovers the original weight precisely —
 * which is why `down()` is lossless rather than best-effort.
 */
const REVERSE: Record<string, [string, number]> = {
  adaptability: ['openness', 1],
  accountability: ['conscientiousness', 1],
  teamwork: ['agreeableness', 1],
  communication: ['extraversion', 1],
  resilience: ['neuroticism', -1],
};

interface OptionRow {
  key: string;
  text: string;
  traitWeights: Record<string, number>;
  behavior?: string;
}

function remap(
  weights: Record<string, number>,
  table: Record<string, [string, number][]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    for (const [target, multiplier] of table[key] ?? []) {
      out[target] = (out[target] ?? 0) + weight * multiplier;
    }
  }
  return out;
}

async function rewriteLegacyOptions(
  queryRunner: QueryRunner,
  table: Record<string, [string, number][]>,
): Promise<void> {
  const rows = await queryRunner.query(
    `SELECT p."questionId", p.options
       FROM personality_question_details p
       JOIN questions q ON q.id = p."questionId"
       JOIN modules m ON m.id = q."moduleId"
      WHERE m.slug = 'personality' AND p.pattern IS NULL`,
  );

  for (const row of rows as { questionId: string; options: OptionRow[] }[]) {
    const options = row.options.map((option) => ({
      ...option,
      traitWeights: remap(option.traitWeights, table),
    }));

    await queryRunner.query(
      `UPDATE personality_question_details SET options = $1 WHERE "questionId" = $2`,
      [JSON.stringify(options), row.questionId],
    );
  }
}

export class WorkplaceTraitVocabulary1786410000000 implements MigrationInterface {
  name = 'WorkplaceTraitVocabulary1786410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Questions first: between the two statements the module's declared traits
    // and its questions' weights disagree, and doing it in this order keeps
    // that window on the side where nothing reads the new keys yet.
    await rewriteLegacyOptions(queryRunner, FORWARD);

    await queryRunner.query(
      `UPDATE modules SET traits = $1, description = $2 WHERE slug = 'personality'`,
      [
        JSON.stringify(WORKPLACE_TRAITS),
        'Workplace behavioural profile measured through situational, forced-choice, trade-off and ranking questions.',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const reverseTable: Record<string, [string, number][]> = {};
    for (const [from, pair] of Object.entries(REVERSE)) {
      reverseTable[from] = [pair];
    }

    await rewriteLegacyOptions(queryRunner, reverseTable);

    await queryRunner.query(
      `UPDATE modules SET traits = $1, description = $2 WHERE slug = 'personality'`,
      [
        JSON.stringify(BIG_FIVE_TRAITS),
        'Big Five behavioural profile, reported against workplace-facing labels.',
      ],
    );
  }
}
