import { useCallback, useEffect, useRef, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixSend } from "../../hooks/useMatrixSend";
import { useMatrixUpload } from "../../hooks/useMatrixUpload";

const QUICK_EMOJIS = ["😀", "😂", "😍", "👍", "🔥", "🎉"];

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
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setQueuedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeQueuedFile = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index));
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
      for (const file of queuedFiles) {
        await sendFileMessage(roomId, file);
      }

      setText("");
      setQueuedFiles([]);
      setShowEmoji(false);
      stopTyping();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Message send failed");
    } finally {
      setIsSending(false);
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
          {queuedFiles.map((file, index) => (
            <div key={`${file.name}-${index}-${file.size}`} className="composer-file">
              <span className="composer-file-name">{file.name}</span>
              <button
                type="button"
                className="composer-file-remove"
                onClick={() => removeQueuedFile(index)}
                aria-label="Remove file"
                disabled={isSending || disabled}
              >
                x
              </button>
            </div>
          ))}
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
          Attach
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
