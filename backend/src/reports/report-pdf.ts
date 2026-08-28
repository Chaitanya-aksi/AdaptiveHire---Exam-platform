import * as path from 'path';
import pdfMake from 'pdfmake';
import type {
  Column,
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
} from '../common/enums';
import type {
  ModuleSummary,
  ProbeSummary,
  ViolationCount,
} from './report-builder';
import type { ProfileScore } from './behavioral-profiles';
import type {
  AnswerDetail,
  ReportDetailView,
  ReportSummaryView,
} from './reports.service';

/**
 * The recruiter's report as a downloaded PDF.
 *
 * This replaced `window.print()`, and the trade-off is worth stating plainly.
 * Printing could never drift from the screen, because it *was* the screen — but
 * no web page can skip the browser's print dialog, so "Save as PDF" always
 * meant a dialog, a destination to pick and a button to press, on a control
 * labelled as though it downloaded something. This is a second rendering and
 * can therefore drift in *layout*; it cannot drift in *data*, because it is
 * built from the same `summary` and `detail` payloads the page renders from.
 * Add a field to the report and it appears on screen but not here — so a change
 * to either one is a prompt to look at the other.
 *
 * Laid out with pdfmake rather than headless Chrome deliberately: a real
 * browser would give pixel fidelity at the cost of a ~300MB Chromium in the
 * API image and a second authenticated page load per download. This is pure
 * JavaScript, needs nothing added to the container, and emits selectable
 * vector text rather than a screenshot of a page.
 */

const INK = '#16191d';
const MUTED = '#646b76';
const BORDER = '#e2e5ea';
const ACCENT = '#2f5bea';
const SUCCESS = '#16794a';
const DANGER = '#c02b2b';
const WARN = '#8a5a00';

/** Mirrors the badge wording on screen, so the two read the same. */
const RECOMMENDATION_LABEL: Record<HiringRecommendation, string> = {
  [HiringRecommendation.STRONGLY_RECOMMENDED]: 'Strongly recommended',
  [HiringRecommendation.RECOMMENDED]: 'Recommended',
  [HiringRecommendation.BORDERLINE]: 'Borderline',
  [HiringRecommendation.NOT_RECOMMENDED]: 'Not recommended',
};

const RECOMMENDATION_COLOUR: Record<HiringRecommendation, string> = {
  [HiringRecommendation.STRONGLY_RECOMMENDED]: SUCCESS,
  [HiringRecommendation.RECOMMENDED]: SUCCESS,
  [HiringRecommendation.BORDERLINE]: WARN,
  [HiringRecommendation.NOT_RECOMMENDED]: DANGER,
};

/**
 * Named for what was measured, never for what it might mean — the same wording
 * the report uses on screen and for the same reason. "Background noise" is a
 * level above a threshold; it is not a claim that somebody was talking.
 */
const EVENT_LABEL: Record<ProctoringEventType, string> = {
  [ProctoringEventType.TAB_SWITCH]: 'Switched away from the test',
  [ProctoringEventType.FULLSCREEN_EXIT]: 'Left full screen',
  [ProctoringEventType.FACE_ABSENT]: 'No face visible',
  [ProctoringEventType.FACE_NOT_FRAMED]: 'Face not properly in view',
  [ProctoringEventType.MULTIPLE_FACES]: 'More than one face visible',
  [ProctoringEventType.MULTIPLE_DISPLAYS_DETECTED]:
    'More than one display detected',
  [ProctoringEventType.BACKGROUND_NOISE]: 'Background noise',
};

/** Agreement at or above which a repeat probe counts as having held. */
const PROBE_HELD_AT = 0.7;

/**
 * Registers the bundled Roboto faces, once per process.
 *
 * Roboto rather than one of the PDF standard fourteen: Helvetica is limited to
 * WinAnsi, and this document carries free text — question stems, a recruiter's
 * note, a candidate's name — that has no reason to stay inside Latin-1. An
 * embedded TrueType face renders it or fails loudly; WinAnsi would silently
 * mangle it.
 */
let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;

  // Resolved from the package rather than hardcoded: hoisting, workspaces and
  // the Docker image all put node_modules somewhere slightly different.
  const root = path.dirname(require.resolve('pdfmake/package.json'));
  const dir = path.join(root, 'fonts', 'Roboto');

  pdfMake.setFonts({
    Roboto: {
      normal: path.join(dir, 'Roboto-Regular.ttf'),
      bold: path.join(dir, 'Roboto-Medium.ttf'),
      italics: path.join(dir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
    },
  });

  /*
   * This document is assembled entirely from our own data and never references
   * an external resource, so both policies deny everything except the font
   * directory above. Without them pdfmake warns on every render that anything
   * reachable could be fetched — which for a document built from candidate and
   * recruiter free text is a warning worth actually closing rather than muting.
   */
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy((file: string) =>
    path.resolve(file).startsWith(dir),
  );

  fontsReady = true;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  // Fixed locale and an explicit UTC offset are avoided on purpose: the file is
  // read by the same team that ran the assessment, and the server's zone is
  // what every other timestamp in the product is rendered in.
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

function formatMillis(ms: number | null): string {
  return ms === null ? '—' : formatSeconds(ms / 1000);
}

function percent(fraction: number | null): string {
  return fraction === null ? '—' : `${Math.round(fraction * 100)}%`;
}

/** A 0-100 score as a filled bar, drawn rather than shaded with a table cell. */
function scoreBar(score: number, width = 220): Content {
  const clamped = Math.min(100, Math.max(0, score));
  return {
    canvas: [
      { type: 'rect', x: 0, y: 0, w: width, h: 5, r: 2.5, color: BORDER },
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: Math.max(1, (width * clamped) / 100),
        h: 5,
        r: 2.5,
        color: ACCENT,
      },
    ],
    margin: [0, 3, 0, 6],
  };
}

/**
 * A vertical stack with the inapplicable parts dropped.
 *
 * pdfmake gives an empty text node a full line box, so the usual
 * `condition ? block : { text: '' }` leaves a blank line wherever a section
 * had nothing to say — which on a report where most blocks are conditional
 * adds up to visible padding inside every card. Nulls are filtered instead.
 */
function stack(parts: (Content | null)[]): Content {
  return { stack: parts.filter((part): part is Content => part !== null) };
}

/** A section rule with its heading, so the document has visible structure. */
function heading(text: string): Content {
  return { text, style: 'h2', margin: [0, 16, 0, 6] };
}

/** The muted one-line note that sits under several of the headings. */
function note(text: string): Content {
  return { text, style: 'note', margin: [0, 0, 0, 6] };
}

/**
 * A bordered block, used for the score panel and each section card.
 *
 * pdfmake has no box primitive, so a single-cell table stands in for one. The
 * layout strips the inner lines and leaves the frame.
 */
function panel(body: Content, fill?: string): ContentTable {
  return {
    table: { widths: ['*'], body: [[body]] },
    layout: {
      hLineColor: () => BORDER,
      vLineColor: () => BORDER,
      hLineWidth: () => 0.7,
      vLineWidth: () => 0.7,
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 8,
      paddingBottom: () => 8,
      fillColor: () => fill ?? null,
    },
    margin: [0, 0, 0, 8],
  };
}

/** Shared look for the data tables: a header rule and hairlines between rows. */
const TABLE_LAYOUT = {
  hLineColor: () => BORDER,
  vLineColor: () => BORDER,
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
    i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.4,
  vLineWidth: () => 0,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

function tableHeader(cells: string[]): TableCell[] {
  return cells.map((text) => ({ text, style: 'th' }));
}

/** A right-aligned cell. Numbers read as a column when their edges line up. */
function figure(text: string, style?: string): TableCell {
  return { text, alignment: 'right', ...(style ? { style } : {}) };
}

// ── the sections ──────────────────────────────────────────────────────────

function headerBlock(view: ReportSummaryView): Content[] {
  const facts = [
    `${view.assessment.title} · ${view.candidate.email}`,
    [
      `Started ${formatDateTime(view.timing.startedAt)}`,
      `Submitted ${formatDateTime(view.timing.submittedAt)}`,
      `${formatSeconds(view.timing.elapsedSeconds)} elapsed`,
      view.timing.timeOnQuestionsSeconds !== null
        ? `${formatSeconds(view.timing.timeOnQuestionsSeconds)} answering`
        : null,
      // Never left implicit: an attempt the clock ended looks identical to a
      // short one otherwise, and they mean very different things.
      view.timing.autoSubmitted ? 'ended by the time limit' : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
  ];

  return [
    { text: view.candidate.fullName, style: 'h1' },
    ...facts.map((text): Content => ({ text, style: 'note' })),
  ];
}

function scorePanel(view: ReportSummaryView): Content {
  const { report } = view;

  const split = [
    report.abilityScore !== null ? `ability ${report.abilityScore}` : null,
    report.behavioralScore !== null
      ? `behavioural ${report.behavioralScore}`
      : null,
  ].filter((part): part is string => part !== null);

  return panel(
    stack([
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Overall score', style: 'label' },
              report.overallScore === null
                ? { text: 'Not scored', style: 'score' }
                : {
                    text: [
                      { text: String(report.overallScore), style: 'score' },
                      { text: ' / 100', style: 'note' },
                    ],
                  },
              ...(split.length > 0
                ? [{ text: split.join(' · '), style: 'note' } as Content]
                : []),
            ],
          },
          {
            width: 'auto',
            text: report.hiringRecommendation
              ? RECOMMENDATION_LABEL[report.hiringRecommendation]
              : 'Pending',
            bold: true,
            color: report.hiringRecommendation
              ? RECOMMENDATION_COLOUR[report.hiringRecommendation]
              : MUTED,
            alignment: 'right',
          },
        ],
      },
      { text: report.summary, margin: [0, 8, 0, 0], lineHeight: 1.3 },
      {
        // The same disclaimer the screen carries. It is the load-bearing
        // sentence of the whole document: the recommendation is arithmetic on
        // the scores, and the proctoring signals below are not part of it.
        text: 'Rule-based from the scores below. Proctoring signals never affect it — the decision is yours.',
        style: 'note',
        margin: [0, 8, 0, 0],
      },
    ]),
  );
}

function findingsBlock(view: ReportSummaryView): Content[] {
  const { strengths, weaknesses } = view.report;
  if (strengths.length === 0 && weaknesses.length === 0) return [];

  const column = (title: string, items: string[]): Column => ({
    width: '*',
    stack: [
      { text: title, style: 'h3' },
      items.length === 0
        ? { text: 'None identified.', style: 'note' }
        : { ul: items, margin: [0, 2, 0, 0] },
    ],
  });

  return [
    heading('Strengths and weaknesses'),
    {
      columns: [
        column('Strengths', strengths),
        column('Weaknesses', weaknesses),
      ],
      columnGap: 18,
    },
  ];
}

function traitTable(module: ModuleSummary): Content {
  return {
    table: {
      headerRows: 1,
      widths: ['*', 48, 60, 66],
      body: [
        tableHeader(['Trait', 'Score', 'Confidence', 'Consistency']),
        ...module.traits.map((trait): TableCell[] => [
          trait.label,
          figure(String(trait.score)),
          figure(percent(trait.confidence)),
          figure(percent(trait.consistency)),
        ]),
      ],
    },
    layout: TABLE_LAYOUT,
    margin: [0, 4, 0, 0],
  };
}

/**
 * The repeat checks for one section.
 *
 * The mechanism is spelled out rather than reduced to a percentage, exactly as
 * on screen: "the same question came back reworded" is something a recruiter
 * can reason about, where a bare agreement figure invites being read as a
 * truthfulness score, which it is not.
 */
function probeBlock(probes: ProbeSummary): Content {
  const checked = probes.pairs.filter((pair) => pair.agreement !== null);
  const held = checked.filter((pair) => (pair.agreement ?? 0) >= PROBE_HELD_AT);

  if (checked.length === 0) {
    return {
      text: 'Repeat check — a repeat was set up but the section ended before it came round, so there is nothing to compare.',
      style: 'note',
      margin: [0, 6, 0, 0],
    };
  }

  return {
    stack: [
      {
        text: [
          { text: 'Repeat check ', bold: true },
          {
            text: `— the same question again later, reworded, with reordered options · ${held.length} of ${checked.length} held`,
            style: 'note',
          },
        ],
        margin: [0, 6, 0, 3],
      },
      {
        ul: checked.map((pair) => {
          const agreement = pair.agreement ?? 0;
          const consistent = agreement >= PROBE_HELD_AT;
          const divergent = pair.divergentTraits
            .map((trait) => trait.label)
            .join(', ');

          return {
            text: [
              { text: `Q${pair.firstSequence} → Q${pair.secondSequence}: ` },
              {
                text: consistent ? 'same answer' : 'answered differently',
                color: consistent ? SUCCESS : WARN,
                bold: true,
              },
              pair.flipped === true
                ? { text: ' · the right/wrong outcome changed', style: 'note' }
                : { text: '' },
              divergent
                ? { text: ` · diverged on ${divergent}`, style: 'note' }
                : { text: '' },
            ],
          };
        }),
        style: 'note',
      },
    ],
  };
}

function moduleBlock(module: ModuleSummary): Content {
  const objective = module.scoringType === ScoringType.OBJECTIVE;

  const facts = [
    objective
      ? `${module.questionsCorrect} of ${module.questionsAnswered} correct`
      : `${module.questionsAnswered} answered`,
    // What the questions were worth to a guesser, stated every time rather than
    // only when the score is low — shown selectively it would read as an
    // accusation, and this is evidence for the reader to weigh, not a verdict.
    objective && module.expectedByChance !== null
      ? `${module.expectedByChance} expected by guessing alone`
      : null,
    // Under-answering is always visible: a score from three answers and one
    // from twelve are not the same claim.
    module.questionsAnswered > 0 &&
    module.questionsAnswered < module.questionCount
      ? `below the ${module.questionCount} this section asks for`
      : null,
  ].filter((part): part is string => part !== null);

  return panel(
    stack([
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: module.name, bold: true, fontSize: 11 },
              { text: facts.join(' · '), style: 'note' },
            ],
          },
          {
            width: 'auto',
            text: module.score === null ? '—' : String(module.score),
            style: 'score',
            fontSize: 16,
            alignment: 'right',
          },
        ],
      },
      module.score !== null ? scoreBar(module.score) : null,
      module.legacyTraitModel
        ? {
            text: 'Measured against a previous trait model — these names and scores are not comparable with more recent attempts.',
            style: 'note',
            italics: true,
          }
        : null,
      module.traits.length > 0 ? traitTable(module) : null,
      module.consistency !== null
        ? {
            text: `Consistency across situations: ${percent(module.consistency)} — how steadily each trait showed up, not a truthfulness check.`,
            style: 'note',
            margin: [0, 6, 0, 0],
          }
        : null,
      module.probes ? probeBlock(module.probes) : null,
    ]),
  );
}

function profileBlock(profile: ProfileScore): Content {
  const contributions = profile.contributions
    .map(
      (part) =>
        `${part.label} ${part.score} (${Math.round(part.weight * 100)}%)`,
    )
    .join(' · ');

  return panel(
    stack([
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: profile.label, bold: true, fontSize: 11 },
              { text: profile.description, style: 'note' },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            // No number and no band when the evidence is thin. The card stays,
            // because "we asked and got too little back" is worth knowing, but
            // nothing here may be mistaken for a finding.
            text:
              profile.score === null
                ? 'Not enough answers'
                : `${profile.score}`,
            bold: true,
            fontSize: profile.score === null ? 9 : 16,
            color: profile.score === null ? MUTED : INK,
          },
        ],
      },
      profile.score !== null ? scoreBar(profile.score) : null,
      {
        text: contributions
          ? `Built from: ${contributions}`
          : 'No traits with enough evidence behind this composite.',
        style: 'note',
      },
    ]),
  );
}

function violationsBlock(violations: ViolationCount[]): Content[] {
  if (violations.length === 0) {
    return [
      heading('Proctoring signals'),
      { text: 'Nothing was recorded during this attempt.', style: 'note' },
    ];
  }

  return [
    heading('Proctoring signals'),
    note(
      'Context for the recruiter, never a conclusion. None of these affected the score or the recommendation.',
    ),
    {
      table: {
        headerRows: 1,
        widths: ['*', 60],
        body: [
          tableHeader(['Signal', 'Count']),
          ...violations.map((violation): TableCell[] => [
            EVENT_LABEL[violation.eventType] ?? violation.eventType,
            figure(String(violation.count)),
          ]),
        ],
      },
      layout: TABLE_LAYOUT,
    },
  ];
}

/** How one answer reads in the detail table's outcome column. */
function outcome(answer: AnswerDetail): TableCell {
  if (answer.selectedOption === null) {
    return { text: 'Unanswered', color: MUTED };
  }
  if (answer.isCorrect === null) {
    // Trait questions have no right answer, which is the point of them.
    return { text: answer.behavior ?? '—', color: MUTED };
  }
  return {
    text: answer.isCorrect ? 'Correct' : 'Incorrect',
    color: answer.isCorrect ? SUCCESS : DANGER,
  };
}

function answerRows(answers: AnswerDetail[]): TableCell[][] {
  return answers.map((answer) => {
    const chosen =
      answer.ranking !== null
        ? answer.ranking
            .map((choice, i) => `${i + 1}. ${choice.text}`)
            .join('  ')
        : (answer.selectedOptionText ?? 'No answer recorded');

    const cells: TableCell[] = [
      { text: `Q${answer.sequenceNumber}`, style: 'note' },
      stack([
        { text: answer.questionText },
        { text: chosen, style: 'note', margin: [0, 2, 0, 0] },
        answer.probe
          ? {
              text:
                answer.probe.partnerSequence === null
                  ? 'Repeat check — the twin never came round'
                  : `Repeat check ${answer.probe.role === 'first' ? 'with' : 'of'} Q${answer.probe.partnerSequence}`,
              style: 'note',
              italics: true,
            }
          : null,
      ]),
      { text: answer.moduleName, style: 'note' },
      outcome(answer),
      figure(formatMillis(answer.timeTakenMs), 'note'),
    ];
    return cells;
  });
}

function detailBlocks(detail: ReportDetailView): Content[] {
  const blocks: Content[] = [
    // Its own page: the summary above is what gets read, and the evidence
    // below is what gets checked when somebody disagrees with it.
    { text: '', pageBreak: 'before' },
    heading('Full detail — every answer'),
    note(
      'Queried live from the responses, never stored on the report. The order is the order they were served in.',
    ),
  ];

  if (detail.answers.length === 0) {
    blocks.push({ text: 'No answers were recorded.', style: 'note' });
  } else {
    blocks.push({
      table: {
        headerRows: 1,
        widths: [26, '*', 66, 52, 40],
        body: [
          tableHeader([
            '#',
            'Question and answer',
            'Section',
            'Outcome',
            'Time',
          ]),
          ...answerRows(detail.answers),
        ],
      },
      layout: TABLE_LAYOUT,
    });
  }

  blocks.push(heading('Full detail — proctoring events'));

  if (detail.events.length === 0) {
    blocks.push({ text: 'No events were recorded.', style: 'note' });
  } else {
    blocks.push({
      table: {
        headerRows: 1,
        widths: ['*', 130],
        body: [
          tableHeader(['Event', 'When']),
          ...detail.events.map((event): TableCell[] => [
            EVENT_LABEL[event.eventType] ?? event.eventType,
            { text: formatDateTime(event.occurredAt), style: 'note' },
          ]),
        ],
      },
      layout: TABLE_LAYOUT,
    });
  }

  return blocks;
}

// ── the document ──────────────────────────────────────────────────────────

/**
 * A filename that sorts and reads well in a downloads folder.
 *
 * Everything outside a conservative set is replaced rather than escaped:
 * this string ends up in a `Content-Disposition` header, and a quote or a
 * newline in a candidate's name has no business reaching it.
 */
export function reportFileName(view: ReportSummaryView): string {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 40);

  const parts = [
    slug(view.candidate.fullName) || 'candidate',
    slug(view.assessment.title) || 'assessment',
    (view.timing.submittedAt ?? view.timing.startedAt).slice(0, 10),
  ];

  return `adaptivehire-${parts.join('-')}.pdf`;
}

export async function buildReportPdf(
  view: ReportSummaryView,
  detail: ReportDetailView,
): Promise<Buffer> {
  ensureFonts();

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 46, 40, 44],
    info: {
      title: `${view.candidate.fullName} — ${view.assessment.title}`,
      author: 'AdaptiveHire',
      subject: 'Candidate assessment report',
    },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: INK, lineHeight: 1.25 },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] },
      h2: { fontSize: 12, bold: true, color: INK },
      h3: { fontSize: 10, bold: true, margin: [0, 0, 0, 2] },
      th: { fontSize: 8, bold: true, color: MUTED },
      label: { fontSize: 8, color: MUTED },
      note: { fontSize: 8, color: MUTED },
      score: { fontSize: 24, bold: true },
    },
    header: (currentPage: number) =>
      // Repeated on every page but the first, so a page that gets separated
      // from the rest still says whose report it is.
      currentPage === 1
        ? ''
        : {
            columns: [
              { text: view.candidate.fullName, style: 'note' },
              {
                text: view.assessment.title,
                style: 'note',
                alignment: 'right',
              },
            ],
            margin: [40, 20, 40, 0],
          },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: 'Confidential — for hiring use within your organisation.',
          style: 'note',
        },
        {
          text: `${currentPage} of ${pageCount}`,
          style: 'note',
          alignment: 'right',
        },
      ],
      margin: [40, 12, 40, 0],
    }),
    content: [
      ...headerBlock(view),
      { text: '', margin: [0, 8, 0, 0] },
      scorePanel(view),
      ...findingsBlock(view),

      heading('Section breakdown'),
      ...(view.modules.length > 0
        ? view.modules.map(moduleBlock)
        : [{ text: 'No sections were scored.', style: 'note' } as Content]),

      ...(view.profiles.length > 0
        ? [
            heading('Behavioural composites'),
            note(
              'Fixed authored weightings over the workplace traits — fit for a kind of work, never a rating of the person.',
            ),
            ...view.profiles.map(profileBlock),
          ]
        : []),

      ...violationsBlock(view.violations),
      ...detailBlocks(detail),
    ],
  };

  return pdfMake.createPdf(definition).getBuffer();
}
