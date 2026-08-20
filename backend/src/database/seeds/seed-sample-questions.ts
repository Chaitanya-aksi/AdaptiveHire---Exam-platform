import { BehavioralPattern, QuestionStatus } from '../../common/enums';
import { McqQuestionDetails } from '../../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../../question-bank/entities/personality-question-details.entity';
import { Question } from '../../question-bank/entities/question.entity';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import dataSource from '../data-source';

/*
 * Run with:
 *
 *   npm run seed:samples
 *
 * Included in `npm run seed`, so a fresh checkout has working practice without
 * anyone knowing this file exists.
 */

/*
 * The practice questions every candidate gets, whoever invited them.
 *
 * Platform-owned — `organisationId` null — which is what makes this work
 * without anybody authoring anything: the visibility rule already lets every
 * organisation see the platform bank, so seeding these once gives practice to
 * all of them, including customers who sign up next year.
 *
 * Deliberately not left to a checkbox on the question form. Practice that
 * depends on a recruiter remembering to tick something is practice that
 * silently does not happen, and the candidate meeting a ranking control for the
 * first time with the clock running is exactly what this exists to prevent. A
 * company that wants its own can still author them; those take precedence.
 *
 * The content is intentionally generic and easy. These teach the *controls* —
 * how an option is chosen, what a ranking looks like, that a personality
 * question has no right answer — not the subject matter. A hard sample would
 * teach the interface and dent the candidate's confidence on the way in.
 */

interface SampleSpec {
  moduleSlug: string;
  questionText: string;
  mcq?: {
    options: { key: string; text: string }[];
    correctOption: string;
  };
  personality?: {
    pattern: BehavioralPattern;
    options: {
      key: string;
      text: string;
      traitWeights: Record<string, number>;
      behavior?: string;
    }[];
  };
}

/** Tagged so the set is findable and removable as a unit later. */
const SAMPLE_TAG = 'platform-sample';

/** Enough of a stem to tell two samples apart in the console. */
const short = (text: string): string =>
  text.length > 46 ? `${text.slice(0, 46)}…` : text;

const SAMPLES: SampleSpec[] = [
  {
    moduleSlug: 'aptitude',
    questionText:
      'If a train travels 60 kilometres in 45 minutes, what is its average speed?',
    mcq: {
      options: [
        { key: 'A', text: '45 km/h' },
        { key: 'B', text: '60 km/h' },
        { key: 'C', text: '80 km/h' },
        { key: 'D', text: '90 km/h' },
      ],
      correctOption: 'C',
    },
  },
  {
    moduleSlug: 'logical-reasoning',
    questionText:
      'Every book on the shelf is either blue or heavy. This book is not heavy. What follows?',
    mcq: {
      options: [
        { key: 'A', text: 'The book is blue' },
        { key: 'B', text: 'The book is not on the shelf' },
        { key: 'C', text: 'The book is both blue and heavy' },
        { key: 'D', text: 'Nothing follows' },
      ],
      correctOption: 'A',
    },
  },
  {
    moduleSlug: 'verbal-ability',
    questionText: 'Which word is closest in meaning to "concise"?',
    mcq: {
      options: [
        { key: 'A', text: 'Detailed' },
        { key: 'B', text: 'Brief' },
        { key: 'C', text: 'Uncertain' },
        { key: 'D', text: 'Formal' },
      ],
      correctOption: 'B',
    },
  },
  {
    moduleSlug: 'aptitude',
    questionText: 'What is 15% of 200?',
    mcq: {
      options: [
        { key: 'A', text: '15' },
        { key: 'B', text: '20' },
        { key: 'C', text: '30' },
        { key: 'D', text: '45' },
      ],
      correctOption: 'C',
    },
  },
  {
    moduleSlug: 'aptitude',
    questionText: 'Which number comes next: 2, 4, 8, 16, ?',
    mcq: {
      options: [
        { key: 'A', text: '18' },
        { key: 'B', text: '24' },
        { key: 'C', text: '32' },
        { key: 'D', text: '64' },
      ],
      correctOption: 'C',
    },
  },
  {
    moduleSlug: 'logical-reasoning',
    questionText: 'All cats are animals. Rex is a cat. What follows?',
    mcq: {
      options: [
        { key: 'A', text: 'Rex is an animal' },
        { key: 'B', text: 'Rex is not an animal' },
        { key: 'C', text: 'All animals are cats' },
        { key: 'D', text: 'Nothing follows' },
      ],
      correctOption: 'A',
    },
  },
  {
    moduleSlug: 'logical-reasoning',
    questionText:
      'Monday, Wednesday, Friday, ? — which day continues the pattern?',
    mcq: {
      options: [
        { key: 'A', text: 'Saturday' },
        { key: 'B', text: 'Sunday' },
        { key: 'C', text: 'Thursday' },
        { key: 'D', text: 'Tuesday' },
      ],
      correctOption: 'B',
    },
  },
  {
    moduleSlug: 'verbal-ability',
    questionText: 'Which word is the opposite of "increase"?',
    mcq: {
      options: [
        { key: 'A', text: 'Expand' },
        { key: 'B', text: 'Reduce' },
        { key: 'C', text: 'Repeat' },
        { key: 'D', text: 'Continue' },
      ],
      correctOption: 'B',
    },
  },
  {
    moduleSlug: 'verbal-ability',
    questionText: 'Choose the correctly spelled word.',
    mcq: {
      options: [
        { key: 'A', text: 'Recieve' },
        { key: 'B', text: 'Receive' },
        { key: 'C', text: 'Receeve' },
        { key: 'D', text: 'Reciive' },
      ],
      correctOption: 'B',
    },
  },
  {
    moduleSlug: 'personality',
    questionText:
      'A colleague asks for help an hour before your own deadline. What do you actually do?',
    personality: {
      pattern: BehavioralPattern.SITUATIONAL,
      options: [
        {
          key: 'A',
          text: 'Help them straight away and work later to finish my own',
          // Weights on the -3..+3 authoring scale, kept small: a practice
          // answer is never scored, and modest numbers stop this reading as a
          // template for how a real question should be weighted.
          traitWeights: { teamwork: 2, accountability: -1 },
          behavior: 'Helps first',
        },
        {
          key: 'B',
          text: 'Finish mine, then help — and tell them when I will be free',
          traitWeights: { accountability: 2, communication: 1 },
          behavior: 'Sequences and communicates',
        },
        {
          key: 'C',
          text: 'Point them to someone better placed to help right now',
          traitWeights: { teamwork: 1, ownership: -1 },
          behavior: 'Redirects',
        },
      ],
    },
  },
  {
    moduleSlug: 'personality',
    questionText:
      'You spot a mistake in work that has already gone out. What do you do first?',
    personality: {
      pattern: BehavioralPattern.SITUATIONAL,
      options: [
        {
          key: 'A',
          text: 'Tell whoever needs to know straight away, then fix it',
          traitWeights: { accountability: 2, communication: 1 },
          behavior: 'Raises it',
        },
        {
          key: 'B',
          text: 'Fix it quietly and mention it if anyone asks',
          traitWeights: { ownership: 1, communication: -1 },
          behavior: 'Fixes quietly',
        },
        {
          key: 'C',
          text: 'Check it really is a mistake before saying anything',
          traitWeights: { judgement: 2, accountability: -1 },
          behavior: 'Verifies first',
        },
      ],
    },
  },
  {
    moduleSlug: 'personality',
    questionText: 'A plan you disagree with has been decided. How do you act?',
    personality: {
      pattern: BehavioralPattern.SITUATIONAL,
      options: [
        {
          key: 'A',
          text: 'Say what I think once, then commit to it fully',
          traitWeights: { adaptability: 2, communication: 1 },
          behavior: 'Disagrees and commits',
        },
        {
          key: 'B',
          text: 'Go along with it and keep my concerns to myself',
          traitWeights: { adaptability: 1, communication: -2 },
          behavior: 'Stays quiet',
        },
        {
          key: 'C',
          text: 'Keep making the case until someone reconsiders',
          traitWeights: { communication: 1, adaptability: -2 },
          behavior: 'Keeps pushing',
        },
      ],
    },
  },
];

async function run(): Promise<void> {
  await dataSource.initialize();

  const questions = dataSource.getRepository(Question);
  const modules = dataSource.getRepository(ModuleCatalogEntry);
  const mcqDetails = dataSource.getRepository(McqQuestionDetails);
  const personalityDetails = dataSource.getRepository(
    PersonalityQuestionDetails,
  );

  let created = 0;
  let skipped = 0;

  for (const spec of SAMPLES) {
    const module = await modules.findOne({
      where: { slug: spec.moduleSlug },
    });
    if (!module) {
      console.log(`· ${spec.moduleSlug} — no such module, skipped`);
      continue;
    }

    /*
     * Matched on the question text, not merely on the module having *a*
     * sample.
     *
     * A module carries several now — one apiece is a tour when an assessment
     * has three subjects, but a single-subject assessment needs three from the
     * one it has, and a candidate who answers a single practice question has
     * not rehearsed anything. Keyed per module the second and third would look
     * like duplicates of the first and never be created.
     */
    const existing = await questions
      .createQueryBuilder('q')
      .where('q."organisationId" IS NULL')
      .andWhere('q."isSample" = true')
      .andWhere('q."moduleId" = :moduleId', { moduleId: module.id })
      .andWhere('q."questionText" = :text', { text: spec.questionText })
      .getOne();

    if (existing) {
      skipped += 1;
      console.log(
        `· ${spec.moduleSlug}: "${short(spec.questionText)}" — present`,
      );
      continue;
    }

    const question = await questions.save(
      questions.create({
        moduleId: module.id,
        questionText: spec.questionText,
        // Active, not draft: a draft sample would never be shown, and there is
        // no reviewer for the platform bank to move it along.
        status: QuestionStatus.ACTIVE,
        tags: [SAMPLE_TAG],
        isSample: true,
        // Platform-owned. This is the whole mechanism — every organisation can
        // see it, none of them can edit it in place.
        organisationId: null,
        createdById: null,
      }),
    );

    if (spec.mcq) {
      await mcqDetails.save(
        mcqDetails.create({
          questionId: question.id,
          options: spec.mcq.options,
          correctOption: spec.mcq.correctOption,
          // Mid-range and irrelevant: a sample is never served, so this never
          // reaches the estimator. Present because the column requires it.
          difficultyScore: 1000,
        }),
      );
    } else if (spec.personality) {
      await personalityDetails.save(
        personalityDetails.create({
          questionId: question.id,
          options: spec.personality.options,
          pattern: spec.personality.pattern,
        }),
      );
    }

    created += 1;
    console.log(`✓ ${spec.moduleSlug}: "${short(spec.questionText)}"`);
  }

  console.log(`\n${created} created, ${skipped} already present.`);
  await dataSource.destroy();
}

run().catch((error) => {
  console.error('Sample seeding failed:', error);
  process.exit(1);
});
