import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyChatMessage } from "../services/chatNotificationService.js";

const router = Router();

const createConversationSchema = z.object({
  peerUserId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
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
  const count = await prisma.chatMessage.count({
    where: {
      senderId: { not: meId },
      readAt: null,
      conversation: {
        OR: [{ userLowId: meId }, { userHighId: meId }],
      },
    },
  });
  res.json({ count });
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

export default router;
