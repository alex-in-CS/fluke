import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CanvasTex, FONT_BODY, FONT_DISPLAY, FONT_MONO, LIME, SKY, clamp01, range, roundRect, slabGeometry, smooth } from "./util";

/* ------------------------------------------------------------------ */
/* Soft round point sprites                                            */
/* ------------------------------------------------------------------ */

function pointsMaterial(color: string, size: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uOpacity: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aScale;
      uniform float uSize;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aScale * uPixelRatio * (1.0 / -mv.z);
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(uColor * 1.6, a * vAlpha * uOpacity);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Audio ribbons: mic (You, lime) and speakers (Them, sky)             */
/* ------------------------------------------------------------------ */

class Ribbon {
  readonly points: THREE.Points;
  private readonly lut: THREE.Vector3[] = [];
  private readonly normals: THREE.Vector3[] = [];
  private readonly t: Float32Array;
  private readonly phase: Float32Array;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  readonly material: THREE.ShaderMaterial;

  constructor(curve: THREE.Curve<THREE.Vector3>, color: string, count: number, private readonly speed: number) {
    const N = 200;
    for (let i = 0; i <= N; i++) this.lut.push(curve.getPointAt(i / N));
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= N; i++) {
      const tan = curve.getTangentAt(i / N);
      const n = new THREE.Vector3().crossVectors(tan, up);
      if (n.lengthSq() < 1e-4) n.set(1, 0, 0);
      this.normals.push(n.normalize());
    }
    this.t = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const scale = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.t[i] = Math.random();
      this.phase[i] = Math.random() * Math.PI * 2;
      scale[i] = 0.4 + Math.random() * 1.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    this.material = pointsMaterial(color, 30);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, time: number, intensity: number, loud: number) {
    const N = this.lut.length - 1;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.t.length; i++) {
      let t = this.t[i] + dt * this.speed * (0.7 + 0.6 * ((i * 7919) % 13) / 13);
      if (t > 1) t -= 1;
      this.t[i] = t;
      const f = t * N;
      const k = Math.min(N - 1, Math.floor(f));
      p.lerpVectors(this.lut[k], this.lut[k + 1], f - k);
      // Speech-like wobble that fades out as the stream reaches the overlay.
      const env = Math.sin(t * Math.PI);
      const amp = (0.04 + 0.16 * loud) * env;
      const w = Math.sin(t * 28 - time * 6 + this.phase[i]) * amp;
      const n = this.normals[k];
      p.x += n.x * w;
      p.y += Math.cos(this.phase[i] + time * 2 + t * 9) * amp * 0.7;
      p.z += n.z * w;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.alpha[i] = intensity * env * (0.35 + 0.65 * loud);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    this.points.visible = intensity > 0.01;
  }
}

export class Ribbons {
  readonly group = new THREE.Group();
  private readonly mic: Ribbon;
  private readonly speakers: Ribbon[];

  constructor(sink: THREE.Vector3, count: number) {
    const micCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, 0.55, 3.4),
      new THREE.Vector3(-0.9, 0.9, 2.2),
      new THREE.Vector3(-1.5, 1.7, 1.0),
      new THREE.Vector3(-0.8, sink.y + 0.1, sink.z + 0.35),
      new THREE.Vector3(-0.35, sink.y, sink.z),
    ]);
    const spk = (sx: number) =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 1.55, 0.12, -0.28),
        new THREE.Vector3(sx * 2.3, 0.6, 0.1),
        new THREE.Vector3(sx * 2.2, 1.7, 0.2),
        new THREE.Vector3(sx * 1.2, sink.y + 0.12, sink.z + 0.3),
        new THREE.Vector3(sx * 0.4, sink.y, sink.z),
      ]);
    this.mic = new Ribbon(micCurve, LIME, count, 0.16);
    this.speakers = [new Ribbon(spk(-1), SKY, Math.round(count * 0.6), 0.18), new Ribbon(spk(1), SKY, Math.round(count * 0.6), 0.18)];
    this.group.add(this.mic.points, ...this.speakers.map((r) => r.points));
  }

  setPixelRatio(pr: number) {
    for (const r of [this.mic, ...this.speakers]) r.material.uniforms.uPixelRatio.value = pr;
  }

  /** `voice` is the visitor's live mic level: it drives the You stream on top of the story. */
  update(dt: number, time: number, intensity: number, speaker: number, voice = 0) {
    const them = speaker > 0.5 && speaker < 1.5 ? 1 : 0.3;
    const you = Math.max(speaker > 1.5 ? 1 : 0.3, voice);
    this.mic.update(dt, time, Math.max(intensity, voice * 0.95), you);
    for (const r of this.speakers) r.update(dt, time, intensity, them);
  }
}

/* ------------------------------------------------------------------ */
/* Ambient dust                                                         */
/* ------------------------------------------------------------------ */

export class Dust {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly pos: Float32Array;
  private readonly off: Float32Array;
  readonly material = pointsMaterial("#cfd6e0", 26);

  constructor(count: number) {
    this.base = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 3);
    this.off = new Float32Array(count * 3);
    const alpha = new Float32Array(count);
    const scale = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      this.base[i * 3] = Math.cos(a) * r;
      this.base[i * 3 + 1] = -1 + Math.random() * 9;
      this.base[i * 3 + 2] = Math.sin(a) * r - 2;
      alpha[i] = 0.08 + Math.random() * 0.3;
      scale[i] = 0.4 + Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * Drifts the dust and parts it around the pointer (`field.w` is the push strength).
   */
  update(time: number, dt: number, field: THREE.Vector4) {
    const R = 2.6;
    const ease = 1 - Math.exp(-dt * 6);
    for (let i = 0; i < this.pos.length; i += 3) {
      const s = i * 0.37;
      const x = this.base[i] + Math.sin(time * 0.07 + s) * 0.6;
      const y = this.base[i + 1] + Math.sin(time * 0.11 + s * 1.3) * 0.5;
      const z = this.base[i + 2] + Math.cos(time * 0.06 + s) * 0.6;
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (field.w > 0.001) {
        const dx = x - field.x;
        const dy = y - field.y;
        const dz = z - field.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < R && d > 1e-3) {
          const f = (1 - d / R) ** 2 * 1.1 * field.w;
          ox += (dx / d) * f;
          oy += (dy / d) * f;
          oz += (dz / d) * f;
        }
      }
      this.off[i] += (ox - this.off[i]) * ease;
      this.off[i + 1] += (oy - this.off[i + 1]) * ease;
      this.off[i + 2] += (oz - this.off[i + 2]) * ease;
      this.pos[i] = x + this.off[i];
      this.pos[i + 1] = y + this.off[i + 1];
      this.pos[i + 2] = z + this.off[i + 2];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Floor: contact shadow and a faint lime pool of light                */
/* ------------------------------------------------------------------ */

export function makeFloor() {
  const tex = new CanvasTex(1024, 1024, 4);
  tex.update("floor", (ctx) => {
    const g = ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
    g.addColorStop(0, "rgba(182,243,107,0.06)");
    g.addColorStop(0.35, "rgba(125,211,252,0.035)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    new THREE.MeshBasicMaterial({ map: tex.texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.002;

  const shadowTex = new CanvasTex(512, 512, 4);
  shadowTex.update("shadow", (ctx) => {
    const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, "rgba(0,0,0,0.85)");
    g.addColorStop(0.55, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  });
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 4),
    new THREE.MeshBasicMaterial({ map: shadowTex.texture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.001, -0.2);

  const group = new THREE.Group();
  group.add(glow, shadow);
  return group;
}

/* ------------------------------------------------------------------ */
/* Scan sweep over the laptop screen                                   */
/* ------------------------------------------------------------------ */

export class Scan {
  readonly mesh: THREE.Mesh;
  constructor(width: number, private readonly height: number) {
    const tex = new CanvasTex(16, 256, 1);
    tex.update("scan", (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "rgba(125,211,252,0)");
      g.addColorStop(0.86, "rgba(125,211,252,0.28)");
      g.addColorStop(0.97, "rgba(220,245,255,1)");
      g.addColorStop(1, "rgba(220,245,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 16, 256);
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.5),
      new THREE.MeshBasicMaterial({
        map: tex.texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.mesh.position.z = 0.03;
  }

  /** Screen-local placement: centre of screen at y0. */
  update(t: number, y0: number) {
    const vis = t > 0.001 && t < 0.999;
    this.mesh.visible = vis;
    if (!vis) return;
    // Sweep from the top edge to the bottom edge (line leads, glow trails above it).
    const yTop = y0 + this.height / 2 + 0.25;
    const yBot = y0 - this.height / 2 + 0.2;
    this.mesh.position.y = yTop + (yBot - yTop) * smooth(t);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * clamp01(t)) * 1.2;
  }
}

/* ------------------------------------------------------------------ */
/* Memory cards                                                         */
/* ------------------------------------------------------------------ */

const NOTES: [string, string, string[]][] = [
  ["Oct 9", "Launch sync", ["Launch set for Oct 28", "Pending security review", "Maya: audit log export"]],
  ["Oct 2", "Security review", ["Pen test booked", "SSO scope agreed", "Retest after fixes"]],
  ["Sep 25", "Kickoff", ["Owners per workstream", "Weekly sync on Thursdays", "Budget approved"]],
];

export class MemoryCards {
  readonly group = new THREE.Group();
  private readonly cards: THREE.Group[] = [];
  private readonly from: THREE.Vector3[] = [];
  private readonly mid: THREE.Vector3[] = [];
  private readonly fromRot: THREE.Euler[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(glass: THREE.Material) {
    NOTES.forEach(([date, title, lines], i) => {
      const tex = new CanvasTex(760, 480, 8);
      tex.update("card", (ctx) => {
        ctx.clearRect(0, 0, 760, 480);
        roundRect(ctx, 3, 3, 754, 474, 40);
        ctx.fillStyle = "rgba(10,12,16,0.72)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `600 26px ${FONT_MONO}`;
        ctx.fillStyle = LIME;
        ctx.fillText(date.toUpperCase(), 48, 72);
        ctx.font = `650 50px ${FONT_DISPLAY}`;
        ctx.fillStyle = "#f1f3f5";
        ctx.fillText(title, 48, 150);
        ctx.font = `450 30px ${FONT_BODY}`;
        lines.forEach((l, j) => {
          ctx.fillStyle = LIME;
          ctx.beginPath();
          ctx.arc(58, 228 + j * 70 - 10, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c3c8d0";
          ctx.fillText(l, 84, 228 + j * 70);
        });
      });
      const card = new THREE.Group();
      const slab = new THREE.Mesh(slabGeometry(1.2, 0.76, 0.07, 0.016, 0.012), glass);
      const faceMat = new THREE.MeshBasicMaterial({ map: tex.texture, transparent: true, toneMapped: false, depthWrite: false });
      this.materials.push(faceMat);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.76), faceMat);
      face.position.z = 0.03;
      card.add(slab, face);
      this.group.add(card);
      this.cards.push(card);
      this.from.push(new THREE.Vector3(-4 + i * 4, 3.4 - i * 0.6, -9 - i * 2));
      this.fromRot.push(new THREE.Euler(0.4 - i * 0.2, (i - 1) * 0.9, (i - 1) * 0.4));
      this.mid.push(new THREE.Vector3(-1.75 + i * 1.0, 3.3 - i * 0.06, 0.35 - i * 0.35));
    });
  }

  setGlass(glass: THREE.Material) {
    for (const c of this.cards) (c.children[0] as THREE.Mesh).material = glass;
  }

  update(t: number, sink: THREE.Vector3, time: number) {
    this.group.visible = t > 0.001 && t < 0.999;
    if (!this.group.visible) return;
    const q = new THREE.Quaternion();
    const qFrom = new THREE.Quaternion();
    const qMid = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.3, 0));
    this.cards.forEach((card, i) => {
      const a = smooth(range(t, i * 0.08, 0.5 + i * 0.08));
      const b = smooth(range(t, 0.68 + i * 0.07, 0.9 + i * 0.03));
      const p = new THREE.Vector3().lerpVectors(this.from[i], this.mid[i], a);
      p.y += Math.sin(time * 0.8 + i) * 0.03 * (1 - b);
      p.lerp(sink, b);
      card.position.copy(p);
      qFrom.setFromEuler(this.fromRot[i]);
      q.slerpQuaternions(qFrom, qMid, a);
      card.quaternion.copy(q);
      const s = 1 - 0.85 * b;
      card.scale.setScalar(s);
      card.visible = a > 0.001 && b < 0.995;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Provider ring                                                        */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  "Anthropic", "OpenAI", "Gemini", "Groq", "OpenRouter", "DeepSeek", "xAI", "Mistral", "Ollama", "LM Studio", "Deepgram",
];

export class ProviderRing {
  readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];

  constructor() {
    const make = (color: string, radius: number, height: number, tilt: number, flip: boolean) => {
      const tex = new CanvasTex(4096, 128, 8);
      tex.update("ring", (ctx) => {
        ctx.clearRect(0, 0, 4096, 128);
        ctx.font = `600 64px ${FONT_DISPLAY}`;
        ctx.textBaseline = "middle";
        const seq = [...PROVIDERS, ...PROVIDERS];
        const gap = 70;
        const widths = seq.map((p) => ctx.measureText(p).width + gap);
        const total = widths.reduce((a, b) => a + b, 0);
        const sx = 4096 / total;
        let x = 0;
        seq.forEach((p, i) => {
          ctx.save();
          ctx.translate(x, 64);
          ctx.scale(sx, 1);
          ctx.fillStyle = color;
          ctx.fillText(p, 0, 0);
          ctx.fillStyle = LIME;
          ctx.beginPath();
          ctx.arc(widths[i] - gap / 2, 0, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          x += widths[i] * sx;
        });
      });
      tex.texture.wrapS = THREE.RepeatWrapping;
      if (flip) tex.texture.repeat.x = -1;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 160, 1, true),
        new THREE.MeshBasicMaterial({
          map: tex.texture,
          transparent: true,
          side: THREE.FrontSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.rotation.z = tilt;
      this.group.add(mesh);
      this.rings.push(mesh);
    };
    make("#e8ebef", 3.3, 0.26, 0.1, false);
    make("#7dd3fc", 3.85, 0.2, -0.14, false);
    this.group.position.set(0.65, 1.2, 0);
  }

  update(vis: number, spin: number) {
    this.group.visible = vis > 0.01;
    if (!this.group.visible) return;
    this.rings.forEach((r, i) => {
      (r.material as THREE.MeshBasicMaterial).opacity = vis * (i === 0 ? 0.95 : 0.55);
      r.rotation.y = (i === 0 ? 1 : -0.7) * spin * Math.PI * 2;
    });
    this.group.scale.setScalar(0.85 + 0.15 * vis);
  }
}

/* ------------------------------------------------------------------ */
/* Key and lock                                                         */
/* ------------------------------------------------------------------ */

export class KeyLock {
  readonly group = new THREE.Group();
  private readonly key = new THREE.Group();
  private readonly shackle: THREE.Group;
  private readonly glowMat: THREE.MeshStandardMaterial;
  private readonly lock = new THREE.Group();
  private readonly path: THREE.CatmullRomCurve3;

  constructor() {
    const metal = new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 1, roughness: 0.18 });
    const dark = new THREE.MeshStandardMaterial({ color: "#26292f", metalness: 0.85, roughness: 0.3 });
    this.glowMat = new THREE.MeshStandardMaterial({
      color: "#0d0f12",
      emissive: new THREE.Color(LIME),
      emissiveIntensity: 0,
      metalness: 0.4,
      roughness: 0.4,
    });

    // Lock body + shackle
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.5, 0.22, 4, 0.06), dark);
    const keyhole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), this.glowMat);
    keyhole.position.set(0, 0.04, 0.111);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.11), this.glowMat);
    slot.position.set(0, -0.03, 0.111);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.02, 0.225), this.glowMat);
    band.position.y = -0.14;
    this.shackle = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 16, 40, Math.PI), metal);
    arc.position.y = 0.3;
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 16), metal);
    legL.position.set(-0.19, 0.19, 0);
    const legR = legL.clone();
    legR.position.x = 0.19;
    this.shackle.add(arc, legL, legR);
    this.lock.add(body, keyhole, slot, band, this.shackle);
    this.lock.position.set(2.15, 1.05, 1.35);
    this.lock.rotation.y = -0.45;

    // Key
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 12, 32), metal);
    bow.position.x = -0.26;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.03), metal);
    shaft.position.x = -0.02;
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), metal);
    t1.position.set(0.08, -0.05, 0);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.03), metal);
    t2.position.set(0.14, -0.04, 0);
    this.key.add(bow, shaft, t1, t2);

    this.group.add(this.lock, this.key);
    const slotWorld = new THREE.Vector3(0, 0.0, 0.12);
    this.lock.updateMatrixWorld(true);
    const end = slotWorld.clone().applyMatrix4(this.lock.matrixWorld);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.lock.quaternion);
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.2, 3.2, 2.4),
      new THREE.Vector3(-0.8, 2.9, 2.8),
      new THREE.Vector3(1.4, 1.9, 2.6),
      end.clone().addScaledVector(dir, 0.55),
      end.clone().addScaledVector(dir, 0.16),
    ]);
  }

  update(vis: number, t: number, time: number) {
    this.group.visible = vis > 0.01;
    if (!this.group.visible) return;
    this.lock.scale.setScalar(0.6 + 0.4 * smooth(vis));
    const travel = smooth(range(t, 0, 0.8));
    const p = this.path.getPointAt(travel);
    this.key.position.copy(p);
    // Key points along its path, then turns a quarter when seated.
    const ahead = this.path.getPointAt(Math.min(1, travel + 0.01));
    const yaw = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
    this.key.rotation.set(smooth(range(t, 0.8, 0.95)) * Math.PI * 0.5, travel > 0.995 ? this.lock.rotation.y - Math.PI / 2 : yaw, 0);
    this.key.visible = vis > 0.2;
    const locked = smooth(range(t, 0.88, 1));
    this.shackle.position.y = 0.09 * (1 - locked);
    this.glowMat.emissiveIntensity = locked * 2.2;
    this.lock.position.y = 1.05 + Math.sin(time * 0.9) * 0.03;
  }
}

/* ------------------------------------------------------------------ */
/* Containment dome (private by design)                                */
/* ------------------------------------------------------------------ */

export class Dome {
  readonly mesh: THREE.LineSegments;
  constructor() {
    const g = new THREE.SphereGeometry(3.6, 28, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    const edges = new THREE.WireframeGeometry(g);
    this.mesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: LIME,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.mesh.position.y = 0;
  }

  update(t: number, time: number) {
    this.mesh.visible = t > 0.01;
    if (!this.mesh.visible) return;
    (this.mesh.material as THREE.LineBasicMaterial).opacity = 0.09 * t;
    this.mesh.scale.set(0.7 + 0.3 * smooth(t), 0.2 + 0.8 * smooth(t), 0.7 + 0.3 * smooth(t));
    this.mesh.rotation.y = time * 0.04;
  }
}
