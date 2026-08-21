# AdaptiveHire — Project Handbook

> A complete guide to what this platform is, how it is built, why it is built
> that way, and what we learned building it.
>
> Written for two readers at once: someone who needs to understand the product
> without opening an editor, and a developer who has to work in the code
> tomorrow. Section 1–3 are the former. Section 4 onwards is the latter.

**Status:** v1 feature-complete across all six planned build steps.
**Last updated:** 2026-08-21.

---

## Table of contents

**Part I — The product**
1. [What AdaptiveHire is](#1-what-adaptivehire-is)
2. [Who uses it, and how](#2-who-uses-it-and-how)
3. [The two journeys, end to end](#3-the-two-journeys-end-to-end)

**Part II — The system**
4. [Tech stack, and why each piece](#4-tech-stack-and-why-each-piece)
5. [Repository map](#5-repository-map)
6. [Data model](#6-data-model)
7. [The adaptive engine](#7-the-adaptive-engine)
8. [The behavioural engine](#8-the-behavioural-engine)
9. [Repeat consistency probes](#9-repeat-consistency-probes)
10. [The session runtime](#10-the-session-runtime)
11. [Proctoring](#11-proctoring)
12. [The readiness check and practice run](#12-the-readiness-check-and-practice-run)
13. [Reporting](#13-reporting)
14. [Multi-tenancy and security](#14-multi-tenancy-and-security)
15. [The question bank](#15-the-question-bank)
16. [Background jobs and email](#16-background-jobs-and-email)
17. [API surface](#17-api-surface)
18. [Testing and CI](#18-testing-and-ci)

**Part III — What we learned**
19. [Challenges, bugs and lessons](#19-challenges-bugs-and-lessons)
20. [Deliberately out of scope](#20-deliberately-out-of-scope)
21. [Running it, and a demo script](#21-running-it-and-a-demo-script)

---

# Part I — The product

## 1. What AdaptiveHire is

AdaptiveHire is a recruitment assessment platform. A company invites candidates
to sit a test; the test measures both **ability** (aptitude, logical reasoning,
verbal ability) and **workplace behaviour**; the company gets a report detailed
enough to defend a hiring decision.

The word that matters is **adaptive**. The test is not a fixed paper. It picks
each question based on how the candidate has answered so far:

- Answer correctly, and the next question is harder.
- Answer incorrectly, and the next is easier.
- Once the system is confident about where a candidate sits, the section ends —
  even if that is before the maximum number of questions.

Three consequences follow from that, and they are the product's whole argument:

| | Fixed test | AdaptiveHire |
|---|---|---|
| **Paper** | Everyone gets the same questions | Every candidate gets a different paper |
| **Length** | Fixed | Varies with how quickly the estimate settles |
| **Result** | "14 out of 20" | An ability estimate on a continuous scale, plus how confident we are in it |

Because two candidates never see the same sequence, sharing answers is close to
worthless. Because the test stops when it is confident, a strong candidate is
not made to grind through twenty easy questions to prove it.

### What it is not

We were disciplined about scope, and the exclusions are as deliberate as the
features. AdaptiveHire v1 contains **no machine learning**, **no real IRT
psychometric calibration**, and **no coding/compiler assessment**. Everything
the report says is produced by rules a recruiter could reproduce by hand with a
calculator. That is a feature: a hiring decision that cannot be explained is a
hiring decision that cannot be defended.

---

## 2. Who uses it, and how

There are exactly **two roles**, not three. There is no separate "admin" —
recruiter and admin responsibilities are merged into one `recruiter_admin`
role.

**Candidate**
Registers or is provisioned by an invitation, sees the assessments they have
been invited to, sits the test, cannot go back to an answered question.
A candidate belongs to **no company**. The same person can sit assessments for
three different employers with one login.

**Recruiter / Admin**
Registers their company, builds assessments out of subject modules, invites
candidates, manages the question bank, and reads the reports.

### A second axis: organisation roles

`role` answers *"which side of the platform is this?"* — it drives the portal
separation, the route guards, and which JavaScript bundle the browser is even
allowed to download.

`orgRole` answers *"what may you do inside your company?"* and is a separate
enum, ordered by privilege:

| Org role | Can do |
|---|---|
| `viewer` | Reads everything the organisation can see. Changes nothing. |
| `hiring_manager` | Creates assessments, invites candidates, reviews their own requisitions |
| `admin` | The whole workspace — question bank, people, settings |
| `owner` | An admin who can also hand the workspace to somebody else |

These are two axes on purpose. Folding four workspace roles into `UserRole`
would mean listing all four on every `@Roles(...)` decorator in the codebase,
and one omission would lock a whole role out of a page with no obvious cause.

---

## 3. The two journeys, end to end

### The recruiter's journey

1. **Register the company.** `/recruiter/register` creates a `users` row *and*
   an `organisations` row. That organisation is the tenancy boundary for
   everything that follows.
2. **Build an assessment.** Pick subject modules (Aptitude, Logical Reasoning,
   Verbal Ability, Personality). For each, set a minimum and maximum question
   count and a time limit. Optionally curate a question pool — no pool means
   the engine draws on everything the organisation can see.
3. **Invite candidates.** One email at a time, or a spreadsheet upload.
   Inviting an address with no account **provisions one** and emails working
   credentials. Inviting an address that already has an account never re-issues
   a password — it gets a "sign in as usual" email instead.
4. **Watch progress.** The assessment page shows who has started, finished, or
   not replied.
5. **Read the report.** A summary layer (scores, strengths, weaknesses,
   rule-based recommendation, violation counts) and a detail layer
   (question-by-question answers, the timestamped proctoring log).
6. **Decide.** Shortlist, reject, tag, leave a note, message the candidate, or
   send a rejection email. Download the report as a real PDF.

### The candidate's journey

1. **Sign in** at `/login` — a separate page from the recruiter's.
2. **See the assessment list.** Everything they have been invited to, with
   whether it is open, scheduled, or done.
3. **Readiness check.** A one-step-at-a-time wizard: browser, screen, camera,
   microphone, connection. **Every check must pass.** The camera step is live —
   it watches for exactly one properly framed face inside an on-screen oval.
4. **Sample test.** Three untimed, unscored practice questions, so the first
   time somebody meets a ranking control is not while the clock is running.
5. **The assessment.** Section by section. A branded splash announces each one.
   Camera must be on to press Begin. The clock starts on Begin, not on page
   load.
6. **Submit** — or have it auto-submitted when the clock runs out, which fires
   server-side even if the browser has been closed.

---

# Part II — The system

## 4. Tech stack, and why each piece

### Backend

| Piece | Choice | Why |
|---|---|---|
| Framework | **NestJS** (TypeScript) | Dependency injection makes the five engine services independently testable; decorators give clean guard/role plumbing |
| Database | **PostgreSQL 16** + **TypeORM** | Relational integrity matters — a report must never reference a deleted session. JSONB for trait scores |
| Live state | **Redis 7** | Session state and timers. TTL keys give a server-authoritative clock for free |
| Jobs | **BullMQ** | Auto-submit, report generation, invite emails. Same Redis instance |
| Realtime | **Socket.IO** via NestJS Gateway | Proctoring events stream from browser to `proctoring_logs` |
| Auth | **JWT** + **Passport** | Short-lived access token in memory, refresh token in an httpOnly cookie |
| Hashing | **Argon2** | Current best-practice password hashing |
| Validation | **class-validator** / **class-transformer** | Every DTO validated at the boundary |
| Security | **helmet**, **@nestjs/throttler** | Standard headers; rate limits on auth and assessment endpoints |
| PDF | **pdfmake** | Pure JavaScript — nothing added to the container, and output is selectable vector text |
| Email | **nodemailer** | Falls back to an Ethereal test inbox in dev |
| Spreadsheets | **csv-parse**, **exceljs** | Bulk question import and candidate invite upload |
| Logging | **nestjs-pino** | Structured request logs |
| Errors | **@sentry/nestjs** | Exception reporting |

### Frontend

| Piece | Choice | Why |
|---|---|---|
| Framework | **React 19** + **Vite 8** | One app, role-based routing |
| Routing | **react-router-dom 7** | Recruiter screens are lazy-loaded as separate chunks |
| HTTP | **axios** | Interceptor handles silent token refresh |
| Realtime | **socket.io-client** | Proctoring event channel |
| Face detection | **face-api.js** | Runs entirely in the browser. **No video is ever sent to the server** |
| Audio level | **Web Audio API `AnalyserNode`** | Reads a level and discards the samples. No audio is recorded, buffered or transmitted |
| Linting | **oxlint** | Fast |

### Infrastructure

**Docker Compose** runs Postgres, Redis and the backend locally. **GitHub
Actions** runs the same `npm run verify` gate that a developer runs locally —
CI deliberately has no private definition of "passing" that can drift.

### Notable non-choices

- **pdfmake, not headless Chrome.** Puppeteer would have meant shipping a
  browser inside the container. Trade-off accepted: the PDF is a second
  rendering of the report and can drift in *layout*, though never in *data*
  (both are built from the same payloads).
- **Elo, not IRT.** A simple statistical update, tuned so an 8–15 question
  module converges. Real psychometric calibration needs thousands of
  pre-calibrated items we do not have.
- **No email verification on registration.** A known, accepted trade-off:
  bulk fake accounts are possible.

---

## 5. Repository map

```
AdaptiveHire/
├── docker-compose.yml          Postgres + Redis + backend
├── .env.example
├── CLAUDE.md                   The living spec and decision log
├── docs/
│   ├── database-schema.md
│   ├── setup.md
│   └── PROJECT-HANDBOOK.md     ← this file
│
├── backend/                    NestJS — 186 TypeScript files
│   ├── src/
│   │   ├── auth/               JWT, guards, strategies, password reset
│   │   ├── users/              Candidates + recruiters, People directory
│   │   ├── organisations/      Company workspaces, branding
│   │   ├── modules-catalog/    The `modules` (subjects) table
│   │   ├── question-bank/      Questions, forks, item analysis, practice
│   │   │   ├── entities/       question / mcq-details / personality-details
│   │   │   └── bulk-import/    Spreadsheet parser + CSV fixtures
│   │   ├── assessments/        Assessment config, modules, question pools
│   │   ├── invitations/        Invites, bulk invite, candidate attempt view
│   │   ├── adaptive-engine/    ★ THE CORE — five services
│   │   │   ├── evaluation/
│   │   │   ├── ability-estimator/
│   │   │   ├── question-selector/
│   │   │   ├── stopping-engine/
│   │   │   ├── consistency-probe/
│   │   │   └── adaptive-engine.service.ts
│   │   ├── sessions/           Session lifecycle + Redis state
│   │   ├── proctoring/         WebSocket gateway, event logging
│   │   ├── reports/            Report builder, PDF, behavioural profiles
│   │   ├── queues/             BullMQ workers
│   │   ├── mail/
│   │   ├── common/             Enums, decorators, audit log, logging
│   │   └── database/           27 migrations + 8 seed scripts
│   └── test/                   15 end-to-end suites
│
└── frontend/                   React — 63 TypeScript files
    └── src/
        ├── routes/
        │   ├── candidate/      Assessments, ReadinessCheck, TakeAssessment
        │   └── recruiter-admin/ Dashboard, Questions, Reports, Settings…
        ├── components/
        │   ├── assessment/     QuestionCard, Timer, ModuleProgress, Ranking
        │   └── questions/      QuestionEditor, QuestionPoolPicker
        ├── hooks/              useSession, useProctoring
        └── lib/                api, socket, face-framing, audio-monitor…
```

### Recruiter navigation is *sections*, not pages

The top bar lists exactly six: **Dashboard, Assessments, Question bank,
Modules, People, Settings**. A section with more than one view carries its own
tab strip rather than claiming another slot in the bar:

- Question bank → Questions · Performance · Bulk import
- Settings → Workspace · My account

---

## 6. Data model

27 migrations, 19 entities. The core tables:

### People and tenancy

- **`organisations`** — a company workspace. Created when a recruiter registers.
- **`users`** — `role` is `candidate` or `recruiter_admin`; `orgRole` is the
  privilege axis. **`organisationId` is set for every recruiter and null for
  every candidate, permanently.**

### Content

- **`modules`** — subjects as a *reference table*, not a hardcoded enum. Each
  has a `scoring_type` of `objective` or `trait`. New subjects can be added as
  pure data with no code change.
- **`questions`** — the shared parent (text, module, status, tags,
  `probeGroup`, `isSample`, `organisationId`, `forkedFromId`). Split 1:1 into:
  - **`mcq_question_details`** — options, correct option, `difficultyScore`
    (Elo scale), `timesUsed`, `timesCorrect`
  - **`personality_question_details`** — options with per-option
    `trait_weights` JSON, plus a `pattern`

`questions.organisationId` being **null means platform-owned** — the starter
bank every organisation can use.

### Assessments

- **`assessments`** / **`assessment_modules`** — a named test made of modules,
  each with min/max counts and a time limit
- **`assessment_questions`** — the *optional* curated pool. **No rows means no
  restriction.**
- **`invitations`** — keyed on **email**, with a nullable `candidateId`
  backfilled at provision or registration

### Runtime and results

- **`assessment_sessions`** — the permanent record. Written once at start and
  once at end. Live state lives in Redis, not here. `invitationId` is
  **unique** — one invitation is worth exactly one attempt, ever.
- **`session_module_results`** — final ability per objective module;
  `traitScores` JSONB storing both a score *and* a confidence per trait;
  `probeResults`
- **`responses`** — one row per answered question, including
  `abilityEstimateAfter` (kept long-term for future engine tuning)
- **`proctoring_logs`** — one row per security event
- **`reports`** — narrative output only. Does not duplicate per-question
  detail; that is queried live.
- **`candidate_reviews`** / **`candidate_messages`** — the recruiter's decision
  and what was said to the candidate
- **`audit_log`** — who did what

---

## 7. The adaptive engine

This is the core of the product, and it was built and validated over HTTP
**before any UI existed**. Five cooperating services under
`backend/src/adaptive-engine/`.

### 7.1 Evaluation Service

Scores one submitted answer. For an `objective` module: correct or incorrect.
For a `trait` module: turns the chosen option (or the ordering, for a ranking)
into per-trait weight deltas.

### 7.2 Ability Estimator Service — the Elo update

Every candidate starts at **1000**, the same as the default question
difficulty. After each answer:

```
expected     = 1 / (1 + 10^((question_difficulty − candidate_ability) / 400))
new_ability  = old_ability + K × (actual_outcome − expected)
```

Two refinements that matter:

**K decays.** `K_EARLY = 48` for the first five answers, then `K_LATE = 24`.
The estimate moves fast when we know almost nothing and settles afterwards, so
one late fluke cannot undo a module.

**Questions drift too.** The item's own difficulty updates with a much smaller
`K_QUESTION = 8`. A "medium" question everybody gets wrong is really a hard
one — but an item's difficulty should only move meaningfully after many
candidates have seen it.

### 7.3 Question Selector Service

For **objective** modules: shortlist the ~5 closest difficulty matches among
unanswered questions, then pick one at random. The randomisation is the point —
two candidates of the same ability must not see the same paper.

For **trait** modules: pick a question covering whichever trait currently has
the lowest confidence, and balance across the four behavioural patterns.

The selector is also where **tenancy** is enforced: it can only serve questions
the assessment's owning organisation can see.

### 7.4 Stopping Engine Service

A module ends when a confidence threshold is met **or** the maximum count is
hit, subject to a configured minimum. Confidence is two halves multiplied
together, and the second half is what makes test length vary between people:

**Precision** — how far the standard error has shrunk from the starting spread.
This depends only on *which* questions were served, not how they were answered.
On its own it would stop every well-matched candidate at the same question.

**Stability** — has the estimate actually stopped moving? Measured over the
last `STABILITY_WINDOW = 4` estimates against a `STABILITY_BAND` of 80 Elo. A
candidate answering consistently at their level settles quickly; an erratic one
keeps swinging and **earns more questions**.

### 7.5 Orchestration

Everything hangs off two endpoints: **get next question** and **submit
answer**. The `AdaptiveEngineService` reads and mutates a plain `ModuleRunState`
object and never touches the session store — which means the entire engine can
be driven from a unit test with a literal object.

### Key constants

| Constant | Value | Meaning |
|---|---|---|
| `STARTING_ABILITY` | 1000 | Where every candidate begins |
| `ELO_D` | 400 | A 400-point gap = 10:1 expected win ratio |
| `K_EARLY` / `K_LATE` | 48 / 24 | Step size, switching after 5 answers |
| `K_QUESTION` | 8 | How fast an item's difficulty drifts |
| `ABILITY_CONFIDENCE_THRESHOLD` | 0.7 | ≈120 Elo standard error; reached at 8–9 questions |
| `STABILITY_WINDOW` / `_BAND` | 4 / 80 | Recent estimates must sit inside ~24 Elo |
| `SELECTOR_SHORTLIST_SIZE` | 5 | Randomise among the 5 best matches |
| `TRAIT_TARGET_QUESTIONS` | 3 | Answers per trait before it counts as covered |
| `PROBE_GAP_QUESTIONS` | 8 | Distance between a probe and its twin |

---

## 8. The behavioural engine

The personality module does **not** use agree/disagree Likert statements as its
main instrument — those are trivially gameable, because the desirable answer is
readable off the scale. Instead there are **four question patterns**:

| Pattern | Shape |
|---|---|
| `situational` | A workplace scenario, one choice |
| `forced_choice` | Two equally *positive* alternatives — measures preference, not quality |
| `trade_off` | Two competing priorities, e.g. speed against thoroughness |
| `ranking` | Every option ordered, most-like-you first. Position changes the weight |

Legacy Likert items still exist, and stay servable at roughly **1 in 12** —
kept for bank depth, but a garnish, never the meal.

### Ten workplace traits

Big Five was replaced in August 2026 with a vocabulary a recruiter actually
uses: **Leadership, Ownership, Accountability, Teamwork, Communication,
Empathy, Integrity, Adaptability, Resilience, Risk Tolerance.**

Per-option weights run **−3 to +3**. Ranking weights are **averaged per trait,
never summed** — otherwise a trait carried by several options in one ranking
would contribute beyond the scale and outweigh several single-choice answers.

### Five role composites

Ten trait scores do not answer the question a recruiter actually has, which is
never "how agreeable is this person" but "would they lead this team". So the
report derives five composites, each a fixed authored weighting:

| Composite | What it says |
|---|---|
| **Leadership Readiness** | Takes charge, sets direction, carries others |
| **Team Collaboration** | Works *with* people rather than around them |
| **Reliability & Follow-Through** | Closes commitments without being chased |
| **Adaptability Under Pressure** | Holds up and re-plans when things change |
| **Integrity & Judgment** | Makes the defensible call when the convenient one exists |

Every weight sums to 1 and is readable in
`reports/behavioral-profiles.ts`. A recruiter can add the traits up by hand and
get the same number — which is the entire point of a rule-based report.

**A composite is withheld entirely when the evidence behind it is below
`MIN_TRAIT_CONFIDENCE`.** A number on screen gets acted on whatever caveat sits
beside it, so we show nothing rather than "50.8 — Moderate" next to a grey
disclaimer.

---

## 9. Repeat consistency probes

Questions can be **twinned** via `questions.probeGroup`: the same underlying
construct, reworded stem, and **reworded and reordered options**. The engine
serves one, holds the group back for 8 questions, then serves the twin and
compares.

The reordering is load-bearing. A twin whose options sit in the same order gets
answered by position and measures nothing. In testing, a candidate answering
"option A" every time was correctly flagged at 0.29 agreement *precisely
because* the equivalent choice sat elsewhere in the twin.

**Probes are report-only, with one exception.** A probe answer never moves an
ability estimate, a trait score or a confidence. The exception is the stopping
engine, which defers a `confidence_reached` stop while a pair is open and its
twin has not had its turn — stopping one question short of the twin spends a
question and reports nothing for it. Only the *fact* that a check is
outstanding is consulted, never how it was answered.

Getting the landing rate up was a genuine engineering problem — see
[19.6](#196-the-probe-landing-rate-61--90--100).

---

## 10. The session runtime

### Redis holds the live state; Postgres holds the record

`assessment_sessions` is written **once at start and once at end**. Everything
in between — current question, running ability estimate, which questions have
been seen — lives in Redis under `RedisSessionService`.

### The clock is server-authoritative

There is no client `setInterval` that anything trusts. The deadline is a Redis
TTL key. The client shows a countdown; the server decides what time it is.

**Both clocks start on "Begin", never on page load.** There are two: the
per-module deadline and the session deadline that auto-submit fires on.

### Auto-submit

A **BullMQ delayed job** fires on the session deadline — even if the
candidate's browser has been closed, crashed, or lost power.

### Answers are final

No revisiting previous questions, enforced server-side in Redis state. The
runtime shows a numbered question queue above the question — answered filled,
current ringed, still-to-come dimmed — but it is **display only**: `<span>`s in
a list, never buttons. The server would refuse a jump backwards anyway, and a
clickable-looking chip that does nothing is worse than a label.

---

## 11. Proctoring

### What is detected

| Event | How |
|---|---|
| `tab_switch` | `blur` (debounced 700ms + `document.hasFocus()`) and `visibilitychange` |
| `fullscreen_exit` | Fullscreen API |
| `face_absent` | face-api.js, client-side |
| `multiple_faces` | face-api.js |
| `face_not_framed` | Position and size against an oval — `metadata.reason` carries `off_centre` / `too_far` / `too_close` |
| `multiple_displays_detected` | Window Management API `getScreenDetails()` |
| `background_noise` | Web Audio `AnalyserNode` reading a level |

All events stream over WebSocket into `proctoring_logs`.

### Privacy

**No video and no audio ever leaves the browser.** Face detection runs on the
client. The audio monitor reads a level and throws the samples away — the
platform never learns what was said, only that it was loud. That is also why
the event is called `background_noise` and not "talking": it cannot tell a
voice from a television, and the report says so.

### The philosophy: gates before, never penalties during

This is the single most important rule in the proctoring design.

**Before anything starts, checks are hard gates.** The readiness check must
pass in full. The camera must be on to press Begin.

**Once a module is underway, nothing a candidate does can end it.** Tab
switches, full-screen exits, a face briefly out of frame, a noisy room — all
recorded, none of them blocking. They are presented as data and the recruiter
makes the call.

The distinction that matters is **timing, not severity**.

---

## 12. The readiness check and practice run

### The wizard

One check per screen — browser, screen, camera, microphone, connection — and
**every step decides continuously**, not once:

- **Camera** runs live face detection against the preview and passes only while
  **exactly one face is properly framed inside the oval**. Cover the lens after
  passing and Continue disables again.
- **Microphone** passes only once the meter has **actually moved**. A device
  muted in the OS mixer opens fine and moves nothing.
- **Screen** re-evaluates on every `resize`, so un-maximising takes the pass
  away.
- **Connection** times three round trips to a real authenticated endpoint and
  takes the median, with a cache-busting nonce.

`OVAL` in `ReadinessCheck.tsx` is the **single source of truth**: the ring on
screen is drawn from those numbers via inline styles, so the ring the candidate
is asked to fill is by construction the ring being measured.

### The sample test

Three untimed, unscored questions drawn from `questions.isSample = true` —
which the adaptive selector and assessment pools both exclude, so a sample can
never be served for real or counted. Round-robin across the assessment's
subjects: three subjects give a tour of one apiece; one subject gives three
from it.

**Nothing is marked and nothing is revealed.** Pick an option, move on. A
right/wrong badge here teaches a candidate to dread the next screen rather than
to use it. The framing is deliberately light — one "Warm-up · not scored" chip
and nothing else. A rehearsal that does not feel real rehearses nothing.

---

## 13. Reporting

### Two layers

**Summary** (from the `reports` table): ability scores, trait profile, the five
composites, strengths, weaknesses, a rule-based hiring recommendation, and
violation counts.

**Detail** (queried live, never stored twice): the full question-by-question
answer list and the full timestamped proctoring log.

Report generation runs **asynchronously via a BullMQ job** triggered on
submission — the candidate never waits for it.

### The overall score

```
overallScore = ability × 0.70  +  behavioural index × 0.30
```

Whichever half the assessment did not measure drops out so the other takes full
weight. This means a personality-only assessment produces a real score and a
real recommendation instead of sitting at "borderline" forever.

Ability leads because it is the harder measure: an objective answer is right or
wrong, while a behavioural one is a self-report of what someone would do.

**What reaches the recommendation is fit for a kind of work, never a rating of
the personality**, and no single trait can move the outcome. Consistency,
repeat-probe results and proctoring signals reach it nowhere at all.

### Recommendation bands

| Overall score | Recommendation |
|---|---|
| ≥ 75 | Strongly recommended |
| ≥ 55 | Recommended |
| ≥ 40 | Borderline |
| below | Not recommended |

Capped at `borderline` if the candidate answered less than 60% of each module's
configured minimum — not as a penalty, but because there is not enough evidence
to say more.

### Standing

The Results page shows a **rank within that assessment's own cohort** — 1 is
the highest overall score, ties share a position (1, 2, 2, 4), and unscored
attempts get `null` rather than last place. The denominator counts scored
attempts only, so it always reads "2nd of 14".

### PDF

`GET /reports/sessions/:id/pdf` builds a real file with pdfmake, server-side.
It replaced `window.print()`, which could never open anything but the browser's
print dialog.

---

## 14. Multi-tenancy and security

### The rule

Every recruiter endpoint takes its scope from `@CurrentOrg()`, a decorator that
**throws** when the account has no organisation.

Never read `organisationId` off the user and assert it. A wrong `!` yields
`undefined`, TypeORM silently drops the clause, and a dropped tenant filter
returns **every customer's rows**.

### Other tenancy rules

- Another organisation's row returns **404, not 403**, so ids cannot be probed.
- A platform question returns **403** on write, because it is genuinely visible
  and genuinely read-only.
- Two paths are deliberately unscoped and commented as such:
  `AssessmentsService.findOneForSession` (the candidate runtime, reached
  through a session the candidate owns) and `ReportsService.generate` (the
  BullMQ worker, which has no requesting organisation).

### Portal separation

`POST /auth/login` takes an optional `portal`. A role mismatch is a **403**
naming the other page. This is enforced in `AuthService.login` **before**
issuing tokens — checking in the UI instead would be useless, because a
successful login has already set the httpOnly refresh cookie by the time the
client sees the role.

### Auth mechanics

- Access token: short-lived, **in memory only**. A page reload genuinely has
  none.
- Refresh token: **httpOnly cookie**, not localStorage. Rotated, with a grace
  window for races.
- Rate limits: 5/min on register, 10/min on login, 3/min on forgot-password.

---

## 15. The question bank

### Platform questions and copy-on-write forks

`questions.organisationId = null` means platform-owned — the starter bank every
organisation can use. **Platform questions are edited by copy-on-write, never
in place.**

Editing or hiding one creates a private fork carrying `forkedFromId`. That
organisation then sees its fork *instead of* the original, while every other
organisation keeps the pristine one. Hiding is a fork with `status = archived`.
Deleting a fork reverts that organisation to the platform version. Deleting a
platform question itself is refused — it is shared.

One fork per organisation per question, enforced by a **partial unique index**.

The visibility rule lives in exactly **one** file,
`question-bank/question-visibility.ts`, and is used by both the question bank
and the adaptive engine's selector:

```
organisationId = mine OR (organisationId IS NULL AND I have no fork of it)
```

### Content

**210 fixture questions** across four modules, plus **12 practice samples**
(3 per module):

| Module | Scoring | Fixtures |
|---|---|---|
| Aptitude | objective | 40 |
| Logical Reasoning | objective | 35 + 18 probe twins |
| Verbal Ability | objective | 30 + 18 probe twins |
| Personality | trait | 16 behavioural + 28 probe twins + 25 legacy Likert |

Questions arrive three ways: **bulk spreadsheet upload** (primary), an **admin
form** (single fixes), and a **seed script** for launch data. No AI-generated
questions and no third-party question APIs.

### Item analysis

`GET /questions/analysis` surfaces per-question performance — `timesUsed`,
`timesCorrect`, and drift in `difficultyScore` — so a broken item can be found
and archived.

---

## 16. Background jobs and email

Three BullMQ queues, all on the same Redis instance:

| Queue | Fires | Job |
|---|---|---|
| `auto-submit` | On the session deadline (delayed job) | Submits the attempt server-side |
| `report-generation` | On submission | Builds the report |
| `invite-emails` | On invite | Renders and sends |

**BullMQ keys on `jobId` and silently keeps an existing job rather than
replacing it.** When the session clock is rebased on Begin, the queued
auto-submit job must be **removed before the replacement is added** — see
[19.1](#191-the-clock-that-started-too-early).

In dev with no `MAIL_HOST`, the mailer creates a nodemailer **Ethereal** test
inbox and logs a clickable preview URL. Nothing reaches a real address.

---

## 17. API surface

All routes are prefixed `/api`. `@Roles` shows the audience; `@MinOrgRole`
shows the privilege floor.

### Auth — `/api/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/register` | Public, 5/min. Candidate (invite-gated) or company |
| POST | `/login` | Public, 10/min. Optional `portal` |
| POST | `/refresh` | Public. Reads the httpOnly cookie |
| POST | `/forgot-password` | Public, 3/min |
| POST | `/reset-password` | Public, 5/min |
| POST | `/logout` | |
| GET | `/me` | |

### Sessions — `/api/sessions` *(candidate)*

| Method | Path | Notes |
|---|---|---|
| POST | `/start` | Starts or resumes. Checks the scheduled window |
| GET | `/:id/next-question` | ★ Engine entry point |
| POST | `/:id/module/start` | Begins the clocks |
| POST | `/:id/answer` | ★ Engine entry point |

### Assessments — `/api/assessments` *(recruiter)*

| Method | Path | Min org role |
|---|---|---|
| POST | `/` | hiring_manager |
| GET | `/` · `/:id` | — |
| PUT | `/:id/questions` | hiring_manager |
| DELETE | `/:id` | admin |

### Invitations

| Method | Path | Audience |
|---|---|---|
| POST | `/assessments/:id/invitations` | hiring_manager |
| POST | `/assessments/:id/invitations/bulk-import` | hiring_manager |
| GET | `/assessments/:id/invitations` | recruiter |
| DELETE | `/invitations/:id` | hiring_manager |
| PATCH | `/invitations/:id/schedule` · `/revoke` | hiring_manager |
| GET | `/me/invitations` · `/:id` · `/:id/practice` | candidate |

### Question bank — `/api/questions` *(recruiter)*

| Method | Path | Min org role |
|---|---|---|
| GET | `/` · `/stats` · `/analysis` · `/:id` | — |
| POST | `/` | admin |
| PATCH | `/:id` · `/:id/activate` · `/:id/archive` | admin |
| DELETE | `/:id` | admin |
| POST | `/bulk-import` | recruiter |

### Reports — `/api/reports` *(recruiter)*

| Method | Path | Min org role |
|---|---|---|
| GET | `/assessments/:id` | — (the cohort list) |
| POST | `/assessments/:id/export` | — |
| GET | `/sessions/:id` · `/detail` · `/pdf` | — |
| PUT | `/sessions/:id/review` | hiring_manager |
| POST | `/sessions/:id/rejection-email` | admin |
| POST · GET | `/sessions/:id/messages` | hiring_manager · — |
| POST | `/sessions/:id/regenerate` | — |

### Users, modules, organisations

`/api/users` (`me`, directory, provision, delete, org-role, change-password),
`/api/modules` (CRUD, admin for writes), `/api/organisations/mine` (+ branding,
admin).

---

## 18. Testing and CI

```bash
cd backend && npm run verify
```

That runs — and fails loudly on — a clean TypeScript build, lint, unit tests,
and the full end-to-end suite. **CI runs the identical command**, so there is
no private definition of "passing" that can drift from a developer's machine.

**Current state: 15 e2e suites, 196 tests, all passing.**

| Suite | Covers |
|---|---|
| Step 1 | Foundation, rate limiting, refresh rotation + grace window |
| Step 2 | Question bank |
| Step 3 | **Tenancy isolation** |
| Step 4 / 6 | Password reset, reset link round trip |
| Step 5 | Audit log |
| Step 8 | Item analysis |
| Step 9 | Cohort view and review |
| Step 10 | Cohort export |
| Step 11 | Organisation roles |
| Step 12 | Completion notifications |
| Step 13 | Assessment windows |
| Step 14 | Organisation branding |

Eight unit suites cover the pure logic: the adaptive engine, the report
builder, attempt ranking, the PDF, the bulk-import row mapper, the roles guard,
assessment windows, and queue job ids.

Two purpose-built verification scripts exist because some invariants are not
expressible as unit tests:

- `check-session-clock.ts <assessmentId>` proves the clock invariant on a
  throwaway candidate and invitation it deletes afterwards.
- `check-report-pdf.ts` renders a PDF for eyeballing.

---

# Part III — What we learned

## 19. Challenges, bugs and lessons

This section is the honest one. Every item below is a real defect or a real
design dead-end, what caused it, and what it changed about how we work.

---

### 19.1 The clock that started too early

**Symptom.** A real attempt was auto-submitted with **zero answers** before a
single question had been served.

**Cause.** There are two clocks — the per-module deadline and the session
deadline that auto-submit fires on. The session one was set in
`createSession()`, which runs when the runtime **page loads**. So the entire
time budget drained while a candidate sat reading the intro screen.

**Fix.** `beginSessionClock` now rebases both `expiresAt` and `startedAt` when
the *first* module starts. `startedAt` moves too, deliberately: a recruiter
reads elapsed time as how long the attempt took, and leaving it at session
creation would include however long the intro screen sat open.

There was a second bug hiding inside the first: **BullMQ keys on `jobId` and
silently keeps the existing job rather than replacing it.** Adding the new
auto-submit job alone left the old, far-too-early deadline live. The queued job
must be *removed* before the replacement is added.

`createSession` still sets a placeholder deadline of `budget + 2h` purely so a
session cannot sit `in_progress` forever if somebody opens the runtime and
walks away.

> **Lesson.** "When does the clock start?" is a product question, not an
> implementation detail. And a queue that silently no-ops on a duplicate id
> will hide your bug rather than surface it.

---

### 19.2 Counting faces was not proctoring

**Symptom.** Two separate failures with one root cause. A candidate passed the
readiness check with their face jammed against the left edge of frame and the
alignment oval completely empty. And a camera angled at the ceiling with a head
in one corner logged **nothing** for an entire test.

**Cause.** Both places asked "how many faces are in the picture?" The answer
was one, so everything looked fine.

**Fix.** The rule now tests **position and size**, not count, and lives in
exactly one file — `lib/face-framing.ts` — used by both the readiness wizard
and the runtime. `watchFaces` returns **normalised boxes, not a count**.

A related bug: the alignment oval was briefly drawn from CSS and measured from
TypeScript. As two separate sets of numbers they drifted immediately, and the
ring on screen tested nothing at all. `OVAL` is now the single source of truth
and the ring is drawn from it via inline styles.

Another: `openCamera` requests a **4:3 stream** to match the preview's aspect
ratio. With `object-fit: cover` a 16:9 stream is cropped on screen while
detection still sees the full frame — so a face the candidate could not see
would count as inside the oval.

We also introduced `face_not_framed` as its own event type rather than reusing
`face_absent`. **An occupied chair reported as an empty one is a false claim in
a hiring record.**

> **Lesson.** A geometry rule kept in two places will drift. And name an event
> for what you actually measured, not for what you hope it implies.

---

### 19.3 A device answering is not a device doing its job

**Symptom.** The readiness check reported "Camera: Working" and let a candidate
through on a completely black frame.

**Cause.** The first version asked each question **once**, at the moment the
step opened. Opening a stream successfully is not the same as the stream
carrying a usable picture.

**Fix.** Every step is now **live and continuously re-deciding**. The camera
step passes only while exactly one face is properly framed. The microphone
passes only once the meter has actually moved past a threshold — a device muted
in the OS mixer opens fine and moves nothing. The screen step re-evaluates on
`resize`. Continue is bound to the verdict *right now*.

`STABLE_SAMPLES` requires agreeing consecutive reads before a verdict flips, so
a face near a threshold does not strobe the step between pass and fail.

> **Lesson.** The wizard existed to prevent exactly this bug and reproduced it,
> because it checked at the wrong moment. Ask "is it working *now*", not "did
> it start".

---

### 19.4 Tab switching cannot be blocked

**The ask.** "Disable tab switching completely."

**The finding — recorded so nobody re-derives it.** It is **not achievable in a
browser**:

- Alt+Tab, Cmd+Tab, the Windows key and Mission Control are handled by the
  **operating system** and never reach the page.
- Ctrl+T, Ctrl+W, Ctrl+N and Ctrl+Tab are **browser-reserved**;
  `preventDefault` on them does nothing in Chrome.
- `navigator.keyboard.lock()` is limited *by spec* to "keys granted access by
  the underlying operating system" — which excludes the window switcher.
  Fullscreen does not change this.
- Real prevention needs a native lockdown client (SEB-style), which is out of
  scope for v1.

**What shipped instead.** Detect, warn hard, record. Leaving raises a warning
with **no dismiss button** — it stands for the rest of the section and its
count rises inline. An acknowledge button is only ever pressed to make the
message go away.

Because there is no acknowledgement, the "currently away" latch resets on
**return**, not on dismissal. Miss that and every switch after the first goes
unlogged.

Two things keep the detection honest: `blur` is debounced by 700ms and
re-checked with `document.hasFocus()`, and a **focus trap** wraps Tab inside
the assessment shell — tabbing past the last control used to land in the
browser's address bar and register as leaving.

**A blackout overlay was built and removed the same day.** `blur` fires on any
transient focus change — an OS notification, a permission dialog, a keyboard
user tabbing one control too far — and hiding the question in those cases takes
the test away from a candidate who did nothing wrong while their clock runs.

> **Lesson.** When a request is impossible, say so plainly, write down *why*,
> and ship the honest alternative. And a mitigation that fires on false
> positives is worse than the problem.

---

### 19.5 Everyone could read everyone's data

**Symptom.** Nothing was tenant-scoped. `createdById` and `invitedById` were
written on every row and **never appeared in a single `WHERE` clause**. Any
logged-in recruiter could read every assessment, every candidate report — name,
email, answers, proctoring log — and every invitation list on the platform.

**Why it was survivable, then suddenly wasn't.** While recruiters were
hand-seeded colleagues, this was harmless. The moment a stranger could sign up,
it was a personal-data breach.

**Fix.** Organisations, and `@CurrentOrg()` on every recruiter endpoint. Two
follow-on holes were found and closed during the same work:

- **The selector had no organisation clause at all** — meaning one customer's
  private questions were eligible to be served to another customer's
  candidates. `ModuleRunState.organisationId` (the assessment's owner, since a
  candidate has none) is what closed it.
- **The People directory needed two rules, not one.** A recruiter matches on
  `users.organisationId`, but a candidate belongs to no organisation, so they
  appear only where this organisation has invited them. It was unscoped until
  2026-08-13 — a brand-new organisation that had invited nobody could read
  every account on the platform.

> **Lesson.** **Tenancy and self-registration must always ship together.**
> Never one without the other. And `user.organisationId!` is the most dangerous
> character in a TypeScript codebase — a wrong non-null assertion gives
> `undefined`, TypeORM drops the clause, and the query quietly returns
> everything.

---

### 19.6 The probe landing rate: 61% → 90% → 100%

**Problem.** Repeat probes only work if both halves of a pair actually get
served. Left to chance, only **61%** of runs closed the pair.

**Why authoring more pairs did not help.** The window for *opening* a pair is
only `maxQuestions − PROBE_GAP_QUESTIONS` wide — three slots on a 12-question
module. Probe questions would have had to exceed 50% of the bank to reach 90%.

**Step 1 (61% → 90%).** The selector now *asks* for a probe question while the
window is open, rather than waiting for one to turn up. It does so through the
module's normal rules restricted to probe-carrying questions, so difficulty
matching and trait targeting are unaffected, and it falls through to ordinary
selection when no probe fits.

**Step 2 (90% → 100%).** The remaining misses were modules that legitimately
stopped on `confidence_reached` before the twin's turn — a real interaction,
since probe questions weighting four traits each accelerate trait coverage and
so bring the confidence stop *forward*. The stopping engine now defers a
confidence stop while a pair is outstanding.

**The measured cost, accepted explicitly:** about 2 extra questions on runs
that would have stopped early, and the adaptive-length spread on a 12-question
module narrows from 9–12 to 11–12.

> **Lesson.** Measure the rate before and after. "It should mostly work" was
> 61%. And when you add a feature, check what it does to the *other* features'
> stopping conditions.

---

### 19.7 A personality-only test reported "no result"

**Symptom.** An assessment made only of the Personality module produced ten
trait scores, an `overallScore` of `null`, and a permanent `borderline` — which
reads as "we could not assess this person" to a candidate who had answered
every question put to them.

**Cause.** An earlier rule said traits never touch the hiring recommendation.
Defensible in principle, but it meant the recommendation had no input at all
when ability was not measured.

**Fix.** The five role composites, and `overallScore = ability 70% /
behavioural 30%`, with whichever half was not measured dropping out.

This **deliberately reverses** the earlier rule, and the reversal is narrow:
what reaches the recommendation is *fit for a kind of work*, never a rating of
the personality, and no single trait can move the outcome.

> **Lesson.** A principle that produces a nonsense output in a real case needs
> revisiting, not defending. And when you reverse a documented decision, write
> down that you reversed it — otherwise someone "fixes" it back.

---

### 19.8 Migrations with no source

**Symptom.** The database had two migrations recorded in the `migrations` table
whose `.ts` files had **never existed in git**.

**Why it was dangerous.** TypeORM will never re-run a recorded migration. So
the schema worked perfectly on the machine where it was applied and would have
broken on any fresh database or CI run. It was silent.

**Cause.** Migrations were run outside the repo's workflow, so the source was
lost while the effect persisted.

**Fix.** Both were reverted and rebuilt properly.

**The standing check:** before any schema work, compare `SELECT name FROM
migrations` against the files in `backend/src/database/migrations/`. They must
match exactly.

> **Lesson.** "It works on my machine" has a database-shaped variant that is
> much harder to spot, because nothing errors.

---

### 19.9 Validation that ran too late

**Symptom.** A rejected question pool returned a 400 — and left behind an
assessment the recruiter never asked for.

**Cause.** The assessment was created first and the pool validated afterwards.

**Fix.** Validation runs **before** anything is written, and the assessment plus
its pool are inserted in **one transaction**.

> **Lesson.** A failed request must leave nothing behind. Order of operations
> is part of the contract.

---

### 19.10 Withdrawing an invitation could delete a real person

**Symptom.** Removing an invitation also deleted the account it created — which
is correct for an untouched provisioned account, and catastrophic for a real
person who had since set their own password and sat other assessments.

**Fix.** The account is only removed if it is still demonstrably untouched:
candidate role, `mustChangePassword` still set, no other invitation anywhere,
and no session.

Related: inviting an address that **already** has an account never re-issues
credentials. That account is org-less and shared, so minting a password for it
would hand the inviting recruiter a way into another company's results.

> **Lesson.** Cleanup logic needs to prove the thing it is cleaning up is
> disposable, not assume it.

---

### 19.11 A standing nobody could reproduce

**Symptom.** The Results page showed a percentile ranked against a
**platform-wide** norm table pooling every organisation's attempts.

**Why it was wrong.** A recruiter could not reproduce it. It silently dropped
modules with fewer than 20 platform samples. And a module answered once ranked
with the same apparent authority as one answered twelve times.

**Fix.** Standing is now a plain rank **within one assessment's own cohort**.
Each assessment is its own cohort — different modules, different length,
different pool — so a position only means something against people who sat the
same test.

The whole norms subsystem, the `module_norms` table and the nightly recompute
were removed. No data was lost: every norm row was an aggregate over data we
still hold.

> **Lesson.** A number a user cannot reproduce is a number they cannot act on.

---

### 19.12 A test that had never passed

**Symptom.** CI went red on `step9-cohort-review`, on a test asserting
`rows[0].meanPercentile` was null or between 1 and 99.

**Cause.** `meanPercentile` no longer existed — it had been replaced by
`rank` / `cohortSize` (19.11). The value was `undefined`, so the assertion was
`false`.

**Why it compiled.** The spec declared its own local `Attempt` interface and
cast the response with `res.body as Attempt[]`. **A cast asserts a shape; it
does not check one.** `git log -S meanPercentile --all` showed the string only
ever appeared in that test file — it was never a rename that got missed. The
test had been red since the commit that introduced it.

**Fix.** The assertion now tests the contract that exists, and asserts at least
one row *is* ranked so it cannot pass vacuously.

> **Lesson.** `as` in a test is a hole in your type safety exactly where you
> most need it. And when a test fails, check whether it ever passed.

---

### 19.13 One CSS class, two features

**Symptom.** On both sign-in pages, the subtitle sat squashed *beside* the
heading instead of under it.

**Cause.** `.al-head` was defined **twice** in `index.css` — once meaning
"**a**uth **l**eft" (the sign-in heading, `flex-direction: column`) and once
meaning "**a**ssessment **l**ist" (the table header,
`flex-direction: row; align-items: center`). Same specificity, and the
assessments rule sat ~3,700 lines later, so it won on the auth pages.

**Fix.** Renamed the list one to `.al-list-head`.

**A second issue the fix surfaced.** Stacking the heading made it ~54px taller,
and the panel centres its body with `overflow: hidden` (it has to — the ambient
glows are 680px circles). Centred content that does not fit overflows **both**
ends, so the top gets clipped and cannot be scrolled back to. Measured: the
panel needs ~689px and gets `viewport − 64px`, so it clipped below a 753px
viewport — and a 1366×768 laptop leaves roughly 640px. A `max-height`
breakpoint now tightens the vertical rhythm, bringing the requirement to 604px.

> **Lesson.** An abbreviated CSS prefix is a collision waiting to happen. And
> when a layout change adds height, measure what it cost — do not assume the
> slack was there.

---

### 19.14 A splash that the router unmounted

**Symptom.** A branded splash after sign-in never appeared.

**Cause.** `GuestOnly` redirects the instant `login()` puts the user in the auth
context. A splash rendered inside the sign-in page was unmounted along with the
page, immediately.

**Fix.** Mount it **above the router**. That turned out to be better than a
workaround: the navigation now happens underneath, so the destination mounts,
downloads its lazy chunk and fetches its data *behind* the overlay. The splash
**covers** work instead of adding to it.

The same insight drove the page-load splash: it waits on the real auth refresh
with a *minimum* display time, because a fixed hold would make a fast reload
slower than the blank page it replaced.

One real defect found while testing it: the destination page's scrollbar showed
through the fixed overlay, and a stray wheel scroll moved a page nobody could
see. The splash now locks `body` overflow and restores it on unmount.

> **Lesson.** When a component keeps getting destroyed, the fix is usually to
> move it up the tree rather than to fight the thing destroying it.

---

### 19.15 Smaller ones worth knowing

| Bug | Fix |
|---|---|
| Two starts for one invitation raced (double-click, two tabs, React StrictMode double-mount) and the loser got a 500 | The unique constraint catches it; the loser now **joins** the winner's session |
| A module whose pool ran dry *after* meeting its threshold reported `pool_exhausted` | It reports `confidence_reached` — it ended settled, and the other reason wrongly tells a recruiter the score rests on fewer answers |
| The departure latch as React state double-emitted under StrictMode | It is a **ref**, not state |
| `manager.query()` with `RETURNING` returns a `[rows, count]` tuple, so `.length` was always 2 | Use `createQueryBuilder().delete().execute()` and read `.affected` |
| Express's ETag made the connection check time a 304, not a request | Added a cache-busting nonce |
| Asking a candidate to press "Turn on camera" 30s after the readiness check proved it works made a working product look broken | The camera starts itself where permission already stands; the manual control returns only when it does not |
| A refused camera permission cannot be re-prompted — `getUserMedia` rejects immediately once "Never allow" is chosen | Use the Permissions API to tell "blocked" from "no device", and show where the switch is |

---

### 19.16 The themes that run through all of it

**Single source of truth, or it drifts.** The oval drawn in CSS and measured in
TypeScript. `.al-head` meaning two things. The question visibility rule. Every
one of these bugs was two copies of a fact disagreeing.

**Name things for what you measured.** `face_not_framed`, not `face_absent`.
`background_noise`, not "talking". A hiring record must not contain a claim the
measurement does not support.

**Timing is a design decision.** When the clock starts. When a check runs. When
validation happens relative to the write. When the splash mounts relative to
the navigation. Most of the hardest bugs here were correct logic at the wrong
moment.

**Write down why, especially for reversals.** Several decisions here reverse
earlier ones — traits reaching the recommendation, the camera becoming
mandatory. Without a record, the next person "fixes" them back.

**Prove it, do not assume it.** The probe landing rate was measured. The
clipping threshold was measured. The tab-switch impossibility was tested
against the spec. "It should work" is not a result.

---

## 20. Deliberately out of scope

Flag it, do not build it:

- Advanced psychometric models / real IRT calibration
- Any machine learning
- Coding assessment with a compiler or execution engine
- ATS integrations
- Large-scale infrastructure / horizontal scaling
- OS-level lockdown (SEB-style native client)
- Object or phone detection in the camera feed
- Video/audio recording, review, transcription, or voice identification
- ML-based anomaly detection
- A full draft → review → active workflow in the UI (the status field exists)

**Known limitation with no v1 remedy:** if a candidate's attempt is interrupted
(power cut, crash), auto-submit fires on the deadline and there is **no
recruiter-side way to grant a retry**. `assessment_sessions.invitationId` is
unique and `invitations` is unique on `(assessmentId, email)`, so a second
attempt is impossible without new code. What ships instead is a support contact
route so the candidate can ask. Granting a retry would mean voiding a scored
attempt — flagged as a new capability rather than quietly built.

---

## 21. Running it, and a demo script

### Setup

```bash
# 1. Infrastructure
docker compose up -d postgres redis

# 2. Backend
cd backend
npm ci
npm run migration:run
npm run seed              # modules, questions, samples, test accounts
npm run start:dev         # → http://localhost:3001

# 3. Frontend
cd ../frontend
npm ci
npm run dev               # → http://localhost:5174
```

**Ports are pinned:** frontend `5174`, backend `3001`. A "Could not reach the
API" error on the login page is usually a CORS/origin mismatch, not a backend
that is down — the message is misleading.

### Verify everything works

```bash
cd backend && npm run verify    # build + lint + unit + e2e
```

### A 12-minute demo script

**1. The problem (1 min).** Everyone sits the same paper; strong candidates
grind through easy questions; answers leak. Show the comparison table in §1.

**2. Recruiter: build a test (2 min).** Sign in at `/recruiter/login`. Create
an assessment, tick two modules, set min/max and a time limit. Show the
question pool picker and say: *choosing nothing means no restriction — the
engine still adapts.*

**3. Recruiter: invite (1 min).** Invite an address with no account. Show the
provisioning email in the dev inbox and the `mustChangePassword` flag.

**4. Candidate: readiness check (2 min).** This demos well. Start the wizard,
reach the camera step, then **cover the lens** — Continue disables again. That
single moment sells the "live, not once" design better than any slide.

**5. Candidate: sample test, then the assessment (3 min).** Show the branded
splash between stages. Start a section and answer 3–4 questions. Point out the
question queue is display-only, and that answers are final.

**6. Proctoring, honestly (1 min).** Switch tabs. The warning appears, has no
dismiss button, and the count rises. Say plainly: *this does not end the test —
it is recorded for the recruiter to weigh.* Then say what cannot be done: a
browser cannot block Alt+Tab, and here is what we built instead.

**7. The report (2 min).** Open a completed report. Walk the summary → the five
composites → the detail view with a repeat-probe pair side by side. Download
the PDF. Close on: *every number here was produced by a rule you can reproduce
by hand.*

### Seeded accounts (dev only)

| Account | Role |
|---|---|
| `recruiter@adaptivehire.local` | recruiter_admin / owner |
| `candidate@adaptivehire.local` | candidate |

Password comes from `SEED_PASSWORD` (default `ChangeMe!2345`).

---

## Where to look next

| Question | File |
|---|---|
| Why is it built this way? | `CLAUDE.md` — the living spec and decision log |
| What does the schema look like? | `docs/database-schema.md` |
| How do I set it up? | `docs/setup.md` |
| How does the engine decide? | `backend/src/adaptive-engine/adaptive-engine.constants.ts` |
| What does the report threshold mean? | `backend/src/reports/report.constants.ts` |
| Who can see which question? | `backend/src/question-bank/question-visibility.ts` |

**A note on the code comments.** This codebase comments *why*, not *what*, and
records rejected alternatives inline. If you are about to change something and
the comment above it explains why it is that way — that comment is usually a
bug report from the past. Read it before you "fix" it.
