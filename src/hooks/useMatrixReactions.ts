import { useCallback } from "react";
import { EventType, RelationType, type MatrixEvent } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

type ReactionRelation = {
  rel_type?: unknown;
  event_id?: unknown;
  key?: unknown;
};

type ReactionContent = {
  "m.relates_to"?: ReactionRelation;
};

function isEventRedacted(event: MatrixEvent): boolean {
  const unsigned = event.getUnsigned() as { redacted_because?: unknown } | undefined;
  return Boolean(unsigned?.redacted_because);
}

export function useMatrixReactions() {
  const { client, auth } = useMatrix();
  const myUserId = auth?.userId ?? null;

  const addReaction = useCallback(
    async (roomId: string, eventId: string, key: string) => {
      if (!client || !roomId || !eventId || !key) return;

      await client.sendEvent(roomId, EventType.Reaction, {
        "m.relates_to": {
          rel_type: RelationType.Annotation,
          event_id: eventId,
          key,
        },
      });
    },
    [client],
  );

  const removeReaction = useCallback(
    async (roomId: string, reactionEventId: string) => {
      if (!client || !roomId || !reactionEventId) return;
      await client.redactEvent(roomId, reactionEventId);
    },
    [client],
  );

  const findOwnReactionEventId = useCallback(
    (roomId: string, targetEventId: string, key: string): string | null => {
      if (!client || !myUserId) return null;
      const room = client.getRoom(roomId);
      if (!room) return null;

      const events = room.getLiveTimeline().getEvents();
      const reaction = events.find((event) => {
        if (event.getType() !== EventType.Reaction) return false;
        if (event.getSender() !== myUserId) return false;
        if (isEventRedacted(event)) return false;

        const content = event.getContent() as ReactionContent;
        const relation = content["m.relates_to"];

        return (
          relation?.rel_type === RelationType.Annotation &&
          relation.event_id === targetEventId &&
          relation.key === key
        );
      });

      return reaction?.getId() ?? null;
    },
    [client, myUserId],
  );

  const toggleReaction = useCallback(
    async (roomId: string, targetEventId: string, key: string) => {
      if (!client || !roomId || !targetEventId || !key) return;

      const ownReactionId = findOwnReactionEventId(roomId, targetEventId, key);
      if (ownReactionId) {
        await removeReaction(roomId, ownReactionId);
        return;
      }

      await addReaction(roomId, targetEventId, key);
    },
    [addReaction, client, findOwnReactionEventId, removeReaction],
  );

  return { addReaction, removeReaction, toggleReaction };
}
