import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { chatUploadsRoot } from "../lib/chatUpload.js";

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
