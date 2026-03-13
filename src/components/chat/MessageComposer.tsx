import { useCallback, useEffect, useRef, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";
import { useMatrixSend } from "../../hooks/useMatrixSend";
import { useMatrixUpload } from "../../hooks/useMatrixUpload";
import type { MatrixReplyTarget } from "../../services/matrixReply";
import {
  escapeHtml,
  formattedHtmlToPlainText,
  normalizeComposerHtml,
} from "../../services/textFormatting";
import { Paperclip } from "lucide-react";

const QUICK_EMOJIS = ["\u{1F600}", "\u{1F602}", "\u{1F60D}", "\u{1F44D}", "\u{1F525}", "\u{1F389}"];
const FORMAT_ACTIONS = [
  { label: "B", command: "bold", title: "Bold" },
  { label: "I", command: "italic", title: "Italic" },
  { label: "S", command: "strikeThrough", title: "Strike" },
  { label: "</>", command: "code", title: "Code" },
] as const;

type QueuedUpload = {
  id: string;
  file: File;
};

type UploadProgress = {
  loaded: number;
  total: number;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function focusInput(element: HTMLElement | null): void {
  if (!element) return;
  element.focus({ preventScroll: true });
}

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

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertHtmlAtCursor(html: string): void {
  document.execCommand("insertHTML", false, html);
}

function insertTextAtCursor(text: string): void {
  document.execCommand("insertText", false, text);
}

export function MessageComposer({
  roomId,
  disabled,
  replyTo,
  onCancelReply,
}: {
  roomId: string;
  disabled: boolean;
  replyTo: MatrixReplyTarget | null;
  onCancelReply: () => void;
}) {
  const { client } = useMatrix();
  const { sendText } = useMatrixSend();
  const { sendFileMessage } = useMatrixUpload();

  const [plainText, setPlainText] = useState("");
  const [editorHtml, setEditorHtml] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedUpload[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgressById, setUploadProgressById] = useState<Record<string, number>>({});
  const [uploadingFileId, setUploadingFileId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
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

  const onTextChange = useCallback(
    (nextText: string) => {
      setPlainText(nextText);

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
    },
    [sendTyping],
  );

  const syncEditorState = useCallback(
    (nextHtml?: string) => {
      const html = nextHtml ?? editorRef.current?.innerHTML ?? "";
      setEditorHtml(html);
      onTextChange(formattedHtmlToPlainText(html));
    },
    [onTextChange],
  );

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

  const clearEditor = () => {
    setPlainText("");
    setEditorHtml("");
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
  };

  const submit = async () => {
    const normalizedHtml = normalizeComposerHtml(editorHtml);
    const trimmedText = formattedHtmlToPlainText(normalizedHtml).trim();

    if ((!trimmedText && queuedFiles.length === 0) || isSending || disabled) return;

    setIsSending(true);
    setError(null);
    try {
      if (trimmedText) {
        await sendText(
          roomId,
          {
            body: trimmedText,
            formattedBody: normalizedHtml || null,
          },
          replyTo,
        );
      }

      for (const queued of queuedFiles) {
        setUploadingFileId(queued.id);
        setUploadProgressById((prev) => ({ ...prev, [queued.id]: 0 }));

        await sendFileMessage(
          roomId,
          queued.file,
          (progress) => {
            const percent = toPercent(progress);
            setUploadProgressById((prev) => {
              if (prev[queued.id] === percent) return prev;
              return { ...prev, [queued.id]: percent };
            });
          },
          replyTo,
        );

        setUploadProgressById((prev) => ({ ...prev, [queued.id]: 100 }));
      }

      clearEditor();
      setQueuedFiles([]);
      setShowEmoji(false);
      setUploadProgressById({});
      setUploadingFileId(null);
      stopTyping();
      onCancelReply();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      focusInput(editorRef.current);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Message send failed");
    } finally {
      setIsSending(false);
      setUploadingFileId(null);
    }
  };

  const applyFormat = (command: (typeof FORMAT_ACTIONS)[number]["command"]) => {
    const editor = editorRef.current;
    if (!editor || disabled || isSending) return;

    focusInput(editor);

    if (command === "code") {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;

      const selectedText = range.toString();
      const html = `<code>${escapeHtml(selectedText || "code")}</code>`;
      insertHtmlAtCursor(html);
      syncEditorState();
      return;
    }

    document.execCommand(command, false);
    syncEditorState();
  };

  const insertEmoji = (emoji: string) => {
    const editor = editorRef.current;
    if (!editor || disabled || isSending) return;

    focusInput(editor);
    insertTextAtCursor(emoji);
    syncEditorState();
  };

  useEffect(() => {
    if (disabled || isSending) return;
    focusInput(editorRef.current);
  }, [disabled, isSending, roomId, replyTo]);

  useEffect(() => {
    if (disabled) return;

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (isSending) return;
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      const editor = editorRef.current;
      if (!editor) return;

      if (event.key.length === 1) {
        event.preventDefault();
        focusInput(editor);
        placeCaretAtEnd(editor);
        insertTextAtCursor(event.key);
        syncEditorState();
        return;
      }

      if (event.key === "Backspace" && plainText.length > 0) {
        event.preventDefault();
        focusInput(editor);
        placeCaretAtEnd(editor);
        document.execCommand("delete", false);
        syncEditorState();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        focusInput(editor);
      }
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown);
    };
  }, [disabled, isSending, plainText, syncEditorState]);

  return (
    <div className="composer">
      {replyTo && (
        <div className="composer-reply">
          <div className="composer-reply-meta">
            <div className="composer-reply-label">Replying to {replyTo.sender}</div>
            <div className="composer-reply-text">{replyTo.text || "Message"}</div>
          </div>
          <button
            type="button"
            className="composer-reply-close"
            onClick={onCancelReply}
            disabled={isSending}
          >
            Cancel
          </button>
        </div>
      )}
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
              onClick={() => insertEmoji(emoji)}
              disabled={isSending || disabled}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="composer-formatbar">
        {FORMAT_ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="composer-format-btn"
            title={action.title}
            onClick={() => applyFormat(action.command)}
            disabled={disabled || isSending}
          >
            {action.label}
          </button>
        ))}
      </div>

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
        <div
          ref={editorRef}
          className="input composer-editor"
          contentEditable={!disabled && !isSending}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder="Type a message..."
          data-empty={plainText.trim().length === 0 ? "true" : "false"}
          onInput={() => syncEditorState()}
          onPaste={(event) => {
            const items = Array.from(event.clipboardData.items);
            const imageItem = items.find(
              (item) => item.kind === "file" && item.type.startsWith("image/"),
            );

            if (imageItem) {
              event.preventDefault();
              const file = imageItem.getAsFile();
              if (!file) return;

              const safeFile = new File(
                [file],
                `pasted-image-${Date.now()}.png`,
              );

              setQueuedFiles((prev) => [
                ...prev,
                { id: createUploadId(), file: safeFile },
              ]);
              return;
            }

            event.preventDefault();
            const pastedText = event.clipboardData.getData("text/plain");
            if (!pastedText) return;
            insertTextAtCursor(pastedText);
            syncEditorState();
          }

          }
          onBlur={() => {
            const normalized = normalizeComposerHtml(editorRef.current?.innerHTML ?? "");
            if (editorRef.current && editorRef.current.innerHTML !== normalized) {
              editorRef.current.innerHTML = normalized;
            }
            syncEditorState(normalized);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="btn"
          disabled={disabled || isSending || (!plainText.trim() && queuedFiles.length === 0)}
          onClick={() => void submit()}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
      {error && <div className="error composer-error">{error}</div>}
    </div>
  );
}
