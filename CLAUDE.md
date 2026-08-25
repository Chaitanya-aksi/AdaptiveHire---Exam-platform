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
│       │       #
│       │       # Recruiter navigation is SECTIONS, not pages (reorganised
│       │       # 2026-08-20). The top bar lists six: Dashboard, Assessments,
│       │       # Question bank, Modules, People, Settings. A section with more
│       │       # than one view carries its own `SubNav` tab strip rather than
│       │       # claiming another slot in the bar:
│       │       #   Question bank → Questions · Performance · Bulk import
│       │       #   Settings      → Workspace · My account
│       │       # "Question performance" and "Bulk import" used to be top-level
│       │       # items, and "My account" lived only behind the user menu.
│       │       #
│       │       # Creating an assessment is its own page (`assessments/new`),
│       │       # not a form stacked on top of the list. The list is opened far
│       │       # more often than the form, and leading it with a long empty
│       │       # form made the page people actually use unreadable.
│       │       # `/admin/profile` stays as a redirect to
│       │       # `/admin/settings/account` so old links still land.
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

- No revisiting previous questions (enforced server-side via Redis session state, never trust client)
  - The runtime shows a **numbered question queue** above the question (`QuestionQueue` in `ModuleProgress.tsx`) — answered filled, current ringed, still-to-come dimmed. It is **display only**: `<span>`s in a list, never buttons. That is the design, not an oversight — the server would refuse a jump backwards anyway, and a clickable-looking chip that does nothing is worse than a label. It is drawn against `max` with the slots past `min` dashed, because an adaptive module has no fixed length and a solid chip would promise one.
- **Server-authoritative timer (Redis TTL key, not client-side `setInterval`), and it starts on "Begin" — never on page load.** There are two clocks and both must start at the same moment: the per-module deadline (`startCurrentModule`) and the **session** deadline that auto-submit fires on. The session one used to be set in `createSession`, which runs when the runtime page loads, so the entire time budget drained while a candidate read the very first intro screen — a real attempt was auto-submitted with **zero answers** before a single question had been served. `beginSessionClock` now rebases both `expiresAt` and `startedAt` when the *first* module starts.
  - `startedAt` moves too, deliberately: a recruiter reads elapsed time as how long the attempt took, and leaving it at session creation would include however long the intro screen sat open.
  - The queued auto-submit job must be **removed before the replacement is added** — BullMQ keys on `jobId` and silently keeps the existing job rather than replacing it, so adding alone leaves the old, far-too-early deadline live.
  - `createSession` still sets a placeholder deadline of `budget + START_GRACE_SECONDS` (2h) purely so a session cannot sit `in_progress` forever if somebody opens the runtime and walks away. Nothing is measured during it.
  - `npx ts-node src/database/seeds/check-session-clock.ts <assessmentId>` proves the invariant on a throwaway candidate and invitation it deletes afterwards.
- Fullscreen enforcement (Fullscreen API)
- **Tab-switch handling — detection plus a blackout and a re-entry gate (hardened 2026-08-20).** A request to "disable tab switching completely" was assessed and is **not achievable in a browser**, so this is what was built instead. Record the finding rather than re-deriving it:
  - Alt+Tab, Cmd+Tab, the Windows key and Mission Control are handled by the **operating system** and never reach the page — there is no event to cancel, so this half is genuinely unreachable. Ctrl+T, Ctrl+W, Ctrl+N and Ctrl+Tab are **reserved by the browser**: the keydown *does* reach the page, but `preventDefault` cancels only the page's default action, never the user agent's, so a tab opens anyway. Real prevention of the OS half requires a native lockdown client (SEB-style), which stays out of scope for v1.
  - **`navigator.keyboard.lock()` does close the browser-reserved half, and is used (updated 2026-08-21).** Held only while a module runs and the page is in Fullscreen-API full screen — both are conditions of the API, not choices — it routes Ctrl+T/W/N and Escape to the page instead of the browser, so those keys genuinely do nothing during a section. It is still limited by spec to "keys granted access by the underlying operating system", which is why it cannot touch the window switcher, and it is absent entirely in Firefox and Safari, so every caller must cope with `undefined`. Do not describe the lock as decorative: the earlier wording here said `preventDefault` "does nothing" and stopped, which undersold what actually ships.
  - **F11 is intercepted and redirected into our own full screen (added 2026-08-21).** There are two full screens and only one of them can be locked: the browser's F11 leaves `document.fullscreenElement` **null**, and `keyboard.lock()` is tied by spec to Fullscreen-API full screen, so it cannot arm against F11. A candidate who pressed Escape and then F11 therefore got a screen that *looked* locked while Ctrl+T went on opening tabs — the worst state available, because it reads as secure. Unlike Ctrl+T, **F11 arrives `cancelable: true`** (verified in Chrome), so the handler cancels it and spends the activation it carries on `requestFullscreen()` instead. The result is identical to the "Return to full screen" button, lock included, which makes that button the only way *into a locked state* by construction rather than by asking the candidate to prefer it. Deliberately one-way — F11 no longer toggles back out; Escape still leaves, so nobody is trapped, and leaving is recorded either way.
  - `useProctoring` exposes **`browserFullscreen`** (from `matchMedia('(display-mode: fullscreen)')`, which fires no `fullscreenchange` and needs its own listener) purely so the re-entry warning can be worded for what the candidate can actually see. Telling somebody staring at a full-screen window that they are "not in full screen" reads as a broken app; that pair — browser full screen on, ours off — gets its own sentence instead.
  - What ships is **detect, warn hard, record**: leaving raises an `AwayWarning` above the question, logs `tab_switch` with its timestamp, and the server-authoritative clock never stops. The warning has **no dismiss button** — it stands for the rest of the section and its count rises inline on each further departure, because an acknowledge button is only ever pressed to make the message go away. It is a **single compact line** for the same reason: a three-line banner that never leaves is a three-line banner pushing the question down the screen for ten minutes. Consequently the "currently away" latch resets on **return** (window `focus`, or `visibilitychange` back to visible), not on acknowledgement; without that, every switch after the first would go unlogged. `blur` is watched as well as `visibilitychange` because moving to another window on a **second monitor** only blurs and leaves the document visible.
  - **The screen is deliberately NOT blanked.** A blackout overlay was built and then removed the same day: `blur` fires on any transient focus change — an OS notification, a permission dialog, a keyboard user tabbing one control past the last one — and hiding the question in those cases takes the test away from a candidate who did nothing, while their clock runs. Do not reintroduce it without solving the false-positive problem first.
  - Two things keep the detection honest. `blur` is **debounced by `AWAY_GRACE_MS` (700ms) and re-checked with `document.hasFocus()`**, so focus bouncing out and back is not a violation; `visibilitychange` is not debounced, because a hidden document is unambiguous. And a **focus trap** wraps Tab inside `.assess-shell`, which is the actual fix for the reported bug — tabbing past the last control used to move focus into the browser's address bar, blurring the window and registering as leaving.
  - The departure latch is a **ref, not state**: `blur` and `visibilitychange` both fire on one switch, and de-duplicating inside a state updater would double-emit under StrictMode.
  - Also refused while a module runs: context menu, copy/cut, Ctrl+P/S/C/X/A, and text selection. Browser-reserved combinations are still deliberately **not** `preventDefault`ed for show — a handler that appears to block Ctrl+T and does not invites the reader to trust the rest. The keyboard lock is what actually blocks them, and it does so by capturing the key rather than by cancelling the event; F11 is the one exception in the keydown handler, and only because it is genuinely cancelable.
  - Known false positive: an OS notification stealing focus counts as leaving. Accepted, because the alternative is missing the second-monitor case.
  - Still **not** an auto-disqualification. The gate costs time and is recorded; it never ends the attempt. Making a tab switch fail an attempt would reverse the philosophy at the bottom of this section and needs an explicit decision.
- **Face detection (face-api.js, client-side only — NO video recording or storage).** Measures whether the candidate's face is *properly framed*, not merely whether one is somewhere in the picture. The rule lives in **one** file, `lib/face-framing.ts`, and both callers use it: the readiness wizard on `SETUP_RULE` and the assessment runtime on `RUNTIME_RULE`. A geometry rule kept in two places drifts — the alignment oval was briefly drawn from CSS and measured from TypeScript, and the ring on screen tested nothing at all.
  - **Counting faces was a real defect, in both places.** A candidate passed the readiness check with their face jammed against the left edge and the oval empty, and a camera angled at the ceiling with a head in one corner logged nothing during a test — a face was present, the count was one, everything looked fine. `framing()` tests position (centre within the oval's radii × tolerance) and size (`minFaceWidth`..`maxFaceWidth`) and reports *which* way it failed.
  - **`RUNTIME_RULE` is deliberately looser than `SETUP_RULE`**, mostly on distance. Setting up is a deliberate act with a preview to look at; sitting an assessment for forty minutes involves shifting in a chair, there is no oval on screen to aim at, and every event becomes a line in somebody's report — "leaned back at 14:32" buries the events a recruiter should actually read. Position stays near-strict, because a camera pointed away is the signal that matters.
  - `SUSTAINED_FRAMES` in `useProctoring` requires consecutive bad reads (≈10s) before anything is logged, and only transitions are emitted. A glance at the desk never reaches the log.
  - Mid-test this is **still detect-and-log** — see the philosophy at the end of this section. Nothing here blocks, ends or fails an attempt; what changed is that the events are now true.
- **Camera is mandatory to begin a module.** A candidate cannot start (or resume into) a module until their camera is confirmed active; if permission is denied or unsupported, the "Begin" action stays disabled with an explanation, and they cannot proceed until it is granted. **The camera starts itself where permission already stands** (`useProctoring`, gated on `permissionState('camera') === 'granted'`), so the section intro states its condition — "Camera on and working" — rather than offering a button. Asking a candidate to press "Turn on camera" thirty seconds after the readiness check proved it works, with Begin greyed out until they did, made a working product look broken. Never attempt `getUserMedia` blindly here: without a standing grant it puts an unrequested permission prompt on screen at the worst moment, which is why the manual control returns only when the answer is not `granted`. This is a start-of-module prerequisite, not a mid-test penalty — see below.
- **`face_not_framed` is its own event type**, not a reuse of `face_absent` (migration `1786710000000`). An occupied chair reported as an empty one is a false claim in a hiring record. Every event here is named for what was measured — the same rule that gave `background_noise` its name — and `metadata.reason` carries `off_centre` / `too_far` / `too_close`.
- Multi-display detection (Window Management API `getScreenDetails()`) — logged as a soft signal, never auto-flagged
- **Ambient-audio detection (added 2026-08-19 — a deliberate widening of this scope, confirmed explicitly).** Sustained sound above a threshold while a module is running is logged as `background_noise`, on the same "detect and log" footing as face presence. Analysed entirely in the browser with an `AnalyserNode` reading a level: **no audio is recorded, buffered, transcribed or transmitted**, and the platform never learns what was said — only that it was loud. It cannot distinguish a voice from a television, so the event is named for what is actually measured, and the report says so. Not a *mid-test* gate — a noisy room never interrupts, ends or fails an attempt, because a candidate in a shared house has done nothing wrong and the signal is for the recruiter to weigh. A working microphone is, since 2026-08-20, required to *begin*, along with every other readiness check; see below.
- **System readiness check before the assessment (added 2026-08-19; every check made blocking, and rebuilt as a one-step-at-a-time wizard, 2026-08-20).** Runs once, before the first module, and again on demand from the candidate's assessment card so problems surface before the day rather than at the start. **Every check gates the start** — browser, screen, camera, microphone, connection — and the candidate cannot advance past a step until it passes.
  - **One check per screen, and every step decides continuously.** This replaced a single list of six ticks; the first wizard then had to be pushed further, because asking each question *once* reproduced the very bug it existed to prevent — the camera step opened a stream, reported "Working", and let a candidate through on a completely black frame. **A device answering is not a device doing its job.** So each step is now live:
    - **Camera** runs `watchFaces` (face-api.js) against the preview element itself and passes only while **exactly one face is properly framed inside the alignment oval**. Counting faces was not enough and was a real defect: a candidate passed with their face jammed against the left edge of frame and the oval completely empty, because something in the picture was a face. `watchFaces` therefore returns **normalised boxes, not a count**, and `alignment()` tests position (centre within `CENTRE_TOLERANCE_X/Y` of the oval's radii) and size (`MIN_FACE_WIDTH`..`MAX_FACE_WIDTH`), reporting "not in the oval" / "too far" / "too close" separately. Zero faces says so; two or more says the candidate must sit alone.
      - `OVAL` in `ReadinessCheck.tsx` is the **single source of truth**: the ring on screen is drawn from those numbers via inline styles, so the ring the candidate is asked to fill is by construction the ring being measured. Do not move it back into CSS — as separate numbers they drifted at once.
      - `cx` is 0.5 deliberately: the preview is mirrored for comfort, and a horizontally centred target is the one shape that maps onto itself under that mirror, so nothing else has to think about it.
      - Vertical tolerance is looser than horizontal. Sliding a chair sideways is fine adjustment; vertical framing is set by a laptop hinge, and a measured face on a real desk sat 0.005 from the limit with the lid at a comfortable angle.
      - `STABLE_SAMPLES` requires agreeing consecutive reads before the verdict flips, so a face near a threshold does not strobe the step between pass and fail. While a good frame is still settling the step says "Hold still…" rather than claiming a pass it has not granted.
      - The corner caption lives on the `Alignment` result beside `detail`, not derived at render time — derived separately the two contradicted each other mid-settle.
      - `openCamera` requests a **4:3 stream** to match the preview's aspect ratio. With `object-fit: cover` a 16:9 stream is cropped on screen while detection still sees the full frame, so a face the candidate cannot see would count as inside the oval.
    - **Microphone** passes only once the meter has **actually moved** past `HEARD_AT` — a device muted in the OS mixer opens fine and moves nothing. `HEARD_AT` is deliberately half of `LOUD_AT` in `audio-monitor.ts`; the two must be read together.
    - **Screen** re-evaluates on every `resize`, so un-maximising takes the pass away again.
    - **Connection** re-measures on a timer.
    - Continue is bound to the verdict **right now**, not one from a moment ago: cover the lens after passing and the button disables again.
  - `watchFaces` detects on a `<video>` the caller already owns, unlike `startFaceMonitor` which opens its own stream for the runtime. Opening a second camera for the readiness check would light two indicators and do double the work for the same answer.
  - Consequently `openCamera` and `openMicrophone` **hand their live resources back to the caller** rather than closing them on the spot; the wizard owns them and releases them when the step is left. A webcam left running behind a later step lights the candidate's camera indicator with nothing on screen explaining why.
  - There is no `canStart` helper any more. The wizard asks the smaller question at each step and will not advance until it passes, so reaching the end *is* the proof — a helper recomputing it from a bag of results would be a second source of truth for a rule the flow already enforces.
  - The meter's "we heard you" confirmation is **feedback, not a gate**: a very quiet microphone in a silent room would otherwise trap somebody who has done nothing wrong. Passing the step needs the device to open, not the candidate to make a noise. This reverses the original split, where only the camera and the runtime's own APIs blocked and the rest warned and let the candidate through: a warning nobody has to act on is a warning that gets waved past, and the candidate is the one who pays for it in the report afterwards. `warn` and `fail` now differ only in wording — `warn` means "you can fix this yourself right now" and carries a `fix` line saying how, `fail` means this machine or browser cannot do it.
  - **What each check can actually see matters.** `screen.isExtended` reports *physical* displays only; two windows side by side on one monitor are one display and no browser API can see what is drawn beside the page. `checkWindowFills` covers that case with a proxy — the window must cover ≥90% of `availWidth × availHeight` — which the candidate fixes by maximising.
  - **A refused camera or microphone permission cannot be re-prompted.** Once "Never allow" is chosen, `getUserMedia` rejects immediately and no web page can reopen that dialog; it is a browser security rule. The check therefore uses the Permissions API to tell "blocked" apart from "no device" and shows where the switch is, after which "Check again" picks up the new state.
  - The connection check times three round trips to a real authenticated endpoint and takes the median, with a cache-busting nonce — Express puts an ETag on the response, and without it a 304 would be timed instead of the request.
- **Untimed, unscored practice questions before the assessment (added 2026-08-19; made part of starting 2026-08-20).** Drawn from questions flagged `questions.isSample`, which the adaptive selector and the assessment pools both exclude, so a sample can never be served for real or counted. `PracticeService` aims for a **total of three**, round-robin across the assessment's subjects — three subjects give a tour of one apiece, one subject gives three from it. A per-subject cap could do neither, and gave single-subject assessments exactly one question, which rehearses nothing. The platform bank therefore seeds **three deliberately trivial samples per module**: the point is showing how a question is answered, never its difficulty. The point is that the first time somebody meets a ranking control is not while the clock is running. Each stage is entered through a **branded splash** (`SectionSplash`) — the AdaptiveHire mark, then "Sample test", then the assessment's own title read from the invitation, and again before **each section after the first** with that section's name. The first section is never announced: reaching it means passing the readiness check, which already ends on the assessment's own splash, and a second a heartbeat later reads as a stutter. It is a signpost, not a spinner: the sample questions and the real assessment use the same controls on purpose, so without a marker between them the moment answers begin to count would pass unannounced. The hold is fixed rather than tied to loading, and `prefers-reduced-motion` collapses the animation while keeping the pause. They are reached by pressing **"Start assessment"**, and the last one ends on **"Start assessment"** again — they are a stage of starting, not a side door labelled "try a few questions" that the people who most need them walked straight past. There is no skip; leaving means going back to the assessment list without starting anything.
  - **Nothing is marked and nothing is revealed.** Pick an option, move on. The reveal step and the "there is no right answer to this kind of question" verdict were both removed (2026-08-20): the point is that the *controls* are familiar, and a right/wrong badge here teaches a candidate to dread the next screen rather than to use it. It also means a sample's `correctOption` never reaches the candidate's eyes, only the API.
  - **The framing is deliberately light.** One "Warm-up · not scored" chip, and nothing else — no "this one does not count" headline, and no "a practice question…" preamble on the stem itself (that lived in the seeded question text and was removed there). A candidate must know these answers go nowhere; they must not be told so loudly that the rehearsal stops feeling like the real thing, because a rehearsal that does not feel real rehearses nothing.
- Auto-submit on timeout (BullMQ delayed job, fires even if the candidate's browser is closed)
- All violation events push to backend via WebSocket → `proctoring_logs` table
- **Explicitly out of scope for v1:** OS-level lockdown (SEB-style native app), object/phone detection in camera feed, video/audio recording or review, speech transcription, voice identification, ML-based anomaly detection. These are known, accepted limitations — not oversights.
- **Philosophy: detect and log for recruiter judgment, never auto-disqualify — once a module is underway.** Mid-test violations (tab switches, full-screen exits, face going briefly out of frame, etc.) never block, end, or fail the test; they are presented as data in the report and the recruiter makes the call. **The exceptions are all gates before anything starts, never penalties once it has:** the camera-mandatory check at the top of each module, and the system readiness check before the assessment, which since 2026-08-20 requires every one of its checks to pass. The distinction that matters is timing, not severity — nothing a candidate does *during* an attempt can end it early.

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