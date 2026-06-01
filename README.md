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
- Sidebar sections: **Daily**, **Weekly**, **Monthly**, and **Other** (one-time tasks)
- Tasks appear in the section that matches the owner’s **Repeat** setting on the task
- Completing a daily/weekly/monthly task advances the deadline and resets it for the next period (tomorrow, +1 week, +1 month)
- Checkbox to complete tasks (optional proof photo upload)
- List name and deadline on each assignment
- Mobile-friendly card layout
- **Due reminders:** ~**10 minutes before** the deadline, then again **1 hour later** if you still have not submitted. Allow **notifications** when prompted. The **server sends push alerts** so reminders can appear while you use other apps (best on **Android Chrome**). Tapping the notification opens the full-screen alarm. **iPhone:** requires iOS 16.4+, Safari or installed PWA, and usually **HTTPS**.

### Auth
- Email + password sign-in
- Registration (defaults to **employee**; first **owner** can register if none exists)
- **Email OTP verification** before account creation (6-digit code, 10-minute expiry)
- **Cloudflare Turnstile CAPTCHA** before Send OTP (verified server-side)
- Phone: **10 digits** on register (validated client and server)
- Session-based API auth (cookie)

## Tech stack

| Layer    | Stack |
|----------|--------|
| Frontend | Vite, Bootstrap 5, Sass, SortableJS |
| Backend  | Node.js, Express, Zod |
| Database | MySQL, Prisma ORM |
| Auth     | `express-session` + file store |

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **MySQL** 8+ (local or remote)
- npm (comes with Node)

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

Copy the server env template and edit it:

```bash
cp server/.env.example server/.env
```

`server/.env`:

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/taskmanager"
SESSION_SECRET="change-this-to-a-long-random-string"
```

Optional: `PORT` (default **3000**).

For registration OTP emails, configure Brevo in `server/.env` (`BREVO_API_KEY`, `BREVO_SENDER_NAME`, `BREVO_SENDER_EMAIL` — see `server/.env.example`). Without Brevo in development, the OTP is printed in the API server log only.

For registration CAPTCHA, add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile). CAPTCHA is verified when the user clicks **Send OTP** (and **Resend OTP**).

### 3. Migrate and seed

```bash
npm run db:generate --prefix server
npm run db:migrate --prefix server
npm run db:seed --prefix server
```

If you prefer schema sync without migration history:

```bash
npm run db:push --prefix server
npm run db:seed --prefix server
```

### 4. Run in development

From the project root:

```bash
npm run dev
```

- **Web UI:** http://localhost:5173 (Vite proxies `/api` to the API)
- **API:** http://localhost:3000

### Demo accounts (after seed)

| Role     | Email                 | Password     |
|----------|-----------------------|--------------|
| Owner    | `owner@local.test`    | `password123` |
| Employee | `employee1@local.test`| `password123` |
| Employee | `employee2@local.test`| `password123` |

Seed also creates a **My Tasks** list with a **daily** sample task assigned to Employee One.

**Tip for owners:** Set **Repeat** to Daily, Weekly, or Monthly when creating/editing a task so employees see it in the matching section.

## npm scripts

### Root

| Script   | Description |
|----------|-------------|
| `npm run dev`   | API + Vite dev servers together |
| `npm run build` | Production client build → `client/dist` |
| `npm run start` | Production API (serves built client when `NODE_ENV=production`) |

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

## Production

```bash
npm run build
set NODE_ENV=production
npm run start
```

On Unix/macOS:

```bash
npm run build
NODE_ENV=production npm run start
```

Open http://localhost:3000 (or your `PORT`). Ensure `SESSION_SECRET` and `DATABASE_URL` are set for production.

## Project structure

```
Task Manager/
├── client/                 # Vite frontend
│   ├── src/
│   │   ├── main.js         # UI and API client
│   │   └── scss/styles.scss
│   └── dist/               # Built assets (after npm run build)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── prisma-client/      # Generated Prisma client
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/         # auth, lists, tasks, users
│   │   └── middleware/
│   ├── uploads/            # Completion proof images
│   └── sessions/           # Session files (dev)
├── package.json            # Root orchestration scripts
└── README.md
```

## API overview

All JSON routes are under `/api`. Authenticated routes use the session cookie (`credentials: include` from the client).

| Area | Examples |
|------|----------|
| Auth | `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Lists | `GET/POST /api/lists`, `PATCH /api/lists/:id`, reorder |
| Tasks | `GET /api/tasks/lists/:listId`, `POST /api/tasks/lists/:listId`, `PATCH /api/tasks/:id`, `GET /api/tasks/assigned` (employees) |
| Users | `GET /api/users/assignees` (owner: employee picker) |
| Push | `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` (employee phone alerts) |

`GET /api/health` — health check (includes database connectivity).

## Phone push reminders (employees)

Reminders are sent from the **server** (~10 min before due, +1 h follow-up) so alerts can appear while the employee uses other apps.

### Server setup

1. Run the push migration (includes `push_subscription` and `reminder_sent` tables):

   ```bash
   npm run db:migrate --prefix server
   ```

2. Generate VAPID keys and add them to `server/.env`:

   ```bash
   npm run vapid:generate --prefix server
   ```

3. Restart the API. You should see `[reminder] server push scheduler started` in the logs.

### Employee phone

1. Open the app in **Chrome** (Android) or Safari (iOS 16.4+).
2. Log in as an employee and **Allow notifications** when prompted.
3. Optional: **Add to Home screen** (PWA) for more reliable delivery on iPhone.

**Notes**

- **HTTPS** is strongly recommended on real devices (many browsers block push on plain HTTP except localhost).
- **Android Chrome** has the best support for background push.
- **iPhone:** push works in Safari / installed PWA on iOS 16.4+; older iOS or in-app browsers may not receive background alerts.
- If push is not configured (no VAPID keys), in-tab reminders still work while the site is open.

## Deployed server (VPS) checklist

If login fails on a server like `http://YOUR_IP:3000`:

1. **Open** `http://YOUR_IP:3000/api/health`  
   - `"db":"connected"` → database OK  
   - `"db":"error"` → fix MySQL and `DATABASE_URL` in `server/.env`

2. **On the server**, from the project folder:
   ```bash
   git pull origin main
   npm install --prefix server
   npm run db:migrate --prefix server
   npm run build
   pm2 restart taskmanager
   ```
   **Important:** `client/dist` is not in git. You must run **`npm run build`** after every `git pull` or the site will show an old UI (no OTP buttons). Or use `npm start`, which rebuilds the client automatically before starting the API.

3. **`server/.env` must include:**
   ```env
   DATABASE_URL="mysql://USER:PASS@localhost:3306/taskmanager"
   SESSION_SECRET="long-random-string"
   COOKIE_SECURE=false
   VAPID_PUBLIC_KEY="..."
   VAPID_PRIVATE_KEY="..."
   VAPID_SUBJECT="mailto:admin@yourdomain.com"
   BREVO_API_KEY="..."
   BREVO_SENDER_NAME="Task Manager"
   BREVO_SENDER_EMAIL="noreply@yourdomain.com"
   TURNSTILE_SITE_KEY="..."
   TURNSTILE_SECRET_KEY="..."
   ```
   Use `COOKIE_SECURE=false` when using **HTTP** (not HTTPS). Without this, login succeeds but the session cookie is dropped and you stay on the sign-in screen.

   Generate VAPID keys with `npm run vapid:generate --prefix server`. For **phone push while in other apps**, use **HTTPS** on the VPS when possible—plain HTTP often blocks push on mobile (localhost is the exception).

4. **Demo users** (`owner@local.test` / `password123`) exist only **after** `db:seed` on **that** server’s database—not automatically from your laptop.

5. **Phone reminders:** After deploy, log in as an employee on the phone, allow notifications, and confirm the API log shows `[reminder] server push scheduler started`.

## Troubleshooting

- **`401` on `/api/auth/me` before login:** Normal — you are not signed in yet.
- **`401` on `/api/auth/login`:** Wrong email/password, or user not seeded on this server.
- **`400` on login:** Invalid email format or empty fields.
- **`500` on login:** Database error — check `/api/health` and server logs.
- **Prisma / EPERM on Windows:** Stop the dev server, close tools using the DB folder, then rerun `npm run db:generate --prefix server`.
- **API errors from the UI:** Confirm MySQL is running and `DATABASE_URL` in `server/.env` is correct.
- **Login fails after seed:** Run `npm run db:seed --prefix server` again; use the demo emails above.

## License

Private / educational use unless you add a license file.
