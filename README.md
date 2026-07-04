# Task Manager (Kalpanik)

**Product name:** Kalpanik Task Manager (web) · **Companion app:** Kalpanik Reminder (Android)  
**Provider / support:** Kalpanik · [support@kalpanik.in](mailto:support@kalpanik.in)  
**Production example:** [https://sugandhshoppee.kalpanik.in](https://sugandhshoppee.kalpanik.in)  
**Source:** [jay-07-pixel/Task_manager](https://github.com/jay-07-pixel/Task_manager)

Full-stack workforce task management for **company owners**, **admins**, and **employees**. Teams assign work, attach files and voice notes, collect proof, chat, track **live attendance / location**, run reports, and receive reminders on **web** and **Android**.

Each customer site is a **separate deployment** (own domain, database, and uploads). The same product codebase powers every instance.

> **For Terms of Service & Privacy Policy authors:** start with [Product description for legal documents](#product-description-for-legal-documents) and [Personal data inventory](#personal-data-inventory). Those sections list every feature, role, data category, and third party the product uses today.

---

## Table of contents

1. [Overview](#overview)
2. [Product description for legal documents](#product-description-for-legal-documents)
3. [Personal data inventory](#personal-data-inventory)
4. [Roles & permissions](#roles--permissions)
5. [Features (complete)](#features-complete)
6. [Third-party services](#third-party-services)
7. [Tech stack](#tech-stack)
8. [Local development](#local-development)
9. [Admin access & dual login](#admin-access--dual-login)
10. [Attendance & live location](#attendance--live-location)
11. [Task assignment attachments](#task-assignment-attachments)
12. [Owner dashboard & reports](#owner-dashboard--reports)
13. [Android app (Kalpanik Reminder)](#android-app-kalpanik-reminder)
14. [File uploads & limits](#file-uploads--limits)
15. [Push notifications](#push-notifications)
16. [Internationalization](#internationalization)
17. [Project structure](#project-structure)
18. [API overview](#api-overview)
19. [Production deployment (VPS)](#production-deployment-vps)
20. [Nginx configuration](#nginx-configuration)
21. [Troubleshooting](#troubleshooting)

---

## Overview

| Role | Where they work | What they do |
|------|-----------------|--------------|
| **Employee (user)** | Website user dashboard or **Android app** | Share live location (when required), view assigned tasks + admin attachments, submit proof, progress updates, delegate, team chat |
| **Admin** | Website admin dashboard (+ optional user view) | Lists, tasks, attachments, assignees, reports, **Attendance** live map, team chat, manage admins, salary fields |
| **Company owner** | Same as admin, plus Owner dashboard | Everything an admin can do, plus **Owner dashboard** (capacity & performance) and promote/revoke other owners (**max 2 owners** per company instance) |
| **Admin + employee** | Both views | Same account; switch admin / user from profile menu |

Everyone **registers as an employee**. Admins are promoted via **Manage Admin**. Company owners are a subset of admins (`isOwner` in the database). Promoted admins remain assignable as employees.

### Production VPS layout

| Directory on server | PM2 process | Typical domain |
|---------------------|-------------|----------------|
| `~/Task_manager` | `taskmanager` | `sugandhshoppee.kalpanik.in` |
| `~/Task_manager_safari` | `safari` | safari subdomain |
| `~/Task_manager_ss2n` | `ss2n` | `ss2n.kalpanik.in` |
| `~/Task_manager_acs` | `acs` | `acs.kalpanik.in` |
| `~/Task_manager_tacs` | `tacs` | `tacs.kalpanik.in` |

Each instance has its own `server/.env`, MySQL database, session store, and file uploads. All deploy from the same GitHub repo. **Data is not shared across customer instances.**

---

## Product description for legal documents

Use this section as the factual basis for **Terms of Service**, **Privacy Policy**, and (if needed) **employee location / workplace monitoring** notices.

### What the product is

Kalpanik Task Manager is a **B2B / employer-operated** SaaS-style application hosted per customer (or per brand site). It helps an organization:

- Create and assign tasks to employees (including recurring tasks, due dates, priorities, and duration)
- Attach instructions (images, video, PDF, voice notes)
- Collect completion notes and **proof files** (photos, videos, PDFs)
- Track progress updates and task delegation between colleagues
- Communicate via **team chat** (direct messages and groups, including file attachments and voice-to-text)
- Require and monitor **live GPS location / attendance** for employees (when enabled for that company)
- Send **push notifications** and **email OTPs** for security and reminders
- View **reports** and (for company owners) **work capacity and performance** dashboards
- Optionally run a **free trial** period per company instance
- Offer an **Android companion app** (Kalpanik Reminder) for tasks, reminders, and related employee workflows

The product is **not** a consumer social network. Accounts exist so an employer’s team can coordinate work on that employer’s instance.

### Who operates it

| Party | Role |
|-------|------|
| **Kalpanik** (product provider) | Hosts/operates the software platform, infrastructure, and support (`support@kalpanik.in`) |
| **Customer / company** (site operator) | Uses a dedicated instance (domain + database). Admins and owners manage that company’s users and work data |
| **End users** | Employees, admins, and owners who register or are invited to use that instance |

Legal docs should distinguish **Kalpanik as processor/provider** vs **the customer organization as controller of employee workplace data**, where applicable under local law (e.g. India DPDP, GDPR if EU users apply).

### Platforms

| Platform | Description |
|----------|-------------|
| **Web app** | Browser SPA (desktop and mobile browsers). Session cookie authentication |
| **Android app** | Kalpanik Reminder (`in.kalpanik.sugandhreminder`), sideloaded APK from the website (`/downloads/sugandh-reminder.apk`) or equivalent distribution |
| **Server** | Node.js API + MySQL + local disk uploads, typically behind nginx on a VPS |

### Account registration & authentication

Users must provide:

1. **Display name**
2. **Email address** (unique login identifier)
3. **Phone number** (10 digits, stored on the account)
4. **Password** (stored only as a **bcrypt hash**, never plaintext)

Registration flow:

1. Cloudflare **Turnstile** CAPTCHA (bot protection)
2. **Email OTP** (6-digit code) sent via **Brevo** transactional email
3. Account created as **employee** (`isAdmin: false`, `isOwner: false`)
4. Optional bootstrap: if **no admin exists yet**, the first registrant may become admin

Also supported:

- **Login** with email + password (session cookie)
- **Forgot password** (email OTP via Brevo, then set new password)
- **Role switch** for admins: admin dashboard (`owner` session role) vs employee tasks (`employee` session role)
- **No self-service account deletion** in the product today — account removal requires operator/support action (state this clearly in Privacy Policy / Terms)

### Company trial

Per-instance optional **free trial** (`COMPANY_TRIAL_START` / `COMPANY_TRIAL_END` or company settings). UI shows trial banners and may restrict continued use after expiry until the plan is renewed via support.

### Support contact

Authenticated users can send a **support message** (subject + message) from the app. The message is emailed to Kalpanik support (default **support@kalpanik.in**) and includes the user’s **display name**, **email**, and optional **app version**. Users may also email support directly.

### Multi-tenant isolation

Each production site is an **isolated instance**:

- Separate MySQL database
- Separate uploaded files on disk
- Separate session store
- Separate environment configuration

Users on one customer domain **cannot** access another customer’s data through the application.

---

## Personal data inventory

Everything the product stores or processes that is relevant to a Privacy Policy.

### A. Account & identity

| Data | Stored? | Notes |
|------|---------|--------|
| Email | Yes | Login ID; unique per instance |
| Display name | Yes | Shown to teammates, admins, owners |
| Phone number | Yes | Collected at registration |
| Password | Hash only | bcrypt; not recoverable as plaintext |
| Admin flag (`isAdmin`) | Yes | Controls admin dashboard access |
| Company owner flag (`isOwner`) | Yes | Max **2** owners; Owner dashboard + owner management |
| Salary (integer) | Yes | Default value exists; **admins can set/edit** employee salary for reporting/capacity context |
| Account created / updated timestamps | Yes | |

### B. Session & security

| Data | Stored? | Notes |
|------|---------|--------|
| Session cookie (`taskmgr.sid`) | Yes (server session store on disk) | Authenticates the browser/app session |
| Email verification OTP | Hashed, temporary | Registration |
| Password reset OTP | Hashed, temporary | Forgot password |
| Turnstile token | Verified, not stored long-term | Sent to Cloudflare for bot checks |

### C. Tasks & work content

| Data | Stored? | Who can see |
|------|---------|-------------|
| Task titles, notes/descriptions | Yes | Admins/owners; assignees |
| Due dates, timezones, recurrence, priority, duration | Yes | Admins/owners; assignees |
| Assignment lists and assignee links | Yes | Admins/owners; relevant employees |
| Progress updates (type + message) | Yes | Admins/owners; relevant employees |
| Delegation history (from → to) | Yes | Related users / admins |
| Submission text / notes | Yes | Admins/owners; assignee |
| Completion proof files (images, video, PDF) | Yes (disk) | Admins/owners; assignee |
| Assignment attachments (images, video, PDF, voice) | Yes (disk) | Admins/owners; assignees |

### D. Live location & attendance (sensitive)

When live location is **required** for the company (default: **on**):

| Data | Stored? | Notes |
|------|---------|--------|
| Location consent timestamp | Yes | Employee must consent / share location |
| Tracking enabled flag | Yes | Employee can turn tracking off in Settings (admins notified; tasks may be blocked until on again) |
| GPS pings: latitude, longitude, accuracy, time | Yes | Precise location required (approximate rejected; accuracy must be ≤ ~150 m) |
| Off-period history (when tracking was off) | Yes | Start/end times and reason |
| Reverse-geocoded area / city labels | Derived | Via Google Geocoding for admin map UI |

**Who sees location:** company **admins** (Attendance live map, employee cards, history). Employees see their own gate/status.

**When collected:** while the employee uses the **website** with tracking on (browser `watchPosition` + periodic pings). Tracking **stops** when the browser tab is fully closed. Continuous background tracking depends on the **Android app** capabilities if implemented there.

**Purpose (product intent):** workplace attendance / live field visibility for managers — not public sharing.

Legal docs should treat this as **location / monitoring data** and require clear employee notice and lawful basis (employer policy, consent, or applicable employment law).

### E. Team chat

| Data | Stored? | Notes |
|------|---------|--------|
| Direct messages (text) | Yes | Between two users on the same instance |
| Group messages (text) | Yes | Group members |
| Chat attachments (any file type, size-limited) | Yes (disk) | |
| Reply / forward metadata | Yes | |
| Soft-delete timestamps | Yes | Message may be marked deleted |
| Read receipts / last-read | Yes | |
| Voice-to-text transcripts | As message text | Speech recognition runs in the **browser** (Web Speech API); resulting text is stored as chat content |

### F. Devices & notifications

| Data | Stored? | Notes |
|------|---------|--------|
| Web Push subscription (endpoint + keys) | Yes | Browser push |
| Android device ID, FCM token, platform, app version, last seen | Yes | Kalpanik Reminder |
| Reminder delivery logs | Yes | Task/user/slot/channel/status |

### G. Company settings

| Data | Stored? | Notes |
|------|---------|--------|
| Trial start / end dates | Yes | Optional per instance |
| Live location required (boolean) | Yes | Company-wide gate for employees |

### H. Support messages

| Data | Processed? | Notes |
|------|------------|--------|
| Subject, message body | Emailed to support | Not necessarily stored in MySQL |
| User email, display name, app version | Included in support email | |

### I. Translation

| Data | Processed? | Notes |
|------|------------|--------|
| Task titles, descriptions, chat snippets | Sent to translation APIs | `POST /api/translate` uses **MyMemory** and/or **Google** translation fallbacks so UI can show content in EN / HI / MR / TA |

Privacy Policy should disclose that **user-generated text may be sent to third-party translation providers** when a user uses translation features.

### J. Data not collected by the product (current scope)

- Payment card numbers (billing is offline via support / plan renewal)
- Government ID documents (unless a user uploads them as a task/chat file — treat uploads as user-controlled content)
- Contacts, SMS, or call logs from the phone (unless the Android app’s OS permissions change — document app permissions separately in the Play/APK privacy form)

### Storage locations

| Store | Contents |
|-------|----------|
| **MySQL** (per instance) | Accounts, tasks, chat metadata/text, location pings, preferences, devices, OTPs (hashed), company settings |
| **Server disk** `server/uploads/` | Completion proofs, assignment attachments, chat files |
| **Server disk** `server/sessions/` | Session files |
| **User device** | Browser cookies/local preferences (theme, last UI mode); Android app local state + FCM token |

### Retention & deletion (product behavior today)

| Topic | Current product behavior |
|-------|--------------------------|
| Account self-delete | **Not available** in-app |
| Admin revoke | Admin access can be revoked; user account remains |
| Owner revoke | Owner flag can be removed (not last owner; not self) |
| Cascades | Deleting a user in the database would cascade related rows (tasks ownership rules vary); there is **no end-user “delete my data” button** |
| Files | Remain on disk until removed by operators |

Privacy Policy should state how users request deletion (e.g. contact **support@kalpanik.in** or their company admin) and how long data is kept after employment ends.

---

## Roles & permissions

| Capability | Employee | Admin | Company owner |
|------------|:--------:|:-----:|:-------------:|
| Register / login | ✓ | ✓ | ✓ |
| View & complete assigned tasks | ✓ | ✓ (user view) | ✓ (user view) |
| Submit proof & progress | ✓ | ✓ | ✓ |
| Delegate tasks | ✓ | ✓ | ✓ |
| Team chat | ✓ | ✓ | ✓ |
| Live location (when required) | ✓ required | — | — |
| Create/edit lists & tasks | — | ✓ | ✓ |
| View all assignees / submissions | — | ✓ | ✓ |
| Attendance live map & history | — | ✓ | ✓ |
| Reports | — | ✓ | ✓ |
| Manage admins (promote/revoke) | — | ✓ | ✓ |
| Edit employee salary | — | ✓ | ✓ |
| Owner dashboard (capacity, performance) | — | — | ✓ |
| Promote/revoke company owners (max 2) | — | — | ✓ |
| Download Android APK | ✓ | ✓ | ✓ |
| Contact support | ✓ | ✓ | ✓ |

**Rules worth stating in Terms:**

- Registration creates an **employee** account only.
- **Admins** are appointed by existing admins (Manage Admin).
- **Company owners** are appointed only by existing owners; maximum **two** owners per instance; an owner cannot revoke themselves; the last owner cannot be revoked.
- Admins/owners can view **employee work data**, **chat they participate in**, and **live location** (admins).
- Employees must comply with company location policy when live location is required; turning tracking off may **block task access** and **notify admins**.
- Misuse (false proofs, harassment in chat, unauthorized access) may result in account suspension by the company or Kalpanik.

---

## Features (complete)

### Admin dashboard (website)

- **KPI cards** — Active, In Review, Completed, Employee Assigned (click to filter)
- **Task table** — sortable rows, expandable assignee progress, view submissions, mark assignees done
- **High-priority tasks** — red styling, pinned to top of list
- **Lists** — create, rename, reorder, delete, pin; **Employee assignments** list for delegated tasks
- **Tasks** — title, description, due date/time, timezone, all-day, duration (minutes), recurrence (daily / weekly / monthly / yearly / custom)
- **Assignment attachments** — images, videos, PDFs, and **voice notes** when creating/editing a task
- **Multi-assignee** — any registered user (including admins in user view)
- **Per-assignee** — Pending / Submitted, progress updates, proof files
- **Attendance** — live map (Google Maps), Live/Off status, area + city, off/on times, history, refresh, click-to-focus map
- **Reports** — employee filter, performance chart, late/pending detail list
- **Team chat** — DMs, groups, file attachments, voice-to-text (EN / HI / MR / TA)
- **Push alerts** — browser notification on task submit/complete; location tracking off/on
- **Admin announcements** — in-app bell for feature updates (actions: Attendance, Owner dashboard, Download APK)
- **Manage admin** — promote / revoke admin (email via Brevo); mobile-friendly team modal
- **Theme** — light / dark
- **Languages** — English, Hindi, Marathi, Tamil (+ dynamic translation of task/chat content)

### Company owner only

- **Owner dashboard** (Profile → Owner dashboard) — monthly work capacity (month filter + chart), task breakdown by employee, employee performance (late / pending)
- **Manage company owners** — promote/revoke owners (admins only; max 2)

### Employee dashboard (website)

- **Location gate** — must share **precise** live location before tasks are available (when company requires it)
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
4. **Create account** → employee role (`isAdmin: false`)  
5. First-ever bootstrap: only when no admin exists, first registrant can become admin  

Session cookie auth. Active UI mode: `owner` (admin dashboard) or `employee` (user dashboard) via `POST /api/auth/switch-role`.

### Android app (Kalpanik Reminder)

- Login with same email/password as website
- View assigned tasks, submit completion proof
- FCM reminders and alarms
- Same REST API as web
- APK download from website profile menu or `/downloads/sugandh-reminder.apk`

---

## Third-party services

Disclose these processors in the Privacy Policy.

| Service | Provider | Purpose | Data involved |
|---------|----------|---------|----------------|
| **Brevo** | Brevo (Sendinblue) | Registration OTP, password reset, admin promote/revoke emails | Email, name, OTP codes |
| **Cloudflare Turnstile** | Cloudflare | Bot protection on register / forgot password | CAPTCHA tokens, IP/browser signals (per Cloudflare policy) |
| **Google Maps / Geocoding** | Google | Admin attendance map and place names (area, city) | Coordinates; map tiles in admin browser |
| **Firebase Cloud Messaging** | Google | Android push notifications | Device FCM tokens, notification payloads |
| **Web Push (VAPID)** | Browser push services (e.g. browser vendors) | Browser notifications | Push subscription endpoints/keys |
| **MyMemory / Google Translate** | Third-party translation APIs | Optional UI translation of tasks/chat | Text snippets submitted for translation |
| **Gmail SMTP** (support) | Google | Support contact form delivery | Support message + user email/name |
| **Hosting VPS / MySQL** | Kalpanik infrastructure | Application hosting | All application data for that instance |

No payment gateway is integrated in-app.

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
| `SUPPORT_SMTP_USER` / `SUPPORT_SMTP_PASSWORD` / `SUPPORT_SMTP_TO` | Support contact form (default to `support@kalpanik.in`) |

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
| Register | Always creates an **employee** (`isAdmin: false`, `isOwner: false`) |
| Grant admin | Settings → **Manage Admin** → **Make admin** |
| Revoke admin | Same modal → **Revoke** (not yourself; not the last admin) |
| Grant company owner | Owner dashboard → promote admin to owner (max **2** owners) |
| Revoke company owner | Owner dashboard → revoke (not yourself; not the last owner) |
| First login (admin) | Picker: **Admin dashboard** or **My tasks (user)** — saved in browser |
| Switch anytime | Profile → **Switch to admin view** / **Switch to user view** |

API: `POST /api/auth/switch-role` with `{ "role": "owner" | "employee" }`.

Promoted admins remain assignable as employees and can submit tasks from user view or the Android app.

After owner-related deploys, users should **log out and log in again** so `isOwner` is loaded on the session.

---

## Attendance & live location

### Employee (website)

1. On login, a **location gate** blocks tasks until location is shared (when `liveLocationRequired` is true for the company).
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

Visible only to users with **`isOwner: true`** (company owners, max 2).

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
- **Manage company owners** — promote/revoke (admins only; max 2)

### Reports

- Org overview KPIs
- Employee performance and charts (admins and owners)

---

## Android app (Kalpanik Reminder)

Separate project: `AndroidStudioProjects/SugandhReminder`  
Package: `in.kalpanik.sugandhreminder`

### What the app does

- Login with same email/password as website
- View assigned tasks, submit completion proof
- FCM reminders and alarms
- Same REST API as web (`/api/tasks/assigned`, completion-proof, etc.)
- Should parse `assignmentAttachments` on tasks and download files with the session cookie

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
| **Users** | `GET /assignees`, `GET /team`, `PATCH /users/:id/role`, `PATCH /users/:id/company-owner`, profile |
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
| Owner dashboard missing | User needs `isOwner`; log out/in after promote; max 2 owners |
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

---

## Disclaimer for legal drafting

This README describes **how the software works today**. It is **not** legal advice. Have a qualified lawyer draft and review your Terms of Service and Privacy Policy for your jurisdiction (including employment monitoring and location data rules). Update those documents whenever you add features that collect new data or change who can access it.
