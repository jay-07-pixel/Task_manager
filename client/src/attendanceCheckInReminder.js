import * as bootstrap from "bootstrap";
import { tr } from "./i18n/index.js";

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {((msg: string, variant?: string) => void) | null} */
let showToastFn = null;

/** @type {((type: "check_in" | "check_out") => Promise<boolean>) | null} */
let performCheckFn = null;

let reminderTimer = null;
let lastCheckInPromptAt = 0;
let lastCheckOutPromptAt = 0;
let activeReminderType = null;

const CHECK_IN_INTERVAL_MS = 15 * 60 * 1000;
const CHECK_OUT_INTERVAL_MS = 55 * 60 * 1000;
const TICK_MS = 60 * 1000;

export function attendanceCheckInReminderModalHtml() {
  return `
    <div class="modal fade profile-modal attendance-check-reminder-modal" id="attendanceCheckReminderModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered profile-modal-dialog">
        <div class="modal-content profile-modal-card">
          <div class="modal-header profile-modal-header">
            <h2 class="modal-title h5 mb-0" id="attendanceCheckReminderTitle">${tr("attendance.reminderCheckInTitle")}</h2>
            <button type="button" class="btn-close js-attendance-reminder-skip" aria-label="${tr("common.close")}"></button>
          </div>
          <div class="modal-body profile-modal-body">
            <p class="mb-0" id="attendanceCheckReminderMessage">${tr("attendance.reminderCheckInMessage")}</p>
          </div>
          <div class="modal-footer profile-modal-footer">
            <button type="button" class="profile-modal-btn-cancel js-attendance-reminder-skip">${tr("attendance.reminderSkip")}</button>
            <button type="button" class="profile-modal-btn-save" id="attendanceCheckReminderAction">${tr("attendance.checkIn")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

export function initAttendanceCheckInReminder({ api, showToast, performCheck }) {
  apiFn = api;
  showToastFn = showToast;
  performCheckFn = performCheck;
}

/** @param {string} hhmm */
function parseTodayTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function isReminderOpen() {
  const el = document.getElementById("attendanceCheckReminderModal");
  return Boolean(el?.classList.contains("show"));
}

function hideReminderModal() {
  const el = document.getElementById("attendanceCheckReminderModal");
  if (el) bootstrap.Modal.getInstance(el)?.hide();
  activeReminderType = null;
}

/** @param {"check_in" | "check_out"} type @param {any} status */
function showReminderModal(type, status) {
  if (isReminderOpen()) return;

  activeReminderType = type;
  const titleEl = document.getElementById("attendanceCheckReminderTitle");
  const messageEl = document.getElementById("attendanceCheckReminderMessage");
  const actionBtn = document.getElementById("attendanceCheckReminderAction");
  const modalEl = document.getElementById("attendanceCheckReminderModal");
  if (!titleEl || !messageEl || !actionBtn || !modalEl) return;

  if (type === "check_in") {
    titleEl.textContent = tr("attendance.reminderCheckInTitle");
    const time = status.schedule?.checkInTime;
    messageEl.textContent = time
      ? tr("attendance.reminderCheckInMessageWithTime", { time })
      : tr("attendance.reminderCheckInMessage");
    actionBtn.textContent = tr("attendance.checkIn");
  } else {
    titleEl.textContent = tr("attendance.reminderCheckOutTitle");
    const time = status.schedule?.checkOutTime;
    messageEl.textContent = time
      ? tr("attendance.reminderCheckOutMessageWithTime", { time })
      : tr("attendance.reminderCheckOutMessage");
    actionBtn.textContent = tr("attendance.checkOut");
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function tickReminder() {
  if (!apiFn || document.hidden || isReminderOpen()) return;

  try {
    const status = await apiFn("/api/attendance/check-status");
    if (status.attendanceEnabled === false || !status.locationsCount) return;

    const nowMs = Date.now();

    if (status.canCheckIn) {
      if (lastCheckInPromptAt === 0 || nowMs - lastCheckInPromptAt >= CHECK_IN_INTERVAL_MS) {
        showReminderModal("check_in", status);
        lastCheckInPromptAt = nowMs;
      }
      return;
    }

    const checkOutTime = status.schedule?.checkOutTime;
    if (!status.canCheckOut || !checkOutTime) return;

    const now = new Date();
    if (now < parseTodayTime(checkOutTime)) return;

    if (lastCheckOutPromptAt === 0 || nowMs - lastCheckOutPromptAt >= CHECK_OUT_INTERVAL_MS) {
      showReminderModal("check_out", status);
      lastCheckOutPromptAt = nowMs;
    }
  } catch {
    /* ignore polling errors */
  }
}

export function startAttendanceCheckInReminder() {
  stopAttendanceCheckInReminder();
  lastCheckInPromptAt = 0;
  lastCheckOutPromptAt = 0;
  void tickReminder();
  reminderTimer = window.setInterval(() => {
    void tickReminder();
  }, TICK_MS);
}

export function stopAttendanceCheckInReminder() {
  if (reminderTimer) {
    window.clearInterval(reminderTimer);
    reminderTimer = null;
  }
  hideReminderModal();
}

/** @param {"check_in" | "check_out"} type */
export function notifyAttendanceCheckCompleted(type) {
  if (type === "check_in") {
    lastCheckOutPromptAt = 0;
  }
  hideReminderModal();
}

export function wireAttendanceCheckInReminder() {
  const modalEl = document.getElementById("attendanceCheckReminderModal");
  if (!modalEl || modalEl.dataset.wired === "1") return;
  modalEl.dataset.wired = "1";

  modalEl.querySelectorAll(".js-attendance-reminder-skip").forEach((btn) => {
    btn.addEventListener("click", () => {
      hideReminderModal();
    });
  });

  document.getElementById("attendanceCheckReminderAction")?.addEventListener("click", () => {
    const type = activeReminderType;
    if (!type || !performCheckFn) return;
    const btn = document.getElementById("attendanceCheckReminderAction");
    if (btn) btn.disabled = true;
    void performCheckFn(type)
      .then((ok) => {
        if (ok) notifyAttendanceCheckCompleted(type);
      })
      .finally(() => {
        if (btn) btn.disabled = false;
      });
  });
}
