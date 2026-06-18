import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const chatUploadsRoot = path.join(__dirname, "..", "..", "uploads", "chat");
fs.mkdirSync(chatUploadsRoot, { recursive: true });

export const CHAT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CHAT_MAX_FILE_MB = 5;

export const chatFileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, chatUploadsRoot);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 16);
      const uid = req.session?.userId || "anon";
      const threadId = req.params.id || "thread";
      cb(null, `${threadId}-${uid}-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: CHAT_MAX_FILE_BYTES },
});

/** @param {import("express").Request} req */
export function handleChatFileUpload(req, res, next) {
  chatFileUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: `File must be ${CHAT_MAX_FILE_MB} MB or smaller.` });
    }
    return next(err);
  });
}

export function isImageMime(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}

export function isVideoMime(mime) {
  return typeof mime === "string" && mime.startsWith("video/");
}

export function isInlineAttachmentMime(mime) {
  return isImageMime(mime) || isVideoMime(mime);
}

export function messagePreviewLabel(body, attachmentMime, attachmentName) {
  const text = String(body || "").trim();
  if (text) return text;
  if (isImageMime(attachmentMime)) return "Photo";
  if (isVideoMime(attachmentMime)) return "Video";
  if (attachmentName) return `File: ${attachmentName}`;
  return "Attachment";
}

export function attachmentFilePath(storedName) {
  return path.join(chatUploadsRoot, path.basename(storedName));
}

const messageSenderSelect = {
  id: true,
  displayName: true,
  role: true,
};

export const dmMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  readAt: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: messageSenderSelect },
};

export const groupMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: messageSenderSelect },
};

/** @param {any} m @param {string} meId @param {"dm"|"group"} threadType */
export function serializeChatMessage(m, meId, threadType) {
  /** @type {Record<string, unknown>} */
  const out = {
    id: m.id,
    body: m.body,
    senderId: m.senderId,
    senderName: m.sender.displayName,
    senderRole: m.sender.role,
    createdAt: m.createdAt,
    isMine: m.senderId === meId,
  };
  if (m.readAt !== undefined) out.readAt = m.readAt;
  if (m.attachmentPath) {
    const urlBase =
      threadType === "group" ? `/api/chat/files/group/${m.id}` : `/api/chat/files/dm/${m.id}`;
    out.attachmentUrl = urlBase;
    out.attachmentMime = m.attachmentMime;
    out.attachmentName = m.attachmentName;
    out.attachmentIsImage = isImageMime(m.attachmentMime);
    out.attachmentIsVideo = isVideoMime(m.attachmentMime);
  }
  return out;
}

/** @param {any} last @param {string} meId */
export function serializeLastMessage(last, meId, senderNameFallback = "Member") {
  if (!last) return null;
  return {
    id: last.id,
    body: messagePreviewLabel(last.body, last.attachmentMime, last.attachmentName),
    senderId: last.senderId,
    senderName: last.senderName ?? (last.senderId === meId ? "You" : senderNameFallback),
    createdAt: last.createdAt,
    isMine: last.senderId === meId,
    hasAttachment: !!last.attachmentPath,
  };
}

/** @param {import("express").Request} req */
export function parseOutgoingChatMessage(req) {
  const file = req.file ?? null;
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body && !file) {
    return { error: "Type a message or attach a file." };
  }
  if (body.length > 4000) {
    return { error: "Message must be 4000 characters or fewer." };
  }
  return {
    body,
    attachmentPath: file?.filename ?? null,
    attachmentMime: file?.mimetype || "application/octet-stream",
    attachmentName: file?.originalname ? path.basename(file.originalname).slice(0, 255) : null,
  };
}
