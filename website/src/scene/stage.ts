import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Laptop, SCREEN_W } from "./laptop";
import { BAR_H, BAR_W, Overlay, PANEL_H } from "./overlay";
import { Dome, Dust, KeyLock, MemoryCards, ProviderRing, Ribbons, Scan, makeFloor } from "./fx";
import type { SceneState } from "./state";
import { clamp01, lerp, smooth } from "./util";

export const OVERLAY_POS = new THREE.Vector3(0, 2.46, -0.5);
const INTRO_POS = new THREE.Vector3(-1.2, 5.5, 19);
const INTRO_TGT = new THREE.Vector3(0, 1.0, 0);

type Quality = 0 | 1 | 2;

export interface StageOptions {
  mobile: boolean;
  /** Render a single still frame on demand instead of a continuous loop. */
  still: boolean;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality;
  private readonly laptop: Laptop;
  private readonly overlay = new Overlay();
  private readonly ribbons: Ribbons;
  private readonly dust: Dust;
  private readonly memory: MemoryCards;
  private readonly ring = new ProviderRing();
  private readonly keylock = new KeyLock();
  private readonly dome = new Dome();
  private readonly scan: Scan;
  private readonly capture: THREE.Mesh;
  private readonly captureFrom = new THREE.Object3D();
  private readonly captureTo = new THREE.Object3D();
  private readonly pointer = new THREE.Vector2();
  private readonly pointerSmooth = new THREE.Vector2();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpTgt = new THREE.Vector3();
  private readonly memorySink = new THREE.Vector3();
  private frameTimes: number[] = [];
  private warmup = 0;
  private width = 1;
  private height = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly state: SceneState,
    readonly opts: StageOptions,
  ) {
    this.quality = opts.mobile ? 1 : 2;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#07080a", 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    // Explicit background (see applyQuality for why the value differs per pipeline).
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.FogExp2("#07080a", 0.028);

    // Lights: a soft key plus lime and sky rims that echo You and Them.
    this.scene.add(new THREE.HemisphereLight("#c8d4e8", "#050607", 0.25));
    const key = new THREE.DirectionalLight("#ffffff", 1.5);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const rimL = new THREE.PointLight("#b6f36b", 26, 14, 2);
    rimL.position.set(-4.2, 3.2, -2.6);
    const rimR = new THREE.PointLight("#7dd3fc", 30, 14, 2);
    rimR.position.set(4.4, 2.6, -2.4);
    this.scene.add(rimL, rimR);

    this.laptop = new Laptop(opts.mobile);
    this.scene.add(this.laptop.group, makeFloor());

    this.overlay.group.position.copy(OVERLAY_POS);
    this.overlay.group.rotation.x = -0.05;
    this.overlay.thumb = this.laptop.call.tex.canvas;
    this.scene.add(this.overlay.group);

    this.ribbons = new Ribbons(OVERLAY_POS, opts.mobile ? 140 : 320);
    this.scene.add(this.ribbons.group);

    this.dust = new Dust(opts.mobile ? 160 : 420);
    this.scene.add(this.dust.points);

    this.memory = new MemoryCards(this.overlay.glassMaterial);
    this.scene.add(this.memory.group, this.ring.group, this.keylock.group, this.dome.mesh);

    this.scan = new Scan(SCREEN_W, SCREEN_W / 1.6);
    this.laptop.lid.add(this.scan.mesh);

    // A copy of the screen that flies into the overlay when you "ask with screen".
    this.capture = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_W, SCREEN_W / 1.6),
      new THREE.MeshBasicMaterial({ map: this.laptop.call.tex.texture, toneMapped: false, transparent: true }),
    );
    this.capture.visible = false;
    this.scene.add(this.capture);

    // Where the thumbnail sits inside the overlay panel (matches Overlay.paintScreen).
    const thumbCx = -BAR_W / 2 + ((64 + 165) / 1280) * BAR_W;
    const panelTop = -BAR_H / 2 - 0.07;
    const thumbCy = panelTop - (251 / ((1280 * PANEL_H) / BAR_W)) * PANEL_H;
    this.captureTo.position.set(thumbCx, thumbCy, 0.08);
    this.captureTo.scale.setScalar((330 / 1280) * BAR_W / SCREEN_W);
    this.overlay.group.add(this.captureTo);
    this.memorySink.copy(OVERLAY_POS).add(new THREE.Vector3(0, -0.6, 0.05));

    this.applyQuality();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    if (!opts.mobile) {
      window.addEventListener("pointermove", (e) => {
        this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      });
    }
  }

  private applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === 2 ? 1.75 : this.quality === 1 ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    const fine = this.quality === 2;
    this.overlay.setFineGlass(fine);
    this.memory.setGlass(this.overlay.glassMaterial);
    this.ribbons.setPixelRatio(this.renderer.getPixelRatio());
    this.dust.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();

    // Through the composer the background is tone mapped, so it needs a lifted value to land on the page ink.
    const ink = this.quality >= 1 ? "#17191d" : "#07080a";
    (this.scene.background as THREE.Color).set(ink);
    (this.scene.fog as THREE.FogExp2).color.set(ink);

    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (this.quality >= 1) {
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: this.quality === 2 ? 4 : 0,
      });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.65, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
      this.bloom?.resolution.set(this.width / 2, this.height / 2);
    }
    this.camera.aspect = this.width / this.height;
    if (this.opts.still) this.render(0, performance.now() / 1000);
  }

  private placeCamera() {
    const s = this.state;
    const aspect = this.width / this.height;
    // Keep the horizontal field of view stable on narrow screens: widen, then dolly back.
    const base = THREE.MathUtils.degToRad(s.fov);
    const hfov = 2 * Math.atan(Math.tan(base / 2) * 1.6);
    let vfov = aspect < 1.6 ? 2 * Math.atan(Math.tan(hfov / 2) / aspect) : base;
    const maxV = THREE.MathUtils.degToRad(this.opts.mobile ? 68 : 50);
    let dolly = 1;
    if (vfov > maxV) {
      // Pull back only part of the way: on phones the subject can fill more of the frame.
      dolly = 1 + (Math.tan(vfov / 2) / Math.tan(maxV / 2) - 1) * 0.35;
      vfov = maxV;
    }
    this.camera.fov = THREE.MathUtils.radToDeg(vfov);

    // The intro flight blends from a distant pose into whatever the scroll timeline says.
    const r = clamp01(s.reveal);
    this.tmpTgt.set(s.tgtX, s.tgtY, s.tgtZ).lerp(INTRO_TGT, 1 - r);
    this.tmpPos
      .set(s.camX, s.camY, s.camZ)
      .lerp(INTRO_POS, 1 - r)
      .sub(this.tmpTgt)
      .multiplyScalar(dolly)
      .add(this.tmpTgt);

    // Gentle pointer parallax.
    this.pointerSmooth.lerp(this.pointer, 0.045);
    const right = new THREE.Vector3().subVectors(this.tmpPos, this.tmpTgt).cross(this.camera.up).normalize();
    this.tmpPos.addScaledVector(right, -this.pointerSmooth.x * 0.28);
    this.tmpPos.y += this.pointerSmooth.y * 0.16;

    this.camera.position.copy(this.tmpPos);
    this.camera.lookAt(this.tmpTgt);

    // Shift the subject sideways (desktop) or upwards (mobile) to make room for copy.
    const narrow = aspect < 0.9;
    const sx = narrow ? 0 : s.shiftX;
    const sy = narrow ? Math.min(0.3, s.shiftY + 0.13) : s.shiftY;
    this.camera.setViewOffset(this.width, this.height, -sx * this.width, sy * this.height, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, time: number) {
    const s = this.state;
    this.laptop.update(time, s.speaker, s.share, s.hotkey);
    this.overlay.group.position.y = OVERLAY_POS.y + Math.sin(time * 0.9) * 0.025;
    this.overlay.group.scale.setScalar(lerp(0.85, 1, smooth(s.reveal)));
    this.overlay.update(s, time);
    this.ribbons.update(dt, time, clamp01(s.ribbons), s.speaker);
    this.dust.update(time);
    this.memory.update(s.memory, this.memorySink, time);
    this.ring.update(s.ring, s.spin);
    this.keylock.update(s.ring, s.keyIn, time);
    this.dome.update(s.shield, time);
    this.scan.update(s.scan, 0.04 + 2.15 / 2);
    this.updateCapture(s.capture);
    this.placeCamera();

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.measure(dt);
  }

  private updateCapture(t: number) {
    const vis = t > 0.001 && t < 0.999;
    this.capture.visible = vis;
    if (!vis) return;
    this.laptop.screenWorld(this.captureFrom);
    this.captureTo.updateWorldMatrix(true, false);
    const to = new THREE.Vector3();
    const toQ = new THREE.Quaternion();
    const toS = new THREE.Vector3();
    this.captureTo.matrixWorld.decompose(to, toQ, toS);
    const e = smooth(t);
    this.capture.position.lerpVectors(this.captureFrom.position, to, e);
    this.capture.position.z += Math.sin(Math.PI * e) * 1.2;
    this.capture.position.y += Math.sin(Math.PI * e) * 0.25;
    this.capture.quaternion.slerpQuaternions(this.captureFrom.quaternion, toQ, e);
    this.capture.scale.setScalar(lerp(this.captureFrom.scale.x, toS.x, e));
    (this.capture.material as THREE.MeshBasicMaterial).opacity = t < 0.9 ? 1 : (1 - t) / 0.1;
  }

  /** Steps quality down (never up) when frames are consistently slow. */
  private measure(dt: number) {
    if (this.opts.still || this.quality === 0) return;
    this.warmup += dt;
    if (this.warmup < 2.5 || dt <= 0 || dt > 0.25) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 40) {
      this.quality = (this.quality - 1) as Quality;
      this.warmup = 0;
      this.applyQuality();
    }
  }

  /** Compile shaders up front so the first scroll does not hitch. */
  async warm() {
    this.placeCamera();
    await this.renderer.compileAsync(this.scene, this.camera);
  }
}
