/** @type {Map<string, Set<import('express').Response>>} */
const clientsByUser = new Map();

/**
 * @param {string} userId
 * @param {import('express').Response} res
 */
export function addChatLiveClient(userId, res) {
  if (!clientsByUser.has(userId)) clientsByUser.set(userId, new Set());
  clientsByUser.get(userId).add(res);
}

/**
 * @param {string} userId
 * @param {import('express').Response} res
 */
export function removeChatLiveClient(userId, res) {
  const set = clientsByUser.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) clientsByUser.delete(userId);
}

/**
 * Push a chat update to one or more users (SSE).
 * @param {string[]} userIds
 * @param {Record<string, unknown>} payload
 */
export function publishChatLive(userIds, payload) {
  const data = JSON.stringify({ ...payload, at: Date.now() });
  const line = `data: ${data}\n\n`;
  for (const userId of new Set(userIds)) {
    const set = clientsByUser.get(userId);
    if (!set) continue;
    for (const res of set) {
      try {
        res.write(line);
      } catch {
        set.delete(res);
      }
    }
    if (!set.size) clientsByUser.delete(userId);
  }
}
