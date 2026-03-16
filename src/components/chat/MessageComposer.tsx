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
import { Mic, Paperclip, SendHorizontal, Trash2 } from "lucide-react";

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

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

const RECORDING_BARS = [9, 14, 10, 18, 12, 20, 11, 16, 9, 19, 13, 17, 10, 15, 8, 18];

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

function formatRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getRecordingExtension(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const keepRecordingRef = useRef(true);
  const sendRecordingImmediatelyRef = useRef(false);

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

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    stopRecordingTimer();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    keepRecordingRef.current = true;
    sendRecordingImmediatelyRef.current = false;
  }, [stopRecordingTimer]);

  useEffect(() => {
    stopTyping();
  }, [roomId, stopTyping]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        keepRecordingRef.current = false;
        mediaRecorderRef.current.stop();
      }
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const addQueuedFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const next = files.map((file) => ({ id: createUploadId(), file }));
    setQueuedFiles((prev) => [...prev, ...next]);
  }, []);

  const queueSelectedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addQueuedFiles(Array.from(files));
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

  const stopAudioRecording = useCallback((keepRecording: boolean, sendImmediately = false) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    keepRecordingRef.current = keepRecording;
    sendRecordingImmediatelyRef.current = sendImmediately;
    setIsRecording(false);
    stopRecordingTimer();

    if (recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    cleanupRecordingResources();
    setRecordingDurationMs(0);
  }, [cleanupRecordingResources, stopRecordingTimer]);

  const startAudioRecording = useCallback(async () => {
    if (disabled || isSending || isRecording) return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Browser audio recordingni qo'llamaydi");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("MediaRecorder mavjud emas");
      return;
    }

    setError(null);
    setShowEmoji(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      keepRecordingRef.current = true;
      setRecordingDurationMs(0);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("Audio yozishda xatolik yuz berdi");
      };

      recorder.onstop = () => {
        const shouldKeep = keepRecordingRef.current;
        const nextMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type: nextMimeType });

        cleanupRecordingResources();
        setIsRecording(false);
        setRecordingDurationMs(0);

        if (!shouldKeep || blob.size === 0) return;

        const extension = getRecordingExtension(nextMimeType);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File(
          [blob],
          `Audio message ${timestamp}.${extension}`,
          { type: nextMimeType, lastModified: Date.now() },
        );

        if (sendRecordingImmediatelyRef.current) {
          setIsSending(true);
          setError(null);
          setUploadingFileId("recording");
          setUploadProgressById({ recording: 0 });

          void sendFileMessage(
            roomId,
            file,
            (progress) => {
              const percent = toPercent(progress);
              setUploadProgressById((prev) => ({ ...prev, recording: percent }));
            },
            replyTo,
          )
            .then(() => {
              setUploadProgressById({});
              setUploadingFileId(null);
              stopTyping();
              onCancelReply();
              focusInput(editorRef.current);
            })
            .catch((sendError: unknown) => {
              setError(sendError instanceof Error ? sendError.message : "Audio message yuborilmadi");
            })
            .finally(() => {
              setIsSending(false);
              setUploadingFileId(null);
              setUploadProgressById({});
            });
          return;
        }

        addQueuedFiles([file]);
        setError(null);
      };

      recorder.start(250);
      recordingTimerRef.current = window.setInterval(() => {
        const startedAt = recordingStartedAtRef.current;
        if (!startedAt) return;
        setRecordingDurationMs(Date.now() - startedAt);
      }, 200);
    } catch (recordError) {
      cleanupRecordingResources();
      setIsRecording(false);
      setRecordingDurationMs(0);
      setError(recordError instanceof Error ? recordError.message : "Audio recording boshlanmadi");
    }
  }, [addQueuedFiles, cleanupRecordingResources, disabled, isRecording, isSending, onCancelReply, replyTo, roomId, sendFileMessage, stopTyping]);

  const submit = async () => {
    const normalizedHtml = normalizeComposerHtml(editorHtml);
    const trimmedText = formattedHtmlToPlainText(normalizedHtml).trim();

    if (isRecording || (!trimmedText && queuedFiles.length === 0) || isSending || disabled) return;

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
    if (disabled || isSending || isRecording) return;
    focusInput(editorRef.current);
  }, [disabled, isRecording, isSending, roomId, replyTo]);

  useEffect(() => {
    if (disabled || isRecording) return;

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
  }, [disabled, isRecording, isSending, plainText, syncEditorState]);

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

      {isRecording && (
        <div className="composer-recording-live">
          <button
            type="button"
            className="composer-recording-trash"
            onClick={() => stopAudioRecording(false)}
            disabled={isSending}
            title="Discard recording"
          >
            <Trash2 size={18} />
          </button>
          <div className="composer-recording-track">
            <div className="composer-recording-pulse" />
            <div className="composer-recording-bars" aria-hidden>
              {RECORDING_BARS.map((height, index) => (
                <span
                  key={`recording-bar-${height}-${index}`}
                  className="composer-recording-bar"
                  style={{ height: `${height}px`, animationDelay: `${index * 0.08}s` }}
                />
              ))}
            </div>
            <div className="composer-recording-live-time">{formatRecordingDuration(recordingDurationMs)}</div>
          </div>
          <button
            type="button"
            className="composer-recording-send"
            onClick={() => stopAudioRecording(true, true)}
            disabled={isSending}
            title="Send voice message"
          >
            <SendHorizontal size={18} />
          </button>
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

      {!isRecording && (
      <div className="composer-formatbar">
        {FORMAT_ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="composer-format-btn"
            title={action.title}
            onClick={() => applyFormat(action.command)}
            disabled={disabled || isSending || isRecording}
          >
            {action.label}
          </button>
        ))}
      </div>
      )}

      <div className="input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="composer-file-input"
          onChange={(e) => queueSelectedFiles(e.target.files)}
          disabled={disabled || isSending || isRecording}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
        />
        {!isRecording && (
        <div className="composer-shell">
          <button
            type="button"
            className="btn ghost composer-action"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isSending || isRecording}
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <button
            type="button"
            className="btn ghost composer-action"
            onClick={() => void startAudioRecording()}
            disabled={disabled || isSending}
            title="Record audio message"
          >
            <Mic size={18} />
          </button>
          <button
            type="button"
            className="btn ghost composer-action composer-emoji-toggle"
            onClick={() => setShowEmoji((prev) => !prev)}
            disabled={disabled || isSending || isRecording}
          >
            Emoji
          </button>
          <div
            ref={editorRef}
            className="input composer-editor"
            contentEditable={!disabled && !isSending && !isRecording}
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
            }}
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
            className="btn composer-send-btn"
            disabled={disabled || isSending || isRecording || (!plainText.trim() && queuedFiles.length === 0)}
            onClick={() => void submit()}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
        )}
      </div>
      {error && <div className="error composer-error">{error}</div>}
    </div>
  );
}
