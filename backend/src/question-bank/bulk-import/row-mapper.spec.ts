import { ScoringType } from '../../common/enums';
import { RowError, parseTraitWeights, rowToCreateDto } from './row-mapper';
import type { RawRow } from './spreadsheet-parser';

const objectiveModule = { id: 'mod-obj', scoringType: ScoringType.OBJECTIVE };
const traitModule = { id: 'mod-trait', scoringType: ScoringType.TRAIT };

const mcqRow = (overrides: Partial<RawRow> = {}): RawRow => ({
  question_text: 'What is 2 + 2?',
  option_a: '3',
  option_b: '4',
  option_c: '5',
  option_d: '6',
  correct_option: 'b',
  difficulty_score: '900',
  tags: 'arithmetic; easy',
  ...overrides,
});

describe('parseTraitWeights', () => {
  it('parses semicolon-separated trait:weight pairs', () => {
    expect(parseTraitWeights('openness:2; conscientiousness:-1', 'w')).toEqual({
      openness: 2,
      conscientiousness: -1,
    });
  });

  it('accepts a single pair and negative and zero weights', () => {
    expect(parseTraitWeights('extraversion:0', 'w')).toEqual({
      extraversion: 0,
    });
  });

  it('rejects a non-numeric weight', () => {
    expect(() => parseTraitWeights('openness:high', 'w')).toThrow(RowError);
  });

  it('rejects a malformed pair', () => {
    expect(() => parseTraitWeights('openness', 'w')).toThrow(RowError);
  });

  it('rejects an empty cell', () => {
    expect(() => parseTraitWeights('  ', 'w')).toThrow(RowError);
  });
});

describe('rowToCreateDto — objective modules', () => {
  it('maps options, upper-cases the correct key and splits tags', () => {
    const dto = rowToCreateDto(mcqRow(), objectiveModule);

    expect(dto.moduleId).toBe('mod-obj');
    expect(dto.mcq?.options).toEqual([
      { key: 'A', text: '3' },
      { key: 'B', text: '4' },
      { key: 'C', text: '5' },
      { key: 'D', text: '6' },
    ]);
    expect(dto.mcq?.correctOption).toBe('B');
    expect(dto.mcq?.difficultyScore).toBe(900);
    expect(dto.tags).toEqual(['arithmetic', 'easy']);
    expect(dto.personality).toBeUndefined();
  });

  it('leaves difficulty undefined so the entity default applies', () => {
    const dto = rowToCreateDto(
      mcqRow({ difficulty_score: '' }),
      objectiveModule,
    );
    expect(dto.mcq?.difficultyScore).toBeUndefined();
  });

  it('ignores blank option columns beyond the four required', () => {
    const dto = rowToCreateDto(
      mcqRow({ option_e: '', option_f: '' }),
      objectiveModule,
    );
    expect(dto.mcq?.options).toHaveLength(4);
  });

  it('accepts more than four options up to the maximum', () => {
    const dto = rowToCreateDto(
      mcqRow({ option_e: '7', option_f: '8' }),
      objectiveModule,
    );
    expect(dto.mcq?.options).toHaveLength(6);
  });

  /**
   * Four is the floor for every module: it caps the objective guess rate at
   * 25% and keeps trait scales free of a neutral midpoint.
   */
  it('rejects a row with only three options', () => {
    expect(() =>
      rowToCreateDto(mcqRow({ option_d: '' }), objectiveModule),
    ).toThrow(/at least 4 options but has 3/);
  });

  it('rejects a missing question_text', () => {
    expect(() =>
      rowToCreateDto(mcqRow({ question_text: '' }), objectiveModule),
    ).toThrow(/question_text/);
  });

  it('rejects a non-integer difficulty', () => {
    expect(() =>
      rowToCreateDto(mcqRow({ difficulty_score: 'hard' }), objectiveModule),
    ).toThrow(/difficulty_score/);
  });

  it('rejects a missing correct_option', () => {
    expect(() =>
      rowToCreateDto(mcqRow({ correct_option: '' }), objectiveModule),
    ).toThrow(/correct_option/);
  });
});

describe('rowToCreateDto — trait modules', () => {
  const traitRow: RawRow = {
    question_text: 'I plan my week in advance.',
    option_a: 'Strongly agree',
    option_a_weights: 'conscientiousness:2',
    option_b: 'Agree',
    option_b_weights: 'conscientiousness:1',
    option_c: 'Disagree',
    option_c_weights: 'conscientiousness:-1',
    option_d: 'Strongly disagree',
    option_d_weights: 'conscientiousness:-2',
    tags: 'planning',
  };

  it('maps options with their trait weights', () => {
    const dto = rowToCreateDto(traitRow, traitModule);

    expect(dto.personality?.options).toEqual([
      {
        key: 'A',
        text: 'Strongly agree',
        traitWeights: { conscientiousness: 2 },
      },
      { key: 'B', text: 'Agree', traitWeights: { conscientiousness: 1 } },
      { key: 'C', text: 'Disagree', traitWeights: { conscientiousness: -1 } },
      {
        key: 'D',
        text: 'Strongly disagree',
        traitWeights: { conscientiousness: -2 },
      },
    ]);
    expect(dto.mcq).toBeUndefined();
  });

  /** No neutral midpoint to hide behind — the scale must stay even. */
  it('rejects a three-point scale', () => {
    const { option_d, option_d_weights, ...threePoint } = traitRow;
    void option_d;
    void option_d_weights;

    expect(() => rowToCreateDto(threePoint, traitModule)).toThrow(
      /at least 4 options but has 3/,
    );
  });

  it('rejects an option that has text but no weights', () => {
    expect(() =>
      rowToCreateDto({ ...traitRow, option_b_weights: '' }, traitModule),
    ).toThrow(/option_b_weights/);
  });

  /**
   * The module's scoring type decides the shape — a stray empty MCQ column
   * left over from another sheet must not misclassify the row.
   */
  it('ignores an irrelevant empty correct_option column', () => {
    const dto = rowToCreateDto(
      { ...traitRow, correct_option: '' },
      traitModule,
    );
    expect(dto.personality?.options).toHaveLength(4);
  });
});
