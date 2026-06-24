import i18n from "i18next";
import en from "../locales/en.json";
import hi from "../locales/hi.json";
import mr from "../locales/mr.json";

export const LANG_STORAGE_KEY = "task-manager-lang";
const SUPPORTED = ["en", "hi", "mr"];

/** @type {(() => void) | null} */
let onLanguageChange = null;

function normalizeLang(lng) {
  const base = String(lng || "en").split("-")[0];
  return SUPPORTED.includes(base) ? base : "en";
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
    onLanguageChange?.();
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

export function changeLanguage(lng) {
  return i18n.changeLanguage(normalizeLang(lng));
}

export function currentLanguage() {
  return normalizeLang(i18n.language);
}

export { i18n };
