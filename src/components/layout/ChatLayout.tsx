import { useEffect, useMemo, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixRooms } from "../../hooks/useMatrixRooms";
import { useMatrixTimeline } from "../../hooks/useMatrixTimeline";
import { useMatrixDirectRoom } from "../../hooks/useMatrixDirectRoom";
import { useMatrixRoomStatus } from "../../hooks/useMatrixRoomStatus";
import { useMatrixCall } from "../../hooks/useMatrixCall";
import { useMatrixForward } from "../../hooks/useMatrixForward";
import { useMatrixMessageActions } from "../../hooks/useMatrixMessageActions";
import { useMatrixPins } from "../../hooks/useMatrixPins";
import { useMatrixGroups } from "../../hooks/useMatrixGroups";
import type { UiMessage } from "../../hooks/useMatrixTimeline";
import { RoomList } from "../chat/RoomList";
import { ChatWindow } from "../chat/ChatWindow";
import { MessageComposer } from "../chat/MessageComposer";
import { EmptyConversation } from "../chat/EmptyConversation";
import { CallPanel } from "../chat/CallPanel";
import { ForwardDialog } from "../chat/ForwardDialog";
import { GroupManagementPanel } from "../chat/GroupManagementPanel";
import { Phone } from "lucide-react";
import type { MatrixReplyTarget } from "../../services/matrixReply";

export function ChatLayout() {
  const { auth, logout } = useMatrix();
  const { rooms } = useMatrixRooms();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
  const [targetUser, setTargetUser] = useState("");
  const [directError, setDirectError] = useState<string | null>(null);
  const [creatingDirect, setCreatingDirect] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupInvitees, setGroupInvitees] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupManageBusy, setGroupManageBusy] = useState(false);
  const [groupManageError, setGroupManageError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MatrixReplyTarget | null>(null);
  const [forwardMessage, setForwardMessage] = useState<UiMessage | null>(null);
  const [forwardMessages, setForwardMessages] = useState<UiMessage[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectionActionError, setSelectionActionError] = useState<string | null>(null);
  const [hiddenSelectedEventIds, setHiddenSelectedEventIds] = useState<string[]>([]);
  const [pinError, setPinError] = useState<string | null>(null);
  const [jumpToPinnedEventId, setJumpToPinnedEventId] = useState<string | null>(null);
  const { messages } = useMatrixTimeline(selectedRoomId);
  const { pinnedEventIds, pinMessage, unpinMessage } = useMatrixPins(selectedRoomId);
  const {
    members: groupMembers,
    myPowerLevel,
    powerLevels,
    createGroup,
    inviteUsers,
    setMemberPowerLevel,
    updatePermissionLevels,
  } = useMatrixGroups(selectedRoomId);
  const { typingText, presenceText, online } = useMatrixRoomStatus(selectedRoomId);
  const { createOrGetDirectRoom } = useMatrixDirectRoom();
  const { forwardMessage: sendForward, forwardMessages: sendForwardMany } = useMatrixForward();
  const { deleteMessages } = useMatrixMessageActions();
  const matrixCall = useMatrixCall();
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIds.includes(message.id)),
    [messages, selectedMessageIds],
  );
  const deletableSelectedMessages = useMemo(
    () =>
      selectedMessages.filter(
        (message) => message.sender === auth?.userId && message.canRedact && Boolean(message.eventId),
      ),
    [auth?.userId, selectedMessages],
  );
  const pinnedMessages = useMemo(
    () =>
      pinnedEventIds
        .map((eventId) => messages.find((message) => message.eventId === eventId))
        .filter((message): message is UiMessage => Boolean(message)),
    [messages, pinnedEventIds],
  );
  const latestPinnedMessage = pinnedMessages[0] ?? null;

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

  useEffect(() => {
    if (!matrixCall.roomId) return;
    if (selectedRoomId === matrixCall.roomId) return;
    setAutoSelectEnabled(false);
    setSelectedRoomId(matrixCall.roomId);
  }, [matrixCall.roomId, selectedRoomId]);

  useEffect(() => {
    setReplyTo(null);
  }, [selectedRoomId]);

  useEffect(() => {
    setForwardMessage(null);
    setForwardMessages([]);
    setForwardError(null);
    setSelectedMessageIds([]);
    setHiddenSelectedEventIds([]);
    setSelectionActionError(null);
    setPinError(null);
    setJumpToPinnedEventId(null);
    setGroupManageOpen(false);
    setGroupManageError(null);
  }, [selectedRoomId]);

  useEffect(() => {
    const visibleIds = new Set(messages.map((message) => message.id));
    setSelectedMessageIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  useEffect(() => {
    const activeEventIds = new Set(
      messages
        .map((message) => message.eventId)
        .filter((eventId): eventId is string => Boolean(eventId)),
    );

    setHiddenSelectedEventIds((prev) => {
      const next = prev.filter((eventId) => activeEventIds.has(eventId));
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  const onReply = (message: UiMessage) => {
    if (!message.eventId) return;

    setReplyTo({
      eventId: message.eventId,
      sender: message.sender,
      text: message.text,
      msgtype: message.msgtype,
    });
  };

  const onForward = (message: UiMessage) => {
    setForwardError(null);
    setForwardMessage(message);
    setForwardMessages([message]);
  };

  const onCreateGroup = async () => {
    setCreatingGroup(true);
    setGroupCreateError(null);
    try {
      const roomId = await createGroup(groupName, groupInvitees);
      setSelectedRoomId(roomId);
      setAutoSelectEnabled(false);
      setGroupName("");
      setGroupInvitees("");
    } catch (error: unknown) {
      setGroupCreateError(error instanceof Error ? error.message : "Group creation failed");
    } finally {
      setCreatingGroup(false);
    }
  };

  const onPin = async (message: UiMessage) => {
    if (!message.eventId) return;
    setPinError(null);
    try {
      await pinMessage(message.eventId);
    } catch (error: unknown) {
      setPinError(error instanceof Error ? error.message : "Pin failed");
    }
  };

  const onUnpin = async (message: UiMessage) => {
    if (!message.eventId) return;
    setPinError(null);
    try {
      await unpinMessage(message.eventId);
    } catch (error: unknown) {
      setPinError(error instanceof Error ? error.message : "Unpin failed");
    }
  };

  const runGroupAction = async (action: () => Promise<void>) => {
    setGroupManageBusy(true);
    setGroupManageError(null);
    try {
      await action();
    } catch (error: unknown) {
      setGroupManageError(error instanceof Error ? error.message : "Group update failed");
    } finally {
      setGroupManageBusy(false);
    }
  };

  const onStartSelection = (message: UiMessage) => {
    setSelectionActionError(null);
    setSelectedMessageIds((prev) => (prev.includes(message.id) ? prev : [...prev, message.id]));
  };

  const onToggleSelection = (messageId: string) => {
    setSelectionActionError(null);
    setSelectedMessageIds((prev) =>
      prev.includes(messageId)
        ? prev.filter((id) => id !== messageId)
        : [...prev, messageId],
    );
  };

  const onForwardSelected = () => {
    if (!selectedMessages.length) return;
    setForwardError(null);
    setForwardMessage(selectedMessages[0] ?? null);
    setForwardMessages(selectedMessages);
  };

  const onDeleteSelected = async () => {
    if (!selectedRoomId || !deletableSelectedMessages.length) return;

    const eventIds = deletableSelectedMessages
      .map((message) => message.eventId)
      .filter((eventId): eventId is string => Boolean(eventId));

    setBulkDeleting(true);
    setSelectionActionError(null);
    setHiddenSelectedEventIds((prev) => [...new Set([...prev, ...eventIds])]);
    try {
      await deleteMessages(selectedRoomId, eventIds, "Deleted by user");
      setSelectedMessageIds([]);
    } catch (error: unknown) {
      setHiddenSelectedEventIds((prev) => prev.filter((eventId) => !eventIds.includes(eventId)));
      setSelectionActionError(error instanceof Error ? error.message : "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
    }
  };

  const onSubmitForward = async (targetRoomId: string) => {
    if (!forwardMessage) return;

    setForwarding(true);
    setForwardError(null);
    try {
      if (forwardMessages.length > 1) {
        await sendForwardMany(targetRoomId, forwardMessages);
      } else {
        await sendForward(targetRoomId, forwardMessage);
      }
      setForwardMessage(null);
      setForwardMessages([]);
      setSelectedMessageIds([]);
      setSelectedRoomId(targetRoomId);
      setAutoSelectEnabled(false);
    } catch (error: unknown) {
      setForwardError(error instanceof Error ? error.message : "Forward failed");
    } finally {
      setForwarding(false);
    }
  };

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
          <div className="direct-create">
            <div className="direct-create-title">Create group</div>
            <input
              className="input"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
            />
            <textarea
              className="input group-create-textarea"
              value={groupInvitees}
              onChange={(e) => setGroupInvitees(e.target.value)}
              placeholder="@user1:server, @user2:server"
            />
            <button
              type="button"
              className="btn"
              disabled={creatingGroup || !groupName.trim()}
              onClick={() => void onCreateGroup()}
            >
              {creatingGroup ? "Creating..." : "Create group"}
            </button>
            {groupCreateError && <div className="error direct-error">{groupCreateError}</div>}
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
                <div className="conversation-head-main">
                  <div className="conversation-avatar">
                    {selectedMessageIds.length > 0
                      ? selectedMessageIds.length
                      : (selectedRoom?.name || selectedRoomId).trim().charAt(0).toUpperCase()}
                  </div>
                  <div>
                  {selectedMessageIds.length > 0 ? (
                    <>
                      <div className="conversation-title">{selectedMessageIds.length} selected</div>
                      <div className="conversation-meta">Selection mode</div>
                    </>
                  ) : (
                    <>
                      <div className="conversation-title">{selectedRoom?.name || selectedRoomId}</div>
                      <div className="conversation-meta">{selectedRoom?.roomId}</div>
                    </>
                  )}
                  </div>
                </div>
                <div className="conversation-head-right">
                  {selectedMessageIds.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void onForwardSelected()}
                        disabled={forwarding || bulkDeleting}
                      >
                        Forward
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void onDeleteSelected()}
                        disabled={bulkDeleting || deletableSelectedMessages.length === 0}
                      >
                        {bulkDeleting ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          setSelectedMessageIds([]);
                          setSelectionActionError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={`presence-chip ${online ? "online" : "offline"}`}>
                        <span className="presence-chip-dot" />
                        {typingText || presenceText}
                      </div>
                      {selectedRoomId && !matrixCall.inCall && (
                        <>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => setGroupManageOpen((prev) => !prev)}
                          >
                            {groupManageOpen ? "Close manage" : "Manage group"}
                          </button>
                          <button
                            type="button"
                            className="btn ghost call-trigger-btn"
                            onClick={() => void matrixCall.startVoiceCall(selectedRoomId)}
                          >
                            <Phone size={16} />
                            Voice
                          </button>
                        </>
                      )}
                    </>
                  )}
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
              {matrixCall.inCall && matrixCall.roomId === selectedRoomId && (
                <CallPanel
                  localStream={matrixCall.localStream}
                  remoteStream={matrixCall.remoteStream}
                  state={matrixCall.state}
                  incoming={matrixCall.incoming}
                  micMuted={matrixCall.micMuted}
                  error={matrixCall.error}
                  onAnswer={() => void matrixCall.answer()}
                  onReject={matrixCall.reject}
                  onHangup={matrixCall.hangup}
                  onToggleMicrophone={() => void matrixCall.toggleMicrophone()}
                />
              )}
              {groupManageOpen && selectedRoomId && (
                <GroupManagementPanel
                  members={groupMembers}
                  myPowerLevel={myPowerLevel}
                  inviteLevel={powerLevels.invite ?? 50}
                  redactLevel={powerLevels.redact ?? 50}
                  kickLevel={powerLevels.kick ?? 75}
                  banLevel={powerLevels.ban ?? 75}
                  busy={groupManageBusy}
                  error={groupManageError}
                  onInvite={(value) => runGroupAction(() => inviteUsers(selectedRoomId, value))}
                  onChangeRole={(userId, value) =>
                    runGroupAction(() => setMemberPowerLevel(selectedRoomId, userId, value))
                  }
                  onChangePermission={(key, value) =>
                    runGroupAction(() => updatePermissionLevels(selectedRoomId, { [key]: value }))
                  }
                />
              )}
              {latestPinnedMessage && (
                <button
                  type="button"
                  className="pinned-banner"
                  onClick={() => setJumpToPinnedEventId(latestPinnedMessage.eventId)}
                >
                  <div className="pinned-banner-label">
                    Pinned message
                    {pinnedMessages.length > 1 ? ` (${pinnedMessages.length})` : ""}
                  </div>
                  <div className="pinned-banner-text">{latestPinnedMessage.text || "Message"}</div>
                </button>
              )}
              {pinError && <div className="chat-selection-error">{pinError}</div>}
              <ChatWindow
                roomId={selectedRoomId}
                messages={messages}
                myUserId={auth.userId}
                onReply={onReply}
                onForward={onForward}
                onPin={onPin}
                onUnpin={onUnpin}
                selectedMessageIds={selectedMessageIds}
                selectionMode={selectedMessageIds.length > 0}
                onStartSelection={onStartSelection}
                onToggleSelection={onToggleSelection}
                hiddenEventIds={hiddenSelectedEventIds}
                pinnedEventIds={pinnedEventIds}
                jumpToEventId={jumpToPinnedEventId}
                onJumpHandled={() => setJumpToPinnedEventId(null)}
              />
              {selectionActionError && <div className="chat-selection-error">{selectionActionError}</div>}
              <MessageComposer
                roomId={selectedRoomId}
                disabled={!selectedRoomId}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
              />
            </>
          )}
        </div>
      </div>
      <ForwardDialog
        open={Boolean(forwardMessage)}
        rooms={rooms}
        sourceMessages={forwardMessages}
        currentRoomId={selectedRoomId}
        busy={forwarding}
        error={forwardError}
        onClose={() => {
          if (forwarding) return;
          setForwardMessage(null);
          setForwardMessages([]);
          setForwardError(null);
        }}
        onForward={(roomId) => void onSubmitForward(roomId)}
      />
    </div>
  );
}
