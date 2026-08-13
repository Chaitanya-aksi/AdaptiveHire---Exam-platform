# Running AdaptiveHire on a new machine

Everything a teammate needs after cloning the repo. Verified on Node 24.14.1,
npm 11.11.0, Docker 29.4.1 — earlier Node 20+ is fine.

---

## 0. First: make sure the work is actually pushed

**Check this before anything else.** A clone only contains what has been
committed *and* pushed. If the repo on GitHub is behind, the steps below will set
up a different, older application — and the migration list in step 5 will not
match.

Run this on the machine that has the work:

```bash
git status -sb          # look for "ahead N" and any M / ?? lines
git log origin/main..HEAD --oneline
```

If anything is listed, commit and push it first. Pay particular attention to
`backend/src/database/migrations/` — a migration that exists on one machine and
not in the repo is the hardest failure to diagnose later, because the database
schema and the code silently disagree.

---

## 1. Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20 or newer | `node -v` |
| npm | 10 or newer | `npm -v` |
| Docker Desktop | any current | `docker --version` — and make sure it is **running** |
| Git | any | `git --version` |

Nothing else needs installing globally: Postgres and Redis come from Docker, and
Nest/Vite are local dev dependencies.

---

## 2. Clone

```bash
git clone <repo-url> AdaptiveHire
cd AdaptiveHire
```

---

## 3. Create the two `.env` files

Both are gitignored, so neither arrives with the clone. **Two are needed** — one
at the repo root for the backend and Docker, one in `frontend/`.

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Then edit the root `.env` and replace the two placeholder secrets. Generate each
one separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```diff
- JWT_ACCESS_SECRET=change-me-access-secret
+ JWT_ACCESS_SECRET=<first generated value>
- JWT_REFRESH_SECRET=change-me-refresh-secret
+ JWT_REFRESH_SECRET=<second generated value>
```

Everything else in `.env.example` works unchanged for local development. Leave
`MAIL_HOST` blank — the invite-email worker then prints the rendered email to the
backend console instead of sending it, so the whole invitation flow is testable
without a mail account.

`frontend/.env` needs no edits unless the API port is changed.

---

## 4. Start Postgres and Redis

```bash
docker compose up -d postgres redis
docker compose ps
```

Wait until both report `healthy` (a few seconds). Compose reads the same root
`.env`, so the ports below come from it.

| Service | Host port | Inside Docker | Credentials |
| --- | --- | --- | --- |
| Postgres | **5434** | 5432 | user / password / db all `adaptivehire` |
| Redis | **6379** | 6379 | none |

Data persists in the named volumes `postgres-data` and `redis-data`, so stopping
the containers does not lose the database.

---

## 5. Set up the backend

```bash
cd backend
npm ci
npm run migration:run
```

`migration:run` should apply **11** migrations to an empty database. Confirm:

```bash
npm run migration:show
```

The list, oldest first:

| # | Migration |
| --- | --- |
| 1 | `InitialSchema` |
| 2 | `TraitDefinitions` |
| 3 | `RefreshTokenGraceWindow` |
| 4 | `RecentRefreshTokens` |
| 5 | `InvitationByEmail` |
| 6 | `BehavioralQuestionPatterns` |
| 7 | `WorkplaceTraitVocabulary` |
| 8 | `BehavioralCompositeScores` |
| 9 | `RepeatConsistencyProbes` |
| 10 | `Organisations` |
| 11 | `QuestionForks` |

If fewer appear, step 0 was skipped — the missing migrations are not in the
clone.

### Seed the starter data

```bash
npm run seed
```

That runs four scripts **in this order, and the order matters** — each needs what
the earlier ones create:

| Script | Creates | Needs |
| --- | --- | --- |
| `seed:users` | the `AdaptiveHire` organisation, one recruiter in it, one candidate | — |
| `seed:modules` | Aptitude, Logical Reasoning, Verbal Ability (objective) + Personality (trait, 10 workplace traits) | — |
| `seed:assessments` | one sample assessment with three modules | the organisation, the modules |
| `seed:questions` | the fixture question bank, imported through the real bulk importer and activated | an author, the modules |

### Expect "25 failed" — it is not a broken setup

The last line reads:

```
185 imported, 25 failed, 185 activated
```

The 25 rejections are all of `fixtures/personality.csv`, and they are expected.
That file holds legacy agree/disagree (Likert) questions written before the four
behavioural patterns existed. The importer now requires a new behavioural question
to declare its pattern and deliberately refuses to guess one, so those rows can no
longer be created — labelling a Likert statement "situational" would misrepresent
it in every report.

The behavioural bank that replaced them (`personality-behavioral.csv` plus the
probe pairs) imports cleanly, so the Personality module still gets 44 questions.
Nothing else fails.

> Databases seeded before that rule came in — including the original dev
> machine — still contain those 25 rows, so their bank shows 210 rather than 185.
> That difference is expected and harmless.

Seeded questions are **platform questions** — owned by no organisation, so every
company that signs up can use them and none can edit them in place. They are
synthetic content written to exercise the adaptive engine, all tagged `fixture`.

Each script skips work already done. `seed:questions` refuses to run twice
(it would double the bank); to reload it deliberately:

```bash
SEED_FORCE=true npm run seed:questions
```

### Start the API

```bash
npm run start:dev
```

Check it: <http://localhost:3001/api/health> — reports Postgres and Redis
reachability.

---

## 6. Set up the frontend

In a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5174>.

**The port must be 5174.** The backend's `CORS_ORIGIN` is pinned to it, so if
Vite starts on 5175 because something else holds 5174, every API call fails with
a CORS error that looks like the backend being down. See troubleshooting below.

---

## 7. Sign in

There are two separate sign-in pages, and each only accepts its own audience —
a recruiter is refused on the candidate page and pointed at the right one.

| Who | URL | Seeded account |
| --- | --- | --- |
| Candidate | `/login` | `candidate@adaptivehire.local` |
| Recruiter | `/recruiter/login` | `recruiter@adaptivehire.local` |

Password for both: `ChangeMe!2345` (override with `SEED_PASSWORD` when seeding).

She can also register her own company from
`/recruiter/register` — reached from "Register to host assessments" on the
recruiter sign-in page. That creates a fresh organisation with its own private
workspace: it sees the platform question bank but none of another company's
assessments, candidates or reports.

Candidate sign-up at `/register` is invite-only by design — an account is only
created for an email a recruiter has already invited.

---

## 8. Confirm it works

```bash
cd backend
npm test          # 125 unit tests — the reliable green check
```

Expected state after seeding:

```bash
docker exec adaptivehire-postgres psql -U adaptivehire -d adaptivehire -c "
select (select count(*) from organisations) organisations,
       (select count(*) from users) users,
       (select count(*) from modules) modules,
       (select count(*) from questions) questions,
       (select count(*) from questions where \"organisationId\" is null) platform_questions;"
```

On a clean install that returns:

| organisations | users | modules | questions | platform_questions |
| --- | --- | --- | --- | --- |
| 1 | 2 | 4 | 185 | 185 |

Plus one sample assessment with three modules. The whole bank is
platform-owned, which is what makes it usable by every company that signs up.

> **`npm run verify` currently fails**, and not because the setup is wrong. It
> runs the e2e suites as well, and `test/step2-question-bank.e2e-spec.ts` still
> asserts the old Big Five trait vocabulary that the `WorkplaceTraitVocabulary`
> migration replaced with ten workplace traits. Use `npm test` until those
> suites are updated.

---

## 9. Optional: run the API in Docker too

```bash
docker compose up -d --build
```

Compose overrides `POSTGRES_HOST`/`REDIS_HOST` to the service names, so the same
`.env` works either way. The API is still on host port 3001. Useful for checking
the container build; the local `npm run start:dev` gives faster reloads.

---

## Troubleshooting

**"Could not reach the API" / CORS errors in the browser console.**
Almost always the frontend port, not the backend. Vite must be on **5174** to
match `CORS_ORIGIN`. If it printed a different port, free 5174 or change both
`CORS_ORIGIN` and `APP_URL` in the root `.env` and restart the API.

**Port 5434 or 6379 already in use.**
Change `POSTGRES_PORT` / `REDIS_PORT` in the root `.env` and re-run
`docker compose up -d`. Compose and the backend read the same values, so they
stay in step. (5434 is already a deliberate dodge around other local Postgres
instances.)

**`ECONNREFUSED` from the backend on startup.**
Docker Desktop is not running, or the containers are not healthy yet. Check with
`docker compose ps`.

**Migrations "already loaded" but tables are missing.**
The database and the code disagree — usually a database created before a
migration was committed. Compare them:

```bash
docker exec adaptivehire-postgres psql -U adaptivehire -d adaptivehire -c \
  "select name from migrations order by timestamp;"
ls backend/src/database/migrations/
```

The cleanest fix on a dev machine is to start over:

```bash
docker compose down -v      # deletes the volumes and all local data
docker compose up -d postgres redis
cd backend && npm run migration:run && npm run seed
```

**`seed:questions` says questions already exist.**
Deliberate — re-running would double the bank. Use
`SEED_FORCE=true npm run seed:questions`.

**Invite emails never arrive.**
Expected with `MAIL_HOST` blank: the rendered email is printed to the backend
console instead. Fill in the `MAIL_*` values to send for real; no code change is
needed.

**A recruiter account cannot sign in on `/login`.**
Working as intended — each page is restricted to its own audience. The error
names the other page and links to it.
