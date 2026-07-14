import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { chatUploadsRoot, removeChatAttachmentFile } from "../lib/chatUpload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

export const USER_STORAGE_QUOTA_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB per user

const completionProofsRoot = path.join(uploadsRoot, "completion-proofs");
const progressUpdateAttachmentsRoot = path.join(uploadsRoot, "task-progress-update-attachments");
const assignmentAttachmentsRoot = path.join(uploadsRoot, "task-assignment-attachments");
const profilePhotoUploadsRoot = path.join(uploadsRoot, "profile-photos");
const idProofUploadsRoot = path.join(uploadsRoot, "id-proofs");

const UUID_RE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSIGNMENT_UPLOADER_RE = new RegExp(`^${UUID_RE}-(${UUID_RE})-`, "i");

/**
 * @param {string | null | undefined} root
 * @param {string | null | undefined} storedName
 */
function resolveUploadPath(root, storedName) {
  if (!root || !storedName || /[\\/]/.test(storedName)) return null;
  return path.join(root, path.basename(storedName));
}

/** @param {string | null | undefined} absolutePath */
function fileSizeOrZero(absolutePath) {
  if (!absolutePath) return 0;
  try {
    if (!fs.existsSync(absolutePath)) return 0;
    return fs.statSync(absolutePath).size || 0;
  } catch {
    return 0;
  }
}

/** @param {string | null | undefined} storedName */
export function assignmentAttachmentUploaderId(storedName) {
  if (!storedName) return null;
  const m = ASSIGNMENT_UPLOADER_RE.exec(path.basename(storedName));
  return m?.[1] ?? null;
}

/**
 * @param {string} userId
 * @param {Map<string, number>} bucket
 * @param {string} category
 * @param {number} bytes
 */
function addBytes(bucket, userId, category, bytes) {
  if (!userId || !bytes) return;
  const key = `${userId}::${category}`;
  bucket.set(key, (bucket.get(key) ?? 0) + bytes);
}

/**
 * Collect disk usage for one or many users (uploader attribution).
 * Counts: task proofs, progress-update media, chat files, profile docs,
 * and assignment attachments uploaded by that user (from filename).
 *
 * @param {string[]} userIds
 */
export async function getStorageUsageForUsers(userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  const idSet = new Set(ids);
  /** @type {Map<string, number>} */
  const bucket = new Map();
  /** @type {Map<string, Set<string>>} */
  const seen = new Map();

  /**
   * @param {string} userId
   * @param {string} category
   * @param {string | null} absolutePath
   */
  const credit = (userId, category, absolutePath) => {
    if (!userId || !absolutePath || !idSet.has(userId)) return;
    let set = seen.get(userId);
    if (!set) {
      set = new Set();
      seen.set(userId, set);
    }
    if (set.has(absolutePath)) return;
    set.add(absolutePath);
    addBytes(bucket, userId, category, fileSizeOrZero(absolutePath));
  };

  if (!ids.length) {
    return emptyResults([]);
  }

  const [
    users,
    submissionProofs,
    assigneeLegacy,
    progressAttachments,
    dmMessages,
    groupMessages,
    assignmentAttachments,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        profilePhotoPath: true,
        idProofPath: true,
      },
    }),
    prisma.taskSubmissionProof.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, filePath: true },
    }),
    prisma.taskAssignee.findMany({
      where: { userId: { in: ids } },
      select: {
        userId: true,
        completionProofPath: true,
        lastCompletionProofPath: true,
      },
    }),
    prisma.taskProgressUpdateAttachment.findMany({
      where: { update: { userId: { in: ids } } },
      select: {
        filePath: true,
        update: { select: { userId: true } },
      },
    }),
    prisma.chatMessage.findMany({
      where: {
        senderId: { in: ids },
        NOT: { attachmentPath: null },
      },
      select: { senderId: true, attachmentPath: true },
    }),
    prisma.chatGroupMessage.findMany({
      where: {
        senderId: { in: ids },
        NOT: { attachmentPath: null },
      },
      select: { senderId: true, attachmentPath: true },
    }),
    prisma.taskAssignmentAttachment.findMany({
      where:
        ids.length === 1
          ? { filePath: { contains: `-${ids[0]}-` } }
          : undefined,
      select: { filePath: true },
    }),
  ]);

  for (const u of users) {
    credit(u.id, "profile", resolveUploadPath(profilePhotoUploadsRoot, u.profilePhotoPath));
    credit(u.id, "profile", resolveUploadPath(idProofUploadsRoot, u.idProofPath));
  }

  for (const row of submissionProofs) {
    credit(row.userId, "taskProofs", resolveUploadPath(completionProofsRoot, row.filePath));
  }

  for (const row of assigneeLegacy) {
    credit(row.userId, "taskProofs", resolveUploadPath(completionProofsRoot, row.completionProofPath));
    credit(row.userId, "taskProofs", resolveUploadPath(completionProofsRoot, row.lastCompletionProofPath));
  }

  for (const row of progressAttachments) {
    credit(
      row.update.userId,
      "progressUpdates",
      resolveUploadPath(progressUpdateAttachmentsRoot, row.filePath)
    );
  }

  for (const row of dmMessages) {
    credit(row.senderId, "chat", resolveUploadPath(chatUploadsRoot, row.attachmentPath));
  }

  for (const row of groupMessages) {
    credit(row.senderId, "chat", resolveUploadPath(chatUploadsRoot, row.attachmentPath));
  }

  for (const row of assignmentAttachments) {
    const uploaderId = assignmentAttachmentUploaderId(row.filePath);
    if (!uploaderId) continue;
    credit(
      uploaderId,
      "assignmentAttachments",
      resolveUploadPath(assignmentAttachmentsRoot, row.filePath)
    );
  }

  return emptyResults(ids).map(({ userId }) => summarizeUser(userId, bucket));
}

/**
 * @param {string[]} ids
 */
function emptyResults(ids) {
  return ids.map((userId) => ({ userId }));
}

/**
 * @param {string} userId
 * @param {Map<string, number>} bucket
 */
function summarizeUser(userId, bucket) {
  const categories = {
    taskProofs: bucket.get(`${userId}::taskProofs`) ?? 0,
    progressUpdates: bucket.get(`${userId}::progressUpdates`) ?? 0,
    chat: bucket.get(`${userId}::chat`) ?? 0,
    profile: bucket.get(`${userId}::profile`) ?? 0,
    assignmentAttachments: bucket.get(`${userId}::assignmentAttachments`) ?? 0,
  };
  const usedBytes = Object.values(categories).reduce((sum, n) => sum + n, 0);
  const quotaBytes = USER_STORAGE_QUOTA_BYTES;
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  const percentUsed =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0;

  return {
    userId,
    usedBytes,
    quotaBytes,
    remainingBytes,
    percentUsed,
    overQuota: usedBytes > quotaBytes,
    byCategory: categories,
  };
}

/** @param {string} userId */
export async function getUserStorageUsage(userId) {
  const [row] = await getStorageUsageForUsers([userId]);
  return row ?? summarizeUser(userId, new Map());
}

export const STORAGE_FILE_CATEGORIES = ["tasks", "chat", "profile", "assignment"];

/**
 * @param {string | null | undefined} mime
 * @param {string | null | undefined} name
 */
function mediaKindFromMime(mime, name) {
  const m = String(mime || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  if (m.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/i.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(webm|m4a|mp3|ogg|wav|aac)$/i.test(n)) return "audio";
  if (m === "application/pdf" || /\.pdf$/i.test(n)) return "pdf";
  return "file";
}

/**
 * @param {{
 *   id: string,
 *   category: string,
 *   kind: string,
 *   name: string,
 *   sizeBytes: number,
 *   createdAt: string | null,
 *   url: string,
 *   subtitle?: string | null,
 * }} item
 */
function pushFile(out, item) {
  if (!item?.id || !item.url) return;
  out.push({
    id: item.id,
    category: item.category,
    kind: item.kind,
    name: item.name || "File",
    sizeBytes: item.sizeBytes || 0,
    createdAt: item.createdAt,
    url: item.url,
    subtitle: item.subtitle || null,
  });
}

/** @param {string | null | undefined} absolutePath */
function sizeAndExists(absolutePath) {
  if (!absolutePath || !fs.existsSync(absolutePath)) return 0;
  try {
    return fs.statSync(absolutePath).size || 0;
  } catch {
    return 0;
  }
}

/**
 * List files counting toward a user's quota, grouped category as Settings shows.
 * @param {string} userId
 * @param {"tasks"|"chat"|"profile"|"assignment"} category
 */
export async function listUserStorageFiles(userId, category) {
  /** @type {any[]} */
  const files = [];

  if (category === "tasks") {
    const [proofs, assignees, progress] = await Promise.all([
      prisma.taskSubmissionProof.findMany({
        where: { userId },
        select: {
          id: true,
          taskId: true,
          filePath: true,
          createdAt: true,
          archived: true,
          assignee: { include: { task: { select: { title: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.taskAssignee.findMany({
        where: { userId },
        select: {
          taskId: true,
          completionProofPath: true,
          lastCompletionProofPath: true,
          lastSubmittedAt: true,
          task: { select: { title: true } },
        },
      }),
      prisma.taskProgressUpdateAttachment.findMany({
        where: { update: { userId } },
        select: {
          id: true,
          filePath: true,
          mimeType: true,
          kind: true,
          originalName: true,
          createdAt: true,
          update: {
            select: {
              taskId: true,
              task: { select: { title: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const proofPathSet = new Set(proofs.map((p) => p.filePath).filter(Boolean));

    for (const p of proofs) {
      const abs = resolveUploadPath(completionProofsRoot, p.filePath);
      const size = sizeAndExists(abs);
      if (!size) continue;
      const name = path.basename(p.filePath);
      pushFile(files, {
        id: `proof:${p.id}`,
        category: "tasks",
        kind: mediaKindFromMime("", name),
        name,
        sizeBytes: size,
        createdAt: p.createdAt?.toISOString?.() ?? null,
        url: `/api/tasks/${p.taskId}/completion-proof/${userId}/${p.id}${p.archived ? "?archived=1" : ""}`,
        subtitle: p.assignee?.task?.title || null,
      });
    }

    for (const a of assignees) {
      for (const [slot, stored] of [
        ["current", a.completionProofPath],
        ["archived", a.lastCompletionProofPath],
      ]) {
        if (!stored || proofPathSet.has(stored)) continue;
        const abs = resolveUploadPath(completionProofsRoot, stored);
        const size = sizeAndExists(abs);
        if (!size) continue;
        const name = path.basename(stored);
        pushFile(files, {
          id: `proof-legacy:${a.taskId}:${slot}`,
          category: "tasks",
          kind: mediaKindFromMime("", name),
          name,
          sizeBytes: size,
          createdAt: a.lastSubmittedAt?.toISOString?.() ?? null,
          url: `/api/tasks/${a.taskId}/completion-proof/${userId}${slot === "archived" ? "?archived=1" : ""}`,
          subtitle: a.task?.title || null,
        });
      }
    }

    for (const p of progress) {
      const abs = resolveUploadPath(progressUpdateAttachmentsRoot, p.filePath);
      const size = sizeAndExists(abs);
      if (!size) continue;
      const name = p.originalName || path.basename(p.filePath);
      const kind =
        p.kind === "voice"
          ? "audio"
          : p.kind === "pdf" || p.kind === "image" || p.kind === "video"
            ? p.kind
            : mediaKindFromMime(p.mimeType, name);
      pushFile(files, {
        id: `progress:${p.id}`,
        category: "tasks",
        kind,
        name,
        sizeBytes: size,
        createdAt: p.createdAt?.toISOString?.() ?? null,
        url: `/api/tasks/${p.update.taskId}/progress-updates/attachments/${p.id}`,
        subtitle: p.update?.task?.title || null,
      });
    }
  } else if (category === "chat") {
    const [dms, groups] = await Promise.all([
      prisma.chatMessage.findMany({
        where: {
          senderId: userId,
          deletedAt: null,
          NOT: { attachmentPath: null },
        },
        select: {
          id: true,
          attachmentPath: true,
          attachmentMime: true,
          attachmentName: true,
          createdAt: true,
          conversationId: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.chatGroupMessage.findMany({
        where: {
          senderId: userId,
          deletedAt: null,
          NOT: { attachmentPath: null },
        },
        select: {
          id: true,
          attachmentPath: true,
          attachmentMime: true,
          attachmentName: true,
          createdAt: true,
          groupId: true,
          group: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    for (const m of dms) {
      const abs = resolveUploadPath(chatUploadsRoot, m.attachmentPath);
      const size = sizeAndExists(abs);
      if (!size) continue;
      const name = m.attachmentName || path.basename(m.attachmentPath);
      pushFile(files, {
        id: `chat-dm:${m.id}`,
        category: "chat",
        kind: mediaKindFromMime(m.attachmentMime, name),
        name,
        sizeBytes: size,
        createdAt: m.createdAt?.toISOString?.() ?? null,
        url: `/api/chat/files/dm/${m.id}`,
        subtitle: "Direct message",
      });
    }

    for (const m of groups) {
      const abs = resolveUploadPath(chatUploadsRoot, m.attachmentPath);
      const size = sizeAndExists(abs);
      if (!size) continue;
      const name = m.attachmentName || path.basename(m.attachmentPath);
      pushFile(files, {
        id: `chat-group:${m.id}`,
        category: "chat",
        kind: mediaKindFromMime(m.attachmentMime, name),
        name,
        sizeBytes: size,
        createdAt: m.createdAt?.toISOString?.() ?? null,
        url: `/api/chat/files/group/${m.id}`,
        subtitle: m.group?.name || "Group chat",
      });
    }
  } else if (category === "profile") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        profilePhotoPath: true,
        profilePhotoName: true,
        profilePhotoMime: true,
        idProofPath: true,
        idProofName: true,
        idProofMime: true,
      },
    });
    if (user?.profilePhotoPath) {
      const abs = resolveUploadPath(profilePhotoUploadsRoot, user.profilePhotoPath);
      const size = sizeAndExists(abs);
      if (size) {
        pushFile(files, {
          id: "profile:photo",
          category: "profile",
          kind: mediaKindFromMime(user.profilePhotoMime, user.profilePhotoName),
          name: user.profilePhotoName || "Profile photo",
          sizeBytes: size,
          createdAt: null,
          url: "/api/users/profile-photo",
          subtitle: "Profile photo",
        });
      }
    }
    if (user?.idProofPath) {
      const abs = resolveUploadPath(idProofUploadsRoot, user.idProofPath);
      const size = sizeAndExists(abs);
      if (size) {
        pushFile(files, {
          id: "profile:idProof",
          category: "profile",
          kind: mediaKindFromMime(user.idProofMime, user.idProofName),
          name: user.idProofName || "ID proof",
          sizeBytes: size,
          createdAt: null,
          url: "/api/users/id-proof",
          subtitle: "ID proof",
        });
      }
    }
  } else if (category === "assignment") {
    const rows = await prisma.taskAssignmentAttachment.findMany({
      where: { filePath: { contains: `-${userId}-` } },
      select: {
        id: true,
        taskId: true,
        filePath: true,
        mimeType: true,
        kind: true,
        originalName: true,
        createdAt: true,
        task: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    for (const row of rows) {
      if (assignmentAttachmentUploaderId(row.filePath) !== userId) continue;
      const abs = resolveUploadPath(assignmentAttachmentsRoot, row.filePath);
      const size = sizeAndExists(abs);
      if (!size) continue;
      const name = row.originalName || path.basename(row.filePath);
      const kind =
        row.kind === "voice"
          ? "audio"
          : row.kind === "pdf" || row.kind === "image" || row.kind === "video"
            ? row.kind
            : mediaKindFromMime(row.mimeType, name);
      pushFile(files, {
        id: `assignment:${row.id}`,
        category: "assignment",
        kind,
        name,
        sizeBytes: size,
        createdAt: row.createdAt?.toISOString?.() ?? null,
        url: `/api/tasks/${row.taskId}/assignment-attachments/${row.id}`,
        subtitle: row.task?.title || null,
      });
    }
  }

  files.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return files;
}

/**
 * Delete one storage file owned by the user (frees quota).
 * @param {string} userId
 * @param {string} fileId
 */
export async function deleteUserStorageFile(userId, fileId) {
  const id = String(fileId || "");

  if (id.startsWith("proof:")) {
    const proofId = id.slice("proof:".length);
    const row = await prisma.taskSubmissionProof.findFirst({
      where: { id: proofId, userId },
    });
    if (!row) throw Object.assign(new Error("File not found."), { status: 404 });
    const abs = resolveUploadPath(completionProofsRoot, row.filePath);
    await prisma.taskSubmissionProof.delete({ where: { id: row.id } });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    // Clear legacy columns if they pointed at the same file
    const assignee = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: row.taskId, userId } },
    });
    if (assignee) {
      const data = {};
      if (assignee.completionProofPath === row.filePath) data.completionProofPath = null;
      if (assignee.lastCompletionProofPath === row.filePath) data.lastCompletionProofPath = null;
      if (Object.keys(data).length) {
        await prisma.taskAssignee.update({
          where: { taskId_userId: { taskId: row.taskId, userId } },
          data,
        });
      }
    }
    return { ok: true };
  }

  if (id.startsWith("proof-legacy:")) {
    const parts = id.split(":");
    const taskId = parts[1];
    const slot = parts[2];
    if (!taskId || (slot !== "current" && slot !== "archived")) {
      throw Object.assign(new Error("File not found."), { status: 404 });
    }
    const assignee = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId, userId } },
    });
    if (!assignee) throw Object.assign(new Error("File not found."), { status: 404 });
    const stored =
      slot === "current" ? assignee.completionProofPath : assignee.lastCompletionProofPath;
    if (!stored) throw Object.assign(new Error("File not found."), { status: 404 });
    const abs = resolveUploadPath(completionProofsRoot, stored);
    await prisma.taskAssignee.update({
      where: { taskId_userId: { taskId, userId } },
      data: slot === "current" ? { completionProofPath: null } : { lastCompletionProofPath: null },
    });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  if (id.startsWith("progress:")) {
    const attachmentId = id.slice("progress:".length);
    const row = await prisma.taskProgressUpdateAttachment.findFirst({
      where: { id: attachmentId, update: { userId } },
      include: { update: { select: { userId: true } } },
    });
    if (!row) throw Object.assign(new Error("File not found."), { status: 404 });
    const abs = resolveUploadPath(progressUpdateAttachmentsRoot, row.filePath);
    await prisma.taskProgressUpdateAttachment.delete({ where: { id: row.id } });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  if (id.startsWith("chat-dm:")) {
    const messageId = id.slice("chat-dm:".length);
    const msg = await prisma.chatMessage.findFirst({
      where: { id: messageId, senderId: userId, deletedAt: null },
    });
    if (!msg?.attachmentPath) throw Object.assign(new Error("File not found."), { status: 404 });
    removeChatAttachmentFile(msg.attachmentPath);
    await prisma.chatMessage.update({
      where: { id: msg.id },
      data: {
        attachmentPath: null,
        attachmentMime: null,
        attachmentName: null,
      },
    });
    return { ok: true };
  }

  if (id.startsWith("chat-group:")) {
    const messageId = id.slice("chat-group:".length);
    const msg = await prisma.chatGroupMessage.findFirst({
      where: { id: messageId, senderId: userId, deletedAt: null },
    });
    if (!msg?.attachmentPath) throw Object.assign(new Error("File not found."), { status: 404 });
    removeChatAttachmentFile(msg.attachmentPath);
    await prisma.chatGroupMessage.update({
      where: { id: msg.id },
      data: {
        attachmentPath: null,
        attachmentMime: null,
        attachmentName: null,
      },
    });
    return { ok: true };
  }

  if (id === "profile:photo") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { profilePhotoPath: true },
    });
    if (!user?.profilePhotoPath) throw Object.assign(new Error("File not found."), { status: 404 });
    const abs = resolveUploadPath(profilePhotoUploadsRoot, user.profilePhotoPath);
    await prisma.user.update({
      where: { id: userId },
      data: {
        profilePhotoPath: null,
        profilePhotoMime: null,
        profilePhotoName: null,
      },
    });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  if (id === "profile:idProof") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { idProofPath: true },
    });
    if (!user?.idProofPath) throw Object.assign(new Error("File not found."), { status: 404 });
    const abs = resolveUploadPath(idProofUploadsRoot, user.idProofPath);
    await prisma.user.update({
      where: { id: userId },
      data: {
        idProofPath: null,
        idProofMime: null,
        idProofName: null,
      },
    });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  if (id.startsWith("assignment:")) {
    const attachmentId = id.slice("assignment:".length);
    const row = await prisma.taskAssignmentAttachment.findFirst({
      where: { id: attachmentId },
    });
    if (!row || assignmentAttachmentUploaderId(row.filePath) !== userId) {
      throw Object.assign(new Error("File not found."), { status: 404 });
    }
    const abs = resolveUploadPath(assignmentAttachmentsRoot, row.filePath);
    await prisma.taskAssignmentAttachment.delete({ where: { id: row.id } });
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  throw Object.assign(new Error("File not found."), { status: 404 });
}
