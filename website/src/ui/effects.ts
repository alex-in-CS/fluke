import gsap from "gsap";

/** Static noise tile for the film-grain layer. */
export function paintGrain(el: HTMLElement) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  el.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
}

/** Lime dot + trailing ring. Only on precise pointers. */
export function initCursor() {
  if (!matchMedia("(pointer: fine)").matches) return;
  const root = document.querySelector<HTMLElement>(".cursor");
  if (!root) return;
  document.documentElement.classList.add("has-cursor");
  const dot = root.querySelector<HTMLElement>(".cursor__dot")!;
  const ring = root.querySelector<HTMLElement>(".cursor__ring")!;
  const dx = gsap.quickTo(dot, "x", { duration: 0.08, ease: "power3" });
  const dy = gsap.quickTo(dot, "y", { duration: 0.08, ease: "power3" });
  const rx = gsap.quickTo(ring, "x", { duration: 0.45, ease: "power3" });
  const ry = gsap.quickTo(ring, "y", { duration: 0.45, ease: "power3" });
  gsap.set([dot, ring], { x: -100, y: -100 });
  window.addEventListener("pointermove", (e) => {
    dx(e.clientX);
    dy(e.clientY);
    rx(e.clientX);
    ry(e.clientY);
  });
  document.addEventListener("pointerover", (e) => {
    const hit = (e.target as Element).closest("a, button");
    root.classList.toggle("is-hover", !!hit);
  });
  document.addEventListener("pointerleave", () => gsap.set([dot, ring], { x: -100, y: -100 }));
}

/** Buttons lean toward the pointer and spring back. */
export function initMagnetic() {
  if (!matchMedia("(pointer: fine)").matches) return;
  document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
    const x = gsap.quickTo(el, "x", { duration: 0.6, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.6, ease: "power3" });
    const label = el.querySelector("span");
    const lx = label ? gsap.quickTo(label, "x", { duration: 0.6, ease: "power3" }) : null;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      x(mx * 0.32);
      y(my * 0.42);
      lx?.(mx * 0.1);
    });
    el.addEventListener("pointerleave", () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.45)" });
      if (label) gsap.to(label, { x: 0, duration: 0.9, ease: "elastic.out(1, 0.45)" });
    });
  });
}

/** Builds a waveform path for the preloader and returns its length. */
export function buildWave(path: SVGPathElement) {
  const n = 120;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 600;
    const t = i / n;
    const env = Math.sin(Math.PI * t) ** 1.6;
    const y = 40 + Math.sin(t * 46) * Math.sin(t * 7.3 + 1) * 30 * env;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  path.setAttribute("d", d);
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len}`;
  path.style.strokeDashoffset = `${len}`;
  return len;
}
