# Task Manager (Kalpanik)

Full-stack task management for **admins** and **users** (employees). Teams assign work, attach files and voice notes, collect proof, chat, track **live attendance**, run reports, and get reminders on **web** and **Android**.

**Production example:** [https://sugandhshoppee.kalpanik.in](https://sugandhshoppee.kalpanik.in)

**Repo:** [jay-07-pixel/Task_manager](https://github.com/jay-07-pixel/Task_manager)

---

## Table of contents

1. [Overview](#overview)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Local development](#local-development)
5. [Admin access & dual login](#admin-access--dual-login)
6. [Attendance & live location](#attendance--live-location)
7. [Task assignment attachments](#task-assignment-attachments)
8. [Owner dashboard & reports](#owner-dashboard--reports)
9. [Android app (Kalpanik Reminder)](#android-app-kalpanik-reminder)
10. [File uploads & limits](#file-uploads--limits)
11. [Push notifications](#push-notifications)
12. [Internationalization](#internationalization)
13. [Project structure](#project-structure)
14. [API overview](#api-overview)
15. [Production deployment (VPS)](#production-deployment-vps)
16. [Nginx configuration](#nginx-configuration)
17. [Troubleshooting](#troubleshooting)

---

## Overview

| Role | Where they work | What they do |
|------|-----------------|--------------|
| **Admin** | Website (admin dashboard) | Lists, tasks, attachments, assignees, reports, owner dashboard, **Attendance** map, team chat, manage admins |
| **User** | Website (user dashboard) or **Android app** | Share location (required), view assigned tasks + admin attachments, submit proof, progress updates, delegate, chat |
| **Admin + user** | Both views | Same account; switch admin / user from profile menu |

Everyone **registers as a user**. Admins are promoted via **Manage Admin** (`isAdmin` in the database). Promoted admins stay assignable as users.

### Production VPS layout

| Directory on server | PM2 process | Typical domain |
|---------------------|-------------|----------------|
| `~/Task_manager` | `taskmanager` | `sugandhshoppee.kalpanik.in` |
| `~/Task_manager_safari` | `safari` | safari subdomain |
| `~/Task_manager_ss2n` | `ss2n` | `ss2n.kalpanik.in` |
| `~/Task_manager_acs` | `acs` | `acs.kalpanik.in` |
| `~/Task_manager_tacs` | `tacs` | `tacs.kalpanik.in` |

Each instance has its own `server/.env`, MySQL database, and nginx vhost. All deploy from the same GitHub repo.

---

## Features

### Admin dashboard (website)

- **KPI cards** — Active, In Review, Completed, Employee Assigned (click to filter)
- **Task table** — sortable rows, expandable assignee progress, view submissions, mark assignees done
- **High-priority tasks** — red styling, pinned to top of list
- **Lists** — create, rename, reorder, delete, pin; **Employee assignments** list for delegated tasks
- **Tasks** — title, description, due date/time, timezone, all-day, duration (minutes), recurrence (daily / weekly / monthly / yearly / custom)
- **Assignment attachments** — images, videos, PDFs, and **voice notes** when creating/editing a task (assignees can open them)
- **Multi-assignee** — any registered user (including admins in user view)
- **Per-assignee** — Pending / Submitted, progress updates, proof files
- **Attendance** — live map (Google Maps), Live/Off status, area + city, off/on times, history, refresh, click-to-focus map
- **Owner dashboard** — monthly work capacity (month filter + chart), task breakdown by employee, employee performance (late / pending list)
- **Reports** — employee filter, performance chart, late/pending detail list
- **Team chat** — DMs, groups, file attachments, voice-to-text (EN / HI / MR / TA)
- **Push alerts** — browser notification on task submit/complete; location tracking off/on
- **Admin announcements** — in-app bell for feature updates (with actions: Attendance, Owner dashboard, Download APK)
- **Manage admin** — promote / revoke admin (email via Brevo); mobile-friendly team modal
- **Theme** — light / dark
- **Languages** — English, Hindi, Marathi, Tamil (+ dynamic translation of task/chat content)

### User dashboard (website)

- **Location gate** — must share **precise** live location before tasks are available
- Live location tracking while the site is open; Settings toggle to turn tracking off (admin notified; tasks blocked until on again)
- Assigned tasks with filters (active / submitted / all / assigned-by-me)
- View **assignment attachments** (images, video, PDF, voice) from admin
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
| Frontend | Vite 6, Bootstrap 5, Sass, SortableJS, Chart.js, Inter, Material Symbols |
| Maps | Google Maps JavaScript API + Geocoding API (attendance); Leaflet fallback |
| Backend | Node.js, Express, Zod |
| Database | MySQL 8+, Prisma ORM |
| Auth | `express-session` + file store |
| Email OTP | Brevo Transactional API |
| CAPTCHA | Cloudflare Turnstile |
| Browser push | `web-push` + VAPID |
| Android push | Firebase Cloud Messaging (FCM) |
| Chat realtime | Server-Sent Events (SSE) |
| Translation | `POST /api/translate` (MyMemory + Google fallback) |
| Android app | Kotlin/Java — separate repo `SugandhReminder` (`in.kalpanik.sugandhreminder`) |

---

## Local development

### Prerequisites

- Node.js 18+ (20+ recommended)
- MySQL 8+
- npm
- Brevo account (OTP emails)
- Cloudflare Turnstile site (registration CAPTCHA)
- Optional: Google Maps API key (attendance map + place names)
- Optional: VAPID + Firebase (push / reminders)

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

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MySQL connection string |
| `SESSION_SECRET` | Session signing key |
| `COOKIE_SECURE` | `false` on HTTP VPS; `true` on HTTPS |
| `PORT` | API port (default `3000`) |
| `BREVO_*` | Registration OTP emails (dev: OTP logged to console if missing) |
| `TURNSTILE_*` | Registration CAPTCHA |
| `VAPID_*` | Browser Web Push (chat, task submit, location off/on) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Android FCM + scheduled reminders |
| `GOOGLE_MAPS_API_KEY` | Attendance live map + reverse geocode (area, city) |
| `APP_PUBLIC_URL` | Links in emails (e.g. `https://sugandhshoppee.kalpanik.in`) |
| `APP_TIMEZONE` | Default `Asia/Kolkata` (capacity month, reminders) |
| `TRUST_PROXY` | `true` behind nginx |
| `CLIENT_ORIGIN` | Extra CORS origins if UI/API split |
| `COMPANY_TRIAL_START` / `COMPANY_TRIAL_END` | Optional per-site trial banner |

**Turnstile test keys** (always pass): site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

**Google Maps:** enable **Maps JavaScript API** and **Geocoding API**; restrict the key by HTTP referrer to your domains.

### 3. Database

```bash
npm run db:generate --prefix server
npm run db:migrate --prefix server
npm run db:seed --prefix server
```

Production / VPS:

```bash
npm run db:migrate:deploy --prefix server
```

### 4. Run

```bash
npm run dev
```

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Vite dev UI (proxies `/api` → API) |
| http://localhost:3000 | API + built `client/dist` in production mode |

Use **5173** during development for the latest UI. Geolocation requires **HTTPS** in production (localhost is allowed for dev).

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
| `npm run sync-apk` | Copy Android APK → `client/public/downloads/sugandh-reminder.apk` |
| `npm run start` | Build client + start API (`NODE_ENV=production`) |
| `npm run deploy` | Install deps, `db:generate`, build — before VPS restart |

**Server** (`server/`): `dev`, `start`, `db:generate`, `db:migrate`, `db:migrate:deploy`, `db:seed`, `vapid:generate`

**Client** (`client/`): `dev`, `build`, `preview`

---

## Admin access & dual login

| Action | Steps |
|--------|--------|
| Register | Always creates a **user** (`role: employee`, `isAdmin: false`) |
| Grant admin | Settings → **Manage Admin** → **Make admin** |
| Revoke admin | Same modal → **Revoke** (not yourself; not the last admin) |
| First login (admin) | Picker: **Admin dashboard** or **My tasks (user)** — saved in browser |
| Switch anytime | Profile → **Switch to admin view** / **Switch to user view** |

API: `POST /api/auth/switch-role` with `{ "role": "owner" | "employee" }`.

Promoted admins remain assignable as users and can submit tasks from user view or the Android app.

---

## Attendance & live location

### Employee (website)

1. On login, a **location gate** blocks tasks until location is shared.
2. Must choose **Precise** location (approximate is rejected; accuracy must be ≤ 150 m).
3. Live pings while the tab is open (`watchPosition` + ~45s interval).
4. **Settings → Live location tracking** — turn off with confirmation; admin is notified; gate returns until tracking is on again.
5. Tracking **does not continue** when the website tab is fully closed (browser limitation). Continuous background tracking requires the **Android app** (if implemented there).

### Admin (website)

1. Sidebar → **Attendance** (location icon).
2. **Google Maps** live markers (Leaflet fallback if no API key).
3. Employee list: **Live** / **Off**, last update, turned off/on times.
4. Click a card → map pans/zooms to that employee (last known location if off).
5. Detail panel: off-period history (from / until / duration) with **area + city** place names.
6. **Refresh** button + auto-poll (~5s) while the page is open.
7. Chrome / FCM push when an employee turns tracking **off** or **on** (`?openAttendance=1`).

### APIs

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/api/attendance/status` | Employee |
| `POST` | `/api/attendance/consent` | Employee |
| `POST` | `/api/attendance/ping` | Employee `{ latitude, longitude, accuracy? }` |
| `PATCH` | `/api/attendance/tracking` | Employee `{ enabled: boolean }` |
| `GET` | `/api/attendance/live` | Admin |
| `GET` | `/api/attendance/employees/:userId/history` | Admin |
| `GET` | `/api/attendance/geocode?lat=&lng=` | Admin |
| `GET` | `/api/attendance/maps-config` | Admin (returns Maps API key for browser) |

---

## Task assignment attachments

Admins attach files when **creating or editing** a task. Assignees see them on the website (and can sync in the Android app via the same API).

| Kind | Notes |
|------|--------|
| Image | jpeg, png, gif, webp |
| Video | common video types |
| PDF | documents |
| Voice | Record in-browser (start/stop + timer); playable by admin and employee |

- Max **30** attachments per task.
- Storage: `server/uploads/task-assignment-attachments/`.
- Admin voice playback uses authenticated **blob** URLs (same as employees).

### APIs

| Method | Path | Who |
|--------|------|-----|
| Included on | `GET /api/tasks/assigned` → `assignmentAttachments[]` | Employee |
| `GET` | `/api/tasks/:taskId/assignment-attachments/:attachmentId` | Assignee or any admin |
| `POST` | `/api/tasks/:taskId/assignment-attachments` | Admin / task creator (multipart `file`) |
| `DELETE` | `/api/tasks/:taskId/assignment-attachments/:attachmentId` | Admin / task creator |

Each attachment object:

```json
{
  "id": "uuid",
  "kind": "image" | "video" | "pdf" | "voice",
  "mimeType": "audio/webm",
  "originalName": "voice-note.webm",
  "url": "/api/tasks/{taskId}/assignment-attachments/{id}"
}
```

---

## Owner dashboard & reports

### Owner dashboard (Profile → Owner dashboard)

- **Company trial** banner (optional `COMPANY_TRIAL_*` env)
- **Monthly work capacity**
  - Select **month** → KPIs, chart, and tables reload for that month
  - Capacity uses due/start month so one-time and not-yet-started tasks do not inflate other months
  - Budget: 26 working days × 8 hours = **12,480 min** per employee
  - **Task breakdown**: choose an employee (default: none selected) to see only their tasks
- **Employee task performance**
  - Employee + Daily / Weekly / Monthly
  - Chart: on time / late / pending
  - Detail list dropdown: **Late submissions** or **Pending**

### Reports

- Org overview KPIs (Progress updates and Chat 30-day cards removed)
- Employee performance and charts

---

## Android app (Kalpanik Reminder)

Separate project: `AndroidStudioProjects/SugandhReminder`  
Package: `in.kalpanik.sugandhreminder`

### What the app does

- Login with same email/password as website
- View assigned tasks, submit completion proof
- FCM reminders and alarms
- Same REST API as web (`/api/tasks/assigned`, completion-proof, etc.)
- Should parse `assignmentAttachments` on tasks and download files with the session cookie (see app integration notes in chat history / design docs)

### Build APK (Windows)

In Android Studio: **Build → Generate App Bundles or APKs → Generate APKs** (for website download use **APK**, not App Bundle).

Or:

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

`npm run sync-apk` copies from the default Android debug path (override with `APK_SOURCE`).  
Vite copies `client/public/downloads/` into `client/dist/downloads/` on build.

### Users install the app

1. Open your deployed site and sign in as employee  
2. Profile menu → **Download app (APK)**  
3. Or direct link: **/downloads/sugandh-reminder.apk**  
4. Allow “Install unknown apps” if prompted  
5. If install is blocked, uninstall the old app first  

Admins also get a **bell notification** with a **Download APK** action when a new build is published.

### Sideload via USB (dev)

```powershell
adb install -r "C:\Users\jayjo\AndroidStudioProjects\SugandhReminder\app\build\outputs\apk\debug\app-debug.apk"
```

---

## File uploads & limits

| Context | Photos / videos | PDF | Notes |
|---------|-----------------|-----|-------|
| **Task submission** (web + Android) | No app size limit | 5 MB max | Up to 10 media files or one PDF alone |
| **Assignment attachments** | Supported | Supported | Plus voice notes; max 30 per task |
| **Team chat** | 5 MB | 5 MB | Any file type |

Storage:

- Proofs: `server/uploads/completion-proofs/`
- Assignment attachments: `server/uploads/task-assignment-attachments/`
- Chat: `server/uploads/chat/`

**Important:** Large uploads fail with **HTTP 413** if nginx `client_max_body_size` is too small. See [Nginx configuration](#nginx-configuration).

---

## Push notifications

### Admin — task submitted / completed

When an employee submits work, admins with browser push enabled get an alert.

1. Admin → **Settings** → enable notifications (or Messages flow)  
2. Requires `VAPID_*` in `server/.env` (`npm run vapid:generate --prefix server`)

### Admin — location tracking off / on

Push when an employee disables or re-enables live location. Opens Attendance (`/?openAttendance=1`).

### User — due reminders

Server scheduler (~every 60s):

- ~10 minutes before due  
- +1 hour follow-up if not submitted  

Delivery: **FCM** (Android) and/or **Web Push** (browser).

### In-app admin announcements

Bell icon (admin UI) lists feature updates (attendance, attachments, dashboard, APK). Unread badge clears when the panel is opened.

### Test FCM (browser console, logged in)

```javascript
fetch("/api/push/test", { method: "POST", credentials: "include" }).then((r) => r.json()).then(console.log);
```

---

## Internationalization

- UI strings: `client/src/locales/en.json`, `hi.json`, `mr.json`, `ta.json`
- Language selector in header
- Dynamic content (task titles, descriptions, chat): `POST /api/translate` with `{ texts, to: "en"|"hi"|"mr"|"ta" }`
- Chat voice-to-text: EN / HI / MR (and related locales) via Web Speech API

---

## Project structure

```
Task Manager/
├── client/
│   ├── src/
│   │   ├── main.js                 # Admin + user UI, tasks, attachments, modals
│   │   ├── attendance.js           # Employee location gate + tracking
│   │   ├── adminAttendance.js      # Admin live map + history
│   │   ├── adminReports.js         # Reports + owner dashboard
│   │   ├── adminAnnouncements.js   # Admin bell notifications
│   │   ├── adminSettings.js        # Settings (incl. location toggle)
│   │   ├── chat.js                 # Team chat (DM + groups)
│   │   ├── reminders.js
│   │   ├── sw-register.js          # Web Push subscribe
│   │   ├── i18n/                   # Locales + content translation
│   │   └── scss/
│   ├── public/
│   │   ├── downloads/sugandh-reminder.apk
│   │   ├── sw.js                   # Service worker (push)
│   │   └── icons/
│   └── dist/                       # Build output (not in git)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── routes/                 # auth, lists, tasks, users, push, chat,
│   │   │                           # reports, attendance, translate, support, company
│   │   ├── services/               # attendance, geocode, FCM, notifications
│   │   ├── middleware/
│   │   └── lib/                    # mail, otp, turnstile, push, monthly minutes, …
│   ├── uploads/
│   └── sessions/
├── scripts/sync-apk.mjs
├── deploy/
│   ├── nginx-upload-limit.conf.example
│   ├── patch-nginx-all-sites.sh
│   ├── fix-nginx-proxy-all-taskmgr.sh
│   ├── diagnose-site-bundles.sh
│   └── sync-static-to-var-www.sh
├── DESIGN.md
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
| **Tasks** | `GET /tasks/lists/:listId`, `GET /tasks/assigned`, create/patch, progress, `POST /tasks/:id/completion-proof` |
| **Assignment attachments** | `GET/POST/DELETE /tasks/:id/assignment-attachments[...]` |
| **Attendance** | `/attendance/status`, `/consent`, `/ping`, `/tracking`, `/live`, `/employees/:id/history`, `/geocode`, `/maps-config` |
| **Users** | `GET /assignees`, `GET /team`, `PATCH /users/:id/role`, profile |
| **Reports** | `/reports/summary`, `/reports/employee-performance`, `/reports/owner-dashboard/summary?year=&month=` |
| **Company** | `GET /company/trial` |
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

### Deploy all five instances (one command)

```bash
for dir in Task_manager Task_manager_safari Task_manager_ss2n Task_manager_acs Task_manager_tacs; do
  cd ~/$dir && git pull origin main
  npm install --prefix server
  npm run db:migrate:deploy --prefix server
  npm install --prefix client && npm run build --prefix client
done
pm2 restart taskmanager safari ss2n acs tacs
```

With Google Maps key on every site:

```bash
KEY='YOUR_GOOGLE_MAPS_API_KEY'
for dir in Task_manager Task_manager_safari Task_manager_ss2n Task_manager_acs Task_manager_tacs; do
  ENV=~/$dir/server/.env
  if grep -q '^GOOGLE_MAPS_API_KEY=' "$ENV" 2>/dev/null; then
    sed -i "s|^GOOGLE_MAPS_API_KEY=.*|GOOGLE_MAPS_API_KEY=\"$KEY\"|" "$ENV"
  else
    printf '\nGOOGLE_MAPS_API_KEY="%s"\n' "$KEY" >> "$ENV"
  fi
  cd ~/$dir && git pull origin main
  npm install --prefix server
  npm run db:migrate:deploy --prefix server
  npm install --prefix client && npm run build --prefix client
done
pm2 restart taskmanager safari ss2n acs tacs
```

`client/dist` is **not** in git — always run `npm run build` after `git pull`.

### After pushing a new APK

Same deploy loop; APK is in `client/public/downloads/` and copied to `client/dist/downloads/` during build.

### Stale UI on ss2n / acs / tacs

Some sites serve static files from `/var/www/` while the API is on Node. After deploy, if the UI is old:

```bash
sudo bash ~/Task_manager/deploy/fix-nginx-proxy-all-taskmgr.sh
# or
bash ~/Task_manager/deploy/diagnose-site-bundles.sh
```

### `server/.env` checklist (production)

```env
DATABASE_URL="mysql://USER:PASS@localhost:3306/taskmanager"
SESSION_SECRET="long-random-string"
COOKIE_SECURE=false
TRUST_PROXY=true
APP_PUBLIC_URL="https://sugandhshoppee.kalpanik.in"
APP_TIMEZONE="Asia/Kolkata"

BREVO_API_KEY="xkeysib-..."
BREVO_SENDER_NAME="Task Manager"
BREVO_SENDER_EMAIL="noreply@yourdomain.com"

TURNSTILE_SITE_KEY="..."
TURNSTILE_SECRET_KEY="..."

VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:admin@yourdomain.com"

FIREBASE_SERVICE_ACCOUNT_PATH="firebase-service-account.json"

GOOGLE_MAPS_API_KEY="AIza..."
```

- `COOKIE_SECURE=false` on **HTTP** only; use `true` on HTTPS.
- Turnstile: add every hostname in Cloudflare.
- Brevo sender email must be verified.

---

## Nginx configuration

Nginx sits in front of Node/PM2. Default limit is **1 MB** — large task uploads return **413 Request Entity Too Large**.

### Required: unlimited body size for task uploads

In each **active** site config (not `.bak` files), inside `server { }`:

```nginx
client_max_body_size 0;
```

`0` = unlimited in nginx.

### Sites to check

| Config file | Domain | Notes |
|-------------|--------|-------|
| `/etc/nginx/sites-enabled/sugandhshoppe` | `sugandhshoppee.kalpanik.in` | Main production |
| `/etc/nginx/sites-enabled/safari` | safari subdomain | |
| `/etc/nginx/sites-enabled/ss2n` | `ss2n.kalpanik.in` | May use `/var/www` static root |
| `/etc/nginx/sites-enabled/acs` | `acs.kalpanik.in` | May use `/var/www` static root |
| `/etc/nginx/sites-enabled/tacs` | `tacs.kalpanik.in` | May use `/var/www` static root |

### Fix sugandhshoppee (one-liner)

```bash
sudo sed -i 's/client_max_body_size 6m/client_max_body_size 0/g' /etc/nginx/sites-enabled/sugandhshoppe
sudo sed -i 's/client_max_body_size 11m/client_max_body_size 0/g' /etc/nginx/sites-available/sugandhshoppe
sudo nginx -t && sudo systemctl reload nginx
```

### Patch script (SSE + upload limit)

```bash
cd ~/Task_manager && git pull origin main
sudo bash deploy/patch-nginx-all-sites.sh
```

Installs `/etc/nginx/snippets/taskmgr-api-proxy.conf` for SSE and video Range headers. Do not keep `*.bak*` files in `sites-enabled/`.

See also: `deploy/nginx-upload-limit.conf.example`, `deploy/fix-nginx-proxy-all-taskmgr.sh`.

---

## Troubleshooting

| Issue | Cause / fix |
|-------|-------------|
| `401` on `/api/auth/me` before login | Normal — not signed in |
| `401` on login | Wrong password or user not seeded on this server |
| `403` on register | Complete OTP verify before Create account |
| `413` on task submit | Nginx `client_max_body_size` too small — set `0` |
| Old UI after deploy | `npm run build`; hard-refresh `Ctrl+Shift+R`; run nginx fix for ss2n/acs/tacs |
| Session lost on HTTP | `COOKIE_SECURE=false` in `.env` |
| `500` / health `db:error` | MySQL down, wrong `DATABASE_URL`, or run `db:migrate:deploy` |
| No OTP email | Brevo keys / verified sender; dev: read API console |
| Turnstile fails | Add site hostname in Cloudflare Turnstile |
| Admin push not received | Enable notifications; set VAPID keys |
| Location gate / no GPS | HTTPS required (except localhost); choose **Precise** not Approximate |
| Attendance map blank | Set `GOOGLE_MAPS_API_KEY`; enable Maps JS + Geocoding APIs |
| Month capacity same for all months | Deploy latest server (`employeeMonthlyMinutes`); one-time tasks only count in due month |
| Admin voice note silent | Deploy latest client; playback uses authenticated blob URLs |
| Assignment attachment 403 | User must be assignee or admin (`isAdmin` / owner session) |
| APK download 404 | `npm run sync-apk` + `npm run build`; redeploy VPS |
| nginx “conflicting server name” | Remove `*.bak*` from `sites-enabled/` |
| Prisma EPERM (Windows) | Stop dev server; rerun `db:generate` |

### Confirm nginx is not blocking (should return 401, not 413)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://sugandhshoppee.kalpanik.in/api/tasks/test/completion-proof
```

---

## Related docs

- [DESIGN.md](./DESIGN.md) — architecture, topology, data flows
- [deploy/](./deploy/) — nginx helpers, diagnostics, static sync

---

## License

Private / educational use unless a license file is added.
