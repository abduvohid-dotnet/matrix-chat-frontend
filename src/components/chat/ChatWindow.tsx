import { useEffect, useRef } from "react";
import type { UiMessage } from "../../hooks/useMatrixTimeline";

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatWindow({ messages, myUserId }: { messages: UiMessage[]; myUserId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={containerRef} className="chat-window">
      {!messages.length ? (
        <div className="chat-empty">No messages yet. Send first message.</div>
      ) : (
        messages.map((m) => (
          <div key={m.id} className={`msg ${m.sender === myUserId ? "me" : ""}`}>
            <div className="msg-meta">
              <div className="msg-sender">{m.sender}</div>
              <div className="msg-time">{formatMessageTime(m.ts)}</div>
            </div>
            <div className="msg-text">{m.text}</div>
          </div>
        ))
      )}
    </div>
  );
}
