import { tr } from "./i18n/index.js";
import {
  cancelBackgroundAlarms,
  getLocalPushSubscription,
  requestNotificationPermissionForAlarms,
  runPushRegistrationDuringGesture,
  setupEmployeePushRegistration,
  syncPushSubscriptionToServer,
  warmupPushInfrastructure,
} from "./sw-register.js";

/** @typedef {{ id: string, title: string, dueAt: string | null, reminderBeforeMinutes?: number | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ReminderTask */

const DEFAULT_REMINDER_BEFORE_MS = 10 * 60 * 1000;
/** Second reminder if still not submitted — 1 hour after due time. */
const FOLLOWUP_AFTER_DUE_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;
/** When server push is active, poll tasks less often (reminders come from server). */
const CHECK_INTERVAL_PUSH_MS = 60 * 1000;
const SLOT_FOLLOWUP = "followup1h";
const STORAGE_KEY = "taskmgr-reminders-fired";
const AUTO_STOP_MS = 45 * 1000;

/** Server push handles reminders — skip duplicate in-tab alarms. */
let serverPushActive = false;
/** In-memory dedup so repeats cannot happen even if storage fails. */
const firedKeysMemory = new Set();
let pushSyncedToServer = false;
/** @type {(() => Promise<void>) | null} */
let pollTickFn = null;

export function setServerPushRemindersActive(active = true) {
  serverPushActive = !!active;
  if (serverPushActive && pollTimer && pollTickFn) {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollTickFn(), CHECK_INTERVAL_PUSH_MS);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("taskmgr-push-subscribed", () => setServerPushRemindersActive(true));
}

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {string | null} */
let activeReminderKey = null;

function loadFiredKeys() {
  const merged = new Set(firedKeysMemory);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return merged;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const k of arr) merged.add(k);
    }
  } catch {
    /* ignore */
  }
  return merged;
}

function saveFiredKeys(set) {
  firedKeysMemory.clear();
  for (const k of set) firedKeysMemory.add(k);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota */
  }
}

function markReminderFired(task, slot) {
  const fired = loadFiredKeys();
  fired.add(reminderKey(task, slot));
  saveFiredKeys(fired);
  activeReminderKey = reminderKey(task, slot);
}

function isReminderFired(task, slot) {
  return loadFiredKeys().has(reminderKey(task, slot));
}

function reminderBeforeMsForTask(task) {
  const m = task?.reminderBeforeMinutes;
  if (m === 0) return null;
  if (m == null) return DEFAULT_REMINDER_BEFORE_MS;
  return m * 60 * 1000;
}

function beforeSlotForTask(task) {
  const m = task?.reminderBeforeMinutes;
  if (m === 0) return null;
  const minutes = m == null ? 10 : m;
  return `before${minutes}`;
}

function isBeforeSlot(slot) {
  return typeof slot === "string" && slot.startsWith("before");
}

function reminderKey(task, slot) {
  const dueMs = new Date(task.dueAt).getTime();
  const duePart = Number.isFinite(dueMs) ? String(dueMs) : String(task.dueAt);
  return `${task.id}:${duePart}:${slot}`;
}

function formatDueTime(dueAt) {
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function stopTaskAlarm() {
  activeReminderKey = null;
  document.getElementById("task-reminder-banner")?.remove();
}

function focusEmployeeTaskReminder(task, slot) {
  document.dispatchEvent(
    new CustomEvent("taskmgr-focus-task", {
      detail: {
        taskId: task.id,
        title: task.title,
        dueAt: task.dueAt,
        slot: slot || "before10",
      },
    })
  );
}

function tryBrowserNotification(task, slot, bodyLine) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = reminderKey(task, slot);
  const title =
    slot === SLOT_FOLLOWUP ? tr("reminders.notSubmittedTitle") : tr("reminders.dueSoonTitle");
  try {
    const n = new Notification(title, {
      body: `${task.title} — ${bodyLine}`,
      tag: key,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

async function ensureNotificationPermission(showToast) {
  const perm = await requestNotificationPermissionForAlarms();
  if (perm === "denied") {
    showToast(tr("reminders.notificationsBlockedTab"), "warning");
  }
  return perm === "granted";
}

/**
 * @param {ReminderTask[]} tasks
 * @param {(task: ReminderTask) => { assigneeDone: boolean } | null} getMyAssignment
 * @param {(title: string, variant?: string) => void} showToast
 */
/**
 * @param {ReminderTask} task
 * @param {number} now
 * @returns {{ slot: string, eyebrow: string, toast: string, notify: string } | null}
 */
function dueReminderToFire(task, now, fired) {
  const due = new Date(task.dueAt).getTime();
  if (!Number.isFinite(due)) return null;

  const beforeMs = reminderBeforeMsForTask(task);
  const beforeSlot = beforeSlotForTask(task);
  const msUntil = due - now;

  if (beforeMs != null && beforeSlot && now >= due - beforeMs && msUntil > 0 && msUntil <= beforeMs) {
    if (fired.has(reminderKey(task, beforeSlot))) return null;
    const minutesLeft = Math.max(1, Math.ceil(msUntil / 60_000));
    return {
      slot: beforeSlot,
      eyebrow: tr("reminders.dueInAbout", { count: minutesLeft }),
      toast: tr("reminders.dueToast", { title: task.title, count: minutesLeft }),
      notify: tr("reminders.dueNotify", { count: minutesLeft, when: formatDueTime(task.dueAt) }),
    };
  }

  const followupAt = due + FOLLOWUP_AFTER_DUE_MS;
  if (now >= followupAt) {
    if (fired.has(reminderKey(task, SLOT_FOLLOWUP))) return null;
    const overdueMin = Math.max(1, Math.ceil((now - due) / 60_000));
    const overdueLine =
      now > due
        ? tr("reminders.overdueBy", { count: overdueMin })
        : tr("reminders.deadlinePassed");
    return {
      slot: SLOT_FOLLOWUP,
      eyebrow: tr("reminders.followupEyebrow"),
      toast: tr("reminders.followupToast", { title: task.title, detail: overdueLine }),
      notify: tr("reminders.followupNotify", { detail: overdueLine, when: formatDueTime(task.dueAt) }),
    };
  }

  return null;
}

function fireDueReminder(task, plan, fired, showToast) {
  const key = reminderKey(task, plan.slot);
  if (fired.has(key)) return false;

  markReminderFired(task, plan.slot);

  /** Server push shows the phone notification — skip in-tab duplicate UI. */
  if (serverPushActive) return true;

  tryBrowserNotification(task, plan.slot, plan.notify);
  focusEmployeeTaskReminder(task, plan.slot);
  showToast(plan.toast, "warning");
  return true;
}

/** Play alarm in open tab when a server push arrives (site may be in background). */
export function handlePushReminderMessage(payload, showToast) {
  if (!payload) return;
  const task = {
    id: payload.taskId || "",
    title: payload.title || tr("employee.reminders.fallbackTaskTitle"),
    dueAt: payload.dueAt || null,
  };
  const slot = payload.slot?.startsWith("followup") ? SLOT_FOLLOWUP : payload.slot || "before10";
  if (isBeforeSlot(slot) === false && slot !== SLOT_FOLLOWUP) return;
  if (isReminderFired(task, slot)) return;

  markReminderFired(task, slot);

  focusEmployeeTaskReminder(task, slot);
}

export function checkDueReminders(tasks, getMyAssignment, showToast) {
  const now = Date.now();
  const fired = loadFiredKeys();

  for (const task of tasks) {
    if (!task.dueAt) continue;
    const me = getMyAssignment(task);
    if (!me || me.assigneeDone) continue;

    const plan = dueReminderToFire(task, now, fired);
    if (!plan) continue;

    if (fireDueReminder(task, plan, fired, showToast)) return;
  }
}

/**
 * @param {() => Promise<void>} reloadTasks
 * @param {() => ReminderTask[]} getTasks
 * @param {(task: ReminderTask) => { assigneeDone: boolean } | null} getMyAssignment
 * @param {(title: string, variant?: string) => void} showToast
 */
function wireEmployeeInteractionOnce(apiFetch, showToast) {
  if (document.documentElement.dataset.taskmgrInteractionWired === "1") return;
  warmupPushInfrastructure(apiFetch);

  const onFirstInteraction = () => {
    document.documentElement.dataset.taskmgrInteractionWired = "1";
    document.removeEventListener("pointerdown", onFirstInteraction, true);
    document.removeEventListener("click", onFirstInteraction, true);
    document.removeEventListener("keydown", onFirstInteraction, true);
    if (Notification.permission === "granted") {
      runPushRegistrationDuringGesture(apiFetch, (result) => {
        if (result.ok) {
          showToast(tr("reminders.phoneEnabled"), "primary");
        }
      });
    }
  };

  document.addEventListener("pointerdown", onFirstInteraction, { capture: true });
  document.addEventListener("click", onFirstInteraction, { capture: true });
  document.addEventListener("keydown", onFirstInteraction, { capture: true });
}

export function startEmployeeReminders(reloadTasks, getTasks, getMyAssignment, showToast, getUserId, apiFetch) {
  stopEmployeeReminders();
  wireEmployeeInteractionOnce(apiFetch, showToast);

  if (!startEmployeeReminders._swMessage && "serviceWorker" in navigator) {
    const onSwMessage = (event) => {
      if (event.data?.type === "taskmgr-push-reminder") {
        handlePushReminderMessage(event.data.payload, showToast);
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    startEmployeeReminders._swMessage = onSwMessage;
  }

  let permissionAsked = false;

  const tick = async () => {
    try {
      await reloadTasks();
    } catch {
      /* keep polling */
    }
    const tasks = getTasks();
    const userId = getUserId?.();
    if (!permissionAsked) {
      permissionAsked = true;
      const granted = await ensureNotificationPermission(showToast);
      if (granted && userId && apiFetch) {
        await setupEmployeePushRegistration(apiFetch, showToast);
      }
    } else if (userId && Notification.permission === "granted" && apiFetch && !pushSyncedToServer) {
      const localSub = await getLocalPushSubscription();
      if (localSub) {
        const sync = await syncPushSubscriptionToServer(apiFetch);
        if (sync.ok) {
          pushSyncedToServer = true;
          setServerPushRemindersActive(true);
        }
      }
    }
    checkDueReminders(tasks, getMyAssignment, showToast);
  };

  pollTickFn = tick;
  void tick();
  pollTimer = setInterval(
    () => void tick(),
    serverPushActive ? CHECK_INTERVAL_PUSH_MS : CHECK_INTERVAL_MS
  );

  document.addEventListener("visibilitychange", onVisibility);
  function onVisibility() {
    if (document.visibilityState === "visible") void tick();
  }

  startEmployeeReminders._onVisibility = onVisibility;
}

export function stopEmployeeReminders() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollTickFn = null;
  pushSyncedToServer = false;
  const fn = startEmployeeReminders._onVisibility;
  if (fn) document.removeEventListener("visibilitychange", fn);
  const swFn = startEmployeeReminders._swMessage;
  if (swFn && "serviceWorker" in navigator) {
    navigator.serviceWorker.removeEventListener("message", swFn);
    startEmployeeReminders._swMessage = null;
  }
  stopTaskAlarm();
  void cancelBackgroundAlarms();
}

/** Call when a task is marked complete so a new due date can alert again. */
export function clearReminderForTask(taskId, dueAt) {
  if (!dueAt) return;
  const dueMs = new Date(dueAt).getTime();
  const duePart = Number.isFinite(dueMs) ? String(dueMs) : String(dueAt);
  const prefix = `${taskId}:${duePart}`;
  const fired = loadFiredKeys();
  let changed = false;
  for (const k of [...fired]) {
    if (k === prefix || k.startsWith(`${prefix}:`)) {
      fired.delete(k);
      changed = true;
    }
  }
  if (!changed) return;
  saveFiredKeys(fired);
  if (activeReminderKey?.startsWith(prefix)) stopTaskAlarm();
}
