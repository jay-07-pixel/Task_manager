import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";
import { notifyChatMessage, notifyGroupMessage } from "../services/chatNotificationService.js";
import { addChatLiveClient, removeChatLiveClient, publishChatLive } from "../lib/chatLive.js";

const router = Router();

const createConversationSchema = z.object({
  peerUserId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().uuid()).optional(),
  includeEveryone: z.boolean().optional(),
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

async function findPeerUser(peerUserId, currentUserId) {
  if (peerUserId === currentUserId) return null;
  return prisma.user.findUnique({
    where: { id: peerUserId },
    select: { id: true, displayName: true, email: true, role: true },
  });
}

function serializeContact(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    roleLabel: user.role === "owner" ? "Admin" : "Employee",
  };
}

router.get("/contacts", requireAuth, async (req, res) => {
  const meId = req.session.userId;
  const users = await prisma.user.findMany({
    where: { id: { not: meId } },
    select: { id: true, displayName: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
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
        select: { id: true, body: true, senderId: true, createdAt: true, readAt: true },
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
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              createdAt: last.createdAt,
              isMine: last.senderId === meId,
            }
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
        select: { id: true, body: true, senderId: true, createdAt: true, readAt: true },
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
            select: {
              id: true,
              body: true,
              senderId: true,
              createdAt: true,
              sender: { select: { displayName: true } },
            },
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
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              senderName: last.senderId === meId ? "You" : peer.displayName,
              createdAt: last.createdAt,
              isMine: last.senderId === meId,
            }
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
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              senderName: last.senderId === meId ? "You" : last.sender.displayName,
              createdAt: last.createdAt,
              isMine: last.senderId === meId,
            }
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

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      readAt: true,
      sender: { select: { id: true, displayName: true, role: true } },
    },
  });

  res.json({
    conversation: {
      id: conversation.id,
      peer: serializeContact(peerFromConversation(conversation, meId)),
    },
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      senderId: m.senderId,
      senderName: m.sender.displayName,
      senderRole: m.sender.role,
      createdAt: m.createdAt,
      readAt: m.readAt,
      isMine: m.senderId === meId,
    })),
  });
});

router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Message must be 1–4000 characters." });
  }

  const meId = req.session.userId;
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: req.params.id },
  });
  if (!conversation || !userInConversation(conversation, meId)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: meId,
        body: parsed.data.body,
      },
      select: {
        id: true,
        body: true,
        senderId: true,
        createdAt: true,
        readAt: true,
        sender: { select: { id: true, displayName: true, role: true } },
      },
    }),
    prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  res.status(201).json({
    message: {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      senderName: message.sender.displayName,
      senderRole: message.sender.role,
      createdAt: message.createdAt,
      readAt: message.readAt,
      isMine: true,
    },
  });

  void notifyChatMessage({
    conversation,
    message: { id: message.id, body: message.body },
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

  res.json({ markedRead: result.count });
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

  const messages = await prisma.chatGroupMessage.findMany({
    where: { groupId: membership.groupId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      sender: { select: { id: true, displayName: true, role: true } },
    },
  });

  res.json({
    group: {
      id: membership.group.id,
      name: membership.group.name,
      memberCount: membership.group._count.members,
    },
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      senderId: m.senderId,
      senderName: m.sender.displayName,
      senderRole: m.sender.role,
      createdAt: m.createdAt,
      isMine: m.senderId === meId,
    })),
  });
});

router.post("/groups/:id/messages", requireAuth, async (req, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Message must be 1–4000 characters." });
  }

  const meId = req.session.userId;
  const membership = await prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: meId } },
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
        body: parsed.data.body,
      },
      select: {
        id: true,
        body: true,
        senderId: true,
        createdAt: true,
        sender: { select: { id: true, displayName: true, role: true } },
      },
    }),
    prisma.chatGroup.update({
      where: { id: membership.groupId },
      data: { updatedAt: new Date() },
    }),
  ]);

  res.status(201).json({
    message: {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      senderName: message.sender.displayName,
      senderRole: message.sender.role,
      createdAt: message.createdAt,
      isMine: true,
    },
  });

  void notifyGroupMessage({
    group: membership.group,
    message: { id: message.id, body: message.body },
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

  res.json({ markedRead: true });
});

export default router;
