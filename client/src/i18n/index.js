import i18n from "i18next";
import en from "../locales/en.json";
import hi from "../locales/hi.json";
import mr from "../locales/mr.json";
import ta from "../locales/ta.json";
import {
  hideLanguageChangeOverlay,
  showLanguageChangeOverlay,
  updateLanguageChangeOverlay,
} from "./languageChangeOverlay.js";

export const LANG_STORAGE_KEY = "task-manager-lang";
const SUPPORTED = ["en", "hi", "mr", "ta"];

const CHANGING_MESSAGE = {
  en: "Changing language… Please wait.",
  hi: "भाषा बदली जा रही है… कृपया प्रतीक्षा करें।",
  mr: "भाषा बदलली जात आहे… कृपया प्रतीक्षा करा.",
  ta: "மொழி மாற்றப்படுகிறது… தயவுசெய்து காத்திருக்கவும்.",
};

/** @type {(() => void | Promise<void>) | null} */
let onLanguageChange = null;

/** @type {Promise<void> | null} */
let languageChangeInFlight = null;

function normalizeLang(lng) {
  const base = String(lng || "en").split("-")[0];
  return SUPPORTED.includes(base) ? base : "en";
}

function changingMessageFor(lang) {
  return CHANGING_MESSAGE[normalizeLang(lang)] ?? CHANGING_MESSAGE.en;
}

export function setLanguageChangeHandler(fn) {
  onLanguageChange = fn;
}

export async function initI18n() {
  const saved = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY) || "en");

  await i18n.init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      mr: { translation: mr },
      ta: { translation: ta },
    },
    lng: saved,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });

  document.documentElement.lang = saved;
  updateDocumentTitle();

  i18n.on("languageChanged", (lng) => {
    const code = normalizeLang(lng);
    localStorage.setItem(LANG_STORAGE_KEY, code);
    document.documentElement.lang = code;
    updateDocumentTitle();
  });
}

function updateDocumentTitle() {
  document.title = i18n.t("app.title");
}

/** @param {string} key @param {Record<string, unknown>} [opts] */
export function tr(key, opts) {
  return i18n.t(key, opts);
}

/** @deprecated Use `tr` — kept as alias to avoid shadowing bugs with task variables named `t`. */
export const t = tr;

export async function changeLanguage(lng) {
  const code = normalizeLang(lng);
  if (code === currentLanguage()) return;

  if (languageChangeInFlight) {
    await languageChangeInFlight;
    if (code === currentLanguage()) return;
  }

  languageChangeInFlight = (async () => {
    showLanguageChangeOverlay(changingMessageFor(code));
    try {
      await i18n.changeLanguage(code);
      updateLanguageChangeOverlay(tr("language.changing"));
      await onLanguageChange?.();
    } catch (err) {
      console.error("language change failed:", err);
    } finally {
      hideLanguageChangeOverlay();
    }
  })();

  try {
    await languageChangeInFlight;
  } finally {
    languageChangeInFlight = null;
  }
}

export function currentLanguage() {
  return normalizeLang(i18n.language);
}

/** BCP 47 locale for `Date` formatting (month names, weekdays, AM/PM). */
export function dateLocale() {
  const lang = currentLanguage();
  if (lang === "hi") return "hi-IN";
  if (lang === "mr") return "mr-IN";
  if (lang === "ta") return "ta-IN";
  return "en-IN";
}

const TIME_24H = Object.freeze({ hour: "2-digit", minute: "2-digit", hour12: false });
const TIME_24H_SECONDS = Object.freeze({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Time only, 24-hour clock (e.g. 10:30, 22:15). */
export function formatTime24(value, options = {}) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString(dateLocale(), { ...TIME_24H, ...options });
}

/** Date + time, 24-hour clock. */
export function formatDateTime24(value, options = {}) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(dateLocale(), {
    dateStyle: "medium",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

/** Short date + time, 24-hour clock (e.g. 4 Jul, 22:15). */
export function formatShortDateTime24(value, options = {}) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(dateLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

/** Weekday + short date + time, 24-hour clock. */
export function formatWeekdayDateTime24(value, options = {}) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(dateLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

export { i18n };
