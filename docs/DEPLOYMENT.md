# Deployment and operations

## What runs where

| Part                  | How it ships                                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| API (NestJS)          | Docker image `apps/api/Dockerfile` (`migrate` target runs database migrations) |
| Admin panel (Next.js) | Docker image `apps/admin/Dockerfile` (API URL baked in at build time)          |
| Database              | PostgreSQL 16                                                                  |
| HTTPS                 | Caddy, with automatic Let's Encrypt certificates                               |
| Mobile app            | Expo EAS builds for Google Play and the App Store (see RELEASE-CHECKLIST.md)   |

## Single server (good for launch)

A 4 GB / 2 vCPU VPS (e.g. in a Nairobi or Johannesburg region for low latency) is enough to start; the load test numbers are in LOAD-TEST.md.

1. Point two DNS records at the server, e.g. `api.errandconnect.co.ke` and `admin.errandconnect.co.ke`.
2. Install Docker, clone the repository, then:
   ```bash
   cd deploy
   cp .env.production.example .env.production   # fill in every value; one `openssl rand -base64 48` per secret
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
   This starts PostgreSQL, runs migrations, then starts the API, admin panel and Caddy. Certificates are issued on first request.
3. Create the first super admin:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate npx prisma db seed
   ```
   (with `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` set). Sign in to the admin panel and set up two-factor sign-in, which is required for all staff in production.
4. Register the M-Pesa callback URLs with Safaricom: `https://api…/payments/mpesa/stk-callback/<MPESA_CALLBACK_SECRET>` and the B2C result/timeout URLs (see PAYMENTS.md).

**Updating:** `git pull`, then the same `up -d --build`. Migrations run before the new API starts; if they fail, the old API keeps running.

## The API refuses to start with unsafe settings

In production (`NODE_ENV=production`) the API checks its settings at startup and stops with a clear list of problems if any secret is missing, short, still the example value, or reused; if `CORS_ORIGINS` is empty; if `MPESA_MODE=fake`; or if staff two-factor sign-in is switched off.

## Settings worth knowing

| Variable              | Purpose                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`         | Number of proxies in front of the API (1 behind Caddy) so rate limits, sessions and risk rules see real client IPs    |
| `LOG_REQUESTS`        | `false` logs only errors                                                                                              |
| `STAFF_MFA_REQUIRED`  | Always on in production                                                                                               |
| `DATA_ENCRYPTION_KEY` | Encrypts staff two-factor secrets; changing it means staff must set up two-factor again                               |
| `STORAGE_DIR`         | Where uploaded documents are kept (a Docker volume). Move to S3-compatible storage before running several API servers |

## Logs and monitoring

- In production the API writes one JSON object per line (level, time, message, context), ready for any log collector (Grafana Loki, Datadog, Cloud Logging). Every request gets an `X-Request-Id`; errors returned to users include it as `requestId`, so support can find the exact log line.
- Watch: `GET /health` (also used by Docker's health check), the rate of 5xx log lines, and M-Pesa callback failures.
- Unexpected errors are logged with a stack trace and never shown to users.

## Backups

Customer money is involved: back up the database at least daily and test restoring.

```bash
# Daily (cron), keep 30 days, copy off the server (e.g. to object storage)
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U errand -Fc errandconnect > backup-$(date +%F).dump
# Restore into an empty database
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U errand -d errandconnect --clean < backup-YYYY-MM-DD.dump
```

Back up the `uploads` volume too (runner ID documents). A managed PostgreSQL with point-in-time recovery is worth it once there is real money flowing.

## Scaling later

- Run several API containers behind the load balancer. Before that: move document storage to S3-compatible storage, and add a Socket.IO Redis adapter so live updates reach users connected to any instance.
- The hourly jobs (risk scan, Plus renewals) are safe to run on several instances (they are idempotent) but wasteful; move them to one worker container.
- Pricing and growth settings are cached for 30 seconds per instance.
