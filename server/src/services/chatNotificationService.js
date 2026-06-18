import { prisma } from "../lib/prisma.js";
import { isPushConfigured, sendPushToSubscription } from "../lib/push.js";
import { sendFcmDataMessage } from "../lib/fcm.js";
import { getEmployeeDevicesForUser } from "./fcmPushService.js";

const LOG = "[chat-notify]";

function previewBody(body) {
  const t = String(body || "").trim().replace(/\s+/g, " ");
  if (!t) return "Sent you a message";
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function recipientIdFor(conversation, senderId) {
  return conversation.userLowId === senderId ? conversation.userHighId : conversation.userLowId;
}

/**
 * Notify the other participant when a chat message is sent (web push + FCM).
 * @param {{ id: string, userLowId: string, userHighId: string }} conversation
 * @param {{ id: string, body: string }} message
 * @param {{ id: string, displayName: string }} sender
 */
export async function notifyChatMessage({ conversation, message, sender }) {
  const recipientId = recipientIdFor(conversation, sender.id);
  const title = `New message from ${sender.displayName}`;
  const body = previewBody(message.body);
  const conversationId = conversation.id;

  if (isPushConfigured()) {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: recipientId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    for (const sub of subs) {
      const payload = {
        title,
        body,
        tag: `taskmgr-chat-${conversationId}`,
        type: "chat_message",
        payload: {
          type: "chat_message",
          conversationId,
          senderId: sender.id,
          senderName: sender.displayName,
          messageId: message.id,
          url: `/?openChat=${encodeURIComponent(conversationId)}`,
        },
      };
      const result = await sendPushToSubscription(sub, payload);
      if (result.ok) {
        console.log(`${LOG} web push sent conversationId=${conversationId} recipientId=${recipientId}`);
      } else if (result.gone) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }

  const devices = await getEmployeeDevicesForUser(recipientId);
  for (const device of devices) {
    const result = await sendFcmDataMessage({
      token: device.fcmToken,
      data: {
        type: "chat_message",
        conversationId,
        senderId: sender.id,
        senderName: sender.displayName,
        messageId: message.id,
        title,
        body,
      },
    });
    if (result.ok) {
      console.log(
        `${LOG} FCM sent conversationId=${conversationId} recipientId=${recipientId} deviceId=${device.deviceId}`
      );
    }
  }
}

/**
 * Notify all group members except the sender (web push + FCM).
 * @param {{ id: string, name: string }} group
 * @param {{ id: string, body: string }} message
 * @param {{ id: string, displayName: string }} sender
 */
export async function notifyGroupMessage({ group, message, sender }) {
  const members = await prisma.chatGroupMember.findMany({
    where: { groupId: group.id, userId: { not: sender.id } },
    select: { userId: true },
  });
  const title = `${group.name}`;
  const body = `${sender.displayName}: ${previewBody(message.body)}`;
  const openChatId = `g:${group.id}`;

  for (const { userId: recipientId } of members) {
    if (isPushConfigured()) {
      const subs = await prisma.pushSubscription.findMany({
        where: { userId: recipientId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      for (const sub of subs) {
        const payload = {
          title,
          body,
          tag: `taskmgr-chat-${group.id}`,
          type: "chat_message",
          payload: {
            type: "chat_message",
            conversationId: openChatId,
            groupId: group.id,
            senderId: sender.id,
            senderName: sender.displayName,
            messageId: message.id,
            url: `/?openChat=${encodeURIComponent(openChatId)}`,
          },
        };
        const result = await sendPushToSubscription(sub, payload);
        if (result.ok) {
          console.log(`${LOG} group web push sent groupId=${group.id} recipientId=${recipientId}`);
        } else if (result.gone) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    const devices = await getEmployeeDevicesForUser(recipientId);
    for (const device of devices) {
      const result = await sendFcmDataMessage({
        token: device.fcmToken,
        data: {
          type: "chat_message",
          conversationId: openChatId,
          groupId: group.id,
          senderId: sender.id,
          senderName: sender.displayName,
          messageId: message.id,
          title,
          body,
        },
      });
      if (result.ok) {
        console.log(
          `${LOG} group FCM sent groupId=${group.id} recipientId=${recipientId} deviceId=${device.deviceId}`
        );
      }
    }
  }
}
