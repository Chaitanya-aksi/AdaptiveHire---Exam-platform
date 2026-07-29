/**
 * Starter sheets handed to recruiters via
 * GET /api/questions/bulk-import/template/{mcq,personality}.
 *
 * Column names are matched case-insensitively with spaces normalised to
 * underscores, so "Question Text" also works.
 */

export const MCQ_TEMPLATE_CSV = `module_slug,question_text,option_a,option_b,option_c,option_d,correct_option,difficulty_score,tags
aptitude,"What is 15% of 240?",30,36,40,45,B,900,percentages
logical-reasoning,"Which number continues the sequence: 2, 6, 12, 20, ?",28,30,32,36,B,1000,sequences
`;

/**
 * A 4-point forced-choice scale: no neutral midpoint, so candidates cannot
 * park on a safe answer and flatten the trait signal. The second row is
 * reverse-keyed — agreement lowers the trait — and also shows one option
 * weighting two traits at once.
 */
export const PERSONALITY_TEMPLATE_CSV = `module_slug,question_text,option_a,option_a_weights,option_b,option_b_weights,option_c,option_c_weights,option_d,option_d_weights,tags
personality,"I plan my week in advance.","Strongly agree","conscientiousness:2","Agree","conscientiousness:1","Disagree","conscientiousness:-1","Strongly disagree","conscientiousness:-2",planning
personality,"I would rather work alone than as part of a group.","Strongly agree","extraversion:-2;agreeableness:-1","Agree","extraversion:-1","Disagree","extraversion:1","Strongly disagree","extraversion:2;agreeableness:1",social
`;
