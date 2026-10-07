/**
 * The block half of the answer renderer: a model's text split into paragraphs, `-`/`*` lists
 * and pipe tables. Pure, so it is tested without rendering; `AnswerMarkdown` draws the result.
 */

export type Align = "left" | "right";

export type Block =
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][]; align: Align[] };

/** The cells of one pipe row, with the optional outer pipes stripped. */
function cellsOf(line: string): string[] {
  const inner = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map((c) => c.trim());
}

/** `|---|:--:|---:|` — the row that turns two ordinary lines into a table. */
function isDelimiterRow(line: string): boolean {
  if (!line.includes("|") || !line.includes("-")) return false;
  const cells = cellsOf(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/**
 * Right-align a column only when every body cell in it is a number, like the site's own numeric
 * columns. Decided per column, not per cell: a stray "n/a" in a numeric column is exactly the
 * row a reader is looking for, and per-cell alignment would ragged-align it. Markdown's own
 * `---:` is honoured first.
 */
function columnAlign(delimiters: string[], rows: string[][], columns: number): Align[] {
  return Array.from({ length: columns }, (_, i) => {
    if ((delimiters[i] ?? "").endsWith(":")) return "right";
    if ((delimiters[i] ?? "").startsWith(":")) return "left";
    const body = rows.map((r) => r[i] ?? "").filter((c) => c !== "" && c !== "—");
    const numeric = body.length > 0 && body.every((c) => /^[+-]?[\d,]+(\.\d+)?%?$/.test(c));
    return numeric ? "right" : "left";
  });
}

/** The answer's text as paragraphs, lists and tables — the only block kinds it may hold. */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (list !== null) {
      blocks.push({ kind: "list", items: list });
      list = null;
    }
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    /*
     * A table needs its own block kind: paragraphs join their lines with a space, which would
     * turn a pipe table into one unreadable run. Recognised as GFM does — a row followed by a
     * delimiter row; requiring the delimiter stops an ordinary sentence containing a pipe from
     * becoming a table.
     */
    const next = lines[i + 1]?.trim() ?? "";
    if (line.includes("|") && isDelimiterRow(next)) {
      flushPara();
      flushList();
      const header = cellsOf(line);
      const delimiters = cellsOf(next);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const row = lines[j]!.trim();
        if (row === "" || !row.includes("|")) break;
        // Padded or truncated to the header's width, so a malformed row cannot shift a column
        // and silently file a figure under the wrong heading.
        const cells = cellsOf(row);
        rows.push(Array.from({ length: header.length }, (_, c) => cells[c] ?? ""));
      }
      blocks.push({
        kind: "table",
        header,
        rows,
        align: columnAlign(delimiters, rows, header.length),
      });
      i = j - 1;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      flushPara();
      list ??= [];
      list.push(bullet[1]!);
      continue;
    }
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    // A stray "## heading" the prompt forbids renders as text, never as a heading — the
    // answer must not be able to out-shout the page's own h1.
    flushList();
    para.push(line.replace(/^#{1,6}\s+/, ""));
  }
  flushPara();
  flushList();
  return blocks;
}
