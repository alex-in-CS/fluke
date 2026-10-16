import * as THREE from "three";

/*
 * A small GPU fluid solver (stable fluids: advection, vorticity confinement, pressure projection),
 * after Pavel Dobryakov's WebGL Fluid Simulation (MIT). The pointer and the scroll stir it; the
 * stage then refracts the rendered frame through its velocity field and adds a faint luminous ink.
 */

const BASE_VERT = /* glsl */ `
  uniform vec2 texelSize;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HEAD = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
`;

const SPLAT = /* glsl */ `${HEAD}
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
  }
`;

const ADVECT = /* glsl */ `${HEAD}
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 simTexel;
  uniform float dt;
  uniform float dissipation;
  void main() {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * simTexel;
    gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
  }
`;

const DIVERGENCE = /* glsl */ `${HEAD}
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vT.y > 1.0) T = -C.y;
    if (vB.y < 0.0) B = -C.y;
    gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
  }
`;

const CURL = /* glsl */ `${HEAD}
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
  }
`;

const VORTICITY = /* glsl */ `${HEAD}
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main() {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
    gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
  }
`;

const CLEAR = /* glsl */ `${HEAD}
  uniform sampler2D uTexture;
  uniform float value;
  void main() {
    gl_FragColor = value * texture2D(uTexture, vUv);
  }
`;

const PRESSURE = /* glsl */ `${HEAD}
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float div = texture2D(uDivergence, vUv).x;
    gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT = /* glsl */ `${HEAD}
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

/** Composites the fluid over the rendered frame: refraction through the velocity field plus ink. */
export const FluidShader = {
  name: "FluidShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uDye: { value: null as THREE.Texture | null },
    uRefract: { value: 0.0002 },
    uInk: { value: 1 },
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
    uniform sampler2D uVelocity;
    uniform sampler2D uDye;
    uniform float uRefract;
    uniform float uInk;
    varying vec2 vUv;
    void main() {
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vec2 off = vel * uRefract;
      float m = length(off);
      if (m > 0.025) off *= 0.025 / m;
      // A whisper of dispersion along the flow only, so edges catch light like thick glass.
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off * 1.06).r;
      col.g = texture2D(tDiffuse, vUv - off).g;
      col.b = texture2D(tDiffuse, vUv - off * 0.94).b;
      vec3 ink = texture2D(uDye, vUv).rgb;
      gl_FragColor = vec4(col + ink * uInk, 1.0);
    }
  `,
};

function target(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

class Double {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  constructor(w: number, h: number) {
    this.read = target(w, h);
    this.write = target(w, h);
  }
  swap() {
    [this.read, this.write] = [this.write, this.read];
  }
  dispose() {
    this.read.dispose();
    this.write.dispose();
  }
}

export interface FluidOptions {
  simRes: number;
  dyeRes: number;
}

const LIME = new THREE.Color("#b6f36b");
const SKY = new THREE.Color("#7dd3fc");

export class Fluid {
  /** Tunables. Ink fades fast and the motion settles quickly: present, never muddy. */
  readonly config = {
    densityDissipation: 2.4,
    velocityDissipation: 1.4,
    pressure: 0.8,
    pressureIterations: 18,
    curl: 9,
    splatRadius: 0.0018,
    splatForce: 4200,
    inkStrength: 0.035,
  };

  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly simTexel = { value: new THREE.Vector2() };
  private readonly dyeTexel = { value: new THREE.Vector2() };
  private velocity!: Double;
  private dye!: Double;
  private pressure!: Double;
  private divergence!: THREE.WebGLRenderTarget;
  private curlRT!: THREE.WebGLRenderTarget;
  private aspect = 1;
  private readonly queue: { x: number; y: number; dx: number; dy: number; color: THREE.Color | null; r: number }[] = [];

  private readonly mSplat: THREE.ShaderMaterial;
  private readonly mAdvect: THREE.ShaderMaterial;
  private readonly mDiv: THREE.ShaderMaterial;
  private readonly mCurl: THREE.ShaderMaterial;
  private readonly mVort: THREE.ShaderMaterial;
  private readonly mClear: THREE.ShaderMaterial;
  private readonly mPress: THREE.ShaderMaterial;
  private readonly mGrad: THREE.ShaderMaterial;

  // Pointer, sampled once per frame.
  private px = -1;
  private py = -1;
  private lastX = -1;
  private lastY = -1;
  private moved = false;
  private hue = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly opts: FluidOptions,
  ) {
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>, texel = this.simTexel) =>
      new THREE.ShaderMaterial({
        vertexShader: BASE_VERT,
        fragmentShader: frag,
        uniforms: { texelSize: texel, ...uniforms },
        depthTest: false,
        depthWrite: false,
      });
    const tex = () => ({ value: null as THREE.Texture | null });
    this.mSplat = mat(SPLAT, {
      uTarget: tex(),
      aspectRatio: { value: 1 },
      color: { value: new THREE.Vector3() },
      point: { value: new THREE.Vector2() },
      radius: { value: 0.01 },
    });
    this.mAdvect = mat(ADVECT, {
      uVelocity: tex(),
      uSource: tex(),
      simTexel: this.simTexel,
      dt: { value: 0 },
      dissipation: { value: 0 },
    });
    this.mDiv = mat(DIVERGENCE, { uVelocity: tex() });
    this.mCurl = mat(CURL, { uVelocity: tex() });
    this.mVort = mat(VORTICITY, { uVelocity: tex(), uCurl: tex(), curl: { value: 0 }, dt: { value: 0 } });
    this.mClear = mat(CLEAR, { uTexture: tex(), value: { value: 0 } });
    this.mPress = mat(PRESSURE, { uPressure: tex(), uDivergence: tex() });
    this.mGrad = mat(GRADIENT, { uPressure: tex(), uVelocity: tex() });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mClear);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.resize(window.innerWidth, window.innerHeight);

    window.addEventListener("pointermove", (e) => {
      this.px = e.clientX / window.innerWidth;
      this.py = 1 - e.clientY / window.innerHeight;
      this.moved = true;
    });
    window.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as Element).closest("a, button, input")) return;
      this.drop(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    });
  }

  get velocityTexture() {
    return this.velocity.read.texture;
  }

  get dyeTexture() {
    return this.dye.read.texture;
  }

  private res(base: number, w: number, h: number) {
    const a = w / h;
    const big = Math.round(base * (a < 1 ? 1 / a : a));
    const small = Math.round(base);
    return w > h ? { w: big, h: small } : { w: small, h: big };
  }

  resize(w: number, h: number) {
    this.aspect = w / h;
    const s = this.res(this.opts.simRes, w, h);
    const d = this.res(this.opts.dyeRes, w, h);
    for (const t of [this.velocity, this.dye, this.pressure]) t?.dispose();
    this.divergence?.dispose();
    this.curlRT?.dispose();
    this.velocity = new Double(s.w, s.h);
    this.pressure = new Double(s.w, s.h);
    this.dye = new Double(d.w, d.h);
    this.divergence = target(s.w, s.h);
    this.curlRT = target(s.w, s.h);
    this.simTexel.value.set(1 / s.w, 1 / s.h);
    this.dyeTexel.value.set(1 / d.w, 1 / d.h);
    this.mSplat.uniforms.aspectRatio.value = this.aspect;
    // Fresh targets hold garbage on some drivers: start from still water (true zero, not the page ink).
    const prevColor = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const t of [this.velocity.read, this.velocity.write, this.dye.read, this.dye.write, this.pressure.read, this.pressure.write]) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(prevColor, prevAlpha);
  }

  /** Queue a splat. x, y in 0..1 (y up); dx, dy in velocity units; color null = push only. */
  splat(x: number, y: number, dx: number, dy: number, color: THREE.Color | null = null, radiusScale = 1) {
    this.queue.push({ x, y, dx, dy, color, r: radiusScale });
  }

  /** A click: ink blooms outward from the point, like a drop landing in still water. */
  drop(x: number, y: number) {
    const n = 6;
    const ink = this.inkColor().multiplyScalar(2.2);
    const rot = Math.random() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      this.splat(x, y, Math.cos(a) * 260, Math.sin(a) * 260, i === 0 ? ink : null, 0.6);
    }
  }

  /** The scroll drags the water: a broad push-only band so the frame flows with the page. */
  stir(pxPerSec: number) {
    if (Math.abs(pxPerSec) < 80) return;
    const f = Math.max(-1, Math.min(1, pxPerSec / 4000)) * 34;
    this.splat(0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6, 0, f, null, 10);
  }

  private inkColor() {
    // Drift between You (lime) and Them (sky) as the pointer travels.
    const t = 0.5 + 0.5 * Math.sin(this.hue);
    return LIME.clone().lerp(SKY, t).multiplyScalar(this.config.inkStrength);
  }

  private run(material: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget) {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.scene, this.cam);
  }

  private applySplat(q: (typeof this.queue)[number]) {
    const u = this.mSplat.uniforms;
    let r = this.config.splatRadius * q.r;
    if (this.aspect > 1) r *= this.aspect;
    u.radius.value = r;
    u.point.value.set(q.x, q.y);
    u.uTarget.value = this.velocity.read.texture;
    u.color.value.set(q.dx, q.dy, 0);
    this.run(this.mSplat, this.velocity.write);
    this.velocity.swap();
    if (q.color) {
      u.uTarget.value = this.dye.read.texture;
      u.color.value.set(q.color.r, q.color.g, q.color.b);
      this.run(this.mSplat, this.dye.write);
      this.dye.swap();
    }
  }

  step(dt: number) {
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    const c = this.config;
    const prevTarget = this.renderer.getRenderTarget();
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    if (this.moved && this.px >= 0) {
      if (this.lastX >= 0) {
        let dx = this.px - this.lastX;
        let dy = this.py - this.lastY;
        if (this.aspect < 1) dx *= this.aspect;
        if (this.aspect > 1) dy /= this.aspect;
        const speed = Math.hypot(dx, dy);
        if (speed > 1e-5) {
          this.hue += speed * 6;
          // Slow drags barely tint the water; only a decisive gesture leaves a visible trace.
          this.splat(this.px, this.py, dx * c.splatForce, dy * c.splatForce, this.inkColor().multiplyScalar(Math.min(1, speed * 22)));
        }
      }
      this.lastX = this.px;
      this.lastY = this.py;
      this.moved = false;
    }
    for (const q of this.queue.splice(0)) this.applySplat(q);

    this.mCurl.uniforms.uVelocity.value = this.velocity.read.texture;
    this.run(this.mCurl, this.curlRT);

    const v = this.mVort.uniforms;
    v.uVelocity.value = this.velocity.read.texture;
    v.uCurl.value = this.curlRT.texture;
    v.curl.value = c.curl;
    v.dt.value = dt;
    this.run(this.mVort, this.velocity.write);
    this.velocity.swap();

    this.mDiv.uniforms.uVelocity.value = this.velocity.read.texture;
    this.run(this.mDiv, this.divergence);

    this.mClear.uniforms.uTexture.value = this.pressure.read.texture;
    this.mClear.uniforms.value.value = c.pressure;
    this.run(this.mClear, this.pressure.write);
    this.pressure.swap();

    this.mPress.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < c.pressureIterations; i++) {
      this.mPress.uniforms.uPressure.value = this.pressure.read.texture;
      this.run(this.mPress, this.pressure.write);
      this.pressure.swap();
    }

    this.mGrad.uniforms.uPressure.value = this.pressure.read.texture;
    this.mGrad.uniforms.uVelocity.value = this.velocity.read.texture;
    this.run(this.mGrad, this.velocity.write);
    this.velocity.swap();

    const a = this.mAdvect.uniforms;
    a.dt.value = dt;
    a.uVelocity.value = this.velocity.read.texture;
    a.uSource.value = this.velocity.read.texture;
    a.dissipation.value = c.velocityDissipation;
    this.run(this.mAdvect, this.velocity.write);
    this.velocity.swap();

    a.uVelocity.value = this.velocity.read.texture;
    a.uSource.value = this.dye.read.texture;
    a.dissipation.value = c.densityDissipation;
    this.run(this.mAdvect, this.dye.write);
    this.dye.swap();

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = autoClear;
  }
}
