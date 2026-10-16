import * as THREE from "three";

/** Canvas fonts only take width keywords, so map the computed percentage to the nearest one. */
const STRETCH: [number, string][] = [
  [50, "ultra-condensed"],
  [62.5, "extra-condensed"],
  [75, "condensed"],
  [87.5, "semi-condensed"],
  [100, "normal"],
  [112.5, "semi-expanded"],
  [125, "expanded"],
  [150, "extra-expanded"],
  [200, "ultra-expanded"],
];

function stretchKeyword(value: string) {
  const pct = parseFloat(value);
  if (Number.isNaN(pct)) return STRETCH.find(([, k]) => k === value)?.[1] ?? "normal";
  return STRETCH.reduce((best, s) => (Math.abs(s[0] - pct) < Math.abs(best[0] - pct) ? s : best))[1];
}

interface Word {
  el: HTMLElement;
  mask: HTMLElement | null;
  text: string;
  font: string;
  color: string;
  spacing: string;
}

/**
 * Paints selected headline words into a screen-sized canvas, exactly where the DOM lays them out
 * (transforms included), so the stage can refract them through the fluid. The DOM text stays in
 * place for selection, search and screen readers; CSS only makes its fill transparent.
 */
export class TextLayer {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private words: Word[] = [];
  private sig = "";
  private pr = 1;

  constructor() {
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    // Composited after the output pass, so these are final display values.
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
  }

  /** Words to paint. Styles are read now, before the liquid-type class hides their fill. */
  track(words: Element[]) {
    for (const el of words as HTMLElement[]) {
      const cs = getComputedStyle(el);
      this.words.push({
        el,
        mask: el.closest<HTMLElement>(".line-mask"),
        text: el.textContent ?? "",
        font: `${cs.fontStyle} ${cs.fontWeight} ${stretchKeyword(cs.fontStretch)} ${cs.fontSize} ${cs.fontFamily}`,
        color: cs.color,
        spacing: cs.letterSpacing,
      });
    }
    this.sig = "";
  }

  /** Re-reads fonts after a resize (fluid type sizes change with the viewport). */
  restyle() {
    const els = this.words.map((w) => w.el);
    this.words = [];
    this.track(els);
  }

  resize(w: number, h: number) {
    this.pr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(w * this.pr);
    this.canvas.height = Math.round(h * this.pr);
    this.sig = "";
  }

  private opacity(el: HTMLElement) {
    let o = 1;
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden") return 0;
      o *= parseFloat(cs.opacity);
      if (o < 0.002) return 0;
    }
    return o;
  }

  /** Repaints only when a word moved, faded or resized. */
  update() {
    const vh = window.innerHeight;
    const frame = this.words.map((w) => {
      const r = w.el.getBoundingClientRect();
      const on = r.bottom > -vh * 0.2 && r.top < vh * 1.2;
      return { w, r, o: on ? this.opacity(w.el) : 0, m: w.mask?.getBoundingClientRect() ?? null };
    });
    const sig = frame.map(({ r, o }) => `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(0)},${o.toFixed(3)}`).join("|");
    if (sig === this.sig) return;
    this.sig = sig;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    ctx.textBaseline = "alphabetic";
    for (const { w, r, o, m } of frame) {
      if (o <= 0) continue;
      ctx.save();
      ctx.font = w.font;
      ctx.letterSpacing = w.spacing === "normal" ? "0px" : w.spacing;
      ctx.fillStyle = w.color;
      ctx.globalAlpha = o;
      const met = ctx.measureText(w.text);
      const asc = met.fontBoundingBoxAscent;
      const desc = met.fontBoundingBoxDescent;
      if (m) {
        // Same clip as the line mask, with room for italic overhang and descenders.
        const fs = asc + desc;
        ctx.beginPath();
        ctx.rect(m.left - fs, m.top - fs * 0.04, m.width + fs * 2, m.height + fs * 0.06);
        ctx.clip();
      }
      // CSS half-leading: the glyph box sits centred in the line box.
      const baseline = r.top + (r.height - (asc + desc)) / 2 + asc;
      ctx.fillText(w.text, r.left, baseline);
      ctx.restore();
    }
    this.texture.needsUpdate = true;
  }
}

/** Final pass: the painted headlines, refracted and faintly dispersed by the fluid. */
export const TextShader = {
  name: "TextShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uText: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uRefract: { value: 0.00024 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uText;
    uniform sampler2D uVelocity;
    uniform float uRefract;
    varying vec2 vUv;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 off = texture2D(uVelocity, vUv).xy * uRefract;
      float m = length(off);
      if (m > 0.04) off *= 0.04 / m;
      // Premultiplied text, split slightly per channel along the flow.
      vec4 r = texture2D(uText, vUv - off * 1.05);
      vec4 g = texture2D(uText, vUv - off);
      vec4 b = texture2D(uText, vUv - off * 0.95);
      vec3 col = vec3(
        base.r * (1.0 - r.a) + r.r,
        base.g * (1.0 - g.a) + g.g,
        base.b * (1.0 - b.a) + b.b
      );
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
