// Screenshots the reduced-motion version of the page.
import { chromium } from "playwright-core";
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/reduced-hero.png` });
await page.evaluate(() => document.getElementById("see").scrollIntoView());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/reduced-see.png` });
console.log("errors:", errors.join("\n") || "none");
await browser.close();
