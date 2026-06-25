import { currentLanguage } from "./index.js";

/** @type {Map<string, string>} */
const cache = new Map();

/** @type {((path: string, opts?: RequestInit) => Promise<any>) | null} */
let apiFn = null;

function cacheKey(lang, text) {
  return `${lang}\0${text}`;
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
  if (lang === "hi" || lang === "mr") return hasLatin(text);
  return false;
}

export function clearContentTranslationCache() {
  cache.clear();
}

export function initContentTranslate(api) {
  apiFn = api;
}

export function collectTranslatableTexts(state) {
  const texts = new Set();
  const add = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && trimmed.length <= 500) texts.add(trimmed);
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
  return cache.get(cacheKey(lang, text)) ?? text;
}

export async function ensureContentTranslations(texts) {
  const lang = currentLanguage();
  if (!apiFn || !texts?.length) return;

  const missing = [
    ...new Set(
      texts.filter((t) => {
        if (!t) return false;
        const cached = cache.get(cacheKey(lang, t));
        if (!cached) return true;
        return needsTranslation(t, lang) && cached === t;
      })
    ),
  ];
  if (!missing.length) return;

  const chunkSize = 40;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const batch = missing.slice(i, i + chunkSize);
    try {
      const data = await apiFn("/api/translate", {
        method: "POST",
        body: JSON.stringify({ texts: batch, to: lang }),
      });
      for (const [original, translated] of Object.entries(data.translations ?? {})) {
        if (translated != null && String(translated).trim()) {
          cache.set(cacheKey(lang, original), translated);
        }
      }
    } catch {
      break;
    }
  }
}

export async function ensureStateContentTranslations(state) {
  await ensureContentTranslations(collectTranslatableTexts(state));
}
