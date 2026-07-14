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
export const CHAT_MESSAGE_DELETE_MS = 30 * 60 * 1000;

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

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".3gp",
  ".3g2",
  ".ogv",
  ".mpeg",
  ".mpg",
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);

const EXT_TO_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp",
  ".3g2": "video/3gpp2",
  ".ogv": "video/ogg",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
};

export function attachmentExtension(fileName) {
  return path.extname(String(fileName || "")).toLowerCase();
}

export function isVideoAttachment(mime, fileName) {
  if (isVideoMime(mime)) return true;
  return VIDEO_EXTENSIONS.has(attachmentExtension(fileName));
}

export function isImageAttachment(mime, fileName) {
  if (isImageMime(mime)) return true;
  return IMAGE_EXTENSIONS.has(attachmentExtension(fileName));
}

/** Correct Content-Type when browser/multer sends application/octet-stream. */
export function resolveAttachmentContentType(mime, fileName) {
  const ext = attachmentExtension(fileName);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  if (mime && mime !== "application/octet-stream") return mime;
  return mime || "application/octet-stream";
}

export function isInlineAttachmentMime(mime, fileName) {
  return isImageAttachment(mime, fileName) || isVideoAttachment(mime, fileName);
}

export function messagePreviewLabel(body, attachmentMime, attachmentName) {
  const text = String(body || "").trim();
  if (text) return text;
  if (isImageAttachment(attachmentMime, attachmentName)) return "Photo";
  if (isVideoAttachment(attachmentMime, attachmentName)) return "Video";
  if (attachmentName) return `File: ${attachmentName}`;
  return "Attachment";
}

export function attachmentFilePath(storedName) {
  return path.join(chatUploadsRoot, path.basename(storedName));
}

/** Delete a chat attachment from disk if present. */
export function removeChatAttachmentFile(storedName) {
  if (!storedName) return;
  try {
    const filePath = attachmentFilePath(storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/** Copy a stored chat attachment into a new file for another thread. */
export function copyChatAttachment(storedName, threadId, userId) {
  if (!storedName) return null;
  const src = attachmentFilePath(storedName);
  if (!fs.existsSync(src)) return null;
  const ext = path.extname(storedName).toLowerCase().slice(0, 16);
  const destName = `${threadId}-${userId}-${randomUUID()}${ext}`;
  const dest = path.join(chatUploadsRoot, destName);
  fs.copyFileSync(src, dest);
  return destName;
}

/**
 * Stream a chat attachment with explicit range support and no-store headers.
 * Avoids Chrome ERR_CACHE_OPERATION_NOT_SUPPORTED on video byte-range requests.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {string} filePath
 * @param {{ contentType: string, safeName: string, disposition: "inline" | "attachment" }} opts
 */
export function serveChatAttachment(req, res, filePath, { contentType, safeName, disposition }) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found." });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const encodedName = String(safeName || "file").replace(/"/g, "_");

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${encodedName}"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader));
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    end = Math.min(end, fileSize - 1);
    if (start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", String(chunkSize));
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader("Content-Length", String(fileSize));
  fs.createReadStream(filePath).pipe(res);
}

const messageSenderSelect = {
  id: true,
  displayName: true,
  role: true,
};

const replyToMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  deletedAt: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: { displayName: true } },
};

export const dmMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  readAt: true,
  deletedAt: true,
  replyToMessageId: true,
  forwardedFromName: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: messageSenderSelect },
  replyTo: { select: replyToMessageSelect },
};

export const groupMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  deletedAt: true,
  replyToMessageId: true,
  forwardedFromName: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: messageSenderSelect },
  replyTo: { select: replyToMessageSelect },
};

/** @param {any} reply */
function serializeReplyTo(reply) {
  if (!reply) return null;
  const deleted = !!reply.deletedAt;
  return {
    id: reply.id,
    senderId: reply.senderId,
    senderName: reply.sender.displayName,
    deleted,
    body: deleted
      ? ""
      : messagePreviewLabel(reply.body, reply.attachmentMime, reply.attachmentName),
  };
}

/** @param {any} m @param {string} meId @param {"dm"|"group"} threadType @param {{ seenCount?: number, seenTotal?: number, seenByAll?: boolean }} [seen] */
export function serializeChatMessage(m, meId, threadType, seen = null) {
  const deleted = !!m.deletedAt;
  /** @type {Record<string, unknown>} */
  const out = {
    id: m.id,
    body: deleted ? "" : m.body,
    senderId: m.senderId,
    senderName: m.sender.displayName,
    senderRole: m.sender.role,
    createdAt: m.createdAt,
    isMine: m.senderId === meId,
    deleted,
    deletedAt: m.deletedAt ?? null,
  };
  if (m.readAt !== undefined) out.readAt = m.readAt;
  if (seen && m.senderId === meId) {
    out.seenCount = seen.seenCount;
    out.seenTotal = seen.seenTotal;
    out.seenByAll = seen.seenByAll;
  }
  if (!deleted && m.attachmentPath) {
    const urlBase =
      threadType === "group" ? `/api/chat/files/group/${m.id}` : `/api/chat/files/dm/${m.id}`;
    out.attachmentUrl = urlBase;
    out.attachmentMime = resolveAttachmentContentType(m.attachmentMime, m.attachmentName);
    out.attachmentName = m.attachmentName;
    out.attachmentIsImage = isImageAttachment(m.attachmentMime, m.attachmentName);
    out.attachmentIsVideo = isVideoAttachment(m.attachmentMime, m.attachmentName);
  }
  if (m.replyTo) {
    out.replyTo = serializeReplyTo(m.replyTo);
  }
  if (!deleted && m.forwardedFromName) {
    out.forwardedFromName = m.forwardedFromName;
  }
  return out;
}

/** @param {any} last @param {string} meId */
export function serializeLastMessage(last, meId, senderNameFallback = "Member") {
  if (!last) return null;
  const deleted = !!last.deletedAt;
  return {
    id: last.id,
    body: deleted
      ? "Message deleted"
      : messagePreviewLabel(last.body, last.attachmentMime, last.attachmentName),
    senderId: last.senderId,
    senderName: last.senderName ?? (last.senderId === meId ? "You" : senderNameFallback),
    createdAt: last.createdAt,
    isMine: last.senderId === meId,
    hasAttachment: !deleted && !!last.attachmentPath,
    deleted,
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
    attachmentMime: file
      ? resolveAttachmentContentType(file.mimetype, file.originalname)
      : null,
    attachmentName: file?.originalname ? path.basename(file.originalname).slice(0, 255) : null,
    replyToMessageId:
      typeof req.body?.replyToMessageId === "string" &&
      /^[0-9a-f-]{36}$/i.test(req.body.replyToMessageId.trim())
        ? req.body.replyToMessageId.trim()
        : null,
  };
}
