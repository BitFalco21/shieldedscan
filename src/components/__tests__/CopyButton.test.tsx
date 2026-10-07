import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../CopyButton";
import { HashLink } from "../HashLink";

const FULL_HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  // @ts-expect-error -- jsdom doesn't define this by default; undo our stub between tests.
  delete navigator.clipboard;
});

describe("CopyButton", () => {
  it("has an accessible name derived from the label", () => {
    stubClipboard(() => Promise.resolve());
    render(<CopyButton value="anything" label="block hash" />);
    expect(screen.getByRole("button", { name: "Copy block hash" })).toBeDefined();
  });

  it("writes the full value to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton value={FULL_HASH} label="hash" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy hash" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_HASH));
  });

  it("does not throw when the clipboard rejects (denied permission, insecure context)", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyButton value={FULL_HASH} label="hash" />);
    const button = screen.getByRole("button", { name: "Copy hash" });

    expect(() => fireEvent.click(button)).not.toThrow();
    // Let the rejected promise's .catch() settle; the glyph stays unchanged.
    await waitFor(() => expect(button.textContent).toBe("⧉"));
  });

  it("does nothing (and does not throw) when the Clipboard API is unavailable", () => {
    // No navigator.clipboard defined at all — e.g. an insecure (http) context.
    render(<CopyButton value={FULL_HASH} label="hash" />);
    const button = screen.getByRole("button", { name: "Copy hash" });
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

describe("HashLink copy integration", () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
  });

  it("is not rendered when copyable is left at its default", () => {
    render(<HashLink value={FULL_HASH} href="/tx/x" />);
    expect(screen.queryByRole("button", { name: "Copy hash" })).toBeNull();
  });

  it("copies the full untruncated value, not the shortened display text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<HashLink value={FULL_HASH} href="/tx/x" edge={4} copyable />);

    // Sanity check: the link itself shows the truncated form.
    const link = screen.getByRole("link");
    expect(link.textContent).not.toBe(FULL_HASH);

    fireEvent.click(screen.getByRole("button", { name: "Copy hash" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_HASH));
  });
});

describe("CopyButton fromElementId", () => {
  it("copies the text of the named element at click time, so a long value is not sent twice", async () => {
    // The raw transaction hex is already in the HTML; passing it as a prop as well would
    // serialise the same megabytes a second time into the RSC payload.
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(
      <>
        <code id="raw-hex">{FULL_HASH}</code>
        <CopyButton fromElementId="raw-hex" label="raw hex" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy raw hex" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_HASH));
  });
});
