# AdaptiveHire

Adaptive recruitment assessment platform. Candidates take a test whose
difficulty adjusts question-by-question; recruiters get a detailed report.

See `claude.md` for the full product spec and `docs/database-schema.md` for the
schema as built.

## Status

**Step 1 (Foundation) — complete.** Docker Compose, repo structure, JWT auth
with roles, and the full schema as TypeORM entities + migrations.

**Step 2 (Question Bank) — complete.** Module catalogue CRUD, question CRUD,
CSV/XLSX bulk import, and 130 seeded fixture questions.

**Step 3 (Adaptive Engine) — complete.** All five services under
`backend/src/adaptive-engine/`, validated over HTTP with simulated candidates
before any UI was written (see [Adaptive engine](#adaptive-engine)).

**Step 4 (Candidate Runtime) — complete.** Test-taking UI, Redis session state,
server-authoritative timers, BullMQ auto-submit, and all four proctoring
signals over a WebSocket gateway.

**Step 5 (Reporting) — complete.** Two-layer report, generated asynchronously
on submission (see [Reports](#reports)).

Next: Step 6 (Hardening) — bulk import polish and broader testing.

## Verifying a step is actually complete

Don't take a summary's word for it. With Postgres and Redis up and the database
seeded:

```bash
cd backend
npm run verify
```

That runs, and fails loudly on, all of: a clean TypeScript build, lint,
64 unit tests, and 45 end-to-end acceptance tests. The e2e suites boot the real
application and drive it over HTTP:

| Suite | Proves |
| --- | --- |
| `test/step1-foundation.e2e-spec.ts` | Postgres + Redis reachable, all 13 tables present, migrations recorded, registration/login/refresh/logout, refresh token is httpOnly and absent from the body, logout revokes it server-side, role escalation via the register payload is rejected, a candidate gets 403 on a recruiter route |
| `test/step1-rate-limiting.e2e-spec.ts` | The auth rate limiter actually returns 429 (runs with the real `ThrottlerGuard`; other suites stub its storage so their assertions aren't masked by 429s) |
| `test/step2-question-bank.e2e-spec.ts` | Seeded modules and their scoring types, all five Big Five traits declared with labels, `neuroticism` flagged inverted, active questions per module, difficulty spread wide enough for adaptive selection, every trait covered by questions, candidates get 403 on the question bank, draft→active→archived lifecycle, invalid `correctOption` / mismatched payload / undeclared trait all rejected, bulk import partial success with correct spreadsheet row numbers, bad file type rejected, templates downloadable |

`npm run verify` needs the seeded database — the suites log a message telling
you to run `npm run seed` rather than failing with a bare 401.

To spot-check by hand instead, see [Auth](#auth) and [Question bank](#question-bank)
below for the routes, or browse the data in pgAdmin (`localhost:5434`, all
credentials `adaptivehire`).

## Layout

```
backend/    NestJS API (REST + WebSocket)
frontend/   React + Vite (candidate and recruiter/admin, role-based routing)
docs/       schema and planning docs
```

## Ports

Chosen to avoid other services already running on this machine:

| Service | Host port | In-container |
| --- | --- | --- |
| API | 3001 | 3000 |
| Postgres | 5434 | 5432 |
| Redis | 6379 | 6379 |
| Vite dev server | 5174 | — |

Change them in `.env`; compose reads the same file.

## Getting started

```bash
cp .env.example .env          # then set real JWT secrets:
                              # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d postgres redis

cd backend
npm install
npm run migration:run
npm run seed                  # users + modules + 130 fixture questions
npm run start:dev

cd ../frontend
cp .env.example .env
npm install
npm run dev
```

Health check: <http://localhost:3001/api/health> — reports Postgres and Redis
reachability.

To run the API in Docker too: `docker compose up -d --build`.

## Seeding

`npm run seed` runs all three in order; each is also runnable alone.

| Script | Creates |
| --- | --- |
| `seed:users` | one `recruiter_admin`, one `candidate` |
| `seed:modules` | Aptitude, Logical Reasoning, Verbal Ability (objective) + Personality (trait) |
| `seed:questions` | 130 fixture questions, imported through the real bulk importer and activated |

All three skip work that's already done. `seed:questions` refuses to run twice
(it would double the bank); use `SEED_FORCE=true npm run seed:questions` to
delete and reload.

### Seeded accounts

Password `ChangeMe!2345`, override with `SEED_PASSWORD`:

| Email | Role |
| --- | --- |
| `recruiter@adaptivehire.local` | `recruiter_admin` |
| `candidate@adaptivehire.local` | `candidate` |

Self-service registration (`POST /api/auth/register`) always creates a
`candidate`; recruiter accounts come from the seed.

## Auth

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/auth/register` | public | rate-limited 5/min |
| `POST /api/auth/login` | public | rate-limited 10/min |
| `POST /api/auth/refresh` | refresh cookie | rotates both tokens |
| `POST /api/auth/logout` | access token | clears the server-side refresh hash |
| `GET /api/auth/me` | access token | |

Access tokens are short-lived (15m) and returned in the JSON body — the client
keeps them in memory. The refresh token is only ever set as an httpOnly cookie
scoped to `/api/auth`; it is never in a response body and never in
localStorage. Passwords and refresh tokens are hashed with Argon2.

### Refresh token rotation

Every refresh mints a new token and supersedes the old one. Each token carries
a random `jti`, so two minted in the same second are still distinct — without
it rotation would be a no-op at sub-second granularity.

Superseded tokens stay acceptable for `AUTH_REFRESH_GRACE_SECONDS` (default 30,
newest 5 retained). This is not slack for its own sake: the browser holds the
refresh token in a cookie, and rapid navigation can start a page load before
the previous refresh's `Set-Cookie` lands. The client then presents a token
that is one or more generations behind. Without the window that is
indistinguishable from theft, and users get signed out mid-session.

Presenting a token that was **never** issued to that user still revokes the
whole session immediately. Logout clears the recent list too, so the window
cannot resurrect a signed-out session. Set the value to `0` for strict
single-use rotation.

`JwtAuthGuard` and `RolesGuard` are registered globally — routes are protected
by default. Opt out with `@Public()`, restrict with `@Roles(UserRole.X)`.

## Question bank

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /api/modules` | any signed-in user | subjects; candidates see names in reports |
| `POST/PATCH/DELETE /api/modules` | recruiter_admin | `DELETE` deactivates, never drops |
| `GET /api/questions` | recruiter_admin | filter by `moduleId`, `status`, `tags`, `search`, `minDifficulty`, `maxDifficulty`; paginated |
| `POST/PATCH /api/questions` | recruiter_admin | one endpoint for both question kinds |
| `PATCH /api/questions/:id/activate` | recruiter_admin | flips a reviewed draft to `active` |
| `DELETE /api/questions/:id` | recruiter_admin | archives — `responses` FKs forbid deletion |
| `POST /api/questions/bulk-import` | recruiter_admin | multipart `file`, .csv or .xlsx, max 5 MB |
| `GET /api/questions/bulk-import/template/{mcq,personality}` | recruiter_admin | downloadable starter sheets |

The whole `/api/questions` tree is recruiter-only: `mcq_question_details`
carries `correctOption`, so a candidate must never be able to read it.

### Bulk import

Rows import independently — one bad row is reported and skipped rather than
failing the upload, so a 400-row sheet with three typos imports 397 questions
and tells you about the three, each with its spreadsheet row number.
Everything lands as `draft` for review.

Headers are case- and space-insensitive (`Question Text` == `question_text`).
A row's module decides its shape, so one sheet can mix objective and trait
questions.

**Every question needs 4–6 options, in every module.** Four is the floor for
two different reasons: on objective questions it caps the guess rate at 25%
(three options lets a candidate who knows nothing score 33%, which inflates
the Elo estimate), and on trait questions it forces an even-numbered scale so
there is no neutral midpoint to park on. Enforced in the DTOs and in the
importer — see `question-bank.constants.ts`.

**Objective (MCQ) columns:** `module_slug`, `question_text`, `option_a`…
`option_f`, `correct_option`, `difficulty_score` (Elo, 400–1600, defaults to
1000), `tags`

**Trait columns:** `module_slug`, `question_text`, `option_a` +
`option_a_weights`, …, `option_d` + `option_d_weights`, `tags` — where weights
look like `conscientiousness:2; openness:-1`

The seeded personality questions use a 4-point forced-choice scale
(`Strongly agree / Agree / Disagree / Strongly disagree`, weighted
`+2 / +1 / −1 / −2`). Reverse-keyed items flip the signs and are tagged
`reverse-keyed`.

`samples/demo-import.csv` is a ready-made sheet for demos: 6 valid rows
(objective and trait mixed in one file) plus 4 deliberately broken ones that
exercise every failure message. Everything it creates is tagged `demo-import`
for easy cleanup.

### Fixture questions

The 130 seeded questions are **synthetic**, written to exercise the adaptive
engine — not curated assessment content. Every one is tagged `fixture`:

```sql
DELETE FROM questions WHERE 'fixture' = ANY(tags);
```

They span 600–1250 on the Elo difficulty scale, and the Personality module
covers all five Big Five traits.

### Traits

The Personality module stores Big Five keys as the engine-facing identifiers
that question options weight against, each paired with a workplace-facing
label for the report layer:

| Key | Reported as |
| --- | --- |
| `openness` | Adaptability & Learning |
| `conscientiousness` | Reliability & Follow-Through |
| `extraversion` | Communication & Initiative |
| `agreeableness` | Teamwork & Cooperation |
| `neuroticism` | Resilience Under Pressure *(inverted)* |

`neuroticism` carries `invertForReport: true` — it is reported as its opposite
pole, so a high raw score must render as low resilience. Any trait whose
workplace label flips its meaning needs that flag.

## Adaptive engine

Five services under `backend/src/adaptive-engine/`, all tunables in
`adaptive-engine.constants.ts`. The engine reads and mutates a plain
`ModuleRunState` object and touches neither Redis nor the session store, so it
can be driven entirely from a unit test.

| Service | Does |
| --- | --- |
| `evaluation/` | Scores one answer: right/wrong for objective modules, per-option trait weights for trait ones |
| `ability-estimator/` | Elo update on both sides — the candidate at a K that decays after the opening questions, the item at a much smaller K so its stored difficulty self-calibrates over many candidates |
| `question-selector/` | Objective: shortlist the ~5 closest-difficulty unseen questions, then pick at random so two similar candidates never sit the same paper. Trait: pick for the least-covered trait |
| `stopping-engine/` | Ends a module on confidence, maximum, the clock, or an exhausted pool — never before the configured minimum |
| `adaptive-engine.service.ts` | Orchestrates the four above |

**Confidence has two halves, and both must hold.** *Precision* is the standard
error of the same logistic curve the Elo update uses, which depends only on
which questions were served — on its own it stops every well-matched candidate
at the identical question number. *Stability* asks whether the estimate has
stopped moving across the last few answers, which depends on how they were
answered. Together they produce the intended variation: measured over eight
simulated candidates, objective modules ran 9–12 questions and the personality
module 14–15.

This is error propagation on a curve already committed to — not IRT
calibration. No item parameters beyond difficulty are estimated and nothing is
fitted.

## Candidate runtime

| Route | Does |
| --- | --- |
| `POST /sessions/start` | Starts the attempt for an invitation, or rejoins the one in progress (`assessment_sessions.invitationId` is unique, so an invitation is worth exactly one attempt) |
| `GET /sessions/:id/next-question` | Where the candidate stands — also how a reloaded tab catches up |
| `POST /sessions/:id/module/start` | Starts the current module's clock; nothing ticks until this is called, so intro-screen reading time isn't charged |
| `POST /sessions/:id/answer` | Records an answer and returns the next step |

All four return the same three-state union — `module_intro`, `question`,
`completed` — so the client has one state machine rather than several.

Live state (current question, running ability estimate, seen question ids) is
in Redis; `assessment_sessions` is written once at start and once at end. Module
timers are Redis TTL keys. Nothing the client sends is trusted beyond which
option was picked: answering a question the server didn't serve is a 409, and
`timeTakenMs` is derived from the server's own serve timestamp. If Redis loses
a live session, it is rebuilt by replaying `responses`.

`GET /sessions/:id/next-question` is also the auto-submit safety net's partner:
a delayed BullMQ job fires at the session deadline so an abandoned attempt is
submitted even with the browser closed.

### Proctoring

A Socket.IO gateway at `/proctoring` (namespace, not the REST prefix) takes
`tab_switch`, `fullscreen_exit`, `face_absent`, `multiple_faces` and
`multiple_displays_detected` into `proctoring_logs`. Nest's HTTP guards never
see a socket, so the gateway authenticates the handshake itself as Socket.IO
middleware — a bad token is refused before the connection is established.

Face presence runs entirely in the browser via face-api.js (tiny detector,
weights in `frontend/public/models`). No frame ever leaves the machine; only a
face count is reported. The import is dynamic, so the ~660KB model runtime is a
separate chunk that only a candidate taking a test downloads.

**Detect and log for recruiter judgment — never auto-disqualify.** A candidate
who refuses the camera still takes the test; the recruiter simply sees that
face presence was never confirmed.

## Reports

Recruiter-only, in full — a report carries the answer key as well as the
scores, so nothing here is reachable from the candidate app.

| Route | Does |
| --- | --- |
| `GET /reports/assessments/:assessmentId` | Every attempt at one assessment, with its headline score and recommendation |
| `GET /reports/sessions/:sessionId` | Layer one: the stored summary, per-section scores and trait profile |
| `GET /reports/sessions/:sessionId/detail` | Layer two: every answer and every proctoring event, queried live |
| `POST /reports/sessions/:sessionId/regenerate` | Recompute, e.g. after changing a threshold |

**Layer one** is written to `reports` by a BullMQ job enqueued on submission —
the candidate lands on the confirmation screen without waiting for it. If the
job never runs, the recruiter's first read regenerates the report, so a lost
job degrades to a slower page rather than a missing report.

**Layer two** is never copied into `reports`. It is queried from `responses`
and `proctoring_logs` each time, so a question whose text was later corrected
shows its current wording rather than a stale copy.

### The rules

All thresholds live in `src/reports/report.constants.ts`. A recruiter should be
able to read them and predict what a report will say.

- Ability is mapped onto 0-100 against the question bank's actual difficulty
  spread (600-1300), not the theoretical Elo range — a candidate cannot
  demonstrate ability the bank has no questions for.
- `overallScore` is the mean of the objective sections the candidate actually
  attempted. Trait modules never contribute: there is no "good" personality.
- The recommendation is bands on that score, capped at `borderline` when
  coverage against the configured minimums is too thin for the number to mean
  much. Thin evidence can lower a recommendation but never raise one.
- **Proctoring counts appear in the narrative and never move the
  recommendation.** Detect and log for recruiter judgment; the decision stays
  with a person.
- A trait measured below `MIN_TRAIT_CONFIDENCE` is shown but never called a
  strength or a weakness — two answers is not a personality finding.

## Migrations

```bash
cd backend
npm run migration:generate -- src/database/migrations/SomeName
npm run migration:run
npm run migration:revert
npm run migration:show
```

`synchronize` is off everywhere; schema changes always go through a migration.
