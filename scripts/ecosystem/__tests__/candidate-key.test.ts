import { describe, expect, it } from "vitest";
import { candidateKey } from "../lib/candidate-key.mjs";

describe("candidateKey", () => {
  it("merges one project's site mentions regardless of scheme, www and path", () => {
    const a = candidateKey("https://www.zingolabs.org/");
    const b = candidateKey("http://zingolabs.org/about?ref=x");
    expect(a).toEqual({ key: "zingolabs.org", kind: "site", host: "zingolabs.org" });
    expect(b?.key).toBe(a?.key);
  });

  it("keys a code host by owner and repo, never by the host alone", () => {
    expect(candidateKey("https://github.com/zingolabs/zingolib")?.key).toBe(
      "github.com/zingolabs/zingolib",
    );
    expect(candidateKey("https://github.com/ZingoLabs/Zingolib.git")?.key).toBe(
      "github.com/zingolabs/zingolib",
    );
    expect(candidateKey("https://github.com/zingolabs")?.key).toBe("github.com/zingolabs");
    expect(candidateKey("https://github.com/zingolabs/zingolib/issues/12")?.key).toBe(
      "github.com/zingolabs/zingolib",
    );
  });

  it("returns null for a bare code or social host, which names no project", () => {
    expect(candidateKey("https://github.com/")).toBeNull();
    expect(candidateKey("https://x.com")).toBeNull();
  });

  it("marks social accounts, and treats a single video as a document about something", () => {
    expect(candidateKey("https://x.com/zingolabs/status/123")).toMatchObject({
      key: "x.com/zingolabs",
      kind: "social",
    });
    expect(candidateKey("https://youtu.be/IVkuo1CGPBU")?.kind).toBe("doc");
    expect(candidateKey("https://www.youtube.com/watch?v=abc")?.kind).toBe("doc");
  });

  it("never merges two different documents on one docs host", () => {
    const a = candidateKey("https://zips.z.cash/zip-0316");
    const b = candidateKey("https://zips.z.cash/zip-0317");
    expect(a?.kind).toBe("doc");
    expect(a?.key).not.toBe(b?.key);
  });

  it("refuses what is not an http(s) URL", () => {
    expect(candidateKey("mailto:hello@example.com")).toBeNull();
    expect(candidateKey("/content-images/logo.webp")).toBeNull();
    expect(candidateKey("not a url")).toBeNull();
  });
});
