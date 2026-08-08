/**
 * Shared Web Audio helpers — a soft message chime and a custom looping
 * ringtone for calls. Everything is synthesized (no audio files to ship) and
 * every function degrades to a no-op when audio is unavailable.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (typeof AudioContext === "undefined") return null;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Creates/resumes the shared context. Call from a user gesture to unlock audio. */
export function primeAudio(): void {
  getCtx();
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine"
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** A soft, quiet three-note chime for incoming messages. */
export function playChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    tone(ctx, freq, now + i * 0.18, 0.8, 0.1);
  });
}

/** Call-ringtone preference (localStorage, default on). */
export function ringtoneEnabled(): boolean {
  try {
    return localStorage.getItem("aether_ringtone") !== "off";
  } catch {
    return true;
  }
}

/**
 * Plays the Aether ringtone — a bright, looping E5–G#5–B5 motif with a soft
 * second voice. Returns a stop function; call it when the call is answered,
 * declined or ended.
 */
export function playRingtone(): () => void {
  const ctx = getCtx();
  if (!ctx) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const motif: [number, number, number][] = [
    [659.25, 0.0, 0.3],
    [830.61, 0.3, 0.3],
    [987.77, 0.6, 0.5],
    [659.25, 1.1, 0.3],
    [830.61, 1.4, 0.3],
    [987.77, 1.7, 0.7],
  ];

  const loop = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    for (const [freq, off, dur] of motif) {
      tone(ctx, freq, now + off, dur, 0.16);
      // A shimmering octave underneath makes it feel richer than a plain beep.
      tone(ctx, freq / 2, now + off, dur, 0.06, "triangle");
    }
    timer = setTimeout(loop, 2450);
  };
  loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
