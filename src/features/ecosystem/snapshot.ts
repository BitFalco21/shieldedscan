/**
 * The stage as a PNG, made entirely in the reader's browser: nothing is uploaded, nothing is
 * requested from anywhere but this site's own origin, and nothing is stored.
 *
 * An SVG drawn into a canvas is rendered as an isolated IMAGE, so it sees none of the page's
 * stylesheet, none of its fonts and none of its linked files. A naive export therefore comes
 * out with black shapes, a fallback typeface and blank logos. Three things make it faithful:
 *
 * - every element's COMPUTED paint and type is written onto the copy, so the theme's colours
 *   (which live in CSS custom properties) arrive as plain values;
 * - every `<image>` is re-pointed at a `data:` URL of the same committed icon;
 * - JetBrains Mono is embedded as `@font-face` from the same files the site serves.
 *
 * The canvas used to rasterise is created in memory and never attached to the page — it is an
 * encoder, not a picture on the site, so the one-canvas rule for pictures is untouched.
 */

/** The properties that carry the picture; everything else is left to the SVG defaults. */
const PAINT_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-size",
  "font-weight",
  "letter-spacing",
  "paint-order",
  "visibility",
  "display",
] as const;

export const SNAPSHOT_FONT = "EcoSnap";
export const SNAPSHOT_FONT_FILES = [
  { url: "/fonts/JetBrainsMono-Regular.woff2", weight: 400 },
  { url: "/fonts/JetBrainsMono-Bold.woff2", weight: 700 },
] as const;

/** Copy each source element's computed paint onto its twin in the clone, in document order. */
export function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const src = [source, ...Array.from(source.querySelectorAll("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
  src.forEach((el, i) => {
    const twin = dst[i];
    if (!twin) return;
    const cs = getComputedStyle(el);
    const decl = PAINT_PROPS.map((p) => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${v}` : "";
    })
      .filter(Boolean)
      .join(";");
    if (decl) twin.setAttribute("style", decl);
  });
}

/**
 * Re-point every `<image>` at a `data:` URL and embed the font. `toDataUrl` is injected so the
 * rewrite is testable without a network; it is only ever handed same-origin paths.
 */
export async function embedAssets(
  clone: SVGSVGElement,
  toDataUrl: (path: string) => Promise<string>,
): Promise<void> {
  const images = Array.from(clone.querySelectorAll("image"));
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute("href");
      if (!href || href.startsWith("data:")) return;
      img.setAttribute("href", await toDataUrl(href));
    }),
  );
  const faces = await Promise.all(
    SNAPSHOT_FONT_FILES.map(
      async (f) =>
        `@font-face{font-family:${SNAPSHOT_FONT};font-weight:${f.weight};src:url(${await toDataUrl(f.url)}) format("woff2");}`,
    ),
  );
  const ns = "http://www.w3.org/2000/svg";
  const style = document.createElementNS(ns, "style");
  style.textContent = `${faces.join("")}text,tspan{font-family:${SNAPSHOT_FONT},monospace;}`;
  const defs = document.createElementNS(ns, "defs");
  defs.appendChild(style);
  clone.insertBefore(defs, clone.firstChild);
}

async function fetchDataUrl(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`snapshot: ${path} answered ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface SnapshotOptions {
  fileName: string;
  /** A provenance line printed along the bottom edge, so a shared image says what it is. */
  footer: string;
  /** Elements matching this selector are left out (the hover card, for one). */
  exclude?: string;
}

/** Render the stage's SVG as it is on screen to a PNG and hand it to the reader to save. */
export async function snapshotSvg(svg: SVGSVGElement, opts: SnapshotOptions): Promise<void> {
  const box = svg.getBoundingClientRect();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (width === 0 || height === 0) throw new Error("snapshot: the stage has no size");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  if (opts.exclude) clone.querySelectorAll(opts.exclude).forEach((el) => el.remove());
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  await embedAssets(clone, fetchDataUrl);

  // A `data:` URL, not a `blob:` one: the site's CSP is `img-src 'self' data:`, and loading the
  // SVG as a blob image is refused by it — correctly, so the policy is not widened for this.
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(clone),
  )}`;
  await img.decode();

  const ratio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("snapshot: no 2D context");
  const page = getComputedStyle(document.body);
  ctx.scale(ratio, ratio);
  ctx.fillStyle = page.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  ctx.font = `11px ${page.fontFamily}`;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink-faint");
  ctx.textBaseline = "bottom";
  ctx.fillText(opts.footer, 14, height - 12);

  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("snapshot: encoding failed"))),
      "image/png",
    ),
  );
  const link = document.createElement("a");
  const pngUrl = URL.createObjectURL(png);
  link.href = pngUrl;
  link.download = opts.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
}
