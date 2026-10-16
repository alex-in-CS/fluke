// Renders screenshots of each chapter with the local Chrome (no browser download).
// Usage: node scripts/shots.mjs [url] [outDir] [desktop|mobile|both] [frac]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "shots";
const which = process.argv[4] ?? "both";
const frac = Number(process.argv[5] ?? 0.75);
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const targets = ["hero", "listen", "answer", "see", "remember", "keys", "private", "hotkeys", "download"];

for (const [name, opts] of Object.entries(viewports)) {
  if (which !== "both" && which !== name) continue;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector(".preloader", { state: "detached", timeout: 60000 });
  await page.waitForTimeout(800);
  for (const t of targets) {
    if (only && !only.includes(t)) continue;
    const y = await page.evaluate(
      ([id, f]) => {
        if (id === "hero") return 0;
        const el = document.getElementById(id);
        const vh = window.innerHeight;
        const top = el.getBoundingClientRect().top + window.scrollY;
        const hold = Math.max(0, el.offsetHeight - vh);
        return id === "download" ? document.documentElement.scrollHeight - vh : top + hold * f;
      },
      [t, frac],
    );
    await page.evaluate((y) => window.__fluke.lenis.scrollTo(y, { immediate: true, force: true }), y);
    await page.waitForTimeout(Number(process.env.SETTLE ?? 3000));
    await page.screenshot({ path: join(out, `${name}-${t}.png`) });
    console.log("shot", name, t, Math.round(y));
  }
  if (errors.length) console.log(`[${name}] console errors:\n` + errors.join("\n"));
  await ctx.close();
}
await browser.close();
