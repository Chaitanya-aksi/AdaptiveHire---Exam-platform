# AdaptiveHire — Adaptive Recruitment Assessment Platform

## Project Overview

Build the base version (v1) of AdaptiveHire — a recruitment assessment platform similar in concept to AMCAT. Its core purpose is to measure a candidate's ability and behavioral traits through an **adaptive test** (difficulty adjusts question-by-question based on performance), and give recruiters a detailed report to support hiring decisions.

---

## Users & Roles

- **Candidate** — registers/logs in, sees a list of assessments they've been invited to, takes an adaptive test, cannot revisit answered questions.
- **Recruiter/Admin** — a single combined role (not split into two). Creates assessments, configures modules, invites candidates, manages the question bank, views detailed candidate reports.

There is no separate "Admin" role — Recruiter and Admin responsibilities are merged into one `recruiter_admin` role.

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