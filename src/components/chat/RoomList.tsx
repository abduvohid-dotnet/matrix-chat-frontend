import { useEffect, useMemo, useReducer, useState } from "react";
import { RoomMemberEvent, UserEvent, type Room } from "matrix-js-sdk";
import { Search } from "lucide-react";
import { useMatrix } from "../../app/providers/useMatrix";
import { formatPresenceStatus, formatTypingSummary } from "../../services/presence";
import {
  getLatestVisibleMessagePreview,
  getLatestVisibleMessageTimestamp,
} from "../../services/roomActivity";
import { getDirectPeerUserId, isDirectRoom } from "../../services/roomKind";

function formatActivity(ts: number | null): string {
  if (!ts) return "No activity";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatUnreadCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

function getRoomInitial(room: Room): string {
  return (room.name || room.roomId).trim().charAt(0).toUpperCase() || "#";
}

function getAvatarTone(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  const hue = hash % 360;
  return `linear-gradient(180deg, hsl(${hue} 84% 72%) 0%, hsl(${hue} 72% 56%) 100%)`;
}

type RoomFilter = "all" | "personal" | "groups";

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("all");

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

  const searchedRooms = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return rooms;

    return rooms.filter((room) => {
      const name = (room.name || "").toLowerCase();
      const roomId = room.roomId.toLowerCase();
      const preview = getLatestVisibleMessagePreview(room).toLowerCase();
      const peerId = getDirectPeerUserId(room, currentUserId)?.toLowerCase() ?? "";

      return (
        name.includes(trimmed) ||
        roomId.includes(trimmed) ||
        preview.includes(trimmed) ||
        peerId.includes(trimmed)
      );
    });
  }, [currentUserId, query, rooms]);

  const filteredRooms = useMemo(() => {
    if (filter === "all") return searchedRooms;
    if (filter === "personal") {
      return searchedRooms.filter((room) => isDirectRoom(room, currentUserId));
    }
    return searchedRooms.filter((room) => !isDirectRoom(room, currentUserId));
  }, [currentUserId, filter, searchedRooms]);

  const renderRoom = (room: Room) => {
    const status = getRoomStatus(room);
    const unreadCount = room.getUnreadNotificationCount();
    const isPersonal = isDirectRoom(room, currentUserId);
    const preview = getLatestVisibleMessagePreview(room);
    const avatarSeed = getDirectPeerUserId(room, currentUserId) ?? room.roomId;

    return (
      <button
        key={room.roomId}
        className={`room-item ${selectedRoomId === room.roomId ? "active" : ""}`}
        onClick={() => onSelect(room.roomId)}
      >
        <div className="room-card-avatar" style={{ background: getAvatarTone(avatarSeed) }}>
          {getRoomInitial(room)}
        </div>
        <div className="room-card-body">
          <div className="room-head">
            <div className="room-name">{room.name || "Unnamed room"}</div>
            <div className="room-head-right">
              <span className="room-time">{formatActivity(getLatestVisibleMessageTimestamp(room))}</span>
              {unreadCount > 0 && <span className="room-unread-badge">{formatUnreadCount(unreadCount)}</span>}
            </div>
          </div>
          <div className="room-preview-row">
            <div className="room-preview">{preview}</div>
          </div>
          <div className="room-meta">
            <span>{isPersonal ? "Personal" : `${room.getJoinedMemberCount()} members`}</span>
            <span className={`presence-pill ${status.online ? "online" : "offline"}`}>
              <span className="presence-pill-dot" />
              {status.text}
            </span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="sidebar">
      <div className="sidebar-title">Rooms</div>
      <div className="room-list">
        <div className="room-search">
          <Search size={16} />
          <input
            className="room-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats, users..."
          />
        </div>

        <div className="room-filter-tabs">
          {[
            { id: "all", label: "All" },
            { id: "personal", label: "Personal" },
            { id: "groups", label: "Groups" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`room-filter-tab ${filter === tab.id ? "active" : ""}`}
              onClick={() => setFilter(tab.id as RoomFilter)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!rooms.length ? (
          <div className="room-empty">Hali room yo'q. Yuqoridan user yozib chat oching.</div>
        ) : !filteredRooms.length ? (
          <div className="room-empty">Mos room topilmadi.</div>
        ) : (
          filteredRooms.map(renderRoom)
        )}
      </div>
    </div>
  );
}
