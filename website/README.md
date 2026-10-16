# Fluke website

The marketing site for Fluke: a single page where scrolling flies a camera through one 3D scene (a laptop on a call, the Fluke overlay, audio streams, meeting memory, provider ring, keyboard hotkeys) while the copy pins alongside it.

## Stack

- **Vite + TypeScript**, no framework
- **three.js** for the scene. All geometry is procedural and every screen is drawn to a 2D canvas texture, so there are no model or image files to load
- **GSAP** (ScrollTrigger, SplitText) for the scroll timeline and intro
- **Lenis** for smooth scrolling, driven by the GSAP ticker
- Self-hosted fonts via Fontsource: Inter Tight, Inter, JetBrains Mono, Instrument Serif

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
```

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
