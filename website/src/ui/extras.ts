import { ScrollTrigger } from "gsap/ScrollTrigger";
import { KeyboardTex } from "../scene/screens";

/* ---------------- Buttons: the label rolls up and a copy rolls in ---------------- */

export function initRoll() {
  document.querySelectorAll<HTMLElement>(".btn").forEach((btn) => {
    const walk = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n as Text;
      if (!t.data.trim()) continue;
      const roll = document.createElement("span");
      roll.className = "roll";
      const inner = document.createElement("span");
      inner.className = "roll__in";
      inner.textContent = t.data.trim();
      roll.append(inner);
      t.replaceWith(roll);
      break;
    }
  });
}

/* ---------------- Cards light up under the pointer ---------------- */

export function initSpotlight(selector: string) {
  if (!matchMedia("(pointer: fine)").matches) return;
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.classList.add("spot");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}

/* ---------------- Your keyboard drives the one on screen ---------------- */

const CODE_TO_CAP: Record<string, string> = {
  Escape: "esc", Backspace: "bksp", Tab: "tab", CapsLock: "caps", Enter: "enter", NumpadEnter: "enter",
  ShiftLeft: "shift", ShiftRight: "shift", ControlLeft: "ctrl", ControlRight: "ctrl", AltLeft: "alt", AltRight: "alt",
  Space: "space", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Comma: ",", Period: ".", Slash: "/", ArrowLeft: "◀", ArrowDown: "▼", ArrowRight: "▶",
};

function capFor(code: string) {
  if (CODE_TO_CAP[code]) return CODE_TO_CAP[code];
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}

/**
 * Mirrors held keys onto the 3D keyboard and, when a real chord matches one of the listed
 * hotkeys, flashes that row. `changed` lets a still (reduced-motion) stage redraw on demand.
 */
export function initKeyboardMirror(pressed: Set<string>, changed: () => void) {
  const held = new Map<string, number>();
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".keys li"));
  const sync = () => {
    pressed.clear();
    for (const cap of held.keys()) pressed.add(cap);
    changed();
  };
  const clear = () => {
    held.forEach((t) => clearTimeout(t));
    held.clear();
    sync();
  };
  window.addEventListener("keydown", (e) => {
    const cap = capFor(e.code);
    if (!cap) return;
    clearTimeout(held.get(cap));
    // Browsers swallow some keyups (a chord that opens a menu): expire keys after a while anyway.
    held.set(cap, window.setTimeout(() => (held.delete(cap), sync()), 2500));
    sync();
    KeyboardTex.CHORDS.forEach((chord, i) => {
      if (chord.length === held.size && chord.every((k) => held.has(k))) {
        const li = rows[i];
        if (!li) return;
        li.classList.remove("is-pressed");
        void li.offsetWidth;
        li.classList.add("is-pressed");
      }
    });
  });
  window.addEventListener("keyup", (e) => {
    const cap = capFor(e.code);
    if (!cap) return;
    clearTimeout(held.get(cap));
    held.delete(cap);
    sync();
  });
  window.addEventListener("blur", clear);
}

/* ---------------- Chapter rail ---------------- */

/** `onChapter` gets 1..7 as each chapter becomes current, and 0 when scrolling back above them. */
export function initRail(onChapter: (i: number) => void = () => undefined) {
  const rail = document.querySelector<HTMLElement>(".rail");
  if (!rail) return;
  const links = Array.from(rail.querySelectorAll<HTMLAnchorElement>("a"));
  const fill = rail.querySelector<HTMLElement>(".rail__fill")!;
  links.forEach((a, i) => {
    const sec = document.querySelector<HTMLElement>(a.hash);
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => {
        a.classList.toggle("is-active", self.isActive);
        if (self.isActive) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
        if (self.isActive) onChapter(i + 1);
        else if (i === 0 && self.direction < 0) onChapter(0);
      },
    });
  });
  // Fills from the first chapter to the last; hidden over the hero and the finale.
  const first = document.getElementById("listen");
  const last = document.getElementById("hotkeys");
  if (!first || !last) return;
  ScrollTrigger.create({
    trigger: first,
    endTrigger: last,
    start: "top 60%",
    end: "bottom 40%",
    onUpdate: (self) => (fill.style.transform = `scaleY(${self.progress.toFixed(4)})`),
    onToggle: (self) => rail.classList.toggle("is-shown", self.isActive),
  });
}
