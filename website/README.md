# Fluke website

The marketing site for Fluke: a single page where scrolling flies a camera through one 3D scene (a laptop on a call, the Fluke overlay, audio streams, meeting memory, provider ring, keyboard hotkeys) while the copy pins alongside it.

## Stack

- **Vite + TypeScript**, no framework
- **three.js** for the scene. All geometry is procedural and every screen is drawn to a 2D canvas texture, so there are no model or image files to load
- **GSAP** (ScrollTrigger, SplitText) for the scroll timeline and intro
- **Lenis** for smooth scrolling, driven by the GSAP ticker
- One self-hosted typeface via Fontsource: **Mona Sans** (variable weight, width 75 to 125% and italics). Headlines are semi-expanded; accent lines contrast by width (condensed light italic) rather than by a second typeface; labels and keys use the semi-condensed cut with tabular figures. No monospace

## Run

```bash
cd website
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
```

## How it fits together

```
index.html          all copy, as semantic HTML (SEO and screen readers read this; the canvas is aria-hidden)
src/main.ts         boot: fonts, preloader, intro, Lenis, story, reduced-motion path
src/story.ts        one master GSAP timeline whose time unit is "viewport heights scrolled";
                    camera poses per chapter (POSES) and every scene cue
src/scene/state.ts  the numbers the timeline animates (camera, panel, ribbons, memory, ring, ...)
src/scene/stage.ts  renderer, post-processing, camera framing, adaptive quality
src/scene/*.ts      laptop, overlay, call screen and keyboard textures, particles, cards, ring, lock, dome
src/scene/laptop.ts the hero laptop: bevelled brushed-aluminium slabs, merged 3D keycaps planar-mapped to the
                    keyboard art, perforated grilles, ports, cover glass, camera
src/scene/studio.ts product-photography studio rendered only into the environment map
src/scene/fluid.ts  GPU fluid solver and the post pass that refracts the frame through it
src/scene/textlayer.ts  paints the hero and finale headlines into the frame so the fluid bends them
src/ui/sound.ts     generative Web Audio score (off by default)
src/ui/voice.ts     "Try it with your voice": local mic level, on-device captions where available
src/ui/effects.ts   grain, cursor, magnetic buttons, preloader wave
src/ui/extras.ts    button label roll, card spotlight, chapter rail, footer wordmark,
                    real keyboard mirrored onto the 3D keyboard
```

### Interactions

- **Fluid:** a stable-fluids solver (advection, vorticity confinement, pressure projection, after Pavel Dobryakov's MIT WebGL Fluid Simulation) runs on the GPU at 128 px (96 on phones). The cursor stirs it, a click drops ink into it, and scrolling drags the water. The whole frame is refracted through the velocity field with a faint lime/sky ink on top. Tunables live in `Fluid.config`.
- **Liquid type:** the hero and finale headlines are painted into a canvas at their exact DOM positions (intro and scroll transforms included) and composited after the output pass, so the fluid refracts them like everything else. The DOM text stays for selection and screen readers with a transparent fill. Without the fluid pipeline (low quality, reduced motion, no WebGL) the DOM text simply shows.
- **Opening:** the laptop starts closed in the dark. As the preloader lifts and the camera flies in, the lid swings open; the panel and key backlight power on, the overlay surfaces from the screen and the headline rises.
- **Try it with your voice:** an opt-in button in the Listen chapter. The microphone drives the You stream and the You tile through a local Web Audio analyser. Captions appear only where the browser can transcribe on-device (`SpeechRecognition.processLocally`); otherwise it is level-only. A question in the captions shows "Question detected". Audio never leaves the page. The strip stops on Stop or when the tab is hidden.
- **Overture:** one statement after the hero, lit word by word by the scroll while both audio streams play.
- **Sound:** the nav toggle starts a score synthesised live with Web Audio, no files: a pad that moves through one chord per chapter, filtered air that rises with scroll speed, and a quiet chime on each chapter arrival.
- **Pointer:** the dust also parts around the cursor.
- **Keyboard:** keys you hold light up on the 3D laptop. On the Hotkeys chapter, pressing a real chord flashes its row.
- **Chapters:** eyebrows wipe open, headline lines rise out of masks and body lines follow, all scrubbed by the scroll. The right-edge rail tracks progress and jumps to any chapter.
- **Footer:** the wordmark rises with scroll and its letters thicken and light up near the pointer (Inter Tight's weight axis).

Chapter lengths (how long each section stays pinned) live in `LENGTHS` in `src/main.ts`. Change a camera angle in `POSES` in `src/story.ts`.

## Performance and accessibility

- Device pixel ratio is capped (1.75 desktop, 1.25 phones). Bloom runs at half resolution.
- Quality steps down automatically when frames are slow: first the transmissive glass becomes a cheaper material, then post-processing is dropped. It never steps back up, to avoid flicker.
- Canvas textures only re-upload when their content changes. Shaders are compiled before the intro plays.
- Rendering pauses while the tab is hidden.
- `prefers-reduced-motion`: no smooth scrolling, no camera flights, no preloader. The scene renders once as a still and sections fade in.
- If WebGL is unavailable, the page still works as a normal document.

## Screenshots and social image

The scripts use your installed Chrome through `playwright-core` (no browser download). Start `npm run dev` first.

```bash
node scripts/shots.mjs http://localhost:5173/ ./shots both   # every chapter, desktop and mobile
node scripts/reduced.mjs http://localhost:5173/ ./shots      # reduced-motion check
node scripts/og.mjs                                          # regenerates public/og.png
```

Set `CHROME` to point at a different browser binary.

## Deploy

`.github/workflows/pages.yml` builds this folder with `BASE_PATH=/fluke/` and publishes it to GitHub Pages at `https://alex-in-cs.github.io/fluke/` on every push to `main` that touches `website/`. Enable Pages in the repository settings with **Source: GitHub Actions**.

For a custom domain: add `public/CNAME` containing the domain, set `BASE_PATH: /` in the workflow, and point the domain's DNS at GitHub Pages. Social previews need an absolute image URL, so also change `og:image` in `index.html` to `https://<your-domain>/og.png`.

When building locally from Git Bash on Windows, prefix with `MSYS_NO_PATHCONV=1` so `BASE_PATH=/fluke/` is not rewritten into a Windows path.
