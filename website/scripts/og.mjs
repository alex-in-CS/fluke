// Renders public/og.png (1200x630) from the live hero. Run with the dev server up.
import { chromium } from "playwright-core";
const url = process.argv[2] ?? "http://localhost:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(url);
await page.waitForSelector(".preloader", { state: "detached", timeout: 60000 });
await page.addStyleTag({ content: ".nav__links,.hero__cta,.hero__meta,.hero__sub{display:none!important}" });
await page.waitForTimeout(2500);
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("wrote public/og.png");
