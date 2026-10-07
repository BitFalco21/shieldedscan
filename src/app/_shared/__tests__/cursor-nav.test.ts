import { describe, expect, it } from "vitest";
import { cursorNavHrefs, type CursorStep } from "@/app/_shared/cursor-nav";
import { ORIGIN_CURSOR } from "@/data";

const href = (step?: CursorStep) => (step ? `/list?${step.name}=${step.value}` : "/list");

describe("cursorNavHrefs", () => {
  it("links every direction from a page in the middle of the list", () => {
    expect(cursorNavHrefs({ prevCursor: "p", nextCursor: "n" }, href)).toEqual({
      newerHref: "/list?after=p",
      olderHref: "/list?before=n",
      newestHref: "/list",
      oldestHref: `/list?after=${ORIGIN_CURSOR}`,
    });
  });

  it("drops the links toward an end the reader is already at", () => {
    expect(cursorNavHrefs({ prevCursor: null, nextCursor: null }, href)).toEqual({
      newerHref: null,
      olderHref: null,
      newestHref: null,
      oldestHref: null,
    });
  });
});
