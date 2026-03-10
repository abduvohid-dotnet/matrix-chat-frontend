import { useEffect, useReducer } from "react";
import { RoomEvent, type MatrixEvent, type Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

export type UiMessage = {
  id: string;
  sender: string;
  text: string;
  ts: number;
};

type RoomMessageContent = {
  body?: unknown;
};

export function useMatrixTimeline(roomId: string | null) {
  const { client } = useMatrix();
  const [, bumpTimelineVersion] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!client || !roomId) return;

    const onTimeline = (_event: MatrixEvent, timelineRoom: Room | undefined) => {
      if (!timelineRoom || timelineRoom.roomId !== roomId) return;
      bumpTimelineVersion();
    };

    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [client, roomId]);

  if (!client || !roomId) return { messages: [] };

  const room = client.getRoom(roomId);
  if (!room) return { messages: [] };

  const messages: UiMessage[] = room
    .getLiveTimeline()
    .getEvents()
    .filter((e) => e.getType() === "m.room.message")
    .map((e) => {
      const content = e.getContent() as RoomMessageContent;
      const text = typeof content.body === "string" ? content.body : "";

      return {
        id: e.getId() ?? `${e.getTs()}-${e.getSender()}`,
        sender: e.getSender() ?? "unknown",
        text,
        ts: e.getTs(),
      };
    });

  return { messages };
}
