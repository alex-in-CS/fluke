/* Fluke, concept "Editorial". GSAP + ScrollTrigger + SplitText + Lenis from CDN (globals). */
gsap.registerPlugin(ScrollTrigger, SplitText);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = getComputedStyle(document.documentElement);
const INK = css.getPropertyValue("--ink").trim();
const SIGNAL = css.getPropertyValue("--signal").trim();

/* ---------------- Paper grain (static, generated once) ---------------- */
{
  const c = document.createElement("canvas");
  c.width = c.height = 220;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(220, 220);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.querySelector(".paper-grain").style.backgroundImage = `url(${c.toDataURL()})`;
}

/* ---------------- The living line: two voices on strings ----------------
 * Each voice is a damped string (1D wave equation). The conversation drives them in turn with
 * syllable-like bursts; the pointer plucks whichever string it crosses; a click drops a pulse. */
class Strand {
  constructor(n, color, width, baseline) {
    this.n = n;
    this.y = new Float32Array(n);
    this.v = new Float32Array(n);
    this.color = color;
    this.width = width;
    this.baseline = baseline; // fraction of canvas height
  }
  step(h) {
    const { y, v, n } = this;
    const T = 4200; // tension: wave speed
    const K = 16; // pull back to rest
    const D = 3.2; // damping
    for (let i = 1; i < n - 1; i++) v[i] += (T * (y[i - 1] + y[i + 1] - 2 * y[i]) - K * y[i] - D * v[i]) * h;
    for (let i = 1; i < n - 1; i++) y[i] += v[i] * h;
  }
  push(idx, force, spread = 3) {
    const lo = Math.max(1, Math.floor(idx - spread * 3));
    const hi = Math.min(this.n - 2, Math.ceil(idx + spread * 3));
    for (let i = lo; i <= hi; i++) this.v[i] += force * Math.exp(-((i - idx) ** 2) / (2 * spread * spread));
  }
}

function initWave() {
  const wrap = document.querySelector(".wave");
  const canvas = document.querySelector(".wave__canvas");
  const ctx = canvas.getContext("2d");
  const N = 220;
  const them = new Strand(N, INK, 1.25, 0.34);
  const you = new Strand(N, SIGNAL, 1.6, 0.7);
  const strands = [them, you];
  let w = 0;
  let h = 0;
  let x0 = 0;
  let x1 = 0;
  const state = { reveal: reduced ? 1 : 0 };

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = wrap.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = parseFloat(css.getPropertyValue("--gutter")) || 48;
    const gutter = Math.min(72, Math.max(20, w * 0.04, g));
    x0 = gutter + 52;
    x1 = w - gutter;
  };
  resize();
  addEventListener("resize", resize);

  const idxAt = (x) => ((x - x0) / (x1 - x0)) * (N - 1);

  // Pointer: crossing a string plucks it, in proportion to vertical speed.
  let last = null;
  wrap.parentElement.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (last && x > x0 && x < x1) {
      const dy = y - last.y;
      for (const s of strands) {
        const by = s.baseline * h;
        const near = 1 - Math.abs(y - by) / 46;
        if (near > 0) s.push(idxAt(x), Math.max(-60, Math.min(60, dy)) * 14 * near, 2.4);
      }
    }
    last = { x, y };
  });
  wrap.parentElement.addEventListener("pointerleave", () => (last = null));
  wrap.parentElement.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button")) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const s = Math.abs(y - them.baseline * h) < Math.abs(y - you.baseline * h) ? them : you;
    if (x > x0 && x < x1) s.push(idxAt(x), 1400, 3);
  });

  // The conversation: Them and You take turns; bursts shaped like syllables.
  const talk = (t) => {
    const turn = Math.floor(t / 4.2) % 2;
    const local = t % 4.2;
    const gate = Math.min(1, local / 0.3) * Math.min(1, (3.6 - local) / 0.3);
    if (gate <= 0) return;
    const s = turn === 0 ? them : you;
    const src = (turn === 0 ? 0.3 : 0.62) * (N - 1) + Math.sin(t * 0.7) * 12;
    const syll = Math.max(0, Math.sin(t * 8.1)) * (0.55 + 0.45 * Math.sin(t * 2.3 + 1.1));
    s.push(src, Math.sin(t * 52) * 210 * syll * gate, 2.2);
  };

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, x0 + (x1 - x0) * state.reveal + 2, h);
    ctx.clip();
    for (const s of strands) {
      const by = s.baseline * h;
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, s.color);
      grad.addColorStop(0.85, s.color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.width;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      const dx = (x1 - x0) / (N - 1);
      ctx.moveTo(x0, by + s.y[0]);
      for (let i = 1; i < N - 1; i++) {
        const xm = x0 + (i + 0.5) * dx;
        const ym = by + (s.y[i] + s.y[i + 1]) / 2;
        ctx.quadraticCurveTo(x0 + i * dx, by + s.y[i], xm, ym);
      }
      ctx.lineTo(x1, by + s.y[N - 1]);
      ctx.stroke();
    }
    ctx.restore();
  };

  if (reduced) {
    for (let t = 0; t < 2; t += 1 / 240) {
      talk(t);
      strands.forEach((s) => s.step(1 / 240));
    }
    draw();
    return state;
  }

  let acc = 0;
  gsap.ticker.add((time, dtMs) => {
    acc += Math.min(dtMs / 1000, 0.05);
    const H = 1 / 240;
    while (acc >= H) {
      talk(time);
      strands.forEach((s) => s.step(H));
      acc -= H;
    }
    draw();
  });
  return state;
}

/* ---------------- Masked line reveals ---------------- */
function lines(el) {
  return new SplitText(el, { type: "lines", mask: "lines", linesClass: "split-line" }).lines;
}

async function start() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  const wave = initWave();

  if (reduced) return;

  const lenis = new Lenis({ lerp: 0.08, smoothWheel: true, anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // Intro: title lines rise, the line draws itself across the page, the rest settles in.
  const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
  intro
    .from(lines(".hero__title"), { yPercent: 110, duration: 1.4, stagger: 0.12 }, 0.1)
    .from(".nav > *", { autoAlpha: 0, y: -12, duration: 1, stagger: 0.06 }, 0.2)
    .from(".hero__meta", { autoAlpha: 0, y: 12, duration: 1 }, 0.3)
    .to(wave, { reveal: 1, duration: 2.2, ease: "power3.inOut" }, 0.5)
    .from(".wave__label", { autoAlpha: 0, duration: 0.8, stagger: 0.15 }, 0.7)
    .from(".hero__foot > *", { autoAlpha: 0, y: 18, duration: 1.1, stagger: 0.1 }, 0.9);

  // The meeting: scroll plays the conversation line by line; Fluke writes in the margin.
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  tl.from(lines(".meeting__head h2"), { yPercent: 110, duration: 0.6, stagger: 0.08, ease: "expo.out" }, 0);
  let at = 0.4;
  document.querySelectorAll(".transcript > li").forEach((li) => {
    if (li.classList.contains("note")) {
      const words = new SplitText(li.querySelector(".note__draft"), { type: "words" }).words;
      tl.fromTo(li, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, at);
      tl.from(li, { borderLeftColor: "rgba(223,62,27,0)", duration: 0.3 }, at);
      tl.from(li.querySelector(".note__tag"), { autoAlpha: 0, x: -8, duration: 0.3 }, at);
      tl.from(words, { autoAlpha: 0, duration: 0.08, stagger: 0.045, ease: "none" }, at + 0.15);
      at += 0.15 + words.length * 0.045 + 0.35;
    } else {
      tl.fromTo(li, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.5 }, at);
      const mark = li.querySelector("mark");
      if (mark) tl.fromTo(mark, { "--hear": "0%" }, { "--hear": "100%", duration: 0.5, ease: "power1.inOut" }, at + 0.45);
      at += mark ? 1.05 : 0.8;
    }
  });
  tl.from(".meeting__aside", { autoAlpha: 0, y: 16, duration: 0.5 }, at);
  tl.to({}, { duration: 0.6 }); // hold on the finished page
  ScrollTrigger.create({ trigger: ".meeting", start: "top top", end: "bottom bottom", scrub: 0.8, animation: tl });

  // Principles, providers, close: reveal once as they arrive.
  gsap.utils.toArray(".principle").forEach((p) => {
    gsap.timeline({ scrollTrigger: { trigger: p, start: "top 78%", once: true } })
      .from(lines(p.querySelector("h3")), { yPercent: 110, duration: 1.3, ease: "expo.out" })
      .from(p.querySelector("p"), { autoAlpha: 0, y: 16, duration: 1, ease: "expo.out" }, 0.25);
  });
  gsap.from(".works__list > *", {
    autoAlpha: 0,
    y: 18,
    duration: 0.9,
    stagger: 0.05,
    ease: "expo.out",
    scrollTrigger: { trigger: ".works", start: "top 70%", once: true },
  });
  gsap.timeline({ scrollTrigger: { trigger: ".close", start: "top 75%", once: true } })
    .from(lines(".close__title"), { yPercent: 110, duration: 1.3, stagger: 0.1, ease: "expo.out" })
    .from(".close__cta > *", { autoAlpha: 0, y: 16, duration: 1, stagger: 0.08, ease: "expo.out" }, 0.4);

  window.__concept = { lenis };
}

start();
