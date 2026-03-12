import { useEffect, useMemo, useRef, useState } from "react";
import { MsgType } from "matrix-js-sdk";
import type { UiMessage } from "../../hooks/useMatrixTimeline";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixMessageActions } from "../../hooks/useMatrixMessageActions";
import { useMatrixReactions } from "../../hooks/useMatrixReactions";

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥"];
const CONTEXT_MENU_WIDTH = 220;
const CONTEXT_MENU_HEIGHT = 230;

function formatBytes(size: number | null): string {
  if (typeof size !== "number" || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getRenderableKind(message: UiMessage): "image" | "video" | "audio" | "file" | "text" {
  if (message.msgtype === "m.image") return "image";
  if (message.msgtype === "m.video") return "video";
  if (message.msgtype === "m.audio") return "audio";
  if (message.msgtype === "m.file" && message.mediaMime?.startsWith("image/")) return "image";
  if (message.msgtype === "m.file" && message.mediaMime?.startsWith("video/")) return "video";
  if (message.msgtype === "m.file" && message.mediaMime?.startsWith("audio/")) return "audio";
  if (message.msgtype === "m.file") return "file";
  if (message.mediaMime?.startsWith("image/")) return "image";
  if (message.mediaMime?.startsWith("video/")) return "video";
  if (message.mediaMime?.startsWith("audio/")) return "audio";
  return "text";
}

function getReplyPreviewText(message: Pick<UiMessage, "text" | "msgtype">): string {
  const trimmed = message.text.trim();
  if (trimmed) return trimmed;
  if (message.msgtype === MsgType.Image) return "Photo";
  if (message.msgtype === MsgType.Video) return "Video";
  if (message.msgtype === MsgType.Audio) return "Audio";
  if (message.msgtype === MsgType.File) return "File";
  return "Message";
}

function clampText(value: string, maxLength = 90): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function isNearBottom(element: HTMLDivElement, threshold = 72): boolean {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance <= threshold;
}

type ContextMenuState = {
  messageId: string;
  x: number;
  y: number;
};

export function ChatWindow({
  roomId,
  messages,
  myUserId,
  onReply,
  onForward,
  selectedMessageIds,
  selectionMode,
  onStartSelection,
  onToggleSelection,
  hiddenEventIds,
}: {
  roomId: string;
  messages: UiMessage[];
  myUserId: string;
  onReply: (message: UiMessage) => void;
  onForward: (message: UiMessage) => void;
  selectedMessageIds: string[];
  selectionMode: boolean;
  onStartSelection: (message: UiMessage) => void;
  onToggleSelection: (messageId: string) => void;
  hiddenEventIds: string[];
}) {
  const { client, auth } = useMatrix();
  const { editMessage, deleteMessage } = useMatrixMessageActions();
  const { toggleReaction } = useMatrixReactions();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const highlightTimeoutRef = useRef<number | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);
  const previousLastVisibleMessageIdRef = useRef<string | null>(null);
  const previousVisibleMessageCountRef = useRef(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [optimisticDeletedByRoom, setOptimisticDeletedByRoom] = useState<Record<string, Set<string>>>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [activeReplyMessageId, setActiveReplyMessageId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editingMessageId) return;
    const isStillVisible = messages.some((message) => message.id === editingMessageId);
    if (!isStillVisible) {
      setEditingMessageId(null);
      setEditingText("");
    }
  }, [editingMessageId, messages]);

  useEffect(() => {
    if (!selectionMode) return;
    setContextMenu(null);
  }, [selectionMode]);

  useEffect(() => {
    if (!contextMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const hasTarget = messages.some((message) => message.id === contextMenu.messageId);
    if (!hasTarget) {
      setContextMenu(null);
    }
  }, [contextMenu, messages]);

  useEffect(() => {
    const activeEventIds = new Set(
      messages
        .map((message) => message.eventId)
        .filter((eventId): eventId is string => typeof eventId === "string" && eventId.length > 0),
    );

    setOptimisticDeletedByRoom((prev) => {
      const currentRoomSet = prev[roomId];
      if (!currentRoomSet || currentRoomSet.size === 0) return prev;

      const nextRoomSet = new Set<string>();
      currentRoomSet.forEach((eventId) => {
        if (activeEventIds.has(eventId)) {
          nextRoomSet.add(eventId);
        }
      });

      if (nextRoomSet.size === currentRoomSet.size) return prev;
      if (nextRoomSet.size === 0) {
        const { [roomId]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [roomId]: nextRoomSet,
      };
    });
  }, [messages, roomId]);

  const optimisticDeletedIds = useMemo(
    () => optimisticDeletedByRoom[roomId] ?? new Set<string>(),
    [optimisticDeletedByRoom, roomId],
  );

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => !(message.eventId && (optimisticDeletedIds.has(message.eventId) || hiddenEventIds.includes(message.eventId))),
      ),
    [hiddenEventIds, messages, optimisticDeletedIds],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const lastVisibleMessage = visibleMessages[visibleMessages.length - 1] ?? null;
    const lastVisibleMessageId = lastVisibleMessage?.id ?? null;
    const visibleCountIncreased = visibleMessages.length > previousVisibleMessageCountRef.current;
    const lastMessageChanged = lastVisibleMessageId !== previousLastVisibleMessageIdRef.current;
    const shouldStickToBottom = isNearBottom(element);

    if ((visibleCountIncreased || lastMessageChanged) && shouldStickToBottom) {
      element.scrollTop = element.scrollHeight;
    }

    previousRoomIdRef.current = roomId;
    previousLastVisibleMessageIdRef.current = lastVisibleMessageId;
    previousVisibleMessageCountRef.current = visibleMessages.length;
  }, [roomId, visibleMessages]);

  const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);

  const mediaHttpByMessageId = useMemo(() => {
    const map = new Map<string, string>();
    if (!client) return map;

    visibleMessages.forEach((message) => {
      if (!message.mediaUrl) return;

      const authUrl =
        client.mxcUrlToHttp(message.mediaUrl, undefined, undefined, undefined, false, true, true) ??
        "";
      const unauthUrl = client.mxcUrlToHttp(message.mediaUrl) ?? "";
      const rawUrl = authUrl || unauthUrl;
      if (!rawUrl) return;

      if (auth?.accessToken) {
        const url = new URL(rawUrl, window.location.origin);
        url.searchParams.set("access_token", auth.accessToken);
        map.set(message.id, url.toString());
        return;
      }

      map.set(message.id, rawUrl);
    });

    return map;
  }, [auth?.accessToken, client, visibleMessages]);

  const startEdit = (message: UiMessage) => {
    setContextMenu(null);
    setEditingMessageId(message.id);
    setEditingText(message.text);
  };

  const submitEdit = async (message: UiMessage) => {
    if (!message.eventId) return;
    const trimmed = editingText.trim();
    if (!trimmed) return;

    setLoadingMessageId(message.id);
    try {
      await editMessage(roomId, message.eventId, trimmed);
      setEditingMessageId(null);
      setEditingText("");
    } finally {
      setLoadingMessageId(null);
    }
  };

  const onDelete = async (message: UiMessage) => {
    if (!message.canRedact) {
      setDeleteError("Message hali sync bo'lmagan. 1-2 soniya kutib qayta urinib ko'ring.");
      return;
    }

    const eventId = message.eventId;
    if (!eventId) return;
    setContextMenu(null);
    setDeleteError(null);
    setLoadingMessageId(message.id);
    setOptimisticDeletedByRoom((prev) => {
      const current = prev[roomId] ?? new Set<string>();
      const next = new Set(current);
      next.add(eventId);
      return {
        ...prev,
        [roomId]: next,
      };
    });
    try {
      await deleteMessage(roomId, eventId, "Deleted by user");
    } catch (error: unknown) {
      setOptimisticDeletedByRoom((prev) => {
        const current = prev[roomId];
        if (!current || current.size === 0) return prev;

        const next = new Set(current);
        next.delete(eventId);
        if (next.size === 0) {
          const { [roomId]: _removed, ...rest } = prev;
          return rest;
        }

        return {
          ...prev,
          [roomId]: next,
        };
      });
      const messageText = error instanceof Error ? error.message : "Delete failed";
      setDeleteError(messageText);
    } finally {
      setLoadingMessageId(null);
    }
  };

  const onToggleReaction = async (message: UiMessage, emoji: string) => {
    if (!message.eventId) return;
    setContextMenu(null);
    await toggleReaction(roomId, message.eventId, emoji);
  };

  const onReplyMessage = (message: UiMessage) => {
    setContextMenu(null);
    onReply(message);
  };

  const onForwardMessage = (message: UiMessage) => {
    setContextMenu(null);
    onForward(message);
  };

  const jumpToMessage = (eventId: string, sourceMessageId: string) => {
    const element = messageRefs.current.get(eventId);
    if (!element) return;

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    setHighlightedEventId(eventId);
    setActiveReplyMessageId(sourceMessageId);
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedEventId((current) => (current === eventId ? null : current));
      setActiveReplyMessageId((current) => (current === sourceMessageId ? null : current));
      highlightTimeoutRef.current = null;
    }, 1600);
  };

  const contextMenuMessage = contextMenu
    ? visibleMessages.find((message) => message.id === contextMenu.messageId) ?? null
    : null;

  const menuPosition = useMemo(() => {
    if (!contextMenu) return null;

    const left = Math.min(
      contextMenu.x,
      Math.max(8, window.innerWidth - CONTEXT_MENU_WIDTH - 8),
    );
    const top = Math.min(
      contextMenu.y,
      Math.max(8, window.innerHeight - CONTEXT_MENU_HEIGHT - 8),
    );

    return { left, top };
  }, [contextMenu]);

  return (
    <div ref={containerRef} className="chat-window">
      {deleteError && <div className="chat-delete-error">{deleteError}</div>}
      {!visibleMessages.length ? (
        <div className="chat-empty">No messages yet. Send first message.</div>
      ) : (
        visibleMessages.map((message) => {
          const kind = getRenderableKind(message);
          const mediaUrl = mediaHttpByMessageId.get(message.id);
          const isSelected = selectedMessageIdSet.has(message.id);

          return (
            <div
              key={message.id}
              ref={(node) => {
                if (!message.eventId) return;
                if (node) {
                  messageRefs.current.set(message.eventId, node);
                } else {
                  messageRefs.current.delete(message.eventId);
                }
              }}
              className={`msg ${message.sender === myUserId ? "me" : ""} ${selectionMode ? "selecting" : ""} ${isSelected ? "selected" : ""} ${message.eventId === highlightedEventId ? "jump-highlight" : ""}`}
              data-event-id={message.eventId ?? undefined}
              onContextMenu={(event) => {
                if (selectionMode) return;
                event.preventDefault();
                setContextMenu({
                  messageId: message.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onClick={() => {
                if (!selectionMode) return;
                onToggleSelection(message.id);
              }}
              onDoubleClick={() => {
                if (selectionMode) return;
                if (!message.eventId) return;
                onReply(message);
              }}
            >
              {selectionMode && <div className="msg-select-indicator">{isSelected ? "✓" : ""}</div>}

              <div className="msg-meta">
                <div className="msg-sender">{message.sender}</div>
                <div className="msg-time">
                  {formatMessageTime(message.ts)}
                  {message.edited && <span className="msg-edited">edited</span>}
                </div>
              </div>

              {message.forwardedFrom && (
                <div className="msg-forwarded">
                  Forwarded from {message.forwardedFrom.sender}
                </div>
              )}

              {message.replyTo && (
                <button
                  type="button"
                  className={`msg-reply-preview ${activeReplyMessageId === message.id ? "active" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    jumpToMessage(message.replyTo!.eventId, message.id);
                  }}
                >
                  <div className="msg-reply-sender">{message.replyTo.sender}</div>
                  <div className="msg-reply-text">{clampText(getReplyPreviewText(message.replyTo))}</div>
                </button>
              )}

              {kind === "image" && mediaUrl && (
                <img
                  className="msg-media msg-image"
                  src={mediaUrl}
                  alt={message.text || "Image"}
                  loading="lazy"
                />
              )}
              {kind === "video" && mediaUrl && (
                <video className="msg-media msg-video" controls src={mediaUrl} />
              )}
              {kind === "audio" && mediaUrl && (
                <audio className="msg-media msg-audio" controls src={mediaUrl} />
              )}
              {kind === "file" && mediaUrl && (
                <a
                  className="msg-file-link"
                  href={mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  Download file {formatBytes(message.mediaSize)}
                </a>
              )}

              {editingMessageId === message.id ? (
                <div className="msg-edit-row">
                  <input
                    className="input"
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    disabled={loadingMessageId === message.id}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void submitEdit(message)}
                    disabled={loadingMessageId === message.id || !editingText.trim()}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setEditingMessageId(null);
                      setEditingText("");
                    }}
                    disabled={loadingMessageId === message.id}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="msg-text">{message.text}</div>
              )}

              {message.reactions.length > 0 && (
                <div className="msg-reactions">
                  {message.reactions.map((reaction) => (
                    <button
                      key={`${message.id}-${reaction.key}-count`}
                      type="button"
                      className={`msg-reaction-chip ${reaction.reactedByMe ? "mine" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onToggleReaction(message, reaction.key);
                      }}
                    >
                      {reaction.key} {reaction.count}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
      {contextMenuMessage && menuPosition && (
        <div
          ref={contextMenuRef}
          className="msg-context-menu"
          style={{
            left: `${menuPosition.left}px`,
            top: `${menuPosition.top}px`,
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="msg-context-reactions">
            {QUICK_REACTIONS.map((emoji) => {
              const isActive = contextMenuMessage.reactions.some(
                (reaction) => reaction.key === emoji && reaction.reactedByMe,
              );
              return (
                <button
                  key={`${contextMenuMessage.id}-menu-${emoji}`}
                  type="button"
                  className={`msg-context-reaction ${isActive ? "active" : ""}`}
                  onClick={() => void onToggleReaction(contextMenuMessage, emoji)}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          {contextMenuMessage.eventId && (
            <div className="msg-context-actions">
              <button
                type="button"
                className="msg-context-item"
                onClick={() => onReplyMessage(contextMenuMessage)}
              >
                Reply
              </button>
              <button
                type="button"
                className="msg-context-item"
                onClick={() => onForwardMessage(contextMenuMessage)}
              >
                Forward
              </button>
              <button
                type="button"
                className="msg-context-item"
                onClick={() => {
                  setContextMenu(null);
                  onStartSelection(contextMenuMessage);
                }}
              >
                Select
              </button>
              {contextMenuMessage.sender === myUserId && (
                <button
                  type="button"
                  className="msg-context-item"
                  onClick={() => startEdit(contextMenuMessage)}
                  disabled={loadingMessageId === contextMenuMessage.id}
                >
                  Edit
                </button>
              )}
              {contextMenuMessage.sender === myUserId && (
                <button
                  type="button"
                  className="msg-context-item danger"
                  onClick={() => void onDelete(contextMenuMessage)}
                  disabled={loadingMessageId === contextMenuMessage.id || !contextMenuMessage.canRedact}
                >
                  {contextMenuMessage.canRedact ? "Delete" : "Syncing..."}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
