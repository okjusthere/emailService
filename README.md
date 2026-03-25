# 📧 Resend Email Service

A lightweight, self-hosted bulk email service with admin dashboard, built on [Resend API](https://resend.com). CAN-SPAM compliant out of the box.

> **The simplest way to manage and send bulk emails with Resend.** No Redis, no PostgreSQL — just SQLite and one container.

---

## ✨ Features

### Admin Dashboard
- 🔐 **Login authentication** — API secret based, no registration needed
- 📊 **Dashboard** — subscriber stats, engagement rates (open/click/bounce), warmup progress
- 👥 **Subscriber management** — search, filter, add, delete, bulk operations
- 📤 **CSV import / export** — upload subscribers in bulk, download lists anytime
- ✉️ **Email editor** — compose with live preview, full template preview with header/footer
- 📧 **Test send** — send yourself a preview before blasting to thousands
- 🚀 **One-click send** — trigger batch send from the dashboard
- 📋 **Send history** — batch logs with status tracking

### Email Engine
- 🔄 **Resend Batch API** — sends 100 emails per API call with rate limiting
- ♻️ **Round-robin scheduling** — rotates through subscribers evenly
- 🛡️ **Duplicate prevention** — never sends to the same person twice in one day
- 🔥 **IP warmup** — 14-day graduated volume (200→5000) for new domains
- ⏰ **Cron scheduler** — optional daily automatic sends
- 🪝 **Webhook auto-handling** — bounces and complaints auto-deactivate subscribers
- ✅ **Webhook signature verification** — HMAC-SHA256 with replay protection

### Compliance
- 📜 **CAN-SPAM Act** — physical address, ad disclosure, one-click unsubscribe
- 📧 **List-Unsubscribe header** — meets Google/Yahoo 2024 bulk sender requirements
- 🔒 **SPF/DKIM/DMARC** — handled by Resend's infrastructure

## 🚀 Quick Start

```bash
git clone https://github.com/okjusthere/emailService.git
cd emailService
npm install
cp .env.example .env
# Edit .env with your Resend API key, company info, etc.
npm run dev
# Open http://localhost:3000/admin
```

## 📦 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | SQLite (better-sqlite3) |
| Email API | Resend |
| Frontend | Vanilla HTML/CSS/JS |
| Deployment | Docker / Railway |

## ⚙️ Environment Variables

```bash
# Required
RESEND_API_KEY=re_xxxxxxxxxxxx          # From resend.com
FROM_EMAIL=you@yourdomain.com           # Verified domain in Resend
FROM_NAME=Your Company                  # Sender display name
REPLY_TO_EMAIL=reply@yourdomain.com     # Reply-to address
COMPANY_NAME=Your Company Inc.          # CAN-SPAM required
COMPANY_ADDRESS=123 Main St, City, ST   # CAN-SPAM required
API_SECRET=your-secret-key              # Admin dashboard password
BASE_URL=https://your-domain.com        # Public URL for unsubscribe links

# Optional
DAILY_SEND_COUNT=5000                   # Emails per day (default: 5000)
BATCH_SIZE=100                          # Emails per API call (default: 100)
SEND_CRON=0 14 * * *                   # Cron schedule (empty = manual only)
SEND_START_DATE=2026-01-01              # IP warmup start date
RESEND_WEBHOOK_SECRET=whsec_xxx         # Webhook signature verification
```

## 🐳 Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub**
3. Add a **Volume** mounted at `/app/data`
4. Set **environment variables** in Railway dashboard
5. Done! Visit `https://your-app.up.railway.app/admin`

## 📊 API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/admin` | GET | — | Admin dashboard |
| `/health` | GET | — | Health check |
| `/unsubscribe?token=xxx` | GET | — | Unsubscribe page |
| `/webhook/resend` | POST | Signature | Resend webhook |
| `/api/admin/*` | ALL | `x-api-secret` | Admin API |

## 📁 Project Structure

```
├── public/              # Admin dashboard frontend
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── config.ts        # Environment variable config
│   ├── index.ts         # Express server entry point
│   ├── db/              # SQLite connection & migrations
│   ├── routes/          # Admin API, webhook, unsubscribe
│   ├── services/        # Email sender, scheduler, subscriber service
│   ├── templates/       # Email HTML template
│   ├── utils/           # Auth, compliance, warmup, logger
│   └── webhooks/        # Resend webhook handler
├── Dockerfile
├── .env.example
└── package.json
```

## 📝 License

MIT
