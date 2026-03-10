import type { Room } from "matrix-js-sdk";
import { useMatrix } from "../../app/providers/useMatrix";

function formatActivity(ts: number | null): string {
  if (!ts) return "No activity";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function RoomList({
  rooms,
  selectedRoomId,
  currentUserId,
  onSelect,
}: {
  rooms: Room[];
  selectedRoomId: string | null;
  currentUserId: string;
  onSelect: (roomId: string) => void;
}) {
  const { client } = useMatrix();

  const getRoomStatus = (room: Room): { text: string; online: boolean } => {
    const peers = room
      .getMembers()
      .filter((member) => member.userId !== currentUserId && (member.membership === "join" || member.membership === "invite"));

    const typingPeer = peers.find((member) => member.typing);
    if (typingPeer) {
      return { text: "typing...", online: true };
    }

    const user = peers.length ? client?.getUser(peers[0].userId) : undefined;
    if (user?.presence === "online") return { text: "online", online: true };
    if (user?.presence === "unavailable") return { text: "away", online: false };

    return { text: "offline", online: false };
  };

  return (
    <div className="sidebar">
      <div className="sidebar-title">Rooms</div>
      <div className="room-list">
        {!rooms.length ? (
          <div className="room-empty">Hali room yo'q. Yuqoridan user yozib chat oching.</div>
        ) : (
          rooms.map((r) => {
            const status = getRoomStatus(r);
            return (
              <button
                key={r.roomId}
                className={`room-item ${selectedRoomId === r.roomId ? "active" : ""}`}
                onClick={() => onSelect(r.roomId)}
              >
                <div className="room-name">{r.name || "Unnamed room"}</div>
                <div className="room-meta">
                  <span>{r.getJoinedMemberCount()} members</span>
                  <span>{formatActivity(r.getLastActiveTimestamp())}</span>
                </div>
                <div className="room-presence">
                  <span className={`presence-pill ${status.online ? "online" : "offline"}`}>
                    <span className="presence-pill-dot" />
                    {status.text}
                  </span>
                </div>
                <div className="room-id">{r.roomId}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
