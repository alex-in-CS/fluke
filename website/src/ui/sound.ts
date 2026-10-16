/**
 * A generative score, synthesised live with Web Audio (no audio files). Off until the visitor asks.
 * A soft pad moves through one chord per chapter, scrolling breathes a little air through it, and
 * arriving at a chapter rings a quiet two-note chime.
 */

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Am9 → Fmaj7 → Cmaj9 → G6 → Em7 → Dm9 → Fmaj9 → Am(add9): voiced close, low and warm.
const CHORDS = [
  [45, 52, 59, 60, 64],
  [41, 48, 52, 57, 64],
  [36, 43, 50, 52, 59],
  [43, 50, 52, 59, 62],
  [40, 47, 50, 55, 59],
  [38, 45, 52, 53, 57],
  [41, 48, 55, 57, 64],
  [45, 52, 59, 60, 71],
];

export class Score {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private padFilter!: BiquadFilterNode;
  private voices: OscillatorNode[][] = [];
  private airGain!: GainNode;
  private airFilter!: BiquadFilterNode;
  private on = false;
  private chord = 0;

  get enabled() {
    return this.on;
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;

    // Gentle room: a short feedback delay pair, filtered dark.
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const d1 = ctx.createDelay(1);
    const d2 = ctx.createDelay(1);
    d1.delayTime.value = 0.37;
    d2.delayTime.value = 0.53;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1800;
    d1.connect(d2).connect(damp).connect(fb).connect(d1);
    damp.connect(wet).connect(ctx.destination);
    this.master.connect(ctx.destination);
    this.master.connect(d1);

    // Pad: two slightly detuned voices per note through a slowly breathing low-pass.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    this.padFilter.connect(padGain).connect(this.master);
    this.voices = CHORDS[0].map((n, i) =>
      [-4, 4].map((cents) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = midi(n);
        o.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.9 : 0.42;
        o.connect(g).connect(this.padFilter);
        o.start();
        return o;
      }),
    );

    // Air: filtered noise that rises with scroll speed.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = "bandpass";
    this.airFilter.frequency.value = 900;
    this.airFilter.Q.value = 0.8;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    noise.connect(this.airFilter).connect(this.airGain).connect(this.master);
    noise.start();
  }

  async toggle() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    this.on = !this.on;
    if (this.on) await ctx.resume();
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.on ? 1 : 0, t + (this.on ? 2.4 : 0.6));
    if (!this.on) window.setTimeout(() => !this.on && ctx.suspend(), 700);
    return this.on;
  }

  /** Moves the pad to the chord for chapter `i` (0 = hero) and rings the arrival chime. */
  chapter(i: number) {
    const idx = Math.max(0, Math.min(CHORDS.length - 1, i));
    if (idx === this.chord) return;
    this.chord = idx;
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    CHORDS[idx].forEach((n, v) => this.voices[v].forEach((o) => o.frequency.setTargetAtTime(midi(n), t, 0.9)));
    if (idx > 0) this.chime(CHORDS[idx][4] + 12, t);
  }

  private chime(note: number, t: number) {
    const ctx = this.ctx!;
    [note, note + 7].forEach((n, k) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = midi(n);
      const g = ctx.createGain();
      const at = t + k * 0.11;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.022, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
      o.connect(g).connect(this.master);
      o.start(at);
      o.stop(at + 2.5);
    });
  }

  /** Scroll speed in px/s. */
  flow(pxPerSec: number) {
    if (!this.ctx || !this.on) return;
    const v = Math.min(1, Math.abs(pxPerSec) / 3500);
    const t = this.ctx.currentTime;
    this.airGain.gain.setTargetAtTime(v * 0.05, t, 0.12);
    this.airFilter.frequency.setTargetAtTime(700 + v * 1600, t, 0.2);
  }
}

/** Wires the nav toggle. Returns the score so the page can feed it chapters and scroll. */
export function initSound() {
  const score = new Score();
  const btn = document.querySelector<HTMLButtonElement>(".sound");
  if (!btn || !("AudioContext" in window)) {
    btn?.remove();
    return score;
  }
  btn.addEventListener("click", async () => {
    const on = await score.toggle();
    btn.setAttribute("aria-pressed", String(on));
  });
  return score;
}
