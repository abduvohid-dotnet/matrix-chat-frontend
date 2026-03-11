import { useMemo, useState } from "react";
import type { Room } from "matrix-js-sdk";
import type { UiMessage } from "../../hooks/useMatrixTimeline";

function getPreviewText(message: UiMessage): string {
  if (message.text.trim()) return message.text.trim();
  if (message.msgtype === "m.image") return "Photo";
  if (message.msgtype === "m.video") return "Video";
  if (message.msgtype === "m.audio") return "Audio";
  if (message.msgtype === "m.file") return "File";
  return "Message";
}

function clamp(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export function ForwardDialog({
  open,
  rooms,
  sourceMessage,
  currentRoomId,
  busy,
  error,
  onClose,
  onForward,
}: {
  open: boolean;
  rooms: Room[];
  sourceMessage: UiMessage | null;
  currentRoomId: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onForward: (roomId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const candidateRooms = useMemo(
    () =>
      rooms.filter((room) => room.roomId !== currentRoomId && room.getMyMembership() === "join"),
    [currentRoomId, rooms],
  );

  const filteredRooms = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return candidateRooms;

    return candidateRooms.filter((room) => {
      const name = (room.name ?? "").toLowerCase();
      const roomId = room.roomId.toLowerCase();
      return name.includes(trimmed) || roomId.includes(trimmed);
    });
  }, [candidateRooms, query]);

  if (!open || !sourceMessage) return null;

  return (
    <div className="forward-dialog-backdrop" onClick={onClose}>
      <div
        className="forward-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="forward-dialog-head">
          <div>
            <div className="forward-dialog-title">Forward message</div>
            <div className="forward-dialog-subtitle">{clamp(getPreviewText(sourceMessage))}</div>
          </div>
          <button type="button" className="forward-dialog-close" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search room..."
          disabled={busy}
        />

        <div className="forward-room-list">
          {!filteredRooms.length ? (
            <div className="forward-room-empty">Forward qilish uchun boshqa room topilmadi.</div>
          ) : (
            filteredRooms.map((room) => (
              <button
                key={room.roomId}
                type="button"
                className="forward-room-item"
                onClick={() => onForward(room.roomId)}
                disabled={busy}
              >
                <div className="forward-room-name">{room.name || room.roomId}</div>
                <div className="forward-room-id">{room.roomId}</div>
              </button>
            ))
          )}
        </div>

        {error && <div className="error forward-dialog-error">{error}</div>}
      </div>
    </div>
  );
}
