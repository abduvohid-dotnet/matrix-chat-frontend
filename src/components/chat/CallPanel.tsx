import { useEffect, useRef } from "react";
import { CallState } from "matrix-js-sdk/lib/webrtc/call";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";

function bindStream(element: HTMLMediaElement | null, stream: MediaStream | null, muted: boolean) {
  if (!element) return;
  element.srcObject = stream;
  element.muted = muted;
  if (stream) {
    void element.play().catch(() => {
      // Autoplay can be blocked until user interaction.
    });
  }
}

function getCallLabel(state: CallState | null, incoming: boolean): string {
  if (!state) return "";
  if (incoming && state === CallState.Ringing) return "Incoming call";
  if (state === CallState.Connected) return "Connected";
  if (state === CallState.Connecting) return "Connecting";
  if (state === CallState.CreateOffer || state === CallState.CreateAnswer) return "Preparing call";
  if (state === CallState.InviteSent) return "Calling...";
  if (state === CallState.WaitLocalMedia) return "Requesting media...";
  if (state === CallState.Ringing) return "Ringing";
  return state;
}

export function CallPanel({
  localStream,
  remoteStream,
  state,
  incoming,
  micMuted,
  error,
  onAnswer,
  onReject,
  onHangup,
  onToggleMicrophone,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: CallState | null;
  incoming: boolean;
  micMuted: boolean;
  error: string | null;
  onAnswer: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMicrophone: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    bindStream(localVideoRef.current, localStream, true);
  }, [localStream]);

  useEffect(() => {
    bindStream(remoteAudioRef.current, remoteStream, false);
  }, [remoteStream]);

  return (
    <div className="call-panel">
      <div className="call-stage">
        <div className="call-avatar">{incoming ? "Incoming voice call" : "Voice call"}</div>
        <audio ref={remoteAudioRef} autoPlay playsInline />
        {localStream && (
          <video
            ref={localVideoRef}
            className="call-local-video audio-only"
            autoPlay
            playsInline
          />
        )}
      </div>

      <div className="call-meta">
        <div className="call-status">{getCallLabel(state, incoming)}</div>
        {error && <div className="call-error">{error}</div>}
      </div>

      <div className="call-actions">
        {incoming && state === CallState.Ringing ? (
          <>
            <button type="button" className="btn ghost call-btn" onClick={onAnswer}>
              <Phone size={16} />
              Answer
            </button>
            <button type="button" className="btn ghost call-btn danger" onClick={onReject}>
              <PhoneOff size={16} />
              Reject
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost call-btn" onClick={() => void onToggleMicrophone()}>
              {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
              {micMuted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="btn ghost call-btn danger" onClick={onHangup}>
              <PhoneOff size={16} />
              End
            </button>
          </>
        )}
      </div>
    </div>
  );
}
