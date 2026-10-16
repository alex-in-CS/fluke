import * as THREE from "three";
import type { SceneState } from "./state";
import { CanvasTex, FONT_BODY, FONT_DISPLAY, FONT_MONO, LIME, SKY, clamp01, roundRect, slabGeometry, wrap } from "./util";

export const BAR_W = 2.3;
export const BAR_H = 0.29;
export const PANEL_H = 1.2;
const GAP = 0.07;

const TRANSCRIPT: [string, string][] = [
  ["Them", "Quick one before we wrap. Where did we land on the launch date?"],
  ["You", "Good question, give me one sec."],
];
const QUESTION = "Where did we land on the launch date?";
const ANSWER_LEAD = "October 28.";
const ANSWER_BODY =
  "You agreed on it in the Oct 9 sync, pending the security review. Maya still owes the audit log export.";
const SCREEN_LEAD = "Yes, it still works.";
const SCREEN_BODY = "QA wraps Oct 24 and the security review ends right after, leaving a small buffer before the Oct 28 launch.";
const MEMORY_ROWS: [string, string][] = [
  ["Oct 9", "Launch sync · notes"],
  ["Oct 2", "Security review · notes"],
  ["Sep 25", "Kickoff · notes"],
  ["PDF", "launch-plan.pdf"],
  ["MD", "open-questions.md"],
];

export function glassMaterial(tint = "#d8f0ff") {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    metalness: 0,
    roughness: 0.22,
    transmission: 1,
    thickness: 0.35,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    attenuationColor: new THREE.Color(tint),
    attenuationDistance: 1.6,
    specularIntensity: 1,
    envMapIntensity: 1.2,
  });
}

export function cheapGlassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color("#1a1f27"),
    metalness: 0.2,
    roughness: 0.25,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.2,
  });
}

export class Overlay {
  readonly group = new THREE.Group();
  private readonly barTex = new CanvasTex(1280, 160, 8);
  private readonly panelTex = new CanvasTex(1280, Math.round((1280 * PANEL_H) / BAR_W), 8);
  private readonly barGlass: THREE.Mesh;
  private readonly panelGlass: THREE.Mesh;
  private readonly panelFace: THREE.Mesh;
  private readonly panelGeos = new Map<number, THREE.BufferGeometry>();
  private glass: THREE.Material;
  private readonly glassCheap = cheapGlassMaterial();
  private readonly glassFine = glassMaterial();
  /** Thumbnail source for the "screen attached" answer. */
  thumb: HTMLCanvasElement | null = null;

  constructor() {
    this.glass = this.glassFine;
    this.barGlass = new THREE.Mesh(slabGeometry(BAR_W, BAR_H, BAR_H / 2, 0.02, 0.022), this.glass);
    const barFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BAR_W, BAR_H),
      new THREE.MeshBasicMaterial({ map: this.barTex.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    barFace.position.z = 0.04;
    barFace.renderOrder = 2;

    this.panelGlass = new THREE.Mesh(this.panelGeometry(PANEL_H), this.glass);
    this.panelTex.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.panelFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BAR_W, PANEL_H),
      new THREE.MeshBasicMaterial({ map: this.panelTex.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.panelFace.renderOrder = 2;
    this.panelFace.position.z = 0.04;

    this.group.add(this.barGlass, barFace, this.panelGlass, this.panelFace);
  }

  get glassMaterial() {
    return this.glass;
  }

  setFineGlass(fine: boolean) {
    this.glass = fine ? this.glassFine : this.glassCheap;
    this.barGlass.material = this.glass;
    this.panelGlass.material = this.glass;
  }

  private panelGeometry(h: number) {
    const step = Math.max(2, Math.round(h / 0.02));
    let g = this.panelGeos.get(step);
    if (!g) {
      const hh = step * 0.02;
      g = slabGeometry(BAR_W, hh, Math.min(0.1, hh / 2), 0.02, Math.min(0.02, hh / 2 - 0.001));
      this.panelGeos.set(step, g);
    }
    return g;
  }

  update(s: SceneState, time: number) {
    // Bar redraws at ~24 fps for the level meters.
    const frame = Math.floor(time * 24);
    this.barTex.update(`${frame}|${s.ask.toFixed(2)}|${s.ribbons > 0.05 ? 1 : 0}`, (ctx) => this.paintBar(ctx, s, time));

    const open = clamp01(s.panel);
    const visible = open > 0.015;
    this.panelGlass.visible = visible;
    this.panelFace.visible = visible;
    if (!visible) return;

    const h = Math.max(0.04, PANEL_H * open);
    this.panelGlass.geometry = this.panelGeometry(h);
    const top = -BAR_H / 2 - GAP;
    const geoH = Math.max(2, Math.round(h / 0.02)) * 0.02;
    this.panelGlass.position.y = top - geoH / 2;

    // Show the top part of the canvas: crop the texture instead of squashing the text.
    this.panelFace.scale.y = open;
    this.panelFace.position.y = top - (PANEL_H * open) / 2;
    const t = this.panelTex.texture;
    t.repeat.set(1, open);
    t.offset.set(0, 1 - open);
    (this.panelFace.material as THREE.MeshBasicMaterial).opacity = clamp01(open * 3);

    const mode = Math.round(s.panelMode);
    const caret = Math.floor(time * 2.2) % 2;
    const prog = Math.round(clamp01(s.modeT) * 400);
    this.panelTex.update(`${mode}|${prog}|${caret}`, (ctx) => this.paintPanel(ctx, mode, prog / 400, caret === 1, time));
  }

  private paintBar(ctx: CanvasRenderingContext2D, s: SceneState, time: number) {
    const { w, h } = this.barTex;
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 3, 3, w - 6, h - 6, (h - 6) / 2);
    ctx.fillStyle = "rgba(10,12,16,0.62)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const cy = h / 2;
    const listening = s.ribbons > 0.05 || s.reveal > 0.5;
    // Live dot with a soft pulse.
    const p = (time * 0.8) % 1;
    ctx.fillStyle = `rgba(182,243,107,${(1 - p) * 0.35})`;
    ctx.beginPath();
    ctx.arc(70, cy, 12 + p * 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(70, cy, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.font = `600 38px ${FONT_BODY}`;
    ctx.fillStyle = "#eef0f3";
    ctx.fillText(listening ? "Listening" : "Ready", 104, cy + 1);
    ctx.font = `500 30px ${FONT_MONO}`;
    ctx.fillStyle = "#7d8490";
    ctx.fillText("24:16", 290, cy + 2);

    // Level meters (You / Them), driven by smooth pseudo-random speech envelopes.
    const meter = (x: number, label: string, color: string, seed: number, active: number) => {
      ctx.font = `600 26px ${FONT_BODY}`;
      ctx.fillStyle = color;
      ctx.fillText(label, x, cy + 1);
      const lw = ctx.measureText(label).width;
      for (let i = 0; i < 6; i++) {
        const n =
          0.5 + 0.5 * Math.sin(time * (7 + i * 1.3) + seed * 3 + i * 1.7) * Math.sin(time * 2.1 + seed + i * 0.5);
        const v = 0.18 + active * n * 0.82;
        const bh = 8 + v * 44;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35 + v * 0.65;
        roundRect(ctx, x + lw + 16 + i * 13, cy - bh / 2, 7, bh, 3.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const them = s.speaker > 0.5 && s.speaker < 1.5 ? 1 : 0.25;
    const you = s.speaker > 1.5 ? 1 : 0.2;
    meter(420, "You", LIME, 1, you * (listening ? 1 : 0.2));
    meter(620, "Them", SKY, 2, them * (listening ? 1 : 0.2));

    // Profile chip
    ctx.font = `500 26px ${FONT_BODY}`;
    const chip = "Meeting";
    const cw = ctx.measureText(chip).width + 44;
    roundRect(ctx, 800, cy - 26, cw, 52, 26);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.fillStyle = "#c9cdd4";
    ctx.fillText(chip, 822, cy + 1);

    // Ask button
    const a = clamp01(s.ask);
    const ax = w - 330;
    roundRect(ctx, ax, cy - 34, 304, 68, 34);
    ctx.fillStyle = a > 0.01 ? `rgba(182,243,107,${0.16 + a * 0.84})` : "rgba(182,243,107,0.16)";
    ctx.fill();
    ctx.fillStyle = a > 0.5 ? "#0b0e07" : LIME;
    ctx.font = `650 32px ${FONT_BODY}`;
    ctx.fillText("Ask", ax + 30, cy + 1);
    ctx.font = `500 21px ${FONT_MONO}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText("Ctrl+Shift+↵", ax + 102, cy + 2);
    ctx.globalAlpha = 1;
  }

  private paintPanel(ctx: CanvasRenderingContext2D, mode: number, t: number, caret: boolean, _time: number) {
    const { w, h } = this.panelTex;
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 3, 3, w - 6, h - 6, 52);
    ctx.fillStyle = "rgba(10,12,16,0.93)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const pad = 64;
    ctx.textBaseline = "alphabetic";
    if (mode === 0) this.paintTranscript(ctx, pad, t, caret);
    else if (mode === 1) this.paintAnswer(ctx, pad, w, t, caret);
    else if (mode === 2) this.paintScreen(ctx, pad, w, t, caret);
    else this.paintMemory(ctx, pad, w, t);
    void h;
  }

  private label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, filled = false) {
    ctx.font = `600 24px ${FONT_MONO}`;
    const tw = ctx.measureText(text).width;
    roundRect(ctx, x, y - 34, tw + 40, 48, 24);
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#0b0e07";
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
    }
    ctx.fillText(text, x + 20, y - 2);
    return tw + 40;
  }

  private paintTranscript(ctx: CanvasRenderingContext2D, pad: number, t: number, caret: boolean) {
    this.label(ctx, pad, pad + 40, "LIVE TRANSCRIPT", "#7d8490");
    let y = pad + 130;
    const total = TRANSCRIPT.reduce((n, [, line]) => n + line.length, 0);
    let budget = Math.floor(t * 1.25 * total);
    for (const [who, line] of TRANSCRIPT) {
      if (budget <= 0) break;
      const shown = line.slice(0, budget);
      budget -= line.length;
      ctx.font = `650 30px ${FONT_BODY}`;
      ctx.fillStyle = who === "You" ? LIME : SKY;
      ctx.fillText(who, pad, y);
      ctx.font = `450 40px ${FONT_BODY}`;
      ctx.fillStyle = "#e9ebef";
      const lines = wrap(ctx, shown, 1280 - pad * 2 - 130);
      lines.forEach((l, i) => ctx.fillText(l, pad + 130, y + i * 54));
      if (budget < 0 && caret) {
        const last = lines[lines.length - 1] ?? "";
        ctx.fillStyle = LIME;
        ctx.fillRect(pad + 136 + ctx.measureText(last).width, y + (lines.length - 1) * 54 - 32, 4, 40);
      }
      y += lines.length * 54 + 40;
    }
  }

  private streamed(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    lead: string,
    body: string,
    t: number,
    caret: boolean,
  ) {
    const all = `${lead} ${body}`;
    const n = Math.floor(clamp01(t) * all.length);
    const leadShown = lead.slice(0, Math.min(n, lead.length));
    const bodyShown = n > lead.length + 1 ? body.slice(0, n - lead.length - 1) : "";
    ctx.font = `700 60px ${FONT_DISPLAY}`;
    ctx.fillStyle = "#f3f5f7";
    ctx.fillText(leadShown, x, y);
    let cx = x + ctx.measureText(leadShown).width;
    let cy = y;
    if (bodyShown) {
      ctx.font = `450 36px ${FONT_BODY}`;
      ctx.fillStyle = "#c3c8d0";
      const lines = wrap(ctx, bodyShown, width);
      lines.forEach((l, i) => ctx.fillText(l, x, y + 70 + i * 50));
      cy = y + 70 + (lines.length - 1) * 50;
      cx = x + ctx.measureText(lines[lines.length - 1] ?? "").width;
    }
    if (caret && n < all.length) {
      ctx.fillStyle = LIME;
      ctx.fillRect(cx + 8, cy - 38, 16, 44);
    }
  }

  private paintAnswer(ctx: CanvasRenderingContext2D, pad: number, w: number, t: number, caret: boolean) {
    const lw = this.label(ctx, pad, pad + 40, "QUESTION DETECTED", LIME, t > 0.02);
    ctx.font = `500 26px ${FONT_MONO}`;
    ctx.fillStyle = "#7d8490";
    ctx.fillText("3 notes in context", pad + lw + 22, pad + 38);
    ctx.fillStyle = SKY;
    ctx.fillRect(pad, pad + 86, 4, 52);
    ctx.font = `italic 450 34px ${FONT_BODY}`;
    ctx.fillStyle = "#b9dff2";
    ctx.fillText(`“${QUESTION}”`, pad + 26, pad + 124);
    this.streamed(ctx, pad, pad + 250, w - pad * 2, ANSWER_LEAD, ANSWER_BODY, (t - 0.05) / 0.9, caret);
  }

  private paintScreen(ctx: CanvasRenderingContext2D, pad: number, w: number, t: number, caret: boolean) {
    this.label(ctx, pad, pad + 40, "SCREEN ATTACHED", SKY);
    const tx = pad;
    const ty = pad + 84;
    const tw = 330;
    const th = 206;
    ctx.save();
    roundRect(ctx, tx, ty, tw, th, 18);
    ctx.clip();
    if (this.thumb) ctx.drawImage(this.thumb, tx, ty, tw, th);
    else {
      ctx.fillStyle = "#f4f2ec";
      ctx.fillRect(tx, ty, tw, th);
    }
    ctx.restore();
    roundRect(ctx, tx, ty, tw, th, 18);
    ctx.strokeStyle = "rgba(125,211,252,0.6)";
    ctx.lineWidth = 3;
    ctx.stroke();
    this.streamed(ctx, tx + tw + 44, ty + 56, w - tw - pad * 2 - 44, SCREEN_LEAD, SCREEN_BODY, (t - 0.1) / 0.85, caret);
  }

  private paintMemory(ctx: CanvasRenderingContext2D, pad: number, w: number, t: number) {
    this.label(ctx, pad, pad + 40, "CONTEXT FOR THIS MEETING", LIME);
    const rowH = 82;
    MEMORY_ROWS.forEach(([tag, text], i) => {
      const on = clamp01(t * (MEMORY_ROWS.length + 1) - i);
      const y = pad + 96 + i * rowH;
      ctx.globalAlpha = 0.25 + on * 0.75;
      roundRect(ctx, pad, y, w - pad * 2, rowH - 16, 22);
      ctx.fillStyle = on > 0.99 ? "rgba(182,243,107,0.07)" : "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.font = `600 24px ${FONT_MONO}`;
      ctx.fillStyle = i < 3 ? LIME : SKY;
      ctx.fillText(tag, pad + 24, y + 42);
      ctx.font = `500 32px ${FONT_BODY}`;
      ctx.fillStyle = "#e3e6ea";
      ctx.fillText(text, pad + 150, y + 44);
      if (on > 0.99) {
        ctx.fillStyle = LIME;
        ctx.beginPath();
        ctx.arc(w - pad - 34, y + 33, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }
}
