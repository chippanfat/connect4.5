# Four in a Row

A responsive, private, real-time Four-in-a-Row game for mobile and desktop browsers. Two verified players share an invitation, play against a server-authoritative clock, reconnect safely, and can agree to a rematch.

## Architecture

- `apps/web` — React, Vite, React Router, TanStack Query, and Socket.IO client.
- `apps/api` — Express 5, Better Auth, Socket.IO, REST game services, and the timeout worker.
- `packages/game-engine` — immutable 7×6 rules with no framework dependencies.
- `packages/contracts` — Zod schemas and shared REST/socket types.
- `packages/db` — Drizzle schema and PostgreSQL migrations.

PostgreSQL is authoritative for every move. Redis Streams coordinates Socket.IO instances and connection recovery. A separate worker settles expired clocks with locked, idempotent database transactions.

## Local development

Requirements: Node.js 24, Corepack, and Docker.

1. Copy `.env.example` to `.env` and replace `BETTER_AUTH_SECRET`.
2. Start PostgreSQL, Redis, and Mailpit with `corepack pnpm dev:infra`.
3. Apply migrations with `corepack pnpm --filter @four/db db:migrate`.
4. Start the web app, API, and timeout worker with `corepack pnpm dev`.

Open [http://localhost:5173](http://localhost:5173). Development email is visible in Mailpit at [http://localhost:8025](http://localhost:8025).

If PostgreSQL or Redis already uses the default host port, override only the host mappings, for example `POSTGRES_PORT=5433 REDIS_PORT=6380 corepack pnpm dev:infra`, and update the two URLs in `.env` to match.

## Verification

- `corepack pnpm test` — engine and service tests; PostgreSQL integration tests run when `TEST_DATABASE_URL` is set.
- `corepack pnpm typecheck` — strict TypeScript across the workspace.
- `corepack pnpm lint` and `corepack pnpm format:check` — source quality.
- `corepack pnpm build` — production builds.
- `corepack pnpm test:e2e` — Chromium, Firefox, WebKit, and mobile viewport checks. Set `RUN_FULL_E2E=1` with local infrastructure running to include the two-account Mailpit-backed game flow.
- `corepack pnpm --filter @four/web test:multi-node` — a two-client, two-API Redis Streams smoke test. Start replicas on ports 4000 and 4001 and provide `TEST_HOST_EMAIL` and `TEST_GUEST_EMAIL` for verified disposable accounts.

The API publishes live/readiness checks at `/health/live` and `/health/ready` and Prometheus metrics at `/metrics`. The worker exposes the same paths on `WORKER_METRICS_PORT` (9091 by default), including timeout-lag and active-game gauges.

## Production

`docker-compose.production.yml` builds separate Caddy/web, API, and worker processes. Run database migrations as a release step before starting new application images. Caddy serves the React build, automatically obtains and renews TLS certificates, proxies `/api/*` and `/socket.io/*`, and uses an affinity cookie for Socket.IO polling across multiple API upstreams. Its certificate state is retained in the `caddy-data` and `caddy-config` volumes. Keep PostgreSQL and Redis on private networks, enable backups, and replace every example credential.

For the production Compose network, point `CADDY_SITE_ADDRESS` at a hostname whose DNS resolves to the server, expose TCP ports 80 and 443 plus UDP 443, and set `APP_ORIGIN` to the matching public HTTPS origin. Set `DATABASE_URL` to the `postgres` service and `REDIS_URL` to the `redis` service rather than `localhost`. `FOUR_API_UPSTREAMS` defaults to `api:4000`; it can contain a space-separated list when additional API services are added.

On a single Droplet, the deployed project lives at `/opt/four-in-a-row`. Useful operator commands are:

- `docker compose --env-file .env -f docker-compose.production.yml ps` — inspect service health.
- `docker compose --env-file .env -f docker-compose.production.yml logs -f api worker web` — follow application logs.
- `docker compose --env-file .env -f docker-compose.production.yml run --rm api node packages/db/dist/migrate.js` — apply migrations before an application update.
- `systemctl list-timers four-in-a-row-backup.timer` — inspect the daily PostgreSQL backup schedule.

The included backup timer retains 14 days of compressed logical dumps under `/var/backups/four-in-a-row`. Copy these backups off the Droplet or enable provider-level backups so a server failure does not remove both the database and its backups.

### SMTP email

For Postmark's default transactional stream, configure the API service with `SMTP_HOST=smtp.postmarkapp.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, and `SMTP_REQUIRE_TLS=true`. Use either a message-stream SMTP token's access key and secret key as `SMTP_USER` and `SMTP_PASSWORD`, or use the Postmark Server API token for both values. `EMAIL_FROM` must use a sender signature or domain verified in Postmark. Keep all SMTP credentials only in the server-side `.env` file.

The API renders the branded HTML, subject, and plain-text fallback from
[`apps/api/email-templates`](apps/api/email-templates/README.md) and sends them
with Nodemailer over SMTP. Postmark-hosted templates and template IDs are not
used. Local development sends the same rendered templates to Mailpit.
