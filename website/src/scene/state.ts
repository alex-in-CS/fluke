/** Everything the scroll story animates. GSAP tweens these numbers; the stage reads them every frame. */
export interface SceneState {
  // Camera rig (world units) and framing offset (fraction of the viewport, shifts the subject sideways/up).
  camX: number;
  camY: number;
  camZ: number;
  tgtX: number;
  tgtY: number;
  tgtZ: number;
  shiftX: number;
  shiftY: number;
  fov: number;

  /** 0 hidden → 1 fully faded in (hero intro). */
  reveal: number;
  /** Overlay answer-panel height, 0 closed → 1 open. */
  panel: number;
  /** 0 transcript · 1 answer · 2 screen answer · 3 memory. */
  panelMode: number;
  /** Progress through the current panel mode's content. */
  modeT: number;
  /** Audio ribbons intensity. */
  ribbons: number;
  /** 0 nobody · 1 them · 2 you. */
  speaker: number;
  /** Laptop screen showing a shared slide (0 → 1). */
  share: number;
  /** Scan plane sweep (0 → 1). */
  scan: number;
  /** Captured frame flying into the overlay (0 → 1). */
  capture: number;
  /** Memory cards journey (0 far away → 1 folded into the overlay). */
  memory: number;
  /** Provider ring visibility and spin. */
  ring: number;
  spin: number;
  /** Key flying into the lock (0 → 1), lock closing at the end. */
  keyIn: number;
  /** Containment shell around the laptop. */
  shield: number;
  /** Which hotkey row is lit on the keyboard (-1 none). */
  hotkey: number;
  /** Bar "Ask" highlight. */
  ask: number;
  /** Intro: lid closed (0) to open (1), then the screen and backlight power on (0 to 1). */
  lid: number;
  power: number;
  /** Live microphone level from "Try it with your voice", 0 silent to 1 loud. */
  voice: number;
}

export function createState(): SceneState {
  return {
    camX: 0,
    camY: 2.6,
    camZ: 15,
    tgtX: 0,
    tgtY: 1.1,
    tgtZ: 0,
    shiftX: 0,
    shiftY: 0,
    fov: 30,
    reveal: 0,
    panel: 0,
    panelMode: 0,
    modeT: 0,
    ribbons: 0,
    speaker: 0,
    share: 0,
    scan: 0,
    capture: 0,
    memory: 0,
    ring: 0,
    spin: 0,
    keyIn: 0,
    shield: 0,
    hotkey: -1,
    ask: 0,
    lid: 0,
    power: 0,
    voice: 0,
  };
}
