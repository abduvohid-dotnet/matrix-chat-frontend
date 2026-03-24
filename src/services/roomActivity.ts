import { EventType, type MatrixEvent, type Room } from "matrix-js-sdk";

type RoomMessageContent = {
  body?: unknown;
  msgtype?: unknown;
  "m.relates_to"?: {
    rel_type?: unknown;
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

export function getLatestVisibleMessageTimestamp(room: Room): number {
  const latestEvent = getLatestVisibleMessageEvent(room);
  return latestEvent?.getTs() ?? room.getLastActiveTimestamp() ?? 0;
}

export function getLatestVisibleMessagePreview(room: Room): string {
  const event = getLatestVisibleMessageEvent(room);
  if (!event) return "No messages yet";

  const content = event.getContent() as RoomMessageContent;
  const msgtype = asString(content.msgtype) ?? "m.text";
  const body = asString(content.body) ?? "";

  if (msgtype === "m.image") return "Photo";
  if (msgtype === "m.video") return "Video";
  if (msgtype === "m.audio") return "Voice message";
  if (msgtype === "m.file") return body || "File";

  return body || "Message";
}

function getLatestVisibleMessageEvent(room: Room): MatrixEvent | null {
  const events = room.getLiveTimeline().getEvents();
  const redactedTargetIds = new Set<string>();

  events.forEach((event) => {
    if (event.getType() === EventType.RoomMessage && hasLocalRedaction(event)) {
      const eventId = event.getId();
      if (eventId) {
        redactedTargetIds.add(eventId);
      }
      return;
    }

    if (isEventRedacted(event)) {
      if (event.getType() === EventType.RoomMessage) {
        const eventId = event.getId();
        if (eventId) {
          redactedTargetIds.add(eventId);
        }
      }
      return;
    }

    if (event.getType() === EventType.RoomRedaction) {
      const targetEventId = getRedactedEventId(event);
      if (targetEventId) {
        redactedTargetIds.add(targetEventId);
      }
    }
  });

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.getType() !== EventType.RoomMessage) continue;
    if (hasLocalRedaction(event)) continue;
    if (isEventRedacted(event)) continue;

    const eventId = event.getId();
    if (eventId && redactedTargetIds.has(eventId)) continue;

    const content = event.getContent() as RoomMessageContent;
    if (content["m.relates_to"]?.rel_type === "m.replace") continue;

    return event;
  }

  return null;
}
