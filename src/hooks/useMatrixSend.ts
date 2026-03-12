import { EventType, MsgType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import {
  buildReplyMessageContent,
  type MatrixFormattedText,
  type MatrixReplyTarget,
} from "../services/matrixReply";

export function useMatrixSend() {
  const { client } = useMatrix();

  const sendText = async (
    roomId: string,
    content: string | MatrixFormattedText,
    replyTo?: MatrixReplyTarget | null,
  ) => {
    const normalized = typeof content === "string" ? { body: content.trim(), formattedBody: null } : {
      body: content.body.trim(),
      formattedBody: content.formattedBody ?? null,
    };

    if (!client || !normalized.body) return;

    if (replyTo) {
      await client.sendEvent(
        roomId,
        EventType.RoomMessage,
        buildReplyMessageContent(normalized, replyTo) as never,
      );
      return;
    }

    await client.sendEvent(roomId, EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body: normalized.body,
      ...(normalized.formattedBody
        ? {
            format: "org.matrix.custom.html",
            formatted_body: normalized.formattedBody,
          }
        : {}),
    } as never);
  };

  return { sendText };
}
