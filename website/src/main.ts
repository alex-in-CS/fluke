import "./styles.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { Stage } from "./scene/stage";
import { createState } from "./scene/state";
import { setTextureScale } from "./scene/util";
import { applyHero, buildStory } from "./story";
import { buildWave, initCursor, initMagnetic, paintGrain } from "./ui/effects";
import { initSound } from "./ui/sound";
import { initVoice } from "./ui/voice";
import { initKeyboardMirror, initRail, initRoll, initSpotlight } from "./ui/extras";

gsap.registerPlugin(ScrollTrigger, SplitText);

/** Section lengths in viewport heights: how long each chapter stays pinned while the scene plays. */
const LENGTHS: Record<string, number> = {
  overture: 1.9,
  listen: 2.4,
  answer: 2.6,
  see: 3,
  remember: 2.6,
  keys: 2.6,
  private: 2.1,
  hotkeys: 2.4,
};

const root = document.documentElement;
root.classList.remove("no-js");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width: 820px), (pointer: coarse)").matches;
if (reduced) root.classList.add("reduced");

for (const [id, len] of Object.entries(LENGTHS)) {
  document.getElementById(id)?.style.setProperty("--len", String(len));
}

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo(0, 0);

const state = createState();
paintGrain(document.querySelector(".grain")!);
initRoll();
initSpotlight(".facts > div, .keys li");

const score = initSound();

/** Effects that work the same with or without motion. */
function initShared(stage: Stage | null, redraw: () => void) {
  if (stage) initKeyboardMirror(stage.pressed, redraw);
  initRail((i) => score.chapter(i));
  initVoice(state);
}

async function loadFonts() {
  const faces = [
    '580 40px "Mona Sans Variable"',
    'italic 300 40px "Mona Sans Variable"',
  ];
  await Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

function makeStage(still: boolean) {
  try {
    // Scene canvases (screen, keyboard, overlay) render at 1.5x on desktop for crisp close-ups.
    setTextureScale(mobile ? 1 : 1.5);
    return new Stage(document.querySelector<HTMLCanvasElement>(".stage")!, state, { mobile, still });
  } catch (err) {
    console.warn("WebGL unavailable, continuing without the 3D stage.", err);
    root.classList.add("no-webgl");
    return null;
  }
}

/* ---------------- Hotkey list mirrors the lit chord on the 3D keyboard ---------------- */

const keyRows = Array.from(document.querySelectorAll<HTMLElement>(".keys li"));
let litRow = -2;
function syncHotkeys() {
  const i = Math.round(state.hotkey);
  if (i === litRow) return;
  litRow = i;
  keyRows.forEach((li, j) => li.classList.toggle("is-active", j === i));
}

/* ---------------- Reduced motion: one still frame, simple fades ---------------- */

async function startReduced() {
  await loadFonts();
  applyHero(state);
  Object.assign(state, { reveal: 1, panel: 1, panelMode: 1, modeT: 1, ribbons: 0.6, lid: 1, power: 1 });
  const stage = makeStage(true);
  stage?.render(0, 1);
  initShared(stage, () => stage?.render(0, 1));
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("is-in")),
    { threshold: 0.2 },
  );
  document.querySelectorAll(".overture__text, .chapter__copy, .private__inner, .hotkeys__inner, .finale__inner").forEach((el) => {
    el.classList.add("reveal-fade");
    io.observe(el);
  });
}

/* ---------------- Full experience ---------------- */

async function startFull() {
  document.body.classList.add("is-loading");
  const lenis = new Lenis({ lerp: 0.075, smoothWheel: true, anchors: true });
  lenis.stop();
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  const debug = { lenis, state, stage: null as unknown };
  (window as unknown as { __fluke: unknown }).__fluke = debug;

  // Preloader: counter + waveform drawing itself, honest to actual readiness.
  const wave = document.querySelector<SVGPathElement>(".preloader__wave path")!;
  const waveLen = buildWave(wave);
  const countEl = document.querySelector<HTMLElement>(".preloader__count span")!;
  const progress = { v: 0 };
  const paint = () => {
    countEl.textContent = String(Math.round(progress.v * 100)).padStart(3, "0");
    wave.style.strokeDashoffset = String(waveLen * (1 - progress.v));
  };
  const crawl = gsap.to(progress, { v: 0.82, duration: 1.1, ease: "power2.out", onUpdate: paint });

  await loadFonts();
  const stage = makeStage(false);
  debug.stage = stage;
  applyHero(state);
  if (stage) {
    gsap.ticker.add((time, deltaMs) => {
      if (document.hidden) return;
      // The scroll drags the fluid and breathes through the score. In px/s so 60 Hz and 144 Hz match.
      const pxPerSec = lenis.velocity / Math.max(deltaMs / 1000, 1 / 240);
      stage.stir(pxPerSec);
      score.flow(pxPerSec);
      stage.render(Math.min(deltaMs / 1000, 0.1), time);
      syncHotkeys();
    });
    await stage.warm().catch(() => undefined);
  }
  await crawl;
  await gsap.to(progress, { v: 1, duration: 0.35, ease: "power1.inOut", onUpdate: paint });

  // Intro: preloader wipes up, camera flies in, headline rises.
  const heroSplit = new SplitText(".hero__title", { type: "lines,words", mask: "lines", linesClass: "line" });  const finaleSplit = new SplitText(".finale__title", { type: "lines,words", mask: "lines", linesClass: "line" });
  gsap.set(finaleSplit.words, { yPercent: 115 });
  stage?.liquidType([...heroSplit.words, ...finaleSplit.words]);

  const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
  intro
    .to(".preloader__count", { yPercent: -110, duration: 0.5, ease: "power3.in" })
    .to(".preloader", { clipPath: "inset(0 0 100% 0)", duration: 1.0, ease: "power4.inOut" }, "-=0.15")
    .to(state, { reveal: 1, duration: 2.8, ease: "power3.inOut" }, "<-0.1")
    // The lid swings open during the flight in; the panel wakes as it settles.
    .to(state, { lid: 1, duration: 1.9, ease: "power3.inOut" }, "<0.35")
    .to(state, { power: 1, duration: 1.3, ease: "power2.out" }, "<1.35")
    .from(heroSplit.words, { yPercent: 115, duration: 1.1, stagger: 0.07, ease: "expo.out" }, "<0.05")
    .from(".hero__sub, .hero__cta > *, .hero__meta", { autoAlpha: 0, y: 24, duration: 0.8, stagger: 0.07 }, "-=0.75")
    .from(".nav > *", { autoAlpha: 0, y: -16, duration: 0.7, stagger: 0.06 }, "<");
  await intro;
  document.querySelector(".preloader")?.remove();
  document.body.classList.remove("is-loading");
  lenis.start();

  ScrollTrigger.create({
    trigger: ".finale__title",
    start: "top 85%",
    once: true,
    onEnter: () => gsap.to(finaleSplit.words, { yPercent: 0, duration: 1.2, stagger: 0.08, ease: "expo.out" }),
  });

  let kill = buildStory(state);
  let lastW = window.innerWidth;
  let lastH = window.innerHeight;
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Ignore mobile URL-bar jitter.
      if (w === lastW && Math.abs(h - lastH) / lastH < 0.15) return;
      lastW = w;
      lastH = h;
      kill();
      const { reveal, lid, power } = state;
      Object.assign(state, createState(), { reveal, lid, power });
      applyHero(state);
      ScrollTrigger.refresh();
      kill = buildStory(state);
    }, 250);
  });

  initCursor();
  initMagnetic();
  initShared(stage, () => undefined);
}

if (reduced) void startReduced();
else void startFull();
