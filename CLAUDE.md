# AdaptiveHire — Adaptive Recruitment Assessment Platform

## Project Overview

Build the base version (v1) of AdaptiveHire — a recruitment assessment platform similar in concept to AMCAT. Its core purpose is to measure a candidate's ability and behavioral traits through an **adaptive test** (difficulty adjusts question-by-question based on performance), and give recruiters a detailed report to support hiring decisions.

---

## Users & Roles

- **Candidate** — registers/logs in, sees a list of assessments they've been invited to, takes an adaptive test, cannot revisit answered questions.
- **Recruiter/Admin** — a single combined role (not split into two). Creates assessments, configures modules, invites candidates, manages the question bank, views detailed candidate reports.

There is no separate "Admin" role — Recruiter and Admin responsibilities are merged into one `recruiter_admin` role.

### Organisations and open recruiter registration (changed 2026-08-12)

Recruiters now **register themselves**. Signing up as a recruiter creates an `organisations` row — their company workspace — and that organisation is the tenancy boundary for everything they do. This replaces the earlier rule that recruiter accounts were provisioned by seed or by an existing recruiter_admin.

This was not a 20-line change, and the reason matters. While recruiters were hand-seeded colleagues, nothing was scoped: `createdById` and `invitedById` were written on every row and never appeared in a single `WHERE` clause, so any logged-in recruiter could read every assessment, every candidate report and every invitation list on the platform. Harmless among three colleagues; a personal-data breach the moment a stranger can sign up. **So tenancy and self-registration must always ship together.**

The rules, all of which have to hold:

- `users.organisationId` is set for every recruiter and **null for every candidate** — permanently. A candidate is a person, not a customer's record, and the same account sits assessments for whoever invites them. That is also why invitations are keyed on email.
- `assessments.organisationId` is **NOT NULL**; `questions.organisationId` is nullable and **null means platform-owned**: the starter bank every organisation can use.
- **Platform questions are edited by copy-on-write, never in place.** Editing or hiding one creates a private fork carrying `questions.forkedFromId`, and that organisation then sees its fork *instead of* the original while every other organisation keeps the pristine one. Hiding is a fork with `status = 'archived'`; deleting a fork reverts that organisation to the platform version. Deleting a platform question itself is refused (403) — it is shared. One fork per organisation per question, enforced by a partial unique index.
- The visibility rule therefore lives in **one** file, `question-bank/question-visibility.ts`, and is used by both the question bank and the adaptive engine's selector: `organisationId = mine OR (organisationId IS NULL AND I have no fork of it)`. The selector originally had no organisation clause at all, which meant one customer's private questions could be served to another customer's candidates — `ModuleRunState.organisationId` (the assessment's owner, since a candidate has none) is what closes that.
- Every recruiter endpoint takes its scope from `@CurrentOrg()`, which **throws** when the account has no organisation. Never read `organisationId` off the user and assert it — a wrong `!` yields `undefined`, TypeORM drops the clause, and a dropped tenant filter returns every customer's rows.
- Another organisation's row returns **404, not 403**, so ids cannot be probed. A platform question returns 403 on write, because it is genuinely visible and genuinely read-only.
- Two paths are deliberately unscoped and must stay commented as such: `AssessmentsService.findOneForSession` (the candidate runtime, reached through a session the candidate owns) and `ReportsService.generate` (the BullMQ worker, which has no requesting organisation). `regenerate` is the recruiter-facing wrapper and *is* scoped.
- **The People directory needs two rules, not one.** A recruiter is a *member* (`users.organisationId = mine`), but a candidate belongs to no organisation, so they appear only where this organisation has invited them — an `EXISTS` over `invitations` joined to `assessments`, matching on `candidateId` **or** the email, since invitations are email-keyed and `candidateId` is only backfilled at registration. People lists *accounts*: an invited email with no account yet is a pending invitation and belongs on the assessment's invite page, not here.
- A recruiter-provisioned account (`POST /users`) takes its organisation from `@CurrentOrg()`, never the payload, and only for a `recruiter_admin` — a provisioned colleague with no organisation could sign in and do nothing, because `@CurrentOrg()` refuses them everywhere.
- Registration is **open — no email verification** (decided 2026-08-12). The known trade-off is bulk fake accounts and invites sent from unowned addresses.
- The two sides sign up on **separate pages**: `/register` is candidate-only (invite-gated, unchanged from before) and `/recruiter/register` registers a company, reached from the "Register to host assessments" link on `/recruiter/login`. They were briefly one form with a chooser; splitting them back means neither form asks a question its visitor has no reason to answer. Each page cross-links to the other for anyone who lands on the wrong one.
- **Each sign-in page is restricted to its own audience.** `POST /auth/login` takes an optional `portal` (`candidate` | `recruiter`); a role mismatch is a **403** naming the other page, and the UI turns that into a link across. `/login` is candidates only, `/recruiter/login` recruiters only. This is enforced in `AuthService.login` **before** `issueTokens`, and must stay there — checking in the UI instead would be useless, because a successful login has already set the httpOnly refresh cookie by the time the client sees the role, so the next page load would silently restore the session. A refused login sets no cookie at all. `portal` omitted skips the check, which keeps scripts and API tests working; the real access control is unchanged and still the role guard on every endpoint.

---

## Tech Stack (finalized — do not deviate without discussion)

- **Backend:** NestJS (TypeScript), REST + WebSocket (NestJS Gateway)
- **Database:** PostgreSQL + TypeORM
- **Session/live state:** Redis (session state, timers via TTL keys)
- **Background jobs:** BullMQ (auto-submit, report generation, invite emails) — built on the same Redis instance
- **Frontend:** React (both candidate and recruiter/admin, same app, role-based routing)
- **Auth:** JWT (short-lived access token + refresh token), NestJS Guards + `@Roles()` decorator, role-based access control
- **Password hashing:** Argon2
- **Security additions:** `helmet`, `@nestjs/throttler` on assessment endpoints, `class-validator`/`class-transformer` on all DTOs, httpOnly cookies for refresh tokens (not localStorage)
- **Face-presence detection:** face-api.js (client-side only, browser-based, no video sent to server)
- **Containerization:** Docker + Docker Compose (Postgres + Redis + backend, locally)

---

## Folder Structure

```
adaptivehire/
├── docker-compose.yml
├── .env.example
├── docs/                              # planning docs live here — read these first
│   ├── build-architecture-plan.md
│   ├── database-schema.md
│   ├── tech-stack.md
│   └── requirements.md
│
├── backend/                           # NestJS
│   └── src/
│       ├── auth/                      # JWT, guards, roles
│       ├── users/                     # candidate + recruiter_admin
│       ├── modules-catalog/           # the `modules` (subjects) table — named to avoid
│       │                              # colliding with NestJS's own "module" concept
│       ├── question-bank/
│       │   ├── entities/
│       │   │   ├── question.entity.ts
│       │   │   ├── mcq-question-details.entity.ts
│       │   │   └── personality-question-details.entity.ts
│       │   └── bulk-import/           # spreadsheet parser + seed script
│       ├── assessments/               # assessment config, assessment_modules
│       ├── invitations/
│       ├── adaptive-engine/           # THE core — five services, one folder each
│       │   ├── evaluation/
│       │   ├── ability-estimator/     # Elo-style logic lives here
│       │   ├── question-selector/
│       │   ├── stopping-engine/
│       │   └── adaptive-engine.service.ts   # orchestrates the four above
│       ├── sessions/                  # session lifecycle: start, next-question, submit-answer
│       │   └── redis-session.service.ts     # wraps ioredis, session-state read/write
│       ├── proctoring/                # WebSocket gateway, event logging
│       ├── reports/
│       ├── queues/                    # BullMQ setup, all workers
│       │   ├── auto-submit/
│       │   ├── report-generation/
│       │   └── invite-emails/
│       └── common/                    # shared DTOs, pipes, filters, enums
│
├── frontend/                          # React
│   └── src/
│       ├── routes/
│       │   ├── candidate/             # login, assessment list, test-taking screens
│       │   └── recruiter-admin/       # dashboard, question bank, assessments, reports
│       ├── components/assessment/     # question renderer, timer, progress
│       ├── hooks/
│       │   ├── useSession.ts
│       │   └── useProctoring.ts       # fullscreen, tab-switch, face-detection, multi-display
│       └── lib/
│           ├── api.ts                 # REST client
│           └── socket.ts              # WebSocket client
│
└── shared/types/                      # optional — shared TS enums (scoring_type, session status)
```

---

## Database Schema (locked — see `docs/database-schema.md` for full detail)

Core tables and how they relate:

- **users** — `role` enum: `candidate` | `recruiter_admin`
- **modules** — subjects (e.g. Aptitude, Logical, Personality) as a reference table, NOT a hardcoded enum. Each has `scoring_type`: `objective` (Elo-scored, right/wrong) or `trait` (personality-style, weighted). New subjects can be added later as pure data — no code changes — as long as they fit one of these two scoring types. **A coding/execution subject is explicitly out of scope.**
- **questions** — shared parent table (text, module_id, status, tags). Split into two 1:1 child tables:
  - **mcq_question_details** — options, correct_option, difficulty_score (Elo-scale), times_used, times_correct
  - **personality_question_details** — options with per-option `trait_weights` JSON
- **assessments** / **assessment_modules** — a named test made of modules, each with min/max question counts and a time limit
- **assessment_questions** — the optional question pool for one assessment. **No rows means no restriction**: the engine draws on everything the owning organisation can see, which is the default and what keeps pre-pool assessments working. A curated pool *narrows* the engine's choices without replacing them — it still selects question by question on difficulty match and trait coverage, so the test stays adaptive and two candidates still get different papers. Picking a fixed ordered list was explicitly rejected (decided 2026-08-13): it would have removed the adaptation, the Elo ability score, the variable length and exposure control, and made repeat probes obvious. Validation rejects a question invisible to the organisation (the tenancy hole, since ids come from the client), one from a subject the assessment does not include, and any module whose active pool is thinner than its own `minQuestions`. It runs **before** anything is written and the assessment plus its pool are inserted in one transaction — validating afterwards left an assessment behind on a rejected pool, so the caller got a 400 and an assessment they never asked for. Questions are picked inline while creating the assessment (collapsed per module, loaded only for modules actually ticked) and changed later from `/admin/assessments/:id/questions`; both use the same `QuestionPoolPicker` so the two cannot drift on the rule that choosing nothing means no restriction.
- **invitations** — candidate access is via login + assessment list, NOT a token-based email link
- **assessment_sessions** — permanent record of a session (status, timestamps). Live in-progress state (current question, running ability estimate, answered questions) lives in **Redis**, not here — this table is written once at start and once at end.
- **session_module_results** — final ability score per objective module; `trait_scores` JSONB storing both `score` AND `confidence` per trait
- **responses** — one row per answered question, including `ability_estimate_after` (kept in production long-term, used for future engine tuning — not just a debug field)
- **proctoring_logs** — one row per security event (`tab_switch`, `fullscreen_exit`, `face_absent`, `multiple_faces`, `multiple_displays_detected`). Pruning old sessions' logs after a few versions is planned (not built for v1, but design with `session_id` + `occurred_at` as the future pruning key).
- **reports** — one row per completed session, storing narrative output (summary, strengths, weaknesses, hiring_recommendation). Does NOT duplicate per-question or per-event detail — those are queried live from `responses`/`proctoring_logs` when a recruiter opens the detailed view.

---

## The Adaptive Engine (the core of the whole project — build and validate this before any UI)

Five cooperating NestJS services under `adaptive-engine/`:

1. **Evaluation Service** — scores a submitted answer. Correct/incorrect for `objective` modules; trait deltas for `trait` modules.
2. **Ability Estimator Service** — Elo-style update per module:
   ```
   expected = 1 / (1 + 10^((question_difficulty - candidate_ability) / 400))
   new_ability = old_ability + K * (actual_outcome - expected)
   ```
   No real IRT, no ML — this simple statistical update is the intended v1 approach.
3. **Question Selector Service** — for `objective` modules: pick from the top ~5 closest-difficulty-match unanswered questions, then randomize among them (prevents predictable sequences). For `trait` modules: pick a question covering whichever trait currently has the lowest confidence/fewest questions answered.
4. **Stopping Engine Service** — ends a module when confidence threshold is met OR max question count is hit, subject to a configured minimum. Produces the "not everyone gets the same number of questions" behavior (small variation, e.g. ±2–5, is expected and fine).
5. Everything is orchestrated behind two main endpoints: **get next question** and **submit answer**.

**Validate this via direct API calls (Postman/curl) before building any candidate-facing UI.** This is the single most important checkpoint in the whole build — do not skip it or rush past it to get to the UI faster.

---

## Security & Proctoring Scope (final for v1 — do not add or remove without discussion)

- No revisiting previous questions (enforced server-side via Redis session state, never trust client)
- Server-authoritative timer (Redis TTL key, not client-side `setInterval`)
- Fullscreen enforcement (Fullscreen API)
- Tab-switch detection (Page Visibility API)
- Face-presence detection (face-api.js, client-side only — detects face absent / present / multiple faces; NO video recording or storage)
- **Camera is mandatory to begin a module.** A candidate cannot start (or resume into) a module until their camera is confirmed active; if permission is denied or unsupported, the "Begin" action stays disabled with an explanation, and they cannot proceed until it is granted. This is a start-of-module prerequisite, not a mid-test penalty — see below.
- Multi-display detection (Window Management API `getScreenDetails()`) — logged as a soft signal, never auto-flagged
- Auto-submit on timeout (BullMQ delayed job, fires even if the candidate's browser is closed)
- All violation events push to backend via WebSocket → `proctoring_logs` table
- **Explicitly out of scope for v1:** OS-level lockdown (SEB-style native app), object/phone detection in camera feed, video recording/review, ML-based anomaly detection. These are known, accepted limitations — not oversights.
- **Philosophy: detect and log for recruiter judgment, never auto-disqualify — once a module is underway.** Mid-test violations (tab switches, full-screen exits, face going briefly out of frame, etc.) never block, end, or fail the test; they are presented as data in the report and the recruiter makes the call. The camera-mandatory gate above is the one exception, and it only applies before a module starts, since face presence literally cannot be evaluated without a camera.

---

## Reporting

Two-layer report per completed session:
1. **Summary** (from `reports` table) — ability scores, trait profile, strengths/weaknesses, rule-based hiring recommendation, violation counts
2. **Detail view** (queried live, not stored) — full question-by-question answer list (right/wrong, question text) and the full timestamped proctoring event list

Report generation runs asynchronously via a BullMQ job triggered on submission — the candidate should never wait for report computation.

### Behavioural composites and the overall score (decided 2026-08-12)

A trait module on its own used to produce ten trait scores, a null `overallScore` and a permanent `borderline` — which read as "no result" for a candidate who had answered everything. So the report now derives five **role-relevant composites** from the workplace traits (Leadership Readiness, Team Collaboration, Reliability & Follow-Through, Adaptability Under Pressure, Integrity & Judgment). Each is a fixed authored weighting over the traits, defined in `reports/behavioral-profiles.ts` — rule-based, no learned weights, and a recruiter can reproduce any composite by hand.

`overallScore` is now **ability 70% / behavioural index 30%**, and whichever half the assessment did not measure drops out so the other takes full weight. This is a deliberate change from the earlier "traits never touch the recommendation" rule: what reaches the recommendation is fit for a kind of work, never a rating of the personality, and no single trait can move the outcome. Consistency, repeat-probe results and proctoring signals still reach it nowhere.

### Repeat consistency probes (added 2026-08-12)

Questions can be twinned via `questions.probeGroup`: same underlying construct, reworded stem, reworded and **reordered** options. The engine serves one, holds the group back for `PROBE_GAP_QUESTIONS` (8), then serves the twin and compares the two answers. Objective twins compare on the outcome (right then wrong means the right answer was a guess); trait twins compare per-trait weight distance. Capped at `PROBE_MAX_PAIRS` per module, and a pair is only opened if the module has room left to close it.

The window for opening a pair is only `maxQuestions - PROBE_GAP_QUESTIONS` wide — three slots on a 12-question module — so the selector **asks** for a probe question while that window is open (`ConsistencyProbeService.wantsNewPair`) rather than waiting for one to turn up. It does so through the module's normal rules restricted to probe-carrying questions, so difficulty matching and trait targeting are unaffected, and falls through to ordinary selection when no probe question fits. Left to chance the landing rate was ~61%; asking takes it to ~90% (measured over 20 personality runs). The remaining misses are modules that legitimately stop on `confidence_reached` before the twin's turn comes round — a real interaction, since probe questions weighting four traits each accelerate trait coverage and so bring the confidence stop forward.

**Report-only, with one exception.** A probe *answer* never moves an ability estimate, a trait score or a confidence — a disagreement is surfaced with both answers side by side in the detail view and nothing else. Stored on `session_module_results.probeResults`. Reordering the options is not optional: a twin whose options sit in the same order is answered by position, and measures nothing.

The exception is `StoppingEngineService`, which defers a `confidence_reached` stop while a pair is open and its twin has not yet had its turn (`ConsistencyProbeService.awaitingTwin`) — stopping one question short of the twin spends a question and reports nothing for it. Only the *fact* that a check is outstanding is consulted, never how it was answered. It is bounded three ways: the clock and `maxQuestions` are both checked first and neither can be deferred, and the deferral lapses the moment the twin's turn passes, so a twin archived mid-run holds the module open for exactly one extra selection. This took the landing rate from ~90% to 100% (measured, 20 personality runs) at a cost of ~2 extra questions on runs that would have stopped early. Note the side effect: on a 12-question module the adaptive-length spread narrows (9-12 became 11-12), so raise `maxQuestions` if that variation matters more than the check.

Relatedly, a module whose pool runs dry *after* meeting its confidence threshold reports `confidence_reached`, not `pool_exhausted` — it ended settled, and the latter would wrongly tell a recruiter the score rests on fewer answers than intended.

---

## Question Bank Content Strategy

Questions are added via:
1. **Bulk spreadsheet upload** (primary method) — CSV/Excel, parsed and validated, inserted as `status: draft`
2. **Admin form** (secondary) — for single-question fixes/additions and reviewing drafts before flipping to `active`
3. **Seed script for initial launch data** — reads a starter spreadsheet and inserts directly, used to get ~100-150 test questions in for engine validation

No AI-generated questions, no third-party question APIs for v1 — content is manually authored/curated.

---

## Explicitly Out of Scope for v1 (do not build these — flag if asked to add them)

- Advanced psychometric models / real IRT calibration
- Any machine learning
- Coding assessment with compiler/execution engine
- ATS integrations
- Large-scale infrastructure / horizontal scaling
- Draft → Review → Active workflow enforcement in the UI (basic status field exists in schema, but full review workflow can be minimal for v1)
- Admin analytics dashboard (defer if time-constrained)
- Password reset flow (can use seeded test accounts for now if timeline is tight)

---

## Build Order (follow this sequence — the Adaptive Engine must be validated before UI work begins)

1. **Foundation** — Docker Compose (Postgres + Redis), repo structure, auth (JWT + roles), core TypeORM entities/migrations for the full schema above
2. **Question Bank** — CRUD + seed script, load ~100-150 sample questions
3. **Adaptive Engine** — all 5 services, tested via direct API calls, no UI dependency
4. **Candidate Runtime** — test-taking UI, Redis session state, timer, all four proctoring signals, BullMQ auto-submit
5. **Recruiter/Admin Flow** — assessment creation, invites, two-layer report UI
6. **Hardening** — bulk import polish, basic testing across all roles

---

## Instructions for Claude Code

Start with Step 1 (Foundation): scaffold the `docker-compose.yml`, initialize the NestJS backend and React frontend projects in the folder structure above, and generate the TypeORM entities and first migration matching the database schema described here. Confirm the Docker environment runs cleanly before moving to Question Bank work. Ask before making any architectural decision not already specified in this document — the schema, tech stack, and security scope above are locked and should not be changed without explicit confirmation.