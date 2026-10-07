import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AnswerMarkdown } from "../AnswerMarkdown";

/**
 * The answer renderer, and especially the table: a model's pipe table must render as a table,
 * not be joined into one line like a paragraph.
 *
 * The safety property is asserted too: the renderer emits no element type it does not implement,
 * and a table adds only inert ones.
 */

const TABLE = [
  "Daily activity:",
  "",
  "| Day | Transparent | Total txs |",
  "|-----|------------|-----------|",
  "| Aug 8 | 1,478 | 3,619 |",
  "| Aug 9 | 1,681 | 3,973 |",
].join("\n");

describe("a pipe table", () => {
  /*
   * A narrow table must not be stretched to the pane (`w-full`), which pushes two columns to
   * opposite edges. Asserted as a class rather than geometry, a stated limitation: jsdom reports
   * every box as zero.
   */
  it("is sized by its content, not stretched to the pane", () => {
    render(<AnswerMarkdown text={TABLE} />);
    const table = screen.getByRole("table");
    expect(table.className).toContain("w-auto");
    expect(table.className).not.toContain("w-full");
  });

  it("renders as a table rather than a run of text", () => {
    render(<AnswerMarkdown text={TABLE} />);
    const table = screen.getByRole("table");
    // The header is a header, so a screen reader can associate the cells with it.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Day", "Transparent", "Total txs"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    // …and the delimiter row is structure, never a row of data.
    expect(table.textContent).not.toContain("---");
  });

  it("keeps the prose around it as prose", () => {
    render(<AnswerMarkdown text={TABLE} />);
    expect(screen.getByText("Daily activity:")).toBeTruthy();
  });

  it("right-aligns a column only when every body cell in it is a number", () => {
    render(<AnswerMarkdown text={TABLE} />);
    const rows = screen.getAllByRole("row");
    const cells = within(rows[1]!).getAllByRole("cell");
    // "Aug 8" is not a number, so its column stays left.
    expect(cells[0]!.className).toContain("text-left");
    // A column of figures is unreadable ragged-left, and the site's own tables use tabular-nums.
    expect(cells[1]!.className).toContain("text-right");
    expect(cells[1]!.className).toContain("tabular-nums");
  });

  it("leaves a column alone when one cell in it is not a number", () => {
    // The mixed column is the one a reader is scanning for the odd value, so a per-cell rule
    // would ragged-align exactly the row that matters.
    render(
      <AnswerMarkdown
        text={[
          "| Pool | Balance |",
          "|---|---|",
          "| Orchard | 1,200 |",
          "| Sprout | unknown |",
        ].join("\n")}
      />,
    );
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[1]!.className).toContain("text-left");
  });

  it("honours the markdown's own alignment over the guess", () => {
    render(<AnswerMarkdown text={["| A | B |", "|---:|---|", "| foo | bar |"].join("\n")} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[0]!.className).toContain("text-right");
  });

  it("pads a short row rather than shifting the columns left", () => {
    // A malformed row that shifted its cells would file a figure under the wrong heading — a
    // wrong number with no sign of it.
    render(<AnswerMarkdown text={["| A | B | C |", "|---|---|---|", "| 1 | 2 |"].join("\n")} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(cells[2]!.textContent).toBe("");
  });

  it("needs a delimiter row, so an ordinary sentence with a pipe stays prose", () => {
    render(<AnswerMarkdown text="Use the | operator to pipe output." />);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("scrolls inside its own container, so a wide table cannot scroll the page", () => {
    const { container } = render(<AnswerMarkdown text={TABLE} />);
    const wrapper = container.querySelector("div.overflow-x-auto");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("table")).not.toBeNull();
  });
});

describe("the safety property a table must not weaken", () => {
  it("renders markup inside a cell as text, never as an element", () => {
    render(
      <AnswerMarkdown
        text={[
          "| Chain | Note |",
          "|---|---|",
          "| BTC | <img src=x onerror=alert(1)> |",
          "| ETH | ![px](https://evil.example/p) |",
        ].join("\n")}
      />,
    );
    const table = screen.getByRole("table");
    expect(table.querySelector("img")).toBeNull();
    expect(table.querySelector("script")).toBeNull();
    // The text survives — the renderer neutralises markup by never implementing it, not by
    // deleting the reader's view of what the payload said.
    expect(table.textContent).toContain("onerror");
  });

  it("drops a non-allowlisted link inside a cell to its label", () => {
    // Two columns, because a one-column delimiter row is deliberately not a table: requiring at
    // least two cells is what stops a prose line containing a pipe and a dash from becoming one.
    render(
      <AnswerMarkdown
        text={["| A | B |", "|---|---|", "| [click](https://evil.example) | x |"].join("\n")}
      />,
    );
    const table = screen.getByRole("table");
    expect(table.querySelector("a")).toBeNull();
    expect(table.textContent).toContain("click");
  });
});

describe("identifiers in an answer are clickable", () => {
  it("links a transparent address to its page, in a new tab", () => {
    render(<AnswerMarkdown text="Paid to `t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi` in that block." />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/address/t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi");
    expect(link.getAttribute("target")).toBe("_blank");
    // The conversation lives only in React state, so navigating in place would destroy it.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("sends a 64-hex string to search rather than guessing txid or block", () => {
    // Genuinely ambiguous: the site's own dropdown carries that ambiguity in a row LABEL rather
    // than picking one. `/search` redirects when only one exists and disambiguates when both do,
    // where a guess at `/tx/` would 404 confidently on every block hash.
    const hash = "ab".repeat(32);
    render(<AnswerMarkdown text={`Transaction \`${hash}\` moved it.`} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/search?q=${hash}`);
  });

  it("never links a bare number, because a count is not a height", () => {
    render(<AnswerMarkdown text="The chain carried `3619` transactions that day." />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves a non-identifier code span as plain code", () => {
    render(<AnswerMarkdown text="The field is `valueBalanceZat` on each bundle." />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("valueBalanceZat")).toBeTruthy();
  });

  it("linkifies only what the MODEL marked as code, never bare prose", () => {
    // Linkifying prose would eventually turn a transaction count into a block link. A backticked
    // token is the one place the identifier is declared rather than inferred.
    render(<AnswerMarkdown text="Paid to t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi in that block." />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/*
 * A markdown link the model wrote, as opposed to one this renderer derived from a code span.
 * The server sanitiser already drops these; re-checked here for `SafeLink`'s own stated reason
 * — "the other layer handled it" is how both layers end up trusting each other.
 */
describe("a model-authored link to an entity page", () => {
  it("renders as plain text when the identifier is one the model invented", () => {
    render(<AnswerMarkdown text="See [this transaction](/tx/0d%20gitignore) for detail." />);
    expect(screen.queryByRole("link")).toBeNull();
    // The words survive — the reader loses the dead link, never the sentence.
    expect(screen.getByText(/this transaction/)).toBeTruthy();
  });

  it("still renders a link when the identifier is real", () => {
    const hash = "ab".repeat(32);
    render(<AnswerMarkdown text={`See [that block](/block/${hash}) for detail.`} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/block/${hash}`);
  });

  /*
   * A committed reference citation points off this site, e.g. `tachyon.z.cash`. `SafeLink`
   * accepts any `z.cash` subdomain, and the server allowlist must admit the same host: the
   * property is that the two layers agree.
   */
  it("keeps a link to a Zcash-project host a committed citation uses", () => {
    render(<AnswerMarkdown text="Its [stated goals](https://tachyon.z.cash/) say so." />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://tachyon.z.cash/");
  });

  it("still renders a link to a non-entity page", () => {
    render(<AnswerMarkdown text="See [the analytics page](/analytics) for the series." />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/analytics");
  });
});

describe("emphasis", () => {
  it("renders *a word* as emphasis instead of showing the asterisks", () => {
    const { container } = render(
      <AnswerMarkdown text="anyone reading the ledger sees only that *some* shielded activity happened" />,
    );
    expect(container.querySelector("em")?.textContent).toBe("some");
    expect(container.textContent).not.toContain("*");
  });

  it("leaves arithmetic and lone asterisks as typed", () => {
    for (const text of ["2 * 3 * 4 is 24", "a * b", "footnote*", "**bold** stays bold"]) {
      const { container, unmount } = render(<AnswerMarkdown text={text} />);
      expect(container.querySelector("em"), text).toBeNull();
      unmount();
    }
  });

  it("still reads a double asterisk as bold, never as two emphases", () => {
    render(<AnswerMarkdown text="the **viewing key** reveals everything" />);
    expect(screen.getByText("viewing key").tagName).toBe("STRONG");
  });
});

describe("a relative-looking link that leaves the site", () => {
  it("renders only its label for backslash and tab forms", () => {
    for (const href of ["/\\evil.de/claim", "/\t/evil.com/x"]) {
      const { container, unmount } = render(<AnswerMarkdown text={`[Claim your ZEC](${href})`} />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain("Claim your ZEC");
      unmount();
    }
  });

  it("still links an ordinary internal path", () => {
    const { container } = render(<AnswerMarkdown text="[blocks](/blocks)" />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/blocks");
  });
});
