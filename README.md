# Resend Email Service

A lightweight, self-hosted email operations layer built on top of [Resend](https://resend.com).

This project is intentionally not a full SMTP platform. It focuses on the operational layer most small teams need:

- campaign composition and previews
- subscriber management and tagging
- drip-style campaign delivery with a DB-backed job queue
- Resend webhook ingestion for engagement and suppression handling
- public subscribe forms with double opt-in support
- a single-container deployment model using SQLite

## What It Does

### Admin
- Password-style admin login using `API_SECRET` with a short-lived HTTP-only session cookie
- Dashboard with subscriber totals, engagement metrics, warmup state, and recent batches
- Subscriber CRUD, bulk status changes, tag assignment, CSV import/export
- Campaign editor with rich-text mode, raw HTML mode, merge tags, test send, and live preview
- Image asset upload for email templates, including inline embedded-image sending support

### Sending
- Sends through Resend batch API when possible
- Automatically falls back to throttled single-send mode when a template uses embedded images
- Campaign delivery is deduplicated per campaign, not per day across the whole system
- DB-backed drip queue with resumable jobs and retry handling
- Warmup-aware drip defaults for newer domains

### Compliance And Safety
- Unsubscribe links and `List-Unsubscribe` headers
- Bounce/complaint webhooks automatically suppress future sends
- Public subscribe endpoint supports double opt-in, resend cooldowns, per-IP / per-email rate limiting, and a honeypot field
- Admin HTML is sanitized on save/send and previewed inside a sandboxed iframe
- Resend webhook signatures are verified against the raw request body

## Architecture

### Stack
- Runtime: Node.js + TypeScript
- API: Express
- Database: SQLite via `better-sqlite3`
- Mail transport: Resend API
- Frontend: Vanilla HTML/CSS/JS
- Deployment: Docker / Railway

### Storage
- `data/email_service.db`: SQLite database
- `data/email-assets/`: uploaded email images and asset manifest

Mount `data/` on a persistent volume in production.

You can relocate runtime storage with `DATA_DIR`, `DATABASE_PATH`, and `BACKUP_DIR`.

## Quick Start

```bash
git clone https://github.com/okjusthere/emailService.git
cd emailService
npm install
cp .env.example .env
# edit .env
npm run dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin).

## Environment Variables

```bash
# Required
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=newsletter@yourdomain.com
FROM_NAME=Your Company
REPLY_TO_EMAIL=hello@yourdomain.com
API_SECRET=your-admin-secret
BASE_URL=https://your-domain.com
DATA_DIR=./data
BACKUP_DIR=./backups
COMPANY_NAME=Your Company Inc.
COMPANY_ADDRESS=123 Main St, City, State ZIP

# Delivery
DAILY_SEND_COUNT=5000
BATCH_SIZE=100
SEND_START_DATE=2026-03-25
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx

# Admin auth
ADMIN_SESSION_TTL_HOURS=12

# Subscribe endpoint hardening
DOUBLE_OPTIN=true
SUBSCRIBE_ALLOWED_ORIGINS=https://your-domain.com,https://www.your-site.com
SUBSCRIBE_RATE_WINDOW_MINUTES=60
SUBSCRIBE_IP_WINDOW_MAX=20
SUBSCRIBE_EMAIL_WINDOW_MAX=5
CONFIRMATION_RESEND_COOLDOWN_MINUTES=15
```

Notes:

- `SUBSCRIBE_ALLOWED_ORIGINS` should list every origin allowed to host your embedded subscribe form. If omitted, it defaults to `BASE_URL`'s origin.
- In production, `RESEND_WEBHOOK_SECRET` should always be set.
- `API_SECRET` is still accepted on `x-api-secret` for scripted admin API access, but the browser admin uses a session cookie after login.
- `DATABASE_PATH` overrides the SQLite file directly; otherwise it lives under `DATA_DIR`.

## Verification

```bash
npm run check
npm test
```

`npm run check` runs the production build plus a frontend syntax check. `npm test` runs a small integration test suite against a temporary SQLite database.

## Backups

Create a timestamped backup with:

```bash
npm run backup
```

The backup script:

- creates a consistent SQLite snapshot via `VACUUM INTO`
- copies uploaded email assets and their manifest
- writes backup metadata to `metadata.json`

Restoring is intentionally manual: stop the app, replace the database and asset files from a chosen backup, then restart the service.

## Public Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Basic health check |
| `/subscribe` | `GET` | Hosted subscribe page |
| `/api/subscribe` | `POST` | Public subscribe API |
| `/api/subscribe/confirm` | `GET` | Double opt-in confirmation |
| `/unsubscribe` | `GET`, `POST` | Hosted unsubscribe flow |
| `/webhook/resend` | `POST` | Resend webhook receiver |

## Admin Endpoints

| Endpoint | Method | Auth |
| --- | --- | --- |
| `/admin` | `GET` | Browser UI |
| `/api/admin/login` | `POST` | `API_SECRET` in request body |
| `/api/admin/logout` | `POST` | Session cookie |
| `/api/admin/*` | `GET/POST/PUT/DELETE` | Session cookie or `x-api-secret` |

## Railway Deployment

1. Push the repository to GitHub.
2. Create a Railway service from the repo.
3. Add a volume mounted at `/app/data`.
4. Configure the environment variables above.
5. Deploy.

Recommended production checks:

- verify `/health`
- verify `/admin`
- configure the Resend webhook endpoint as `https://your-domain.com/webhook/resend`
- confirm `SUBSCRIBE_ALLOWED_ORIGINS` matches every site embedding the subscribe form
- schedule regular `npm run backup` execution against persistent storage

## Project Hygiene

- CI runs `npm run check` and `npm test` on pushes and pull requests.
- Contributor workflow is documented in [CONTRIBUTING.md](/Users/weizhengle/Downloads/vibecoding/Email%20Service/CONTRIBUTING.md).

## Current Positioning

This project is best thought of as a lightweight Resend-backed email operations service, not a full replacement for systems like Postal or broader marketing suites like Mautic. It keeps the sending surface small and operationally simple by delegating deliverability infrastructure to Resend.

## License

MIT
