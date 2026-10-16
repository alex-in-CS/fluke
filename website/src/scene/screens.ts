import { CanvasTex, FONT_BODY, FONT_DISPLAY, FONT_MONO, LIME, roundRect } from "./util";

/** The video call shown on the laptop screen. Abstract avatars only, no faces. */
export class CallScreen {
  readonly tex = new CanvasTex(1280, 800, 8);

  draw(time: number, speaker: number, share: number) {
    // Speaking rings animate, so redraw at ~20 fps while someone talks.
    const tick = speaker > 0.5 ? Math.floor(time * 20) : 0;
    const shareStep = Math.round(share * 24);
    this.tex.update(`${tick}|${Math.round(speaker)}|${shareStep}`, (ctx) =>
      this.paint(ctx, time, Math.round(speaker), shareStep / 24),
    );
  }

  private paint(ctx: CanvasRenderingContext2D, time: number, speaker: number, share: number) {
    const { w, h } = this.tex;
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, w, h);

    // Title bar
    ctx.fillStyle = "#14171c";
    ctx.fillRect(0, 0, w, 54);
    ctx.font = `600 20px ${FONT_BODY}`;
    ctx.fillStyle = "#d9dde3";
    ctx.textBaseline = "middle";
    ctx.fillText("Weekly sync · Launch", 28, 27);
    ctx.font = `500 17px ${FONT_MONO}`;
    ctx.fillStyle = "#7c838f";
    ctx.textAlign = "right";
    ctx.fillText("24:16", w - 28, 27);
    ctx.textAlign = "left";

    const stageY = 74;
    const stageH = h - 74 - 96;

    if (share < 1) {
      ctx.globalAlpha = 1 - share;
      const gap = 18;
      const tw = (w - 56 - gap) / 2;
      this.tile(ctx, 28, stageY, tw, stageH, "Them", "MR", ["#1e3a5f", "#7dd3fc"], speaker === 1, time);
      this.tile(ctx, 28 + tw + gap, stageY, tw, stageH, "You", "AK", ["#2b3a16", "#b6f36b"], speaker === 2, time);
      ctx.globalAlpha = 1;
    }
    if (share > 0) {
      ctx.globalAlpha = share;
      const sideW = 220;
      this.slide(ctx, 28, stageY, w - 56 - sideW - 18, stageH);
      const x = w - 28 - sideW;
      const th = (stageH - 18) / 2;
      this.tile(ctx, x, stageY, sideW, th, "Them", "MR", ["#1e3a5f", "#7dd3fc"], speaker === 1, time, 0.55);
      this.tile(ctx, x, stageY + th + 18, sideW, th, "You", "AK", ["#2b3a16", "#b6f36b"], speaker === 2, time, 0.55);
      ctx.globalAlpha = 1;
    }

    // Control bar
    const cy = h - 48;
    const icons = 5;
    const start = w / 2 - (icons * 64 + 110) / 2;
    for (let i = 0; i < icons; i++) {
      ctx.fillStyle = "#1c2027";
      ctx.beginPath();
      ctx.arc(start + i * 64 + 26, cy, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#59606b";
      ctx.beginPath();
      ctx.arc(start + i * 64 + 26, cy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#c4473a";
    roundRect(ctx, start + icons * 64 + 8, cy - 24, 100, 48, 24);
    ctx.fill();
  }

  private tile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    initials: string,
    colors: [string, string],
    talking: boolean,
    time: number,
    scale = 1,
  ) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 18 * scale);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#15181e");
    g.addColorStop(1, "#0f1115");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    const cx = x + w / 2;
    const cy = y + h / 2 - 10 * scale;
    const r = Math.min(w, h) * 0.2;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.8);
    glow.addColorStop(0, colors[0]);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);

    if (talking) {
      const base = ctx.globalAlpha;
      ctx.strokeStyle = colors[1];
      ctx.lineWidth = 3 * scale;
      for (let i = 0; i < 3; i++) {
        const p = (time * 0.9 + i / 3) % 1;
        ctx.globalAlpha = (1 - p) * 0.55 * base;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.08 + p * 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = base;
    }
    const av = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    av.addColorStop(0, colors[1]);
    av.addColorStop(1, colors[0]);
    ctx.fillStyle = av;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0d10";
    ctx.font = `650 ${Math.round(r * 0.72)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, cx, cy + r * 0.04);

    ctx.textAlign = "left";
    ctx.font = `600 ${Math.round(19 * scale + 2)}px ${FONT_BODY}`;
    const lw = ctx.measureText(label).width + 24 * scale;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, x + 14 * scale, y + h - 46 * scale, lw + 14, 32 * scale, 8 * scale);
    ctx.fill();
    ctx.fillStyle = talking ? colors[1] : "#e5e7eb";
    ctx.fillText(label, x + 26 * scale, y + h - 29 * scale);
    ctx.restore();
  }

  /** A shared "launch plan" slide with a simple timeline. */
  private slide(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    ctx.clip();
    ctx.fillStyle = "#e4e1d8";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#16181d";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = `700 40px ${FONT_DISPLAY}`;
    ctx.fillText("Launch plan", x + 44, y + 76);
    ctx.font = `500 18px ${FONT_BODY}`;
    ctx.fillStyle = "#6a6f78";
    ctx.fillText("October", x + 46, y + 108);

    const rows: [string, number, number, string][] = [
      ["Build", 0.0, 0.42, "#2a2f38"],
      ["QA", 0.38, 0.66, "#2a2f38"],
      ["Security review", 0.5, 0.74, "#2a2f38"],
      ["Launch", 0.86, 0.9, "#5b8f1e"],
    ];
    const gx = x + 250;
    const gw = w - 250 - 50;
    const top = y + 160;
    const rowH = (h - 230) / rows.length;
    ctx.strokeStyle = "#d9d6cc";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const lx = gx + (gw * i) / 6;
      ctx.beginPath();
      ctx.moveTo(lx, top - 20);
      ctx.lineTo(lx, top + rowH * rows.length);
      ctx.stroke();
    }
    ctx.font = `500 15px ${FONT_MONO}`;
    ctx.fillStyle = "#8b8f97";
    ["Oct 1", "Oct 7", "Oct 13", "Oct 19", "Oct 24", "Oct 28", "Nov 3"].forEach((d, i) => {
      ctx.fillText(d, gx + (gw * i) / 6 - 20, top - 30);
    });
    rows.forEach(([name, a, b, c], i) => {
      const ry = top + rowH * i + rowH * 0.22;
      ctx.font = `600 21px ${FONT_BODY}`;
      ctx.fillStyle = "#24272e";
      ctx.fillText(name, x + 46, ry + rowH * 0.34);
      ctx.fillStyle = c;
      roundRect(ctx, gx + gw * a, ry, Math.max(18, gw * (b - a)), rowH * 0.5, 8);
      ctx.fill();
    });
    ctx.restore();
  }
}

/** Keyboard surface. Hotkey chords light up in lime. */
export class KeyboardTex {
  readonly tex = new CanvasTex(1536, 640, 8);
  readonly emissive = new CanvasTex(1536, 640, 8);

  static readonly CHORDS: string[][] = [
    ["ctrl", "shift", "enter"],
    ["ctrl", "shift", "l"],
    ["ctrl", "shift", "k"],
    ["ctrl", "shift", "space"],
    ["ctrl", "shift", "x"],
  ];

  private layout() {
    const rows: [string, number][][] = [
      [["esc", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["bksp", 1.6]],
      [["tab", 1.4], ["q", 1], ["w", 1], ["e", 1], ["r", 1], ["t", 1], ["y", 1], ["u", 1], ["i", 1], ["o", 1], ["p", 1], ["[", 1], ["]", 1], ["\\", 1.2]],
      [["caps", 1.7], ["a", 1], ["s", 1], ["d", 1], ["f", 1], ["g", 1], ["h", 1], ["j", 1], ["k", 1], ["l", 1], [";", 1], ["'", 1], ["enter", 1.9]],
      [["shift", 2.2], ["z", 1], ["x", 1], ["c", 1], ["v", 1], ["b", 1], ["n", 1], ["m", 1], [",", 1], [".", 1], ["/", 1], ["shift", 2.4]],
      [["ctrl", 1.3], ["fn", 1], ["alt", 1.2], ["space", 6.3], ["alt", 1.2], ["ctrl", 1.3], ["◀", 1], ["▼", 1], ["▶", 1]],
    ];
    return rows;
  }

  draw(hotkey: number) {
    const idx = Math.round(hotkey);
    const lit = new Set(idx >= 0 && idx < KeyboardTex.CHORDS.length ? KeyboardTex.CHORDS[idx] : []);
    const key = `${idx}`;
    this.tex.update(key, (ctx) => this.paint(ctx, lit, false));
    this.emissive.update(key, (ctx) => this.paint(ctx, lit, true));
  }

  private paint(ctx: CanvasRenderingContext2D, lit: Set<string>, emissive: boolean) {
    const { w, h } = this.tex;
    ctx.fillStyle = emissive ? "#000" : "#121418";
    ctx.fillRect(0, 0, w, h);
    const rows = this.layout();
    const pad = 22;
    const gap = 10;
    const unit = (w - pad * 2 - gap * 13) / 15;
    const kh = (h - pad * 2 - gap * 4) / 5;
    rows.forEach((row, ri) => {
      const total = row.reduce((s, [, u]) => s + u, 0);
      const scale = (w - pad * 2 - gap * (row.length - 1)) / (total * unit);
      let x = pad;
      const y = pad + ri * (kh + gap);
      for (const [label, u] of row) {
        const kw = u * unit * scale;
        const on = lit.has(label);
        if (emissive) {
          if (on) {
            ctx.strokeStyle = LIME;
            ctx.lineWidth = 5;
            roundRect(ctx, x + 2, y + 2, kw - 4, kh - 4, 11);
            ctx.stroke();
            ctx.fillStyle = LIME;
            ctx.font = `600 ${label.length > 1 ? 22 : 28}px ${FONT_BODY}`;
            ctx.textBaseline = "top";
            ctx.fillText(label, x + 14, y + 12);
          }
        } else {
          ctx.fillStyle = on ? "#1d2513" : "#1b1e23";
          roundRect(ctx, x, y, kw, kh, 12);
          ctx.fill();
          ctx.strokeStyle = on ? LIME : "rgba(255,255,255,0.05)";
          ctx.lineWidth = on ? 3 : 1.5;
          ctx.stroke();
          ctx.fillStyle = on ? LIME : "#5d636e";
          ctx.font = `500 ${label.length > 1 ? 20 : 26}px ${FONT_BODY}`;
          ctx.textBaseline = "top";
          ctx.fillText(label, x + 14, y + 12);
        }
        x += kw + gap;
      }
    });
  }
}
