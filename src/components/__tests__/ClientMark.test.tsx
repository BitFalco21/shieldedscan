import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientMark } from "../ClientMark";
import { ZcashdMark } from "../ZcashdMark";
import { ZCASHD_BADGE_BYTES, ZCASHD_BADGE_DATA_URI } from "../zcashd-badge.generated";
import { ZebraMark } from "../ZebraMark";
import { ZEBRA_BADGE_BYTES, ZEBRA_BADGE_DATA_URI } from "../zebra-badge.generated";
import { NET_KNOWN_CLIENTS } from "@/domain";

/**
 * The three client marks and their dispatcher. What is pinned is the marks RULE rather than
 * the drawing: colour through classes and never attributes or styles, no shared `id`, and a
 * client this site does not know rendered in neutral ink rather than a guessed brand colour.
 */
describe("ClientMark", () => {
  it("draws a real mark for each known client and a neutral dot for the rest", () => {
    for (const client of NET_KNOWN_CLIENTS) {
      const html = renderToStaticMarkup(<ClientMark client={client} />);
      expect(html).not.toContain("data-client=");
    }
    expect(renderToStaticMarkup(<ClientMark client="Unidentified" />)).toContain(
      'data-client="unidentified"',
    );
    expect(renderToStaticMarkup(<ClientMark client="SomeNewNode" />)).toContain(
      'data-client="other"',
    );
  });

  it("is decorative: every mark is aria-hidden and carries no id, style or fill colour", () => {
    for (const client of [...NET_KNOWN_CLIENTS, "Unidentified"]) {
      const html = renderToStaticMarkup(<ClientMark client={client} size={24} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/\sid=/);
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/fill="#/);
    }
  });

  it("takes its size from the prop", () => {
    const { container } = render(<ClientMark client="Zakura" size={34} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("34");
  });
});

describe("ZcashdMark", () => {
  it("ships zcashd's own terminal logo as a small inline data: URI, never a request", () => {
    expect(ZCASHD_BADGE_DATA_URI.startsWith("data:image/png;base64,")).toBe(true);
    expect(ZCASHD_BADGE_BYTES).toBeLessThanOrEqual(6144);
    const html = renderToStaticMarkup(<ZcashdMark size={14} />);
    expect(html).toContain(`src="${ZCASHD_BADGE_DATA_URI}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('width="14"');
  });
});

describe("ZebraMark", () => {
  it("ships the Foundation's badge as a small inline data: URI, never a request", () => {
    expect(ZEBRA_BADGE_DATA_URI.startsWith("data:image/png;base64,")).toBe(true);
    expect(ZEBRA_BADGE_BYTES).toBeLessThanOrEqual(4096);
    const html = renderToStaticMarkup(<ZebraMark size={18} />);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="18"');
  });
});
