# Task Manager

A full-stack task management app for a **list owner** and **assigned employees**. **Owners** use the website for lists, tasks, assignees, and proof review. **Employees** register on the website, then use the **Kalpanik Reminder** Android app for daily task work (view, complete, proof, FCM reminders).

## Features

### Owner
- Multiple task lists (create, rename, reorder, delete)
- Tasks with title, description, due date/time, all-day, and recurrence (including custom rules)
- Assign one or more employees per task (searchable picker)
- Per-assignee status: **Pending** / **Submitted**, with optional proof image
- Mark assignees done from a modal; drag-and-drop task ordering
- Light / dark theme

### Employee (website)
- **Register only** on the website (OTP + CAPTCHA) — no task dashboard on web
- After login or registration, employees see a **use the Kalpanik Reminder app** screen
- Daily task work (view, complete, proof upload, alarms) is in the **Android app** only

### Employee (Android app — Kalpanik Reminder)
- Assigned tasks, completion, proof upload, FCM reminders/alarms (same backend APIs as the website)

### Auth & registration
- Email + password sign-in
- **Registration flow:** Complete CAPTCHA → **Send OTP** → verify code → **Create account**
- **Cloudflare Turnstile** verified server-side before OTP is sent (rate-limited)
- **Email OTP** via **Brevo** (6-digit code, 10-minute expiry, max 5 sends/hour and 5 verify attempts per email)
- Phone: **10 digits** on register (validated client and server)
- Registration defaults to **employee**; first **owner** can register if none exists
- Session-based API auth (cookie)

## Tech stack

| Layer    | Stack |
|----------|--------|
| Frontend | Vite, Bootstrap 5, Sass, SortableJS |
| Backend  | Node.js, Express, Zod |
| Database | MySQL, Prisma ORM |
| Auth     | `express-session` + file store |
| Email    | Brevo Transactional API |
| CAPTCHA  | Cloudflare Turnstile |
| Push     | `web-push` + VAPID |

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **MySQL** 8+ (local or remote)
- npm (comes with Node)
- [Brevo](https://www.brevo.com) account (registration OTP emails)
- [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) site (registration CAPTCHA)

## Quick start

### 1. Clone and install

```bash
cd "Task Manager"
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Database and environment

Create a MySQL database (example name: `taskmanager`).

```bash
cp server/.env.example server/.env
```

Edit `server/.env` — minimum:

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/taskmanager"
SESSION_SECRET="change-this-to-a-long-random-string"
```

**Registration (recommended for full sign-up flow):**

```env
BREVO_API_KEY="xkeysib-..."
BREVO_SENDER_NAME="Task Manager"
BREVO_SENDER_EMAIL="verified-sender@yourdomain.com"

TURNSTILE_SITE_KEY="your-site-key"
TURNSTILE_SECRET_KEY="your-secret-key"
```

| Variable | Purpose |
|----------|---------|
| `BREVO_*` | Sends OTP emails. Without Brevo in dev, OTP is printed in the API console only. |
| `TURNSTILE_*` | CAPTCHA before Send OTP. Add your hostname in the Turnstile dashboard. |
| `COOKIE_SECURE` | Set `false` for HTTP VPS; `true` for HTTPS. |
| `PORT` | API port (default **3000**). |
| `VAPID_*` | Optional — browser Web Push reminders (see below). |
| `FIREBASE_SERVICE_ACCOUNT_*` | Optional — Android FCM (device register, test push, scheduled reminders). |

**Local Turnstile test keys** (always pass): site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

### 3. Migrate and seed

```bash
npm run db:generate --prefix server
npm run db:migrate --prefix server
npm run db:seed --prefix server
```

Or sync schema without migration history:

```bash
npm run db:push --prefix server
npm run db:seed --prefix server
```

### 4. Run in development

```bash
npm run dev
```

- **Web UI:** http://localhost:5173 (Vite proxies `/api` to the API)
- **API:** http://localhost:3000

Use **localhost:5173** during development so you always see the latest UI. Port **3000** serves the built `client/dist` only after `npm run build`.

### Demo accounts (after seed)

| Role     | Email                  | Password      |
|----------|------------------------|---------------|
| Owner    | `owner@local.test`     | `password123` |
| Employee | `employee1@local.test` | `password123` |
| Employee | `employee2@local.test` | `password123` |

Seed also creates a **My Tasks** list with a **daily** sample task assigned to Employee One.

**Tip for owners:** Set **Repeat** to Daily, Weekly, or Monthly when creating/editing a task so employees see it in the matching section.

## Registration flow (user)

1. Fill **Display name**, **Email**, **Phone**, **Password**
2. Complete **Security check** (Turnstile)
3. Click **Send OTP** → enter 6-digit code from email → **Verify**
4. Click **Create account**

## npm scripts

### Root

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Vite dev servers together |
| `npm run build` | Production client build → `client/dist` |
| `npm run start` | Rebuild client, then start API with `NODE_ENV=production` |
| `npm run deploy` | `npm install` (server), `db:generate`, `build` — run before restart on VPS |

### Server (`server/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | API with file watch |
| `npm run start` | API (production) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Apply migrations (local dev) |
| `npm run db:migrate:deploy` | Apply migrations on production VPS |
| `npm run db:push` | Push schema to DB |
| `npm run db:seed` | Seed demo users and sample data |
| `npm run vapid:generate` | Generate VAPID keys for phone push reminders |

### Client (`client/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Build static assets |
| `npm run preview` | Preview production build |

## Production (local)

```bash
npm run start
```

Or manually:

```bash
npm run build
set NODE_ENV=production
npm run start --prefix server
```

On Unix/macOS: `NODE_ENV=production npm run start --prefix server`.

Open http://localhost:3000 (or your `PORT`). Ensure `SESSION_SECRET` and `DATABASE_URL` are set.

## Project structure

```
Task Manager/
├── client/
│   ├── src/
│   │   ├── main.js           # UI and API client
│   │   ├── reminders.js      # In-tab employee reminders
│   │   ├── sw-register.js    # Web Push subscribe
│   │   └── scss/styles.scss
│   ├── public/
│   │   ├── sw.js             # Service worker (push)
│   │   └── alarm.html
│   └── dist/                 # Built assets (not in git — run npm run build)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.js
│   │   └── migrations/
│   ├── prisma-client/
│   ├── src/
│   │   ├── index.js
│   │   ├── load-env.js       # Loads server/.env (works with PM2 any cwd)
│   │   ├── routes/           # auth, lists, tasks, users, push
│   │   ├── lib/
│   │   │   ├── mail.js       # Brevo OTP email
│   │   │   ├── turnstile.js  # CAPTCHA siteverify
│   │   │   ├── otp.js        # OTP generate/hash
│   │   │   ├── recurrenceRoll.js
│   │   │   ├── push.js
│   │   │   └── reminderScheduler.js
│   │   └── middleware/
│   ├── uploads/              # Completion proof images
│   └── sessions/
├── package.json
└── README.md
```

## API overview

All JSON routes are under `/api`. Authenticated routes use the session cookie (`credentials: include` from the client).

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Auth OTP | `GET /api/auth/turnstile-site-key`, `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` |
| Lists | `GET/POST /api/lists`, `PATCH /api/lists/:id`, reorder |
| Tasks | `GET /api/tasks/lists/:listId`, `POST /api/tasks/lists/:listId`, `PATCH /api/tasks/:id`, `GET /api/tasks/assigned` |
| Users | `GET /api/users/assignees` (owner employee picker) |
| Push | `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/push/devices/register`, `POST /api/push/test` |

`GET /api/health` — health check (database connectivity).

**Register** requires verified OTP (`email_verification` table) and a valid Turnstile token on `send-otp` only.

## Phone push reminders (employees)

Reminders are sent from the **server every 60 seconds** (~10 min before due, +1 h follow-up if still not submitted). Delivery is tracked in `reminder_sent` (per task, user, due time, slot, and channel).

### Android FCM (Phase 8.3–8.4)

1. Apply migrations (`employee_device`, `reminder_sent` with `channel` / `status`):

   ```bash
   npm run db:migrate --prefix server
   ```

2. Add Firebase service account to `server/.env`:

   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH="firebase-service-account.json"
   ```

   Place the JSON next to `server/.env` (gitignored). Restart the API.

3. Expected logs:

   ```text
   [fcm] Firebase Admin ready (project: …)
   [reminder] scheduler started (every 60s) channels: fcm
   ```

4. Register the device from the Android app (`POST /api/push/devices/register` while logged in).

5. **Test FCM** (manual):

   ```javascript
   fetch("/api/push/test", { method: "POST", credentials: "include" }).then((r) => r.json()).then(console.log);
   ```

6. **Test scheduled reminder** (owner assigns task to employee with due time in the next **10 minutes**):

   - Due window: from **10 minutes before** `due_at` until **due_at** (slot `before10`).
   - Notification title: **Task Reminder**
   - Body: `{task title} — {formatted due time}`
   - FCM data: `type=task_reminder`, `taskId`, `slot`, `dueAt` (ISO)

   Optional debug:

   ```bash
   DEBUG_REMINDERS=true pm2 restart taskmanager
   ```

   Check delivery:

   ```sql
   SELECT * FROM reminder_sent WHERE channel = 'fcm' ORDER BY sent_at DESC LIMIT 10;
   ```

   Slot helper (local):

   ```bash
   node server/scripts/test-reminder-slot.mjs "2026-06-06T15:10:00.000Z"
   ```

### Browser Web Push (optional)

1. Generate VAPID keys and add to `server/.env`:

   ```bash
   npm run vapid:generate --prefix server
   ```

2. Restart the API. Log may show `channels: fcm, web_push` and `[push] VAPID ready`.

3. Employee: **Chrome** (Android) or Safari (iOS 16.4+), log in, **Allow notifications**.

**Notes:** **HTTPS** recommended on real devices. If neither FCM nor VAPID is configured, in-tab reminders still work while the site is open (`client/src/reminders.js`).

## Deployed server (VPS) checklist

1. **Health:** `http://YOUR_HOST:3000/api/health` → `"db":"connected"`

2. **Deploy** (from project folder):

   ```bash
   git pull origin main
   npm install --prefix server
   npm run db:migrate:deploy --prefix server
   npm run db:generate --prefix server
   npm run build
   pm2 restart taskmanager
   ```

   After deploy, verify Contact API exists (should **not** return SPA HTML):

   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/support/contact
   ```

   Expect **401** (not signed in) or **400** — **not 404**.

   **`client/dist` is not in git.** Run **`npm run build`** after every `git pull`, or use **`npm run start`** from the repo root (rebuilds then starts the API).

3. **`server/.env` example:**

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

   SUPPORT_SMTP_USER="kalpanik432@gmail.com"
   SUPPORT_SMTP_PASSWORD="your-gmail-app-password"
   SUPPORT_SMTP_TO="kalpanik432@gmail.com"
   ```

   - `COOKIE_SECURE=false` on **HTTP** — required or login cookie is dropped.  
   - Turnstile: add your **VPS hostname** (e.g. `aromawrap.duckdns.org`) in the Cloudflare widget domains.  
   - Brevo: sender email must be **verified** in Brevo.

4. **Verify after restart:**

   ```bash
   curl -s http://localhost:3000/api/auth/turnstile-site-key
   ```

   Should return `{"siteKey":"..."}`. If **503**, Turnstile env vars are missing or `load-env` path is wrong.

5. **Demo users** exist only after `npm run db:seed --prefix server` on that server.

6. **Push:** Android — `employee_device` row after app login; browser — `push_subscription` after allowing notifications. Reminder audit — `reminder_sent` (`channel` = `fcm` or `web_push`, `status` = `sent` or `failed`).

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| `401` on `/api/auth/me` before login | Normal — not signed in |
| `401` on login | Wrong credentials or user not seeded on this server |
| `403` on register | OTP not verified — complete Send OTP → Verify first |
| `503` on `/api/auth/turnstile-site-key` | Add `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` to `server/.env` and restart API |
| Turnstile “Unable to connect to website” | Add site hostname in Cloudflare Turnstile dashboard |
| No OTP email | Check Brevo keys and verified sender; in dev, read API console log |
| Old UI on VPS (no OTP/CAPTCHA) | Run `npm run build` after `git pull` |
| Login works but session lost | Set `COOKIE_SECURE=false` on HTTP |
| `500` / health `db:error` | MySQL running, correct `DATABASE_URL`, run migrate + seed |
| Prisma EPERM on Windows | Stop dev server, rerun `npm run db:generate --prefix server` |
| Push `invalid JWT` / no background alerts | Regenerate VAPID, clear `push_subscription`, re-login and allow notifications |
| CAPTCHA overflows on mobile | Pull latest; uses compact Turnstile + stacked layout |
| Submit task shows **413 Request Entity Too Large** (nginx HTML) | On VPS nginx `server` block add `client_max_body_size 6m;` then `sudo nginx -t && sudo systemctl reload nginx` (see `deploy/nginx-upload-limit.conf.example`) |
| Submit task shows **Server error** | Run migration on VPS: `npm run db:migrate:deploy --prefix server` then `npm run db:generate --prefix server` and `pm2 restart taskmanager`. Check `pm2 logs taskmanager` for `[completion-proof]` errors. |

## License

Private / educational use unless you add a license file.
