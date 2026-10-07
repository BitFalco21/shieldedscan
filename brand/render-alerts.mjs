/**
 * Renders the alerts announcement graphic.
 *
 * A separate entry point rather than another shot inside `generate.mjs`: that script
 * regenerates the PERMANENT identity — the avatar and the banners — and this is a one-off
 * announcement asset with its own lifetime. Keeping them apart means re-rolling the banner
 * does not silently rewrite an image already posted, and vice versa.
 *
 * Renders through the project's own Playwright Chromium with the self-hosted JetBrains
 * Mono embedded as base64, exactly as `generate.mjs` does — so no network request, and the
 * type is the site's type rather than whatever fallback happens to be installed.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { alertsHtml } from "./alerts.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(DIR, "..");

const fontCss = [
  ["JetBrainsMono-Regular.woff2", 400],
  ["JetBrainsMono-Bold.woff2", 700],
  ["JetBrainsMono-ExtraBold.woff2", 800],
]
  .map(([file, weight]) => {
    const b64 = fs.readFileSync(path.join(ROOT, "public/fonts", file)).toString("base64");
    return `@font-face{font-family:"JBM";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  })
  .join("\n");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.setContent(alertsHtml(), { waitUntil: "load" });
await page.addStyleTag({ content: fontCss });
// Layout must settle on the real face before the shot: measured in the fallback face,
// every letter-spaced line lands a few pixels short. The same trap the e2e layout suite hit.
await page.evaluate(() => document.fonts.ready);
const out = path.join(DIR, "shieldedscan-alerts-1600x900.png");
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
