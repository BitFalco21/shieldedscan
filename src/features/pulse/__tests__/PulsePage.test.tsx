import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PulsePage } from "../PulsePage";
import { fixtureDataSource } from "@/data/fixture-source";

/**
 * The server shell: the ruler reads the height off the frame's own row rather than a tip from
 * another call, and `ribbons === null` is a real state that says so.
 *
 * Rendered to static markup rather than jsdom, because that is what a reader without JavaScript
 * receives.
 */

const frame = await fixtureDataSource.getPulseFrame();
const ribbons = await fixtureDataSource.getPulseRibbons();

describe("PulsePage", () => {
  it("prints the height its own frame was read at, beside the boxes it measured", () => {
    const html = renderToStaticMarkup(<PulsePage frame={frame} ribbons={ribbons} />);
    expect(html).toContain(`at block ${frame.stocks.height.toLocaleString("en-US")}`);
  });

  it("says the flow totals are unavailable rather than drawing none", () => {
    // Drawing no ribbons would claim that nothing has ever crossed a boundary in Zcash's
    // history. An unfilled day view is our gap and the page names it as one.
    const html = renderToStaticMarkup(<PulsePage frame={frame} ribbons={null} />);
    expect(html).toContain("unavailable · widths are placeholders");
    // The exact class token. `toContain("is-unavailable")` also matches
    // `text-ink-faintis-unavailable`, which is the Tailwind-formatter trap and matches no rule.
    expect(html).toMatch(/class="[^"]*\bis-unavailable\b[^"]*"/);
  });

  it("says nothing about availability when the totals are there", () => {
    const html = renderToStaticMarkup(<PulsePage frame={frame} ribbons={ribbons} />);
    expect(html).not.toMatch(/\bis-unavailable\b/);
  });

  it("anchors the ledger panel to the height it was read at", () => {
    // The panel is server-rendered while the stage in front of it follows the live feed, so
    // without the height it drifts behind the boxes above it with nothing to say so.
    const html = renderToStaticMarkup(<PulsePage frame={frame} ribbons={ribbons} />);
    expect(html).toMatch(
      new RegExp(
        `newest outputs · at block ${frame.stocks.height.toLocaleString("en-US")}`.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ),
      ),
    );
  });

  it("gives the ledger rows their copy controls, which the stage itself cannot carry", () => {
    // The copy control copies the whole address. It lives in a server-rendered panel beside the
    // stage, because an SVG cell cannot hold a button and a control in a static stage render
    // could not work.
    const html = renderToStaticMarkup(<PulsePage frame={frame} ribbons={ribbons} />);
    expect(html).toContain("Copy address");
    expect(html).toContain(frame.ledger[0]!.address);
  });
});
