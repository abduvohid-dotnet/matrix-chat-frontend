import { EventType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import { buildReplyMessageContent, type MatrixReplyTarget } from "../services/matrixReply";

export function useMatrixSend() {
  const { client } = useMatrix();

  const sendText = async (roomId: string, text: string, replyTo?: MatrixReplyTarget | null) => {
    const trimmed = text.trim();
    if (!client || !trimmed) return;

    if (replyTo) {
      await client.sendEvent(roomId, EventType.RoomMessage, buildReplyMessageContent(trimmed, replyTo) as never);
      return;
    }

    await client.sendTextMessage(roomId, trimmed);
  };

  return { sendText };
}
