import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CallScreen, KeyboardTex } from "./screens";
import { LIME, roundedShape, slabGeometry } from "./util";

export const BASE_W = 3.3;
export const BASE_D = 2.25;
export const BASE_H = 0.1;
export const LID_H = 2.15;
export const SCREEN_W = 3.0;
export const SCREEN_H = SCREEN_W / 1.6;
/** Lid leans back this far from vertical. */
const LID_TILT = THREE.MathUtils.degToRad(13);
/** Keyboard art plane: size and centre on the deck (texture space maps onto this). */
const KB_W = 2.88;
const KB_D = 1.2;
const KB_Z = -0.28;

/** Fine horizontal grain for brushed aluminium (used as a roughness map; world-unit UVs). */
function brushedTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * 512;
    const v = 108 + Math.random() * 44;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.35})`;
    ctx.lineWidth = Math.random() < 0.9 ? 0.6 : 1.4;
    ctx.beginPath();
    const x = Math.random() * 512;
    ctx.moveTo(x - 400, y);
    ctx.lineTo(x + 400, y + (Math.random() - 0.5) * 0.6);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.9, 0.9);
  t.anisotropy = 16;
  return t;
}

/** Perforation pattern for the speaker grilles (white = hole). */
function grilleTexture() {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 768;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  for (let row = 0; row < 64; row++) {
    for (let col = 0; col < 8; col++) {
      const x = 8 + col * 11 + (row % 2 ? 5.5 : 0);
      if (x > c.width - 6) continue;
      ctx.beginPath();
      ctx.arc(x, 8 + row * 11.8, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 16;
  return t;
}

/** Top-down slab in the XZ plane (shape footprint w × d, thickness h), resting on y = 0. */
function deckSlab(w: number, d: number, r: number, h: number, bevel: number) {
  const g = slabGeometry(w, d, r, h - bevel * 2, bevel);
  g.rotateX(-Math.PI / 2);
  g.translate(0, h / 2, 0);
  return g;
}

export class Laptop {
  readonly group = new THREE.Group();
  readonly lid = new THREE.Group();
  readonly screen: THREE.Mesh;
  readonly call = new CallScreen();
  readonly keyboard = new KeyboardTex();
  /** Keyboard labels (as drawn on the keycaps) currently held on the visitor's real keyboard. */
  readonly pressed = new Set<string>();

  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly capMat: THREE.MeshStandardMaterial;
  private readonly ledMat: THREE.MeshBasicMaterial;

  constructor(lowPoly = false) {
    const brushed = brushedTexture();

    // Space-grey aluminium: brushed, anisotropic, with a thin protective clearcoat.
    const alu = new THREE.MeshPhysicalMaterial({
      color: "#3a3e45",
      metalness: 1,
      roughness: 0.4,
      roughnessMap: brushed,
      anisotropy: 0.6,
      clearcoat: 0.3,
      clearcoatRoughness: 0.32,
    });
    // Diamond-cut chamfers: the same metal, polished, so every edge carries a bright line.
    const chamfer = new THREE.MeshPhysicalMaterial({ color: "#5f656e", metalness: 1, roughness: 0.24 });
    const dark = new THREE.MeshStandardMaterial({ color: "#050607", roughness: 0.85, metalness: 0.1 });

    // Base: rounded slab with a polished bevel all round (group 0 = faces, group 1 = sides/bevel).
    const baseGeo = deckSlab(BASE_W, BASE_D, 0.13, BASE_H, 0.016);
    this.group.add(new THREE.Mesh(baseGeo, [alu, chamfer]));

    // Keyboard well, then real keycaps whose tops carry the keyboard art (planar-mapped).
    const well = new THREE.Mesh(new THREE.PlaneGeometry(KB_W + 0.04, KB_D + 0.04), dark);
    well.rotation.x = -Math.PI / 2;
    well.position.set(0, BASE_H + 0.0008, KB_Z);
    this.group.add(well);
    const capMat = (this.capMat = new THREE.MeshStandardMaterial({
      map: this.keyboard.tex.texture,
      emissiveMap: this.keyboard.emissive.texture,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.5,
      roughness: 0.58,
      metalness: 0.05,
    }));
    this.group.add(new THREE.Mesh(this.keycaps(lowPoly), capMat));

    // Trackpad: glassy, slightly proud, with its own fine chamfer.
    const pad = new THREE.Mesh(
      deckSlab(1.3, 0.8, 0.05, 0.004, 0.0015),
      [
        new THREE.MeshPhysicalMaterial({
          color: "#16181c",
          metalness: 0.55,
          roughness: 0.3,
          clearcoat: 0.7,
          clearcoatRoughness: 0.1,
        }),
        chamfer,
      ],
    );
    pad.position.set(0, BASE_H - 0.0015, 0.64);
    this.group.add(pad);

    // Speaker grilles: real perforations (where the "Them" ribbons start).
    const grilleMat = new THREE.MeshBasicMaterial({ color: "#000000", alphaMap: grilleTexture(), transparent: true });
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.1), grilleMat);
      g.rotation.x = -Math.PI / 2;
      g.position.set(sx * 1.55, BASE_H + 0.0009, KB_Z);
      this.group.add(g);
    }

    // Ports and a status light on the flanks, rubber feet underneath.
    const portMat = new THREE.MeshStandardMaterial({ color: "#020203", roughness: 0.6 });
    const port = (x: number, z: number, side: 1 | -1) => {
      const p = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(0.13, 0.034, 0.017), 8), portMat);
      p.rotation.y = side * (Math.PI / 2);
      p.position.set(x + side * 0.0012, BASE_H * 0.5, z);
      this.group.add(p);
    };
    port(BASE_W / 2, -0.55, 1);
    port(-BASE_W / 2, -0.55, -1);
    port(-BASE_W / 2, -0.32, -1);
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(LIME).multiplyScalar(2.2), toneMapped: false });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), this.ledMat);
    led.rotation.y = Math.PI / 2;
    led.position.set(BASE_W / 2 + 0.0015, BASE_H * 0.5, -0.32);
    this.group.add(led);
    const foot = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24);
    for (const [fx, fz] of [[-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85]]) {
      const f = new THREE.Mesh(foot, dark);
      f.position.set(fx, -0.004, fz);
      this.group.add(f);
    }

    // Hinge barrel.
    const hinge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.052, BASE_W * 0.8, 40),
      new THREE.MeshPhysicalMaterial({ color: "#1b1d21", metalness: 1, roughness: 0.3, anisotropy: 0.8 }),
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, BASE_H + 0.012, -BASE_D / 2 + 0.035);
    this.group.add(hinge);

    // Lid: rotates around the hinge. Front face (+z) carries the glass.
    this.lid.position.set(0, BASE_H + 0.02, -BASE_D / 2 + 0.03);
    this.lid.rotation.x = -LID_TILT;
    const lidGeo = slabGeometry(BASE_W, LID_H, 0.13, 0.03, 0.0125);
    const lidMesh = new THREE.Mesh(lidGeo, [alu, chamfer]);
    lidMesh.position.y = LID_H / 2;
    this.lid.add(lidMesh);

    // Black bezel (unlit: a flat glossy black would mirror the key light as a grey band).
    const bezel = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedShape(BASE_W - 0.05, LID_H - 0.05, 0.11), 12),
      new THREE.MeshBasicMaterial({ color: "#020203" }),
    );
    bezel.position.set(0, LID_H / 2, 0.0281);
    this.lid.add(bezel);

    const screenMat = (this.screenMat = new THREE.MeshBasicMaterial({
      map: this.call.tex.texture,
      toneMapped: false,
      color: new THREE.Color(0.9, 0.9, 0.9),
    }));
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
    this.screen.position.set(0, LID_H / 2 + 0.04, 0.0285);
    this.lid.add(this.screen);

    // Camera: a dark lens with a faint glint.
    const cam = new THREE.Mesh(new THREE.CircleGeometry(0.014, 24), new THREE.MeshBasicMaterial({ color: "#0b0d12" }));
    cam.position.set(0, LID_H - 0.042, 0.0287);
    this.lid.add(cam);
    const glint = new THREE.Mesh(new THREE.RingGeometry(0.005, 0.0075, 24), new THREE.MeshBasicMaterial({ color: "#2a3550" }));
    glint.position.set(0.002, LID_H - 0.04, 0.0289);
    this.lid.add(glint);

    // Edge-to-edge cover glass: adds only its reflections (Fresnel), over bezel and display alike.
    const glass = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedShape(BASE_W - 0.05, LID_H - 0.05, 0.11), 12),
      new THREE.MeshPhysicalMaterial({
        color: "#000000",
        roughness: 0.05,
        metalness: 0,
        envMapIntensity: 1.4,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glass.position.set(0, LID_H / 2, 0.0296);
    this.lid.add(glass);

    // Mirror-polished mark on the lid back, with a faint lime glow behind it.
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 48),
      new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.32, toneMapped: false }),
    );
    mark.position.set(0, LID_H / 2, -0.0285);
    mark.rotation.y = Math.PI;
    this.lid.add(mark);

    this.group.add(this.lid);
  }

  /** One merged mesh of rounded keycaps, UV-mapped so each top shows its own key from the art. */
  private keycaps(lowPoly: boolean) {
    const { w: tw, h: th } = this.keyboard.tex;
    const capH = 0.016;
    const parts: THREE.BufferGeometry[] = [];
    for (const k of this.keyboard.rects()) {
      const w = (k.w / tw) * KB_W - 0.004;
      const d = (k.h / th) * KB_D - 0.004;
      const cx = ((k.x + k.w / 2) / tw - 0.5) * KB_W;
      const cz = KB_Z + ((k.y + k.h / 2) / th - 0.5) * KB_D;
      const g = new RoundedBoxGeometry(w, capH, d, lowPoly ? 1 : 3, 0.006);
      g.translate(cx, BASE_H + 0.001 + capH / 2, cz);
      parts.push(g);
    }
    const merged = mergeGeometries(parts)!;
    // Planar projection from above: texture u follows x, v follows -z across the art plane.
    const pos = merged.attributes.position;
    const uv = merged.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, 0.5 + pos.getX(i) / KB_W, 0.5 - (pos.getZ(i) - KB_Z) / KB_D);
    }
    uv.needsUpdate = true;
    return merged;
  }

  update(time: number, speaker: number, share: number, hotkey: number) {
    this.call.draw(time, speaker, share);
    this.keyboard.draw(hotkey, this.pressed);
  }

  /**
   * Intro state. `open` swings the lid up from closed (lifted clear of the keycaps while it moves);
   * `power` wakes the panel with a soft rise and brings up the key backlight and status light.
   */
  setPower(open: number, power: number) {
    const o = THREE.MathUtils.clamp(open, 0, 1);
    this.lid.rotation.x = THREE.MathUtils.lerp(Math.PI / 2, -LID_TILT, o);
    this.lid.position.y = BASE_H + 0.02 + (1 - o) * 0.04;
    const p = THREE.MathUtils.clamp(power, 0, 1);
    this.screenMat.color.setScalar(0.9 * p + 0.12 * Math.sin(Math.PI * p));
    this.capMat.emissiveIntensity = 1.5 * p;
    this.ledMat.color.set(LIME).multiplyScalar(0.25 + 1.95 * Math.min(1, o * 1.5));
  }

  /** World transform of the screen plane. */
  screenWorld(target: THREE.Object3D) {
    this.screen.updateWorldMatrix(true, false);
    this.screen.matrixWorld.decompose(target.position, target.quaternion, target.scale);
  }
}
