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
- **Ambient-audio detection:** Web Audio API `AnalyserNode` (client-side only, no audio recorded, buffered or sent to server — only the event)
- **PDF generation:** `pdfmake` (server-side, in `reports/report-pdf.ts`) — the candidate report downloads as a real file. Deliberately *not* headless Chrome: pdfmake is pure JavaScript, so nothing is added to the container, and the output is selectable vector text rather than a screenshot. The trade-off is that it is a second rendering of the report and can drift in layout from the page — it cannot drift in data, because it is built from the same `summary` and `detail` payloads. **A field added to the report page must be added there too.** It replaced `window.print()`, which could never open anything but the browser's print dialog.
- **Containerization:** Docker + Docker Compose (Postgres + Redis + backend, locally)

---

## Layout notes

The tree itself is `ls`; only these two things about it are not.

- **`modules-catalog/`** is the `modules` (subjects) table, named that way to
  avoid colliding with NestJS's own "module" concept.
- **Recruiter navigation is SECTIONS, not pages** (reorganised 2026-08-20). The
  top bar lists six: Dashboard, Assessments, Question bank, Modules, People,
  Settings. A section with more than one view carries its own `SubNav` tab strip
  rather than claiming another slot in the bar:
  - Question bank → Questions · Performance · Bulk import
  - Assessments → Assessments · Reports · Proctoring signals
  - Settings → Workspace · My account

  "Question performance" and "Bulk import" used to be top-level items, and "My
  account" lived only behind the user menu. Creating an assessment is its own
  page (`assessments/new`), not a form stacked on top of the list: the list is
  opened far more often than the form, and leading it with a long empty form
  made the page people actually use unreadable. `/admin/profile` stays as a
  redirect to `/admin/settings/account` so old links still land.
- Planning docs live in `docs/` — read those first for detail this file summarises.

---

## Database Schema (locked — see `docs/database-schema.md` for full detail)

Core tables and how they relate:

- **users** — `role` enum: `candidate` | `recruiter_admin`
- **modules** — subjects (e.g. Aptitude, Logical, Personality) as a reference table, NOT a hardcoded enum. Each has `scoring_type`: `objective` (Elo-scored, right/wrong) or `trait` (personality-style, weighted). New subjects can be added later as pure data — no code changes — as long as they fit one of these two scoring types. **A coding/execution subject is explicitly out of scope.**
- **questions** — shared parent table (text, module_id, status, tags). Split into two 1:1 child tables:
  - **mcq_question_details** — options, correct_option, difficulty_score (Elo-scale), times_used, times_correct
  - **personality_question_details** — options with per-option `trait_weights` JSON
- **assessments** / **assessment_modules** — a named test made of modules, each with a `questionCount` and a time limit. **Personality sections default to 40 questions over 30 minutes** (`module-defaults.ts`, duplicated in `backend/src/assessments/` and `frontend/src/lib/` because the two builds share no package): a behavioural profile is built from ten traits, and a short section spreads too few answers across too many of them to be worth reading. Objective subjects stay hand-configured — their length is a judgement about the role, not something the scoring model demands. The default is applied when a subject is ticked on the form, not enforced by the API; a recruiter can still change it, and an assessment that silently ignored what somebody typed would be worse than a default they can see.
- **assessment_questions** — the optional question pool for one assessment. **No rows means no restriction**: the engine draws on everything the owning organisation can see, which is the default and what keeps pre-pool assessments working. A curated pool *narrows* the engine's choices without replacing them — it still selects question by question on difficulty match and trait coverage, so the test stays adaptive and two candidates still get different papers. Picking a fixed ordered list was explicitly rejected (decided 2026-08-13): it would have removed the adaptation, the Elo ability score, the variable length and exposure control, and made repeat probes obvious. Validation rejects a question invisible to the organisation (the tenancy hole, since ids come from the client), one from a subject the assessment does not include, and any module whose active pool is thinner than its own `minQuestions`. It runs **before** anything is written and the assessment plus its pool are inserted in one transaction — validating afterwards left an assessment behind on a rejected pool, so the caller got a 400 and an assessment they never asked for. Questions are picked inline while creating the assessment (collapsed per module, loaded only for modules actually ticked) and changed later from `/admin/assessments/:id/questions`; both use the same `QuestionPoolPicker` so the two cannot drift on the rule that choosing nothing means no restriction.
- **invitations** — candidate access is via login + assessment list, NOT a token-based email link. Inviting an address with **no account provisions one** and emails working credentials (username = the email); the account is flagged `users.mustChangePassword` and must choose its own password before reaching an assessment. Inviting an address that **already has an account never re-issues credentials** — that account is org-less and shared, so minting a password for it would hand the inviting recruiter a way into another company's results; they get a "sign in as usual" email instead. `/register` stays as an invite-gated fallback for a lost email. The invitation is linked to the provisioned account **at provision time** — the row is written before the account exists, and the only other backfill runs at self-registration, which a provisioned candidate never does; miss it and they sign in to an empty assessment list. `listForCandidate` therefore matches `candidateId` **or** the email, like the People directory. Removing an invitation also deletes the account it created, but only if that account is still untouched: candidate role, `mustChangePassword` still set, no other invitation anywhere, no session. Otherwise withdrawing an invitation would become a way to delete a real person's account.
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
4. **Stopping Engine Service** — ends a module when its `questionCount` is reached, or the clock expires, or the pool runs dry.
   - **Sections are a fixed length (changed 2026-08-24).** `minQuestions`/`maxQuestions` were replaced by a single `questionCount` (migration `1786720000000`), on the product call that the min/max control was not worth its complexity. The early `confidence_reached` stop went with them, so `ModuleStopReason.CONFIDENCE_REACHED` is **no longer produced** — it stays in the enum because completed attempts still carry it.
   - **This removed variable length, not adaptivity.** The selector still matches every question to the running ability estimate and the estimator still updates after each answer, so this is fixed-length adaptive testing; two candidates now answer the same number of items, which makes their results directly comparable. `thresholdMet` still measures how settled a result is — being settled just no longer buys an early finish.
   - `ConsistencyProbeService.awaitingTwin` was deleted with it: it existed only to defer that stop. Pairs still land, because a fixed section is far longer than the eight-question gap a pair needs — the 12-question modules it was written for left only three slots to open one in.
5. Everything is orchestrated behind two main endpoints: **get next question** and **submit answer**.

**Validate this via direct API calls (Postman/curl) before building any candidate-facing UI.** This is the single most important checkpoint in the whole build — do not skip it or rush past it to get to the UI faster.

---

## Security & Proctoring Scope (final for v1 — do not add or remove without discussion)

**The full scope lives in `.claude/rules/proctoring.md`**, which loads whenever
you work on proctoring, the session runtime or the readiness check. It is
locked: do not add or remove a signal without discussion.

The one principle that applies everywhere, so it stays here:

**Detect and log for recruiter judgment, never auto-disqualify — once a module
is underway.** Mid-test violations (tab switches, full-screen exits, a face
leaving frame, background noise) never block, end, or fail an attempt; they are
data in the report and a person makes the call. The only exceptions are *gates
before anything starts* — the camera check at the top of each module and the
system readiness check — never penalties once it has. The distinction that
matters is timing, not severity.

---

## Reporting

**The full rules live in `.claude/rules/reporting.md`**, which loads whenever you
work on report building, the adaptive engine's scoring, or the report pages.

Two things that cut across the whole codebase, so they stay here:

- The report has **two layers**: a stored `summary` (`reports` table) and a
  **detail view queried live** from `responses`/`proctoring_logs`, never
  duplicated into `reports`. Generation runs asynchronously via BullMQ on
  submission — a candidate never waits for it.
- The PDF (`reports/report-pdf.ts`, pdfmake) is a **second rendering of the same
  payloads**. It cannot drift in data, but it can in layout: **a field added to
  the report page must be added there too.**

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

## Working agreements

The schema, tech stack and security scope above are **locked**. Ask before making
any architectural decision not already settled in this file or in `docs/` —
don't change them unilaterally.

The original six-step build order (Foundation → Question Bank → Adaptive Engine →
Candidate Runtime → Recruiter Flow → Hardening) is **complete**; git history is
the record of it. New work is ordinary feature and fix work on a running system,
not scaffolding.

One rule from that period still stands: **the adaptive engine is validated by
direct API calls, not through the UI.** If you change scoring, selection or
stopping, prove it with the engine's own scripts and e2e suites before touching
a screen.
