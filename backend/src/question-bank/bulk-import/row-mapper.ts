import { BehavioralPattern, ScoringType } from '../../common/enums';
import { CreateQuestionDto } from '../dto/create-question.dto';
import type {
  McqOptionDto,
  PersonalityOptionDto,
} from '../dto/question-details.dto';
import {
  LEGACY_OPTION_BOUNDS,
  MIN_OPTIONS,
  PATTERN_OPTION_BOUNDS,
  PROBE_GROUP_MAX_LENGTH,
} from '../question-bank.constants';
import type { RawRow } from './spreadsheet-parser';

/** Up to six options per question, matching the DTO's ArrayMaxSize. */
const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

export class RowError extends Error {}

const required = (row: RawRow, column: string): string => {
  const value = row[column]?.trim();
  if (!value) throw new RowError(`missing required column "${column}"`);
  return value;
};

/**
 * `"conscientiousness:2; openness:-1"` -> `{ conscientiousness: 2, openness: -1 }`
 *
 * Semicolon-separated so the whole thing survives a CSV cell without quoting.
 */
export const parseTraitWeights = (
  raw: string,
  column: string,
): Record<string, number> => {
  const weights: Record<string, number> = {};

  for (const pair of raw.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const [trait, rawWeight, ...rest] = trimmed.split(':');
    if (!trait?.trim() || rawWeight === undefined || rest.length > 0) {
      throw new RowError(
        `"${column}" entry "${trimmed}" is malformed — expected "trait:weight" pairs separated by ";"`,
      );
    }

    const weight = Number(rawWeight.trim());
    if (!Number.isFinite(weight)) {
      throw new RowError(
        `"${column}" weight for "${trait.trim()}" is "${rawWeight.trim()}", which is not a number`,
      );
    }
    weights[trait.trim()] = weight;
  }

  if (Object.keys(weights).length === 0) {
    throw new RowError(`"${column}" must weight at least one trait`);
  }
  return weights;
};

/**
 * Reads the optional `pattern` column. Absent means a legacy Likert question —
 * the importer does not guess, because labelling an agree/disagree item as
 * situational would misrepresent it in the report.
 */
const parsePattern = (row: RawRow): BehavioralPattern | undefined => {
  const raw = row.pattern?.trim().toLowerCase();
  if (!raw) return undefined;

  const known: string[] = Object.values(BehavioralPattern);
  if (!known.includes(raw)) {
    throw new RowError(
      `"pattern" is "${raw}" — expected one of ${known.join(', ')}`,
    );
  }
  return raw as BehavioralPattern;
};

const parseTags = (row: RawRow): string[] =>
  (row.tags ?? '')
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Reads the optional `probe_group` column, which twins this row with the other
 * rows carrying the same value.
 *
 * Whether the twins are actually written differently enough is an authoring
 * judgement the importer cannot make — it can only check that a group name is
 * usable. What it does catch is the mistake that would break the engine: a group
 * shared by rows in different modules, which the service rejects because a probe
 * pair has to be servable within one module's run.
 */
const parseProbeGroup = (row: RawRow): string | undefined => {
  const raw = row.probe_group?.trim();
  if (!raw) return undefined;

  if (raw.length > PROBE_GROUP_MAX_LENGTH) {
    throw new RowError(
      `"probe_group" is ${raw.length} characters; the limit is ${PROBE_GROUP_MAX_LENGTH}`,
    );
  }
  return raw;
};

/**
 * Maps one spreadsheet row to the same DTO shape the REST endpoint accepts, so
 * both paths run through identical validation in QuestionBankService.
 *
 * The row's own module decides which shape to expect — never the presence of a
 * column. That lets one sheet mix objective and trait questions, and means a
 * stray empty `correct_option` column can't misclassify a row.
 *
 * Throws RowError with a human-readable reason; the caller collects these per
 * row rather than failing the whole file.
 */
export function rowToCreateDto(
  row: RawRow,
  module: { id: string; scoringType: ScoringType },
): CreateQuestionDto {
  const moduleId = module.id;
  const questionText = required(row, 'question_text');
  const tags = parseTags(row);
  const probeGroup = parseProbeGroup(row);

  if (module.scoringType === ScoringType.OBJECTIVE) {
    const options: McqOptionDto[] = [];
    for (const letter of OPTION_LETTERS) {
      const text = row[`option_${letter}`]?.trim();
      if (text) options.push({ key: letter.toUpperCase(), text });
    }
    if (options.length < MIN_OPTIONS) {
      throw new RowError(
        `needs at least ${MIN_OPTIONS} options but has ${options.length} ` +
          '(columns option_a, option_b, option_c, option_d, ...)',
      );
    }

    const correctOption = required(row, 'correct_option').toUpperCase();

    const rawDifficulty = row.difficulty_score?.trim();
    let difficultyScore: number | undefined;
    if (rawDifficulty) {
      difficultyScore = Number(rawDifficulty);
      if (!Number.isInteger(difficultyScore)) {
        throw new RowError(
          `"difficulty_score" is "${rawDifficulty}", which is not a whole number`,
        );
      }
    }

    return {
      moduleId,
      questionText,
      tags,
      ...(probeGroup && { probeGroup }),
      mcq: { options, correctOption, difficultyScore },
    };
  }

  const pattern = parsePattern(row);

  const options: PersonalityOptionDto[] = [];
  for (const letter of OPTION_LETTERS) {
    const text = row[`option_${letter}`]?.trim();
    if (!text) continue;

    const weightColumn = `option_${letter}_weights`;
    const rawWeights = row[weightColumn]?.trim();
    if (!rawWeights) {
      throw new RowError(
        `option_${letter} has text but no "${weightColumn}" — every option must weight at least one trait`,
      );
    }
    const behavior = row[`option_${letter}_behavior`]?.trim();
    options.push({
      key: letter.toUpperCase(),
      text,
      traitWeights: parseTraitWeights(rawWeights, weightColumn),
      ...(behavior && { behavior }),
    });
  }

  // Bounds depend on the pattern: a forced-choice row legitimately has two
  // options, which the old flat minimum of four would have rejected.
  const bounds = pattern
    ? PATTERN_OPTION_BOUNDS[pattern]
    : LEGACY_OPTION_BOUNDS;
  if (options.length < bounds.min || options.length > bounds.max) {
    const expected =
      bounds.min === bounds.max
        ? `exactly ${bounds.min}`
        : `${bounds.min}-${bounds.max}`;
    throw new RowError(
      `a "${pattern ?? 'legacy'}" question takes ${expected} options but has ` +
        `${options.length} (columns option_a + option_a_weights, ...)`,
    );
  }

  return {
    moduleId,
    questionText,
    tags,
    ...(probeGroup && { probeGroup }),
    personality: { options, pattern },
  };
}
