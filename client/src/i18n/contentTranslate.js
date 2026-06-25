import { currentLanguage } from "./index.js";

/** @type {Map<string, string>} */
const cache = new Map();

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

/** @type {Set<() => void>} */
const updateListeners = new Set();

const pendingTexts = new Set();
/** @type {number | null} */
let flushTimer = null;

function cacheKey(lang, text) {
  return `${lang}\0${text}`;
}

function normalizeContentText(text) {
  if (text == null) return "";
  return String(text).trim().replace(/\s+/g, " ");
}

function shouldCacheTranslation(original, translated, lang) {
  if (!translated || normalizeComparable(translated) === normalizeComparable(original)) return false;
  if (lang === "en") return hasLatin(translated);
  if (lang === "hi" || lang === "mr") {
    return hasDevanagari(translated) || normalizeComparable(translated) !== normalizeComparable(original);
  }
  return true;
}

function normalizeComparable(text) {
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(text);
}

function hasLatin(text) {
  return /[a-zA-Z]/.test(text);
}

/** Whether `text` likely needs translation for the active UI language. */
function needsTranslation(text, lang) {
  if (!text) return false;
  if (lang === "en") return hasDevanagari(text);
  if (lang === "hi" || lang === "mr") return hasLatin(text) || !hasDevanagari(text);
  return false;
}

function notifyTranslationUpdate() {
  for (const fn of updateListeners) {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  }
}

function scheduleContentTranslation(text) {
  const lang = currentLanguage();
  const key = normalizeContentText(text);
  if (!key || !apiFn || !needsTranslation(key, lang)) return;
  if (cache.has(cacheKey(lang, key))) return;
  pendingTexts.add(key);
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const batch = [...pendingTexts];
    pendingTexts.clear();
    void ensureContentTranslations(batch).then((updated) => {
      if (updated) notifyTranslationUpdate();
    });
  }, 40);
}

export function clearContentTranslationCache() {
  cache.clear();
}

export function onContentTranslationsUpdated(fn) {
  updateListeners.add(fn);
  return () => updateListeners.delete(fn);
}

export function initContentTranslate(api) {
  apiFn = api;
}

export function collectTranslatableTexts(state) {
  const texts = new Set();
  const add = (value) => {
    const key = normalizeContentText(value);
    if (key && key.length <= 500) texts.add(key);
  };

  const addTask = (task) => {
    if (!task) return;
    add(task.title);
    add(task.notes);
    const assignees = task.assignees ?? task.assignedTo ?? [];
    for (const a of assignees) {
      add(a.displayName);
      add(a.assignedBy?.displayName);
      add(a.lastSubmissionText);
      for (const u of a.progressUpdates ?? []) add(u.message);
    }
  };

  for (const task of state.tasks ?? []) addTask(task);
  for (const task of state.empTasks ?? []) addTask(task);
  for (const task of state.empAssignedByMeTasks ?? []) addTask(task);
  for (const user of state.assignees ?? []) add(user.displayName);
  for (const list of state.lists ?? []) add(list.title);
  if (state.user?.displayName) add(state.user.displayName);

  return [...texts];
}

/**
 * Return translated user content for the active UI language.
 * Falls back to the original text until a translation is cached.
 */
export function dt(text) {
  if (text == null || text === "") return text ?? "";
  const lang = currentLanguage();
  const key = normalizeContentText(text);
  if (!key) return text ?? "";
  const cached = cache.get(cacheKey(lang, key));
  if (cached) return cached;
  scheduleContentTranslation(key);
  return text;
}

/** @returns {Promise<boolean>} whether any new translations were cached */
export async function ensureContentTranslations(texts) {
  const lang = currentLanguage();
  if (!apiFn || !texts?.length) return false;

  const missing = [
    ...new Set(
      texts
        .map((t) => normalizeContentText(t))
        .filter((t) => {
          if (!t) return false;
          const cached = cache.get(cacheKey(lang, t));
          if (!cached) return true;
          return needsTranslation(t, lang) && normalizeComparable(cached) === normalizeComparable(t);
        })
    ),
  ];
  if (!missing.length) return false;

  let updated = false;
  const chunkSize = 40;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const batch = missing.slice(i, i + chunkSize);
    try {
      const data = await apiFn("/api/translate", {
        method: "POST",
        body: JSON.stringify({ texts: batch, to: lang }),
      });
      for (const [original, translated] of Object.entries(data.translations ?? {})) {
        const key = normalizeContentText(original);
        if (shouldCacheTranslation(key, translated, lang)) {
          cache.set(cacheKey(lang, key), translated);
          updated = true;
        }
      }
    } catch {
      break;
    }
  }
  return updated;
}

export async function ensureStateContentTranslations(state) {
  const updated = await ensureContentTranslations(collectTranslatableTexts(state));
  if (updated) notifyTranslationUpdate();
  return updated;
}
