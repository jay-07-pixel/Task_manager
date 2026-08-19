# Kalpanik Task Manager

**Product:** Kalpanik Task Manager (web) · **Companion app:** Kalpanik Reminder (Android)  
**Provider / support:** Kalpanik · [support@kalpanik.in](mailto:support@kalpanik.in) · [kalpanik.in](https://kalpanik.in/)  
**Production example:** [https://sugandhshoppee.kalpanik.in](https://sugandhshoppee.kalpanik.in)  
**Source:** [jay-07-pixel/Task_manager](https://github.com/jay-07-pixel/Task_manager)

Workforce operations software for **company owners**, **admins**, and **employees**. One codebase powers every customer site; each company gets an isolated domain, database, uploads, and trial.

Teams assign work across **lists**, review everything in **All Tasks**, collect mixed proof files (photos, PDFs, video, audio), chat, track **live GPS attendance**, run **geofenced check-in**, manage **deadline extensions**, and receive reminders on **web** and **Android**. Owners can **view plans** in-app and **renew on kalpanik.in**. Admins can **delete employees** so they can no longer sign in.

**Core workflow:** employee submits proof → **Submitted** (awaiting owner) → owner **Mark as reviewed** → recurring series **spawns the next due card**. Work that is **6+ days overdue** is gated until submit or postpone. The same rules apply on the website and Kalpanik Reminder.

> **For Terms of Service & Privacy Policy authors:** start with [Product description for legal documents](#product-description-for-legal-documents) and [Personal data inventory](#personal-data-inventory). Those sections list every feature, role, data category, and third party the product uses today.

---

## Table of contents

1. [Overview](#overview)
2. [Architecture & product approach](#architecture--product-approach)
3. [Plans, billing & storage](#plans-billing--storage)
4. [Product description for legal documents](#product-description-for-legal-documents)
5. [Personal data inventory](#personal-data-inventory)
6. [Roles & permissions](#roles--permissions)
7. [Features (complete)](#features-complete)
8. [All Tasks view](#all-tasks-view)
9. [Overdue color coding](#overdue-color-coding)
10. [Deadline extensions & critical overdue gate](#deadline-extensions--critical-overdue-gate)
11. [Attendance: live location & daily check-in](#attendance-live-location--daily-check-in)
12. [Company profile, employees & work locations](#company-profile-employees--work-locations)
13. [Task lifecycle: submissions, reopen & recurrence](#task-lifecycle-submissions-reopen--recurrence)
14. [Team chat](#team-chat)
15. [Third-party services](#third-party-services)
16. [Tech stack](#tech-stack)
17. [Local development](#local-development)
18. [Admin access & dual login](#admin-access--dual-login)
19. [Task assignment attachments](#task-assignment-attachments)
20. [Owner dashboard & reports](#owner-dashboard--reports)
21. [Android app (Kalpanik Reminder)](#android-app-kalpanik-reminder)
22. [File uploads & limits](#file-uploads--limits)
23. [Push notifications](#push-notifications)
24. [Internationalization](#internationalization)
25. [PWA, legal & support](#pwa-legal--support)
26. [Project structure](#project-structure)
27. [API overview](#api-overview)
28. [Production deployment (VPS)](#production-deployment-vps)
29. [Nginx configuration](#nginx-configuration)
30. [Troubleshooting](#troubleshooting)

---

## Overview

| Role | Where they work | What they do |
|------|-----------------|--------------|
| **Employee (user)** | Website user dashboard or **Android app** | Share live location (when required), geofenced check-in/out (when enabled), view assigned tasks + admin attachments, submit/update mixed proof files, progress updates, delegate, request deadline extensions, team chat, see overdue color tiers / critical overdue gate |
| **Admin** | Website admin dashboard (+ optional user view) | Lists, **All Tasks**, overdue color legend/filters, tasks, attachments, assignees, reports, **Attendance** (live map + daily reports), **Deadline extensions**, team chat, manage admins, **manage employees** (salary + **delete**), manage locations |
| **Company owner** | Same as admin, plus Owner dashboard | Everything an admin can do, plus **Owner dashboard** (capacity & performance), **Company profile** (GST, contacts), **view plans / renew on kalpanik.in**, and promote/revoke other owners (**max 2 owners** per company instance) |
| **Admin + employee** | Both views | Same account; switch admin / user from profile menu |

Everyone **registers as an employee**. Admins are promoted via **Manage Admin**. Company owners are a subset of admins (`isOwner` in the database). Promoted admins remain assignable as employees.

### Capability snapshot

| Area | Highlights |
|------|------------|
| **Work** | Lists, All Tasks, recurrence, high priority, duration, reminders, assignment attachments, voice notes |
| **Proof** | Mixed photos + PDFs + video + audio (up to 10 files), archive/resubmit, owner Mark as reviewed |
| **People** | Dual login, manage admins/owners, employee profiles, salary, **delete employee**, 1 GB storage quota |
| **Field** | Live GPS map, geofenced check-in/out, daily/monthly attendance reports |
| **Ops** | Deadline extensions (6+ day gate), reports, owner capacity dashboard, team chat (DM + groups) |
| **Reach** | Web PWA, Android Kalpanik Reminder, EN/HI/MR/TA, Web Push + FCM |
| **Commercial** | 30-day trial, ₹299 / ₹349 plans, renew on [kalpanik.in](https://kalpanik.in/) with bill + UPI QR |

### Production VPS layout

| Directory on server | PM2 process | MySQL database (typical) | Typical domain |
|---------------------|-------------|--------------------------|----------------|
| `~/Task_manager` | `taskmanager` | `taskmanager` | `sugandhshoppee.kalpanik.in` |
| `~/Task_manager_safari` | `safari` | `taskmanager_safari` | safari subdomain |
| `~/Task_manager_ss2n` | `ss2n` | `taskmanager_ss2n` | `ss2n.kalpanik.in` |
| `~/Task_manager_acs` | `acs` | `taskmanager_acs` | `acs.kalpanik.in` |
| `~/Task_manager_tacs` | `tacs` | `taskmanager_tacs` | `tacs.kalpanik.in` |
| `~/Task_manager_ensens` | `ensens` | `taskmanager_ensens` | `ensens.kalpanik.in` |
| `~/Task_manager_edunest` | `edunest` | `taskmanager_edunest` | `edunest.kalpanik.in` |

Each instance has its own `server/.env`, MySQL database, session store, file uploads, and optional **company trial** dates. All deploy from the same GitHub repo. **Data is not shared across customer instances.**

Some sites (e.g. ensens, edunest) serve the SPA from **`/var/www/<site>`** while Node only handles `/api`. After `npm run build`, copy `client/dist` to that www root or the browser keeps an old UI. See [Production deployment](#production-deployment-vps).

---

## Architecture & product approach

How the product is designed and operated (all companies share this model).

### Multi-tenant = many folders, one repo

| Approach | Why |
|----------|-----|
| **One GitHub repo** (`Task_manager`) | Same features for every customer |
| **One VPS folder + PM2 app + DB per company** | Isolation of data, sessions, uploads, branding, trial |
| **Per-site `server/.env`** | Ports, `DATABASE_URL`, trial dates, maps keys, VAPID/FCM |
| **Hostname-aware PWA** | Each domain can show its own install name / branding |

Never share one MySQL database between two customer sites.

### Task status model (owner review)

| Stage | Employee sees | Owner / admin sees | `Task.completed` | Assignee `assigneeDone` |
|-------|---------------|--------------------|------------------|-------------------------|
| Open / working | **Active** | **Active** or **In progress** | `false` | `false` |
| Employee finished | **Submitted** | **Submitted** (awaiting review) | `false` | `true` |
| Owner finished review | — (or next recurrence card) | **Reviewed** / completed | `true` | `true` |

- Submitting proof sets **`assigneeDone`**, not `completed`.
- Owner uses **Mark as reviewed** (`PATCH` `completed: true`) to close the card.
- Reports treat “all assignees submitted” like completed for Active/Overdue counts so history does not inflate open work.

### Recurring tasks = one card per due day

| Approach | Detail |
|----------|--------|
| **Spawn-per-occurrence** | After owner reviews a recurring task, server creates a **new** open task for the next due date; submission stays on the completed card |
| **Not in-place roll** | Old model reused one row and caused confusion; legacy rows are reconciled once on server start |
| **Idempotent spawn** | Will not create a second card for the same list + title + recurrence + **calendar due day** (`APP_TIMEZONE`) |
| **Dedupe script** | `server/scripts/delete-duplicate-recurring-tasks.js` removes leftover same-day duplicates (dry-run with `DRY_RUN=1`) |

Seeing the same **title** twice with **different due dates** is normal (yesterday’s submitted card + today’s open card).

### Critical overdue gate (web + Android)

| Rule | Behavior |
|------|----------|
| Trigger | Assigned work **≥ 6 days** past due, still open for that employee |
| Actions | **Submit** or **Postpone** (deadline extension request) |
| Grace | **24 hours** after postpone (`localStorage` / SharedPreferences + server `expiresAt`) |
| Must skip | Already submitted, has current proof/text, owner-reviewed (`completed`), deleted / not assigned |
| Parity | Website gate and Android `TaskOverdueGateActivity` follow the same API and dismiss rules |

Stale postpone requests are **cancelled** when the employee submits, owner reviews, or the task is no longer critically overdue. Admin badge only counts actionable pending requests.

### Company free trial & renewal

| Approach | Detail |
|----------|--------|
| Env | `COMPANY_TRIAL_START` / `COMPANY_TRIAL_END` as `YYYY-MM-DD` in that site’s `server/.env` |
| Sync | On PM2 restart (`--update-env`), env dates write into `company_settings` |
| UI | Trial banner, trial notice popup, Owner dashboard trial card |
| In-app plans | Owners/admins open **View plans** (Task Management ₹299 / Task + Attendance ₹349) |
| Renew | **Renew on kalpanik.in** opens `https://kalpanik.in/renew` with tenant context (instance, site, users, trial end, plan) |
| Payment | Bill + **dynamic UPI QR** on kalpanik.in (no Razorpay/Paytm SDK in Task Manager) |
| Examples | See `deploy/company-trial-env.example` |

Extend a site by editing **that site’s** `.env` and `pm2 restart <name> --update-env`, or after a paid renewal on kalpanik.in. No Task Manager code change is required to change dates.

---

## Plans, billing & storage

Public pricing lives on [kalpanik.in](https://kalpanik.in/). Task Manager shows the same plans in-app and sends owners to kalpanik.in to pay.

### Plans

| Plan | Price | Storage | What’s included |
|------|-------|---------|-----------------|
| **Task Management** | **₹299** / user / month | 1 GB per user | Unlimited tasks, categories, assignment, recurrence, proof (image/video/PDF), voice notes, team chat, push & smart reminders, deadline extensions, reports, productivity overview, multi-language, Android + web |
| **Task + Attendance** | **₹349** / user / month | 1 GB per user | Everything in Task Management **plus** live GPS, check-in/out, geofence, automatic attendance, work/extra hours, attendance history & reports, late/early, overtime & leave, live location sharing, field force, Owner dashboard (capacity & performance) |

**30-day free trial** — up to **5 employees**.

### Storage

| Rule | Detail |
|------|--------|
| Included | **1 GB per user** (`USER_STORAGE_QUOTA_BYTES` in `userStorageService.js`) |
| Company total | Employees × 1 GB (5 users = 5 GB, 10 = 10 GB, …) |
| Extra | **₹100 / GB / month** (purchased via kalpanik.in; cancel anytime) |
| What counts | Chats, task proofs, images, videos, PDFs, voice notes, profile docs |
| When full | New uploads are blocked until files are deleted or extra storage is purchased |
| UI | Settings storage page; Manage employees shows used / quota per person |

### How renewal works

1. Owner opens **View plans** (trial banner, trial popup, or Owner dashboard).
2. **Renew this plan** / **Renew on kalpanik.in** calls `GET /api/company/renewal-context` and opens:

   `https://kalpanik.in/renew?instance=TM-ACS&site=…&company=…&email=…&gstin=…&address=…&state=…&users=12&trialEnd=YYYY-MM-DD&plan=task_attendance&months=1&source=task_manager`

3. kalpanik.in generates a **proper bill** and a **dynamic UPI QR** (`upi://pay?pa=…&am=…&tn=<invoiceNo>`).
4. After payment is marked paid, operators extend `COMPANY_TRIAL_END` on that VPS instance (or a future activate webhook).

Canonical plan IDs in code: `task_management`, `task_attendance` (`client/src/pricingPlans.js`). Keep `pricing.png` and kalpanik.in in sync with those prices.

### Static UI vs API (nginx)

| Pattern | Sites | Deploy note |
|---------|-------|-------------|
| Proxy everything to Node | e.g. main sugandhshoppee, safari | `npm run build` + `pm2 restart` is enough |
| Static `root /var/www/...` + API proxy | e.g. **ensens**, edunest, some ACS/TACS setups | Also **`rsync client/dist` → `/var/www/<site>/`** or UI stays old |

### Android companion

Separate Android Studio project (`SugandhReminder`), same REST API and session cookies. Publish APK via `npm run sync-apk` → `client/public/downloads/sugandh-reminder.apk` → build client → deploy (and rsync www if needed). Employees download from Profile / announcements.

---

## Product description for legal documents

Use this section as the factual basis for **Terms of Service**, **Privacy Policy**, and (if needed) **employee location / workplace monitoring** notices.

### What the product is

Kalpanik Task Manager is a **B2B / employer-operated** SaaS-style application hosted per customer (or per brand site). It helps an organization:

- Create **lists** (projects / sites / departments) and assign tasks to employees (including recurring tasks, due dates, priorities, duration, and reminders)
- Review every open task in one place via **All Tasks** (sorted by nearest deadline), with filters for **list**, **employee (assignee)**, **deadline date**, and **overdue severity**
- Show per-row **list name** and **assignee name** badges on All Tasks (or **Unassigned** when nobody is assigned)
- Color-code overdue tasks by how late they are (**1–2 days**, **3–5 days**, **6+ days**) on admin and employee tables
- Attach instructions (images, video, PDF, voice notes)
- Collect completion notes and **proof files** (photos, videos, PDFs); allow employees to **update submissions** or admins to **reopen** completed work for resubmission
- Track progress updates and task delegation between colleagues
- Communicate via **team chat** (direct messages and groups, including file attachments and voice-to-text)
- Require and monitor **live GPS location / attendance** for employees (when enabled for that company)
- Run **geofenced daily check-in / check-out** at defined work locations (when attendance is enabled)
- Handle **deadline extension requests** when tasks are critically overdue (6+ days)
- Send **push notifications** and **email OTPs** for security and reminders
- View **reports** and (for company owners) **work capacity and performance** dashboards
- Maintain **company profile** (GST, certificate, director and contact details)
- Store **employee profile photo and ID proof** documents
- Optionally run a **free trial** period per company instance, then **renew a paid plan** on kalpanik.in (bill + UPI QR)
- Store **per-user file storage quotas** (1 GB included) and allow admins to **delete employees** (account removed; they cannot log in)
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
| **Web app** | Browser SPA (desktop and mobile browsers). Session cookie authentication. Installable PWA with hostname-based branding |
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
- **Android CAPTCHA bypass** — Kalpanik Reminder may skip Turnstile when the request identifies as the Android client (`X-Kalpanik-Client: SugandhReminder-Android` or User-Agent containing `in.kalpanik.sugandhreminder`). Web browsers still require Turnstile when configured.
- **Admin delete employee** — company admins/owners can permanently delete a non-owner employee from **Manage employees**. The user row is removed from the database and they **cannot log in**. Company owners cannot be deleted until owner access is revoked. Employees cannot delete their own account from this screen.

### Company trial

Per-instance optional **free trial** via `COMPANY_TRIAL_START` / `COMPANY_TRIAL_END` in that site’s `server/.env` (synced into `CompanySettings` on restart). UI shows trial banners, a **View plans** modal, and **Renew on kalpanik.in**. After expiry, continued use is restricted until the plan is renewed (kalpanik.in bill + UPI QR, then trial end date updated on the VPS). See [Plans, billing & storage](#plans-billing--storage).

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
| Phone number | Yes | Collected at registration; editable in profile |
| Password | Hash only | bcrypt; not recoverable as plaintext |
| Admin flag (`isAdmin`) | Yes | Controls admin dashboard access |
| Company owner flag (`isOwner`) | Yes | Max **2** owners; Owner dashboard + owner management |
| Salary (integer) | Yes | Default value exists; **admins can set/edit** employee salary for reporting/capacity context |
| Profile photo | Yes (disk) | Optional; JPEG/PNG/WebP |
| ID proof document | Yes (disk) | Optional; PDF or image |
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
| Due dates, timezones, recurrence, priority, duration, reminder-before | Yes | Admins/owners; assignees |
| Assignment lists and assignee links | Yes | Admins/owners; relevant employees |
| Progress updates (type + message) | Yes | Admins/owners; relevant employees |
| Delegation history (from → to) | Yes | Related users / admins |
| Submission text / notes | Yes | Admins/owners; assignee |
| Completion proof files (images, video, PDF) | Yes (disk) | Admins/owners; assignee |
| **Archived submissions** (previous proof + text after reopen or resubmit) | Yes | Admins/owners; assignee |
| Assignment attachments (images, video, PDF, voice) | Yes (disk) | Admins/owners; assignees |
| Deadline extension requests (requested/approved, new due date) | Yes | Employee; admins |

### D. Live location & attendance (sensitive)

When live location is **required** for the company (default: **on**):

| Data | Stored? | Notes |
|------|---------|--------|
| Location consent timestamp | Yes | Employee must consent / share location |
| Tracking enabled flag | Yes | Employee can turn tracking off in Settings (admins notified; tasks may be blocked until on again) |
| GPS pings: latitude, longitude, accuracy, time | Yes | Precise location required (approximate rejected; accuracy must be ≤ ~150 m) |
| Off-period history (when tracking was off) | Yes | Start/end times and reason |
| Reverse-geocoded area / city labels | Derived | Via Google Geocoding for admin map UI |

When **daily attendance** is enabled:

| Data | Stored? | Notes |
|------|---------|--------|
| Work locations (name, lat/lng, radius) | Yes | Admin-managed geofence sites |
| Check-in / check-out events | Yes | GPS at time of check, distance to nearest site, within-radius flag |
| Timing status | Yes | `on_time`, `late`, `early` vs company schedule |
| Daily check-in / check-out schedule | Yes | Company settings (HH:mm) |

**Who sees location:** company **admins** (Attendance live map, daily reports, employee cards, history). Employees see their own gate/status and attendance history.

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

### F. Company profile (owners)

| Data | Stored? | Notes |
|------|---------|--------|
| Company name, address, state | Yes | Indian state list |
| GST number | Yes | |
| GST certificate file | Yes (disk) | PDF or image, max 10 MB |
| Director name, phone, email, notes | Yes | |
| Second contact person name, phone, email | Yes | |

### G. Devices & notifications

| Data | Stored? | Notes |
|------|---------|--------|
| Web Push subscription (endpoint + keys) | Yes | Browser push |
| Android device ID, FCM token, platform, app version, last seen | Yes | Kalpanik Reminder |
| Reminder delivery logs | Yes | Task/user/slot/channel/status |

### H. Company settings

| Data | Stored? | Notes |
|------|---------|--------|
| Trial start / end dates | Yes | Optional per instance |
| Live location required (boolean) | Yes | Company-wide gate for employees |
| Attendance enabled (boolean) | Yes | Enables geofenced check-in/out |
| Daily check-in / check-out times | Yes | HH:mm schedule |
| Per-user storage usage | Derived | 1 GB quota; proofs, chat, profile files |

### I. Support messages

| Data | Processed? | Notes |
|------|------------|--------|
| Subject, message body | Emailed to support | Not necessarily stored in MySQL |
| User email, display name, app version | Included in support email | |

### J. Translation

| Data | Processed? | Notes |
|------|------------|--------|
| Task titles, descriptions, chat snippets | Sent to translation APIs | `POST /api/translate` uses **MyMemory** and/or **Google** translation fallbacks so UI can show content in EN / HI / MR / TA |

Privacy Policy should disclose that **user-generated text may be sent to third-party translation providers** when a user uses translation features.

### K. Client-side storage (not server)

| Data | Stored? | Notes |
|------|---------|--------|
| Postpone grace timestamps | Yes (`localStorage`) | Persists 24h extension grace across browser visits per task |
| Theme, language, UI mode preferences | Yes | Browser localStorage |
| Announcement read state | Yes | localStorage |

### L. Data not collected by the product (current scope)

- Payment card numbers (card checkout is not in Task Manager; renewal uses **UPI QR on kalpanik.in**)
- Government ID documents (unless a user uploads them as profile ID proof or task/chat file — treat uploads as user-controlled content)
- Contacts, SMS, or call logs from the phone (unless the Android app’s OS permissions change — document app permissions separately in the Play/APK privacy form)

### Storage locations

| Store | Contents |
|-------|----------|
| **MySQL** (per instance) | Accounts, tasks, chat metadata/text, location pings, attendance checks, work locations, deadline extensions, preferences, devices, OTPs (hashed), company settings |
| **Server disk** `server/uploads/` | Completion proofs, assignment attachments, chat files, profile photos, ID proofs, GST certificates |
| **Server disk** `server/sessions/` | Session files |
| **User device** | Browser cookies/local preferences (theme, last UI mode, postpone grace); Android app local state + FCM token |

### Retention & deletion (product behavior today)

| Topic | Current product behavior |
|-------|--------------------------|
| Account self-delete | Employees **cannot** delete their own account in-app |
| Admin delete employee | Admins/owners can **delete** a non-owner employee (Manage employees). Lists/tasks they owned are reassigned to the acting admin; the user cannot log in |
| Admin revoke | Admin access can be revoked; user account remains unless deleted |
| Owner revoke | Owner flag can be removed (not last owner; not self). Owners cannot be deleted until revoked |
| Cascades | Deleting a user removes related assignee/chat/device rows; list ownership and task authorship are reassigned so company work is not wiped |
| Files | Profile docs are removed on delete; other uploads remain until operators clean storage |

Privacy Policy should state how users request deletion (e.g. contact **support@kalpanik.in** or their company admin) and how long data is kept after employment ends.

---

## Roles & permissions

| Capability | Employee | Admin | Company owner |
|------------|:--------:|:-----:|:-------------:|
| Register / login | ✓ | ✓ | ✓ |
| View & complete assigned tasks | ✓ | ✓ (user view) | ✓ (user view) |
| Submit / update proof & progress | ✓ | ✓ | ✓ |
| Delegate tasks / create & assign for peers | ✓ | ✓ | ✓ |
| Request deadline extension (6+ days overdue) | ✓ | — | — |
| Team chat | ✓ | ✓ | ✓ |
| Live location (when required) | ✓ required | — | — |
| Geofenced check-in/out (when enabled) | ✓ | — | — |
| Upload profile photo & ID proof | ✓ | ✓ | ✓ |
| Create/edit lists & tasks | — | ✓ | ✓ |
| **All Tasks** aggregate view + filters | — | ✓ | ✓ |
| View all assignees / submissions / reopen assignees | — | ✓ | ✓ |
| Attendance live map, daily & monthly reports | — | ✓ | ✓ |
| Approve deadline extensions | — | ✓ | ✓ |
| Reports | — | ✓ | ✓ |
| Manage admins (promote/revoke) | — | ✓ | ✓ |
| Manage employees (view profiles, edit salary, **delete employee**) | — | ✓ | ✓ |
| Manage work locations & attendance settings | — | ✓ | ✓ |
| Edit employee salary | — | ✓ | ✓ |
| Owner dashboard (capacity, performance) | — | — | ✓ |
| View plans & renew on kalpanik.in | — | ✓ | ✓ |
| Company profile (GST, contacts, certificate) | — | — | ✓ |
| Promote/revoke company owners (max 2) | — | — | ✓ |
| Download Android APK | ✓ | ✓ | ✓ |
| Contact support | ✓ | ✓ | ✓ |
| Privacy & Terms (in-app) | ✓ | ✓ | ✓ |

**Rules worth stating in Terms:**

- Registration creates an **employee** account only.
- **Admins** are appointed by existing admins (Manage Admin).
- **Company owners** are appointed only by existing owners; maximum **two** owners per instance; an owner cannot revoke themselves; the last owner cannot be revoked.
- Admins/owners can view **employee work data**, **chat they participate in**, **live location**, and **attendance records**.
- Employees must comply with company location and attendance policy when enabled; turning tracking off may **block task access** and **notify admins**.
- Misuse (false proofs, harassment in chat, unauthorized access) may result in account suspension by the company or Kalpanik.

---

## Features (complete)

### Authentication & onboarding

- **Sign in** — email + password, show/hide password
- **Register** — display name, email, phone (10 digits), password (minimum length enforced)
- **Cloudflare Turnstile** CAPTCHA on register and forgot-password (web); Android client may skip when headers match Kalpanik Reminder
- **Email OTP** — send, resend with countdown, 6-digit verify before account creation (Brevo; rate-limited)
- **Forgot password** — CAPTCHA → OTP → verify → set new password (generic success if email unknown)
- **Trial gate** — login/register may be blocked when the company free trial has expired
- **Session expiry** — toast + redirect to auth
- **Account view picker** (admins) — choose Admin dashboard vs My tasks on login; preference saved in localStorage
- **Switch view anytime** — Profile → Switch to admin view / Switch to user view (`POST /api/auth/switch-role`)

### Admin dashboard (website)

#### Navigation & shell

- **Create Task** shortcut
- **Messages** — team chat offcanvas
- **Reports** — org analytics
- **Attendance** — live map + daily/monthly reports (when company settings allow)
- **Deadline extensions** — pending postpone requests with nav badge count (polls ~30s)
- **Your Lists** — create, rename (double-click), delete, pin/unpin (hold-to-pin), drag reorder
- **Employee assignments** — system list (pinned) for peer-delegated tasks
- **All Tasks** — virtual nav item under Your Lists; aggregates every list’s tasks sorted by **nearest deadline** (see [All Tasks view](#all-tasks-view))
- **Mobile offcanvas** sidebar (scrollable nav so long list names stay usable)
- **Trial banner** — days remaining / expired, with **View plans** and **Renew on kalpanik.in** (owners/admins)
- **Theme toggle** — light / dark
- **Language selector** — EN / HI / MR / TA
- **Notifications bell** — product announcements + unread badge
- **Profile menu** — Owner dashboard, Settings, Contact us, Sign out
- **Instant list navigation** — cached task sets + background refresh so switching lists feels immediate
- **Owner auto-sync** — background task refresh (~12s) while the dashboard is open

#### Task dashboard (per list)

- **KPI filter cards** — **Active** → **In Progress** → **Submitted** (employee finished, awaiting owner) → **Reviewed** (owner marked completed)
- **Mark as reviewed** — text action on expanded submitted tasks; sets `completed: true` and rolls recurring series
- **Task table** — type icon, title, deadline, recurrence, expandable rows, drag handle
- **High-priority tasks** — red styling, pinned toward the top of the list
- **Overdue row coloring** — full-row backgrounds by days overdue (see [Overdue color coding](#overdue-color-coding))
- **Overdue color legend & Show filter** — on normal lists: intro text + clickable color swatches + **Show** dropdown (All / 1–2 / 3–5 / 6+)
- **Drag-to-reorder** active incomplete tasks within a list
- **Empty states** per filter and list type

#### Per-task admin actions

- **Expand row panel** — description, duration, assignment attachments, per-assignee progress cards, delegation history
- **Edit / delete task** (confirm on delete)
- **Mark assignees done** modal — search employees, mark individual assignees submitted
- **View submission** — current and archived (previous) submissions per assignee
- **Reassign / reopen** — reopen a submitted assignee so they can resubmit; archives prior submission; push notifies employee
- **View progress updates** — per assignee or all activity; unread dot until expanded (auto mark-read)
- **View assignment attachments** — images, video, PDF, voice playback (authenticated blob URLs)
- **Clear completed** — bulk clear completed tasks in a list
- **Move task** to another list from edit modal

#### Task create/edit modal

- Title, description (rich reader modal)
- Due date/time, all-day toggle, timezone, **high priority** flag
- **Duration** — minutes / hours / days (for capacity planning)
- **Reminder before deadline** — optional: 30 min, 1 h, 2 h, 4 h, 1 day, 2 days, 3 days
- **Recurrence** — none, daily, weekly, monthly, yearly, **custom** (interval, end never / on date / after N occurrences)
- **Assignment attachments** — upload files, **record voice note** in-browser (max 30 per task)
- **Assignee picker** — search, multi-select chips, monthly minute budget hints per employee
- Move task to another list
- Save / delete

### Company owner only

- **Owner dashboard** (Profile → Owner dashboard) — trial card with **View plans / Renew**, monthly work capacity, employee performance, tasks-by-admin breakdown
- **Plans & billing** — in-app pricing modal (₹299 / ₹349) and redirect to kalpanik.in/renew with company context
- **Company profile** — name, address, state, GST, certificate, director & second contact (Settings → My company details)
- **Manage company owners** — promote/revoke owners (admins only; max 2)

### Settings (admin / owner)

- **My profile** — edit name, phone; view email; salary; profile photo & ID proof upload
- **My company details** (owners) — company profile page
- **Theme toggle**
- **Privacy & Terms** — in-app legal modal + standalone HTML page
- **Manage admin** — promote/revoke admin (email notification via Brevo)
- **Manage employees** — team list with role badges, storage used/quota, **View profile**, **Delete** (cannot delete self or company owners)
- **Manage locations** — enable attendance, set daily schedule, CRUD geofenced work sites
- **Company attendance** toggle — enable/disable daily check-in feature
- **Company live location** toggle — require GPS for employees
- **Push notifications** toggle — Web Push subscribe/unsubscribe
- **Switch to user view**

### Employee dashboard (website)

#### Navigation & filters

- **Create & assign task** — assign work to a colleague
- **My work** — **Active**, **Submitted**, **All assigned** (KPI cards + sidebar, with counts)
  - **Active** — only open work (not submitted; no current proof/text). New recurring days after a roll stay here
  - **Submitted** — this occurrence finished (`assigneeDone` or current submission), awaiting owner review
  - **All assigned** — everything assigned to the employee
- **Assigned by me** — tasks delegated to others
- **My attendance** — check-in/out + history (when company attendance enabled)
- **Messages** — team chat

#### Task work

- **Location gate** — blocks app until precise GPS shared (when `liveLocationRequired`)
- **Critical overdue gate** — blocks app when any task is **6+ days overdue** and still open until submitted or extension requested (Postpone). Skips submitted, deleted, and completed work
- **24-hour postpone grace** — after requesting an extension, gate dismissed for that task for 24h (`localStorage` + server `expiresAt`)
- View **assignment attachments** (images, video, PDF, voice)
- **Progress updates** — Started, In progress, Blocked, Update
- **Submit** — notes + **up to 10 mixed files** (JPGs, PDFs ≤ 5 MB each, videos, audio; clipboard paste; preview); sets assignee done, keeps task `completed: false` until owner reviews
- **Update submission** — resubmit after already submitted (archives prior submission)
- **View / View previous submission**
- **Overdue badge** — “Overdue by X days” with the same color tiers as admin
- **Overdue legend & Show filter** — on Active / All assigned when applicable
- **Recurring tasks** — each due day is its own card after owner review

#### Employee settings & profile

- **Live location tracking** toggle (when required by company)
- **Enable Chrome reminders** — Web Push for due reminders
- **Download APK** — Kalpanik Reminder from profile menu
- **Play Store link** (if configured)
- **My profile** — name, phone, photo, ID proof
- **Switch to admin view** (if `isAdmin`)
- Contact us, Privacy & Terms, Sign out

### Cross-cutting UX

- **Toast notifications** — global bottom-right feedback
- **Dynamic content translation** — task titles, chat, announcements via API
- **Deep links** — `?openChat=`, `?openTask=`, `?openAttendance=1`, `?openDeadlineExtensions=1`, `?from=notify`
- **Service worker** — push handling, background navigation to tasks/chat/attendance/extensions
- **PWA** — installable, hostname-based app name, splash screen in standalone mode
- **Contact us modal** — authenticated support email to Kalpanik
- **HTTP compression** — gzip responses from the API for faster loads
- **DB query indexes** — list owner, task list+completed, assignee assigned-by indexes for All Tasks / dashboard performance

---

## All Tasks view

**Who:** Admin / company owner (admin dashboard)  
**Where:** Sidebar → under **Your Lists** → **All Tasks**  
**Purpose:** One screen for every open task across all lists, sorted by **nearest deadline first**.

### Loading & caching

- Primary API: `GET /api/tasks/owner-all` (single request for all lists owned by the session user)
- Fallback: if the bulk endpoint fails, the UI loads each list’s tasks in parallel via `GET /api/tasks/lists/:id`
- Client cache (`ownerTasksCache`) + sidebar navigation optimizations so revisiting All Tasks is fast
- Each task is stamped with `ownerAllTasksListId` / `ownerAllTasksListTitle` so row badges and the List filter work

### Filter bar (four columns)

| Control | Options | Behavior |
|---------|---------|----------|
| **List** | All lists + every list that has tasks in the aggregate | Filters by the task’s source list (project / site name) |
| **Employee** | All employees + unique **assignee display names** from loaded tasks | Filters tasks where that person is an assignee (not list titles) |
| **Deadline** | HTML date picker | Shows tasks due on that calendar day; clear the date to show all deadlines |
| **Show** | All tasks / 1–2 days overdue / 3–5 days overdue / 6+ days overdue | Same overdue tiers as the legend on regular lists |

Filters combine with **AND** logic. Empty filter result shows copy explaining how to clear List / Employee / Deadline / Show.

Leaving All Tasks for a normal list resets List / Employee / Deadline filters to **all**.

### Row badges (under task title)

| Badge | Content |
|-------|---------|
| **List** (teal pill) | Source list title (e.g. “Prince - Elite”) |
| **Employee** (purple pill) | Assignee name(s), comma-separated if multiple |
| **Unassigned** (red pill) | Shown when the task has **no assignees** |

Created timestamp and assignment-attachment badges still appear as on normal list rows. Expand / edit / mark-done / reopen behavior matches the rest of the admin dashboard.

### KPI cards on All Tasks

Same **Active / In Progress / Submitted / Reviewed** filters apply on top of the aggregate dataset.

---

## Overdue color coding

Tasks past their deadline (and not completed) get a **full-row highlight** on admin and employee tables.

| Days past deadline | Visual | Filter value |
|--------------------|--------|--------------|
| **1–2 days** | Amber / yellow row | `1-2` |
| **3–5 days** | Orange row | `3-5` |
| **6+ days** | Dark brown row | `6plus` |

### Legend & filter UX

- **Normal list view (admin)** — legend text (“Tasks past their deadline are highlighted”) + three clickable color swatches + **Show** dropdown  
- **All Tasks** — no legend strip; overdue filtering is only via the **Show** dropdown in the four-column filter bar  
- **Employee Active / relevant views** — overdue badge text plus matching row colors; Show filter when the overdue legend is shown  
- Clicking an already-active swatch clears the overdue filter back to **All**

### Priority vs overdue

- **High priority** uses red emphasis and sort boost on incomplete tasks  
- When a task is both high-priority and overdue, **overdue row coloring takes visual priority** on the table row (priority still affects sort/pinning)

### Critical overdue (6+)

Separately from row color, **6+ days overdue** incomplete assigned work triggers the employee **critical overdue gate** (submit or Postpone / deadline extension). See the next section.

---

## Deadline extensions & critical overdue gate

When an employee has a task **6 or more days overdue** and not yet submitted, the app shows a **full-screen critical overdue gate** (website and Android) that blocks other work until they either:

1. **Submit** the task with proof, or  
2. Tap **Postpone** to request a **deadline extension**

Gate **does not** apply when the task is already submitted, has current proof/text, is owner-reviewed (`completed`), or is missing / not assigned. If Postpone returns “not found” / “already submitted”, the gate stays dismissed (does not loop).

### Employee flow

- **Postpone** creates or refreshes a `TaskDeadlineExtensionRequest` on the server
- **24-hour grace period** — after requesting, the gate stays dismissed for 24 hours (web `localStorage` / Android SharedPreferences + server `expiresAt`)
- If grace expires without admin approval, the gate returns for the next overdue task
- After postpone, the gate advances to the **next** real 6+ day overdue task (if any)
- Pending extension info is attached on `GET /api/tasks/assigned`
- On submit or owner review, pending postpone for that task/assignee is set to **`cancelled`**

### Admin flow (Deadline extensions page)

- Sidebar → **Deadline extensions** (badge shows **actionable** pending count only; auto-polls ~30s)
- Stale pending rows (submitted / completed / no longer 6+ overdue) are auto-dismissed to `cancelled`
- Themed request cards: employee avatar, task name, overdue badge, deadline / requested / popup-return times
- **Review & approve** — modal to pick a **new deadline date**; updates task `dueAt` and marks request approved
- Push notification to admins on new request (`deadline_extension_request`, deep link `/?openDeadlineExtensions=1`)
- Empty / error / retry UI if dismiss migrate is missing — page must not stick on Loading forever

### APIs

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/api/deadline-extensions` | Employee — request postpone |
| `GET` | `/api/deadline-extensions` | Admin — list actionable pending requests |
| `POST` | `/api/deadline-extensions/:id/approve` | Admin — `{ newDueAt }` approve + update deadline |

---

## Attendance: live location & daily check-in

Two related but separate features, controlled in **Settings → Manage locations**:

| Feature | Setting | Purpose |
|---------|---------|---------|
| **Live location** | `liveLocationRequired` | Continuous GPS while website tab open; admin live map |
| **Daily attendance** | `attendanceEnabled` | Geofenced check-in / check-out at work locations |

### Employee — live location

1. **Location gate** on login blocks tasks until location shared (when required).
2. Must choose **Precise** location (approximate rejected; accuracy ≤ 150 m).
3. Live pings while tab open (`watchPosition` + ~45s interval).
4. **Settings → Live location tracking** — turn off with confirmation; admin notified; gate returns until on again.
5. Tracking **stops** when the browser tab is fully closed.

### Employee — daily check-in

1. Requires at least one **active work location** configured by admin.
2. **Check in** / **Check out** — must be within geofence radius of nearest site (Haversine distance).
3. One check-in and one check-out per calendar day.
4. Timing evaluated vs company `dailyCheckInTime` / `dailyCheckOutTime` → `on_time`, `late`, or `early`.
5. **My attendance** view — today’s status, proximity preview, 14-day history.
6. **Check-in/out reminder modals** — prompt every 15 min when eligible (check-in) or after scheduled checkout time.

### Admin — Attendance page

Three tabs (visibility depends on company settings):

| Tab | Features |
|-----|----------|
| **Live** | Google Maps (or Leaflet fallback), employee markers (Live/Off), click-to-focus, refresh (~5s poll), off-period history, reverse-geocoded area/city |
| **Daily** | Present/absent summary for selected date; per-employee check-in/out times, working minutes, timing badges |
| **Monthly report** | Month picker; working-day counts (Sundays excluded); attendance summary table |

Push to admins when employee turns tracking **off** or **on** (`?openAttendance=1`).

### Work locations (geofence)

- Admin: **Settings → Manage locations**
- Create/edit/delete sites: name, latitude, longitude, radius (10–5000 m), active flag
- Set **daily check-in / check-out schedule** (HH:mm)
- Toggle **company attendance** on/off

### APIs

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/api/attendance/status` | Employee — consent, tracking, app access gate |
| `POST` | `/api/attendance/consent` | Employee |
| `POST` | `/api/attendance/ping` | Employee `{ latitude, longitude, accuracy? }` |
| `PATCH` | `/api/attendance/tracking` | Employee `{ enabled }` |
| `GET` | `/api/attendance/live` | Admin |
| `GET` | `/api/attendance/employees/:userId/history` | Admin |
| `GET` | `/api/attendance/geocode` | Admin |
| `GET` | `/api/attendance/maps-config` | Admin |
| `GET` | `/api/attendance/check-status` | Employee — today + proximity |
| `POST` | `/api/attendance/check-in` | Employee — geofenced |
| `POST` | `/api/attendance/check-out` | Employee — geofenced |
| `GET` | `/api/attendance/my-history` | Employee — past days |
| `GET` | `/api/attendance/daily-report` | Admin `?date=YYYY-MM-DD` |
| `GET` | `/api/attendance/monthly-report` | Admin `?year=&month=` |
| `GET/POST/PATCH/DELETE` | `/api/attendance/work-locations[...]` | Admin CRUD; employees list active only |
| `GET/PATCH` | `/api/attendance/company-settings` | Admin toggles |
| `GET/PATCH` | `/api/attendance/daily-schedule` | Admin schedule times |

---

## Company profile, employees & work locations

### Company profile (owners only)

**Settings → My company details**

| Section | Fields |
|---------|--------|
| Company information | Name, address, Indian state, GST number |
| GST certificate | Upload PDF/image (max 10 MB), view, remove |
| Director | Name, phone, email, additional notes |
| Second contact | Name, phone, email |

- **Completion badge** — highlights incomplete sections; Settings shows incomplete indicator until all required fields + certificate are present
- Only **company owners** (`isOwner`) can edit; stored in `CompanySettings`

### Manage employees (admins & owners)

**Settings → Manage employees**

- List all team members with owner / admin / employee role badges and **storage used / 1 GB quota**
- Open **employee profile modal** — view name, email, phone, role, member since; edit **salary**
- **Delete** — permanently removes the user from the database (confirm dialog). They cannot log in again. Lists and tasks they owned are reassigned to the acting admin so company work is kept.
- Guards: cannot delete yourself; cannot delete a **company owner** (revoke owner first); only company owners can delete other admins; cannot delete the last admin
- API: `DELETE /api/users/:id`

### Manage locations (admins & owners)

**Settings → Manage locations**

- Toggle **company attendance** (daily check-in feature)
- Set **daily check-in** and **check-out** times
- Add / edit / delete **work locations** with map coordinates and radius
- Toggle **company live location** requirement (separate setting in admin Settings)

### User profile & documents (all users)

**Settings → My profile**

- Edit display name and phone; email read-only
- Salary visible (editable by admins on own profile; read-only hint for employees viewing others)
- **Profile photo** — upload JPEG/PNG/WebP, view, remove
- **ID proof** — upload PDF or image, view, remove
- Incomplete-docs badge on Settings until both optional docs uploaded (encouraged completion)

---

## Task lifecycle: submissions, reopen & recurrence

### Submission & proof

- Employee submits **notes** and/or **up to 10 files** in one go — mix photos (JPEG/PNG/GIF/WebP), **multiple PDFs** (5 MB each), videos, and audio
- Files stored as rows in `TaskSubmissionProof` (legacy first-file path kept on `TaskAssignee.completionProofPath`)
- Sets **`assigneeDone: true`**; task stays **`completed: false`** until owner **Mark as reviewed**
- Admins view submissions in expand panel or submission detail modal (gallery of images, video, PDF)
- Multi-assignee: each person keeps their own proof rows
- Progress updates support the same mixed-file attachments (up to 10)

### Employee update submission

- On **Submitted** tab, employee can **Update submission** without admin action
- Prior submission (text + proofs) is **archived** (`archivedSubmittedAt`, `lastSubmissionText`, archived proof rows)
- **View previous submission** shows archived copy

### Admin reopen / reassign

- Admin can **Reassign** (reopen) a submitted assignee from expand panel
- Archives current submission, clears `assigneeDone`, notifies employee via push (`task_reopened`)
- Employee sees task back in Active with **Update submission** / resubmit flow
- Admin can also **replace all assignees** via task edit (`assigneeIds`) — clears submissions
- Admin can manually toggle assignee done state (`assigneeSetDone`)
- Owner **Mark as reviewed** sets `completed: true` and triggers recurring roll when applicable

### Delegation & peer assignment

- Employee **delegates** task to colleague → moves to “Employee assignments” list, records `TaskDelegation`
- Employee **creates & assigns** new task to peer via dedicated flow
- Blocked if task already submitted or was delegated *to* the current user

### Recurrence

- Types: none, daily, weekly, monthly, yearly, **custom** (JSON rule)
- Custom supports: every N day/week/month/year; end never, on date, or after N occurrences
- **Spawn-per-occurrence:** after owner marks reviewed, server creates a **new open card** for the next `dueAt`; submission stays on the completed card
- Roll is **idempotent** — will not spawn a second card for the same series due day
- Startup **legacy backfill** only splits true old in-place rolls; never treats “awaiting owner review” as stuck (that used to duplicate cards on every PM2 restart)
- Cleanup: `DRY_RUN=1 node scripts/delete-duplicate-recurring-tasks.js` then run without dry-run to delete same-day duplicates
- Active tasks sorted by recurrence rank then created date

### Progress updates

Types: `started`, `in_progress`, `blocked`, `update`  
Admins see per-assignee threads with unread indicators; mark-read on expand. Progress updates (without submit) drive **In Progress** KPI for owners.

---

## Team chat

- **Offcanvas messenger** from sidebar (admin + employee)
- **DMs** — start from People tab; search threads
- **Groups** — admin creates; add/remove members; rename; delete
- **Compose** — text, file attachments (5 MB), **speech-to-text** (EN / HI / MR / TA via Web Speech API)
- **Message actions** — reply, forward (multi-select), copy, delete (own message or admin)
- **Media lightbox** — images, video, PDF
- **Live updates** — Server-Sent Events (SSE) with polling fallback
- **Typing indicators** — DM and group
- **Jump to date** in thread history
- **Unread badges** on threads and sidebar Messages link
- **Push** on new DM/group message (`chat_message`, `chat_group_message`)
- Deep link: `?openChat=conversationId`
- Content re-translated when UI language changes

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
| **kalpanik.in** | Kalpanik | Public site, plan selection, invoice, UPI QR renewal | Company name, email, user count, plan, trial end (query params from Task Manager) |
| **Hosting VPS / MySQL** | Kalpanik infrastructure | Application hosting | All application data for that instance |

Card/net-banking gateways (Razorpay, Paytm, Cashfree) are **not** integrated in Task Manager. Payment is **UPI QR** generated on kalpanik.in.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Vite 6, Bootstrap 5, Sass, SortableJS, Chart.js, Inter, Material Symbols / Bootstrap Icons |
| Maps | Google Maps JavaScript API + Geocoding API (attendance); Leaflet fallback |
| Backend | Node.js, Express, Zod, **compression** (gzip HTTP responses) |
| Database | MySQL 8+, Prisma ORM (**27** models) |
| Auth | `express-session` + file store (`taskmgr.sid`) |
| Email OTP | Brevo Transactional API |
| CAPTCHA | Cloudflare Turnstile (web; Android client may skip) |
| Browser push | `web-push` + VAPID |
| Android push | Firebase Cloud Messaging (FCM) |
| Chat realtime | Server-Sent Events (SSE) |
| Translation | `POST /api/translate` (MyMemory + Google fallback) |
| PWA | Web manifest (hostname-aware), service worker |
| Android app | Kotlin/Java — separate repo `SugandhReminder` (`in.kalpanik.sugandhreminder`) |

### Notable performance pieces

| Piece | Where | Purpose |
|-------|--------|---------|
| HTTP compression middleware | `server/src/index.js` | Faster JSON/HTML over the wire |
| `GET /api/tasks/owner-all` | Tasks routes | Single bulk load for All Tasks |
| Perf indexes migration `20260713120000_perf_query_indexes` | Prisma | Indexes on `TaskList(owner_id)`, `Task(list_id, completed)`, `task_assignee(assigned_by_user_id)` |
| Client task cache + nav busy flag | `client/src/main.js` | Instant list / All Tasks switching |

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
| `VAPID_*` | Browser Web Push (chat, task submit, location off/on, deadline extensions, task reopened) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Android FCM + scheduled reminders |
| `GOOGLE_MAPS_API_KEY` | Attendance live map + reverse geocode (area, city) |
| `APP_PUBLIC_URL` | Links in emails (e.g. `https://sugandhshoppee.kalpanik.in`) |
| `APP_TIMEZONE` | Default `Asia/Kolkata` (capacity month, reminders, attendance schedule) |
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
| `npm run dev:portfolio` | **Portfolio demo** UI only (in-memory dummy data, no API) |
| `npm run build:portfolio` | **Portfolio demo** static build → `client/dist` |
| `npm run sync-apk` | Copy Android APK → `client/public/downloads/sugandh-reminder.apk` |
| `npm run start` | Build client + start API (`NODE_ENV=production`) |
| `npm run deploy` | Install deps, `db:generate`, build — before VPS restart |

**Server** (`server/`): `dev`, `start`, `db:generate`, `db:migrate`, `db:migrate:deploy`, `db:seed`, `vapid:generate`

**Client** (`client/`): `dev`, `build`, `preview`, `dev:portfolio`, `build:portfolio`, `preview:portfolio`

### Portfolio demo mode (shareable static site)

Same UI as production, with in-memory dummy data. **Does not** call Firestore, MySQL, or the Express API. Refresh resets to the original sample dataset. Production commands (`npm run dev` / `npm run build`) are unchanged.

**Run locally** (client only — do not start the API):

```bash
npm run dev:portfolio
```

Open http://localhost:5173. You are auto-logged in as the demo owner (`owner@demo.kalpanik.in`). Logout, then sign in with **any** email/password (use a seed email like `guna@demo.kalpanik.in` to open that employee’s view).

**Build static files:**

```bash
npm run build:portfolio
```

Output: `client/dist`. Preview with `npm run preview:portfolio --prefix client`.

**Deploy a second site** (not the live ops VPS / sugandhshoppee instance):

1. Build with `npm run build:portfolio`.
2. Create a **new** Netlify or Vercel project pointed at `client/dist` (or drag-drop that folder). Do not reuse the production site.
3. Netlify: SPA fallback is already in `client/public/_redirects` (`/* → /index.html 200`).
4. Vercel: `client/public/vercel.json` is copied into `dist` (SPA rewrite).
5. **Netlify Drop zip on Windows:** do **not** use `Compress-Archive` (it stores backslash paths). From Git Bash or WSL:

```bash
cd client/dist
zip -r ../portfolio-demo.zip .
```

Or: `npm run zip:portfolio` from the repo root (writes `portfolio-demo.zip` with forward-slash paths).

No env secrets are required for the demo site. Push, email, analytics, and OTP are stubbed.

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

- **Company trial** card — start/end dates, days remaining, **View plans** and **Renew on kalpanik.in**
- **Monthly work capacity**
  - Select **month** → KPIs, chart, and tables reload for that month
  - Capacity uses due/start month so one-time and not-yet-started tasks do not inflate other months
  - Budget: 26 working days × 8 hours = **12,480 min** per employee
  - **Task breakdown**: choose an employee (default: none selected) to see only their tasks
- **Employee task performance**
  - Employee + Daily / Weekly / Monthly period
  - Chart: on time / late / pending
  - Detail list dropdown: **Late submissions** or **Pending**
- **Tasks allocated by admin** — per-admin stats with avatars + combined org total
- **Manage company owners** — promote/revoke (admins only; max 2)

### Reports (sidebar → Reports)

- Org overview KPIs — total, active, in review, completed, overdue, submissions, employees, lists
- Fully submitted (awaiting owner review) counts toward **completed**, not Active/Overdue
- **Task status** doughnut chart
- **Tasks by list** bar chart
- **Employee workload** bar chart
- **Employee performance** — stacked bar (on-time / late / pending) with period + employee filters
- Late / pending detail table
- Refresh button

---

## Android app (Kalpanik Reminder)

Separate project: `AndroidStudioProjects/SugandhReminder`  
Package: `in.kalpanik.sugandhreminder`

### What the app does

- Login with same email/password as website (shared session cookie API)
- **Today / Upcoming / Completed** sections aligned with website Active vs Submitted rules
- View assigned tasks, submit **mixed proof files** (photos + PDFs), progress updates, attachments
- **6+ day critical overdue gate** (`TaskOverdueGateActivity`) — Submit or Postpone; same API as web
- FCM reminders and alarms (same reminder slots as web); skips already-submitted work
- Device registration via `POST /api/push/devices/register`
- Attendance / check-in flows when enabled for that company
- Team chat parity where implemented
- **Forgot-password / CAPTCHA:** when the client sends `X-Kalpanik-Client: SugandhReminder-Android` (or UA contains `in.kalpanik.sugandhreminder`), the API may **skip Turnstile** so OTP reset works from the APK while the website still requires CAPTCHA

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
git add client/public/downloads/sugandh-reminder.apk client/src/adminAnnouncements.js
git commit -m "Update Kalpanik Reminder APK for employee download."
git push origin main
```

`npm run sync-apk` copies from the default Android debug path (override with `APK_SOURCE`).  
Vite copies `client/public/downloads/` into `client/dist/downloads/` on build.  
Add / refresh an **admin announcement** with Download APK so staff see the update.

### Users install the app

1. Open your deployed site and sign in as employee  
2. Profile menu → **Download app (APK)** or bell announcement  
3. Or direct link: **/downloads/sugandh-reminder.apk**  
4. Allow “Install unknown apps” if prompted  
5. If install is blocked, uninstall the old app first  
6. On sites with `/var/www` static root, deploy must **rsync `client/dist`** or the download stays old

Admins also get a **bell notification** with a **Download APK** action when a new build is published.

### Sideload via USB (dev)

```powershell
adb install -r "C:\Users\jayjo\AndroidStudioProjects\SugandhReminder\app\build\outputs\apk\debug\app-debug.apk"
```

---

## File uploads & limits

| Context | Photos / videos | PDF | Notes |
|---------|-----------------|-----|-------|
| **Task submission** (web + Android) | Mix photos/videos/audio | 5 MB each | **Up to 10 files total** (JPGs + PDFs together allowed) |
| **Assignment attachments** | Supported | Supported | Plus voice notes; max 30 per task |
| **Team chat** | 5 MB | 5 MB | Any file type |
| **Profile photo** | JPEG/PNG/WebP | — | User profile |
| **ID proof** | Image | 5 MB | User profile |
| **GST certificate** | Image | 10 MB | Company profile (owners) |

Storage:

- Proofs: `server/uploads/completion-proofs/`
- Assignment attachments: `server/uploads/task-assignment-attachments/`
- Chat: `server/uploads/chat/`
- Profile / company docs: `server/uploads/` (profile photos, ID proofs, GST certificates)

**Important:** Large uploads fail with **HTTP 413** if nginx `client_max_body_size` is too small. See [Nginx configuration](#nginx-configuration).

---

## Push notifications

### Notification types

| Trigger | Recipients | Deep link / action |
|---------|-----------|-------------------|
| Task submitted / completed | Admins | Open task |
| Task reopened / reassigned | Employee | `?from=notify` → task |
| Deadline extension request | Admins | `/?openDeadlineExtensions=1` |
| Location tracking off / on | Admins | `/?openAttendance=1` |
| Chat DM / group message | Recipients | `?openChat=` |
| Task due reminders | Assignees | Task reminder / alarm |
| Admin announcements | Admins | Attendance, Owner dashboard, APK, Legal |
| Test push | Self | `/api/push/test` or `/api/push/test-web` |

### Due reminder schedule

Server scheduler (~every 60s), deduped via `ReminderSent`:

| Slot | When |
|------|------|
| `before{N}` | N minutes before due (per-task `reminderBeforeMinutes`: 30 min – 3 days) |
| `followup1h` | 1 hour after due if not submitted |
| `followup6h` | 6 hours after due |
| `followup24h` | 24 hours after due |

Delivery: **FCM** (Android) and/or **Web Push** (browser). In-tab toast + optional browser notification for web.

### Setup

1. Admin → **Settings** → enable notifications  
2. Employee → **Enable Chrome reminders**  
3. Requires `VAPID_*` in `server/.env` (`npm run vapid:generate --prefix server`)  
4. Android requires `FIREBASE_SERVICE_ACCOUNT_PATH`

### In-app admin announcements

Bell icon lists product announcements (Privacy & Terms, overdue color tiers + APK, attendance, voice attachments, Owner dashboard filters, translation, chat reply/delete, team chat, APK download, etc.). Unread badge clears when panel opened. Read state in localStorage. Audience can be all users vs privileged/owner-only.

### Test FCM (browser console, logged in)

```javascript
fetch("/api/push/test", { method: "POST", credentials: "include" }).then((r) => r.json()).then(console.log);
```

---

## Internationalization

- UI strings: `client/src/locales/en.json`, `hi.json`, `mr.json`, `ta.json`
- Language selector in header (admin + employee)
- Language-change overlay during switch
- Dynamic content (task titles, descriptions, chat): `POST /api/translate` with `{ texts, to: "en"|"hi"|"mr"|"ta" }`
- Chat voice-to-text: EN / HI / MR / TA via Web Speech API
- Locale namespaces include: `app`, `language`, `common`, `auth`, `nav`, `owner`, `lists`, `employee`, `modals`, `profile`, `settings`, `tasks`, `contact`, `toast`, `empty`, `validation`, `chat`, `reports`, `notifications`, `legal`, `errors`, `reminders`, `attendance`, `deadlineExtensions`, `pricing`
- All Tasks filter labels (List / Employee / Deadline / Show) and overdue / **Unassigned** strings live under `owner.*` and `common.*`

---

## PWA, legal & support

### Progressive Web App

- **Installable** — manifest, icons, theme color, standalone display
- **Hostname-based branding** — app name varies by subdomain (e.g. `TM-SSPL`)
- **Splash screen** — Kalpanik logo in standalone mode until app ready
- **Service worker** — push subscribe, notification click routing, background alarms

### Legal

- **Privacy Policy & Terms** — full document in-app (`legalModal`) and at `/legal/privacy-terms.html`
- Accessible from Settings and notifications bell
- **Auto-prompt** on first login if legal announcement unread

### Contact support

- **Contact us** modal — subject + message → `POST /api/support/contact` → email to Kalpanik
- Pre-filled user email; optional app version included

---

## Project structure

```
Task Manager/
├── client/
│   ├── src/
│   │   ├── main.js                      # Admin + employee UI, All Tasks filters, overdue tiers, gates
│   │   ├── attendance.js                # Employee live location gate + tracking
│   │   ├── attendanceCheckIn.js         # Employee geofenced check-in/out
│   │   ├── attendanceCheckInReminder.js # Check-in/out reminder modals
│   │   ├── adminAttendance.js           # Admin live map + daily/monthly reports
│   │   ├── adminDeadlineExtensions.js   # Admin deadline extension approvals
│   │   ├── adminReports.js              # Reports + owner dashboard charts
│   │   ├── adminManageEmployees.js      # Manage employees (salary, delete)
│   │   ├── ownerPricing.js              # Plans modal + kalpanik.in renew
│   │   ├── pricingPlans.js              # Canonical ₹299 / ₹349 plan data
│   │   ├── adminManageLocations.js      # Work locations + attendance settings
│   │   ├── adminAnnouncements.js        # Admin/employee bell notifications
│   │   ├── adminSettings.js             # Settings page rows
│   │   ├── companyProfile.js            # Owner company profile form
│   │   ├── userProfileDocs.js           # Profile photo + ID proof uploads
│   │   ├── chat.js                      # Team chat (DM + groups, SSE)
│   │   ├── chatSpeechToText.js          # Voice-to-text for chat
│   │   ├── reminders.js                 # In-tab due reminders + push handler
│   │   ├── sw-register.js               # Web Push subscribe
│   │   ├── pwaBranding.js / pwaSplash.js
│   │   ├── legal/                       # Privacy & Terms modal + content
│   │   ├── i18n/                        # Locales + content translation
│   │   ├── locales/                     # en / hi / mr / ta JSON
│   │   └── scss/                        # Admin theme, overdue colors, All Tasks filters, chat, etc.
│   ├── public/
│   │   ├── downloads/sugandh-reminder.apk
│   │   ├── sw.js                        # Service worker (push + navigation)
│   │   ├── legal/privacy-terms.html
│   │   └── icons/
│   └── dist/                            # Build output (not in git)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma                # 27 models
│   │   └── migrations/                  # includes perf_query_indexes + feature migrations
│   ├── src/
│   │   ├── index.js                     # Express app, compression, static dist, session
│   │   ├── routes/                      # auth, lists, tasks (incl. owner-all), users, push, chat,
│   │   │                                # reports, attendance, deadline-extensions,
│   │   │                                # translate, support, company
│   │   ├── services/                    # attendance, geocode, FCM, notifications,
│   │   │                                # deadline extensions, task reopen, monthly minutes,
│   │   │                                # user storage quota (1 GB / user)
│   │   ├── middleware/
│   │   └── lib/                         # mail, otp, turnstile, push, recurrence,
│   │                                    # geofence, company profile, reminder scheduler
│   ├── uploads/
│   └── sessions/
├── scripts/sync-apk.mjs
├── deploy/                              # nginx helpers, diagnostics
├── DESIGN.md
└── package.json
```

---

## API overview

Base path: `/api`. Authenticated routes use session cookie (`credentials: "include"`).

| Area | Key endpoints |
|------|----------------|
| **Auth** | `POST /login`, `/register`, `/logout`, `GET /me`, `POST /switch-role`, forgot-password, Turnstile site key, OTP send/verify |
| **Lists** | `GET/POST /lists`, `PATCH /lists/:id`, pin, delete, reorder |
| **Tasks** | `GET /owner-all` (All Tasks bulk), `GET /assigned`, `/assigned-by-me`, `POST /employee-create`, `GET/POST /lists/:listId`, `PATCH /:id` (edit, reopen, reassign), `DELETE /:id`, move, reorder, clear-completed |
| **Task proofs & progress** | `POST /:id/completion-proof`, `GET /:id/submission`, progress-updates CRUD, `POST /:id/delegate` |
| **Assignment attachments** | `GET/POST/DELETE /tasks/:id/assignment-attachments[...]` |
| **Deadline extensions** | `POST /deadline-extensions`, `GET /deadline-extensions`, `POST /deadline-extensions/:id/approve` |
| **Attendance (live)** | `/attendance/status`, `/consent`, `/ping`, `/tracking`, `/live`, `/employees/:id/history`, `/geocode`, `/maps-config` |
| **Attendance (check-in)** | `/attendance/check-status`, `/check-in`, `/check-out`, `/my-history`, `/daily-report`, `/monthly-report` |
| **Work locations** | `GET/POST/PATCH/DELETE /attendance/work-locations[...]` |
| **Company settings** | `/attendance/company-settings`, `/attendance/daily-schedule` |
| **Users** | `/assignees`, `/team`, `/peers`, `/profile`, `PATCH /users/:id/profile`, `DELETE /users/:id` (delete employee), role, company-owner, photo/ID proof upload, `/storage`, `/storage/team` |
| **Reports** | `/reports/summary`, `/reports/employee-performance`, `/reports/owner-dashboard/summary?year=&month=` |
| **Company** | `GET/PATCH /company/profile`, GST certificate, `GET /company/trial`, `GET /company/renewal-context` (kalpanik.in prefill) |
| **Translate** | `POST /translate` |
| **Push** | VAPID key, subscribe, device register, test-web, test |
| **Chat** | contacts, threads, messages, groups, SSE `/chat/live`, attachments, typing, forward |
| **Support** | `POST /support/contact` |
| **Health** | `GET /health` |
| **PWA** | `GET /manifest.webmanifest` (hostname-aware) |

---

## Production deployment (VPS)

### Health check

```bash
curl -s http://localhost:3000/api/health
# Expect: "db":"connected"
```

### Deploy all company instances

```bash
for dir in Task_manager Task_manager_safari Task_manager_ss2n Task_manager_acs Task_manager_tacs Task_manager_ensens Task_manager_edunest; do
  [ -d ~/$dir ] || continue
  cd ~/$dir && git pull origin main
  npm install --prefix server
  npm run db:migrate:deploy --prefix server
  npm run db:generate --prefix server
  npm install --prefix client && npm run build --prefix client
done
pm2 restart taskmanager safari ss2n acs tacs ensens edunest
```

If a site uses nginx `root /var/www/<site>`, rsync `client/dist` after build (ensens, edunest). Start missing processes the same way as ensens, for example:

```bash
pm2 start src/index.js --name edunest --cwd /root/Task_manager_edunest/server
pm2 save
```

### Deploy one site only (example: ensens)

```bash
cd ~/Task_manager_ensens
git pull origin main
npm install --prefix server
npm run db:migrate:deploy --prefix server
npm run db:generate --prefix server
npm install --prefix client && npm run build --prefix client
# Required when nginx root is /var/www/ensens:
sudo rsync -a --delete ~/Task_manager_ensens/client/dist/ /var/www/ensens/
sudo nginx -t && sudo systemctl reload nginx
pm2 restart ensens
```

### Static `/var/www` sites

If `grep root /etc/nginx/sites-enabled/<site>` shows `/var/www/...`, always rsync after build:

```bash
sudo rsync -a --delete ~/Task_manager_ensens/client/dist/ /var/www/ensens/
sudo rsync -a --delete ~/Task_manager_edunest/client/dist/ /var/www/edunest/
# ss2n / acs / tacs if still on /var/www:
# sudo bash ~/Task_manager/deploy/sync-static-to-var-www.sh
```

### New / empty-history database (Prisma P3005)

If `migrate deploy` says **P3005 — schema is not empty** (tables exist, no `_prisma_migrations`):

```bash
cd ~/Task_manager_<site>/server
npx prisma db push
ls -1 prisma/migrations | while read name; do
  [ -d "prisma/migrations/$name" ] || continue
  npx prisma migrate resolve --applied "$name"
done
npx prisma migrate deploy
npm run db:generate
pm2 restart <pm2-name> --update-env
```

### Company trial dates

Edit that site’s `server/.env` (`COMPANY_TRIAL_START` / `COMPANY_TRIAL_END`), then:

```bash
pm2 restart <pm2-name> --update-env
```

To add N days on **all** sites (example: +7):

```bash
SITES=(
  "Task_manager|taskmanager"
  "Task_manager_safari|safari"
  "Task_manager_ss2n|ss2n"
  "Task_manager_acs|acs"
  "Task_manager_tacs|tacs"
  "Task_manager_ensens|ensens"
  "Task_manager_edunest|edunest"
)
for entry in "${SITES[@]}"; do
  dir="${entry%%|*}"
  name="${entry##*|}"
  envf="$HOME/$dir/server/.env"
  [ -f "$envf" ] || continue
  current=$(grep -E '^COMPANY_TRIAL_END=' "$envf" | tail -n1 | cut -d= -f2- | tr -d "\"'[:space:]")
  [ -n "$current" ] || continue
  new_end=$(date -d "$current + 7 days" +%F)
  sed -i "s/^COMPANY_TRIAL_END=.*/COMPANY_TRIAL_END=$new_end/" "$envf"
  echo "$dir: $current -> $new_end"
  pm2 restart "$name" --update-env
done
```

Examples: `deploy/company-trial-env.example`. Paid renewals on kalpanik.in should then be reflected by updating the same `COMPANY_TRIAL_END`.

### Deduplicate recurring cards (ops)

```bash
cd ~/Task_manager_<site>/server
DRY_RUN=1 node scripts/delete-duplicate-recurring-tasks.js
node scripts/delete-duplicate-recurring-tasks.js
```

### After pushing a new APK

Same deploy + build; APK lands in `client/dist/downloads/`. Rsync `/var/www` if that site uses static root.

`client/dist` is **not** in git — always run `npm run build` after `git pull`.

`npm run db:migrate:deploy` applies schema changes (including **perf indexes**). Skipping migrate can leave the app slow or broken after a pull.

### `server/.env` checklist (production)

```env
DATABASE_URL="mysql://USER:PASS@localhost:3306/taskmanager_ensens"
SESSION_SECRET="long-random-string"
COOKIE_SECURE=true
TRUST_PROXY=true
APP_PUBLIC_URL="https://ensens.kalpanik.in"
APP_TIMEZONE="Asia/Kolkata"

COMPANY_TRIAL_START=2026-07-01
COMPANY_TRIAL_END=2026-08-22

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
- Trial env wins over DB on restart — see [Architecture & product approach](#architecture--product-approach).

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
| `/etc/nginx/sites-enabled/ensens` | `ensens.kalpanik.in` | **`root /var/www/ensens`** — rsync after build |
| `/etc/nginx/sites-enabled/edunest` | `edunest.kalpanik.in` | **`root /var/www/edunest`** — rsync after build; API proxy `127.0.0.1:3015` |

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
| Old UI after deploy | `npm run build`; hard-refresh; if nginx `root /var/www/...`, **rsync `client/dist`** (ensens/edunest/etc.) |
| Prisma **P3005** schema not empty | Baseline: `db push` + `migrate resolve --applied` for each migration, then `migrate deploy` |
| Prisma **P3008** already applied | Migrations are already recorded — skip resolve; run `npx prisma migrate deploy` then `npx prisma db push` if columns are still missing |
| `archived_submitted_at` / P2022 missing column | History was marked applied without SQL. On that site: `npx prisma db push` then `pm2 restart <name> --update-env` |
| PM2 **edunest not found** | Start like ensens: `pm2 start src/index.js --name edunest --cwd /root/Task_manager_edunest/server` then `pm2 save` |
| Cannot submit multiple PDFs + photos | Deploy latest client + server — mixed files up to 10 are allowed |
| Delete employee missing | Deploy latest; only shown for non-owners; owners must revoke owner first |
| Renew / View plans missing | Deploy latest client; company owner session; opens kalpanik.in/renew |
| Duplicate recurring tasks | Same title + same due day: run `delete-duplicate-recurring-tasks.js`; different due days are normal |
| Submitted tasks in Active | Deploy latest client — Active excludes `assigneeDone` / current submission |
| Critical overdue gate loops after Postpone | Deploy latest web + Android; gone/submitted must keep gate dismissed |
| Deadline extensions stuck Loading | Deploy latest; cancel status migrate; page shows error/retry if dismiss fails |
| Trial still expired after date change | Edit that site’s `.env` `COMPANY_TRIAL_END`; `pm2 restart <name> --update-env` |
| Session lost on HTTP | `COOKIE_SECURE=false` in `.env` |
| `500` / health `db:error` | MySQL down, wrong `DATABASE_URL`, or run `db:migrate:deploy` |
| No OTP email | Brevo keys / verified sender; dev: read API console |
| Turnstile fails | Add site hostname in Cloudflare Turnstile |
| Admin push not received | Enable notifications; set VAPID keys |
| Location gate / no GPS | HTTPS required (except localhost); choose **Precise** not Approximate |
| Attendance map blank | Set `GOOGLE_MAPS_API_KEY`; enable Maps JS + Geocoding APIs |
| Check-in fails “outside location” | Verify work location coordinates/radius; employee must be within geofence |
| Attendance tab missing | Enable company attendance in Manage locations |
| Month capacity same for all months | Deploy latest server (`employeeMonthlyMinutes`); one-time tasks only count in due month |
| Admin voice note silent | Deploy latest client; playback uses authenticated blob URLs |
| Assignment attachment 403 | User must be assignee or admin (`isAdmin` / owner session) |
| Owner dashboard missing | User needs `isOwner`; log out/in after promote; max 2 owners |
| Company profile not saving | User must be `isOwner`; complete required fields |
| Critical overdue gate won’t dismiss | Submit task or request extension; grace is 24h per request |
| All Tasks missing / slow | Rebuild client; run `db:migrate:deploy` (perf indexes); confirm `GET /api/tasks/owner-all` |
| All Tasks Employee filter wrong | Latest client lists **assignee names**, not list titles; List filter is separate |
| Unassigned not shown on All Tasks | Latest client shows red **Unassigned** pill when a task has no assignees |
| Deadline extensions page empty | No actionable pending requests (stale ones are cancelled) |
| Employee can’t update submission | Task must be in submitted state; deploy latest server |
| Reopen / resubmit not working | Admin uses Reassign on assignee card; employee gets `task_reopened` push |
| APK download 404 / old APK | `npm run sync-apk` + build; rsync `/var/www` if used; hard-refresh |
| nginx “conflicting server name” | Remove `*.bak*` from `sites-enabled/` |
| Prisma EPERM (Windows) | Stop dev server; rerun `db:generate` |
| Git push 403 wrong GitHub user | Per-repo credentials (`credential.useHttpPath`); sign in as repo owner |

### Confirm nginx is not blocking (should return 401, not 413)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://sugandhshoppee.kalpanik.in/api/tasks/test/completion-proof
```

---

## Related docs

- [DESIGN.md](./DESIGN.md) — architecture, topology, data flows
- [deploy/](./deploy/) — nginx helpers, diagnostics, static sync
- [pricing.png](./pricing.png) — canonical plan sheet (keep in sync with kalpanik.in and `client/src/pricingPlans.js`)
- [kalpanik.in](https://kalpanik.in/) — public site, plans, invoices, UPI renewal

---

## License

Private / educational use unless a license file is added.

---

## Disclaimer for legal drafting

This README describes **how the software works today**. It is **not** legal advice. Have a qualified lawyer draft and review your Terms of Service and Privacy Policy for your jurisdiction (including employment monitoring and location data rules). Update those documents whenever you add features that collect new data or change who can access it.
