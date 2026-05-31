import {
  cancelBackgroundAlarms,
  getLocalPushSubscription,
  requestNotificationPermissionForAlarms,
  runPushRegistrationDuringGesture,
  setupEmployeePushRegistration,
  syncPushSubscriptionToServer,
  warmupPushInfrastructure,
} from "./sw-register.js";

/** @typedef {{ id: string, title: string, dueAt: string | null, assignees?: { id: string, assigneeDone?: boolean }[] }} ReminderTask */

const REMINDER_BEFORE_MS = 10 * 60 * 1000;
/** Second reminder if still not submitted — 1 hour after the first (10 min before due). */
const FOLLOWUP_AFTER_FIRST_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;
/** When server push is active, poll tasks less often (reminders come from server). */
const CHECK_INTERVAL_PUSH_MS = 60 * 1000;
const SLOT_BEFORE = "before10";
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
/** @type {ReturnType<typeof setInterval> | null} */
let beepTimer = null;
/** @type {AudioContext | null} */
let audioCtx = null;
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
  for (const k of set) firedKeysMemory.add(k);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota */
  }
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

/** @type {HTMLAudioElement | null} */
let alarmHtmlAudio = null;

function getAlarmHtmlAudio() {
  if (!alarmHtmlAudio) {
    alarmHtmlAudio = new Audio("/sounds/alarm-beep.wav");
    alarmHtmlAudio.loop = true;
    alarmHtmlAudio.preload = "auto";
  }
  return alarmHtmlAudio;
}

function stopHtmlAlarmAudio() {
  if (!alarmHtmlAudio) return;
  alarmHtmlAudio.pause();
  alarmHtmlAudio.currentTime = 0;
}

function stopAlarmSound() {
  if (beepTimer) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  stopHtmlAlarmAudio();
}

export function stopTaskAlarm() {
  stopAlarmSound();
  activeReminderKey = null;
  document.getElementById("task-reminder-banner")?.remove();
}

async function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

/** Alternating square-wave beeps (alarm-clock style). */
export async function playTaskAlarm() {
  stopAlarmSound();

  const htmlAudio = getAlarmHtmlAudio();
  htmlAudio.volume = 1;
  try {
    await htmlAudio.play();
    return true;
  } catch {
    /* fall through to Web Audio */
  }

  const ctx = await ensureAudio();
  if (!ctx) return false;

  audioCtx = ctx;
  let highTone = true;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const playBeep = () => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = highTone ? 880 : 698;
    highTone = !highTone;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.65, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
  };

  playBeep();
  beepTimer = setInterval(playBeep, 480);
  return true;
}

function showReminderBanner(task, eyebrowText, showToast) {
  document.getElementById("task-reminder-banner")?.remove();
  stopAlarmSound();
  activeReminderKey = null;

  const banner = document.createElement("div");
  banner.id = "task-reminder-banner";
  banner.className = "task-reminder-banner";
  banner.setAttribute("role", "alertdialog");
  banner.setAttribute("aria-labelledby", "task-reminder-title");
  banner.setAttribute("aria-modal", "true");
  banner.innerHTML = `
    <div class="task-reminder-banner__inner">
      <div class="task-reminder-banner__icon" aria-hidden="true"><i class="bi bi-alarm-fill"></i></div>
      <div class="task-reminder-banner__text">
        <p class="task-reminder-banner__eyebrow mb-0">${escapeHtml(eyebrowText)}</p>
        <p class="task-reminder-banner__title mb-0" id="task-reminder-title">${escapeHtml(task.title)}</p>
        <p class="task-reminder-banner__meta mb-0 small">${escapeHtml(formatDueTime(task.dueAt))}</p>
      </div>
      <div class="task-reminder-banner__actions">
        <button type="button" class="btn btn-warning btn-sm fw-semibold me-2" id="task-reminder-sound">Tap for alarm sound</button>
        <button type="button" class="btn btn-light btn-sm fw-semibold" id="task-reminder-stop">Stop alarm and dismiss</button>
      </div>
    </div>`;

  document.body.appendChild(banner);
  banner.querySelector("#task-reminder-stop")?.addEventListener("click", () => stopTaskAlarm());
  banner.querySelector("#task-reminder-sound")?.addEventListener("click", () => {
    void playTaskAlarm();
  });
  banner.querySelector(".task-reminder-banner__inner")?.addEventListener("pointerdown", () => {
    void playTaskAlarm();
  });

  void playTaskAlarm().then((ok) => {
    if (!ok) {
      showToast?.("Tap the banner or “Tap for alarm sound” if you hear no beeping.", "warning");
    }
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function openFullscreenAlarmPage(task, slot) {
  const p = new URLSearchParams();
  p.set("taskId", task.id);
  p.set("title", task.title);
  if (task.dueAt) p.set("dueAt", task.dueAt);
  if (slot) p.set("slot", slot);
  const url = `/alarm.html?${p.toString()}`;
  const existing = window.open("", "taskmgr-alarm");
  if (existing && !existing.closed) {
    existing.location.href = url;
    existing.focus();
    return;
  }
  const features = "noopener,noreferrer";
  const win = window.open(url, "taskmgr-alarm", features);
  win?.focus();
}

function tryBrowserNotification(task, slot, bodyLine) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = reminderKey(task, slot);
  const title = slot === SLOT_FOLLOWUP ? "Task still not submitted" : "Task due soon";
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
    showToast(
      "Notifications are blocked. Allow them in browser settings for alarms when this tab is closed.",
      "warning"
    );
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

  const firstAt = due - REMINDER_BEFORE_MS;
  const followupAt = firstAt + FOLLOWUP_AFTER_FIRST_MS;
  const msUntil = due - now;

  if (now >= firstAt && msUntil > 0 && msUntil <= REMINDER_BEFORE_MS) {
    if (fired.has(reminderKey(task, SLOT_BEFORE))) return null;
    const minutesLeft = Math.max(1, Math.ceil(msUntil / 60_000));
    return {
      slot: SLOT_BEFORE,
      eyebrow: `Due in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`,
      toast: `Reminder: “${task.title}” is due in about ${minutesLeft} minutes.`,
      notify: `due in about ${minutesLeft} min (${formatDueTime(task.dueAt)})`,
    };
  }

  if (now >= followupAt) {
    if (fired.has(reminderKey(task, SLOT_FOLLOWUP))) return null;
    const overdueMin = Math.max(1, Math.ceil((now - due) / 60_000));
    const overdueLine =
      now > due ? `overdue by about ${overdueMin} min` : "deadline passed — please submit";
    return {
      slot: SLOT_FOLLOWUP,
      eyebrow: "Still not submitted — follow-up (1 hour later)",
      toast: `Reminder: “${task.title}” is still not submitted. ${overdueLine}.`,
      notify: `${overdueLine} (${formatDueTime(task.dueAt)})`,
    };
  }

  return null;
}

function fireDueReminder(task, plan, fired, showToast) {
  const key = reminderKey(task, plan.slot);
  if (fired.has(key)) return false;

  fired.add(key);
  saveFiredKeys(fired);
  activeReminderKey = key;

  tryBrowserNotification(task, plan.slot, plan.notify);
  openFullscreenAlarmPage(task, plan.slot);
  showToast(plan.toast, "warning");
  showReminderBanner(task, plan.eyebrow, showToast);
  return true;
}

/** Play alarm in open tab when a server push arrives (site may be in background). */
export function handlePushReminderMessage(payload, showToast) {
  if (!payload) return;
  const task = {
    id: payload.taskId || "",
    title: payload.title || "Your task",
    dueAt: payload.dueAt || null,
  };
  const eyebrow =
    payload.slot === "followup1h" ? "Still not submitted — follow-up reminder" : "Task due soon";
  openFullscreenAlarmPage(task, payload.slot);
  showReminderBanner(task, eyebrow, showToast);
  if (navigator.vibrate) navigator.vibrate([500, 150, 500, 150, 500]);
}

export function checkDueReminders(tasks, getMyAssignment, showToast) {
  if (serverPushActive) return;

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
    void ensureAudio();
    if (Notification.permission === "granted") {
      runPushRegistrationDuringGesture(apiFetch, (result) => {
        if (result.ok) {
          showToast("Phone reminders enabled — alerts work even in other apps.", "primary");
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
