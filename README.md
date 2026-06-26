# Task Manager (Kalpanik)

A full-stack task management app for **admins** and **users** (employees). Everyone registers on the website as a user. Admins can grant or revoke **admin access**; users with admin access can sign in as **admin** or as **user** and switch anytime from the profile menu.

Admins manage lists, tasks, assignees, progress, reports, and team chat on the web. Users work assigned tasks on the **website** or in the **Kalpanik Reminder** Android app (FCM reminders, alarms).

## Features

### Admin (website)

- **Admin dashboard** — KPI cards (Active, In Review, Completed, Employee Assigned), task table with filters, expandable rows (description, assignee progress, submissions)
- **Owner dashboard** — org-wide employee performance and **per-admin task allocation** (Profile → Owner dashboard)
- **Reports** — employee filter, stacked performance chart, late submissions table
- **High-priority tasks** — red styling, pinned to top
- **Push notifications** — browser push when an employee submits or completes a task (enable via Messages → Enable message notifications)
- Multiple task lists (create, rename, reorder, delete, pin)
- **Employee assignments** pinned list — tasks created or delegated between users
- Tasks with title, description, due date/time, timezone, all-day, recurrence (including custom rules)
- Assign one or more users per task (all registered users, including admins)
- Per-assignee status: **Pending** / **Submitted**, progress updates, proof images/video (any size) or PDF (5 MB)
- Mark assignees done; drag-and-drop task ordering
- **Team chat** — direct messages and groups, attachments, **voice-to-text** in compose (EN / HI / MR)
- **Admin announcements** — in-app notification bell
- **Manage admin** — grant or revoke admin access (email notification on change)
- **Dual login** — admins can switch to **user view** for their own assigned tasks
- **i18n** — English, Hindi, Marathi UI; dynamic translation of task titles, descriptions, and chat
- Light / dark theme

### User / employee (website)

- **Register** on the website (OTP + CAPTCHA)
- **User dashboard** — assigned tasks, submit work (notes + proof), progress updates, delegate to colleagues, create & assign tasks
- **Overdue** label — “Overdue by X days” on late tasks
- **Team chat** with voice-to-text
- **Switch to admin view** when the account has admin access
- APK download link in profile for the Android app

### Android app (Kalpanik Reminder)

- Assigned tasks, completion, proof upload, FCM reminders/alarms (same backend APIs)
- APK: `client/public/downloads/sugandh-reminder.apk` (copied to `client/dist` on build via `npm run sync-apk`)

### Auth & registration

- Email + password sign-in
- **Registration:** CAPTCHA → **Send OTP** → verify → **Create account** (always creates a **user** account)
- **Cloudflare Turnstile** verified server-side before OTP (rate-limited)
- **Email OTP** via **Brevo** (6-digit, 10-minute expiry)
- Phone: **10 digits** on register
- First bootstrap admin: only if no admin exists yet (`isAdmin` flag)
- Session-based API auth (cookie); active view stored as `owner` (admin) or `employee` (user) in session

## Tech stack

| Layer    | Stack |
|----------|--------|
| Frontend | Vite 6, Bootstrap 5, Sass, SortableJS, Inter, Material Symbols Outlined |
| Backend  | Node.js, Express, Zod |
| Database | MySQL, Prisma ORM |
| Auth     | `express-session` + file store |
| Email    | Brevo Transactional API |
| CAPTCHA  | Cloudflare Turnstile |
| Push     | Firebase Cloud Messaging (Android) + `web-push` / VAPID (browser) |
| Realtime | Server-Sent Events for team chat |
| i18n     | Client locales + `POST /api/translate` (MyMemory + Google fallback) |

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **MySQL** 8+
- npm
- [Brevo](https://www.brevo.com) (registration OTP)
- [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) (registration CAPTCHA)

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/jay-07-pixel/Task_manager.git
cd "Task Manager"
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Database and environment

Create a MySQL database (example: `taskmanager`).

```bash
cp server/.env.example server/.env
```

Edit `server/.env` — minimum:

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/taskmanager"
SESSION_SECRET="change-this-to-a-long-random-string"
```

**Registration (recommended):**

```env
BREVO_API_KEY="xkeysib-..."
BREVO_SENDER_NAME="Task Manager"
BREVO_SENDER_EMAIL="verified-sender@yourdomain.com"

TURNSTILE_SITE_KEY="your-site-key"
TURNSTILE_SECRET_KEY="your-secret-key"
```

| Variable | Purpose |
|----------|---------|
| `BREVO_*` | OTP emails. Without Brevo in dev, OTP prints in the API console. |
| `TURNSTILE_*` | CAPTCHA before Send OTP. Add hostname in Turnstile dashboard. |
| `COOKIE_SECURE` | `false` for HTTP VPS; `true` for HTTPS. |
| `PORT` | API port (default **3000**). |
| `VAPID_*` | Browser Web Push (chat + admin task-completion alerts). |
| `FIREBASE_SERVICE_ACCOUNT_*` | Android FCM. |

**Local Turnstile test keys** (always pass): site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

### 3. Migrate and seed

```bash
npm run db:generate --prefix server
npm run db:migrate --prefix server
npm run db:seed --prefix server
```

### 4. Run in development

```bash
npm run dev
```

- **Web UI:** http://localhost:5173 (Vite proxies `/api` to the API)
- **API:** http://localhost:3000

Use **localhost:5173** during development. Port **3000** serves built `client/dist` only after `npm run build`.

### Demo accounts (after seed)

| Account | Email                  | Password      | Notes |
|---------|------------------------|---------------|-------|
| Admin   | `owner@local.test`     | `password123` | `isAdmin`; opens admin dashboard by default |
| User    | `employee1@local.test` | `password123` | Assigned sample daily task |
| User    | `employee2@local.test` | `password123` | |

## Admin access & dual login

| Action | How |
|--------|-----|
| Register | Everyone becomes a **user** (`role: employee`, `isAdmin: false`) |
| Grant admin | Admin → Profile → **Manage Admin** → **Make admin** |
| Revoke admin | Same modal → **Revoke** (cannot revoke the last admin or yourself) |
| Sign in with both roles | On first login, pick **Admin dashboard** or **My tasks (user)**; choice is remembered |
| Switch later | Profile menu → **Switch to user view** / **Switch to admin view** |

Promoted admins **keep** their user account — they can still be assigned tasks and submit work in user view.

## npm scripts

### Root

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Vite dev servers |
| `npm run build` | Production client build → `client/dist` |
| `npm run sync-apk` | Copy Android APK → `client/dist/downloads/` |
| `npm run start` | Rebuild client, start API (`NODE_ENV=production`) |
| `npm run deploy` | `npm install` (server), `db:generate`, `build` — before VPS restart |

### Server (`server/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | API with file watch |
| `npm run start` | API (production) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Apply migrations (local) |
| `npm run db:migrate:deploy` | Apply migrations on production VPS |
| `npm run db:push` | Push schema to DB |
| `npm run db:seed` | Seed demo users and sample data |
| `npm run vapid:generate` | Generate VAPID keys for browser push |

### Client (`client/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Build static assets |
| `npm run preview` | Preview production build |

## Project structure

```
Task Manager/
├── client/
│   ├── src/
│   │   ├── main.js                 # Admin/user UI, dashboards, modals
│   │   ├── adminReports.js         # Reports + owner dashboard
│   │   ├── adminAnnouncements.js   # In-app admin bell
│   │   ├── chat.js                 # Team chat (DM + groups)
│   │   ├── chatSpeechToText.js     # Voice-to-text in chat
│   │   ├── reminders.js            # In-tab employee reminders
│   │   ├── sw-register.js          # Web Push subscribe
│   │   ├── i18n/                   # Locales + content translation
│   │   └── scss/
│   │       ├── styles.scss
│   │       ├── _admin-mockup.scss
│   │       └── _admin-reports.scss
│   ├── public/
│   │   ├── icons/
│   │   ├── downloads/              # sugandh-reminder.apk
│   │   ├── sw.js                   # Service worker (push)
│   │   └── alarm.html
│   └── dist/                       # Built assets (not in git)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.js
│   │   └── migrations/
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/                 # auth, lists, tasks, users, push, chat, reports, translate, support
│   │   ├── services/               # FCM, chat notify, task-completion notify
│   │   └── lib/                    # mail, otp, turnstile, push, adminUsers, contentTranslate
│   ├── uploads/
│   └── sessions/
├── scripts/
│   └── sync-apk.mjs
├── deploy/
│   └── nginx-upload-limit.conf.example
└── package.json
```

## API overview

All JSON routes are under `/api`. Authenticated routes use the session cookie (`credentials: include`).

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `register`, `logout`, `GET /me`, `POST /switch-role` |
| Auth OTP | `GET /turnstile-site-key`, `POST /send-otp`, `POST /verify-otp`, forgot-password |
| Lists | `GET/POST /api/lists`, `PATCH /api/lists/:id`, reorder |
| Tasks | Lists CRUD, `PATCH /api/tasks/:id`, progress updates, completion proof, reorder |
| Users | `GET /assignees`, `GET /team`, `PATCH /:id/role` (grant/revoke admin) |
| Reports | `GET /api/reports/...` (summary, employee performance, owner dashboard) |
| Translate | `POST /api/translate` — `{ texts, to: "en"\|"hi"\|"mr" }` |
| Push | VAPID key, subscribe, device register, test |
| Chat | Threads, messages, groups, SSE stream, attachments |
| Support | `POST /api/support/contact` |

`GET /api/health` — health check (database connectivity).

## Push notifications

### Admin — task submitted / completed

When an employee submits work, all admins with browser push enabled receive a notification. Enable once: **Messages → Enable message notifications** (same as chat). Requires `VAPID_*` in `server/.env`.

### User — due reminders

Server scheduler (~every 60s): ~10 min before due, +1 h follow-up if not submitted. Channels: **FCM** (Android) and/or **Web Push** (browser).

```bash
npm run vapid:generate --prefix server   # browser push
# FIREBASE_SERVICE_ACCOUNT_PATH for Android
```

### Test FCM (logged in)

```javascript
fetch("/api/push/test", { method: "POST", credentials: "include" }).then((r) => r.json()).then(console.log);
```

## Deployed server (VPS)

**Health:** `http://YOUR_HOST:3000/api/health` → `"db":"connected"`

### Production deploy (all instances)

```bash
for dir in Task_manager Task_manager_safari Task_manager_ss2n; do
  cd ~/$dir && git pull origin main
  npm install --prefix server
  npm run db:migrate:deploy --prefix server
  npm install --prefix client && npm run build --prefix client
done
pm2 restart taskmanager && pm2 restart safari && pm2 restart ss2n
```

**`client/dist` is not in git.** Always run `npm run build` after `git pull`.

### `server/.env` checklist

```env
DATABASE_URL="mysql://USER:PASS@localhost:3306/taskmanager"
SESSION_SECRET="long-random-string"
COOKIE_SECURE=false

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

- `COOKIE_SECURE=false` on **HTTP** — required or login cookie is dropped.
- Turnstile: add VPS hostname in Cloudflare widget domains.
- Brevo: sender must be **verified**.
- Nginx: `client_max_body_size 0;` (unlimited) for large task photo/video uploads — see `deploy/nginx-upload-limit.conf.example`.

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| `401` on `/api/auth/me` before login | Normal — not signed in |
| `401` on login | Wrong credentials or user not seeded |
| `403` on register | OTP not verified first |
| `503` on turnstile-site-key | Add Turnstile keys to `.env`, restart API |
| No OTP email | Check Brevo; in dev read API console |
| Old UI after deploy | `npm run build`; hard-refresh (`Ctrl+Shift+R`) |
| Session lost on HTTP | `COOKIE_SECURE=false` |
| `500` / health `db:error` | MySQL, `DATABASE_URL`, run migrate + seed |
| Push not received (admin) | Enable notifications in Messages; check VAPID keys |
| Submit **413** (too large) | Set nginx `client_max_body_size 0;` and reload — run `sudo bash deploy/patch-nginx-all-sites.sh` |
| Prisma EPERM on Windows | Stop dev server, rerun `db:generate` |

## License

Private / educational use unless you add a license file.
