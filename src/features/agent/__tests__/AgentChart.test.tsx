import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PLOTTABLE_SERIES, type PlottedChart } from "@/domain";
import { CHARTS } from "@/features/charts/catalog";
import { UNRANGED } from "@/features/charts/chart-table";
import { AgentChart } from "../AgentChart";
import { AgentExchange } from "../AgentExchange";
import { askAgent, historyFor, type AgentStreamEvent } from "../agent-client";
import { chartLinks, seriesInks } from "../chart-view";
import { newExchange, type Exchange } from "../exchange";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const ZEC = 100_000_000;

const CHART: PlottedChart = {
  v: 1,
  type: "line",
  scale: "linear",
  grain: "week",
  timestamps: [day("2026-07-06"), day("2026-07-13"), day("2026-07-20"), day("2026-07-27")],
  series: [
    { id: "ironwood-balance", values: [null, null, null, 836_130 * ZEC], floors: [] },
    {
      id: "orchard-balance",
      values: [3_766_654 * ZEC, 3_769_149 * ZEC, 3_769_552 * ZEC, 2_922_536 * ZEC],
      floors: [],
    },
  ],
  partialLast: false,
  reachesPresent: true,
  range: null,
};

describe("AgentChart", () => {
  it("names the chart by exactly what it plots, and says so beneath it", () => {
    render(<AgentChart chart={CHART} />);
    const caption = "Ironwood balance, Orchard balance · since 2026-07-06 · weekly · line";
    expect(screen.getByRole("img", { name: caption })).toBeTruthy();
    expect(screen.getByText(`Plotted: ${caption}`, { exact: false })).toBeTruthy();
  });

  it("states every plotted value in a table, closed until asked for", () => {
    render(<AgentChart chart={CHART} />);
    const toggle = screen.getByRole("button", { name: "show table" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // A header and one row per period.
    expect(rows).toHaveLength(5);
    expect(rows[4]!.textContent).toContain("Week of 2026-07-27");
    expect(rows[4]!.textContent).toContain("836,130.00 ZEC");
    expect(rows[4]!.textContent).toContain("2,922,536.00 ZEC");
    // Before Ironwood existed: absent, as in the readout; never a zero, and never "—", which
    // means a reading we failed to take.
    expect(rows[1]!.textContent).toContain("not yet active");
    expect(rows[1]!.textContent).not.toContain("—");
  });

  it("starts the table where the first plotted pool exists, so it opens on data", () => {
    render(
      <AgentChart
        chart={{
          ...CHART,
          series: [{ id: "ironwood-balance", values: [null, null, 1 * ZEC, 2 * ZEC], floors: [] }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "show table" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // A header and the two periods Ironwood existed in.
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("Week of 2026-07-20");
  });

  it("holds the table in a bounded, keyboard-scrollable region named by the chart", () => {
    render(<AgentChart chart={CHART} />);
    fireEvent.click(screen.getByRole("button", { name: "show table" }));
    const caption = "Ironwood balance, Orchard balance · since 2026-07-06 · weekly · line";
    const region = screen.getByRole("region", { name: caption });
    // Focusable, so arrow keys and Page Down scroll it; capped, so it never pushes the chat away.
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("max-h-");
    expect(region.className).toContain("overflow-auto");
    expect(within(region).getByRole("table")).toBeTruthy();
  });

  it("marks a floor in the table and names it beneath the chart", () => {
    const fees: PlottedChart = {
      ...CHART,
      series: [{ id: "fees-paid", values: [1, 2, 3, 4].map((v) => v * ZEC), floors: [2] }],
    };
    render(<AgentChart chart={fees} />);
    expect(screen.getByText(/1 period is a floor/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "show table" }));
    expect(screen.getAllByRole("row")[3]!.textContent).toContain("≥ 3.00 ZEC");
  });

  it("links each series' /charts page in a new tab, with nothing from the conversation in it", () => {
    render(<AgentChart chart={{ ...CHART, range: "90d" }} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      // Ironwood's page has no range control, so no range is sent to it.
      "/charts/ironwood-balance",
      "/charts/pool-balances?range=90d",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("draws an area chart and a log axis when asked", () => {
    const { container: area } = render(<AgentChart chart={{ ...CHART, type: "area" }} />);
    expect(area.querySelectorAll("path[stroke='none']").length).toBeGreaterThan(0);
    const { container: log } = render(<AgentChart chart={{ ...CHART, scale: "log" }} />);
    // Decade ticks: every y label on a log axis is a power of ten.
    const ticks = [...log.querySelectorAll("text.chart-tick")].map((t) => t.textContent);
    expect(ticks.some((t) => t === "1M ZEC")).toBe(true);
  });
});

describe("the chart catalogue as the console reads it", () => {
  it("links only pages that exist", () => {
    const slugs = new Set(CHARTS.map((c) => c.slug));
    for (const s of PLOTTABLE_SERIES) {
      if (s.chartSlug !== null) expect(slugs.has(s.chartSlug as never), s.id).toBe(true);
    }
  });

  it("never sends a range to a page that ignores one", () => {
    const chart = { ...CHART, range: "30d" as const };
    for (const link of chartLinks(chart)) {
      const slug = link.href.replace(/^\/charts\/|\?.*$/g, "");
      if ((UNRANGED as ReadonlySet<string>).has(slug)) expect(link.href).not.toContain("?");
    }
  });

  it("gives every series on one chart its own ink", () => {
    for (const axis of new Set(PLOTTABLE_SERIES.map((s) => s.axis))) {
      const group = PLOTTABLE_SERIES.filter((s) => s.axis === axis);
      for (let i = 0; i + 3 <= group.length; i++) {
        const inks = seriesInks(group.slice(i, i + 3));
        expect(new Set(inks).size, axis).toBe(inks.length);
      }
    }
  });
});

describe("a chart in a conversation", () => {
  function answered(charts: PlottedChart[]): Exchange {
    return {
      ...newExchange(1, "how did Orchard drain since July?", 1_000),
      answer: "Orchard drained into Ironwood after 2026-07-28.",
      charts,
      steps: [],
      status: "complete",
    };
  }

  const props = {
    live: false,
    editable: true,
    busy: false,
    retryable: false,
    separated: false,
    onEdit: () => {},
    onAskAgain: () => {},
  };

  it("draws under the answer that describes it", () => {
    render(<AgentExchange exchange={answered([CHART])} {...props} />);
    expect(screen.getByRole("img", { name: /Ironwood balance, Orchard balance/ })).toBeTruthy();
  });

  it("is never replayed as history: only the answer's words are", () => {
    const history = historyFor([answered([CHART])], "and Sapling?");
    expect(JSON.stringify(history)).not.toMatch(/ironwood-balance|timestamps|836130/);
  });
});

/** The SSE reader, driven through `askAgent` as the other client tests drive it. */
async function read(chunks: readonly string[]): Promise<AgentStreamEvent[]> {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    )) as unknown as typeof globalThis.fetch;
  try {
    const events: AgentStreamEvent[] = [];
    for await (const e of askAgent(
      "https://api.example/agent/ask",
      [{ role: "user", content: "q" }],
      new AbortController().signal,
    )) {
      events.push(e);
    }
    return events;
  } finally {
    globalThis.fetch = original;
  }
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("reading a chart off the stream", () => {
  it("carries a chart through as its own event", async () => {
    expect(await read([sse("chart", CHART)])).toEqual([{ event: "chart", chart: CHART }]);
  });

  it("drops a chart it does not understand rather than drawing part of one", async () => {
    const bad = { ...CHART, series: [{ id: "made-up", values: [1, 2, 3, 4], floors: [] }] };
    expect(await read([sse("chart", bad)])).toEqual([]);
  });
});
