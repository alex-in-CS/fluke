import * as THREE from "three";

export const LIME = "#b6f36b";
export const SKY = "#7dd3fc";
export const INK = "#07080a";

export const FONT_DISPLAY = '"Inter Tight Variable", "Inter Variable", system-ui, sans-serif';
export const FONT_BODY = '"Inter Variable", system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A 2D canvas wrapped in a texture that is uploaded only when the drawing changes. */
export class CanvasTex {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private key = "";

  constructor(width: number, height: number, anisotropy = 4) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
  }

  get w() {
    return this.canvas.width;
  }

  get h() {
    return this.canvas.height;
  }

  /** Redraws only when `key` differs from the last drawn key. */
  update(key: string, draw: (ctx: CanvasRenderingContext2D) => void) {
    if (key === this.key) return;
    this.key = key;
    draw(this.ctx);
    this.texture.needsUpdate = true;
  }
}

/** Rounded rectangle shape centred on the origin. */
export function roundedShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** Thin bevelled slab with rounded corners, centred on the origin (front face at +z). */
export function slabGeometry(w: number, h: number, r: number, depth = 0.02, bevel = 0.014) {
  const g = new THREE.ExtrudeGeometry(roundedShape(w - bevel * 2, h - bevel * 2, Math.max(0.001, r - bevel)), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Wraps text into lines that fit `maxWidth` with the context's current font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** Maps v from [a, b] to [0, 1], clamped. */
export const range = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
