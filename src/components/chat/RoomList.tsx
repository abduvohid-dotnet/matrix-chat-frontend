import { useEffect, useReducer } from "react";
import { RoomMemberEvent, UserEvent, type Room } from "matrix-js-sdk";
import { useMatrix } from "../../app/providers/useMatrix";
import { formatPresenceStatus, formatTypingSummary } from "../../services/presence";

function formatActivity(ts: number | null): string {
  if (!ts) return "No activity";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatUnreadCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
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
  const [, bump] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!client) return;

    const onPresence = () => bump();
    const onTyping = () => bump();
    const refreshTimer = window.setInterval(() => bump(), 30_000);

    client.on(UserEvent.Presence, onPresence);
    client.on(RoomMemberEvent.Typing, onTyping);

    return () => {
      window.clearInterval(refreshTimer);
      client.off(UserEvent.Presence, onPresence);
      client.off(RoomMemberEvent.Typing, onTyping);
    };
  }, [client]);

  const getRoomStatus = (room: Room): { text: string; online: boolean } => {
    const peers = room
      .getMembers()
      .filter((member) => member.userId !== currentUserId && (member.membership === "join" || member.membership === "invite"));

    const joinedPeers = peers.filter((member) => member.membership === "join");
    const invitedPeer = peers.find((member) => member.membership === "invite");

    const typingUsers = joinedPeers
      .filter((member) => member.typing)
      .map((member) => member.rawDisplayName || member.userId);
    if (typingUsers.length > 0) {
      return { text: formatTypingSummary(typingUsers, { compact: true }), online: true };
    }

    const peer = joinedPeers[0];
    if (!peer) {
      return invitedPeer ? { text: "invited", online: false } : { text: "offline", online: false };
    }

    const user = client?.getUser(peer.userId);
    const presence = formatPresenceStatus(user?.presence, user?.lastPresenceTs);
    return { text: presence.label, online: presence.online };
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
            const unreadCount = r.getUnreadNotificationCount();
            return (
              <button
                key={r.roomId}
                className={`room-item ${selectedRoomId === r.roomId ? "active" : ""}`}
                onClick={() => onSelect(r.roomId)}
              >
                <div className="room-head">
                  <div className="room-name">{r.name || "Unnamed room"}</div>
                  {unreadCount > 0 && <span className="room-unread-badge">{formatUnreadCount(unreadCount)}</span>}
                </div>
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
