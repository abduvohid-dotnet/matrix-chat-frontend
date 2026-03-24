const ROOM_SCROLL_STORAGE_KEY = "matrix-chat-room-scroll-v4";

export type RoomScrollAnchor = {
  messageId: string;
  offset: number;
};

export function readRoomScrollAnchors(): Record<string, RoomScrollAnchor> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.sessionStorage.getItem(ROOM_SCROLL_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, RoomScrollAnchor> = {};

    Object.entries(parsed).forEach(([key, value]) => {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { messageId?: unknown }).messageId === "string" &&
        typeof (value as { offset?: unknown }).offset === "number" &&
        Number.isFinite((value as { offset: number }).offset)
      ) {
        next[key] = value as RoomScrollAnchor;
      }
    });

    return next;
  } catch {
    return {};
  }
}

export function writeRoomScrollAnchors(anchors: Record<string, RoomScrollAnchor>) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(ROOM_SCROLL_STORAGE_KEY, JSON.stringify(anchors));
  } catch {
    // Ignore storage failures.
  }
}

export function saveRoomScrollAnchor(roomId: string, anchor: RoomScrollAnchor) {
  const anchors = readRoomScrollAnchors();
  anchors[roomId] = anchor;
  writeRoomScrollAnchors(anchors);
}
