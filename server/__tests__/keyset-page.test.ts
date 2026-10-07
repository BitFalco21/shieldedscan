import { describe, expect, it } from "vitest";
import { keysetSlice } from "../keyset-page";

const id = (n: number) => String(n);

describe("keysetSlice", () => {
  it("first page: next cursor only when the overfetch found more", () => {
    expect(keysetSlice([9, 8, 7], 2, null, id)).toEqual({
      rows: [9, 8],
      nextCursor: "8",
      prevCursor: null,
    });
    expect(keysetSlice([9, 8], 2, null, id)).toEqual({
      rows: [9, 8],
      nextCursor: null,
      prevCursor: null,
    });
  });

  it("a before page always links back to newer rows", () => {
    expect(keysetSlice([6, 5, 4], 2, "before", id)).toEqual({
      rows: [6, 5],
      nextCursor: "5",
      prevCursor: "6",
    });
    expect(keysetSlice([6], 2, "before", id)).toEqual({
      rows: [6],
      nextCursor: null,
      prevCursor: "6",
    });
  });

  it("an after page is reversed to newest first and always links on to older rows", () => {
    expect(keysetSlice([3, 4, 5], 2, "after", id)).toEqual({
      rows: [4, 3],
      nextCursor: "3",
      prevCursor: "4",
    });
    expect(keysetSlice([3, 4], 2, "after", id)).toEqual({
      rows: [4, 3],
      nextCursor: "3",
      prevCursor: null,
    });
  });

  it("an empty page has no cursors", () => {
    expect(keysetSlice([], 2, "before", id)).toEqual({
      rows: [],
      nextCursor: null,
      prevCursor: null,
    });
  });
});
