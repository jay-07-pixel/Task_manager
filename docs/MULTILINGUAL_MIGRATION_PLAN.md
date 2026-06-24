# Multilingual Migration Plan — Task Manager Web App

## Stack note

The client is **Vanilla JavaScript + Vite** (not React). There is no React tree, so **`react-i18next` cannot be used**. Implementation uses **`i18next`** with the same key structure and behavior (localStorage, instant re-render on `languageChanged`).

## Target languages

| Code | Language |
|------|----------|
| `en` | English (default) |
| `hi` | Hindi (हिंदी) |
| `mr` | Marathi (मराठी) |

## New files

| Path | Purpose |
|------|---------|
| `client/src/i18n/index.js` | i18next init, `t()`, `changeLanguage()`, localStorage |
| `client/src/locales/en.json` | English strings |
| `client/src/locales/hi.json` | Hindi strings |
| `client/src/locales/mr.json` | Marathi strings |
| `client/src/i18n/languageSelector.js` | Header/auth language dropdown HTML + wiring |

## Files with user-facing text (must migrate)

### Primary (high volume)

| File | ~Lines | Content |
|------|--------|---------|
| `client/src/main.js` | 6,500+ | Auth, owner dashboard, employee dashboard, modals, toasts, sidebar, KPIs, tables, empty states, validation |
| `client/src/chat.js` | 2,200+ | Team chat UI, groups, messages, attachments, delete/reply/copy |

### Secondary

| File | Content |
|------|---------|
| `client/src/adminReports.js` | Reports page titles, chart labels, KPI cards |
| `client/src/adminAnnouncements.js` | Notification bell, announcement titles/bodies |
| `client/src/reminders.js` | In-tab reminder toasts (few strings) |

### Static / minimal

| File | Content |
|------|---------|
| `client/index.html` | `<title>`, `lang` attribute |
| `client/public/alarm.html` | Alarm page copy (optional) |

### Out of scope (not user-facing UI copy)

| Path | Reason |
|------|--------|
| `client/src/taskRecurrenceSort.js` | Sort logic only |
| `client/src/sw-register.js` | Service worker plumbing |
| `client/src/scss/**` | Styles only |
| `server/**` | API error messages stay English; client maps common errors where needed |

## Translation key structure

```text
common.*          — Close, Save, Cancel, Refresh, Delete, …
language.*        — English, हिंदी, मराठी, Language
auth.*            — Login, register, OTP, forgot password
nav.*             — Sidebar, Create Task, Your lists, Reports, Chat
dashboard.*       — Admin/employee dashboard headers, welcome
tasks.*           — Filters, table headers, recurrence, actions
lists.*           — New list, rename, pin, delete
employees.*       — Assignees, manage admin
chat.*            — Chat panel (delegated to chat.js keys)
reports.*         — Reports view
notifications.*   — Bell, announcements
settings.*        — Theme, profile menu, sign out
toast.*           — Toast messages
empty.*           — Empty states
validation.*      — Form validation messages
modal.*           — Shared modal labels
```

## UI integration points

1. **Auth page** — language selector in auth card footer (with theme toggles).
2. **Admin header** — `admin-dash-utilities` compact language dropdown.
3. **Employee header** — same pattern in employee dashboard utilities.
4. **Re-render** — `i18n.on('languageChanged')` → call `render()` to rebuild DOM without reload.

## Migration phases

1. Install `i18next`, create config + locale JSON files.
2. Add `languageSelector` to auth + headers.
3. Replace strings in `main.js` (auth → nav → owner → employee → modals → toasts).
4. Replace strings in `chat.js` via `deps.t`.
5. Replace strings in `adminReports.js`, `adminAnnouncements.js`, `reminders.js`.
6. Update `index.html` title via `document.title = t('app.title')`.
7. `npm run build` — verify no errors.

## Persistence

- Key: `task-manager-lang`
- Values: `en` | `hi` | `mr`
- Restored on every visit before first paint (async init then render).

## Features not in this app (N/A keys)

The requirements mention Projects, Attendance — **these modules do not exist** in the current codebase. Keys are mapped to actual features: **lists**, **tasks**, **employees/assignees**, **reports**, **chat**.
