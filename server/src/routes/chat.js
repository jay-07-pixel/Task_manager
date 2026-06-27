import { Router } from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { userHasAdminAccess } from "../lib/adminUsers.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";
import { notifyChatMessage, notifyGroupMessage } from "../services/chatNotificationService.js";
import { addChatLiveClient, removeChatLiveClient, publishChatLive } from "../lib/chatLive.js";
import { getChatTypingUsers, setChatTyping } from "../lib/chatTyping.js";
import {
  attachmentFilePath,
  CHAT_MESSAGE_DELETE_MS,
  copyChatAttachment,
  dmMessageSelect,
  groupMessageSelect,
  handleChatFileUpload,
  isInlineAttachmentMime,
  messagePreviewLabel,
  parseOutgoingChatMessage,
  resolveAttachmentContentType,
  serializeChatMessage,
  serializeLastMessage,
  serveChatAttachment,
} from "../lib/chatUpload.js";

const router = Router();

function parseMessagesAfterQuery(req) {
  const raw = typeof req.query.after === "string" ? req.query.after.trim() : "";
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseMessagesBeforeQuery(req) {
  const raw = typeof req.query.before === "string" ? req.query.before.trim() : "";
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function loadThreadMessages(model, whereBase, after, before, select) {
  if (after && before) {
    return prisma[model].findMany({
      where: { ...whereBase, createdAt: { gte: after, lt: before } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select,
    });
  }
  if (after) {
    return prisma[model].findMany({
      where: { ...whereBase, createdAt: { gte: after } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select,
    });
  }
  const latest = await prisma[model].findMany({
    where: whereBase,
    orderBy: { createdAt: "desc" },
    take: 200,
    select,
  });
  return latest.reverse();
}

const createConversationSchema = z.object({
  peerUserId: z.string().uuid(),
});

const lastDmMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  readAt: true,
  deletedAt: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
};

const lastGroupMessageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  deletedAt: true,
  attachmentPath: true,
  attachmentMime: true,
  attachmentName: true,
  sender: { select: { displayName: true } },
};

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().uuid()).optional(),
  includeEveryone: z.boolean().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  memberIds: z.array(z.string().uuid()).min(1).optional(),
});

const forwardMessageSchema = z.object({
  from: z.object({
    threadType: z.enum(["dm", "group"]),
    threadId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  to: z.object({
    threadType: z.enum(["dm", "group"]),
    threadId: z.string().uuid(),
  }),
});

function canonicalPair(userIdA, userIdB) {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

function userInConversation(conversation, userId) {
  return conversation.userLowId === userId || conversation.userHighId === userId;
}

function peerFromConversation(conversation, userId) {
  return conversation.userLowId === userId ? conversation.userHigh : conversation.userLow;
}

function dmRecipientId(conversation, senderId) {
  return conversation.userLowId === senderId ? conversation.userHighId : conversation.userLowId;
}

function peerUserId(conversation, userId) {
  return conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId;
}

function groupMessageSeenMeta(message, memberships, meId) {
  if (message.senderId !== meId) return null;
  const created = new Date(message.createdAt).getTime();
  const others = memberships.filter((m) => m.userId !== meId);
  if (!others.length) return null;
  const readBy = others.filter((m) => {
    const since = m.lastReadAt ?? m.joinedAt;
    return since && new Date(since).getTime() >= created;
  });
  return {
    seenCount: readBy.length,
    seenTotal: others.length,
    seenByAll: readBy.length === others.length,
  };
}

function serializeTypingUsers(threadType, threadId, meId) {
  return getChatTypingUsers(threadType, threadId, meId).map((u) => ({
    id: u.userId,
    displayName: u.displayName,
  }));
}

function removeChatAttachmentFile(storedName) {
  if (!storedName) return;
  try {
    const filePath = attachmentFilePath(storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

async function validateDmReply(conversationId, replyToMessageId) {
  if (!replyToMessageId) return null;
  const parent = await prisma.chatMessage.findFirst({
    where: { id: replyToMessageId, conversationId },
    select: { id: true },
  });
  if (!parent) return "Reply message not found in this chat.";
  return null;
}

async function validateGroupReply(groupId, replyToMessageId) {
  if (!replyToMessageId) return null;
  const parent = await prisma.chatGroupMessage.findFirst({
    where: { id: replyToMessageId, groupId },
    select: { id: true },
  });
  if (!parent) return "Reply message not found in this chat.";
  return null;
}

async function softDeleteDmMessage(req, res) {
  const meId = req.session.userId;
  const isAdmin = req.session.role === "owner";
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.messageId },
    include: { conversation: true },
  });
  if (!message || !userInConversation(message.conversation, meId)) {
    return res.status(404).json({ error: "Message not found." });
  }
  if (!isAdmin && message.senderId !== meId) {
    return res.status(403).json({ error: "You can only delete your own messages." });
  }
  if (message.deletedAt) {
    const existing = await prisma.chatMessage.findUnique({
      where: { id: message.id },
      select: dmMessageSelect,
    });
    return res.json({ message: serializeChatMessage(existing, meId, "dm") });
  }
  if (!isAdmin) {
    const age = Date.now() - new Date(message.createdAt).getTime();
    if (age > CHAT_MESSAGE_DELETE_MS) {
      return res.status(400).json({ error: "Messages can only be deleted within 30 minutes of sending." });
    }
  }

  removeChatAttachmentFile(message.attachmentPath);

  const updated = await prisma.chatMessage.update({
    where: { id: message.id },
    data: {
      deletedAt: new Date(),
      body: "",
      attachmentPath: null,
      attachmentMime: null,
      attachmentName: null,
    },
    select: dmMessageSelect,
  });

  const serialized = serializeChatMessage(updated, meId, "dm");
  res.json({ message: serialized });

  publishChatLive([dmRecipientId(message.conversation, meId), meId], {
    kind: "deleted",
    threadType: "dm",
    threadId: message.conversationId,
    messageId: message.id,
    deletedAt: updated.deletedAt.toISOString(),
  });
}

async function softDeleteGroupMessage(req, res) {
  const meId = req.session.userId;
  const isAdmin = req.session.role === "owner";
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  const message = await prisma.chatGroupMessage.findFirst({
    where: { id: req.params.messageId, groupId: membership.groupId },
  });
  if (!message) {
    return res.status(404).json({ error: "Message not found." });
  }
  if (!isAdmin && message.senderId !== meId) {
    return res.status(403).json({ error: "You can only delete your own messages." });
  }
  if (message.deletedAt) {
    const existing = await prisma.chatGroupMessage.findUnique({
      where: { id: message.id },
      select: groupMessageSelect,
    });
    return res.json({ message: serializeChatMessage(existing, meId, "group") });
  }
  if (!isAdmin) {
    const age = Date.now() - new Date(message.createdAt).getTime();
    if (age > CHAT_MESSAGE_DELETE_MS) {
      return res.status(400).json({ error: "Messages can only be deleted within 30 minutes of sending." });
    }
  }

  removeChatAttachmentFile(message.attachmentPath);

  const updated = await prisma.chatGroupMessage.update({
    where: { id: message.id },
    data: {
      deletedAt: new Date(),
      body: "",
      attachmentPath: null,
      attachmentMime: null,
      attachmentName: null,
    },
    select: groupMessageSelect,
  });

  const serialized = serializeChatMessage(updated, meId, "group");
  res.json({ message: serialized });

  const members = await prisma.chatGroupMember.findMany({
    where: { groupId: membership.groupId },
    select: { userId: true },
  });
  publishChatLive(
    members.map((m) => m.userId),
    {
      kind: "deleted",
      threadType: "group",
      threadId: membership.groupId,
      messageId: message.id,
      deletedAt: updated.deletedAt.toISOString(),
    }
  );
}

async function findPeerUser(peerUserId, currentUserId) {
  if (peerUserId === currentUserId) return null;
  return prisma.user.findUnique({
    where: { id: peerUserId },
    select: { id: true, displayName: true, email: true, role: true, isAdmin: true },
  });
}

function serializeContact(user) {
  const isAdmin = userHasAdminAccess(user);
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: isAdmin ? "owner" : "employee",
    roleLabel: isAdmin ? "Admin" : "Employee",
  };
}

router.get("/contacts", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const users = await prisma.user.findMany({
    where: { id: { not: meId } },
    select: { id: true, displayName: true, email: true, role: true, isAdmin: true },
    orderBy: [{ isAdmin: "desc" }, { displayName: "asc" }],
  });
  res.json({ contacts: users.map(serializeContact) });
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const dmCount = await prisma.chatMessage.count({
    where: {
      senderId: { not: meId },
      readAt: null,
      conversation: {
        OR: [{ userLowId: meId }, { userHighId: meId }],
      },
    },
  });

  const memberships = await prisma.chatGroupMember.findMany({
    where: { userId: meId },
    select: { groupId: true, joinedAt: true, lastReadAt: true },
  });
  let groupCount = 0;
  for (const m of memberships) {
    const since = m.lastReadAt ?? m.joinedAt;
    const n = await prisma.chatGroupMessage.count({
      where: {
        groupId: m.groupId,
        senderId: { not: meId },
        createdAt: { gt: since },
      },
    });
    groupCount += n;
  }

  res.json({ count: dmCount + groupCount });
});

router.get("/live", requireAuth, (req, res) => {
  const userId = req.session.userId;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  addChatLiveClient(userId, res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeChatLiveClient(userId, res);
  });
});

router.get("/conversations", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const conversations = await prisma.chatConversation.findMany({
    where: { OR: [{ userLowId: meId }, { userHighId: meId }] },
    include: {
      userLow: { select: { id: true, displayName: true, email: true, role: true } },
      userHigh: { select: { id: true, displayName: true, email: true, role: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: lastDmMessageSelect,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const unreadGroups = await prisma.chatMessage.groupBy({
    by: ["conversationId"],
    where: {
      senderId: { not: meId },
      readAt: null,
      conversation: { OR: [{ userLowId: meId }, { userHighId: meId }] },
    },
    _count: { _all: true },
  });
  const unreadByConv = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

  res.json({
    conversations: conversations.map((c) => {
      const peer = peerFromConversation(c, meId);
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        peer: serializeContact(peer),
        lastMessage: last
          ? serializeLastMessage(
              {
                ...last,
                senderName: last.senderId === meId ? "You" : peer.displayName,
              },
              meId,
              peer.displayName
            )
          : null,
        unreadCount: unreadByConv.get(c.id) ?? 0,
        updatedAt: c.updatedAt,
      };
    }),
  });
});

async function unreadCountForGroup(meId, groupId, joinedAt, lastReadAt) {
  const since = lastReadAt ?? joinedAt;
  return prisma.chatGroupMessage.count({
    where: {
      groupId,
      senderId: { not: meId },
      createdAt: { gt: since },
    },
  });
}

router.get("/threads", requireAuth, async (req, res) => {
  const meId = req.session.userId;

  const conversations = await prisma.chatConversation.findMany({
    where: { OR: [{ userLowId: meId }, { userHighId: meId }] },
    include: {
      userLow: { select: { id: true, displayName: true, email: true, role: true } },
      userHigh: { select: { id: true, displayName: true, email: true, role: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: lastDmMessageSelect,
      },
    },
  });

  const unreadGroups = await prisma.chatMessage.groupBy({
    by: ["conversationId"],
    where: {
      senderId: { not: meId },
      readAt: null,
      conversation: { OR: [{ userLowId: meId }, { userHighId: meId }] },
    },
    _count: { _all: true },
  });
  const unreadByConv = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

  const memberships = await prisma.chatGroupMember.findMany({
    where: { userId: meId },
    include: {
      group: {
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: lastGroupMessageSelect,
          },
          _count: { select: { members: true } },
        },
      },
    },
  });

  const dmThreads = await Promise.all(
    conversations.map(async (c) => {
      const peer = peerFromConversation(c, meId);
      const last = c.messages[0] ?? null;
      return {
        type: "dm",
        id: c.id,
        peer: serializeContact(peer),
        group: null,
        lastMessage: last
          ? serializeLastMessage(
              {
                ...last,
                senderName: last.senderId === meId ? "You" : peer.displayName,
              },
              meId,
              peer.displayName
            )
          : null,
        unreadCount: unreadByConv.get(c.id) ?? 0,
        updatedAt: c.updatedAt,
      };
    })
  );

  const groupThreads = await Promise.all(
    memberships.map(async (m) => {
      const g = m.group;
      const last = g.messages[0] ?? null;
      const unreadCount = await unreadCountForGroup(meId, g.id, m.joinedAt, m.lastReadAt);
      return {
        type: "group",
        id: g.id,
        peer: null,
        group: {
          id: g.id,
          name: g.name,
          memberCount: g._count.members,
        },
        lastMessage: last
          ? serializeLastMessage(
              {
                ...last,
                senderName:
                  last.senderId === meId ? "You" : last.sender?.displayName || "Member",
              },
              meId,
              last.sender?.displayName || "Member"
            )
          : null,
        unreadCount,
        updatedAt: g.updatedAt,
      };
    })
  );

  const threads = [...dmThreads, ...groupThreads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  res.json({ threads });
});

router.post("/conversations", requireAuth, async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid peer user." });
  }

  const meId = req.session.userId;
  const peer = await findPeerUser(parsed.data.peerUserId, meId);
  if (!peer) {
    return res.status(404).json({ error: "User not found." });
  }

  const [userLowId, userHighId] = canonicalPair(meId, peer.id);
  const conversation = await prisma.chatConversation.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { userLowId, userHighId },
    update: {},
    include: {
      userLow: { select: { id: true, displayName: true, email: true, role: true } },
      userHigh: { select: { id: true, displayName: true, email: true, role: true } },
    },
  });

  res.json({
    conversation: {
      id: conversation.id,
      peer: serializeContact(peerFromConversation(conversation, meId)),
      lastMessage: null,
      unreadCount: 0,
      updatedAt: conversation.updatedAt,
    },
  });
});

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: req.params.id },
    include: {
      userLow: { select: { id: true, displayName: true, email: true, role: true } },
      userHigh: { select: { id: true, displayName: true, email: true, role: true } },
    },
  });
  if (!conversation || !userInConversation(conversation, meId)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const after = parseMessagesAfterQuery(req);
  const before = parseMessagesBeforeQuery(req);
  const messages = await loadThreadMessages(
    "chatMessage",
    { conversationId: conversation.id },
    after,
    before,
    dmMessageSelect
  );

  res.json({
    conversation: {
      id: conversation.id,
      peer: serializeContact(peerFromConversation(conversation, meId)),
    },
    messages: messages.map((m) => serializeChatMessage(m, meId, "dm")),
    typingUsers: serializeTypingUsers("dm", conversation.id, meId),
  });
});

router.post("/conversations/:id/messages", requireAuth, handleChatFileUpload, async (req, res) => {
  const parsed = parseOutgoingChatMessage(req);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const meId = req.session.userId;
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: req.params.id },
  });
  if (!conversation || !userInConversation(conversation, meId)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const replyErr = await validateDmReply(conversation.id, parsed.replyToMessageId);
  if (replyErr) {
    return res.status(400).json({ error: replyErr });
  }

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: meId,
        body: parsed.body,
        attachmentPath: parsed.attachmentPath,
        attachmentMime: parsed.attachmentMime,
        attachmentName: parsed.attachmentName,
        replyToMessageId: parsed.replyToMessageId,
      },
      select: dmMessageSelect,
    }),
    prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  const serialized = serializeChatMessage(message, meId, "dm");
  res.status(201).json({ message: serialized });

  void notifyChatMessage({
    conversation,
    message: {
      id: message.id,
      body: messagePreviewLabel(message.body, message.attachmentMime, message.attachmentName),
    },
    sender: { id: message.sender.id, displayName: message.sender.displayName },
  }).catch((err) => {
    console.error("[chat] notify failed", err?.message ?? err);
  });

  publishChatLive([dmRecipientId(conversation, meId), meId], {
    kind: "message",
    threadType: "dm",
    threadId: conversation.id,
    messageId: message.id,
    senderId: meId,
  });
});

router.delete("/conversations/:id/messages/:messageId", requireAuth, (req, res) => {
  void softDeleteDmMessage(req, res);
});

router.post("/conversations/:id/read", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: req.params.id },
  });
  if (!conversation || !userInConversation(conversation, meId)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const result = await prisma.chatMessage.updateMany({
    where: {
      conversationId: conversation.id,
      senderId: { not: meId },
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  const readAt = new Date().toISOString();
  if (result.count > 0) {
    publishChatLive([peerUserId(conversation, meId)], {
      kind: "read",
      threadType: "dm",
      threadId: conversation.id,
      readerId: meId,
      readAt,
    });
  }

  res.json({ markedRead: result.count });
});

router.post("/conversations/:id/typing", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const typing = req.body?.typing === true;
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: req.params.id },
    include: {
      userLow: { select: { id: true, displayName: true } },
      userHigh: { select: { id: true, displayName: true } },
    },
  });
  if (!conversation || !userInConversation(conversation, meId)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const me =
    conversation.userLowId === meId ? conversation.userLow : conversation.userHigh;
  setChatTyping({
    threadType: "dm",
    threadId: conversation.id,
    userId: meId,
    displayName: me.displayName,
    typing,
  });

  const peerId = peerUserId(conversation, meId);
  publishChatLive([peerId, meId], {
    kind: "typing",
    threadType: "dm",
    threadId: conversation.id,
    userId: meId,
    displayName: me.displayName,
    typing,
  });

  res.json({ ok: true });
});

router.post("/groups", requireAuth, requireOwner, async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Group name must be 1–80 characters." });
  }

  const meId = req.session.userId;
  const includeEveryone = parsed.data.includeEveryone !== false;
  let memberIds = parsed.data.memberIds ?? [];

  if (includeEveryone || !memberIds.length) {
    const allUsers = await prisma.user.findMany({ select: { id: true } });
    memberIds = allUsers.map((u) => u.id);
  } else {
    memberIds = [...new Set([meId, ...memberIds])];
  }

  const validCount = await prisma.user.count({ where: { id: { in: memberIds } } });
  if (validCount !== memberIds.length) {
    return res.status(400).json({ error: "One or more members were not found." });
  }

  const group = await prisma.chatGroup.create({
    data: {
      name: parsed.data.name,
      createdById: meId,
      members: {
        create: memberIds.map((userId) => ({ userId })),
      },
    },
    include: {
      _count: { select: { members: true } },
    },
  });

  res.status(201).json({
    group: {
      id: group.id,
      name: group.name,
      memberCount: group._count.members,
      updatedAt: group.updatedAt,
    },
  });

  publishChatLive(memberIds, {
    kind: "thread",
    threadType: "group",
    threadId: group.id,
  });
});

router.get("/groups/:id", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
    include: {
      group: {
        include: {
          _count: { select: { members: true } },
          members: {
            include: {
              user: { select: { id: true, displayName: true, email: true, role: true } },
            },
          },
        },
      },
    },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  const { group } = membership;
  res.json({
    group: {
      id: group.id,
      name: group.name,
      memberCount: group._count.members,
      createdById: group.createdById,
      updatedAt: group.updatedAt,
    },
    members: group.members
      .map((m) => serializeContact(m.user))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    canManage: req.session.role === "owner",
  });
});

router.patch("/groups/:id", requireAuth, requireOwner, async (req, res) => {
  const parsed = updateGroupSchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.name && !parsed.data.memberIds)) {
    return res.status(400).json({ error: "Provide a group name and/or at least one member." });
  }

  const meId = req.session.userId;
  const group = await prisma.chatGroup.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!group) {
    return res.status(404).json({ error: "Group not found." });
  }

  let memberIds = parsed.data.memberIds;
  if (memberIds) {
    memberIds = [...new Set([meId, ...memberIds])];
    const validCount = await prisma.user.count({ where: { id: { in: memberIds } } });
    if (validCount !== memberIds.length) {
      return res.status(400).json({ error: "One or more members were not found." });
    }
  }

  const formerMemberIds = group.members.map((m) => m.userId);

  await prisma.$transaction(async (tx) => {
    if (parsed.data.name) {
      await tx.chatGroup.update({
        where: { id: group.id },
        data: { name: parsed.data.name },
      });
    }
    if (memberIds) {
      await tx.chatGroupMember.deleteMany({ where: { groupId: group.id } });
      await tx.chatGroupMember.createMany({
        data: memberIds.map((userId) => ({ groupId: group.id, userId })),
      });
    }
  });

  const updated = await prisma.chatGroup.findUnique({
    where: { id: group.id },
    include: {
      _count: { select: { members: true } },
      members: { select: { userId: true } },
    },
  });

  const notifyIds = [...new Set([...formerMemberIds, ...(updated?.members.map((m) => m.userId) ?? [])])];
  publishChatLive(notifyIds, {
    kind: "thread",
    threadType: "group",
    threadId: group.id,
  });

  res.json({
    group: {
      id: updated.id,
      name: updated.name,
      memberCount: updated._count.members,
      updatedAt: updated.updatedAt,
    },
  });
});

router.delete("/groups/:id", requireAuth, requireOwner, async (req, res) => {
  const group = await prisma.chatGroup.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!group) {
    return res.status(404).json({ error: "Group not found." });
  }

  const memberIds = group.members.map((m) => m.userId);
  await prisma.chatGroup.delete({ where: { id: group.id } });

  publishChatLive(memberIds, {
    kind: "thread_deleted",
    threadType: "group",
    threadId: group.id,
  });

  res.json({ ok: true });
});

router.get("/groups/:id/messages", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
    include: {
      group: {
        include: { _count: { select: { members: true } } },
      },
    },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  const after = parseMessagesAfterQuery(req);
  const before = parseMessagesBeforeQuery(req);
  const messages = await loadThreadMessages(
    "chatGroupMessage",
    { groupId: membership.groupId },
    after,
    before,
    groupMessageSelect
  );

  const members = await prisma.chatGroupMember.findMany({
    where: { groupId: membership.groupId },
    select: {
      userId: true,
      joinedAt: true,
      lastReadAt: true,
    },
  });

  res.json({
    group: {
      id: membership.group.id,
      name: membership.group.name,
      memberCount: membership.group._count.members,
    },
    messages: messages.map((m) => {
      const seen = groupMessageSeenMeta(m, members, meId);
      return serializeChatMessage(m, meId, "group", seen);
    }),
    typingUsers: serializeTypingUsers("group", membership.groupId, meId),
  });
});

router.post("/groups/:id/messages", requireAuth, handleChatFileUpload, async (req, res) => {
  const parsed = parseOutgoingChatMessage(req);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const meId = req.session.userId;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
    include: { group: true },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  const replyErr = await validateGroupReply(membership.groupId, parsed.replyToMessageId);
  if (replyErr) {
    return res.status(400).json({ error: replyErr });
  }

  const [message] = await prisma.$transaction([
    prisma.chatGroupMessage.create({
      data: {
        groupId: membership.groupId,
        senderId: meId,
        body: parsed.body,
        attachmentPath: parsed.attachmentPath,
        attachmentMime: parsed.attachmentMime,
        attachmentName: parsed.attachmentName,
        replyToMessageId: parsed.replyToMessageId,
      },
      select: groupMessageSelect,
    }),
    prisma.chatGroup.update({
      where: { id: membership.groupId },
      data: { updatedAt: new Date() },
    }),
  ]);

  const serialized = serializeChatMessage(message, meId, "group");
  res.status(201).json({ message: serialized });

  void notifyGroupMessage({
    group: membership.group,
    message: {
      id: message.id,
      body: messagePreviewLabel(message.body, message.attachmentMime, message.attachmentName),
    },
    sender: { id: message.sender.id, displayName: message.sender.displayName },
  }).catch((err) => {
    console.error("[chat] group notify failed", err?.message ?? err);
  });

  void prisma.chatGroupMember
    .findMany({
      where: { groupId: membership.groupId },
      select: { userId: true },
    })
    .then((members) => {
      publishChatLive(
        members.map((m) => m.userId),
        {
          kind: "message",
          threadType: "group",
          threadId: membership.groupId,
          messageId: message.id,
          senderId: meId,
        }
      );
    })
    .catch(() => {});
});

router.delete("/groups/:id/messages/:messageId", requireAuth, (req, res) => {
  void softDeleteGroupMessage(req, res);
});

router.post("/groups/:id/read", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  await prisma.chatGroupMember.update({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
    data: { lastReadAt: new Date() },
  });

  const members = await prisma.chatGroupMember.findMany({
    where: { groupId: req.params.id },
    select: { userId: true },
  });
  publishChatLive(
    members.map((m) => m.userId),
    {
      kind: "read",
      threadType: "group",
      threadId: req.params.id,
      readerId: meId,
      readAt: new Date().toISOString(),
    }
  );

  res.json({ markedRead: true });
});

router.post("/groups/:id/typing", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const typing = req.body?.typing === true;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
    include: { user: { select: { displayName: true } } },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  setChatTyping({
    threadType: "group",
    threadId: req.params.id,
    userId: meId,
    displayName: membership.user.displayName,
    typing,
  });

  const members = await prisma.chatGroupMember.findMany({
    where: { groupId: req.params.id },
    select: { userId: true },
  });
  publishChatLive(
    members.map((m) => m.userId),
    {
      kind: "typing",
      threadType: "group",
      threadId: req.params.id,
      userId: meId,
      displayName: membership.user.displayName,
      typing,
    }
  );

  res.json({ ok: true });
});

router.post("/forward", requireAuth, async (req, res) => {
  const parsed = forwardMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid forward request." });
  }

  const meId = req.session.userId;
  const { from, to } = parsed.data;

  if (from.threadType === to.threadType && from.threadId === to.threadId) {
    return res.status(400).json({ error: "Choose a different chat to forward to." });
  }

  /** @type {{ body: string, attachmentPath: string | null, attachmentMime: string | null, attachmentName: string | null, forwardedFromName: string } | null} */
  let payload = null;

  if (from.threadType === "dm") {
    const conversation = await prisma.chatConversation.findUnique({ where: { id: from.threadId } });
    if (!conversation || !userInConversation(conversation, meId)) {
      return res.status(404).json({ error: "Conversation not found." });
    }
    const source = await prisma.chatMessage.findFirst({
      where: { id: from.messageId, conversationId: from.threadId },
      include: { sender: { select: { displayName: true } } },
    });
    if (!source) return res.status(404).json({ error: "Message not found." });
    if (source.deletedAt) return res.status(400).json({ error: "Cannot forward a deleted message." });
    payload = {
      body: source.body,
      attachmentPath: source.attachmentPath,
      attachmentMime: source.attachmentMime,
      attachmentName: source.attachmentName,
      forwardedFromName: source.sender.displayName,
    };
  } else {
    const membership = await prisma.chatGroupMember.findUnique({
      where: { groupId_userId: { groupId: from.threadId, userId: meId } },
    });
    if (!membership) return res.status(404).json({ error: "Group not found." });
    const source = await prisma.chatGroupMessage.findFirst({
      where: { id: from.messageId, groupId: from.threadId },
      include: { sender: { select: { displayName: true } } },
    });
    if (!source) return res.status(404).json({ error: "Message not found." });
    if (source.deletedAt) return res.status(400).json({ error: "Cannot forward a deleted message." });
    payload = {
      body: source.body,
      attachmentPath: source.attachmentPath,
      attachmentMime: source.attachmentMime,
      attachmentName: source.attachmentName,
      forwardedFromName: source.sender.displayName,
    };
  }

  const text = String(payload.body || "").trim();
  if (!text && !payload.attachmentPath) {
    return res.status(400).json({ error: "Nothing to forward." });
  }

  const copiedAttachmentPath = copyChatAttachment(payload.attachmentPath, to.threadId, meId);

  if (to.threadType === "dm") {
    const conversation = await prisma.chatConversation.findUnique({ where: { id: to.threadId } });
    if (!conversation || !userInConversation(conversation, meId)) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: meId,
          body: payload.body,
          attachmentPath: copiedAttachmentPath,
          attachmentMime: copiedAttachmentPath ? payload.attachmentMime : null,
          attachmentName: copiedAttachmentPath ? payload.attachmentName : null,
          forwardedFromName: payload.forwardedFromName,
        },
        select: dmMessageSelect,
      }),
      prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    const serialized = serializeChatMessage(message, meId, "dm");
    res.status(201).json({ message: serialized });

    void notifyChatMessage({
      conversation,
      message: {
        id: message.id,
        body: messagePreviewLabel(message.body, message.attachmentMime, message.attachmentName),
      },
      sender: { id: message.sender.id, displayName: message.sender.displayName },
    }).catch((err) => {
      console.error("[chat] forward notify failed", err?.message ?? err);
    });

    publishChatLive([dmRecipientId(conversation, meId), meId], {
      kind: "message",
      threadType: "dm",
      threadId: conversation.id,
      messageId: message.id,
      senderId: meId,
    });
    return;
  }

  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: to.threadId, userId: meId } },
    include: { group: true },
  });
  if (!membership) {
    return res.status(404).json({ error: "Group not found." });
  }

  const [message] = await prisma.$transaction([
    prisma.chatGroupMessage.create({
      data: {
        groupId: membership.groupId,
        senderId: meId,
        body: payload.body,
        attachmentPath: copiedAttachmentPath,
        attachmentMime: copiedAttachmentPath ? payload.attachmentMime : null,
        attachmentName: copiedAttachmentPath ? payload.attachmentName : null,
        forwardedFromName: payload.forwardedFromName,
      },
      select: groupMessageSelect,
    }),
    prisma.chatGroup.update({
      where: { id: membership.groupId },
      data: { updatedAt: new Date() },
    }),
  ]);

  const serialized = serializeChatMessage(message, meId, "group");
  res.status(201).json({ message: serialized });

  void notifyGroupMessage({
    group: membership.group,
    message: {
      id: message.id,
      body: messagePreviewLabel(message.body, message.attachmentMime, message.attachmentName),
    },
    sender: { id: message.sender.id, displayName: message.sender.displayName },
  }).catch((err) => {
    console.error("[chat] forward group notify failed", err?.message ?? err);
  });

  void prisma.chatGroupMember
    .findMany({
      where: { groupId: membership.groupId },
      select: { userId: true },
    })
    .then((members) => {
      publishChatLive(
        members.map((m) => m.userId),
        {
          kind: "message",
          threadType: "group",
          threadId: membership.groupId,
          messageId: message.id,
          senderId: meId,
        }
      );
    });
});

async function sendDmAttachment(req, res) {
  const meId = req.session.userId;
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.messageId },
    include: { conversation: true },
  });
  if (!message?.attachmentPath || message.deletedAt || !userInConversation(message.conversation, meId)) {
    return res.status(404).json({ error: "File not found." });
  }
  const filePath = attachmentFilePath(message.attachmentPath);
  const safeName = path.basename(message.attachmentName || "file");
  const contentType = resolveAttachmentContentType(message.attachmentMime, message.attachmentName);
  const disposition = isInlineAttachmentMime(message.attachmentMime, message.attachmentName)
    ? "inline"
    : "attachment";
  serveChatAttachment(req, res, filePath, { contentType, safeName, disposition });
}

async function sendGroupAttachment(req, res) {
  const meId = req.session.userId;
  const message = await prisma.chatGroupMessage.findUnique({
    where: { id: req.params.messageId },
    include: { group: { include: { members: { where: { userId: meId }, take: 1 } } } },
  });
  if (!message?.attachmentPath || message.deletedAt || !message.group.members.length) {
    return res.status(404).json({ error: "File not found." });
  }
  const filePath = attachmentFilePath(message.attachmentPath);
  const safeName = path.basename(message.attachmentName || "file");
  const contentType = resolveAttachmentContentType(message.attachmentMime, message.attachmentName);
  const disposition = isInlineAttachmentMime(message.attachmentMime, message.attachmentName)
    ? "inline"
    : "attachment";
  serveChatAttachment(req, res, filePath, { contentType, safeName, disposition });
}

router.get("/files/dm/:messageId", requireAuth, (req, res) => {
  void sendDmAttachment(req, res);
});

router.get("/files/group/:messageId", requireAuth, (req, res) => {
  void sendGroupAttachment(req, res);
});

export default router;
