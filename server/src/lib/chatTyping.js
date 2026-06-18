const TYPING_TTL_MS = 5000;

/** @type {Map<string, { userId: string, displayName: string, expiresAt: number }>} */
const typingByKey = new Map();

/**
 * @param {{ threadType: "dm" | "group"; threadId: string; userId: string; displayName: string; typing: boolean }} opts
 */
export function setChatTyping({ threadType, threadId, userId, displayName, typing }) {
  const key = `${threadType}:${threadId}:${userId}`;
  if (!typing) {
    typingByKey.delete(key);
    return;
  }
  typingByKey.set(key, {
    userId,
    displayName: displayName || "Someone",
    expiresAt: Date.now() + TYPING_TTL_MS,
  });
}

/**
 * @param {"dm"|"group"} threadType
 * @param {string} threadId
 * @param {string} [excludeUserId]
 */
export function getChatTypingUsers(threadType, threadId, excludeUserId = "") {
  const now = Date.now();
  const prefix = `${threadType}:${threadId}:`;
  /** @type {{ userId: string; displayName: string }[]} */
  const users = [];
  for (const [key, val] of typingByKey) {
    if (!key.startsWith(prefix)) continue;
    if (val.userId === excludeUserId) continue;
    if (val.expiresAt <= now) {
      typingByKey.delete(key);
      continue;
    }
    users.push({ userId: val.userId, displayName: val.displayName });
  }
  return users;
}
