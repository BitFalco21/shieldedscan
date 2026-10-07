import { describe, expect, it } from "vitest";
import { parseTorExitList } from "../p2p/tor-exits";

describe("parseTorExitList", () => {
  it("keeps IPv4 lines and drops comments, blanks and anything malformed", () => {
    const body = ["# comment", "185.220.101.5", "", "  8.8.8.8  ", "not-an-ip", "1.2.3"].join("\n");
    expect(parseTorExitList(body)).toEqual(["185.220.101.5", "8.8.8.8"]);
  });

  it("returns an empty list for an empty body rather than throwing", () => {
    expect(parseTorExitList("")).toEqual([]);
  });
});
