import { ScoringType } from '../../common/enums';
import { CreateQuestionDto } from '../dto/create-question.dto';
import type {
  McqOptionDto,
  PersonalityOptionDto,
} from '../dto/question-details.dto';
import { MIN_OPTIONS } from '../question-bank.constants';
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

const parseTags = (row: RawRow): string[] =>
  (row.tags ?? '')
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);

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
      mcq: { options, correctOption, difficultyScore },
    };
  }

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
    options.push({
      key: letter.toUpperCase(),
      text,
      traitWeights: parseTraitWeights(rawWeights, weightColumn),
    });
  }

  if (options.length < MIN_OPTIONS) {
    throw new RowError(
      `needs at least ${MIN_OPTIONS} options but has ${options.length} ` +
        '(columns option_a + option_a_weights, option_b + option_b_weights, ...)',
    );
  }

  return { moduleId, questionText, tags, personality: { options } };
}
