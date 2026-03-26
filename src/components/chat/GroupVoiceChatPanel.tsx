import { useEffect, useMemo, useRef } from "react";
import { Mic, MicOff, PhoneCall, PhoneOff, Radio } from "lucide-react";

function bindStream(element: HTMLAudioElement | null, stream: MediaStream | null) {
  if (!element) return;
  element.srcObject = stream;
  element.muted = false;
  if (stream) {
    void element.play().catch(() => {
      // Autoplay can be blocked until user interaction.
    });
  }
}

export function GroupVoiceChatPanel({
  active,
  joined,
  micMuted,
  participantCount,
  participantNames,
  remoteFeeds,
  error,
  canManage,
  onJoin,
  onLeave,
  onEnd,
  onToggleMicrophone,
}: {
  active: boolean;
  joined: boolean;
  micMuted: boolean;
  participantCount: number;
  participantNames: string[];
  remoteFeeds: { id: string; stream: MediaStream }[];
  error: string | null;
  canManage: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onEnd: () => void;
  onToggleMicrophone: () => void;
}) {
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());

  useEffect(() => {
    remoteFeeds.forEach((feed) => {
      bindStream(audioRefs.current.get(feed.id) ?? null, feed.stream);
    });
  }, [remoteFeeds]);

  const participantSummary = useMemo(() => {
    if (!participantNames.length) return "Ishtirokchilar hali ulanmagan";
    if (participantNames.length === 1) return participantNames[0];
    if (participantNames.length === 2) return `${participantNames[0]} va ${participantNames[1]}`;
    return `${participantNames[0]}, ${participantNames[1]} va yana ${participantNames.length - 2} kishi`;
  }, [participantNames]);

  if (!active) return null;

  return (
    <div className="group-voice-panel">
      <div className="group-voice-hero">
        <div className="group-voice-icon">
          <Radio size={22} />
        </div>
        <div className="group-voice-copy">
          <div className="group-voice-title">Guruh ovozli chati</div>
          <div className="group-voice-meta">
            <span>{participantCount} ishtirokchi</span>
            <span className="group-voice-dot" />
            <span>{participantSummary}</span>
          </div>
          {error && <div className="group-voice-error">{error}</div>}
        </div>
      </div>

      <div className="group-voice-actions">
        {joined ? (
          <>
            <button type="button" className="btn ghost call-btn" onClick={() => void onToggleMicrophone()}>
              {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
              {micMuted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="btn ghost call-btn danger" onClick={onLeave}>
              <PhoneOff size={16} />
              Leave
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost call-btn" onClick={onJoin}>
            <PhoneCall size={16} />
            Join voice chat
          </button>
        )}

        {canManage && (
          <button type="button" className="btn ghost call-btn danger" onClick={onEnd}>
            <PhoneOff size={16} />
            End voice chat
          </button>
        )}
      </div>

      {remoteFeeds.map((feed) => (
        <audio
          key={feed.id}
          ref={(node) => {
            if (node) {
              audioRefs.current.set(feed.id, node);
            } else {
              audioRefs.current.delete(feed.id);
            }
          }}
          autoPlay
          playsInline
        />
      ))}
    </div>
  );
}
