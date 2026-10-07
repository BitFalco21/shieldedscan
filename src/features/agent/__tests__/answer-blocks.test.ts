import { describe, expect, it } from "vitest";
import { splitBlocks } from "../answer-blocks";

describe("splitBlocks", () => {
  it("separates paragraphs on blank lines and joins a paragraph's lines with a space", () => {
    expect(splitBlocks("one\ntwo\n\nthree")).toEqual([
      { kind: "para", text: "one two" },
      { kind: "para", text: "three" },
    ]);
  });

  it("collects `-` and `*` bullets into one list", () => {
    expect(splitBlocks("- a\n* b")).toEqual([{ kind: "list", items: ["a", "b"] }]);
  });

  it("needs a delimiter row before a line with pipes becomes a table", () => {
    expect(splitBlocks("a | b")).toEqual([{ kind: "para", text: "a | b" }]);
  });

  it("pads short rows to the header and right-aligns all-numeric columns", () => {
    const [table] = splitBlocks("| day | txs |\n|---|---|\n| Mon | 1,200 |\n| Tue |");
    expect(table).toEqual({
      kind: "table",
      header: ["day", "txs"],
      rows: [
        ["Mon", "1,200"],
        ["Tue", ""],
      ],
      align: ["left", "right"],
    });
  });

  it("renders a heading marker as plain paragraph text", () => {
    expect(splitBlocks("## Title")).toEqual([{ kind: "para", text: "Title" }]);
  });
});
