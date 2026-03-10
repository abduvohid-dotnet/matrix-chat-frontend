import { useCallback, useEffect, useRef, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";

export function MessageInput({
  roomId,
  disabled,
  onSend,
}: {
  roomId: string;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const { client } = useMatrix();
  const [text, setText] = useState("");
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

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    stopTyping();
  };

  return (
    <div className="input-row">
      <input
        className="input"
        value={text}
        onChange={(e) => {
          const nextText = e.target.value;
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
        }}
        placeholder="Type a message..."
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        className="btn"
        disabled={disabled || !text.trim()}
        onClick={submit}
      >
        Send
      </button>
    </div>
  );
}
