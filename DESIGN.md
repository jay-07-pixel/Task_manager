# Task Manager — System Design

Architecture reference for **Kalpanik Task Manager**: admin/user task workflows, team chat, reminders, and Android companion app.

**Production example:** [https://sugandhshoppee.kalpanik.in](https://sugandhshoppee.kalpanik.in)

---

## Table of contents

1. [High-level overview](#1-high-level-overview)
2. [Production deployment topology](#2-production-deployment-topology)
3. [Monorepo structure](#3-monorepo-structure)
4. [Client architecture](#4-client-architecture)
5. [Server architecture](#5-server-architecture)
6. [Authentication & roles](#6-authentication--roles)
7. [Data model](#7-data-model)
8. [Task lifecycle](#8-task-lifecycle)
9. [Notifications](#9-notifications)
10. [Team chat](#10-team-chat)
11. [File storage](#11-file-storage)
12. [External services](#12-external-services)
13. [Request flow examples](#13-request-flow-examples)
14. [Environment & configuration](#14-environment--configuration)

---

## 1. High-level overview

The system is a **monolithic Node.js API** with a **Vite SPA** frontend. In production, **nginx** terminates HTTPS and proxies to **PM2-managed Express** processes. Each customer/site runs as an **isolated instance** (own folder, `.env`, MySQL database, PM2 process).

```mermaid
flowchart TB
  subgraph Clients["Clients"]
    AdminWeb["Admin dashboard<br/>(Browser PWA)"]
    UserWeb["User dashboard<br/>(Browser PWA)"]
    Android["Kalpanik Reminder<br/>(Android APK)"]
  end

  subgraph VPS["VPS (e.g. srv1711770)"]
    Nginx["nginx<br/>HTTPS + static + proxy"]
    PM2["PM2 process<br/>Node.js Express"]
    MySQL[("MySQL 8+<br/>localhost:3306")]
    FS["Local disk<br/>uploads/ + sessions/"]
  end

  subgraph External["External services"]
    Brevo["Brevo<br/>email OTP"]
    Turnstile["Cloudflare Turnstile<br/>CAPTCHA"]
    FCM["Firebase FCM<br/>Android push"]
    WebPush["Web Push<br/>(VAPID)"]
    Translate["MyMemory / Google<br/>translation API"]
  end

  AdminWeb --> Nginx
  UserWeb --> Nginx
  Android --> Nginx

  Nginx --> PM2
  PM2 --> MySQL
  PM2 --> FS

  PM2 --> Brevo
  PM2 --> Turnstile
  PM2 --> FCM
  PM2 --> WebPush
  PM2 --> Translate
```

### Design principles

| Principle | Implementation |
|-----------|----------------|
| Single codebase, multi-tenant by deployment | Same Git repo; separate VPS dirs + DB per site |
| Session auth | Cookie `taskmgr.sid`, file-backed session store |
| Dual UI mode | One user account; `isAdmin` + session `role` (`owner` / `employee`) |
| Realtime chat | SSE (not WebSockets); polling fallback on client |
| Uploads | Multer → local filesystem under `server/uploads/` |

---

## 2. Production deployment topology

Three live instances share one VPS and one GitHub repo. Each instance is fully isolated at the database layer.

```mermaid
flowchart LR
  subgraph Internet
    U1["Users<br/>sugandhshoppee.kalpanik.in"]
    U2["Users<br/>safari subdomain"]
    U3["Users<br/>ss2n.kalpanik.in"]
  end

  subgraph VPS
    NG["nginx<br/>sites-enabled/*"]

    subgraph Inst1["~/Task_manager"]
      P1["PM2: taskmanager"]
      DB1[("taskmanager")]
    end

    subgraph Inst2["~/Task_manager_safari"]
      P2["PM2: safari"]
      DB2[("taskmanager_safari")]
    end

    subgraph Inst3["~/Task_manager_ss2n"]
      P3["PM2: ss2n"]
      DB3[("taskmanager_ss2n")]
    end

    MYSQL["MySQL daemon<br/>127.0.0.1:3306"]
  end

  U1 --> NG
  U2 --> NG
  U3 --> NG

  NG --> P1
  NG --> P2
  NG --> P3

  P1 --> DB1
  P2 --> DB2
  P3 --> DB3

  DB1 --> MYSQL
  DB2 --> MYSQL
  DB3 --> MYSQL
```

| VPS directory | PM2 name | Typical domain | MySQL database |
|---------------|----------|----------------|----------------|
| `~/Task_manager` | `taskmanager` | `sugandhshoppee.kalpanik.in` | `taskmanager` |
| `~/Task_manager_safari` | `safari` | safari subdomain | `taskmanager_safari` |
| `~/Task_manager_ss2n` | `ss2n` | `ss2n.kalpanik.in` | `taskmanager_ss2n` |

**Deploy loop:** `git pull` → `npm install` → `prisma migrate deploy` → `client build` → `pm2 restart`.

---

## 3. Monorepo structure

```
Task Manager/
├── client/                 # Vite SPA (admin + user UI)
│   ├── src/
│   │   ├── main.js         # App shell, auth, admin/employee dashboards
│   │   ├── chat.js         # Team chat UI
│   │   ├── adminReports.js
│   │   ├── i18n/           # en, hi, mr
│   │   └── scss/
│   ├── public/
│   │   ├── sw.js           # Service worker (web push)
│   │   └── downloads/      # sugandh-reminder.apk
│   └── dist/               # Built assets (not in git)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── index.js        # Express bootstrap
│   │   ├── routes/         # REST API
│   │   ├── services/       # Push, chat notify, task completion notify
│   │   ├── middleware/     # auth, rate limits
│   │   └── lib/            # mail, otp, push, fcm, chat SSE, recurrence
│   ├── uploads/            # Proofs + chat attachments
│   └── sessions/           # express-session file store
├── deploy/                 # nginx helpers, migration recovery scripts
├── scripts/sync-apk.mjs
└── package.json            # Root: dev, build, deploy, sync-apk
```

```mermaid
flowchart TB
  subgraph Build["Build & run"]
    Root["package.json"]
    ClientBuild["client: vite build → dist/"]
    ServerStart["server: node src/index.js"]
    Root --> ClientBuild
    Root --> ServerStart
  end

  subgraph Runtime["Production runtime"]
    Express["Express"]
    Static["express.static(client/dist)"]
    API["/api/* routes"]
    Express --> Static
    Express --> API
  end

  ServerStart --> Express
  ClientBuild --> Static
```

---

## 4. Client architecture

Single SPA (`client/src/main.js`) renders either **admin (owner)** or **user (employee)** chrome based on `state.user.role` from `GET /api/auth/me`.

```mermaid
flowchart TB
  subgraph SPA["Vite SPA (main.js)"]
    Auth["Auth forms<br/>login / register / OTP"]
    Owner["Admin dashboard<br/>lists, tasks, reports, owner dashboard"]
    Employee["User dashboard<br/>assigned tasks, submit, delegate"]
    Chat["chat.js<br/>DMs, groups, forward, reply"]
    SW["sw.js + sw-register.js<br/>web push"]
    I18n["i18n en/hi/mr<br/>+ content translate API"]
  end

  Auth -->|session cookie| Owner
  Auth -->|session cookie| Employee
  Owner --> Chat
  Employee --> Chat
  Owner --> SW
  Employee --> SW
  Owner --> I18n
  Employee --> I18n
```

| Module | Responsibility |
|--------|----------------|
| `main.js` | Routing by role, task CRUD UI, modals, profile menu, team admin |
| `chat.js` | Threads, messages, SSE live updates, attachments, forward |
| `adminReports.js` | Charts, late submissions, employee performance |
| `reminders.js` | Browser reminder UX (with service worker) |
| `i18n/` | Static UI strings; dynamic task/chat text via `/api/translate` |

**Tech:** Vite 6, Bootstrap 5, Sass, SortableJS, Material Symbols.

---

## 5. Server architecture

Express app mounts REST routers under `/api`. In production it also serves the built SPA.

```mermaid
flowchart TB
  subgraph Express["Express (server/src/index.js)"]
    MW["Middleware<br/>cors, json, cookie-parser, session"]
    RAuth["/api/auth"]
    RUsers["/api/users"]
    RLists["/api/lists"]
    RTasks["/api/tasks"]
    RPush["/api/push"]
    RChat["/api/chat"]
    RReports["/api/reports"]
    RTranslate["/api/translate"]
    RSupport["/api/support"]
    Health["/api/health"]
    Static["Static: client/dist"]
  end

  subgraph Background["Background jobs"]
    Scheduler["reminderScheduler.js<br/>every ~60s"]
    Backfill["recurringLegacyBackfill"]
  end

  MW --> RAuth & RUsers & RLists & RTasks & RPush & RChat & RReports & RTranslate & RSupport & Health & Static
  Scheduler --> RPush
  Scheduler --> FCMExt["FCM service"]
```

### API route map

| Prefix | File | Auth | Purpose |
|--------|------|------|---------|
| `/api/auth` | `routes/auth.js` | Mixed | Login, register, OTP, forgot password, `/me`, switch-role |
| `/api/users` | `routes/users.js` | Auth / Owner | Peers, assignees, team admin, **profile + salary** |
| `/api/lists` | `routes/lists.js` | Owner | Task lists CRUD, reorder, pin |
| `/api/tasks` | `routes/tasks.js` | Auth | Tasks, proofs, progress, delegation, assigned view |
| `/api/push` | `routes/push.js` | Auth | VAPID, web push subscribe, FCM device register |
| `/api/chat` | `routes/chat.js` | Auth | Conversations, groups, messages, forward, SSE live |
| `/api/reports` | `routes/reports.js` | Owner | Summary, performance, owner dashboard |
| `/api/translate` | `routes/translate.js` | Auth | Content translation |
| `/api/support` | `routes/support.js` | Public | Contact form |

**ORM:** Prisma → MySQL. **Validation:** Zod on request bodies.

---

## 6. Authentication & roles

```mermaid
sequenceDiagram
  participant U as User browser
  participant T as Turnstile
  participant API as Express /api/auth
  participant B as Brevo
  participant DB as MySQL

  Note over U,DB: Registration
  U->>T: Complete CAPTCHA
  U->>API: POST /send-otp { email, turnstileToken }
  API->>B: Send 6-digit OTP
  U->>API: POST /verify-otp
  U->>API: POST /register { name, phone, password }
  API->>DB: INSERT User (role=employee, isAdmin=false)

  Note over U,DB: Login
  U->>API: POST /login
  API->>DB: Verify password
  API->>U: Set-Cookie taskmgr.sid

  Note over U,DB: Admin dual view
  U->>API: POST /switch-role { role: owner|employee }
  API->>U: Updated session role (requires isAdmin)
```

| Concept | Storage | Notes |
|---------|---------|-------|
| Password | `User.password_hash` (bcrypt) | |
| Admin flag | `User.isAdmin` | Promoted via Manage Admin; legacy `role=owner` also honored |
| Active UI | `req.session.role` | `owner` = admin dashboard, `employee` = user dashboard |
| Session | File store in `server/sessions/` | Long-lived (~10 years default), `httpOnly` cookie |

**Middleware:**
- `requireAuth` — any logged-in user
- `requireOwner` — session role `owner` + `userHasAdminAccess()`

---

## 7. Data model

Core entities (Prisma). Table name for users is **`User`** (PascalCase in MySQL).

```mermaid
erDiagram
  User ||--o{ TaskList : owns
  User ||--o{ Task : creates
  User ||--o{ TaskAssignee : assigned
  Task ||--o{ TaskAssignee : has
  Task ||--o{ TaskProgressUpdate : has
  Task ||--o{ TaskSubmissionProof : has
  TaskList ||--o{ Task : contains
  Task ||--o| Task : parent_subtask

  User ||--o{ ChatConversation : participates
  User ||--o{ ChatMessage : sends
  ChatConversation ||--o{ ChatMessage : contains
  ChatMessage ||--o| ChatMessage : replyTo

  User ||--o{ ChatGroupMember : member
  ChatGroup ||--o{ ChatGroupMember : has
  ChatGroup ||--o{ ChatGroupMessage : has

  User ||--o{ PushSubscription : web_push
  User ||--o{ EmployeeDevice : fcm

  User {
    uuid id PK
    string email UK
    string display_name
    string phone
    enum role
    bool is_admin
    int salary
  }

  Task {
    uuid id PK
    uuid list_id FK
    string title
    datetime due_at
    enum recurrence
    bool completed
    bool high_priority
  }

  TaskAssignee {
    uuid task_id FK
    uuid user_id FK
    string completion_proof_path
    datetime last_submitted_at
  }

  ChatMessage {
    uuid id PK
    string body
    string attachment_path
    string forwarded_from_name
    uuid reply_to_message_id FK
  }
```

### Notable fields

| Model | Field | Purpose |
|-------|-------|---------|
| `User` | `isAdmin` | Admin access without losing employee role |
| `User` | `salary` | Default 15000; editable by admin only |
| `TaskAssignee` | per-row proof | Multi-assignee completion tracking |
| `ChatMessage` | `forwardedFromName` | Forward metadata |
| `ReminderSent` | composite key | Dedup web/FCM reminder slots |

---

## 8. Task lifecycle

```mermaid
stateDiagram-v2
  [*] --> Active: Admin creates task + assignees
  Active --> InProgress: Employee posts progress update
  Active --> Submitted: Employee uploads proof / marks done
  InProgress --> Submitted: Employee submits
  Submitted --> Active: Admin reopens / new recurrence spawns
  Submitted --> Completed: Admin marks assignee(s) done
  Completed --> Active: Recurring task rolls to next instance
  Active --> Overdue: due_at passed (UI badge only)
```

**Recurrence:** Server logic in `lib/recurringLegacyBackfill.js` and task routes spawns next instance when a recurring task is completed.

**Submission files:** `POST /api/tasks/:id/completion-proof` → `server/uploads/completion-proofs/`.

---

## 9. Notifications

```mermaid
flowchart TB
  subgraph Triggers
    Due["Task due approaching / overdue<br/>reminderScheduler.js"]
    Submit["Employee submits task<br/>taskCompletionNotificationService.js"]
    ChatMsg["New chat message<br/>chatNotificationService.js"]
  end

  subgraph Channels
    VAPID["Web Push (VAPID)<br/>lib/push.js"]
    FCM["Firebase FCM<br/>services/fcmPushService.js"]
    SW["Service Worker sw.js"]
    AndroidN["Android notification"]
  end

  Due --> VAPID
  Due --> FCM
  Submit --> VAPID
  ChatMsg --> VAPID

  VAPID --> SW
  FCM --> AndroidN
```

| Event | Who receives | Channel |
|-------|--------------|---------|
| 10 min before due | Assignee | Web push + FCM |
| 1h / 6h / 24h after due (missed) | Assignee | Web push + FCM |
| Task submitted/completed | All admins | Web push |
| Chat message | Thread participants | Web push |

**Dedup:** `ReminderSent` table prevents duplicate sends per `(task, user, dueAt, slot, channel)`.

---

## 10. Team chat

```mermaid
sequenceDiagram
  participant A as Client A
  participant API as /api/chat
  participant SSE as chatLive.js (in-memory)
  participant B as Client B

  A->>API: POST /conversations/:id/messages
  API->>API: Save ChatMessage + optional file
  API->>SSE: publishChatLive([recipient, sender])
  SSE-->>B: SSE data: { kind: message, ... }
  API->>B: Web push (if subscribed)

  A->>API: GET /chat/live (EventSource)
  Note over A,SSE: Long-lived SSE connection per user
```

| Feature | Implementation |
|---------|----------------|
| DMs | `ChatConversation` (canonical user pair) |
| Groups | `ChatGroup` + `ChatGroupMember` |
| Reply | `replyToMessageId` |
| Forward | `POST /api/chat/forward` + `forwardedFromName` |
| Delete | Soft delete (`deletedAt`), 30 min window for users |
| Live updates | SSE `/api/chat/live` + 3s polling fallback |
| Attachments | 5 MB max → `server/uploads/chat/` |
| Typing | In-memory `chatTyping.js` + SSE |

**nginx:** SSE requires `proxy_buffering off` on `/api/` (see `deploy/patch-nginx-all-sites.sh`).

---

## 11. File storage

All uploads are **local filesystem** on the VPS (not S3).

```mermaid
flowchart LR
  subgraph Uploads["server/uploads/"]
    Proofs["completion-proofs/<br/>task submissions"]
    Chat["chat/<br/>message attachments"]
  end

  subgraph ServedBy
    TasksRoute["GET via tasks routes"]
    ChatRoute["GET /api/chat/files/dm|group/:messageId"]
  end

  Proofs --> TasksRoute
  Chat --> ChatRoute
```

| Type | Max size (app) | nginx note |
|------|----------------|------------|
| Task photos/videos | No app limit | Set `client_max_body_size 0` |
| Task PDF | 5 MB | |
| Chat files | 5 MB | |

---

## 12. External services

```mermaid
flowchart LR
  App["Express API"]

  App --> Brevo["Brevo<br/>OTP, password reset,<br/>admin promote/revoke email"]
  App --> Turnstile["Cloudflare Turnstile<br/>registration CAPTCHA"]
  App --> FCM["Firebase Admin SDK<br/>Android reminders + test push"]
  App --> VAPID["Web Push VAPID<br/>browser notifications"]
  App --> Translate["MyMemory + Google fallback<br/>POST /api/translate"]
```

| Service | Env vars | Used for |
|---------|----------|----------|
| Brevo | `BREVO_API_KEY`, sender name/email | Email OTP, admin emails |
| Turnstile | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Register CAPTCHA |
| Firebase | `FIREBASE_SERVICE_ACCOUNT_PATH` or `_JSON` | Android FCM |
| VAPID | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Browser push |

---

## 13. Request flow examples

### A. Employee submits task proof (web or Android)

```mermaid
sequenceDiagram
  participant C as Client
  participant N as nginx
  participant API as POST /api/tasks/:id/completion-proof
  participant FS as uploads/completion-proofs
  participant DB as MySQL
  participant Admins as Admin browsers

  C->>N: multipart/form-data (photos/videos/pdf)
  N->>API: proxy (body size limit!)
  API->>FS: multer write file(s)
  API->>DB: update TaskAssignee + proofs
  API->>Admins: web push (taskCompletionNotificationService)
  API->>C: 200 JSON
```

### B. Admin opens My profile

```mermaid
sequenceDiagram
  participant A as Admin browser
  participant API as /api/users/profile
  participant DB as User table

  A->>API: GET /profile (session cookie)
  API->>DB: SELECT displayName, email, phone, salary, ...
  API->>A: profile JSON (salary editable if admin view)

  A->>API: PATCH /profile { displayName, phone, salary }
  API->>DB: UPDATE User
  Note over A,DB: Normal users: salary field rejected server-side
```

---

## 14. Environment & configuration

Each VPS instance has its own `server/.env`. Critical variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | `mysql://USER:PASS@localhost:3306/DATABASE` |
| `SESSION_SECRET` | Session signing |
| `COOKIE_SECURE` | `false` on HTTP VPS, `true` on HTTPS |
| `TRUST_PROXY` | `true` behind nginx |
| `APP_PUBLIC_URL` | Links in emails |
| `BREVO_*` | Transactional email |
| `TURNSTILE_*` | CAPTCHA |
| `VAPID_*` | Browser push |
| `FIREBASE_*` | Android push |

### Health check

```bash
curl -s http://localhost:3000/api/health
# { "ok": true, "db": "connected" }
```

### Android app (separate repo)

Package: `in.kalpanik.sugandhreminder`  
Uses the **same REST API** as the web user dashboard. APK is built locally, synced via `npm run sync-apk`, and served from `/downloads/sugandh-reminder.apk`.

---

## Related docs

- [README.md](./README.md) — setup, deploy commands, nginx, troubleshooting
- [server/prisma/schema.prisma](./server/prisma/schema.prisma) — full schema
- [deploy/](./deploy/) — nginx patches, migration recovery scripts

---

*Last updated to reflect: dual admin/user login, chat forward, My profile + salary, multi-VPS production layout.*
