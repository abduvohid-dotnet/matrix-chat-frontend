import { useCallback, useEffect, useRef, useState } from "react";
import { CallEvent, ClientEvent, EventType, MsgType, type MatrixEvent } from "matrix-js-sdk";
import { CallErrorCode, CallState, CallType, type MatrixCall } from "matrix-js-sdk/lib/webrtc/call";
import { CallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/callEventHandler";
import { useMatrix } from "../app/providers/useMatrix";
import { CallAudioController } from "../services/callAudio";

type UseMatrixCallState = {
  call: MatrixCall | null;
  roomId: string | null;
  state: CallState | null;
  type: CallType | null;
  incoming: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraMuted: boolean;
  error: string | null;
};

const INITIAL_STATE: UseMatrixCallState = {
  call: null,
  roomId: null,
  state: null,
  type: null,
  incoming: false,
  localStream: null,
  remoteStream: null,
  micMuted: false,
  cameraMuted: true,
  error: null,
};

const ACTIVE_CALL_STORAGE_KEY = "matrix_active_call_v1";

type StoredCallMeta = {
  roomId: string;
  type: CallType | null;
  incoming: boolean;
};

type CallLogState = {
  roomId: string | null;
  incoming: boolean;
  connectedAt: number | null;
  endedLogged: boolean;
};

function inferCallTypeFromInvite(content: Record<string, unknown>): CallType | null {
  const offer = content.offer;
  if (!offer || typeof offer !== "object") return null;

  const sdp = "sdp" in offer && typeof offer.sdp === "string" ? offer.sdp : null;
  if (!sdp) return null;

  return sdp.includes("m=video") ? CallType.Video : CallType.Voice;
}

function readStoredCallMeta(): StoredCallMeta | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCallMeta>;
    if (!parsed.roomId || typeof parsed.roomId !== "string") return null;

    return {
      roomId: parsed.roomId,
      type: parsed.type ?? null,
      incoming: Boolean(parsed.incoming),
    };
  } catch {
    return null;
  }
}

function writeStoredCallMeta(meta: StoredCallMeta): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(ACTIVE_CALL_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage failures.
  }
}

function clearStoredCallMeta(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function formatCallDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getCallNoticeLabel(type: CallType | null): string {
  return type === CallType.Video ? "Video qo'ng'iroq" : "Audio qo'ng'iroq";
}

export function useMatrixCall() {
  const { client } = useMatrix();
  const [callState, setCallState] = useState<UseMatrixCallState>(INITIAL_STATE);
  const cleanupRef = useRef<(() => void) | null>(null);
  const activeCallRef = useRef<MatrixCall | null>(null);
  const recoverTimeoutRef = useRef<number | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const previousStateRef = useRef<CallState | null>(null);
  const audioRef = useRef<CallAudioController | null>(null);
  const callLogRef = useRef<CallLogState>({
    roomId: null,
    incoming: false,
    connectedAt: null,
    endedLogged: false,
  });

  if (!audioRef.current) {
    audioRef.current = new CallAudioController();
  }

  const detachActiveCall = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    activeCallRef.current = null;
  }, []);

  const clearRecoverTimeout = useCallback(() => {
    if (recoverTimeoutRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(recoverTimeoutRef.current);
    recoverTimeoutRef.current = null;
  }, []);

  const sendCallNotice = useCallback(
    async (roomId: string, body: string) => {
      if (!client) return;

      await client.sendEvent(roomId, EventType.RoomMessage, {
        msgtype: MsgType.Notice,
        body,
      });
    },
    [client],
  );

  const resetCallLog = useCallback(() => {
    callLogRef.current = {
      roomId: null,
      incoming: false,
      connectedAt: null,
      endedLogged: false,
    };
  }, []);

  const primeCallLog = useCallback((call: MatrixCall, incoming: boolean) => {
    callLogRef.current = {
      roomId: call.roomId,
      incoming,
      connectedAt: null,
      endedLogged: false,
    };
  }, []);

  const markConnectedCall = useCallback((call: MatrixCall) => {
    const session = callLogRef.current;
    if (session.roomId !== call.roomId || session.connectedAt) return;
    session.connectedAt = Date.now();
  }, []);

  const logCompletedCall = useCallback(
    (call: MatrixCall) => {
      const session = callLogRef.current;
      if (session.roomId !== call.roomId || session.incoming || session.endedLogged || !session.connectedAt) {
        return;
      }

      session.endedLogged = true;
      void sendCallNotice(
        call.roomId,
        `${getCallNoticeLabel(call.type)} tugadi. Davomiyligi: ${formatCallDuration(Date.now() - session.connectedAt)}`,
      );
    },
    [sendCallNotice],
  );

  const resetCallState = useCallback(() => {
    clearRecoverTimeout();
    detachActiveCall();
    lastErrorRef.current = null;
    clearStoredCallMeta();
    resetCallLog();
    setCallState(INITIAL_STATE);
    audioRef.current?.stop();
  }, [clearRecoverTimeout, detachActiveCall, resetCallLog]);

  const syncFromCall = useCallback((call: MatrixCall, incoming: boolean, error?: string | null) => {
    if (error !== undefined) {
      lastErrorRef.current = error;
    }

    writeStoredCallMeta({
      roomId: call.roomId,
      type: call.type,
      incoming,
    });

    setCallState({
      call,
      roomId: call.roomId,
      state: call.state,
      type: call.type,
      incoming,
      localStream: call.localUsermediaStream ?? null,
      remoteStream: call.remoteUsermediaStream ?? null,
      micMuted: call.isMicrophoneMuted(),
      cameraMuted: call.isLocalVideoMuted(),
      error: error ?? null,
    });
  }, []);

  const showCallPlaceholder = useCallback((meta: StoredCallMeta, state: CallState, error?: string | null) => {
    if (state === CallState.Ended) {
      clearStoredCallMeta();
    } else {
      writeStoredCallMeta(meta);
    }
    if (error !== undefined) {
      lastErrorRef.current = error;
    }

    setCallState((prev) => ({
      call: null,
      roomId: meta.roomId,
      state,
      type: meta.type,
      incoming: meta.incoming,
      localStream: null,
      remoteStream: null,
      micMuted: false,
      cameraMuted: true,
      error: error ?? prev.error ?? null,
    }));
  }, []);

  const scheduleRecoverCleanup = useCallback(() => {
    if (typeof window === "undefined") return;
    clearRecoverTimeout();
    recoverTimeoutRef.current = window.setTimeout(() => {
      if (activeCallRef.current) return;
      if (!readStoredCallMeta()) return;
      resetCallState();
    }, 2500);
  }, [clearRecoverTimeout, resetCallState]);

  const getExistingActiveCall = useCallback((): MatrixCall | null => {
    const rawClient = client as (typeof client & {
      callEventHandler?: {
        calls?: Map<string, MatrixCall>;
      };
    }) | null;

    const calls = rawClient?.callEventHandler?.calls;
    if (!calls || calls.size === 0) return null;

    const active = Array.from(calls.values()).find((call) => call.state !== CallState.Ended) ?? null;
    return active;
  }, [client]);

  const hydrateStoredCallMeta = useCallback(() => {
    const stored = readStoredCallMeta();
    if (!stored) return false;

    setCallState((prev) => {
      if (prev.call || prev.roomId === stored.roomId) return prev;
      return {
        ...prev,
        roomId: stored.roomId,
        type: stored.type,
        incoming: stored.incoming,
        state: CallState.Connecting,
        error: "Call sessionni tiklash kutilmoqda",
      };
    });

    return true;
  }, []);

  const preserveStoredCallMeta = useCallback(() => {
    const stored = readStoredCallMeta();
    if (!stored) {
      setCallState(INITIAL_STATE);
      return;
    }

    setCallState((prev) => ({
      call: null,
      roomId: stored.roomId,
      state: prev.state ?? CallState.Connecting,
      type: stored.type,
      incoming: stored.incoming,
      localStream: null,
      remoteStream: null,
      micMuted: false,
      cameraMuted: true,
      error: prev.error ?? lastErrorRef.current ?? "Call sessionni tiklash kutilmoqda",
    }));
  }, []);

  const attachCall = useCallback(
    (call: MatrixCall, incoming: boolean) => {
      if (activeCallRef.current === call) {
        syncFromCall(call, incoming, callState.error);
        return;
      }

      clearRecoverTimeout();
      cleanupRef.current?.();
      activeCallRef.current = call;
      primeCallLog(call, incoming);
      syncFromCall(call, incoming, null);

      const isActiveCall = () => activeCallRef.current === call;

      const onState = (state: CallState) => {
        if (!isActiveCall()) return;
        if (state === CallState.Connected) {
          markConnectedCall(call);
        }
        if (state === CallState.Ended) {
          logCompletedCall(call);
          detachActiveCall();
          if (lastErrorRef.current) {
            showCallPlaceholder(
              {
                roomId: call.roomId,
                type: call.type,
                incoming,
              },
              CallState.Ended,
              lastErrorRef.current,
            );
            return;
          }

          resetCallState();
          return;
        }

        syncFromCall(call, incoming, null);
      };

      const onHangup = () => {
        if (!isActiveCall()) return;
        logCompletedCall(call);
        resetCallState();
      };

      const onFeedsChanged = () => {
        if (!isActiveCall()) return;
        syncFromCall(call, incoming, null);
      };

      const onError = (error: Error) => {
        if (!isActiveCall()) return;
        syncFromCall(call, incoming, error.message);
      };

      const onReplaced = (newCall: MatrixCall) => {
        if (!isActiveCall()) return;
        attachCall(newCall, incoming);
      };

      call.on(CallEvent.State, onState);
      call.on(CallEvent.Hangup, onHangup);
      call.on(CallEvent.FeedsChanged, onFeedsChanged);
      call.on(CallEvent.Error, onError);
      call.on(CallEvent.Replaced, onReplaced);

      cleanupRef.current = () => {
        call.off(CallEvent.State, onState);
        call.off(CallEvent.Hangup, onHangup);
        call.off(CallEvent.FeedsChanged, onFeedsChanged);
        call.off(CallEvent.Error, onError);
        call.off(CallEvent.Replaced, onReplaced);
      };
    },
    [callState.error, clearRecoverTimeout, detachActiveCall, logCompletedCall, markConnectedCall, primeCallLog, resetCallState, showCallPlaceholder, syncFromCall],
  );

  useEffect(() => {
    if (!client) {
      detachActiveCall();
      preserveStoredCallMeta();
      return;
    }

    const recoverExistingCall = (clearIfMissing = false) => {
      const existingCall = getExistingActiveCall();
      if (!existingCall) {
        if (clearIfMissing && readStoredCallMeta()) {
          resetCallState();
          return;
        }
        hydrateStoredCallMeta();
        scheduleRecoverCleanup();
        return;
      }
      const isIncoming = existingCall.direction !== undefined
        ? existingCall.direction !== "outbound"
        : callState.incoming;
      attachCall(existingCall, isIncoming);
    };

    const onIncoming = (call: MatrixCall) => {
      attachCall(call, true);
    };

    const onVoipEvent = (event: MatrixEvent) => {
      const eventType = event.getType();
      const roomId = event.getRoomId() ?? null;

      if (!roomId) return;

      if (eventType === "m.call.invite") {
        showCallPlaceholder(
          {
            roomId,
            type: inferCallTypeFromInvite(event.getContent()),
            incoming: true,
          },
          CallState.Ringing,
        );

        setTimeout(() => {
          recoverExistingCall();
        }, 0);
      }

      if (eventType === "m.call.hangup" && callState.roomId === roomId && !activeCallRef.current) {
        resetCallState();
      }
    };

    recoverExistingCall();
    const onSync = () => {
      recoverExistingCall(true);
    };

    client.on(CallEventHandlerEvent.Incoming, onIncoming);
    client.on(ClientEvent.Sync, onSync);
    client.on(ClientEvent.ReceivedVoipEvent, onVoipEvent);
    return () => {
      client.off(CallEventHandlerEvent.Incoming, onIncoming);
      client.off(ClientEvent.Sync, onSync);
      client.off(ClientEvent.ReceivedVoipEvent, onVoipEvent);
    };
  }, [attachCall, callState.incoming, callState.roomId, client, detachActiveCall, getExistingActiveCall, hydrateStoredCallMeta, preserveStoredCallMeta, resetCallState, scheduleRecoverCleanup, showCallPlaceholder]);

  useEffect(() => {
    const previousState = previousStateRef.current;
    audioRef.current?.playForState(callState.state, callState.incoming, previousState);
    previousStateRef.current = callState.state;
  }, [callState.incoming, callState.state]);

  useEffect(() => {
    return () => {
      clearRecoverTimeout();
      cleanupRef.current?.();
      audioRef.current?.destroy();
    };
  }, [clearRecoverTimeout]);

  const startVoiceCall = useCallback(
    async (roomId: string) => {
      if (!client || !roomId) return;

      void audioRef.current?.unlock();
      const call = client.createCall(roomId);
      if (!call) {
        setCallState((prev) => ({ ...prev, error: "Browser call support mavjud emas" }));
        return;
      }

      attachCall(call, false);
      try {
        await call.placeVoiceCall();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice call boshlanmadi";
        showCallPlaceholder({ roomId, type: CallType.Voice, incoming: false }, CallState.Ended, message);
      }
    },
    [attachCall, client, showCallPlaceholder],
  );

  const startVideoCall = useCallback(
    async (roomId: string) => {
      if (!client || !roomId) return;

      void audioRef.current?.unlock();
      const call = client.createCall(roomId);
      if (!call) {
        setCallState((prev) => ({ ...prev, error: "Browser call support mavjud emas" }));
        return;
      }

      attachCall(call, false);
      try {
        await call.placeVideoCall();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Video call boshlanmadi";
        showCallPlaceholder({ roomId, type: CallType.Video, incoming: false }, CallState.Ended, message);
      }
    },
    [attachCall, client, showCallPlaceholder],
  );

  const answer = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    void audioRef.current?.unlock();
    await call.answer(true, call.type === CallType.Video);
    syncFromCall(call, callState.incoming, null);
  }, [callState.incoming, syncFromCall]);

  const reject = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) {
      resetCallState();
      return;
    }
    void sendCallNotice(call.roomId, "Qo'ng'iroq rad etildi");
    call.reject();
    resetCallState();
  }, [resetCallState, sendCallNotice]);

  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) {
      resetCallState();
      return;
    }
    call.hangup(CallErrorCode.UserHangup, false);
    resetCallState();
  }, [resetCallState]);

  const toggleMicrophone = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    await call.setMicrophoneMuted(!call.isMicrophoneMuted());
    syncFromCall(call, callState.incoming, callState.error);
  }, [callState.error, callState.incoming, syncFromCall]);

  const toggleCamera = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || call.type !== CallType.Video) return;
    await call.setLocalVideoMuted(!call.isLocalVideoMuted());
    syncFromCall(call, callState.incoming, callState.error);
  }, [callState.error, callState.incoming, syncFromCall]);

  return {
    ...callState,
    startVoiceCall,
    startVideoCall,
    answer,
    reject,
    hangup,
    toggleMicrophone,
    toggleCamera,
    inCall: Boolean(callState.call || callState.roomId),
  };
}
