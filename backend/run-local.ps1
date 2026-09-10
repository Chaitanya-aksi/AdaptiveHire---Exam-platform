<#
.SYNOPSIS
  Runs the API on this machine, against the Docker Postgres and Redis.

.DESCRIPTION
  The repo-root .env is a PRODUCTION config — Aiven Postgres, Aiven Redis,
  MAIL_TRANSPORT=zoho-api and a CORS origin of https://adaptivehire.onslate.in.
  Running `npm run start:dev` on its own therefore starts a local server wired
  to production, which is never what you want while looking at the UI.

  Every one of those is overridden here. Three of them matter more than the
  rest:

    CORS_ORIGIN   Production only answers the onslate.in origin, which is why
                  a local frontend gets "Could not reach the API" — the request
                  leaves, and the browser discards the reply.

    BULL_PREFIX   BullMQ queues are shared by key. A local worker on the
                  production Redis with the production prefix will take invite
                  jobs off the queue Render is serving and try to send them
                  itself. That has already happened once on this project.

    MAIL_TRANSPORT
                  Blanking MAIL_HOST is not enough on its own: the zoho-api
                  branch runs ahead of the SMTP path, so it would still call
                  the real Zoho API. Set to smtp, with no host, so nothing can
                  leave this machine.

  Pair it with frontend/.env.development.local, which points the SPA at
  http://localhost:3001/api and is loaded only by `vite dev` — never by a
  production build.

.PARAMETER Prod
  Run against the PRODUCTION database and Redis instead. Read-only work only,
  and never while Render is also running: two workers on one queue race each
  other. Still forces a private queue prefix and a dead mail transport.

.EXAMPLE
  .\run-local.ps1

.EXAMPLE
  # In a second terminal:
  cd ..\frontend; npm run dev
#>
[CmdletBinding()]
param(
  [switch]$Prod
)

$ErrorActionPreference = 'Stop'

if (-not $Prod) {
  # Ports match docker-compose.yml as it runs on this machine: Postgres is
  # mapped to 5434 to keep it off a local install's default 5432.
  $env:POSTGRES_HOST = 'localhost'
  $env:POSTGRES_PORT = '5434'
  $env:POSTGRES_USER = 'adaptivehire'
  $env:POSTGRES_PASSWORD = 'adaptivehire'
  $env:POSTGRES_DB = 'adaptivehire'
  # The local container has no certificate, and the production CA in .env
  # would be verified against it and fail.
  $env:POSTGRES_SSL = 'false'
  $env:POSTGRES_CA_CERT = ''

  $env:REDIS_URL = 'redis://localhost:6379'
  $env:REDIS_HOST = 'localhost'
  $env:REDIS_PORT = '6379'

  Write-Host 'Database : local Docker (localhost:5434)' -ForegroundColor Green
} else {
  Write-Host 'Database : PRODUCTION (Aiven). Read-only work only.' -ForegroundColor Yellow
}

# 3001 is this project's convention; KhetPilot uses 3000.
$env:PORT = '3001'
$env:NODE_ENV = 'development'
$env:CORS_ORIGIN = 'http://localhost:5174'
$env:APP_URL = 'http://localhost:5174'

# Namespaced away from anything Render is serving. Never remove this.
$env:BULL_PREFIX = 'bull-local'

# No real inbox is reachable from here.
$env:MAIL_TRANSPORT = 'smtp'
$env:MAIL_HOST = ''

Write-Host 'API      : http://localhost:3001/api'
Write-Host 'Accepting: http://localhost:5174'
Write-Host 'Queue    : bull-local (isolated)'
Write-Host 'Mail     : off'
Write-Host ''

npm run start:dev
