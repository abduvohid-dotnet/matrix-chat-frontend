import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { MsgType, RoomEvent } from "matrix-js-sdk";
import { AudioLines, CheckCheck, Clock3, Download, FileText, Pause, Play, PhoneCall, PhoneMissed, Radio } from "lucide-react";
import type { UiMessage } from "../../hooks/useMatrixTimeline";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixMessageActions } from "../../hooks/useMatrixMessageActions";
import { useMatrixReactions } from "../../hooks/useMatrixReactions";
import { formatMessageTextToHtml, stripFormattingMarkers } from "../../services/textFormatting";
import type { RoomScrollAnchor } from "../../services/roomScrollStorage";

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
  const trimmed = stripFormattingMarkers(message.text).trim();
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

function getSenderAccent(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }

  const hue = hash % 360;
  return `hsl(${hue} 62% 46%)`;
}

function getAttachmentTitle(message: UiMessage, fallback: string): string {
  const text = message.text.trim();
  return text || fallback;
}

function formatAudioClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function buildVoiceBars(seed: string, count = 34): number[] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return Array.from({ length: count }, (_, index) => {
    hash = (hash * 1664525 + 1013904223 + index) >>> 0;
    return 5 + (hash % 18);
  });
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

function AudioMessagePlayer({
  src,
  seed,
}: {
  src: string;
  seed: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => buildVoiceBars(seed), [seed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncState = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", syncState);
    audio.addEventListener("timeupdate", syncState);
    audio.addEventListener("durationchange", syncState);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", syncState);
      audio.removeEventListener("timeupdate", syncState);
      audio.removeEventListener("durationchange", syncState);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    await audio.play();
    setIsPlaying(true);
  };

  const seekAudio = (clientX: number) => {
    const audio = audioRef.current;
    const waveform = waveformRef.current;
    if (!audio || !waveform || !duration) return;

    const rect = waveform.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = duration * ratio;
    setCurrentTime(audio.currentTime);
  };

  const progressRatio = duration > 0 ? currentTime / duration : 0;
  const shownTime = isPlaying ? currentTime : duration;

  return (
    <div className="voice-message-player">
      <audio ref={audioRef} preload="metadata" src={src} />
      <button type="button" className="voice-message-play" onClick={() => void togglePlayback()}>
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="voice-message-main">
        <div
          ref={waveformRef}
          className="voice-message-wave"
          onClick={(event) => seekAudio(event.clientX)}
        >
          {bars.map((height, index) => {
            const active = index / bars.length <= progressRatio;
            return (
              <span
                key={`${seed}-${index}`}
                className={`voice-message-bar ${active ? "active" : ""}`}
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
        <div className="voice-message-time">{formatAudioClock(shownTime)}</div>
      </div>
    </div>
  );
}

type CallNoticeKind = "rejected" | "ended" | "started";

type CallNoticeMeta = {
  kind: CallNoticeKind;
  title: string;
  detail: string | null;
};

function getCallNoticeMeta(message: UiMessage): CallNoticeMeta | null {
  if (message.msgtype !== MsgType.Notice) return null;

  const text = message.text.trim();
  if (!text) return null;

  if (text === "Qo'ng'iroq rad etildi") {
    return { kind: "rejected", title: "Rejected Call", detail: null };
  }

  if (text === "Audio qo'ng'iroq boshlandi" || text === "Video qo'ng'iroq boshlandi") {
    return { kind: "started", title: "Call Started", detail: null };
  }

  if (text.startsWith("Audio qo'ng'iroq tugadi.") || text.startsWith("Video qo'ng'iroq tugadi.")) {
    const durationMatch = text.match(/Davomiyligi:\s*(.+)$/i);
    return {
      kind: "ended",
      title: "Call Ended",
      detail: durationMatch?.[1] ?? null,
    };
  }

  return null;
}

function renderCallNoticeIcon(kind: CallNoticeKind) {
  if (kind === "rejected") return <PhoneMissed size={18} />;
  if (kind === "ended") return <Clock3 size={18} />;
  return <PhoneCall size={18} />;
}

type GroupVoiceNoticeKind = "started" | "ended";

type GroupVoiceNoticeMeta = {
  kind: GroupVoiceNoticeKind;
  title: string;
  detail: string | null;
};

function getGroupVoiceNoticeMeta(message: UiMessage): GroupVoiceNoticeMeta | null {
  if (message.msgtype !== MsgType.Notice) return null;

  const text = message.text.trim();
  if (text === "Guruh ovozli chati boshlandi") {
    return {
      kind: "started",
      title: "Group voice chat started",
      detail: null,
    };
  }

  if (text.startsWith("Guruh ovozli chati yakunlandi")) {
    const durationMatch = text.match(/Davomiyligi:\s*(.+)$/i);
    return {
      kind: "ended",
      title: "Group voice chat ended",
      detail: durationMatch?.[1] ?? null,
    };
  }

  return null;
}

export function ChatWindow({
  roomId,
  messages,
  myUserId,
  showSenderNames,
  initialScrollAnchor,
  onScrollPositionChange,
  onReply,
  onForward,
  onPin,
  onUnpin,
  selectedMessageIds,
  selectionMode,
  onStartSelection,
  onToggleSelection,
  hiddenEventIds,
  pinnedEventIds,
  jumpToEventId,
  onJumpHandled,
}: {
  roomId: string;
  messages: UiMessage[];
  myUserId: string;
  showSenderNames: boolean;
  initialScrollAnchor: RoomScrollAnchor | null;
  onScrollPositionChange: (anchor: RoomScrollAnchor | null) => void;
  onReply: (message: UiMessage) => void;
  onForward: (message: UiMessage) => void;
  onPin: (message: UiMessage) => void;
  onUnpin: (message: UiMessage) => void;
  selectedMessageIds: string[];
  selectionMode: boolean;
  onStartSelection: (message: UiMessage) => void;
  onToggleSelection: (messageId: string) => void;
  hiddenEventIds: string[];
  pinnedEventIds: string[];
  jumpToEventId: string | null;
  onJumpHandled: () => void;
}) {
  const { client, auth } = useMatrix();
  const { editMessage, deleteMessage } = useMatrixMessageActions();
  const { toggleReaction } = useMatrixReactions();
  const [, bumpReceiptVersion] = useReducer((value: number) => value + 1, 0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const messageItemRefs = useRef(new Map<string, HTMLDivElement>());
  const visibleMessagesRef = useRef<UiMessage[]>([]);
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingRestoreRoomIdRef = useRef<string | null>(null);
  const restoredRoomIdRef = useRef<string | null>(null);
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
    if (!client) return;

    const onReceipt = (_event: unknown, receiptRoom?: { roomId?: string }) => {
      if (receiptRoom?.roomId !== roomId) return;
      bumpReceiptVersion();
    };

    client.on(RoomEvent.Receipt, onReceipt as never);
    return () => {
      client.off(RoomEvent.Receipt, onReceipt as never);
    };
  }, [client, roomId]);

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
    if (!jumpToEventId) return;
    const element = messageRefs.current.get(jumpToEventId);
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setHighlightedEventId(jumpToEventId);
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedEventId((current) => (current === jumpToEventId ? null : current));
        highlightTimeoutRef.current = null;
      }, 1600);
    }
    onJumpHandled();
  }, [jumpToEventId, onJumpHandled]);

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
    visibleMessagesRef.current = visibleMessages;
  }, [visibleMessages]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const getViewportAnchor = (): RoomScrollAnchor | null => {
      const containerTop = element.getBoundingClientRect().top;

      for (const message of visibleMessagesRef.current) {
        const node = messageItemRefs.current.get(message.id);
        if (!node) continue;

        const nodeRect = node.getBoundingClientRect();
        const top = nodeRect.top - containerTop;
        const bottom = nodeRect.bottom - containerTop;
        if (bottom > 0) {
          return {
            messageId: message.id,
            offset: top,
          };
        }
      }

      return null;
    };

    const persistScrollPosition = () => {
      if (restoredRoomIdRef.current !== roomId) return;
      onScrollPositionChange(getViewportAnchor());
    };

    element.addEventListener("scroll", persistScrollPosition, { passive: true });

    return () => {
      onScrollPositionChange(getViewportAnchor());
      element.removeEventListener("scroll", persistScrollPosition);
    };
  }, [onScrollPositionChange, roomId]);

  useEffect(() => {
    pendingRestoreRoomIdRef.current = roomId;
    restoredRoomIdRef.current = null;
  }, [roomId]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (restoredRoomIdRef.current === roomId || pendingRestoreRoomIdRef.current !== roomId) return;

    if (visibleMessages.length === 0) return;

    let frameId = 0;
    let timeoutId = 0;
    let settleTimeoutId = 0;
    const applyScrollPosition = () => {
      const currentElement = containerRef.current;
      if (!currentElement) return;
      const fallbackScrollTop = Math.max(0, currentElement.scrollHeight - currentElement.clientHeight);

      if (!initialScrollAnchor) {
        currentElement.scrollTop = fallbackScrollTop;
      } else {
        const targetNode = messageItemRefs.current.get(initialScrollAnchor.messageId);
        if (!targetNode) return;

        const maxScrollTop = Math.max(0, currentElement.scrollHeight - currentElement.clientHeight);
        const nextScrollTop = Math.min(
          Math.max(targetNode.offsetTop - initialScrollAnchor.offset, 0),
          maxScrollTop,
        );
        currentElement.scrollTop = nextScrollTop;
      }
    };

    frameId = window.requestAnimationFrame(() => {
      applyScrollPosition();
      timeoutId = window.setTimeout(() => {
        applyScrollPosition();
        settleTimeoutId = window.setTimeout(applyScrollPosition, 80);
      }, 0);
    });

    pendingRestoreRoomIdRef.current = null;
    restoredRoomIdRef.current = roomId;
    previousRoomIdRef.current = roomId;
    previousLastVisibleMessageIdRef.current = visibleMessages[visibleMessages.length - 1]?.id ?? null;
    previousVisibleMessageCountRef.current = visibleMessages.length;

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(settleTimeoutId);
    };
  }, [initialScrollAnchor, roomId, visibleMessages]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const lastVisibleMessage = visibleMessages[visibleMessages.length - 1] ?? null;
    const lastVisibleMessageId = lastVisibleMessage?.id ?? null;
    const visibleCountIncreased = visibleMessages.length > previousVisibleMessageCountRef.current;
    const lastMessageChanged = lastVisibleMessageId !== previousLastVisibleMessageIdRef.current;
    const shouldStickToBottom = isNearBottom(element);
    const latestMessageIsMine = lastVisibleMessage?.sender === myUserId;

    if ((visibleCountIncreased || lastMessageChanged) && (shouldStickToBottom || latestMessageIsMine)) {
      element.scrollTop = element.scrollHeight;
    }

    previousRoomIdRef.current = roomId;
    previousLastVisibleMessageIdRef.current = lastVisibleMessageId;
    previousVisibleMessageCountRef.current = visibleMessages.length;
  }, [myUserId, roomId, visibleMessages]);

  const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const pinnedEventIdSet = useMemo(() => new Set(pinnedEventIds), [pinnedEventIds]);

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
      setDeleteError("Siz bu message'ni o'chira olmaysiz.");
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

  const onPinMessage = (message: UiMessage) => {
    setContextMenu(null);
    onPin(message);
  };

  const onUnpinMessage = (message: UiMessage) => {
    setContextMenu(null);
    onUnpin(message);
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

  const directPeerUserId = useMemo(() => {
    if (!client || showSenderNames) return null;
    const room = client.getRoom(roomId);
    return (
      room
        ?.getMembers()
        .find((member) => member.userId !== myUserId && member.membership === "join")
        ?.userId ?? null
    );
  }, [client, myUserId, roomId, showSenderNames]);

  const seenByEventId = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!client || !directPeerUserId) return map;

    const room = client.getRoom(roomId);
    if (!room) return map;

    visibleMessages.forEach((message) => {
      if (!message.eventId || message.sender !== myUserId) return;
      map.set(message.eventId, room.hasUserReadEvent(directPeerUserId, message.eventId));
    });

    return map;
  }, [client, directPeerUserId, myUserId, roomId, visibleMessages]);

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
          const isPinned = Boolean(message.eventId && pinnedEventIdSet.has(message.eventId));
          const callNotice = getCallNoticeMeta(message);
          const groupVoiceNotice = getGroupVoiceNoticeMeta(message);
          const isCenteredSystemNotice = Boolean(groupVoiceNotice);
          const shouldRenderTextBody = !callNotice && !groupVoiceNotice && kind === "text";

          return (
            <div
              key={message.id}
              ref={(node) => {
                if (node) {
                  messageItemRefs.current.set(message.id, node);
                } else {
                  messageItemRefs.current.delete(message.id);
                }

                if (!message.eventId) return;
                if (node) {
                  messageRefs.current.set(message.eventId, node);
                } else {
                  messageRefs.current.delete(message.eventId);
                }
              }}
              className={`msg ${message.sender === myUserId && !isCenteredSystemNotice ? "me" : ""} ${callNotice ? "system-call" : ""} ${groupVoiceNotice ? "system-room-notice" : ""} ${selectionMode ? "selecting" : ""} ${isSelected ? "selected" : ""} ${message.eventId === highlightedEventId ? "jump-highlight" : ""}`}
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

              {callNotice ? (
                <div className={`call-notice-card ${callNotice.kind}`}>
                  <div className="call-notice-icon">{renderCallNoticeIcon(callNotice.kind)}</div>
                  <div className="call-notice-content">
                    <div className="call-notice-title">{callNotice.title}</div>
                    <div className="call-notice-meta">
                      {callNotice.detail && <span>{callNotice.detail}</span>}
                      {callNotice.detail && <span className="call-notice-separator">•</span>}
                      <span>{formatMessageTime(message.ts)}</span>
                    </div>
                  </div>
                </div>
              ) : groupVoiceNotice ? (
                <div className={`room-notice-card ${groupVoiceNotice.kind}`}>
                  <div className="room-notice-icon">
                    {groupVoiceNotice.kind === "ended" ? <Clock3 size={18} /> : <Radio size={18} />}
                  </div>
                  <div className="room-notice-content">
                    <div className="room-notice-title">{groupVoiceNotice.title}</div>
                    <div className="room-notice-meta">
                      {groupVoiceNotice.detail && <span>{groupVoiceNotice.detail}</span>}
                      {groupVoiceNotice.detail && <span className="call-notice-separator">•</span>}
                      <span>{formatMessageTime(message.ts)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="msg-meta">
                  <div className="msg-sender-wrap">
                    {showSenderNames && message.sender !== myUserId ? (
                      <div
                        className="msg-sender"
                        style={{ color: getSenderAccent(message.senderDisplayName) }}
                      >
                        {message.senderDisplayName}
                      </div>
                    ) : (
                      <span />
                    )}
                    {isPinned && <span className="msg-pinned-badge">Pinned</span>}
                  </div>
                  <div className="msg-time">
                    {formatMessageTime(message.ts)}
                    {message.edited && <span className="msg-edited">edited</span>}
                    {!showSenderNames && message.sender === myUserId && message.eventId && seenByEventId.get(message.eventId) && (
                      <span className="msg-seen" aria-label="Seen">
                        <CheckCheck size={13} strokeWidth={2.2} />
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!callNotice && message.forwardedFrom && (
                <div className="msg-forwarded">
                  Forwarded from {message.forwardedFrom.sender}
                </div>
              )}

              {!callNotice && message.replyTo && (
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

              {!callNotice && kind === "image" && mediaUrl && (
                <img
                  className="msg-media msg-image"
                  src={mediaUrl}
                  alt={message.text || "Image"}
                  loading="lazy"
                />
              )}
              {!callNotice && kind === "video" && mediaUrl && (
                <video className="msg-media msg-video" controls src={mediaUrl} />
              )}
              {!callNotice && kind === "audio" && mediaUrl && (
                <div className="msg-audio-card">
                  <AudioMessagePlayer src={mediaUrl} seed={message.id} />
                  <div className="msg-audio-subtitle">
                    <AudioLines size={14} />
                    {formatBytes(message.mediaSize) || "Voice note"}
                  </div>
                </div>
              )}
              {!callNotice && kind === "file" && mediaUrl && (
                <a
                  className="msg-file-card"
                  href={mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  <div className="msg-file-icon">
                    <FileText size={18} />
                  </div>
                  <div className="msg-file-body">
                    <div className="msg-file-title">{getAttachmentTitle(message, "File")}</div>
                    <div className="msg-file-subtitle">{formatBytes(message.mediaSize) || "Attachment"}</div>
                  </div>
                  <div className="msg-file-download">
                    <Download size={16} />
                  </div>
                </a>
              )}

              {!callNotice && editingMessageId === message.id ? (
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
              ) : shouldRenderTextBody ? (
                <div
                  className="msg-text"
                  dangerouslySetInnerHTML={{
                    __html: message.formattedBody ?? formatMessageTextToHtml(message.text),
                  }}
                />
              ) : null}

              {!callNotice && message.reactions.length > 0 && (
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
                onClick={() =>
                  (contextMenuMessage.eventId && pinnedEventIdSet.has(contextMenuMessage.eventId))
                    ? onUnpinMessage(contextMenuMessage)
                    : onPinMessage(contextMenuMessage)
                }
              >
                {(contextMenuMessage.eventId && pinnedEventIdSet.has(contextMenuMessage.eventId)) ? "Unpin" : "Pin"}
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
              {contextMenuMessage.canRedact && (
                <button
                  type="button"
                  className="msg-context-item danger"
                  onClick={() => void onDelete(contextMenuMessage)}
                  disabled={loadingMessageId === contextMenuMessage.id}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
