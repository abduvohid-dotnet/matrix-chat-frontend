import { EventType, MsgType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import type { UiMessage } from "./useMatrixTimeline";
import { FORWARDED_FROM_KEY } from "../services/matrixForward";

function buildForwardContent(message: UiMessage) {
  const forwardedMeta = {
    sender: message.sender,
    eventId: message.eventId,
    roomId: null,
  };

  if (message.msgtype === MsgType.Image || message.msgtype === MsgType.Video || message.msgtype === MsgType.Audio || message.msgtype === MsgType.File) {
    return {
      body: message.text || "File",
      msgtype: message.msgtype,
      url: message.mediaUrl,
      info: {
        mimetype: message.mediaMime ?? undefined,
        size: message.mediaSize ?? undefined,
      },
      [FORWARDED_FROM_KEY]: forwardedMeta,
    };
  }

  return {
    body: message.text,
    msgtype: MsgType.Text,
    [FORWARDED_FROM_KEY]: forwardedMeta,
  };
}

export function useMatrixForward() {
  const { client } = useMatrix();

  const forwardMessage = async (targetRoomId: string, message: UiMessage) => {
    if (!client || !targetRoomId) {
      throw new Error("Matrix client is not ready");
    }

    if (!message.text && !message.mediaUrl) {
      throw new Error("Forward qilish uchun message content topilmadi");
    }

    const content = buildForwardContent(message);
    await client.sendEvent(targetRoomId, EventType.RoomMessage, content as never);
  };

  const forwardMessages = async (targetRoomId: string, messages: UiMessage[]) => {
    const ordered = [...messages].sort((a, b) => a.ts - b.ts);
    for (const message of ordered) {
      await forwardMessage(targetRoomId, message);
    }
  };

  return { forwardMessage, forwardMessages };
}
