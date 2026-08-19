import { currentDemoUser, demoId, demoNowIso, getDemoStore, sessionUserPayload } from "./store.js";

const BUDGET = 26 * 8 * 60;
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function blobRes(bytes, mime = "image/png") {
  return new Response(bytes, { status: 200, headers: { "Content-Type": mime } });
}

async function readBody(init) {
  const body = init?.body;
  if (!body) return {};
  if (body instanceof FormData) return body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

function userById(store, id) {
  return store.users.find((u) => u.id === id) ?? null;
}

function requireAuth(store) {
  const user = currentDemoUser(store);
  if (!user || !store.session.loggedIn) return { error: err("Not authenticated", 401) };
  return { user, role: store.session.role };
}

function requireOwner(store) {
  const auth = requireAuth(store);
  if (auth.error) return auth;
  if (auth.role !== "owner" || !(auth.user.isAdmin || auth.user.isOwner)) {
    return { error: err("Admin access required", 403) };
  }
  return auth;
}

function serializeTask(store, t) {
  const list = store.lists.find((l) => l.id === t.listId);
  const createdBy = userById(store, t.createdById);
  const assignees = (t.assignments ?? []).map((a) => {
    const u = userById(store, a.userId);
    const assignedBy = a.assignedByUserId ? userById(store, a.assignedByUserId) : null;
    const proofs = a.proofUrls ?? [];
    const lastProofs = a.lastProofUrls ?? [];
    const updates = a.progressUpdates ?? [];
    const latest = updates[updates.length - 1] ?? null;
    return {
      id: u?.id,
      displayName: u?.displayName,
      email: u?.email,
      assigneeDone: !!a.assigneeDone,
      submissionText: a.submissionText || null,
      completionProofUrl: proofs[0] ?? null,
      completionProofUrls: proofs,
      progressUpdateCount: updates.length,
      unreadProgressUpdateCount: 0,
      progressAttachmentCount: 0,
      latestProgressUpdate: latest
        ? { id: latest.id, updateType: latest.updateType, message: latest.message, createdAt: latest.createdAt }
        : null,
      assignedBy: assignedBy
        ? { id: assignedBy.id, displayName: assignedBy.displayName, role: assignedBy.isAdmin ? "owner" : "employee" }
        : null,
      delegatedAt: a.delegatedAt ?? null,
      lastSubmittedAt: a.lastSubmittedAt ?? null,
      lastSubmissionText: a.lastSubmissionText || null,
      lastCompletionProofUrl: lastProofs[0] ?? null,
      lastCompletionProofUrls: lastProofs,
    };
  });
  const pending = store.deadlineExtensions.find(
    (e) => e.taskId === t.id && e.status === "pending"
  );
  return {
    id: t.id,
    createdById: t.createdById,
    createdBy: createdBy
      ? { id: createdBy.id, displayName: createdBy.displayName, role: createdBy.isAdmin ? "owner" : "employee" }
      : null,
    listId: t.listId,
    list: list ? { id: list.id, title: list.title } : null,
    assignees,
    delegations: t.delegations ?? [],
    title: t.title,
    notes: t.notes,
    dueAt: t.dueAt,
    dueTimeZone: t.dueTimeZone ?? "Asia/Kolkata",
    allDay: !!t.allDay,
    recurrence: t.recurrence || "none",
    recurrenceRule: t.recurrenceRule,
    completed: !!t.completed,
    starred: !!t.starred,
    highPriority: !!t.highPriority,
    durationMinutes: t.durationMinutes ?? null,
    reminderBeforeMinutes: t.reminderBeforeMinutes ?? null,
    sortOrder: t.sortOrder ?? 0,
    createdAt: t.createdAt,
    assignmentAttachments: t.assignmentAttachments ?? [],
    pendingDeadlineExtension: pending
      ? {
          id: pending.id,
          status: pending.status,
          requestedAt: pending.requestedAt,
          expiresAt: new Date(new Date(pending.requestedAt).getTime() + 24 * 3600 * 1000).toISOString(),
        }
      : null,
  };
}

function serializeProfile(store, user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    salary: user.salary,
    createdAt: user.createdAt,
    isAdmin: Boolean(user.isAdmin || user.isOwner),
    isOwner: Boolean(user.isOwner),
    profilePhoto: user.profilePhoto ?? null,
    idProof: user.idProof ?? null,
    profileDocumentsComplete: Boolean(user.profilePhoto && user.idProof),
  };
}

function serializeTeamUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isAdmin: Boolean(user.isAdmin || user.isOwner),
    isOwner: Boolean(user.isOwner),
    salary: user.salary,
  };
}

function serializeCompanyProfile(c) {
  return {
    companyName: c.companyName,
    companyAddress: c.companyAddress,
    companyState: c.companyState,
    gstNumber: c.gstNumber,
    gstCertificate: c.gstCertificate,
    directorName: c.directorName,
    directorEmail: c.directorEmail,
    directorPhone: c.directorPhone,
    directorDetails: c.directorDetails,
    contactPerson2Name: c.contactPerson2Name,
    contactPerson2Email: c.contactPerson2Email,
    contactPerson2Phone: c.contactPerson2Phone,
    companyProfileComplete: true,
    updatedAt: c.updatedAt,
  };
}

function storagePayload(userId = "u-owner") {
  const used = 18 * 1024 * 1024;
  const quota = 1024 * 1024 * 1024;
  return {
    userId,
    usedBytes: used,
    quotaBytes: quota,
    remainingBytes: quota - used,
    percentUsed: 1.8,
    overQuota: false,
    byCategory: {
      taskProofs: 10 * 1024 * 1024,
      progressUpdates: 2 * 1024 * 1024,
      chat: 3 * 1024 * 1024,
      profile: 1 * 1024 * 1024,
      assignmentAttachments: 2 * 1024 * 1024,
    },
  };
}

function employeeStatus(store, userId) {
  const pref = store.locationPrefs[userId] || { consentAt: null, trackingEnabled: false };
  const ping = store.locationPings[userId] || null;
  const trackingOk = pref.trackingEnabled && pref.consentAt && ping;
  return {
    companyLiveLocationRequired: store.company.liveLocationRequired,
    consentAt: pref.consentAt,
    trackingEnabled: pref.trackingEnabled,
    lastPing: ping,
    openOffPeriod: pref.trackingEnabled ? null : { id: "off-demo", startedAt: demoNowIso(), reason: "user_disabled" },
    canAccessApp: !store.company.liveLocationRequired || trackingOk,
  };
}

function reportsSummary(store) {
  const now = Date.now();
  let active = 0;
  let completed = 0;
  let inReview = 0;
  let overdue = 0;
  let submissions = 0;
  const byList = new Map();
  const byEmployee = new Map();
  for (const t of store.tasks) {
    const list = store.lists.find((l) => l.id === t.listId);
    const title = list?.title || "List";
    byList.set(title, (byList.get(title) || 0) + 1);
    const assignees = t.assignments ?? [];
    const allDone = assignees.length > 0 && assignees.every((a) => a.assigneeDone);
    if (t.completed || allDone) completed += 1;
    else if (assignees.some((a) => (a.progressUpdates ?? []).length && !a.assigneeDone)) inReview += 1;
    else active += 1;
    if (t.dueAt && !t.completed && !allDone && new Date(t.dueAt).getTime() < now) overdue += 1;
    for (const a of assignees) {
      const u = userById(store, a.userId);
      const row = byEmployee.get(a.userId) || { name: u?.displayName || "Employee", assigned: 0, submitted: 0, pending: 0 };
      row.assigned += 1;
      if (a.assigneeDone) {
        row.submitted += 1;
        submissions += 1;
      } else row.pending += 1;
      byEmployee.set(a.userId, row);
    }
  }
  return {
    generatedAt: demoNowIso(),
    overview: {
      totalTasks: store.tasks.length,
      active,
      inReview,
      completed,
      overdue,
      withAssignees: store.tasks.filter((t) => t.assignments?.length).length,
      totalSubmissions: submissions,
      employeeCount: store.users.filter((u) => !u.isAdmin && !u.isOwner).length,
      listCount: store.lists.filter((l) => l.kind !== "employee-assignments").length,
      progressUpdates: store.tasks.reduce(
        (n, t) => n + t.assignments.reduce((m, a) => m + (a.progressUpdates?.length || 0), 0),
        0
      ),
      chatMessages30d: store.dmMessages.length + store.groupMessages.length,
    },
    statusBreakdown: [
      { label: "Active", value: active, color: "#006d77" },
      { label: "In review", value: inReview, color: "#e65100" },
      { label: "Completed", value: completed, color: "#2e7d32" },
    ],
    tasksByList: [...byList.entries()].map(([name, count]) => ({ name, count })),
    employeePerformance: [...byEmployee.entries()].map(([id, row]) => ({ id, ...row })),
    employeeOptions: [...byEmployee.entries()].map(([id, row]) => ({ id, name: row.name })),
  };
}

function ownerDashboard(store) {
  const now = new Date();
  const employees = store.users
    .filter((u) => !u.isOwner)
    .map((u) => {
      const usedMinutes = store.tasks
        .filter((t) => t.assignments.some((a) => a.userId === u.id) && !t.completed)
        .reduce((sum, t) => sum + (t.durationMinutes || 0) * (t.recurrence === "daily" ? 26 : t.recurrence === "weekly" ? 4 : 1), 0);
      return {
        id: u.id,
        name: u.displayName,
        usedMinutes,
        remainingMinutes: Math.max(0, BUDGET - usedMinutes),
        monthlyBudgetMinutes: BUDGET,
        utilizationPct: BUDGET ? Math.round((usedMinutes / BUDGET) * 1000) / 10 : 0,
        overBudgetMinutes: Math.max(0, usedMinutes - BUDGET),
        overBudget: usedMinutes > BUDGET,
        taskCount: store.tasks.filter((t) => t.assignments.some((a) => a.userId === u.id)).length,
        tasks: store.tasks
          .filter((t) => t.assignments.some((a) => a.userId === u.id))
          .map((t) => ({
            taskId: t.id,
            title: t.title,
            durationMinutes: t.durationMinutes,
            recurrence: t.recurrence,
            monthlyMinutes: (t.durationMinutes || 0) * (t.recurrence === "daily" ? 26 : 1),
          })),
      };
    });
  const totalUsed = employees.reduce((s, e) => s + e.usedMinutes, 0);
  return {
    generatedAt: demoNowIso(),
    employeeOptions: employees.map((e) => ({ id: e.id, name: e.name })),
    monthlyMinuteBudget: {
      budgetYear: now.getFullYear(),
      budgetMonth: now.getMonth() + 1,
      monthlyBudgetMinutes: BUDGET,
      employees,
      totals: {
        employeeCount: employees.length,
        totalBudgetMinutes: BUDGET * employees.length,
        totalUsedMinutes: totalUsed,
        totalRemainingMinutes: Math.max(0, BUDGET * employees.length - totalUsed),
        overBudgetEmployeeCount: employees.filter((e) => e.overBudget).length,
      },
    },
  };
}

function employeePerformance(store, employeeId, period) {
  const emp = userById(store, employeeId);
  const n = period === "monthly" ? 6 : period === "weekly" ? 12 : 14;
  const labels = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    if (period === "monthly") d.setMonth(d.getMonth() - i);
    else if (period === "weekly") d.setDate(d.getDate() - i * 7);
    else d.setDate(d.getDate() - i);
    labels.push(
      d.toLocaleDateString("en-IN", period === "monthly" ? { month: "short" } : { month: "short", day: "numeric" })
    );
  }
  const assigned = store.tasks.filter((t) => t.assignments.some((a) => a.userId === employeeId));
  const onTime = assigned.filter((t) => t.assignments.find((a) => a.userId === employeeId)?.assigneeDone).length;
  const pending = assigned.filter((t) => !t.completed && !t.assignments.find((a) => a.userId === employeeId)?.assigneeDone).length;
  const late = assigned.filter((t) => t.dueAt && new Date(t.dueAt) < Date.now() && !t.assignments.find((a) => a.userId === employeeId)?.assigneeDone).length;
  const series = {
    allocated: labels.map((_, i) => (i === n - 1 ? assigned.length : Math.max(0, assigned.length - (n - 1 - i)))),
    onTime: labels.map((_, i) => (i === n - 1 ? onTime : Math.floor(onTime / 2))),
    late: labels.map((_, i) => (i === n - 1 ? late : 0)),
    pending: labels.map((_, i) => (i === n - 1 ? pending : Math.max(0, pending - 1))),
  };
  return {
    employee: { id: emp?.id, name: emp?.displayName || "Employee" },
    period,
    scope: "org",
    bucketCount: n,
    labels,
    totals: { allocated: assigned.length, onTime, late, pending },
    byAdmin: [
      {
        id: "u-owner",
        name: "Namra Paun",
        allocated: assigned.length,
        onTime,
        late,
        pending,
      },
    ],
    lateSubmissions: assigned
      .filter((t) => t.dueAt && new Date(t.dueAt) < Date.now() && t.assignments.find((a) => a.userId === employeeId)?.assigneeDone)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        dueAt: t.dueAt,
        submittedAt: t.assignments.find((a) => a.userId === employeeId)?.lastSubmittedAt,
        lateDays: 1,
        assignedAt: t.createdAt,
        assignedBy: { id: "u-owner", name: "Namra Paun" },
      })),
    pendingSubmissions: assigned
      .filter((t) => !t.assignments.find((a) => a.userId === employeeId)?.assigneeDone)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        dueAt: t.dueAt,
        submittedAt: null,
        overdueDays: t.dueAt && new Date(t.dueAt) < Date.now() ? 2 : 0,
        assignedAt: t.createdAt,
        assignedBy: { id: "u-owner", name: "Namra Paun" },
      })),
    series,
  };
}

function serializeChatMsg(store, m, meId) {
  const sender = userById(store, m.senderId);
  return {
    id: m.id,
    body: m.deletedAt ? "" : m.body,
    senderId: m.senderId,
    senderName: sender?.displayName || "",
    senderRole: sender?.isAdmin || sender?.isOwner ? "owner" : "employee",
    createdAt: m.createdAt,
    isMine: m.senderId === meId,
    deleted: !!m.deletedAt,
    deletedAt: m.deletedAt ?? null,
    readAt: m.readAt ?? null,
  };
}

function serializeChatContact(u) {
  const isAdmin = Boolean(u.isAdmin || u.isOwner);
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    role: isAdmin ? "owner" : "employee",
    roleLabel: isAdmin ? "Admin" : "Employee",
  };
}

function matchPath(pathname, pattern) {
  const pSeg = pattern.split("/").filter(Boolean);
  const sSeg = pathname.split("/").filter(Boolean);
  if (pSeg.length !== sSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(":")) params[pSeg[i].slice(1)] = decodeURIComponent(sSeg[i]);
    else if (pSeg[i] !== sSeg[i]) return null;
  }
  return params;
}

export async function handleDemoRequest(url, init = {}) {
  const store = getDemoStore();
  const u = new URL(url, location.origin);
  const pathname = u.pathname;
  const method = (init.method || "GET").toUpperCase();
  const body = await readBody(init);
  const qs = u.searchParams;

  const route = (m, pattern) => (method === m ? matchPath(pathname, pattern) : null);

  if (pathname.startsWith("/api/demo-files/")) return blobRes(PNG_1X1);

  if (pathname === "/api/health") return json({ ok: true, db: "connected", demo: true });

  // Auth
  if (pathname === "/api/auth/me" && method === "GET") {
    const user = currentDemoUser(store);
    if (!user) return err("Not found", 401);
    return json({ user: sessionUserPayload(store, user, store.session.role) });
  }
  if (pathname === "/api/auth/login" && method === "POST") {
    const email = String(body.email || "").toLowerCase();
    const found = store.users.find((x) => x.email.toLowerCase() === email);
    const user = found || store.users[0];
    store.session.loggedIn = true;
    store.session.userId = user.id;
    store.session.role = user.isAdmin || user.isOwner ? "owner" : "employee";
    return json({ user: sessionUserPayload(store, user, store.session.role) });
  }
  if (pathname === "/api/auth/register" && method === "POST") {
    const user = store.users[0];
    store.session.loggedIn = true;
    store.session.userId = user.id;
    store.session.role = "owner";
    return json({ user: sessionUserPayload(store, user, "owner") }, 201);
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    store.session.loggedIn = false;
    return json({ ok: true });
  }
  if (pathname === "/api/auth/switch-role" && method === "POST") {
    const auth = requireAuth(store);
    if (auth.error) return auth.error;
    const next = body.role === "employee" ? "employee" : "owner";
    if (next === "owner" && !(auth.user.isAdmin || auth.user.isOwner)) return err("Admin access required", 403);
    store.session.role = next;
    return json({ user: sessionUserPayload(store, auth.user, next) });
  }
  if (pathname === "/api/auth/turnstile-site-key") return json({ siteKey: "" });
  if (
    pathname === "/api/auth/send-otp" ||
    pathname === "/api/auth/verify-otp" ||
    pathname.startsWith("/api/auth/forgot-password")
  ) {
    return json({ ok: true, verified: true, expiresInSeconds: 600, message: "Demo: skipped." });
  }

  const auth = requireAuth(store);
  if (auth.error && pathname.startsWith("/api/")) return auth.error;
  const me = auth.user;
  const role = auth.role;

  // Company
  if (pathname === "/api/company/trial" && method === "GET") {
    const c = store.company;
    const remainingDays = Math.max(0, Math.ceil((new Date(c.trialEndDate) - Date.now()) / 86400000));
    return json({
      trialStartDate: c.trialStartDate,
      trialEndDate: c.trialEndDate,
      remainingDays,
      isExpired: Date.now() > new Date(c.trialEndDate).getTime(),
      hasStarted: Date.now() >= new Date(c.trialStartDate).getTime(),
    });
  }
  if (pathname === "/api/company/renewal-context" && method === "GET") {
    return json({
      instance: "TM-DEMO",
      site: location.origin,
      companyName: store.company.companyName,
      companyAddress: store.company.companyAddress,
      companyState: store.company.companyState,
      gstNumber: store.company.gstNumber,
      stateCode: String(store.company.gstNumber || "").slice(0, 2) || null,
      email: store.company.directorEmail || me.email,
      phone: store.company.directorPhone || me.phone,
      ownerName: store.company.directorName || me.displayName,
      userCount: store.users.length,
      trialStartDate: store.company.trialStartDate,
      trialEndDate: store.company.trialEndDate,
      trialEndYmd: store.company.trialEndDate.slice(0, 10),
      remainingDays: 18,
      isExpired: false,
      renewBaseUrl: "https://kalpanik.in/renew",
      plans: [
        { id: "task_management", priceInr: 299, label: "Task Management" },
        { id: "task_attendance", priceInr: 349, label: "Task + Attendance" },
      ],
      storage: { includedGbPerUser: 1, extraGbPriceInr: 100 },
    });
  }
  if (pathname === "/api/company/profile" && method === "GET") return json({ profile: serializeCompanyProfile(store.company) });
  if (pathname === "/api/company/profile" && method === "PATCH") {
    Object.assign(store.company, body, { updatedAt: demoNowIso() });
    return json({ profile: serializeCompanyProfile(store.company) });
  }
  if (pathname === "/api/company/gst-certificate" && method === "GET") return blobRes(PNG_1X1, "application/pdf");
  if (pathname === "/api/company/gst-certificate" && method === "POST") {
    store.company.gstCertificate = {
      url: "/api/company/gst-certificate",
      originalName: "gst-demo.pdf",
      mimeType: "application/pdf",
    };
    return json({ profile: serializeCompanyProfile(store.company) });
  }
  if (pathname === "/api/company/gst-certificate" && method === "DELETE") {
    store.company.gstCertificate = null;
    return json({ profile: serializeCompanyProfile(store.company) });
  }

  // Lists
  if (pathname === "/api/lists" && method === "GET") return json({ lists: store.lists });
  if (pathname === "/api/lists" && method === "POST") {
    const list = {
      id: demoId("list"),
      title: String(body.title || "New list").trim(),
      sortOrder: store.lists.length,
      pinned: false,
      pinnedAt: null,
      kind: "normal",
    };
    store.lists.push(list);
    return json({ list }, 201);
  }
  let p = route("PATCH", "/api/lists/:id/pin");
  if (p) {
    const list = store.lists.find((l) => l.id === p.id);
    if (!list) return err("List not found", 404);
    list.pinned = body.pinned != null ? !!body.pinned : !list.pinned;
    list.pinnedAt = list.pinned ? demoNowIso() : null;
    return json({ list });
  }
  p = route("PATCH", "/api/lists/:id");
  if (p) {
    const list = store.lists.find((l) => l.id === p.id);
    if (!list) return err("List not found", 404);
    if (body.title) list.title = String(body.title).trim();
    if (body.pinned != null) {
      list.pinned = !!body.pinned;
      list.pinnedAt = list.pinned ? demoNowIso() : null;
    }
    return json({ list });
  }
  p = route("DELETE", "/api/lists/:id");
  if (p) {
    store.lists = store.lists.filter((l) => l.id !== p.id);
    store.tasks = store.tasks.filter((t) => t.listId !== p.id);
    return json({ ok: true });
  }

  // Tasks
  p = route("GET", "/api/tasks/lists/:listId");
  if (p) {
    const tasks = store.tasks.filter((t) => t.listId === p.listId).map((t) => serializeTask(store, t));
    return json({ tasks });
  }
  if (pathname === "/api/tasks/owner-all" && method === "GET") {
    return json({
      tasks: store.tasks.map((t) => {
        const s = serializeTask(store, t);
        const list = store.lists.find((l) => l.id === t.listId);
        return { ...s, ownerAllTasksListId: t.listId, ownerAllTasksListTitle: list?.title || "" };
      }),
    });
  }
  if (pathname === "/api/tasks/assigned" && method === "GET") {
    const tasks = store.tasks.filter((t) => t.assignments.some((a) => a.userId === me.id)).map((t) => serializeTask(store, t));
    return json({ tasks });
  }
  if (pathname === "/api/tasks/assigned-by-me" && method === "GET") {
    const tasks = store.tasks
      .filter((t) => t.assignments.some((a) => a.assignedByUserId === me.id) && t.createdById === me.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        dueAt: t.dueAt,
        allDay: t.allDay,
        completed: t.completed,
        createdAt: t.createdAt,
        canDelete: true,
        assignedTo: t.assignments
          .filter((a) => a.assignedByUserId === me.id)
          .map((a) => {
            const u = userById(store, a.userId);
            return { id: u.id, displayName: u.displayName, assigneeDone: a.assigneeDone, delegatedAt: a.delegatedAt };
          }),
      }));
    return json({ tasks });
  }
  p = route("POST", "/api/tasks/lists/:listId");
  if (p) {
    const ids = body.assigneeIds || (body.assigneeId ? [body.assigneeId] : []);
    const task = {
      id: demoId("t"),
      listId: p.listId,
      createdById: me.id,
      title: String(body.title || "Untitled").trim(),
      notes: body.notes || "",
      dueAt: body.dueAt || null,
      allDay: !!body.allDay,
      dueTimeZone: "Asia/Kolkata",
      recurrence: body.recurrence || "none",
      recurrenceRule: body.recurrenceRule || null,
      completed: false,
      starred: false,
      highPriority: !!body.highPriority,
      durationMinutes: body.durationMinutes ?? null,
      reminderBeforeMinutes: body.reminderBeforeMinutes ?? null,
      sortOrder: 0,
      createdAt: demoNowIso(),
      assignments: ids.map((userId) => ({
        userId,
        assignedByUserId: me.id,
        assigneeDone: false,
        submissionText: null,
        proofUrls: [],
        progressUpdates: [],
      })),
      assignmentAttachments: [],
      delegations: [],
    };
    store.tasks.unshift(task);
    return json({ task: serializeTask(store, task) }, 201);
  }
  p = route("PATCH", "/api/tasks/:id");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const fields = [
      "title",
      "notes",
      "dueAt",
      "allDay",
      "recurrence",
      "recurrenceRule",
      "completed",
      "highPriority",
      "durationMinutes",
      "reminderBeforeMinutes",
      "listId",
      "sortOrder",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) task[f] = body[f];
    }
    if (Array.isArray(body.assigneeIds)) {
      task.assignments = body.assigneeIds.map((userId) => {
        const existing = task.assignments.find((a) => a.userId === userId);
        return (
          existing || {
            userId,
            assignedByUserId: me.id,
            assigneeDone: false,
            submissionText: null,
            proofUrls: [],
            progressUpdates: [],
          }
        );
      });
    }
    if (body.assigneeSetDone) {
      const userId = body.assigneeSetDone.userId;
      const a = task.assignments.find((x) => x.userId === userId);
      if (a) a.assigneeDone = !!body.assigneeSetDone.assigneeDone;
    }
    if (body.reopenAssignee) {
      const a = task.assignments.find((x) => x.userId === body.reopenAssignee.userId);
      if (a) {
        a.lastSubmissionText = a.submissionText;
        a.lastProofUrls = a.proofUrls;
        a.lastSubmittedAt = a.lastSubmittedAt;
        a.submissionText = null;
        a.proofUrls = [];
        a.assigneeDone = false;
      }
    }
    return json({ task: serializeTask(store, task) });
  }
  if (pathname === "/api/tasks/reorder/bulk" && method === "PATCH") {
    const orderedIds = body.orderedIds || [];
    orderedIds.forEach((id, i) => {
      const t = store.tasks.find((x) => x.id === id);
      if (t) t.sortOrder = i;
    });
    return json({ ok: true });
  }
  p = route("POST", "/api/tasks/:id/move");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    if (body.listId) task.listId = body.listId;
    return json({ task: serializeTask(store, task) });
  }
  p = route("DELETE", "/api/tasks/:id");
  if (p) {
    store.tasks = store.tasks.filter((t) => t.id !== p.id);
    return json({ ok: true });
  }
  p = route("POST", "/api/tasks/:id/completion-proof");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const a = task.assignments.find((x) => x.userId === me.id);
    if (!a) return err("Only an assigned employee can submit work", 403);
    const text = body instanceof FormData ? String(body.get("submissionText") || "") : String(body.submissionText || "");
    const files = body instanceof FormData ? body.getAll("proof") : [];
    a.lastSubmissionText = a.submissionText;
    a.lastProofUrls = a.proofUrls;
    a.submissionText = text.trim() || null;
    a.proofUrls = files.filter(Boolean).length ? files.map((_, i) => `/api/demo-files/proof-${p.id}-${i}`) : a.proofUrls;
    a.assigneeDone = true;
    a.lastSubmittedAt = demoNowIso();
    return json({ task: serializeTask(store, task) });
  }
  p = route("GET", "/api/tasks/:id/submission");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const assigneeUserId = qs.get("assigneeUserId") || me.id;
    const a = task.assignments.find((x) => x.userId === assigneeUserId);
    return json({
      submissionText: a?.submissionText || null,
      completionProofUrls: a?.proofUrls || [],
      completionProofs: (a?.proofUrls || []).map((url) => ({ url, available: true })),
    });
  }
  p = route("GET", "/api/tasks/:id/progress-updates");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const all = qs.get("all") === "1";
    const assigneeUserId = role === "employee" ? me.id : qs.get("assigneeUserId");
    const updates = [];
    for (const a of task.assignments) {
      if (!all && assigneeUserId && a.userId !== assigneeUserId) continue;
      const u = userById(store, a.userId);
      for (const pu of a.progressUpdates || []) {
        updates.push({
          id: pu.id,
          userId: a.userId,
          displayName: u?.displayName || "",
          updateType: pu.updateType,
          message: pu.message,
          createdAt: pu.createdAt,
          attachments: [],
        });
      }
    }
    updates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const assignee = task.assignments.find((a) => a.userId === assigneeUserId);
    const assigneeUser = assignee ? userById(store, assignee.userId) : null;
    return json({
      taskTitle: task.title,
      assigneeUserId: assigneeUserId || null,
      assigneeName: assigneeUser?.displayName || "",
      updates,
      delegations: (task.delegations || []).map((d) => ({
        fromUserName: d.fromUserName,
        toUserName: d.toUserName,
        createdAt: d.createdAt,
      })),
    });
  }
  p = route("POST", "/api/tasks/:id/progress-updates/mark-read");
  if (p) return json({ ok: true });
  p = route("POST", "/api/tasks/:id/progress-updates");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const a = task.assignments.find((x) => x.userId === me.id) || task.assignments[0];
    if (!a) return err("Not assigned", 403);
    const message = body instanceof FormData ? String(body.get("message") || "") : String(body.message || "");
    const updateType = body instanceof FormData ? String(body.get("updateType") || "update") : body.updateType || "update";
    a.progressUpdates = a.progressUpdates || [];
    a.progressUpdates.push({ id: demoId("pu"), userId: me.id, updateType, message, createdAt: demoNowIso() });
    return json({ ok: true, task: serializeTask(store, task) });
  }
  p = route("POST", "/api/tasks/:id/delegate");
  if (p) {
    const task = store.tasks.find((t) => t.id === p.id);
    if (!task) return err("Task not found", 404);
    const toId = body.employeeId;
    task.assignments = [{ userId: toId, assignedByUserId: me.id, assigneeDone: false, proofUrls: [], progressUpdates: [] }];
    task.listId = "list-emp";
    return json({ task: serializeTask(store, task) });
  }
  if (pathname === "/api/tasks/employee-create" && method === "POST") {
    const task = {
      id: demoId("t"),
      listId: "list-emp",
      createdById: me.id,
      title: String(body.title || "Untitled").trim(),
      notes: body.notes || "",
      dueAt: body.dueAt || null,
      allDay: !!body.allDay,
      recurrence: "none",
      completed: false,
      highPriority: false,
      durationMinutes: null,
      sortOrder: 0,
      createdAt: demoNowIso(),
      assignments: [
        { userId: body.assigneeId, assignedByUserId: me.id, assigneeDone: false, proofUrls: [], progressUpdates: [] },
      ],
    };
    store.tasks.unshift(task);
    return json({ task: serializeTask(store, task) }, 201);
  }
  if (pathname.includes("/completion-proof/") && method === "GET") return blobRes(PNG_1X1);
  if (pathname.includes("/assignment-attachments") && method === "GET") return blobRes(PNG_1X1);
  if (pathname.includes("/assignment-attachments") && method === "POST") return json({ ok: true });
  if (pathname.includes("/assignment-attachments") && method === "DELETE") return json({ ok: true });

  // Users
  if (pathname === "/api/users/assignees" && method === "GET") {
    const users = store.users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      monthlyBudgetMinutes: BUDGET,
      usedMinutes: 1200,
      remainingMinutes: BUDGET - 1200,
      previewAssignmentMinutes: 0,
      remainingAfterPreview: BUDGET - 1200,
    }));
    return json({ users, monthlyBudgetMinutes: BUDGET });
  }
  if (pathname === "/api/users/team" && method === "GET") {
    return json({
      users: store.users.map(serializeTeamUser),
      ownerCount: store.users.filter((u) => u.isOwner).length,
      maxOwners: 2,
    });
  }
  if (pathname === "/api/users/peers" && method === "GET") {
    return json({
      users: store.users.filter((u) => u.id !== me.id).map((u) => ({ id: u.id, email: u.email, displayName: u.displayName })),
    });
  }
  if (pathname === "/api/users/profile" && method === "GET") return json({ profile: serializeProfile(store, me) });
  if (pathname === "/api/users/profile" && method === "PATCH") {
    if (body.displayName) me.displayName = body.displayName;
    if (body.phone) me.phone = body.phone;
    return json({ profile: serializeProfile(store, me) });
  }
  if (pathname === "/api/users/storage" && method === "GET") return json({ storage: storagePayload(me.id) });
  if (pathname === "/api/users/storage/team" && method === "GET") {
    const byUserId = {};
    for (const u of store.users) byUserId[u.id] = storagePayload(u.id);
    return json({ quotaBytes: 1024 * 1024 * 1024, byUserId });
  }
  if (pathname === "/api/users/storage/files" && method === "GET") {
    const category = qs.get("category") || "taskProofs";
    return json({
      category,
      files: [
        {
          id: `demo-${category}-1`,
          category,
          kind: "image",
          name: "site-photo.jpg",
          sizeBytes: 420_000,
          createdAt: demoNowIso(),
          url: "/api/demo-files/photo-1",
          subtitle: "Demo sample",
        },
      ],
    });
  }
  p = route("DELETE", "/api/users/storage/files/:fileId");
  if (p) return json({ ok: true, storage: storagePayload(me.id) });
  if (pathname === "/api/users/profile-photo" || pathname === "/api/users/id-proof") {
    if (method === "GET") return blobRes(PNG_1X1);
    if (method === "POST" || method === "DELETE") {
      const key = pathname.endsWith("id-proof") ? "idProof" : "profilePhoto";
      me[key] = method === "POST" ? { url: pathname, originalName: "demo.png", mimeType: "image/png" } : null;
      me.profileDocumentsComplete = Boolean(me.profilePhoto && me.idProof);
      return json({ profile: serializeProfile(store, me) });
    }
  }
  p = route("GET", "/api/users/:id/profile-photo");
  if (p) return blobRes(PNG_1X1);
  p = route("GET", "/api/users/:id/id-proof");
  if (p) return blobRes(PNG_1X1);
  p = route("GET", "/api/users/:id/profile");
  if (p) {
    const u = userById(store, p.id);
    if (!u) return err("User not found", 404);
    return json({ profile: serializeProfile(store, u) });
  }
  p = route("PATCH", "/api/users/:id/profile");
  if (p) {
    const u = userById(store, p.id);
    if (!u) return err("User not found", 404);
    if (body.salary != null) u.salary = Number(body.salary);
    return json({ profile: serializeProfile(store, u) });
  }
  p = route("GET", "/api/users/:id/storage");
  if (p) return json({ storage: storagePayload(p.id) });
  p = route("DELETE", "/api/users/:id");
  if (p) {
    if (p.id === me.id) return err("You cannot delete your own account.");
    const target = userById(store, p.id);
    if (!target) return err("User not found", 404);
    if (target.isOwner) return err("Cannot delete a company owner. Revoke owner access first.");
    store.users = store.users.filter((u) => u.id !== p.id);
    return json({ ok: true, deleted: { id: target.id, email: target.email, displayName: target.displayName } });
  }
  p = route("PATCH", "/api/users/:id/role");
  if (p) {
    const u = userById(store, p.id);
    if (!u) return err("User not found", 404);
    u.isAdmin = body.role === "owner";
    return json({ user: serializeTeamUser(u), emailSent: false });
  }
  p = route("PATCH", "/api/users/:id/company-owner");
  if (p) {
    const u = userById(store, p.id);
    if (!u) return err("User not found", 404);
    u.isOwner = !!body.isOwner;
    if (u.isOwner) u.isAdmin = true;
    return json({ user: serializeTeamUser(u) });
  }

  // Reports
  if (pathname === "/api/reports/summary") return json(reportsSummary(store));
  if (pathname === "/api/reports/owner-dashboard/summary") return json(ownerDashboard(store));
  if (pathname === "/api/reports/employee-performance") {
    const employeeId = qs.get("employeeId");
    if (!employeeId) return err("employeeId is required");
    return json(employeePerformance(store, employeeId, qs.get("period") || "daily"));
  }

  // Attendance
  if (pathname === "/api/attendance/status") return json(employeeStatus(store, me.id));
  if (pathname === "/api/attendance/consent" && method === "POST") {
    store.locationPrefs[me.id] = { consentAt: demoNowIso(), trackingEnabled: true };
    store.locationPings[me.id] = {
      latitude: 19.076,
      longitude: 72.8777,
      accuracy: 14,
      recordedAt: demoNowIso(),
    };
    return json({ ok: true, ...employeeStatus(store, me.id) });
  }
  if (pathname === "/api/attendance/ping" && method === "POST") {
    store.locationPings[me.id] = {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy ?? 15,
      recordedAt: demoNowIso(),
    };
    return json({ ok: true, recordedAt: demoNowIso() });
  }
  if (pathname === "/api/attendance/tracking" && method === "PATCH") {
    store.locationPrefs[me.id] = store.locationPrefs[me.id] || { consentAt: demoNowIso(), trackingEnabled: true };
    store.locationPrefs[me.id].trackingEnabled = !!body.enabled;
    return json({ ok: true, ...employeeStatus(store, me.id) });
  }
  if (pathname === "/api/attendance/live") {
    const employees = store.users
      .filter((u) => !u.isOwner && u.role === "employee")
      .map((emp) => {
        const pref = store.locationPrefs[emp.id] || {};
        const ping = store.locationPings[emp.id];
        return {
          id: emp.id,
          displayName: emp.displayName,
          email: emp.email,
          trackingEnabled: !!pref.trackingEnabled,
          consentAt: pref.consentAt ?? null,
          trackingOn: !!pref.trackingEnabled,
          isOff: !pref.trackingEnabled,
          offSince: pref.trackingEnabled ? null : demoNowIso(),
          offReason: pref.trackingEnabled ? null : "user_disabled",
          trackingResumedAt: null,
          lastPing: ping ? { ...ping, stale: false } : null,
        };
      });
    return json({ employees });
  }
  if (pathname === "/api/attendance/maps-config") return json({ provider: "leaflet", apiKey: null });
  if (pathname === "/api/attendance/geocode") {
    return json({ placeName: "Andheri East", area: "Andheri", city: "Mumbai" });
  }
  p = route("GET", "/api/attendance/employees/:userId/history");
  if (p) {
    const emp = userById(store, p.userId);
    return json({ employee: { id: emp?.id, displayName: emp?.displayName }, offPeriods: [], recentPings: [] });
  }
  if (pathname === "/api/attendance/work-locations" && method === "GET") return json({ locations: store.workLocations });
  if (pathname === "/api/attendance/work-locations" && method === "POST") {
    const loc = {
      id: demoId("loc"),
      name: body.name || "Site",
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      radiusMeters: Number(body.radiusMeters || 150),
      isActive: body.isActive !== false,
    };
    store.workLocations.push(loc);
    return json({ location: loc }, 201);
  }
  p = route("PATCH", "/api/attendance/work-locations/:id");
  if (p) {
    const loc = store.workLocations.find((l) => l.id === p.id);
    if (!loc) return err("Not found", 404);
    Object.assign(loc, body);
    return json({ location: loc });
  }
  p = route("DELETE", "/api/attendance/work-locations/:id");
  if (p) {
    store.workLocations = store.workLocations.filter((l) => l.id !== p.id);
    return json({ ok: true });
  }
  if (pathname === "/api/attendance/company-settings" && method === "GET") {
    return json({
      ok: true,
      liveLocationRequired: store.company.liveLocationRequired,
      attendanceEnabled: store.company.attendanceEnabled,
    });
  }
  if (pathname === "/api/attendance/company-settings" && method === "PATCH") {
    if (body.liveLocationRequired != null) store.company.liveLocationRequired = !!body.liveLocationRequired;
    if (body.attendanceEnabled != null) store.company.attendanceEnabled = !!body.attendanceEnabled;
    return json({
      ok: true,
      liveLocationRequired: store.company.liveLocationRequired,
      attendanceEnabled: store.company.attendanceEnabled,
    });
  }
  if (pathname === "/api/attendance/daily-schedule" && method === "GET") {
    return json({
      ok: true,
      checkInTime: store.company.dailyCheckInTime,
      checkOutTime: store.company.dailyCheckOutTime,
      attendanceStartDate: store.company.attendanceStartDate,
    });
  }
  if (pathname === "/api/attendance/daily-schedule" && method === "PATCH") {
    if (body.checkInTime !== undefined) store.company.dailyCheckInTime = body.checkInTime;
    if (body.checkOutTime !== undefined) store.company.dailyCheckOutTime = body.checkOutTime;
    if (body.attendanceStartDate !== undefined) store.company.attendanceStartDate = body.attendanceStartDate;
    return json({
      ok: true,
      checkInTime: store.company.dailyCheckInTime,
      checkOutTime: store.company.dailyCheckOutTime,
      attendanceStartDate: store.company.attendanceStartDate,
    });
  }
  if (pathname === "/api/attendance/check-status") {
    const today = store.attendanceChecks.filter((c) => c.userId === me.id);
    const checkIn = today.find((c) => c.type === "check_in") || null;
    const checkOut = today.find((c) => c.type === "check_out") || null;
    const lat = qs.get("latitude");
    const lng = qs.get("longitude");
    const loc = store.workLocations.find((l) => l.isActive !== false) || store.workLocations[0];
    return json({
      attendanceEnabled: store.company.attendanceEnabled,
      date: new Date().toISOString().slice(0, 10),
      locationsCount: store.workLocations.length,
      schedule: {
        checkInTime: store.company.dailyCheckInTime,
        checkOutTime: store.company.dailyCheckOutTime,
        attendanceStartDate: store.company.attendanceStartDate,
      },
      isCheckedIn: !!checkIn && !checkOut,
      dayComplete: !!checkIn && !!checkOut,
      canCheckIn: !checkIn,
      canCheckOut: !!checkIn && !checkOut,
      lastCheckIn: checkIn
        ? { recordedAt: checkIn.recordedAt, timingStatus: checkIn.timingStatus, locationName: loc?.name }
        : null,
      lastCheckOut: checkOut
        ? { recordedAt: checkOut.recordedAt, timingStatus: checkOut.timingStatus, locationName: loc?.name }
        : null,
      proximity:
        lat != null && lng != null && loc
          ? {
              locationsConfigured: true,
              nearest: {
                locationId: loc.id,
                locationName: loc.name,
                distanceMeters: 40,
                radiusMeters: loc.radiusMeters,
                withinRadius: true,
                coordinates: `${loc.latitude}, ${loc.longitude}`,
              },
            }
          : null,
    });
  }
  if ((pathname === "/api/attendance/check-in" || pathname === "/api/attendance/check-out") && method === "POST") {
    const type = pathname.endsWith("check-in") ? "check_in" : "check_out";
    store.attendanceChecks.push({
      id: demoId("chk"),
      userId: me.id,
      type,
      recordedAt: demoNowIso(),
      workLocationId: store.workLocations[0]?.id,
      withinRadius: true,
      timingStatus: "on_time",
    });
    const loc = store.workLocations[0];
    const check = {
      id: demoId("chk"),
      type,
      recordedAt: demoNowIso(),
      timingStatus: "on_time",
      locationName: loc?.name ?? null,
      withinRadius: true,
    };
    const today = store.attendanceChecks.filter((c) => c.userId === me.id);
    const cin = today.find((c) => c.type === "check_in");
    const cout = today.find((c) => c.type === "check_out");
    return json({
      check,
      status: {
        attendanceEnabled: true,
        locationsCount: store.workLocations.length,
        schedule: {
          checkInTime: store.company.dailyCheckInTime,
          checkOutTime: store.company.dailyCheckOutTime,
          attendanceStartDate: store.company.attendanceStartDate,
        },
        isCheckedIn: !!cin && !cout,
        dayComplete: !!cin && !!cout,
        canCheckIn: !cin,
        canCheckOut: !!cin && !cout,
        lastCheckIn: cin ? { recordedAt: cin.recordedAt, timingStatus: cin.timingStatus, locationName: loc?.name } : null,
        lastCheckOut: cout ? { recordedAt: cout.recordedAt, timingStatus: cout.timingStatus, locationName: loc?.name } : null,
        proximity: {
          locationsConfigured: true,
          nearest: loc
            ? {
                locationId: loc.id,
                locationName: loc.name,
                distanceMeters: 40,
                radiusMeters: loc.radiusMeters,
                withinRadius: true,
              }
            : null,
        },
      },
    });
  }
  if (pathname === "/api/attendance/my-history") {
    const history = [];
    for (let i = 1; i <= 10; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const present = i % 5 !== 0;
      const inAt = new Date(d);
      inAt.setHours(9, 32, 0, 0);
      const outAt = new Date(d);
      outAt.setHours(18, 28, 0, 0);
      history.push({
        date,
        present,
        checkIn: present ? { recordedAt: inAt.toISOString(), timingStatus: i % 7 === 0 ? "late" : "on_time" } : null,
        checkOut: present ? { recordedAt: outAt.toISOString(), timingStatus: "on_time" } : null,
      });
    }
    return json({ history });
  }
  if (pathname === "/api/attendance/daily-report") {
    const date = qs.get("date") || new Date().toISOString().slice(0, 10);
    return json({
      date,
      beforeStartDate: false,
      attendanceStartDate: store.company.attendanceStartDate,
      employees: store.users
        .filter((u) => !u.isOwner)
        .map((emp) => {
          const cin = store.attendanceChecks.find((c) => c.userId === emp.id && c.type === "check_in");
          return {
            userId: emp.id,
            displayName: emp.displayName,
            email: emp.email,
            checkIn: cin
              ? { recordedAt: cin.recordedAt, timingStatus: cin.timingStatus, locationName: "Prince Elite site" }
              : null,
            checkOut: null,
            isCheckedIn: !!cin,
            notApplicable: false,
            allChecks: [],
          };
        }),
    });
  }
  if (pathname === "/api/attendance/monthly-report") {
    const year = Number(qs.get("year")) || new Date().getFullYear();
    const month = Number(qs.get("month")) || new Date().getMonth() + 1;
    return json({
      year,
      month,
      workingDays: 22,
      attendanceStartDate: store.company.attendanceStartDate,
      employees: store.users
        .filter((u) => !u.isOwner)
        .map((emp) => ({
          userId: emp.id,
          displayName: emp.displayName,
          email: emp.email,
          present: 18,
          absent: 4,
          workingDays: 22,
          totalMinutes: 18 * 480,
          overtimeMinutes: 40,
          salary: emp.salary ?? 18000,
        })),
    });
  }

  // Deadline extensions
  if (pathname === "/api/deadline-extensions" && method === "GET") {
    const requests = store.deadlineExtensions
      .filter((e) => e.status === "pending")
      .map((e) => {
        const emp = userById(store, e.employeeUserId);
        const task = store.tasks.find((t) => t.id === e.taskId);
        return {
          id: e.id,
          taskId: e.taskId,
          employeeUserId: e.employeeUserId,
          requestedAt: e.requestedAt,
          status: e.status,
          approvedAt: null,
          expiresAt: new Date(new Date(e.requestedAt).getTime() + 86400000).toISOString(),
          employee: emp ? { id: emp.id, displayName: emp.displayName, email: emp.email } : null,
          task: task
            ? { id: task.id, title: task.title, dueAt: task.dueAt, listId: task.listId, completed: task.completed }
            : null,
        };
      });
    return json({ requests });
  }
  if (pathname === "/api/deadline-extensions" && method === "POST") {
    const rec = {
      id: demoId("ext"),
      taskId: body.taskId,
      employeeUserId: me.id,
      requestedAt: demoNowIso(),
      status: "pending",
      approvedAt: null,
      approvedByUserId: null,
      newDueAt: null,
    };
    store.deadlineExtensions.push(rec);
    return json({
      request: {
        ...rec,
        expiresAt: new Date(new Date(rec.requestedAt).getTime() + 86400000).toISOString(),
      },
    });
  }
  p = route("POST", "/api/deadline-extensions/:id/approve");
  if (p) {
    const rec = store.deadlineExtensions.find((e) => e.id === p.id);
    if (!rec) return err("Not found", 404);
    rec.status = "approved";
    rec.approvedAt = demoNowIso();
    rec.newDueAt = body.newDueAt;
    const task = store.tasks.find((t) => t.id === rec.taskId);
    if (task && body.newDueAt) task.dueAt = body.newDueAt;
    return json({ request: rec });
  }

  // Chat
  if (pathname === "/api/chat/contacts") {
    return json({
      contacts: store.users.filter((u) => u.id !== me.id).map(serializeChatContact),
    });
  }
  if (pathname === "/api/chat/unread-count") return json({ count: 1 });
  if (pathname === "/api/chat/threads") {
    const threads = [];
    for (const c of store.conversations) {
      const peerId = c.userLowId === me.id ? c.userHighId : c.userLowId;
      if (c.userLowId !== me.id && c.userHighId !== me.id) continue;
      const peer = userById(store, peerId);
      const last = store.dmMessages.filter((m) => m.conversationId === c.id).at(-1);
      threads.push({
        type: "dm",
        id: c.id,
        peer: peer ? serializeChatContact(peer) : null,
        group: null,
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              senderName: last.senderId === me.id ? "You" : peer?.displayName || "",
              createdAt: last.createdAt,
              isMine: last.senderId === me.id,
              hasAttachment: false,
              deleted: false,
            }
          : null,
        unreadCount: store.dmMessages.filter((m) => m.conversationId === c.id && m.senderId !== me.id && !m.readAt).length,
        updatedAt: c.updatedAt,
      });
    }
    for (const g of store.chatGroups) {
      if (!g.memberIds.includes(me.id)) continue;
      const last = store.groupMessages.filter((m) => m.groupId === g.id).at(-1);
      const lastSender = last ? userById(store, last.senderId) : null;
      threads.push({
        type: "group",
        id: g.id,
        peer: null,
        group: { id: g.id, name: g.name, memberCount: g.memberIds.length },
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              senderName: last.senderId === me.id ? "You" : lastSender?.displayName || "Member",
              createdAt: last.createdAt,
              isMine: last.senderId === me.id,
              hasAttachment: false,
              deleted: false,
            }
          : null,
        unreadCount: 0,
        updatedAt: last?.createdAt || g.createdAt,
      });
    }
    threads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ threads });
  }
  p = route("GET", "/api/chat/conversations/:id/messages");
  if (p) {
    const conv = store.conversations.find((c) => c.id === p.id);
    const peerId = conv ? (conv.userLowId === me.id ? conv.userHighId : conv.userLowId) : null;
    const peer = peerId ? userById(store, peerId) : null;
    const messages = store.dmMessages
      .filter((m) => m.conversationId === p.id)
      .map((m) => serializeChatMsg(store, m, me.id));
    return json({
      messages,
      typingUsers: [],
      conversation: { peer: peer ? serializeChatContact(peer) : null },
    });
  }
  p = route("POST", "/api/chat/conversations/:id/messages");
  if (p) {
    const text = body instanceof FormData ? String(body.get("body") || "") : String(body.body || "");
    const msg = {
      id: demoId("msg"),
      conversationId: p.id,
      senderId: me.id,
      body: text || (body instanceof FormData && body.get("file") ? "(Attachment)" : ""),
      createdAt: demoNowIso(),
      readAt: null,
      deletedAt: null,
    };
    store.dmMessages.push(msg);
    const conv = store.conversations.find((c) => c.id === p.id);
    if (conv) conv.updatedAt = msg.createdAt;
    return json({ message: serializeChatMsg(store, msg, me.id) }, 201);
  }
  p = route("DELETE", "/api/chat/conversations/:id/messages/:messageId");
  if (p) {
    const msg = store.dmMessages.find((m) => m.id === p.messageId);
    if (msg) {
      msg.deletedAt = demoNowIso();
      msg.body = "";
    }
    return json({ message: msg ? serializeChatMsg(store, msg, me.id) : { id: p.messageId, deleted: true } });
  }
  p = route("GET", "/api/chat/groups/:id/messages");
  if (p) {
    const g = store.chatGroups.find((x) => x.id === p.id);
    const messages = store.groupMessages
      .filter((m) => m.groupId === p.id)
      .map((m) => serializeChatMsg(store, m, me.id));
    return json({
      group: g ? { id: g.id, name: g.name, memberCount: g.memberIds.length } : null,
      messages,
      typingUsers: [],
    });
  }
  p = route("POST", "/api/chat/groups/:id/messages");
  if (p) {
    const text = body instanceof FormData ? String(body.get("body") || "") : String(body.body || "");
    const msg = {
      id: demoId("gmsg"),
      groupId: p.id,
      senderId: me.id,
      body: text,
      createdAt: demoNowIso(),
      deletedAt: null,
    };
    store.groupMessages.push(msg);
    return json({ message: serializeChatMsg(store, msg, me.id) }, 201);
  }
  p = route("DELETE", "/api/chat/groups/:id/messages/:messageId");
  if (p) {
    const msg = store.groupMessages.find((m) => m.id === p.messageId);
    if (msg) {
      msg.deletedAt = demoNowIso();
      msg.body = "";
    }
    return json({ message: msg ? serializeChatMsg(store, msg, me.id) : { id: p.messageId, deleted: true } });
  }
  p = route("GET", "/api/chat/groups/:id");
  if (p) {
    const g = store.chatGroups.find((x) => x.id === p.id);
    if (!g) return err("Group not found.", 404);
    return json({
      group: { id: g.id, name: g.name, memberCount: g.memberIds.length, createdById: g.createdById, updatedAt: g.createdAt },
      members: g.memberIds.map((id) => userById(store, id)).filter(Boolean).map(serializeChatContact),
      canManage: role === "owner",
    });
  }
  p = route("PATCH", "/api/chat/groups/:id");
  if (p) {
    const g = store.chatGroups.find((x) => x.id === p.id);
    if (!g) return err("Group not found.", 404);
    if (body.name) g.name = String(body.name).trim();
    if (Array.isArray(body.memberIds)) g.memberIds = body.memberIds;
    return json({ group: { id: g.id, name: g.name, memberCount: g.memberIds.length } });
  }
  p = route("DELETE", "/api/chat/groups/:id");
  if (p) {
    store.chatGroups = store.chatGroups.filter((g) => g.id !== p.id);
    store.groupMessages = store.groupMessages.filter((m) => m.groupId !== p.id);
    return json({ ok: true });
  }
  p = route("POST", "/api/chat/conversations/:id/read");
  if (p) {
    store.dmMessages.forEach((m) => {
      if (m.conversationId === p.id) m.readAt = demoNowIso();
    });
    return json({ markedRead: true });
  }
  p = route("POST", "/api/chat/groups/:id/read");
  if (p) return json({ markedRead: true });
  if (pathname.endsWith("/typing") && method === "POST") return json({ ok: true });
  if (pathname === "/api/chat/forward" && method === "POST") {
    const to = body.to || {};
    const from = body.from || {};
    const src =
      from.threadType === "group"
        ? store.groupMessages.find((m) => m.id === from.messageId)
        : store.dmMessages.find((m) => m.id === from.messageId);
    const copy = {
      id: demoId("fwd"),
      senderId: me.id,
      body: src?.body || "",
      createdAt: demoNowIso(),
      readAt: null,
      deletedAt: null,
    };
    if (to.threadType === "group") {
      copy.groupId = to.threadId;
      store.groupMessages.push(copy);
    } else {
      copy.conversationId = to.threadId;
      store.dmMessages.push(copy);
    }
    return json({ message: serializeChatMsg(store, copy, me.id) });
  }
  if (pathname === "/api/chat/conversations" && method === "POST") {
    const peerId = body.peerUserId || body.userId;
    let conv = store.conversations.find(
      (c) => (c.userLowId === me.id && c.userHighId === peerId) || (c.userHighId === me.id && c.userLowId === peerId)
    );
    if (!conv) {
      conv = { id: demoId("dm"), userLowId: me.id, userHighId: peerId, updatedAt: demoNowIso() };
      store.conversations.push(conv);
    }
    const peer = userById(store, peerId);
    return json({
      conversation: { id: conv.id, peer: peer ? serializeChatContact(peer) : null },
    });
  }
  if (pathname === "/api/chat/groups" && method === "POST") {
    const includeEveryone = body.includeEveryone !== false && !body.memberIds?.length;
    const memberIds = includeEveryone
      ? store.users.map((u) => u.id)
      : [...new Set([me.id, ...(body.memberIds || [])])];
    const g = {
      id: demoId("grp"),
      name: body.name || "Group",
      createdById: me.id,
      createdAt: demoNowIso(),
      memberIds,
    };
    store.chatGroups.push(g);
    return json({ group: { id: g.id, name: g.name, createdById: g.createdById, memberCount: g.memberIds.length } });
  }

  // Push / translate / support — no-ops in demo
  if (pathname.startsWith("/api/chat/files/")) return blobRes(PNG_1X1);
  if (pathname.startsWith("/api/push")) return json({ ok: true, publicKey: "" });
  if (pathname === "/api/translate" && method === "POST") {
    const texts = body.texts || [];
    const translations = {};
    for (const t of texts) translations[t] = t;
    return json({ translations });
  }
  if (pathname === "/api/support/contact") return json({ ok: true });

  if (pathname.startsWith("/api/")) return json({ ok: true });
  return json({ error: "Not found" }, 404);
}
