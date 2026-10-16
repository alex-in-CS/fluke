import type { SceneState } from "../scene/state";

/*
 * "Try it with your voice". The microphone drives the You stream in the scene through a local
 * analyser. Captions only appear where the browser can transcribe on-device
 * (SpeechRecognition.processLocally); audio is never sent anywhere from this page.
 */

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string | boolean>;
};

const QUESTION = /^(what|when|where|who|whom|whose|why|how|which|can|could|would|will|should|shall|do|does|did|is|are|was|were|have|has|had|may|might)\b/i;

async function localRecognizer(): Promise<RecCtor | null> {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor || !("processLocally" in Ctor.prototype) || !Ctor.available) return null;
  try {
    const status = await Ctor.available({ langs: [navigator.language || "en-US"], processLocally: true });
    return status === true || status === "available" ? Ctor : null;
  } catch {
    return null;
  }
}

export function initVoice(state: SceneState) {
  const trigger = document.querySelector<HTMLButtonElement>(".talk");
  const strip = document.querySelector<HTMLElement>(".caption");
  if (!trigger || !strip || !navigator.mediaDevices?.getUserMedia) {
    trigger?.remove();
    return;
  }
  const text = strip.querySelector<HTMLElement>(".caption__text")!;
  const note = strip.querySelector<HTMLElement>(".caption__note")!;
  const chip = strip.querySelector<HTMLElement>(".caption__chip")!;
  const stopBtn = strip.querySelector<HTMLButtonElement>(".caption__stop")!;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let rec: Rec | null = null;
  let raf = 0;
  let level = 0;
  let finalText = "";
  let chipTimer = 0;

  const show = (t: string, interim = "") => {
    const words = `${t} ${interim}`.trim().split(/\s+/);
    const tail = words.slice(-14).join(" ");
    text.textContent = tail;
    text.classList.toggle("is-empty", !tail);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    rec?.stop();
    rec = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close();
    ctx = null;
    state.voice = 0;
    strip.classList.remove("is-on");
    trigger.setAttribute("aria-pressed", "false");
  };

  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      note.textContent = "Microphone access was blocked.";
      strip.classList.add("is-on");
      window.setTimeout(() => strip.classList.remove("is-on"), 2600);
      return;
    }
    trigger.setAttribute("aria-pressed", "true");
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const target = Math.min(1, Math.max(0, (rms - 0.008) * 9));
      // Fast attack, gentle release: reads like a meter, not a flicker.
      level += (target - level) * (target > level ? 0.45 : 0.08);
      state.voice = level;
      strip.style.setProperty("--level", level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();

    finalText = "";
    show("");
    chip.hidden = true;
    const Rec = await localRecognizer();
    if (Rec && stream) {
      note.textContent = "Transcribed on this device. Nothing leaves your browser.";
      rec = new Rec();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.processLocally = true;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const said = r[0].transcript.trim();
          if (r.isFinal) {
            finalText = `${finalText} ${said}`.trim();
            if (QUESTION.test(said) || said.endsWith("?")) {
              chip.hidden = false;
              clearTimeout(chipTimer);
              chipTimer = window.setTimeout(() => (chip.hidden = true), 4200);
            }
          } else interim += ` ${said}`;
        }
        show(finalText, interim);
      };
      // Recognition sessions end on silence; keep listening while the strip is open.
      rec.onend = () => rec && stream && rec.start();
      rec.onerror = () => undefined;
      rec.start();
    } else {
      note.textContent = "Listening on this page only. Nothing is recorded or sent.";
    }
    strip.classList.add("is-on");
  };

  trigger.addEventListener("click", () => (stream ? stop() : void start()));
  stopBtn.addEventListener("click", stop);
  document.addEventListener("visibilitychange", () => document.hidden && stream && stop());
}
