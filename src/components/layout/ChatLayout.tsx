import { useEffect, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixRooms } from "../../hooks/useMatrixRooms";
import { useMatrixTimeline } from "../../hooks/useMatrixTimeline";
import { useMatrixDirectRoom } from "../../hooks/useMatrixDirectRoom";
import { useMatrixRoomStatus } from "../../hooks/useMatrixRoomStatus";
import { RoomList } from "../chat/RoomList";
import { ChatWindow } from "../chat/ChatWindow";
import { MessageComposer } from "../chat/MessageComposer";
import { EmptyConversation } from "../chat/EmptyConversation";

export function ChatLayout() {
  const { auth, logout } = useMatrix();
  const { rooms } = useMatrixRooms();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
  const [targetUser, setTargetUser] = useState("");
  const [directError, setDirectError] = useState<string | null>(null);
  const [creatingDirect, setCreatingDirect] = useState(false);
  const { messages } = useMatrixTimeline(selectedRoomId);
  const { typingText, presenceText, online } = useMatrixRoomStatus(selectedRoomId);
  const { createOrGetDirectRoom } = useMatrixDirectRoom();
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;

  useEffect(() => {
    if (!rooms.length) {
      setSelectedRoomId(null);
      return;
    }

    if (selectedRoomId && !rooms.some((room) => room.roomId === selectedRoomId)) {
      setSelectedRoomId(null);
      return;
    }

    if (!selectedRoomId && autoSelectEnabled) {
      setSelectedRoomId(rooms[0].roomId);
    }
  }, [autoSelectEnabled, rooms, selectedRoomId]);

  const onStartDirect = async () => {
    setDirectError(null);
    setCreatingDirect(true);
    try {
      const roomId = await createOrGetDirectRoom(targetUser);
      setSelectedRoomId(roomId);
      setAutoSelectEnabled(false);
      setTargetUser("");
    } catch (error: unknown) {
      setDirectError(error instanceof Error ? error.message : "Direct chat ochilmadi");
    } finally {
      setCreatingDirect(false);
    }
  };

  if (!auth) return null;

  return (
    <div className="layout">
      <header className="topbar">
        <div>
          <div className="title">Matrix Chat</div>
          <div className="subtitle">Secure direct messaging via Matrix</div>
        </div>
        <div className="topbar-actions">
          <div className="account-chip">
            <span className="status-dot" />
            {auth.userId}
          </div>
          <button className="btn ghost" onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </header>

      <div className="body">
        <div className="sidebar-wrap">
          <div className="direct-create">
            <div className="direct-create-title">Start direct chat</div>
            <div className="direct-create-row">
              <input
                className="input"
                value={targetUser}
                onChange={(e) => setTargetUser(e.target.value)}
                placeholder="@username:uchar.uz yoki username"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onStartDirect();
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={creatingDirect || !targetUser.trim()}
                onClick={() => void onStartDirect()}
              >
                {creatingDirect ? "Opening..." : "Open"}
              </button>
            </div>
            {directError && <div className="error direct-error">{directError}</div>}
          </div>
          <RoomList
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            currentUserId={auth.userId}
            onSelect={(roomId) => {
              setAutoSelectEnabled(false);
              setSelectedRoomId(roomId);
            }}
          />
        </div>

        <div className="conversation">
          {!selectedRoomId ? (
            <EmptyConversation />
          ) : (
            <>
              <div className="conversation-head">
                <div>
                  <div className="conversation-title">{selectedRoom?.name || selectedRoomId}</div>
                  <div className="conversation-meta">{selectedRoom?.roomId}</div>
                </div>
                <div className="conversation-head-right">
                  <div className={`presence-chip ${online ? "online" : "offline"}`}>
                    <span className="presence-chip-dot" />
                    {typingText || presenceText}
                  </div>
                  <button
                    type="button"
                    className="btn ghost close-chat-btn"
                    onClick={() => {
                      setAutoSelectEnabled(false);
                      setSelectedRoomId(null);
                    }}
                  >
                    Close chat
                  </button>
                </div>
              </div>
              <ChatWindow roomId={selectedRoomId} messages={messages} myUserId={auth.userId} />
              <MessageComposer
                roomId={selectedRoomId}
                disabled={!selectedRoomId}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
