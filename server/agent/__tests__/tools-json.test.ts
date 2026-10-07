import { describe, expect, it } from "vitest";
import { asRecord, isOneOf, NOT_JSON, orList, parseJson, reshapeJson } from "../tools/json";

describe("asRecord", () => {
  it("accepts a plain object and refuses arrays, null and scalars", () => {
    const record = { a: 1 };
    expect(asRecord(record)).toBe(record);
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord("x")).toBeNull();
    expect(asRecord(undefined)).toBeNull();
  });
});

describe("isOneOf and orList", () => {
  const SET = ["none", "day", "month"] as const;

  it("narrows a member of a closed set and refuses anything else", () => {
    expect(isOneOf(SET, "day")).toBe(true);
    expect(isOneOf(SET, "week")).toBe(false);
  });

  it("writes a set as prose, quoted on request", () => {
    expect(orList(SET)).toBe("none, day or month");
    expect(orList(["in", "out"], true)).toBe('"in" or "out"');
    expect(orList(["only"])).toBe("only");
  });
});

describe("parseJson and reshapeJson", () => {
  it("tells a body that is not JSON apart from every JSON value, null included", () => {
    expect(parseJson("not json")).toBe(NOT_JSON);
    expect(parseJson("null")).toBeNull();
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns an unparseable body unchanged and pretty-prints a reshaped one", () => {
    expect(reshapeJson("not json", () => ({}))).toBe("not json");
    expect(reshapeJson('{"a":1}', (p) => ({ ...(p as object), b: 2 }))).toBe(
      JSON.stringify({ a: 1, b: 2 }, null, 2),
    );
  });
});
