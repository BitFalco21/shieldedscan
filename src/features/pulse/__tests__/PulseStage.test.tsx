import { act, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseBlock, PulseEvent, PulseFrame } from "@/domain";
import { fixtureDataSource } from "@/data/fixture-source";
import { PULSE_LIVE_KIND } from "@/data/pulse-payload";
import { PulseStage } from "../PulseStage";

/**
 * Frame 0, and what a reader who has asked for no motion gets instead.
 *
 * The static render is what a reader without JavaScript receives and what a CDN caches, so every
 * claim on it must hold with nothing running: the boxes at measured sizes, the real ledger rows,
 * the newest block's movements written out — and no control and no pulse.
 */

const frame = await fixtureDataSource.getPulseFrame();
const ribbons = await fixtureDataSource.getPulseRibbons();
const SERVER_NOW = frame.stocks.timestamp + 30;

const staticMarkup = (f: PulseFrame = frame) =>
  renderToStaticMarkup(<PulseStage frame={f} ribbons={ribbons} serverNow={SERVER_NOW} />);

describe("PulseStage — frame 0", () => {
  it("draws every box, so the picture is a measurement before anything runs", () => {
    const html = staticMarkup();
    for (const key of [
      "transparent",
      "lockbox",
      "mined",
      "ironwood",
      "orchard",
      "sapling",
      "sprout",
    ]) {
      expect(html, key).toContain(`data-box="${key}"`);
    }
  });

  it("lists REAL transparent outputs inside the ledger box", () => {
    const html = staticMarkup();
    const row = frame.ledger[0]!;
    expect(html).toContain(row.address);
    expect(html).toContain(`/tx/${row.txid}`);
  });

  it("writes the newest block's movements into the log", () => {
    const html = staticMarkup();
    expect(html).toContain("latest activity");
    expect(html).toContain("<ol");
  });

  it("carries no control of any kind", () => {
    // The transport mounts only where it can work. A scrubber that does nothing is worse than
    // no scrubber, and a static render is exactly where one would appear.
    const html = staticMarkup();
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("draws no pulse: nothing moved while nobody was watching", () => {
    const html = staticMarkup();
    expect(html).not.toContain("pulse-core");
    expect(html).not.toContain("pulse-still");
    // The two layers the engine owns exist and are empty; no mark of any kind is inside them.
    expect(html).not.toContain('class="pulse-pending"');
    expect(html).toMatch(/class="pulse-pending-layer"[^>]*><\/g>/);
    expect(html).toMatch(/class="pulse-layer"[^>]*><\/g>/);
  });

  it("mounts an EMPTY polite region, so the first announcement is heard", () => {
    // A live region has to exist before its content changes; one that appears with its text
    // is frequently not announced at all.
    const html = staticMarkup();
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"[^>]*><\/span>/);
  });

  it("spends the Veil on exactly the movements whose amount is encrypted", () => {
    // `.redact` means encrypted on-chain and nothing else. A movement with no amount in this
    // view, or a read of ours that failed, must never borrow it.
    const html = staticMarkup();
    const newest = frame.blocks.at(-1)!;
    const veils = newest.events.slice(0, 9).filter((e) => e.shape === "veil").length;
    expect((html.match(/class="redact"/g) ?? []).length).toBe(veils);
  });

  it("says nothing about the mempool before anything has asked our node", () => {
    // "unavailable" is a claim about a read that failed. The server does not read the mempool
    // at all, so frame 0 has nothing to report and reports nothing.
    expect(staticMarkup()).not.toContain("mempool");
  });

  it("scrolls the stage to the pools on a narrow screen, after mount", () => {
    // jsdom lays nothing out, so the widths are stubbed: what is pinned is that the effect
    // measures the overflow and anchors to it. Without the stub every assertion is 0 === 0 and
    // the test cannot fail.
    const widths = { scrollWidth: 860, clientWidth: 320 };
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(widths.scrollWidth);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(widths.clientWidth);
    try {
      const { container } = render(
        <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
      );
      const stage = container.querySelector(".pulse-stage") as HTMLElement;
      expect(stage).toBeTruthy();
      expect(stage.scrollLeft).toBe(widths.scrollWidth - widths.clientWidth);
      expect(container.textContent).toContain("scroll for the ledger and the chains");
    } finally {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });

  it("never fuses a conditional class onto the one before it", () => {
    // Prettier's Tailwind plugin trims the leading space inside a conditional class literal, so
    // `pulse-ribbon${cond ? " is-floored" : ""}` would ship as `pulse-ribbonis-floored`,
    // matching no rule — and an SVG path without `fill: none` then paints the chord under its
    // curve solid black.
    const html = staticMarkup();
    for (const match of html.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) {
        expect(token, `fused class token: ${token}`).not.toMatch(
          /.+is-(floored|venue|absent|glass|sealed|unavailable|still|hot|hollow)/,
        );
      }
    }
  });

  it("states both rulers in the diagram's <desc>, not as page text and not as a tooltip", () => {
    const html = staticMarkup();
    const title = html.match(/<svg[^>]*class="pulse-stage-svg"[^>]*><desc>([^<]*)<\/desc>/)?.[1];
    expect(title).toBeDefined();
    expect(title).toContain("per 10 px²");
    expect(title).toContain(`at block ${frame.stocks.height.toLocaleString("en-US")}`);
    expect(title).toContain("completed only");
    // The ruler row is not part of the page's visible text.
    expect(html).not.toMatch(/▪|▬/);
  });
});

/* ------------------------------------------------------------------------------------- */

const ZEC = 100_000_000;

function crossing(id: string, at: number): PulseEvent {
  return {
    id,
    kind: "swap",
    shape: "path",
    at,
    // No block has recorded it: a venue saying a crossing completed is not the chain saying
    // which block carried it.
    height: null,
    blockHash: null,
    legs: [{ from: "chain:BTC", to: "transparent", amountZat: 9 * ZEC }],
    subsidyZat: null,
    venue: "maya",
    counterpartChain: "BTC",
  };
}

function movedBlock(source: PulseBlock, height: number, hash: string): PulseBlock {
  const event: PulseEvent = {
    id: `tx-${hash}`,
    kind: "tx",
    shape: "path",
    at: source.pools.timestamp + 75,
    height,
    blockHash: hash,
    legs: [{ from: "transparent", to: "orchard", amountZat: 12 * ZEC }],
    subsidyZat: null,
  };
  return {
    pools: { ...source.pools, height, hash, prevHash: source.pools.hash },
    events: [event],
    eventCount: 1,
    intervalSeconds: 75,
  };
}

const ok = (payload: unknown) => ({ ok: true, json: async () => payload }) as unknown as Response;

describe("PulseStage — a reader who asked for no motion", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("places a static mark at the destination with a count, and nothing travels", async () => {
    const newest = frame.blocks.at(-1)!;
    const arrived = movedBlock(newest, newest.pools.height + 1, "f".repeat(64));
    const second: PulseFrame = {
      ...frame,
      blocks: [...frame.blocks, arrived],
      stocks: arrived.pools,
    };
    fetchMock
      .mockResolvedValueOnce(ok({ kind: PULSE_LIVE_KIND, frame, pending: null }))
      .mockResolvedValue(ok({ kind: PULSE_LIVE_KIND, frame: second, pending: null }));

    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      // Two polls: the first is a baseline and draws nothing, the second carries the arrival.
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(container.querySelector(".is-still")).not.toBeNull();
    expect(container.querySelectorAll(".pulse-still").length).toBeGreaterThan(0);
    // Nothing in flight: a mark that travels under reduced motion is exactly what was asked
    // not to happen.
    expect(container.querySelectorAll(".pulse-core").length).toBe(0);
    expect(container.querySelector(".pulse-counter")?.textContent).toBe("+1");
  });

  it("draws nothing at all for the first accepted poll", async () => {
    const newest = frame.blocks.at(-1)!;
    const arrived = movedBlock(newest, newest.pools.height + 1, "e".repeat(64));
    fetchMock.mockResolvedValue(
      ok({
        kind: PULSE_LIVE_KIND,
        frame: { ...frame, blocks: [...frame.blocks, arrived], stocks: arrived.pools },
        pending: null,
      }),
    );
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    // The poll reconciles against a prerendered, CDN-cached page: "absent from that HTML" is
    // not "arrived while you were watching".
    expect(container.querySelectorAll(".pulse-still").length).toBe(0);
  });

  it("draws a crossing no block recorded — hollow, and lighting nothing", async () => {
    // An unpaired crossing must reach the engine and be drawn.
    const arrived = crossing("swap:btc-1", frame.stocks.timestamp);
    fetchMock
      .mockResolvedValueOnce(ok({ kind: PULSE_LIVE_KIND, frame, pending: null }))
      .mockResolvedValue(
        ok({ kind: PULSE_LIVE_KIND, frame: { ...frame, swaps: [arrived] }, pending: null }),
      );
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    const marks = [...container.querySelectorAll(".pulse-still")];
    const drawn = marks.find((m) =>
      m.closest("g")?.querySelector("title")?.textContent?.includes("BTC"),
    );
    expect(drawn, "no mark was drawn for the crossing").toBeTruthy();
    expect(drawn!.getAttribute("class")).toContain("is-hollow");
    // It lights no box: the chain has not said which block carried it.
    expect(container.querySelector(".is-lit")).toBeNull();
    // The log row names the venue and stops; the floor caveat stays on the mark's title.
    const log = container.querySelector("ol")?.textContent ?? "";
    expect(log).toContain("no block has recorded it");
    expect(log).not.toContain("a floor");
  });

  it("says how much of a capped block it drew, rather than passing a slice off as the whole", async () => {
    const newest = frame.blocks.at(-1)!;
    const capped: PulseBlock = {
      ...movedBlock(newest, newest.pools.height + 1, "d".repeat(64)),
      eventCount: 2_450,
      truncated: true,
    };
    fetchMock
      .mockResolvedValueOnce(ok({ kind: PULSE_LIVE_KIND, frame, pending: null }))
      .mockResolvedValue(
        ok({
          kind: PULSE_LIVE_KIND,
          frame: { ...frame, blocks: [...frame.blocks, capped], stocks: capped.pools },
          pending: null,
        }),
      );
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    // The count is the fact and the marks are a window onto it.
    expect(container.textContent).toContain("1 of 2,450 drawn");
  });

  it("clears everything and says so when the chain contradicts what it drew", async () => {
    const newest = frame.blocks.at(-1)!;
    const reorged: PulseFrame = {
      ...frame,
      stocks: { ...newest.pools, hash: "c".repeat(64) },
    };
    fetchMock
      .mockResolvedValueOnce(ok({ kind: PULSE_LIVE_KIND, frame, pending: null }))
      .mockResolvedValue(ok({ kind: PULSE_LIVE_KIND, frame: reorged, pending: null }));
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(container.textContent).toContain("reorganised — reload");
    // The balances were measured at a height that no longer exists.
    expect(container.querySelector("[data-box]")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });
});

describe("PulseStage — the mempool's two exits", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("FADES a pending mark our node stopped offering, rather than vanishing it", async () => {
    // A mark removed in the same statement that retitled it `left mempool · not confirmed`
    // never put that sentence on screen, and one that disappears between two frames reads
    // exactly like one that was confirmed — the single distinction the two exits exist to draw.
    const pendingEvent: PulseEvent = {
      id: "tx-pending",
      kind: "tx",
      shape: "path",
      at: frame.stocks.timestamp,
      height: null,
      blockHash: null,
      legs: [{ from: "transparent", to: "orchard", amountZat: 4 * ZEC }],
      subsidyZat: null,
      pending: true,
    };
    fetchMock
      .mockResolvedValueOnce(
        ok({
          kind: PULSE_LIVE_KIND,
          frame,
          pending: { events: [pendingEvent], count: 1 },
        }),
      )
      .mockResolvedValue(ok({ kind: PULSE_LIVE_KIND, frame, pending: { events: [], count: 0 } }));

    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(container.querySelectorAll(".pulse-pending").length).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    const fading = container.querySelector(".pulse-pending-group.is-fading");
    expect(fading, "the mark vanished instead of fading").toBeTruthy();
    expect(fading!.querySelector("title")?.textContent).toContain("left mempool · not confirmed");
  });
});

/**
 * The hour's own outputs, drawn as the replay reaches the blocks that carried them.
 *
 * Four states say four different things: rows, an hour whose clock has reached none of them, an
 * instant no block covers, and an API that does not send them.
 *
 * Two hours, deliberately different: the hook keeps two hours ahead loaded and prunes none, so
 * identical hours could not tell a per-hour cap from an OR across the session.
 */
describe("PulseStage — the ledger box in replay", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const anchor = frame.stocks.receivedAt ?? frame.stocks.timestamp;
  const hourOf = (seconds: number) => Math.floor(seconds / 3_600) * 3_600;
  /** Two whole hours entirely in the past, so both are fetchable and neither is the tip's. */
  const HOUR_A = hourOf(anchor) - 2 * 3_600;
  const HOUR_B = hourOf(anchor) - 3_600;

  /** HOUR_A: a block with no outputs, then one with a single row. Nothing was cut. */
  const QUIET_AT = HOUR_A + 600;
  const OLD_AT = HOUR_A + 1_800;
  /** HOUR_B: one block, two rows, and the hour says it handed over a window. */
  const NEW_AT = HOUR_B + 600;

  const QUIET_HEIGHT = frame.stocks.height + 1;
  const OLD_HEIGHT = frame.stocks.height + 2;
  const NEW_HEIGHT = frame.stocks.height + 3;

  const hourBlock = (height: number, at: number): PulseBlock => ({
    pools: {
      ...frame.stocks,
      height,
      hash: String(height).padEnd(64, "c"),
      prevHash: frame.stocks.hash,
      timestamp: at,
      receivedAt: at,
    },
    events: [],
    eventCount: 0,
    intervalSeconds: 75,
  });

  const row = (height: number, address: string) => ({
    txid: String(height).padEnd(64, "a"),
    height,
    blockHash: String(height).padEnd(64, "c"),
    address,
    valueZat: 3 * ZEC,
  });

  const OLD_ROW = row(OLD_HEIGHT, "t1OldOutputAddressHereForTheReplayTest");
  const NEW_ROW_1 = row(NEW_HEIGHT, "t1NewOutputAddressOneForTheReplayTest");
  const NEW_ROW_2 = row(NEW_HEIGHT, "t1NewOutputAddressTwoForTheReplayTest");

  /** The two hours, and what each of them says about its own cap. */
  const HOURS: Record<
    number,
    { blocks: PulseBlock[]; ledger: ReturnType<typeof row>[]; truncated: boolean }
  > = {
    [HOUR_A]: {
      blocks: [hourBlock(QUIET_HEIGHT, QUIET_AT), hourBlock(OLD_HEIGHT, OLD_AT)],
      ledger: [OLD_ROW],
      truncated: false,
    },
    [HOUR_B]: {
      blocks: [hourBlock(NEW_HEIGHT, NEW_AT)],
      ledger: [NEW_ROW_2, NEW_ROW_1],
      truncated: true,
    },
  };

  /** `carries: false` is the older API: no `ledger` key at all, on any hour. */
  const route = (carries = true) =>
    vi.fn(async (url: string) => {
      const text = String(url);
      if (!text.includes("/api/pulse/window")) {
        return ok({ kind: PULSE_LIVE_KIND, frame, pending: null });
      }
      const from = Number(new URL(text, "http://x").searchParams.get("from"));
      const hour = HOURS[from];
      return ok({
        applied: { fromSeconds: from, toSeconds: from + 3_600 },
        blocks: hour?.blocks ?? [],
        swaps: [],
        ...(carries
          ? {
              ledger: hour?.ledger ?? [],
              ...(hour?.truncated === true ? { ledgerTruncated: true } : {}),
            }
          : {}),
      });
    });

  const buttonIn = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

  /** Enter replay over six hours with the clock stopped, then put it at the instant `at`. */
  const scrubTo = async (container: HTMLElement, at: number) => {
    if (buttonIn(container, "◂ replay")?.getAttribute("aria-pressed") !== "true") {
      await act(async () => {
        buttonIn(container, "◂ replay")!.click();
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        // Six hours, so both fixture hours are inside the scrubber's reach.
        buttonIn(container, "6 h")!.click();
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        buttonIn(container, "pause")!.click();
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    const scrub = container.querySelector<HTMLInputElement>("input.pulse-scrub")!;
    await act(async () => {
      fireEvent.change(scrub, { target: { value: String(21_600 - (anchor - at)) } });
      await vi.advanceTimersByTimeAsync(50);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a row only once the replay has reached ITS block", async () => {
    // Bounded by the height the boxes are reading, not by the clock in seconds, so a row and
    // the balances beside it come from one block. The whole hour arriving at once would state
    // that every output in it had already happened.
    fetchMock.mockImplementation(route());
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await scrubTo(container, OLD_AT);
    expect(container.innerHTML).toContain(OLD_ROW.address);
    expect(container.innerHTML).not.toContain(NEW_ROW_1.address);

    await scrubTo(container, NEW_AT);
    expect(container.innerHTML).toContain(NEW_ROW_1.address);
    expect(container.innerHTML).toContain(OLD_ROW.address);
  });

  it("says the rows are LIVE ONLY when the API carries none — never that the hour was empty", async () => {
    // An API predating the field sends no key at all, and reading that as an hour with no
    // outputs would state that no transparent value moved in it.
    fetchMock.mockImplementation(route(false));
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await scrubTo(container, OLD_AT);
    expect(container.textContent).toContain("newest outputs are shown live only");
    expect(container.textContent).not.toContain("no transparent outputs yet");
  });

  it("says NONE YET where the hour carries rows and the clock has reached none of them", async () => {
    fetchMock.mockImplementation(route());
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    // A block IS read here — so the boxes are measured — and it carried no transparent output.
    await scrubTo(container, QUIET_AT);
    expect(container.textContent).toContain("no transparent outputs yet in this replay");
    expect(container.textContent).not.toContain("newest outputs are shown live only");
  });

  it("says NOTHING about outputs at an instant no block covers", async () => {
    // Unmeasured is not "none": a sentence about outputs here would report our unread hour as
    // the chain having moved no transparent value.
    //
    // Every box is also absent at an unmeasured instant, and an absent box draws no note, so
    // this assertion alone would pass if the note were computed as "none". The box's own state
    // is asserted beside it so the test fails rather than silently stops checking if that
    // changes. The conflation itself is removed in `replayLedger`, which returns `undefined`
    // rather than `[]`.
    fetchMock.mockImplementation(route());
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await scrubTo(container, HOUR_A - 60);
    expect(container.querySelector('[data-box="transparent"]')?.getAttribute("class")).toContain(
      "is-absent",
    );
    expect(container.textContent).not.toContain("no transparent outputs yet");
    expect(container.textContent).not.toContain("newest outputs are shown live only");
  });

  it("states the cap of the hour ON SCREEN, never an OR across every hour loaded", async () => {
    // The two hours differ on purpose: HOUR_A handed over everything it had, HOUR_B did not.
    // The hook keeps both loaded, so a session-wide flag would put "this hour holds more" over
    // HOUR_A, with a count belonging to no hour at all.
    fetchMock.mockImplementation(route());
    const { container } = render(
      <PulseStage frame={frame} ribbons={ribbons} serverNow={SERVER_NOW} />,
    );
    await scrubTo(container, OLD_AT);
    expect(container.textContent).not.toContain("this hour holds more");

    await scrubTo(container, NEW_AT);
    expect(container.textContent).toContain("2 outputs carried · this hour holds more");
  });
});
