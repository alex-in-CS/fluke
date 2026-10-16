import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SceneState } from "./scene/state";
import { SplitText } from "gsap/SplitText";

type Pose = Pick<SceneState, "camX" | "camY" | "camZ" | "tgtX" | "tgtY" | "tgtZ" | "shiftX" | "shiftY" | "fov">;

const pose = (
  cam: [number, number, number],
  tgt: [number, number, number],
  shiftX = 0,
  shiftY = 0,
  fov = 30,
): Pose => ({
  camX: cam[0],
  camY: cam[1],
  camZ: cam[2],
  tgtX: tgt[0],
  tgtY: tgt[1],
  tgtZ: tgt[2],
  shiftX,
  shiftY,
  fov,
});

/** Camera poses per chapter. Copy on the left → subject shifted right (positive shiftX), and vice versa. */
export const POSES = {
  hero: pose([1.1, 2.8, 9.6], [0.1, 1.45, -0.2], 0.22, 0.02),
  overture: pose([0, 2.6, 13.5], [0, 1.3, 0], 0, -0.36, 28),
  listen: pose([-4.4, 2.3, 6.4], [-0.2, 1.35, 0.3], 0.2, 0),
  answer: pose([1.3, 2.9, 5.9], [0.05, 1.9, -0.4], -0.19, 0),
  see: pose([3.3, 2.4, 6.9], [0.1, 1.5, -0.5], 0.18, 0),
  remember: pose([-2.2, 3.3, 7.0], [-0.5, 2.15, -0.3], -0.17, 0),
  keys: pose([1.2, 4.4, 11.5], [0.5, 1.1, 0.2], 0.22, 0.02),
  private: pose([0, 10.5, 12.5], [0, 0.6, -0.2], 0.1, 0.02, 32),
  hotkeys: pose([0, 4.4, 1.5], [0, 0.0, -0.25], 0, 0.06, 34),
  finale: pose([0, 7, 38], [0, 1.3, 0], 0, 0.3, 30),
};

/** Hero values the timeline starts from. */
export function applyHero(s: SceneState) {
  Object.assign(s, POSES.hero, { ribbons: 0.4, speaker: 1, panel: 0, panelMode: 0, modeT: 0 });
}

interface Section {
  el: HTMLElement;
  top: number;
  len: number;
}

function measure(id: string): Section {
  const el = document.getElementById(id)!;
  const vh = window.innerHeight;
  const top = (el.getBoundingClientRect().top + window.scrollY) / vh;
  return { el, top, len: el.offsetHeight / vh };
}

/**
 * One master timeline whose time unit is "viewport heights scrolled".
 * Section N's copy pins from N.top to N.top + N.len - 1; the camera flies in during the 0.85 vh before.
 */
export function buildStory(s: SceneState) {
  const vh = window.innerHeight;
  const total = (document.documentElement.scrollHeight - vh) / vh;
  const tl = gsap.timeline({ paused: true, defaults: { ease: "none" } });
  tl.set({}, {}, total); // fix the timeline length to the scroll length
  // Line splits depend on the layout, so they are rebuilt with the story on resize.
  const splits: SplitText[] = [];

  const fly = (p: Pose, at: number, dur = 0.85, extra: gsap.TweenVars = {}) =>
    tl.to(s, { ...p, ...extra, duration: dur, ease: "power2.inOut" }, at);
  const to = (vars: gsap.TweenVars, at: number, dur: number, ease = "power1.inOut") =>
    tl.to(s, { ...vars, duration: dur, ease }, at);

  /**
   * Chapter copy arrives as masked lines: the eyebrow wipes open, headline lines rise out of their
   * masks, body lines follow a beat later, then everything lifts away together.
   */
  const copyIn = (sec: Section, target: Element | Element[]) => {
    const kids = Array.isArray(target) ? target : Array.from((target as HTMLElement).children);
    const at = sec.top - 0.5;
    const rest: Element[] = [];
    const lines = (el: Element) => {
      const sp = new SplitText(el, { type: "lines", mask: "lines", linesClass: "line" });
      splits.push(sp);
      return sp.lines;
    };
    for (const k of kids) {
      if (k.matches(".eyebrow")) {
        tl.fromTo(
          k,
          { autoAlpha: 1, clipPath: "inset(0% 100% 0% 0%)" },
          { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "power3.inOut" },
          at - 0.04,
        );
      } else if (k.matches("h2")) {
        tl.fromTo(
          lines(k),
          { yPercent: 112, rotate: 2.5 },
          { yPercent: 0, rotate: 0, duration: 0.55, stagger: 0.08, ease: "expo.out", transformOrigin: "0% 100%" },
          at,
        );
      } else if (k.matches("p:not(.small)")) {
        tl.fromTo(
          lines(k),
          { yPercent: 105, autoAlpha: 0 },
          { yPercent: 0, autoAlpha: 1, duration: 0.5, stagger: 0.035, ease: "expo.out" },
          at + 0.14,
        );
      } else {
        rest.push(k);
      }
    }
    if (rest.length) {
      tl.fromTo(
        rest,
        { autoAlpha: 0, y: 28 },
        { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.05, ease: "expo.out" },
        at + 0.22,
      );
    }
    tl.to(kids, { autoAlpha: 0, y: -36, duration: 0.35, stagger: 0.025, ease: "power2.in" }, sec.top + sec.len - 1 + 0.05);
  };

  const O = measure("overture");
  const L = measure("listen");
  const A = measure("answer");
  const S = measure("see");
  const R = measure("remember");
  const K = measure("keys");
  const P = measure("private");
  const H = measure("hotkeys");
  const F = measure("download");

  const hold = (sec: Section) => Math.max(0.3, sec.len - 1);

  // Hero copy drifts up and fades as you leave the hero.
  tl.to(".hero__copy", { autoAlpha: 0, y: -80, duration: 0.6, ease: "power1.in" }, 0.15);

  // Overture: the camera settles back and low; one statement lights up word by word while
  // both streams play, Them then You.
  fly(POSES.overture, O.top - 0.85, 1.0);
  to({ ribbons: 0.85 }, O.top - 0.6, 0.6);
  tl.set(s, { speaker: 1 }, O.top - 0.2);
  tl.set(s, { speaker: 2 }, O.top + hold(O) * 0.45);
  const statement = O.el.querySelector(".overture__text")!;
  const sw = new SplitText(statement, { type: "words", wordsClass: "ow" });
  splits.push(sw);
  tl.fromTo(statement, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "expo.out" }, O.top - 0.55);
  tl.fromTo(sw.words, { opacity: 0.14 }, { opacity: 1, duration: 0.12, stagger: (hold(O) * 0.85) / sw.words.length, ease: "none" }, O.top - 0.25);
  tl.to(statement, { autoAlpha: 0, y: -48, duration: 0.4, ease: "power2.in" }, O.top + O.len - 1 + 0.05);

  // 01 Listen: streams intensify, panel opens on a live transcript, Them then You.
  fly(POSES.listen, L.top - 0.85);
  to({ ribbons: 1 }, L.top - 0.7, 0.6);
  tl.set(s, { panelMode: 0, modeT: 0 }, L.top - 0.86);
  to({ panel: 0.6 }, L.top - 0.3, 0.4, "power3.out");
  to({ modeT: 1 }, L.top, hold(L) * 0.85);
  tl.set(s, { speaker: 1 }, L.top);
  tl.set(s, { speaker: 2 }, L.top + hold(L) * 0.55);
  copyIn(L, L.el.querySelector(".chapter__copy")!);

  // 02 Answer: question detected, Ask lights, answer streams in.
  fly(POSES.answer, A.top - 0.85);
  to({ panel: 0.08 }, A.top - 0.85, 0.3);
  tl.set(s, { panelMode: 1, modeT: 0, speaker: 1 }, A.top - 0.55);
  to({ panel: 1, ribbons: 0.3 }, A.top - 0.5, 0.5, "power3.out");
  to({ ask: 1 }, A.top - 0.2, 0.15);
  to({ ask: 0 }, A.top + 0.05, 0.25);
  to({ modeT: 1 }, A.top - 0.15, hold(A) * 0.8 + 0.15);
  tl.set(s, { speaker: 0 }, A.top);
  copyIn(A, A.el.querySelector(".chapter__copy")!);

  // 03 See: they share a slide, you ask with the screen, a scan sweeps, the frame flies in.
  fly(POSES.see, S.top - 0.85);
  to({ panel: 0 }, S.top - 0.85, 0.35);
  to({ share: 1 }, S.top - 0.6, 0.4);
  tl.set(s, { speaker: 1 }, S.top - 0.6);
  const sh = hold(S);
  to({ ask: 1 }, S.top, sh * 0.06);
  to({ ask: 0 }, S.top + sh * 0.1, sh * 0.08);
  tl.set(s, { speaker: 0 }, S.top + sh * 0.05);
  to({ scan: 1 }, S.top + sh * 0.02, sh * 0.3, "power1.inOut");
  to({ capture: 1 }, S.top + sh * 0.3, sh * 0.3, "power2.inOut");
  tl.set(s, { panelMode: 2, modeT: 0 }, S.top + sh * 0.5);
  to({ panel: 1 }, S.top + sh * 0.5, sh * 0.1, "power3.out");
  to({ modeT: 1 }, S.top + sh * 0.6, sh * 0.38);
  copyIn(S, S.el.querySelector(".chapter__copy")!);

  // 04 Remember: past meeting cards arrive from the dark and fold into the overlay.
  fly(POSES.remember, R.top - 0.85);
  to({ panel: 0, share: 0 }, R.top - 0.85, 0.35);
  tl.set(s, { panelMode: 3, modeT: 0, scan: 0, capture: 0 }, R.top - 0.5);
  const rh = hold(R);
  to({ memory: 1 }, R.top - 0.5, rh + 0.4);
  to({ panel: 0.92 }, R.top + rh * 0.5, rh * 0.12, "power3.out");
  to({ modeT: 1 }, R.top + rh * 0.55, rh * 0.42);
  copyIn(R, R.el.querySelector(".chapter__copy")!);

  // 05 Keys: provider ring orbits, a key glides into the lock.
  fly(POSES.keys, K.top - 0.85);
  to({ panel: 0, ribbons: 0.15 }, K.top - 0.85, 0.35);
  to({ ring: 1 }, K.top - 0.6, 0.6);
  to({ spin: 0.6 }, K.top - 0.6, hold(K) + 1.2);
  to({ keyIn: 1 }, K.top + 0.05, hold(K) * 0.8);
  copyIn(K, K.el.querySelector(".chapter__copy")!);

  // 06 Private: camera rises, a containment dome closes over the laptop.
  fly(POSES.private, P.top - 0.85, 0.95);
  to({ ring: 0, ribbons: 0 }, P.top - 0.85, 0.5);
  to({ shield: 1 }, P.top - 0.4, 0.6, "power2.out");
  copyIn(P, Array.from(P.el.querySelectorAll(".private__inner > *")));

  // 07 Hotkeys: dive onto the keyboard; each chord lights up in turn.
  fly(POSES.hotkeys, H.top - 0.85, 0.9);
  to({ shield: 0 }, H.top - 0.85, 0.4);
  const hh = hold(H);
  for (let i = 0; i < 5; i++) tl.set(s, { hotkey: i }, H.top + (hh * i) / 5);
  tl.set(s, { hotkey: -1 }, H.top + hh + 0.1);
  copyIn(H, Array.from(H.el.querySelectorAll(".hotkeys__inner > *")));

  // Finale: pull far back.
  fly(POSES.finale, F.top - 0.9, 1.1);
  to({ ribbons: 0.35, speaker: 1 }, F.top - 0.5, 0.4);

  const st = ScrollTrigger.create({
    start: 0,
    end: "max",
    scrub: 1.1,
    animation: tl,
  });
  return () => {
    st.kill();
    tl.kill();
    splits.forEach((sp) => sp.revert());
  };
}
