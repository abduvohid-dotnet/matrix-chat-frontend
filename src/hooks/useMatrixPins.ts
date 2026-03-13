import { useEffect, useReducer } from "react";
import { EventType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

const ROOM_STATE_EVENTS = "RoomState.events";

type PinnedEventsContent = {
  pinned?: unknown;
};

function getPinnedEventIds(content: PinnedEventsContent | null | undefined): string[] {
  if (!content || !Array.isArray(content.pinned)) return [];
  return content.pinned.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function useMatrixPins(roomId: string | null) {
  const { client } = useMatrix();
  const [, bumpVersion] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!client || !roomId) return;

    const room = client.getRoom(roomId);
    if (!room) return;

    const onStateEvent = (event: { getType?: () => string; getRoomId?: () => string }) => {
      if (event.getType?.() !== EventType.RoomPinnedEvents) return;
      if (event.getRoomId?.() !== roomId) return;
      bumpVersion();
    };

    room.currentState.on(ROOM_STATE_EVENTS as never, onStateEvent as never);
    return () => {
      room.currentState.off(ROOM_STATE_EVENTS as never, onStateEvent as never);
    };
  }, [client, roomId]);

  const room = client && roomId ? client.getRoom(roomId) : null;
  const pinnedState = room?.currentState.getStateEvents(EventType.RoomPinnedEvents, "");
  const pinnedEventIds = getPinnedEventIds((pinnedState?.getContent() ?? null) as PinnedEventsContent | null);

  const pinMessage = async (eventId: string) => {
    if (!client || !roomId || !eventId) return;
    const nextPinned = pinnedEventIds.includes(eventId) ? pinnedEventIds : [eventId, ...pinnedEventIds];
    await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: nextPinned }, "");
  };

  const unpinMessage = async (eventId: string) => {
    if (!client || !roomId || !eventId) return;
    const nextPinned = pinnedEventIds.filter((id) => id !== eventId);
    await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: nextPinned }, "");
  };

  return {
    pinnedEventIds,
    pinMessage,
    unpinMessage,
  };
}
