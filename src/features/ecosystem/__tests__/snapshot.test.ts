import { describe, expect, it } from "vitest";
import { SNAPSHOT_FONT, SNAPSHOT_FONT_FILES, embedAssets, inlineComputedStyles } from "../snapshot";

const NS = "http://www.w3.org/2000/svg";

function svgWith(inner: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 10 10">${inner}</svg>`;
  document.body.appendChild(host);
  return host.querySelector("svg")!;
}

describe("snapshot", () => {
  it("re-points every icon at a data URL from our own origin and embeds the font", async () => {
    const svg = svgWith(
      `<image href="/ecosystem/logos/a.png"/><image href="/ecosystem/logos/b.png"/>`,
    );
    const asked: string[] = [];
    await embedAssets(svg, async (path) => {
      asked.push(path);
      return `data:x;base64,${btoa(path)}`;
    });
    const hrefs = Array.from(svg.querySelectorAll("image")).map((i) => i.getAttribute("href"));
    expect(hrefs.every((h) => h?.startsWith("data:"))).toBe(true);
    // Only same-origin paths are ever fetched: the icons and the site's own font files.
    expect(asked.every((p) => p.startsWith("/"))).toBe(true);
    expect(asked).toEqual(
      expect.arrayContaining([...SNAPSHOT_FONT_FILES.map((f) => f.url), "/ecosystem/logos/a.png"]),
    );
    const style = svg.querySelector("defs style")?.textContent ?? "";
    expect(style).toContain(`font-family:${SNAPSHOT_FONT}`);
    expect(style.match(/@font-face/g)).toHaveLength(SNAPSHOT_FONT_FILES.length);
  });

  it("leaves an icon that is already a data URL alone", async () => {
    const svg = svgWith(`<image href="data:image/png;base64,AAAA"/>`);
    const asked: string[] = [];
    await embedAssets(svg, async (p) => {
      asked.push(p);
      return "data:x";
    });
    expect(asked.some((p) => p.startsWith("data:"))).toBe(false);
    expect(svg.querySelector("image")!.getAttribute("href")).toBe("data:image/png;base64,AAAA");
  });

  it("writes computed paint onto the copy, element by element, so theme colours survive", () => {
    const svg = svgWith(`<circle r="3" style="fill: rgb(1, 2, 3)"/>`);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelector("circle")!.removeAttribute("style");
    inlineComputedStyles(svg, clone);
    expect(clone.querySelector("circle")!.getAttribute("style")).toContain("fill:rgb(1, 2, 3)");
  });
});
