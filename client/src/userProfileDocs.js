import { tr } from "./i18n/index.js";

const PROFILE_DOC_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID_PROOF_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function profileDocumentsSectionHtml() {
  return `
    <div id="my-profile-documents-section" class="my-profile-documents-section d-none border-top pt-3 mt-3">
      <div class="profile-documents-card" id="my-profile-documents-card">
        <div class="profile-documents-card-head">
          <h3 class="profile-documents-title h6 mb-0">${tr("profile.profileDocuments")}</h3>
          <span class="profile-documents-status profile-documents-status--incomplete" id="my-profile-documents-status">${tr("profile.sectionIncompleteTitle")}</span>
        </div>
        <p class="small text-muted mb-3">${tr("profile.profileDocumentsIntro")}</p>
        <div class="profile-documents-field mb-3">
          <label class="form-label">${tr("profile.profilePhoto")}<span class="text-danger ms-1" aria-hidden="true">*</span></label>
          <p class="small text-muted mb-2">${tr("profile.profilePhotoHint")}</p>
          <input type="file" class="d-none" id="my-profile-photo-file" accept="image/jpeg,image/png,image/webp" />
          <div class="profile-documents-actions">
            <button type="button" class="profile-doc-upload-btn" id="my-profile-photo-pick">${tr("profile.uploadProfilePhoto")}</button>
            <button type="button" class="profile-doc-remove-btn d-none" id="my-profile-photo-remove">${tr("profile.removeDocument")}</button>
          </div>
          <p class="profile-doc-file-label mb-0 mt-2" id="my-profile-photo-label" aria-live="polite"></p>
          <a class="profile-doc-view-link d-none mt-1" id="my-profile-photo-view" href="#" target="_blank" rel="noopener noreferrer">${tr("profile.viewDocument")}</a>
        </div>
        <div class="profile-documents-field mb-0">
          <label class="form-label">${tr("profile.idProof")}<span class="text-danger ms-1" aria-hidden="true">*</span></label>
          <p class="small text-muted mb-2">${tr("profile.idProofHint")}</p>
          <input type="file" class="d-none" id="my-profile-id-file" accept="application/pdf,image/jpeg,image/png,image/webp" />
          <div class="profile-documents-actions">
            <button type="button" class="profile-doc-upload-btn" id="my-profile-id-pick">${tr("profile.uploadIdProof")}</button>
            <button type="button" class="profile-doc-remove-btn d-none" id="my-profile-id-remove">${tr("profile.removeDocument")}</button>
          </div>
          <p class="profile-doc-file-label mb-0 mt-2" id="my-profile-id-label" aria-live="polite"></p>
          <a class="profile-doc-view-link d-none mt-1" id="my-profile-id-view" href="#" target="_blank" rel="noopener noreferrer">${tr("profile.viewDocument")}</a>
        </div>
      </div>
    </div>`;
}

export function syncProfileDocumentsSectionVisibility(isOwnProfile) {
  const section = document.getElementById("my-profile-documents-section");
  if (!section) return;
  section.classList.toggle("d-none", !isOwnProfile);
}

function updateDocFieldUi({ file, label, view, removeBtn, emptyLabel, onFileLabel }) {
  if (file?.url) {
    if (label) label.textContent = file.originalName || onFileLabel;
    if (view) {
      view.href = file.url;
      view.classList.remove("d-none");
    }
    removeBtn?.classList.remove("d-none");
  } else {
    if (label) label.textContent = emptyLabel;
    view?.classList.add("d-none");
    removeBtn?.classList.add("d-none");
  }
}

export function fillProfileDocumentsUi(profile) {
  const p = profile || {};
  updateDocFieldUi({
    file: p.profilePhoto,
    label: document.getElementById("my-profile-photo-label"),
    view: document.getElementById("my-profile-photo-view"),
    removeBtn: document.getElementById("my-profile-photo-remove"),
    emptyLabel: tr("profile.noProfilePhoto"),
    onFileLabel: tr("profile.profilePhotoOnFile"),
  });
  updateDocFieldUi({
    file: p.idProof,
    label: document.getElementById("my-profile-id-label"),
    view: document.getElementById("my-profile-id-view"),
    removeBtn: document.getElementById("my-profile-id-remove"),
    emptyLabel: tr("profile.noIdProof"),
    onFileLabel: tr("profile.idProofOnFile"),
  });
  updateProfileDocumentsStatusBadge(p);
}

export function updateProfileDocumentsStatusBadge(profile) {
  const statusEl = document.getElementById("my-profile-documents-status");
  const cardEl = document.getElementById("my-profile-documents-card");
  if (!statusEl) return;

  const complete = Boolean(profile?.profileDocumentsComplete);
  statusEl.textContent = complete ? tr("profile.documentsComplete") : tr("profile.sectionIncompleteTitle");
  statusEl.classList.toggle("profile-documents-status--complete", complete);
  statusEl.classList.toggle("profile-documents-status--incomplete", !complete);
  cardEl?.classList.toggle("profile-documents-card--incomplete", !complete);
}

function wireSingleUpload({
  pickBtn,
  fileInput,
  removeBtn,
  uploadUrl,
  deleteUrl,
  allowedMimeTypes,
  invalidTypeMessage,
  uploadSuccessMessage,
  removeConfirmMessage,
  removeSuccessMessage,
  uploadFailMessage,
  removeFailMessage,
  onProfileUpdated,
}) {
  if (!pickBtn || !fileInput) return;

  pickBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (allowedMimeTypes && !allowedMimeTypes.has(file.type)) {
      onProfileUpdated.showToast?.(invalidTypeMessage, "warning");
      return;
    }
    if (file.size > PROFILE_DOC_MAX_BYTES) {
      onProfileUpdated.showToast?.(tr("profile.profileDocTooLarge"), "warning");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    pickBtn.disabled = true;
    try {
      const res = await fetch(uploadUrl, { method: "POST", credentials: "include", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || uploadFailMessage);
      fillProfileDocumentsUi(data.profile);
      onProfileUpdated.showToast?.(uploadSuccessMessage, "success");
      onProfileUpdated.onUpdated?.(data.profile);
    } catch (err) {
      onProfileUpdated.showToast?.(err.message || uploadFailMessage, "danger");
    } finally {
      pickBtn.disabled = false;
    }
  });

  removeBtn?.addEventListener("click", async () => {
    if (!window.confirm(removeConfirmMessage)) return;
    removeBtn.disabled = true;
    try {
      const data = await onProfileUpdated.api(deleteUrl, { method: "DELETE" });
      fillProfileDocumentsUi(data.profile);
      onProfileUpdated.showToast?.(removeSuccessMessage, "success");
      onProfileUpdated.onUpdated?.(data.profile);
    } catch (err) {
      onProfileUpdated.showToast?.(err.message || removeFailMessage, "danger");
    } finally {
      removeBtn.disabled = false;
    }
  });
}

export function wireProfileDocumentsUpload({ api, showToast, onUpdated }) {
  const section = document.getElementById("my-profile-documents-section");
  if (!section || section.dataset.wired === "1") return;
  section.dataset.wired = "1";

  const deps = { api, showToast, onUpdated };
  wireSingleUpload({
    pickBtn: document.getElementById("my-profile-photo-pick"),
    fileInput: document.getElementById("my-profile-photo-file"),
    removeBtn: document.getElementById("my-profile-photo-remove"),
    uploadUrl: "/api/users/profile-photo",
    deleteUrl: "/api/users/profile-photo",
    allowedMimeTypes: PROFILE_PHOTO_MIME_TYPES,
    invalidTypeMessage: tr("profile.profilePhotoInvalidType"),
    uploadSuccessMessage: tr("profile.profilePhotoUploaded"),
    removeConfirmMessage: tr("profile.removeProfilePhotoConfirm"),
    removeSuccessMessage: tr("profile.profilePhotoRemoved"),
    uploadFailMessage: tr("profile.profilePhotoUploadFailed"),
    removeFailMessage: tr("profile.profilePhotoRemoveFailed"),
    onProfileUpdated: deps,
  });
  wireSingleUpload({
    pickBtn: document.getElementById("my-profile-id-pick"),
    fileInput: document.getElementById("my-profile-id-file"),
    removeBtn: document.getElementById("my-profile-id-remove"),
    uploadUrl: "/api/users/id-proof",
    deleteUrl: "/api/users/id-proof",
    allowedMimeTypes: ID_PROOF_MIME_TYPES,
    invalidTypeMessage: tr("profile.idProofInvalidType"),
    uploadSuccessMessage: tr("profile.idProofUploaded"),
    removeConfirmMessage: tr("profile.removeIdProofConfirm"),
    removeSuccessMessage: tr("profile.idProofRemoved"),
    uploadFailMessage: tr("profile.idProofUploadFailed"),
    removeFailMessage: tr("profile.idProofRemoveFailed"),
    onProfileUpdated: deps,
  });
}
