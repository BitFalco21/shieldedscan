import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportJsonButton } from "../ExportJsonButton";

/**
 * The export must still carry the raw hex — but read from the page, not from a prop. The hex is
 * already rendered once; a prop copy would serialise it a second time into the RSC payload.
 */
afterEach(() => vi.restoreAllMocks());

function captureBlob(): () => Promise<string> {
  let captured: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    captured = b as Blob;
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return async () => {
    if (!captured) throw new Error("nothing exported");
    return await (captured as Blob).text();
  };
}

describe("ExportJsonButton", () => {
  it("merges the named element's text in as rawHex", async () => {
    const read = captureBlob();
    render(
      <>
        <code id="raw-hex">deadbeef</code>
        <ExportJsonButton data={{ txid: "t" }} filename="x.json" withRawHexFrom="raw-hex" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /export json/i }));
    await waitFor(async () =>
      expect(JSON.parse(await read())).toEqual({ txid: "t", rawHex: "deadbeef" }),
    );
  });

  it("exports rawHex as null when the element is absent — a transaction with no hex", async () => {
    const read = captureBlob();
    render(<ExportJsonButton data={{ txid: "t" }} filename="x.json" withRawHexFrom="raw-hex" />);
    fireEvent.click(screen.getByRole("button", { name: /export json/i }));
    await waitFor(async () =>
      expect(JSON.parse(await read())).toEqual({ txid: "t", rawHex: null }),
    );
  });
});
