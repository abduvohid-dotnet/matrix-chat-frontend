import { useEffect, useRef } from "react";
import { CallState, CallType } from "matrix-js-sdk/lib/webrtc/call";
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

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
  type,
  localStream,
  remoteStream,
  state,
  incoming,
  micMuted,
  cameraMuted,
  error,
  onAnswer,
  onReject,
  onHangup,
  onToggleMicrophone,
  onToggleCamera,
}: {
  type: CallType | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: CallState | null;
  incoming: boolean;
  micMuted: boolean;
  cameraMuted: boolean;
  error: string | null;
  onAnswer: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const isVideoCall = type === CallType.Video;

  useEffect(() => {
    bindStream(localVideoRef.current, isVideoCall ? localStream : null, true);
  }, [isVideoCall, localStream]);

  useEffect(() => {
    bindStream(remoteAudioRef.current, isVideoCall ? null : remoteStream, false);
    bindStream(remoteVideoRef.current, isVideoCall ? remoteStream : null, false);
  }, [isVideoCall, remoteStream]);

  return (
    <div className="call-panel">
      <div className="call-stage">
        {isVideoCall && remoteStream ? (
          <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
        ) : (
          <div className="call-avatar">{incoming ? `Incoming ${isVideoCall ? "video" : "voice"} call` : `${isVideoCall ? "Video" : "Voice"} call`}</div>
        )}
        <audio ref={remoteAudioRef} autoPlay playsInline />
        {isVideoCall && localStream && (
          <video
            ref={localVideoRef}
            className="call-local-video"
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
            {isVideoCall && (
              <button type="button" className="btn ghost call-btn" onClick={() => void onToggleCamera()}>
                {cameraMuted ? <CameraOff size={16} /> : <Camera size={16} />}
                {cameraMuted ? "Camera on" : "Camera off"}
              </button>
            )}
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
