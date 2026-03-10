import { useEffect, useState, useMemo, useRef } from "react";
import type { UiMessage } from "../../hooks/useMatrixTimeline";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixMessageActions } from "../../hooks/useMatrixMessageActions";
import { useMatrixReactions } from "../../hooks/useMatrixReactions";

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥"];
const CONTEXT_MENU_WIDTH = 220;
const CONTEXT_MENU_HEIGHT = 150;

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

type ContextMenuState = {
  messageId: string;
  x: number;
  y: number;
};

export function ChatWindow({
  roomId,
  messages,
  myUserId,
}: {
  roomId: string;
  messages: UiMessage[];
  myUserId: string;
}) {
  const { client, auth } = useMatrix();
  const { editMessage, deleteMessage } = useMatrixMessageActions();
  const { toggleReaction } = useMatrixReactions();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [optimisticDeletedByRoom, setOptimisticDeletedByRoom] = useState<Record<string, Set<string>>>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!editingMessageId) return;
    const isStillVisible = messages.some((message) => message.id === editingMessageId);
    if (!isStillVisible) {
      setEditingMessageId(null);
      setEditingText("");
    }
  }, [editingMessageId, messages]);

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
        (message) => !(message.eventId && optimisticDeletedIds.has(message.eventId)),
      ),
    [messages, optimisticDeletedIds],
  );

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
        visibleMessages.map((m) => (
          (() => {
            const kind = getRenderableKind(m);
            const mediaUrl = mediaHttpByMessageId.get(m.id);

            return (
          <div
            key={m.id}
            className={`msg ${m.sender === myUserId ? "me" : ""}`}
            onContextMenu={(event) => {
              if (m.deleted) return;
              event.preventDefault();
              setContextMenu({
                messageId: m.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <div className="msg-meta">
              <div className="msg-sender">{m.sender}</div>
              <div className="msg-time">
                {formatMessageTime(m.ts)}
                {m.edited && <span className="msg-edited">edited</span>}
              </div>
            </div>
            {kind === "image" && mediaUrl && (
              <img
                className="msg-media msg-image"
                src={mediaUrl}
                alt={m.text || "Image"}
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
                Download file {formatBytes(m.mediaSize)}
              </a>
            )}

            {editingMessageId === m.id ? (
              <div className="msg-edit-row">
                <input
                  className="input"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  disabled={loadingMessageId === m.id}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void submitEdit(m)}
                  disabled={loadingMessageId === m.id || !editingText.trim()}
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
                  disabled={loadingMessageId === m.id}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="msg-text">{m.text}</div>
            )}

            {m.reactions.length > 0 && (
              <div className="msg-reactions">
                {m.reactions.map((reaction) => (
                  <button
                    key={`${m.id}-${reaction.key}-count`}
                    type="button"
                    className={`msg-reaction-chip ${reaction.reactedByMe ? "mine" : ""}`}
                    onClick={() => void onToggleReaction(m, reaction.key)}
                  >
                    {reaction.key} {reaction.count}
                  </button>
                ))}
              </div>
            )}
          </div>
            );
          })()
        ))
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
          {contextMenuMessage.sender === myUserId && contextMenuMessage.eventId && (
            <div className="msg-context-actions">
              <button
                type="button"
                className="msg-context-item"
                onClick={() => startEdit(contextMenuMessage)}
                disabled={loadingMessageId === contextMenuMessage.id}
              >
                Edit
              </button>
              <button
                type="button"
                className="msg-context-item danger"
                onClick={() => void onDelete(contextMenuMessage)}
                disabled={loadingMessageId === contextMenuMessage.id || !contextMenuMessage.canRedact}
              >
                {contextMenuMessage.canRedact ? "Delete" : "Syncing..."}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
