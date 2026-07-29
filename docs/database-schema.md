# AdaptiveHire — Database Schema (v1)

Generated from the TypeORM entities under `backend/src/**/entities/`. The
migration `backend/src/database/migrations/*-InitialSchema.ts` creates exactly
this. Column names are camelCase because TypeORM's default naming strategy is
used unquoted-identifier-free (every column is quoted in generated SQL).

All primary keys are `uuid` with `uuid_generate_v4()` defaults. All timestamps
are `timestamptz`.

---

## Enums

| Enum | Values |
| --- | --- |
| `users_role_enum` | `candidate`, `recruiter_admin` |
| `modules_scoringtype_enum` | `objective`, `trait` |
| `questions_status_enum` | `draft`, `active`, `archived` |
| `invitations_status_enum` | `pending`, `in_progress`, `completed`, `expired`, `revoked` |
| `assessment_sessions_status_enum` | `in_progress`, `completed`, `auto_submitted`, `abandoned` |
| `session_module_results_stopreason_enum` | `confidence_reached`, `max_questions`, `time_expired`, `pool_exhausted` |
| `proctoring_logs_eventtype_enum` | `tab_switch`, `fullscreen_exit`, `face_absent`, `multiple_faces`, `multiple_displays_detected` |
| `reports_hiringrecommendation_enum` | `strongly_recommended`, `recommended`, `borderline`, `not_recommended` |

---

## `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `email` | varchar(255) | unique index, stored lowercase |
| `passwordHash` | varchar(255) | Argon2; `select: false` |
| `hashedRefreshToken` | varchar(255) NULL | Argon2 hash of the live refresh token; `select: false`. Nulled on logout so the cookie can be revoked server-side |
| `recentRefreshTokens` | jsonb NULL | `[{ hash, at }]`, newest first, `select: false`. Superseded tokens still inside the grace window — see [Refresh token rotation](../README.md#refresh-token-rotation) |
| `fullName` | varchar(150) | |
| `role` | enum | |
| `isActive` | boolean | default `true`; checked on every authenticated request |
| `createdAt` / `updatedAt` | timestamptz | |

## `modules`

Subjects as reference data — new subjects are rows, not code.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | varchar(120) | unique |
| `slug` | varchar(120) | unique |
| `description` | text NULL | |
| `scoringType` | enum | `objective` → Elo; `trait` → weighted |
| `traits` | jsonb NULL | `[{ key, label, invertForReport? }]`; only meaningful for `trait` modules. `key` is engine-facing (what option weights reference), `label` is what the report shows. The question selector reads it to find the least-covered trait |
| `isActive` | boolean | default `true` |
| `createdAt` / `updatedAt` | timestamptz | |

## `questions`

Shared parent row; the scoring-type-specific payload lives in one of the two
1:1 child tables.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `moduleId` | uuid FK → `modules` | `ON DELETE RESTRICT` |
| `questionText` | text | |
| `status` | enum | default `draft` — bulk imports land here |
| `tags` | text[] | default `{}` |
| `createdById` | uuid FK → `users` NULL | `ON DELETE SET NULL` |
| `createdAt` / `updatedAt` | timestamptz | |

Index: `(moduleId, status)` — the selector's candidate-pool filter.

## `mcq_question_details`

| Column | Type | Notes |
| --- | --- | --- |
| `questionId` | uuid PK, FK → `questions` | `ON DELETE CASCADE` |
| `options` | jsonb | `[{ key, text }]` |
| `correctOption` | varchar(16) | matches one `options[].key` |
| `difficultyScore` | integer | Elo scale, default `1000`, indexed |
| `timesUsed` | integer | default 0 |
| `timesCorrect` | integer | default 0 |

## `personality_question_details`

| Column | Type | Notes |
| --- | --- | --- |
| `questionId` | uuid PK, FK → `questions` | `ON DELETE CASCADE` |
| `options` | jsonb | `[{ key, text, traitWeights: { [trait]: number } }]` |
| `timesUsed` | integer | default 0 |

## `assessments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `title` | varchar(200) | |
| `description` | text NULL | |
| `isActive` | boolean | default `true` |
| `createdById` | uuid FK → `users` NULL | `ON DELETE SET NULL` |
| `createdAt` / `updatedAt` | timestamptz | |

## `assessment_modules`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `assessmentId` | uuid FK → `assessments` | `ON DELETE CASCADE` |
| `moduleId` | uuid FK → `modules` | `ON DELETE RESTRICT` |
| `minQuestions` | integer | floor the stopping engine respects |
| `maxQuestions` | integer | hard ceiling |
| `timeLimitSeconds` | integer | |
| `displayOrder` | integer | default 0 |

Unique: `(assessmentId, moduleId)`.

## `invitations`

Candidate access is login + assessment list — there is no emailed magic token.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `assessmentId` | uuid FK → `assessments` | `ON DELETE CASCADE` |
| `candidateId` | uuid FK → `users` | `ON DELETE CASCADE` |
| `invitedById` | uuid FK → `users` NULL | `ON DELETE SET NULL` |
| `status` | enum | default `pending` |
| `expiresAt` | timestamptz NULL | |
| `createdAt` / `updatedAt` | timestamptz | |

Unique: `(assessmentId, candidateId)`.

## `assessment_sessions`

Written once at start and once at end. Live in-progress state — current
question, running ability estimate, answered question ids — lives in Redis.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `invitationId` | uuid FK → `invitations` | unique; `ON DELETE RESTRICT` |
| `assessmentId` | uuid FK → `assessments` | `ON DELETE RESTRICT` |
| `candidateId` | uuid FK → `users` | `ON DELETE CASCADE` |
| `status` | enum | default `in_progress` |
| `startedAt` | timestamptz | |
| `expiresAt` | timestamptz | server-authoritative deadline; the BullMQ auto-submit job is keyed off it |
| `submittedAt` | timestamptz NULL | |
| `createdAt` / `updatedAt` | timestamptz | |

Index: `(candidateId, status)`.

## `session_module_results`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sessionId` | uuid FK → `assessment_sessions` | `ON DELETE CASCADE` |
| `moduleId` | uuid FK → `modules` | `ON DELETE RESTRICT` |
| `abilityScore` | numeric(8,2) NULL | final Elo estimate; null for `trait` modules |
| `traitScores` | jsonb NULL | `{ [trait]: { score, confidence } }`; null for `objective` modules |
| `questionsAnswered` | integer | default 0 |
| `questionsCorrect` | integer | default 0 |
| `stopReason` | enum NULL | why the stopping engine ended the module |
| `startedAt` / `completedAt` | timestamptz NULL | |

Unique: `(sessionId, moduleId)`.

## `responses`

One row per answered question. `abilityEstimateAfter` and
`questionDifficultyAtServe` are long-lived production data for future engine
tuning, not debug output.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sessionId` | uuid FK → `assessment_sessions` | `ON DELETE CASCADE` |
| `moduleId` | uuid FK → `modules` | `ON DELETE RESTRICT` |
| `questionId` | uuid FK → `questions` | `ON DELETE RESTRICT` |
| `selectedOption` | varchar(16) NULL | null if the module timed out unanswered |
| `isCorrect` | boolean NULL | null for `trait` modules |
| `abilityEstimateAfter` | numeric(8,2) NULL | |
| `questionDifficultyAtServe` | numeric(8,2) NULL | snapshot — the stored difficulty drifts as more candidates see the question |
| `sequenceNumber` | integer | 1-based position in the session |
| `timeTakenMs` | integer NULL | |
| `answeredAt` | timestamptz | |

Unique: `(sessionId, questionId)` — the "no revisiting" rule, enforced at the
database level as well as in Redis.
Index: `(sessionId, sequenceNumber)`.

## `proctoring_logs`

Detect and log for recruiter judgment — never auto-disqualify.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sessionId` | uuid FK → `assessment_sessions` | `ON DELETE CASCADE` |
| `eventType` | enum | |
| `occurredAt` | timestamptz | client-reported event time |
| `metadata` | jsonb NULL | e.g. `{ faceCount: 2 }`, `{ screenCount: 3 }` |
| `createdAt` | timestamptz | when the server stored it |

Index: `(sessionId, occurredAt)` — also the intended pruning key for the
retention job planned after v1.

## `reports`

Summary layer only. Per-question answers and the proctoring event list are
deliberately not duplicated here; the detail view queries `responses` and
`proctoring_logs` live.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sessionId` | uuid FK → `assessment_sessions` | unique; `ON DELETE CASCADE` |
| `summary` | text | |
| `strengths` | jsonb | default `[]` |
| `weaknesses` | jsonb | default `[]` |
| `hiringRecommendation` | enum | rule-based |
| `overallScore` | numeric(5,2) NULL | normalised 0–100 roll-up, for list sorting |
| `generatedAt` | timestamptz NULL | |
| `createdAt` / `updatedAt` | timestamptz | |

---

## Decisions made while implementing (not in the original spec)

These filled gaps the spec left open. Flagging them so they can be reversed
cheaply if they don't match intent:

1. **`users.hashedRefreshToken`** — needed to revoke a refresh token on logout
   and to detect reuse of a rotated one. The alternative was a separate
   `refresh_tokens` table, which v1 doesn't need.
2. **`modules.traits`** — the trait-module question selector has to know which
   traits exist before any question is answered; there was nowhere else to
   declare them. Stored as jsonb rather than `text[]` so each trait can carry
   its recruiter-facing label and `invertForReport` flag as data — a new trait
   module then needs no code change, matching the "subjects are rows, not
   code" rule.
3. **`responses.questionDifficultyAtServe`** — `difficultyScore` on the
   question drifts over time, so tuning the engine later needs the value that
   was actually in play.
4. **`session_module_results.stopReason`** — makes "why did this candidate get
   9 questions and that one 12" answerable without replaying the session.
5. **`assessments.isActive` / `modules.isActive`** — a soft on/off switch,
   rather than a full draft→review→published workflow (explicitly out of scope
   for v1).
