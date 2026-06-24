import { changeLanguage, currentLanguage, t } from "./index.js";

export function languageSelectorHtml({ compact = false } = {}) {
  const lang = currentLanguage();
  const btnClass = compact
    ? "admin-lang-select admin-lang-select--compact"
    : "admin-lang-select";
  return `<div class="${btnClass}" data-lang-selector>
    <label class="visually-hidden" for="app-lang-select">${t("language.label")}</label>
    <select id="app-lang-select" class="form-select form-select-sm admin-lang-select-input" aria-label="${t("language.label")}">
      <option value="en"${lang === "en" ? " selected" : ""}>${t("language.en")}</option>
      <option value="hi"${lang === "hi" ? " selected" : ""}>${t("language.hi")}</option>
      <option value="mr"${lang === "mr" ? " selected" : ""}>${t("language.mr")}</option>
    </select>
  </div>`;
}

/** @param {ParentNode} root */
export function wireLanguageSelector(root = document) {
  root.querySelectorAll("[data-lang-selector] select").forEach((select) => {
    if (select.dataset.wiredLang === "1") return;
    select.dataset.wiredLang = "1";
    select.addEventListener("change", () => {
      const lng = select.value;
      if (lng && lng !== currentLanguage()) {
        void changeLanguage(lng);
      }
    });
  });
}
