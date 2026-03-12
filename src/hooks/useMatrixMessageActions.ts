import { useCallback } from "react";
import { EventType, MsgType, RelationType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

type MessageEditContent = {
  msgtype: MsgType.Text;
  body: string;
  "m.new_content": {
    msgtype: MsgType.Text;
    body: string;
  };
  "m.relates_to": {
    rel_type: RelationType.Replace;
    event_id: string;
  };
};

export function useMatrixMessageActions() {
  const { client } = useMatrix();

  const editMessage = useCallback(
    async (roomId: string, targetEventId: string, nextText: string) => {
      const trimmed = nextText.trim();
      if (!client || !trimmed || !roomId || !targetEventId) return;

      const content: MessageEditContent = {
        msgtype: MsgType.Text,
        body: `* ${trimmed}`,
        "m.new_content": {
          msgtype: MsgType.Text,
          body: trimmed,
        },
        "m.relates_to": {
          rel_type: RelationType.Replace,
          event_id: targetEventId,
        },
      };

      await client.sendEvent(roomId, EventType.RoomMessage, content);
    },
    [client],
  );

  const deleteMessage = useCallback(
    async (roomId: string, eventId: string, reason?: string) => {
      if (!client || !roomId || !eventId) return;
      await client.redactEvent(roomId, eventId, undefined, reason ? { reason } : undefined);
    },
    [client],
  );

  const deleteMessages = useCallback(
    async (roomId: string, eventIds: string[], reason?: string) => {
      const uniqueIds = [...new Set(eventIds.filter(Boolean))];
      for (const eventId of uniqueIds) {
        await deleteMessage(roomId, eventId, reason);
      }
    },
    [deleteMessage],
  );

  return { editMessage, deleteMessage, deleteMessages };
}
