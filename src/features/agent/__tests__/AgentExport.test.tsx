import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_EXPORTS_PER_ANSWER, type DataExportCard } from "@/domain";
import { apiBaseUrl } from "@/lib/site";
import { AgentExchange } from "../AgentExchange";
import { AgentExport } from "../AgentExport";
import { askAgent, type AgentStreamEvent } from "../agent-client";
import { newExchange, type Exchange } from "../exchange";
import { exportFlags, exportHref, exportSummary, withExport } from "../export-view";

const CARD: DataExportCard = {
  v: 1,
  dataset: "pool-balances",
  path: "/v1/analytics/pools",
  query: [
    ["from", "2026-01-01"],
    ["to", "2026-11-05"],
    ["interval", "day"],
  ],
  fileName: "shieldedscan_pool-balances_from-2026-01-01_interval-day_to-2026-11-05.csv",
  rows: 308,
  paged: false,
  truncated: false,
  readOnDownload: false,
  columns: [
    { name: "period_start", type: "day" },
    { name: "orchard_zat", type: "zat" },
    { name: "notes_at_close", type: "int" },
    { name: "direction", type: "text" },
  ],
  through: "2026-11-03",
  height: 3_500_000,
  coverage: "complete",
  preview: [
    ["2026-01-01", "439800342005093", "50157099", "shielding"],
    ["2026-01-02", { absent: "shielded" }, { absent: "unmeasured" }, { empty: true }],
    ["2026-01-03", { absent: "nonexistent" }, "50160208", "unshielding"],
  ],
};

describe("AgentExport", () => {
  it("links the file on this site's own API base, the CSV to save and the JSON to read", () => {
    render(<AgentExport card={CARD} />);
    const csv = screen.getByRole("link", { name: /download csv/ });
    expect(csv.getAttribute("href")).toBe(
      `${apiBaseUrl}/v1/analytics/pools?from=2026-01-01&to=2026-11-05&interval=day&format=csv`,
    );
    expect(csv.getAttribute("download")).toBe(CARD.fileName);
    const json = screen.getByRole("link", { name: /open json/ });
    expect(json.getAttribute("href")).toBe(exportHref(CARD, "json"));
    expect(json.getAttribute("target")).toBe("_blank");
    expect(json.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("says what the file is, only from what the API stated", () => {
    render(<AgentExport card={CARD} />);
    expect(screen.getByText(CARD.fileName)).toBeTruthy();
    expect(screen.getByText("308 rows · 4 columns · through 2026-11-03")).toBeTruthy();
    expect(screen.getByText(/period_start, orchard_zat, notes_at_close, direction/)).toBeTruthy();
  });

  it("shows the first rows as the file writes them, and every empty cell as what it means", () => {
    render(<AgentExport card={CARD} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(1 + CARD.preview.length);
    expect(within(rows[1]!).getByText("439800342005093")).toBeTruthy();
    // Encrypted on-chain is the Veil, never a number, never "unavailable".
    expect(within(rows[2]!).getByRole("img", { name: /shielded/ })).toBeTruthy();
    // Our gap is "unavailable", never the Veil.
    expect(within(rows[2]!).getByText("unavailable")).toBeTruthy();
    // The API's own null is blank, carrying no reason.
    expect(within(rows[2]!).getByText("empty").className).toContain("sr-only");
    expect(within(rows[3]!).getByText("nonexistent")).toBeTruthy();
    // The preview scrolls in its own focusable region, so a wide file never widens the page.
    const region = screen.getByRole("region", { name: `First rows of ${CARD.fileName}` });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("says an address history is built on download and shows no preview", () => {
    const address: DataExportCard = {
      ...CARD,
      dataset: "address-transactions-history",
      path: "/v1/addresses/t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf/export",
      query: [],
      fileName: "shieldedscan_address_t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf.csv",
      rows: 812,
      readOnDownload: true,
      through: null,
      height: null,
      coverage: null,
      preview: [],
    };
    render(<AgentExport card={address} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/812 transactions/)).toBeTruthy();
    expect(screen.getByText(/built when you download it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download csv/ }).getAttribute("href")).toBe(
      `${apiBaseUrl}/v1/addresses/t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf/export?format=csv`,
    );
  });

  it("flags a page, a cap and a partial window", () => {
    expect(exportFlags({ ...CARD, paged: true, truncated: true, coverage: "partial" })).toEqual([
      "one page of a longer list; the file links the next",
      "capped by the API: not the whole window",
      "partial — the JSON form says why",
    ]);
    expect(exportFlags(CARD)).toEqual([]);
    expect(exportSummary({ ...CARD, rows: 1, through: null })).toBe(
      "1 row · 4 columns · at block 3,500,000",
    );
  });
});

describe("files in an exchange", () => {
  const exchange = (exports: DataExportCard[]): Exchange => ({
    ...newExchange(1, "orchard as csv", 0),
    answer: "The file holds each day's Orchard balance.",
    status: "complete",
    exports,
  });

  it("renders each file under the answer", () => {
    render(
      <AgentExchange
        exchange={exchange([CARD])}
        live={false}
        editable={false}
        busy={false}
        retryable={false}
        separated={false}
        onEdit={() => {}}
        onAskAgain={() => {}}
      />,
    );
    expect(screen.getByRole("figure", { name: `Data file ${CARD.fileName}` })).toBeTruthy();
  });

  it("keeps one card per call and at most the answer's cap", () => {
    const other = (path: string): DataExportCard => ({ ...CARD, path, query: [] });
    let cards = withExport([], CARD);
    cards = withExport(cards, { ...CARD });
    expect(cards).toHaveLength(1);
    cards = withExport(cards, other("/v1/blocks"));
    cards = withExport(cards, other("/v1/reorgs"));
    expect(cards).toHaveLength(MAX_EXPORTS_PER_ANSWER);
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

const sse = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;

describe("the export event off the wire", () => {
  it("parses a card and keeps the stream going", async () => {
    const events = await read([
      sse("delta", JSON.stringify({ text: "Here." })),
      sse("export", JSON.stringify(CARD)),
      sse("done", JSON.stringify({ stopReason: "complete" })),
    ]);
    expect(events.map((e) => e.event)).toEqual(["delta", "export", "done"]);
    expect(events[1]).toEqual({ event: "export", card: CARD });
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
    ["not JSON", "{oops"],
    ["a host in the path", JSON.stringify({ ...CARD, path: "https://evil.example/x" })],
    ["a javascript path", JSON.stringify({ ...CARD, path: "javascript:alert(1)" })],
    ["a cross-chain path", JSON.stringify({ ...CARD, path: "/v1/crosschain/aggregate" })],
    ["a forged preview", JSON.stringify({ ...CARD, preview: [[1, 2, 3, 4]] })],
    [
      "a 10,000-row preview",
      JSON.stringify({ ...CARD, preview: Array.from({ length: 10_000 }, () => CARD.preview[0]) }),
    ],
  ])("drops %s and still reaches done", async (_name, data) => {
    const events = await read([
      sse("export", data),
      sse("done", JSON.stringify({ stopReason: "complete" })),
    ]);
    expect(events.map((e) => e.event)).toEqual(["done"]);
  });
});
