import { useCallback, useEffect, useRef, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixSend } from "../../hooks/useMatrixSend";
import { useMatrixUpload } from "../../hooks/useMatrixUpload";
import { Paperclip } from "lucide-react";

const QUICK_EMOJIS = ["\u{1F600}", "\u{1F602}", "\u{1F60D}", "\u{1F44D}", "\u{1F525}", "\u{1F389}"];

type QueuedUpload = {
  id: string;
  file: File;
};

type UploadProgress = {
  loaded: number;
  total: number;
};

function createUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPercent(progress: UploadProgress): number {
  if (!progress.total || progress.total <= 0) return 0;
  const raw = Math.round((progress.loaded / progress.total) * 100);
  return Math.min(100, Math.max(0, raw));
}

export function MessageComposer({
  roomId,
  disabled,
}: {
  roomId: string;
  disabled: boolean;
}) {
  const { client } = useMatrix();
  const { sendText } = useMatrixSend();
  const { sendFileMessage } = useMatrixUpload();

  const [text, setText] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedUpload[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgressById, setUploadProgressById] = useState<Record<string, number>>({});
  const [uploadingFileId, setUploadingFileId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const sendTyping = useCallback(
    async (typing: boolean) => {
      if (!client || !roomId) return;
      try {
        await client.sendTyping(roomId, typing, 30000);
      } catch {
        // ignore typing errors
      }
    },
    [client, roomId],
  );

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    void sendTyping(false);
  }, [sendTyping]);

  useEffect(() => {
    return () => {
      stopTyping();
    };
  }, [stopTyping]);

  useEffect(() => {
    stopTyping();
  }, [roomId, stopTyping]);

  const queueSelectedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = Array.from(files).map((file) => ({ id: createUploadId(), file }));
    setQueuedFiles((prev) => [...prev, ...next]);
  };

  const removeQueuedFile = (index: number) => {
    const removed = queuedFiles[index];
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index));

    if (!removed) return;
    setUploadProgressById((prev) => {
      const next = { ...prev };
      delete next[removed.id];
      return next;
    });
  };

  const submit = async () => {
    const trimmed = text.trim();
    if ((!trimmed && queuedFiles.length === 0) || isSending || disabled) return;

    setIsSending(true);
    setError(null);
    try {
      if (trimmed) {
        await sendText(roomId, trimmed);
      }

      for (const queued of queuedFiles) {
        setUploadingFileId(queued.id);
        setUploadProgressById((prev) => ({ ...prev, [queued.id]: 0 }));

        await sendFileMessage(roomId, queued.file, (progress) => {
          const percent = toPercent(progress);
          setUploadProgressById((prev) => {
            if (prev[queued.id] === percent) return prev;
            return { ...prev, [queued.id]: percent };
          });
        });

        setUploadProgressById((prev) => ({ ...prev, [queued.id]: 100 }));
      }

      setText("");
      setQueuedFiles([]);
      setShowEmoji(false);
      setUploadProgressById({});
      setUploadingFileId(null);
      stopTyping();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Message send failed");
    } finally {
      setIsSending(false);
      setUploadingFileId(null);
    }
  };

  const onTextChange = (nextText: string) => {
    setText(nextText);

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (!nextText.trim()) {
      void sendTyping(false);
      return;
    }

    void sendTyping(true);
    typingTimeoutRef.current = window.setTimeout(() => {
      typingTimeoutRef.current = null;
      void sendTyping(false);
    }, 1800);
  };

  return (
    <div className="composer">
      {queuedFiles.length > 0 && (
        <div className="composer-files">
          {queuedFiles.map((queued, index) => {
            const progress = uploadProgressById[queued.id] ?? 0;
            const showProgress = isSending && (uploadingFileId === queued.id || progress > 0);

            return (
              <div key={queued.id} className="composer-file">
                <span className="composer-file-name">{queued.file.name}</span>
                {showProgress && <span className="composer-file-progress-text">{progress}%</span>}
                <button
                  type="button"
                  className="composer-file-remove"
                  onClick={() => removeQueuedFile(index)}
                  aria-label="Remove file"
                  disabled={isSending || disabled}
                >
                  x
                </button>
                {showProgress && (
                  <span className="composer-file-progress" aria-hidden>
                    <span className="composer-file-progress-fill" style={{ width: `${progress}%` }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isSending && uploadingFileId && (
        <div className="composer-uploading-status">
          Uploading... {uploadProgressById[uploadingFileId] ?? 0}%
        </div>
      )}

      {showEmoji && (
        <div className="composer-emoji-panel">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="composer-emoji-item"
              onClick={() => onTextChange(`${text}${emoji}`)}
              disabled={isSending || disabled}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="input-row">
        <button
          type="button"
          className="btn ghost composer-action"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending}
        >
          <Paperclip />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="composer-file-input"
          onChange={(e) => queueSelectedFiles(e.target.files)}
          disabled={disabled || isSending}
        />
        <button
          type="button"
          className="btn ghost composer-action"
          onClick={() => setShowEmoji((prev) => !prev)}
          disabled={disabled || isSending}
        >
          Emoji
        </button>
        <input
          className="input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Type a message..."
          disabled={disabled || isSending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="btn"
          disabled={disabled || isSending || (!text.trim() && queuedFiles.length === 0)}
          onClick={() => void submit()}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
      {error && <div className="error composer-error">{error}</div>}
    </div>
  );
}
