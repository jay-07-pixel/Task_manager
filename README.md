# Task Manager (Kalpanik)

Full-stack task management for **admins** and **users** (employees). Built for teams that assign work, collect proof (photos, videos, notes), chat, and get reminders on web and Android.

**Production example:** [https://sugandhshoppee.kalpanik.in](https://sugandhshoppee.kalpanik.in)

---

## Table of contents

1. [Overview](#overview)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Local development](#local-development)
5. [Admin access & dual login](#admin-access--dual-login)
6. [Android app (Kalpanik Reminder)](#android-app-kalpanik-reminder)
7. [File uploads & limits](#file-uploads--limits)
8. [Push notifications](#push-notifications)
9. [Internationalization](#internationalization)
10. [Project structure](#project-structure)
11. [API overview](#api-overview)
12. [Production deployment (VPS)](#production-deployment-vps)
13. [Nginx configuration](#nginx-configuration)
14. [Troubleshooting](#troubleshooting)

---

## Overview

| Role | Where they work | What they do |
|------|-----------------|--------------|
| **Admin** | Website (admin dashboard) | Lists, tasks, assignees, reports, owner dashboard, team chat, grant/revoke admin |
| **User** | Website (user dashboard) or **Android app** | View assigned tasks, submit proof, progress updates, delegate tasks, chat |
| **Admin + user** | Both views | Same account; switch between admin and user from profile menu |

Everyone **registers as a user**. Admins are promoted via **Manage Admin** (`isAdmin` flag in the database). Promoted admins keep their user account and can still be assigned tasks.

### Production VPS layout (example)

| Directory on server | PM2 process | Typical domain |
|---------------------|-------------|----------------|
| `~/Task_manager` | `taskmanager` | `sugandhshoppee.kalpanik.in` |
| `~/Task_manager_safari` | `safari` | safari subdomain |
| `~/Task_manager_ss2n` | `ss2n` | `ss2n.kalpanik.in` |

Each instance has its own `server/.env`, MySQL database, and nginx vhost. Code is deployed from the same GitHub repo: [jay-07-pixel/Task_manager](https://github.com/jay-07-pixel/Task_manager).

---

## Features

### Admin dashboard (website)

- **KPI cards** — Active, In Review, Completed, Employee Assigned (click to filter)
- **Task table** — sortable rows, expandable assignee progress, view submissions, mark assignees done
- **High-priority tasks** — red styling, pinned to top of list
- **Lists** — create, rename, reorder, delete, pin; **Employee assignments** list for delegated tasks
- **Tasks** — title, description, due date/time, timezone, all-day, recurrence (daily / weekly / monthly / yearly / custom)
- **Multi-assignee** — any registered user (including admins with user view)
- **Per-assignee** — Pending / Submitted, progress updates (started / in progress / blocked / update), proof files
- **Owner dashboard** — org-wide employee performance + per-admin task allocation (Profile → Owner dashboard)
- **Reports** — employee filter, performance chart, late submissions table
- **Team chat** — DMs, groups, file attachments, voice-to-text (EN / HI / MR)
- **Push alerts** — browser notification when an employee submits or completes a task
- **Admin announcements** — in-app bell for feature updates
- **Manage admin** — promote / revoke admin (email sent via Brevo)
- **Theme** — light / dark
- **Languages** — English, Hindi, Marathi (+ dynamic translation of task/chat content)

### User dashboard (website)

- Assigned tasks with filters (active / submitted / all / assigned-by-me)
- Submit notes + proof (images, videos, PDF)
- Progress updates and delegate tasks to colleagues
- **Overdue** badge — “Overdue by X days”
- Team chat + voice-to-text
- Download **Kalpanik Reminder** APK from profile menu
- **Switch to admin view** if account has admin access

### Auth & registration

1. Display name, email, phone (10 digits), password
2. Cloudflare **Turnstile** CAPTCHA
3. **Send OTP** → verify 6-digit email code (Brevo)
4. **Create account** → user role (`isAdmin: false`)
5. First-ever bootstrap: only when no admin exists, first registrant can become admin

Session cookie auth. Active UI mode: `owner` (admin) or `employee` (user) via `POST /api/auth/switch-role`.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Vite 6, Bootstrap 5, Sass, SortableJS, Inter, Material Symbols |
| Backend | Node.js, Express, Zod |
| Database | MySQL 8+, Prisma ORM |
| Auth | `express-session` + file store |
| Email OTP | Brevo Transactional API |
| CAPTCHA | Cloudflare Turnstile |
| Browser push | `web-push` + VAPID |
| Android push | Firebase Cloud Messaging (FCM) |
| Chat realtime | Server-Sent Events (SSE) |
| Translation | `POST /api/translate` (MyMemory + Google fallback) |
| Android app | Kotlin/Java — separate repo `SugandhReminder` |

---

## Local development

### Prerequisites

- Node.js 18+ (20+ recommended)
- MySQL 8+
- npm
- Brevo account (OTP emails)
- Cloudflare Turnstile site (registration CAPTCHA)

### 1. Clone and install

```bash
git clone https://github.com/jay-07-pixel/Task_manager.git
cd "Task Manager"
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Environment

```bash
cp server/.env.example server/.env
```

Minimum `server/.env`:

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/taskmanager"
SESSION_SECRET="change-this-to-a-long-random-string"
```

Recommended for registration:

```env
BREVO_API_KEY="xkeysib-..."
BREVO_SENDER_NAME="Task Manager"
BREVO_SENDER_EMAIL="verified-sender@yourdomain.com"
TURNSTILE_SITE_KEY="your-site-key"
TURNSTILE_SECRET_KEY="your-secret-key"
```

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MySQL connection string |
| `SESSION_SECRET` | Session signing key |
| `COOKIE_SECURE` | `false` on HTTP VPS; `true` on HTTPS |
| `PORT` | API port (default `3000`) |
| `BREVO_*` | Registration OTP emails (dev: OTP logged to console if missing) |
| `TURNSTILE_*` | Registration CAPTCHA |
| `VAPID_*` | Browser Web Push (chat + admin task alerts) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Android FCM + scheduled reminders |
| `APP_PUBLIC_URL` | Link in admin promotion emails (e.g. `https://sugandhshoppee.kalpanik.in`) |
| `TRUST_PROXY` | `true` behind nginx |
| `CLIENT_ORIGIN` | Extra CORS origins if UI/API split |

**Turnstile test keys** (always pass): site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

### 3. Database

```bash
npm run db:generate --prefix server
npm run db:migrate --prefix server
npm run db:seed --prefix server
```

### 4. Run

```bash
npm run dev
```

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Vite dev UI (proxies `/api` → API) |
| http://localhost:3000 | API + built `client/dist` in production mode |

Use **5173** during development for the latest UI.

### Demo accounts (after seed)

| Account | Email | Password | Notes |
|---------|-------|----------|-------|
| Admin | `owner@local.test` | `password123` | `isAdmin: true` |
| User | `employee1@local.test` | `password123` | Sample daily task assigned |
| User | `employee2@local.test` | `password123` | |

### npm scripts

**Root**

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Vite together |
| `npm run build` | Production client → `client/dist` |
| `npm run sync-apk` | Copy Android APK → `client/public/downloads/` |
| `npm run start` | Build client + start API (`NODE_ENV=production`) |
| `npm run deploy` | Install deps, `db:generate`, build — before VPS restart |

**Server** (`server/`): `dev`, `start`, `db:generate`, `db:migrate`, `db:migrate:deploy`, `db:seed`, `vapid:generate`

**Client** (`client/`): `dev`, `build`, `preview`

---

## Admin access & dual login

| Action | Steps |
|--------|--------|
| Register | Always creates a **user** (`role: employee`, `isAdmin: false`) |
| Grant admin | Profile → **Manage Admin** → **Make admin** |
| Revoke admin | Same modal → **Revoke** (not yourself; not the last admin) |
| First login (admin) | Picker: **Admin dashboard** or **My tasks (user)** — saved in browser |
| Switch anytime | Profile → **Switch to admin view** / **Switch to user view** |

API: `POST /api/auth/switch-role` with `{ "role": "owner" | "employee" }`.

Promoted admins remain assignable as users and can submit tasks from user view or the Android app.

---

## Android app (Kalpanik Reminder)

Separate project: `AndroidStudioProjects/SugandhReminder`  
Package: `in.kalpanik.sugandhreminder`

### What the app does

- Login with same email/password as website
- View assigned tasks, submit completion proof (large photos/videos supported when nginx allows)
- FCM reminders and alarms
- Uses same API as web (`/api/tasks/assigned`, `/api/tasks/:id/completion-proof`, etc.)

### Build APK (Windows)

```powershell
cd C:\Users\jayjo\AndroidStudioProjects\SugandhReminder
.\gradlew.bat assembleDebug
```

Output: `app\build\outputs\apk\debug\app-debug.apk`

### Publish APK to website

```powershell
cd "C:\Users\jayjo\OneDrive\Desktop\Task Manager"
npm run sync-apk
npm run build --prefix client
git add client/public/downloads/sugandh-reminder.apk
git commit -m "Update Kalpanik Reminder APK for employee download."
git push origin main
```

`npm run sync-apk` copies from the default Android build path (override with `APK_SOURCE` env var).  
Vite copies `client/public/downloads/` into `client/dist/downloads/` on build.

### Users install the app

1. Open **https://sugandhshoppee.kalpanik.in** (or your deployed URL)
2. Sign in → profile menu → **Download app (APK)**
3. Or direct link: **/downloads/sugandh-reminder.apk**
4. Allow “Install unknown apps” on Android if prompted

### Sideload via USB (dev)

```powershell
adb install -r "C:\Users\jayjo\AndroidStudioProjects\SugandhReminder\app\build\outputs\apk\debug\app-debug.apk"
```

---

## File uploads & limits

| Context | Photos / videos | PDF | Notes |
|---------|-----------------|-----|-------|
| **Task submission** (web + Android) | **No app size limit** | 5 MB max | Up to 10 files per submit (images/videos) or one PDF alone |
| **Team chat** | 5 MB | 5 MB | Any file type |

Server stores proofs in `server/uploads/completion-proofs/`, chat files in `server/uploads/chat/`.

**Important:** Large uploads can still fail with **HTTP 413** if **nginx** `client_max_body_size` is too small. See [Nginx configuration](#nginx-configuration).

---

## Push notifications

### Admin — task submitted / completed

When an employee submits work, all admins with browser push enabled get an alert.

1. Admin → **Messages** → **Enable message notifications**
2. Requires `VAPID_*` in `server/.env` (`npm run vapid:generate --prefix server`)

### User — due reminders

Server scheduler (~every 60s):

- ~10 minutes before due
- +1 hour follow-up if not submitted

Delivery: **FCM** (Android) and/or **Web Push** (browser). Requires Firebase service account in `.env`.

### Test FCM (browser console, logged in)

```javascript
fetch("/api/push/test", { method: "POST", credentials: "include" }).then((r) => r.json()).then(console.log);
```

---

## Internationalization

- UI strings: `client/src/locales/en.json`, `hi.json`, `mr.json`
- Language selector in header
- Dynamic content (task titles, descriptions, chat): `POST /api/translate` with `{ texts, to: "en"|"hi"|"mr" }`
- Chat voice-to-text: EN / HI / MR via Web Speech API

---

## Project structure

```
Task Manager/
├── client/
│   ├── src/
│   │   ├── main.js              # Admin + user UI, dashboards, modals
│   │   ├── adminReports.js      # Reports + owner dashboard
│   │   ├── adminAnnouncements.js
│   │   ├── chat.js              # Team chat (DM + groups)
│   │   ├── chatSpeechToText.js
│   │   ├── reminders.js
│   │   ├── sw-register.js       # Web Push subscribe
│   │   ├── i18n/                # Locales + content translation
│   │   └── scss/
│   ├── public/
│   │   ├── downloads/sugandh-reminder.apk
│   │   ├── sw.js                # Service worker (push)
│   │   └── icons/
│   └── dist/                    # Build output (not in git)
├── server/
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── routes/              # auth, lists, tasks, users, push, chat, reports, translate, support
│   │   ├── services/            # FCM, chat notify, task-completion notify
│   │   ├── middleware/
│   │   └── lib/                 # mail, otp, turnstile, push, adminUsers, recurrence, …
│   ├── uploads/
│   └── sessions/
├── scripts/sync-apk.mjs
├── deploy/
│   ├── nginx-upload-limit.conf.example
│   └── patch-nginx-all-sites.sh
└── package.json
```

---

## API overview

Base path: `/api`. Authenticated routes use session cookie (`credentials: "include"`).

| Area | Key endpoints |
|------|----------------|
| **Auth** | `POST /login`, `/register`, `/logout`, `GET /me`, `POST /switch-role` |
| **OTP** | `GET /turnstile-site-key`, `POST /send-otp`, `/verify-otp`, forgot-password |
| **Lists** | `GET/POST /lists`, `PATCH /lists/:id`, reorder |
| **Tasks** | `GET /tasks/lists/:listId`, `POST` create, `PATCH /tasks/:id`, progress updates, `POST /tasks/:id/completion-proof`, reorder |
| **Users** | `GET /assignees`, `GET /team`, `PATCH /users/:id/role` |
| **Reports** | `GET /reports/...` (summary, employee performance, owner dashboard) |
| **Translate** | `POST /translate` |
| **Push** | VAPID key, subscribe, `POST /push/devices/register`, test |
| **Chat** | contacts, threads, messages, groups, SSE `/chat/live`, attachments |
| **Support** | `POST /support/contact` |
| **Health** | `GET /health` |

---

## Production deployment (VPS)

### Health check

```bash
curl -s http://localhost:3000/api/health
# Expect: "db":"connected"
```

### Deploy all instances

```bash
for dir in Task_manager Task_manager_safari Task_manager_ss2n; do
  cd ~/$dir && git pull origin main
  npm install --prefix server
  npm run db:migrate:deploy --prefix server
  npm install --prefix client && npm run build --prefix client
done
pm2 restart taskmanager && pm2 restart safari && pm2 restart ss2n
```

`client/dist` is **not** in git — always run `npm run build` after `git pull`.

### After pushing a new APK

Same deploy loop above; the APK lives in `client/public/downloads/` and is copied to `client/dist/downloads/` during build.

### `server/.env` checklist (production)

```env
DATABASE_URL="mysql://USER:PASS@localhost:3306/taskmanager"
SESSION_SECRET="long-random-string"
COOKIE_SECURE=false
TRUST_PROXY=true
APP_PUBLIC_URL="https://sugandhshoppee.kalpanik.in"

BREVO_API_KEY="xkeysib-..."
BREVO_SENDER_NAME="Task Manager"
BREVO_SENDER_EMAIL="noreply@yourdomain.com"

TURNSTILE_SITE_KEY="..."
TURNSTILE_SECRET_KEY="..."

VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:admin@yourdomain.com"

FIREBASE_SERVICE_ACCOUNT_PATH="firebase-service-account.json"
```

- `COOKIE_SECURE=false` on **HTTP** only; use `true` on HTTPS.
- Turnstile: add every hostname (e.g. `sugandhshoppee.kalpanik.in`) in Cloudflare dashboard.
- Brevo sender email must be verified.

---

## Nginx configuration

Nginx sits in front of Node/PM2. Default limit is **1 MB** — large task uploads will return **413 Request Entity Too Large**.

### Required: unlimited body size for task uploads

In each **active** site config (not `.bak` files), inside `server { }`:

```nginx
client_max_body_size 0;
```

`0` = unlimited in nginx.

### Sites to check on this server

| Config file | Domain | Notes |
|-------------|--------|-------|
| `/etc/nginx/sites-enabled/sugandhshoppe` | `sugandhshoppee.kalpanik.in` | **Main production** — often still `6m` if not fixed |
| `/etc/nginx/sites-enabled/safari` | safari subdomain | Check limit |
| `/etc/nginx/sites-enabled/kalpanik` | `kalpanik.in` | May proxy different port |
| `/etc/nginx/sites-enabled/ss2n` | `ss2n.kalpanik.in` | Preview / staging |

### Fix sugandhshoppee (one-liner)

```bash
sudo sed -i 's/client_max_body_size 6m/client_max_body_size 0/g' /etc/nginx/sites-enabled/sugandhshoppe
sudo sed -i 's/client_max_body_size 11m/client_max_body_size 0/g' /etc/nginx/sites-available/sugandhshoppe
sudo nginx -t && sudo systemctl reload nginx
```

Verify:

```bash
sudo grep client_max_body_size /etc/nginx/sites-enabled/sugandhshoppe
```

### Patch script (SSE + upload limit for sites with `location /api/`)

```bash
cd ~/Task_manager && git pull origin main
sudo bash deploy/patch-nginx-all-sites.sh
```

**Note:** This script only auto-patches vhosts that contain `location /api/`. **`sugandhshoppee` may need the manual `sed` above.** Do not keep `*.bak*` files in `sites-enabled/` — move them to `/etc/nginx/backup-configs/`.

### Chat SSE + video byte ranges

The patch script installs `/etc/nginx/snippets/taskmgr-api-proxy.conf` inside `location /api/` blocks (disables buffering for SSE, passes Range headers for video playback).

### Upload size reference

See `deploy/nginx-upload-limit.conf.example`.

---

## Troubleshooting

| Issue | Cause / fix |
|-------|-------------|
| `401` on `/api/auth/me` before login | Normal — not signed in |
| `401` on login | Wrong password or user not seeded on this server |
| `403` on register | Complete OTP verify before Create account |
| `413` on task submit (Android/web) | Nginx `client_max_body_size` too small — set `0` on **sugandhshoppe** vhost |
| `413` only on large files (~20 MB+) | Same — production was `6m`, file was ~21 MB |
| Old UI after deploy | `npm run build`; hard-refresh `Ctrl+Shift+R` |
| Session lost on HTTP | `COOKIE_SECURE=false` in `.env` |
| `500` / health `db:error` | MySQL down, wrong `DATABASE_URL`, or run migrate |
| No OTP email | Brevo keys / verified sender; dev: read API console |
| Turnstile fails | Add site hostname in Cloudflare Turnstile |
| Admin push not received | Messages → Enable notifications; set VAPID keys |
| nginx “conflicting server name” | Remove `*.bak*` from `sites-enabled/` |
| Prisma EPERM (Windows) | Stop dev server; rerun `db:generate` |
| Chat upload 413 | Chat limit 5 MB in app; nginx must allow at least that |
| APK download 404 | Run `npm run sync-apk` + `npm run build`; redeploy VPS |

### Confirm nginx is not blocking (should return 401, not 413)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://sugandhshoppee.kalpanik.in/api/tasks/test/completion-proof
```

---

## License

Private / educational use unless a license file is added.
