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
- **Due reminders:** ~**10 minutes before** the deadline, then again **1 hour later** if you still have not submitted (full-screen alarm + sound; allow **notifications**). Works in the background on **Chrome/Edge** when the site is closed. **Safari/Firefox** may only alert while the tab is open.

### Auth
- Email + password sign-in
- Registration (defaults to **employee**; first **owner** can register if none exists)
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

`GET /api/health` — health check.

## Troubleshooting

- **Prisma / EPERM on Windows:** Stop the dev server, close tools using the DB folder, then rerun `npm run db:generate --prefix server`.
- **API errors from the UI:** Confirm MySQL is running and `DATABASE_URL` in `server/.env` is correct.
- **Login fails after seed:** Run `npm run db:seed --prefix server` again; use the demo emails above.

## License

Private / educational use unless you add a license file.
