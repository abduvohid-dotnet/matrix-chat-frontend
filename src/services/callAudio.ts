import { CallState } from "matrix-js-sdk/lib/webrtc/call";

type CallSoundMode = "idle" | "incoming" | "outgoing" | "connected" | "ended";

type AudioWindow = Window & typeof globalThis & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const scopedWindow = window as AudioWindow;
  return scopedWindow.AudioContext ?? scopedWindow.webkitAudioContext ?? null;
}

export class CallAudioController {
  private context: AudioContext | null = null;
  private loopTimer: number | null = null;
  private currentMode: CallSoundMode = "idle";
  private activeOscillators = new Set<OscillatorNode>();
  private unlocked = false;

  constructor() {
    if (typeof window === "undefined") return;

    const unlock = () => {
      void this.unlock();
    };

    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (!context) return;

    try {
      if (context.state === "suspended") {
        await context.resume();
      }
      this.unlocked = context.state === "running";
      if (!this.unlocked) return;

      if (this.currentMode === "incoming" && this.loopTimer === null) {
        this.scheduleIncomingLoop();
      }

      if (this.currentMode === "outgoing" && this.loopTimer === null) {
        this.scheduleOutgoingLoop();
      }
    } catch {
      this.unlocked = false;
    }
  }

  playForState(state: CallState | null, incoming: boolean, previousState: CallState | null): void {
    if (!state) {
      this.stop();
      return;
    }

    if (incoming && state === CallState.Ringing) {
      this.startIncomingLoop();
      return;
    }

    const shouldPlayOutgoing = !incoming && [
      CallState.WaitLocalMedia,
      CallState.CreateOffer,
      CallState.InviteSent,
      CallState.Connecting,
    ].includes(state);

    if (shouldPlayOutgoing) {
      this.startOutgoingLoop();
      return;
    }

    if (state === CallState.Connected) {
      if (previousState !== CallState.Connected) {
        this.playConnectedTone();
      } else {
        this.stop();
      }
      return;
    }

    if (state === CallState.Ended) {
      if (previousState !== CallState.Ended) {
        this.playEndedTone();
      } else {
        this.stop();
      }
      return;
    }

    this.stop();
  }

  stop(): void {
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    for (const oscillator of this.activeOscillators) {
      try {
        oscillator.stop();
      } catch {
        // Ignore already-stopped oscillators.
      }
    }

    this.activeOscillators.clear();
    this.currentMode = "idle";
  }

  destroy(): void {
    this.stop();
    if (this.context && this.context.state !== "closed") {
      void this.context.close().catch(() => {
        // Ignore close failures.
      });
    }
    this.context = null;
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return null;

    this.context = new AudioContextCtor();
    this.unlocked = this.context.state === "running";
    return this.context;
  }

  private startIncomingLoop(): void {
    if (this.currentMode === "incoming") return;

    this.stop();
    this.currentMode = "incoming";
    this.scheduleIncomingLoop();
  }

  private scheduleIncomingLoop(): void {
    if (this.currentMode !== "incoming") return;

    const context = this.getContext();
    if (!context || !this.unlocked) return;

    const startAt = context.currentTime + 0.02;
    this.playDualTone(startAt, 0.35, 523.25, 659.25, 0.035);
    this.playDualTone(startAt + 0.55, 0.35, 523.25, 659.25, 0.035);

    this.loopTimer = window.setTimeout(() => {
      this.scheduleIncomingLoop();
    }, 3200);
  }

  private startOutgoingLoop(): void {
    if (this.currentMode === "outgoing") return;

    this.stop();
    this.currentMode = "outgoing";
    this.scheduleOutgoingLoop();
  }

  private scheduleOutgoingLoop(): void {
    if (this.currentMode !== "outgoing") return;

    const context = this.getContext();
    if (!context || !this.unlocked) return;

    const startAt = context.currentTime + 0.02;
    this.playDualTone(startAt, 1.4, 440, 480, 0.02);

    this.loopTimer = window.setTimeout(() => {
      this.scheduleOutgoingLoop();
    }, 4000);
  }

  private playConnectedTone(): void {
    this.stop();
    this.currentMode = "connected";

    const context = this.getContext();
    if (!context || !this.unlocked) return;

    const startAt = context.currentTime + 0.02;
    this.playTone(startAt, 0.12, 660, 0.03);
    this.playTone(startAt + 0.14, 0.18, 880, 0.028);
  }

  private playEndedTone(): void {
    this.stop();
    this.currentMode = "ended";

    const context = this.getContext();
    if (!context || !this.unlocked) return;

    const startAt = context.currentTime + 0.02;
    this.playTone(startAt, 0.14, 440, 0.03);
    this.playTone(startAt + 0.16, 0.2, 330, 0.028);
  }

  private playDualTone(startAt: number, duration: number, firstFrequency: number, secondFrequency: number, gain: number): void {
    this.playTone(startAt, duration, firstFrequency, gain);
    this.playTone(startAt, duration, secondFrequency, gain);
  }

  private playTone(startAt: number, duration: number, frequency: number, gainValue: number): void {
    const context = this.getContext();
    if (!context || !this.unlocked) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
    gain.gain.setValueAtTime(gainValue, startAt + Math.max(duration - 0.05, 0.02));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.onended = () => {
      this.activeOscillators.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };

    this.activeOscillators.add(oscillator);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}
