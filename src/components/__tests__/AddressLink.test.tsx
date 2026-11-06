import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressLink } from "../AddressLink";

/** Both are real rows of the live rich list: one attributed, one nobody has named. */
const LABELLED = "t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8";
const UNLABELLED = "t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco";

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  // @ts-expect-error -- jsdom does not define this; undo the stub between tests.
  delete navigator.clipboard;
});

describe("AddressLink", () => {
  it("renders the name in place of the address when one is known", () => {
    render(<AddressLink address={LABELLED} />);
    expect(screen.getByRole("link", { name: "Binance Cold Wallet" })).toBeDefined();
    // The elided form must be GONE, not merely alongside — the name replaces it.
    expect(screen.queryByText(/t1gsBr/)).toBeNull();
  });

  it("marks a name with the tag icon, and an elided address without one", () => {
    const { container, unmount } = render(<AddressLink address={LABELLED} />);
    const icon = container.querySelector("[data-label-icon]");
    expect(icon).not.toBeNull();
    // Decorative: the link's accessible name stays the name alone.
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("link", { name: "Binance Cold Wallet" })).toBeDefined();
    unmount();
    const bare = render(<AddressLink address={UNLABELLED} />);
    expect(bare.container.querySelector("[data-label-icon]")).toBeNull();
  });

  it("keeps the full address reachable as the link's title", () => {
    // A reader has to be able to check a third-party name against the address it claims.
    render(<AddressLink address={LABELLED} />);
    expect(screen.getByRole("link").getAttribute("title")).toBe(LABELLED);
  });

  it("copies the untruncated ADDRESS, never the name", async () => {
    // The copy button is the one control whose value a reader pastes into another tool, and a
    // name is not an address.
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<AddressLink address={LABELLED} copyable />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LABELLED));
  });

  it("falls back to the elided address when nobody has labelled it", () => {
    render(<AddressLink address={UNLABELLED} edge={6} />);
    expect(screen.getByRole("link", { name: /t1cpC3/ })).toBeDefined();
  });

  it("links to the address page whether or not a name is known", () => {
    const { rerender } = render(<AddressLink address={LABELLED} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/address/${LABELLED}`);
    rerender(<AddressLink address={UNLABELLED} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/address/${UNLABELLED}`);
  });

  it("never prints the basis or the source", () => {
    // The label's basis is recorded but not rendered: the name appears and that is all.
    const { container } = render(<AddressLink address={LABELLED} copyable />);
    expect(container.textContent).not.toMatch(/third-party|external|self-declared|arkm/i);
  });
});

describe("AddressLink as a block's miner", () => {
  /** Payout addresses in `MINING_POOL_LABELS`: one pool with a logo, one without. */
  const VIABTC = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
  const KRYPTEX = "t1e6hceYHkzCbwcwGZzKeMfXXW7x7gr19Cw";

  it("names a labelled payout address by its pool, with the pool's logo", () => {
    const { container } = render(<AddressLink address={VIABTC} asMiner />);
    const link = screen.getByRole("link", { name: "ViaBTC" });
    expect(link.getAttribute("href")).toBe(`/address/${VIABTC}`);
    expect(link.getAttribute("title")).toBe(VIABTC);
    const logo = container.querySelector("img[data-mining-pool-logo]");
    expect(logo?.getAttribute("src")).toBe("/ecosystem/logos/viabtc.png");
    // Decorative: the name is what a screen reader hears.
    expect(logo?.getAttribute("alt")).toBe("");
    expect(container.querySelector("[data-label-icon]")).toBeNull();
  });

  it("draws the label glyph for a pool with no logo", () => {
    const { container } = render(<AddressLink address={KRYPTEX} asMiner />);
    expect(screen.getByRole("link", { name: "Kryptex" })).toBeDefined();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-label-icon]")).not.toBeNull();
  });

  it("keeps a pool's name off the address anywhere it is not a miner", () => {
    render(<AddressLink address={VIABTC} edge={6} />);
    expect(screen.queryByText("ViaBTC")).toBeNull();
    expect(screen.getByRole("link", { name: /t1MKn3/ })).toBeDefined();
  });

  it("leaves an unattributed miner as its elided address", () => {
    const { container } = render(<AddressLink address={UNLABELLED} edge={6} asMiner />);
    expect(screen.getByRole("link", { name: /t1cpC3/ })).toBeDefined();
    expect(container.querySelector("img, [data-label-icon]")).toBeNull();
  });

  it("copies the payout address, never the pool's name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<AddressLink address={VIABTC} copyable asMiner />);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VIABTC));
  });

  it("prints no basis or evidence", () => {
    const { container } = render(<AddressLink address={VIABTC} asMiner />);
    expect(container.textContent).toBe("ViaBTC");
  });
});
