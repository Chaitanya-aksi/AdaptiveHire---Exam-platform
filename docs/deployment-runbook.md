# Deployment runbook

Target stack, decided 2026-09-03: the React SPA on **Zoho Catalyst** Web Client
Hosting, the NestJS API and its three BullMQ workers on a **Render** free web
service, and **Aiven** for both PostgreSQL and Valkey. No payment method on any
of them.

The full analysis — twenty failure modes with their fixes — is the *AdaptiveHire
Deployment Register* artifact. This file covers only what you have to *do*, in
order, and the settings that are wrong by default.

## Why Aiven for Redis, specifically

Do not substitute Upstash. BullMQ workers block-poll on `drainDelay` (~5s), and
this app runs three queues — `auto-submit`, `invite-emails`,
`report-generation`, each with its own `@Processor`. That is roughly 1.5M
commands a month **while completely idle**, against Upstash's free 500k: the
quota is gone in about ten days having run no assessments at all. Aiven Valkey
bills capacity, not commands.

Two further reasons it has to be a real Redis instance:

- BullMQ needs `noeviction` to be correct, which is Aiven's default. Do not
  switch it to an LRU policy to buy headroom — jobs would be dropped silently.
- `session:{id}:module:{moduleId}:clock` is an empty key **whose TTL is the
  module timer** (`sessions/redis-session.service.ts`). Evicting it is not a
  cache miss, it is a candidate losing their clock mid-exam.

## Order of operations

### 1. Create the data services first

Create the Aiven PostgreSQL and Valkey services **on the same cloud provider and
region as the Render service**. Every question served costs a round trip to
both; Render in Oregon with Aiven in Frankfurt is felt on every answer
submission. Pick the Render region first, then match it.

Aiven's free plans have **no backups**. Schedule a `pg_dump` from a machine you
control — Aiven is publicly reachable, exactly like the migration path below.
This is the one place a different provider (Neon) would be genuinely better, and
a dump closes it more cheaply than switching.

### 2. Run migrations from your own machine

Free Render services get no shell, no SSH and no one-off jobs, and
`migrationsRun` is `false` by design. Run them locally against the hosted
database:

```bash
cd backend
POSTGRES_HOST=pg-xxxx.aivencloud.com \
POSTGRES_PORT=12345 \
POSTGRES_USER=avnadmin \
POSTGRES_PASSWORD=**** \
POSTGRES_DB=defaultdb \
POSTGRES_SSL=true \
POSTGRES_CA_CERT="$(base64 -w0 ca.pem)" \
npm run migration:run
```

**Do not put migrations in the build command.** Render builds while the previous
instance is still serving, so a destructive migration would break the running
version — and a failed build leaves the schema half-applied with no shell to
inspect it from.

Afterwards, diff the `migrations` table against the committed files. This
project has had migrations applied with no committed source before; the check
costs one query.

### 3. Set the backend environment

Every one of these is wrong by default for a hosted deployment. Defaults suit
docker compose, which needs no TLS and sits behind no proxy.

| Variable | Value | Why |
|---|---|---|
| `POSTGRES_SSL` | `true` | Aiven refuses plaintext |
| `POSTGRES_CA_CERT` | base64 of the CA | Without it the server is unauthenticated |
| `POSTGRES_POOL_MAX` | `5` | Free plan allows 20 connections, no pooler |
| `REDIS_URL` | the `rediss://` URL | Carries credentials and turns TLS on |
| `COOKIE_SECURE` | `true` | Required by `COOKIE_SAMESITE=none` |
| `COOKIE_SAMESITE` | `none` | SPA and API are different sites |
| `TRUST_PROXY` | `true` | Otherwise one rate-limit bucket for everyone |
| `CORS_ORIGIN` | the exact Catalyst origin | No trailing slash |
| `APP_URL` | the Catalyst origin | Builds links inside invite emails |

`COOKIE_SAMESITE=none` without `COOKIE_SECURE=true` is refused at boot rather
than discovered in production, because its symptom is the worst kind: login
appears to succeed and every session dies at the next page load, with no error
anywhere.

**If you own a domain, prefer subdomains.** Point `app.example.com` at Catalyst
and `api.example.com` at Render: they are then same-site, `COOKIE_SAMESITE` stays
`lax`, and you sidestep third-party-cookie blocking entirely — which is where
`SameSite=None` is heading in Chrome regardless. Render supports custom domains
on the free tier.

### 4. Keep the service awake

Point a free scheduler (cron-job.org needs no card) at
`https://<service>.onrender.com/api/health` **every 10 minutes**. The window is
15 and a single missed run at 14-minute spacing puts you to sleep.

This one job covers three problems: Render sleeping, Aiven powering off free
services for inactivity, and — the one that actually loses data —
**auto-submit**. Auto-submit is a delayed BullMQ job, and a delayed job needs a
live worker. Asleep at the deadline means the session stays `in_progress` with
no report until something wakes the service. Nothing is lost; it processes on
wake, but it is late.

`/api/health` is already `@Public()` and probes Postgres *and* Redis, which also
makes it a usable round-trip latency probe for step 1.

### 5. Turn off auto-deploy

Two reasons, one setting. Free Render is a single instance with no zero-downtime
deploy, so a push during a test window drops every candidate's socket; and the
free tier allows 500 build minutes a month, which a NestJS build will spend.

Before any manual deploy:

```sql
SELECT count(*) FROM assessment_sessions WHERE status = 'in_progress';
```

Candidates do recover — `rehydrate()` rebuilds session state from `responses` —
but module clocks restart generously, which is a real advantage handed to
whoever was mid-module, and it is visible in the data.

### 6. Verify, in this order

1. **Catalyst deep links.** Open `/admin/assessments` directly and reload. If it
   404s, Catalyst is not rewriting unknown paths to `index.html` and cannot host
   the SPA — move the frontend to Cloudflare Pages or Netlify, both free with no
   card. Test this before anything else; it decides the stack.
2. **Login survives a reload.** This is the `COOKIE_SAMESITE` check, and it
   fails silently when wrong.
3. **Logout actually clears the cookie.** `clearCookie` must be given the same
   attributes the cookie was written with or the browser keeps it.
4. **Rate limits are per-client.** Hit a throttled endpoint from two networks and
   confirm the counters are independent. Wrong, this reads as sporadic 429s
   under light load — like a bug in your own code.
5. **One invite email before any batch.** Zoho burst-blocks new senders and the
   invite endpoint answers 204 whether or not the mail left. Check the worker
   logs, not the HTTP response.

## Frontend

`VITE_API_URL` and `VITE_WS_URL` are compiled into the bundle at build time.
Editing them on the host changes nothing, and the failure shows up on the next
deploy rather than when the value was edited. Treat the frontend env as source:
change it, `npm run build`, redeploy the output. Everything `VITE_` is public by
definition, so a committed `.env.production` carries no secret and makes the
values that shipped recoverable.

Serve all static assets — the face-api models included — from Catalyst. Render's
free tier suspends the service on bandwidth overage rather than billing for it,
so the API should emit JSON and socket frames and nothing else.
