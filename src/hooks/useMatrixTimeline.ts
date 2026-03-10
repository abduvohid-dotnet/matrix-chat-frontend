import { useEffect, useReducer } from "react";
import { EventType, RoomEvent, type MatrixEvent, type Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

export type UiMessage = {
  id: string;
  eventId: string | null;
  canRedact: boolean;
  sender: string;
  text: string;
  ts: number;
  edited: boolean;
  deleted: boolean;
  msgtype: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaSize: number | null;
  reactions: UiReaction[];
};

type RoomMessageContent = {
  body?: unknown;
  msgtype?: unknown;
  url?: unknown;
  file?: {
    url?: unknown;
  };
  info?: unknown;
  "m.new_content"?: {
    body?: unknown;
    msgtype?: unknown;
  };
  "m.relates_to"?: {
    rel_type?: unknown;
    event_id?: unknown;
    key?: unknown;
  };
};

type UiReaction = {
  key: string;
  count: number;
  reactedByMe: boolean;
};

type Replacement = {
  body: string;
  msgtype: string;
  ts: number;
};

type ReactionContent = {
  "m.relates_to"?: {
    rel_type?: unknown;
    event_id?: unknown;
    key?: unknown;
  };
};

type MessageInfo = {
  mimetype?: unknown;
  size?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inferMimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop();
  if (!ext) return null;
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image/*";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video/*";
  if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) return "audio/*";
  return null;
}

function isEventRedacted(event: MatrixEvent): boolean {
  if (event.isRedacted()) return true;
  const unsigned = event.getUnsigned() as { redacted_because?: unknown } | undefined;
  return Boolean(unsigned?.redacted_because);
}

function hasLocalRedaction(event: MatrixEvent): boolean {
  return Boolean(event.localRedactionEvent());
}

function getRedactedEventId(event: MatrixEvent): string | null {
  const raw = event as MatrixEvent & { event?: { redacts?: unknown } };
  return asString(raw.event?.redacts);
}

export function useMatrixTimeline(roomId: string | null) {
  const { client, auth } = useMatrix();
  const [, bumpTimelineVersion] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!client || !roomId) return;

    const onTimeline = (_event: MatrixEvent, timelineRoom: Room | undefined) => {
      if (!timelineRoom || timelineRoom.roomId !== roomId) return;
      bumpTimelineVersion();
    };

    const onLocalEchoUpdated = (_event: MatrixEvent, updatedRoom: Room) => {
      if (updatedRoom.roomId !== roomId) return;
      bumpTimelineVersion();
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
    };
  }, [client, roomId]);

  if (!client || !roomId) return { messages: [] };

  const room = client.getRoom(roomId);
  if (!room) return { messages: [] };

  const events = room.getLiveTimeline().getEvents();
  const myUserId = auth?.userId ?? null;

  const replacements = new Map<string, Replacement>();
  const reactionsByEvent = new Map<string, Map<string, UiReaction>>();
  const redactedTargetIds = new Set<string>();

  events.forEach((event) => {
    if (event.getType() === EventType.RoomMessage && hasLocalRedaction(event)) {
      const redactedEventId = event.getId();
      if (redactedEventId) {
        redactedTargetIds.add(redactedEventId);
      }
      return;
    }

    if (isEventRedacted(event)) {
      if (event.getType() === EventType.RoomMessage) {
        const redactedEventId = event.getId();
        if (redactedEventId) {
          redactedTargetIds.add(redactedEventId);
        }
      }
      return;
    }

    if (event.getType() === EventType.RoomRedaction) {
      const targetEventId = getRedactedEventId(event);
      if (targetEventId) {
        redactedTargetIds.add(targetEventId);
      }
      return;
    }

    if (event.getType() === EventType.RoomMessage) {
      const content = event.getContent() as RoomMessageContent;
      const relation = content["m.relates_to"];
      if (relation?.rel_type !== "m.replace") return;

      const targetEventId = asString(relation.event_id);
      if (!targetEventId) return;

      const newContent = content["m.new_content"];
      const body = asString(newContent?.body) ?? asString(content.body) ?? "";
      const msgtype = asString(newContent?.msgtype) ?? asString(content.msgtype) ?? "m.text";
      const ts = event.getTs();

      const prev = replacements.get(targetEventId);
      if (!prev || prev.ts < ts) {
        replacements.set(targetEventId, { body, msgtype, ts });
      }
      return;
    }

    if (event.getType() !== EventType.Reaction) return;
    const content = event.getContent() as ReactionContent;
    const relation = content["m.relates_to"];

    if (relation?.rel_type !== "m.annotation") return;
    const targetEventId = asString(relation.event_id);
    const key = asString(relation.key);
    if (!targetEventId || !key) return;

    let byKey = reactionsByEvent.get(targetEventId);
    if (!byKey) {
      byKey = new Map<string, UiReaction>();
      reactionsByEvent.set(targetEventId, byKey);
    }

    const current = byKey.get(key) ?? {
      key,
      count: 0,
      reactedByMe: false,
    };

    current.count += 1;
    if (myUserId && event.getSender() === myUserId) {
      current.reactedByMe = true;
    }
    byKey.set(key, current);
  });

  const messages: UiMessage[] = events
    .filter((event) => {
      if (event.getType() !== EventType.RoomMessage) return false;
      if (hasLocalRedaction(event)) return false;
      if (isEventRedacted(event)) return false;
      const eventId = event.getId();
      if (eventId && redactedTargetIds.has(eventId)) return false;
      const content = event.getContent() as RoomMessageContent;
      const relation = content["m.relates_to"];
      return relation?.rel_type !== "m.replace";
    })
    .map((event) => {
      const content = event.getContent() as RoomMessageContent;
      const eventId = event.getId();
      const replacement = eventId ? replacements.get(eventId) : undefined;

      const rawMsgType = asString(content.msgtype) ?? "m.text";
      const baseBody = asString(content.body) ?? "";

      const msgtype = replacement?.msgtype ?? rawMsgType;
      const body = replacement?.body ?? baseBody;
      const url = asString(content.url) ?? asString(content.file?.url);

      const info = (content.info ?? undefined) as MessageInfo | undefined;
      const mediaMime = info ? asString(info.mimetype) : null;
      const inferredMime = mediaMime ?? inferMimeFromName(body);
      const mediaSize = info ? asNumber(info.size) : null;
      const reactionsMap = eventId ? reactionsByEvent.get(eventId) : undefined;

      return {
        id: eventId ?? `${event.getTs()}-${event.getSender()}`,
        eventId: eventId ?? null,
        canRedact: Boolean(eventId),
        sender: event.getSender() ?? "unknown",
        text: body,
        ts: event.getTs(),
        edited: Boolean(replacement),
        deleted: false,
        msgtype,
        mediaUrl: url,
        mediaMime: inferredMime,
        mediaSize,
        reactions: reactionsMap
          ? Array.from(reactionsMap.values()).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
          : [],
      };
    });

  return { messages };
}
