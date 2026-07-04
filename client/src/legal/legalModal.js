import * as bootstrap from "bootstrap";
import { tr } from "../i18n/index.js";
import { PRIVACY_TERMS_META, PRIVACY_TERMS_SECTIONS } from "./privacyTermsContent.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLegalDocumentHtml() {
  const meta = PRIVACY_TERMS_META;
  const sections = PRIVACY_TERMS_SECTIONS.map((section) => {
    const paragraphs = (section.paragraphs ?? [])
      .map((p) => `<p class="legal-doc-paragraph">${escapeHtml(p).replace(/support@kalpanik\.in/g, '<a href="mailto:support@kalpanik.in">support@kalpanik.in</a>')}</p>`)
      .join("");
    const bullets = section.bullets?.length
      ? `<ul class="legal-doc-list">${section.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
      : "";
    return `<section class="legal-doc-section" aria-labelledby="legal-section-${escapeHtml(section.id)}">
      <h3 class="legal-doc-section-title" id="legal-section-${escapeHtml(section.id)}">${escapeHtml(section.title)}</h3>
      ${paragraphs}
      ${bullets}
    </section>`;
  }).join("");

  return `<article class="legal-doc">
    <header class="legal-doc-header">
      <h2 class="legal-doc-title">${escapeHtml(meta.title)}</h2>
      <p class="legal-doc-subtitle">${escapeHtml(meta.subtitle)}</p>
      <dl class="legal-doc-meta">
        <div><dt>${escapeHtml(tr("legal.effectiveDate"))}</dt><dd>${escapeHtml(meta.effectiveDate)}</dd></div>
        <div><dt>${escapeHtml(tr("legal.operator"))}</dt><dd>${escapeHtml(meta.operator)}</dd></div>
        <div><dt>${escapeHtml(tr("legal.support"))}</dt><dd><a href="mailto:${escapeHtml(meta.supportEmail)}">${escapeHtml(meta.supportEmail)}</a></dd></div>
      </dl>
    </header>
    ${sections}
  </article>`;
}

export function legalModalHtml() {
  return `
    <div class="modal fade profile-modal legal-modal" id="legalModal" tabindex="-1" aria-labelledby="legalModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable legal-modal-dialog">
        <div class="modal-content profile-modal-card">
          <div class="modal-header profile-modal-header">
            <h2 class="modal-title h5 mb-0" id="legalModalTitle">${escapeHtml(tr("legal.modalTitle"))}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtml(tr("common.close"))}"></button>
          </div>
          <div class="modal-body profile-modal-body legal-modal-body" id="legal-modal-body"></div>
          <div class="modal-footer profile-modal-footer legal-modal-footer">
            <a class="profile-modal-btn-cancel" href="/legal/privacy-terms.html" target="_blank" rel="noopener noreferrer">${escapeHtml(tr("legal.openInNewTab"))}</a>
            <button type="button" class="profile-modal-btn-save" data-bs-dismiss="modal">${escapeHtml(tr("legal.understandClose"))}</button>
          </div>
        </div>
      </div>
    </div>`;
}

/** @param {{ onClose?: () => void }} [opts] */
export function openLegalModal(opts = {}) {
  const body = document.getElementById("legal-modal-body");
  if (body) body.innerHTML = buildLegalDocumentHtml();
  const modalEl = document.getElementById("legalModal");
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  if (opts.onClose) {
    const handler = () => {
      modalEl.removeEventListener("hidden.bs.modal", handler);
      opts.onClose?.();
    };
    modalEl.addEventListener("hidden.bs.modal", handler);
  }
  modal.show();
}

export function wireLegalModal() {
  const modalEl = document.getElementById("legalModal");
  if (!modalEl || modalEl.dataset.wired === "1") return;
  modalEl.dataset.wired = "1";
  modalEl.addEventListener("show.bs.modal", () => {
    const body = document.getElementById("legal-modal-body");
    if (body && !body.innerHTML.trim()) body.innerHTML = buildLegalDocumentHtml();
  });
}
