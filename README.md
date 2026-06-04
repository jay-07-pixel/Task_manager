# Task Manager

A full-stack task management app for a **list owner** and **assigned employees**. Owners create lists and tasks, assign work, and track completion. Employees see only their assignments, mark tasks done, and can attach optional photo proof.

## Features

### Owner
- Multiple task lists (create, rename, reorder, delete)
- Tasks with title, description, due date/time, all-day, and recurrence (including custom rules)
- Assign one or more employees per task (searchable picker)
- Per-assignee status: **Pending** / **Submitted**, with optional proof image
- Mark assignees done from a modal; drag-and-drop task ordering
- Light / dark theme

### Employee
- Sidebar sections: **Daily**, **Weekly**, **Monthly**, and **Other** (one-time or yearly / custom)
- Tasks appear in the section that matches the owner’s **Repeat** setting (custom day/week/month rules map to the matching section)
- Completing a repeating task advances the deadline and resets assignee status for the next period:
  - **Daily** → +1 day  
  - **Weekly** → +7 days  
  - **Monthly** → +1 month  
  - **Yearly** → +1 year  
  - **Custom** → every N days/weeks/months/years (with optional **Ends on** date or **After N occurrences**)
- Checkbox to complete tasks (optional proof photo upload)
- List name and deadline on each assignment
- Mobile-friendly card layout
- **Due reminders:** ~**10 minutes before** the deadline, then again **1 hour later** if still not submitted. The **server sends Web Push** alerts so reminders can appear while you use other apps (best on **Android Chrome**). Tapping the notification opens the full-screen alarm. **iPhone:** iOS 16.4+, Safari or installed PWA, usually **HTTPS**.

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
| `VAPID_*` | Optional — employee phone push reminders (see below). |

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
| `npm run db:migrate` | Apply migrations |
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
| Push | `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` |

`GET /api/health` — health check (database connectivity).

**Register** requires verified OTP (`email_verification` table) and a valid Turnstile token on `send-otp` only.

## Phone push reminders (employees)

Reminders are sent from the **server** (~10 min before due, +1 h follow-up).

1. Apply migrations (includes `push_subscription`, `reminder_sent`):

   ```bash
   npm run db:migrate --prefix server
   ```

2. Generate VAPID keys and add to `server/.env`:

   ```bash
   npm run vapid:generate --prefix server
   ```

3. Restart the API. Log should show `[reminder] server push scheduler started` and `[push] VAPID ready`.

### Employee phone

1. Open in **Chrome** (Android) or Safari (iOS 16.4+).
2. Log in as employee and **Allow notifications**.
3. Optional: **Add to Home screen** (PWA) on iPhone.

**Notes:** **HTTPS** recommended on real devices. **Android Chrome** has the best background push support. If VAPID is missing, in-tab reminders still work while the site is open.

## Deployed server (VPS) checklist

1. **Health:** `http://YOUR_HOST:3000/api/health` → `"db":"connected"`

2. **Deploy** (from project folder):

   ```bash
   git pull origin main
   npm install --prefix server
   npm run db:migrate --prefix server
   npm run build
   pm2 restart taskmanager
   ```

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

6. **Push:** Employees must allow notifications; check `push_subscription` rows in MySQL after login.

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

## License

Private / educational use unless you add a license file.
