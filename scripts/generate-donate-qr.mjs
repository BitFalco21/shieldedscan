/**
 * Generates public/donate-qr.svg from DONATION_URI — and refuses to write it until the
 * result has been decoded back and compared, character for character, against the source.
 *
 * A donation QR with a transcription error is money sent into the void, silently: the QR
 * would scan fine, a wallet would pay fine, and nothing anywhere would look broken. So the
 * asset is generated from the same constant the page renders (parsed out of
 * src/lib/donation.ts, never retyped), rasterised, decoded with an independent decoder
 * (jsQR — not the library that encoded it), and diffed against the input. Only then is the
 * SVG written.
 *
 * One-off tooling, not a dependency: qrcode/jsqr/pngjs live in a scratch node_modules and
 * the repo commits only the SVG. Re-run if the address ever changes:
 *
 *   cd <scratch dir> && npm i qrcode jsqr pngjs
 *   NODE_PATH=<scratch dir>/node_modules node scripts/generate-donate-qr.mjs
 *
 * Medium error correction: the QR sits flat on a white panel on a screen — it is not a
 * poster that weathers. M keeps the module count down on a 185-char payload, which is what
 * keeps it scannable at 220 CSS pixels.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(
  process.env.NODE_PATH ? `${process.env.NODE_PATH}/` : import.meta.url,
);
const QRCode = require("qrcode");
const jsQR = require("jsqr").default ?? require("jsqr");
const { PNG } = require("pngjs");

// The one source of truth, parsed rather than retyped.
const source = readFileSync("src/lib/donation.ts", "utf8");
const address = source.match(/"(u1[a-z0-9]+)"/)?.[1];
if (!address) throw new Error("could not parse DONATION_ADDRESS out of src/lib/donation.ts");
const uri = `zcash:${address}`;

// Encode once as a PNG purely to verify, with an independent decoder.
const png = await QRCode.toBuffer(uri, {
  type: "png",
  errorCorrectionLevel: "M",
  margin: 4,
  scale: 4,
});
const image = PNG.sync.read(png);
const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
if (!decoded) throw new Error("generated QR did not decode at all");
if (decoded.data !== uri) {
  throw new Error(`QR round-trip mismatch:\n  encoded: ${uri}\n  decoded: ${decoded.data}`);
}

// Only now the real asset. margin 4 is the spec's quiet zone; colours are fixed
// black-on-white because a scanner needs that contrast regardless of the site's theme.
const svg = await QRCode.toString(uri, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 4,
  color: { dark: "#000000", light: "#ffffff" },
});
writeFileSync("public/donate-qr.svg", svg);
console.log(`verified round-trip (${decoded.data.length} chars) and wrote public/donate-qr.svg`);
