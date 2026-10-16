import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CallScreen, KeyboardTex } from "./screens";

export const BASE_W = 3.3;
export const BASE_D = 2.25;
export const BASE_H = 0.1;
export const LID_H = 2.15;
export const SCREEN_W = 3.0;
export const SCREEN_H = SCREEN_W / 1.6;
/** Lid leans back this far from vertical. */
const LID_TILT = THREE.MathUtils.degToRad(13);

export class Laptop {
  readonly group = new THREE.Group();
  readonly lid = new THREE.Group();
  readonly screen: THREE.Mesh;
  readonly call = new CallScreen();
  readonly keyboard = new KeyboardTex();
  private readonly kbMat: THREE.MeshStandardMaterial;

  constructor(lowPoly = false) {
    const seg = lowPoly ? 2 : 5;
    const alu = new THREE.MeshStandardMaterial({ color: "#24272c", metalness: 0.85, roughness: 0.42 });
    const aluEdge = new THREE.MeshStandardMaterial({ color: "#4a4e56", metalness: 0.92, roughness: 0.22 });
    // Unlit: as a flat glossy surface the bezel mirrors the key light into a uniform grey band.
    const bezel = new THREE.MeshBasicMaterial({ color: "#030405" });

    // Base
    const base = new THREE.Mesh(new RoundedBoxGeometry(BASE_W, BASE_H, BASE_D, seg, 0.045), alu);
    base.position.y = BASE_H / 2;
    this.group.add(base);

    // Keyboard well + keys
    this.kbMat = new THREE.MeshStandardMaterial({
      map: this.keyboard.tex.texture,
      emissiveMap: this.keyboard.emissive.texture,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.1,
      metalness: 0.2,
      roughness: 0.6,
    });
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(2.88, 1.2), this.kbMat);
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, BASE_H + 0.002, -0.28);
    this.group.add(kb);

    // Trackpad
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(1.25, 0.004, 0.74, 2, 0.002),
      new THREE.MeshStandardMaterial({ color: "#26292e", metalness: 0.7, roughness: 0.28 }),
    );
    pad.position.set(0, BASE_H + 0.001, 0.64);
    this.group.add(pad);

    // Speaker grilles (where the "Them" ribbons start)
    const grille = new THREE.MeshStandardMaterial({ color: "#16181c", metalness: 0.5, roughness: 0.7 });
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.1), grille);
      g.rotation.x = -Math.PI / 2;
      g.position.set(sx * 1.55, BASE_H + 0.002, -0.28);
      this.group.add(g);
    }

    // Hinge
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BASE_W * 0.82, 24), aluEdge);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, BASE_H + 0.01, -BASE_D / 2 + 0.03);
    this.group.add(hinge);

    // Lid: rotates around the hinge. Front face (+z) is the bezel.
    this.lid.position.set(0, BASE_H + 0.02, -BASE_D / 2 + 0.03);
    this.lid.rotation.x = -LID_TILT;
    const lidGeo = new RoundedBoxGeometry(BASE_W, LID_H, 0.05, seg, 0.022);
    const lidMesh = new THREE.Mesh(lidGeo, alu);
    lidMesh.position.y = LID_H / 2;
    this.lid.add(lidMesh);
    // Glass bezel covering the inner face, just behind the screen.
    const bezelMesh = new THREE.Mesh(new RoundedBoxGeometry(BASE_W - 0.05, LID_H - 0.05, 0.004, 2, 0.002), bezel);
    bezelMesh.position.set(0, LID_H / 2, 0.0235);
    this.lid.add(bezelMesh);

    const screenMat = new THREE.MeshBasicMaterial({
      map: this.call.tex.texture,
      toneMapped: false,
      color: new THREE.Color(0.86, 0.86, 0.86),
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
    this.screen.position.set(0, LID_H / 2 + 0.04, 0.0285);
    this.lid.add(this.screen);

    // A faint logo glow on the lid back (seen from behind in wide shots).
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 40),
      new THREE.MeshBasicMaterial({ color: "#b6f36b", transparent: true, opacity: 0.35, toneMapped: false }),
    );
    mark.position.set(0, LID_H / 2, -0.027);
    mark.rotation.y = Math.PI;
    this.lid.add(mark);

    this.group.add(this.lid);
  }

  update(time: number, speaker: number, share: number, hotkey: number) {
    this.call.draw(time, speaker, share);
    this.keyboard.draw(hotkey);
  }

  /** World transform of the screen plane. */
  screenWorld(target: THREE.Object3D) {
    this.screen.updateWorldMatrix(true, false);
    this.screen.matrixWorld.decompose(target.position, target.quaternion, target.scale);
  }
}
