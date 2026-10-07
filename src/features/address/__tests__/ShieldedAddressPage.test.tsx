import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShieldedAddressPage } from "../ShieldedAddressPage";

const UNIFIED =
  "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n";
const SAPLING = "zs1exampleshieldedsaplingaddressfixture0000000000000001";

describe("ShieldedAddressPage", () => {
  it("states the privacy fact and shows the full address for both kinds", () => {
    const { unmount } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(screen.getByText(/everything is private/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(UNIFIED);
    expect(screen.getByText("UNIFIED ADDRESS")).toBeTruthy();
    unmount();

    render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    expect(screen.getByText(/everything is private/)).toBeTruthy();
    expect(screen.getByText("SAPLING SHIELDED ADDRESS")).toBeTruthy();
  });

  it("keeps the viewing-key warning and offers no field to type one into", () => {
    const { container } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(screen.getByText(/Never paste a viewing key into a website/)).toBeTruthy();
    // Not even a disabled input — rendering the control at all teaches the habit.
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("renders no numeric amount anywhere — every value is a redaction", () => {
    const { container } = render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    // The address string is the one legitimate digit-carrier on the page; everything
    // else must be bars. A numeric ZEC amount here would be fabricated.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d+(\.\d+)?\s*ZEC/);
    expect(text).not.toMatch(/\$\s?[\d,]/);
  });

  it("every redaction bar carries the hidden-by-design title", () => {
    const { container } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    const bars = Array.from(container.querySelectorAll(".redact"));
    expect(bars.length).toBeGreaterThan(4);
    for (const bar of bars) {
      expect(bar.getAttribute("title")).toContain("hidden by design");
    }
  });

  it("the stat bars are accessible redactions; the mock ledger is decorative", () => {
    const { container } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    const labelled = screen.getAllByRole("img", { name: "value shielded — encrypted on-chain" });
    expect(labelled).toHaveLength(4); // BALANCE / TRANSACTIONS / FIRST SEEN / LAST ACTIVE
    // The table's bars are aria-hidden so a screen reader hears one sentence, not 24 labels.
    const tableBars = container.querySelectorAll("table .redact");
    expect(tableBars.length).toBeGreaterThan(0);
    for (const bar of Array.from(tableBars)) {
      expect(bar.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.getByText(/History is encrypted on-chain: no rows can be shown/)).toBeTruthy();
  });

  it("links to the genuinely public views", () => {
    render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(screen.getByRole("link", { name: "the shielded pools" }).getAttribute("href")).toBe(
      "/shielded",
    );
    expect(screen.getByRole("link", { name: "shielded transactions" }).getAttribute("href")).toBe(
      "/txs?kind=shielded",
    );
  });

  it("decodes the unified address's receivers — the donation address carries Sapling + Orchard", () => {
    render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(screen.getByText("RECEIVERS")).toBeTruthy();
    expect(screen.getByText("orchard")).toBeTruthy();
    expect(screen.getByText("sapling")).toBeTruthy();
    // The derived standalone Sapling address links to its own page, which is
    // generated from the string alone and can never 404.
    const derived = screen.getByRole("link", { name: /^zs1[a-z0-9]+$/ });
    expect(derived.getAttribute("href")).toBe(
      "/address/zs1ecm3j8fc6enc7uxs4dk5s9ku8wpg7lhe7np5quzxqauh3we4ydgztwx7x83rkgfkkkcnjl66jmn",
    );
    // Orchard has no standalone address form: the value cell says so in words rather than
    // showing raw bytes nothing can consume, and each row's ? explains its value.
    expect(
      screen.getByText(/no standalone form — reachable only through this unified address/),
    ).toBeTruthy();
    expect(screen.queryByText(/^990ae7fecd41e402/)).toBeNull();
    expect(screen.getByText(/Orchard deliberately has no address format of its own/)).toBeTruthy();
    expect(screen.getByText(/pays this unified address through Sapling/)).toBeTruthy();
    // The panel sits below the three strips: claims first, unpacking last.
    const strips = screen.getByText("YOUR OWN BALANCE");
    const receivers = screen.getByRole("heading", { name: "RECEIVERS" });
    expect(
      strips.compareDocumentPosition(receivers) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The nuance that must survive the feature: the receiver set is public, the
    // receiver a payment used is not.
    expect(screen.getByText(/Which receiver a payment used stays private/)).toBeTruthy();
  });

  it("renders NO receivers panel when the decode refuses — never a partial list", () => {
    // Well-shaped for the classifier, garbage for the decoder (bad checksum).
    const junk = `u1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(6)}`;
    render(<ShieldedAddressPage address={junk} kind="unified" />);
    expect(screen.queryByText("RECEIVERS")).toBeNull();
  });

  it("renders no receivers panel on a Sapling address — it IS a single receiver", () => {
    render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    expect(screen.queryByText("RECEIVERS")).toBeNull();
  });

  it("tags an address from the other network in the header", () => {
    // Tests run with NEXT_PUBLIC_NETWORK unset, i.e. the mainnet deployment.
    const testnetUa = `utest1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(4)}`;
    render(<ShieldedAddressPage address={testnetUa} kind="unified" />);
    expect(screen.getByText("UNIFIED ADDRESS (TESTNET)")).toBeTruthy();
  });

  it("the kind-specific copy renders only for its kind", () => {
    const { unmount } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(screen.getByText(/bundles Orchard/)).toBeTruthy();
    expect(screen.queryByText(/receives into the Sapling/)).toBeNull();
    unmount();

    render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    expect(screen.getByText(/receives into the Sapling/)).toBeTruthy();
    expect(screen.queryByText(/bundles Orchard/)).toBeNull();
  });

  it("shows a searched name with the transaction it rests on, worded as where it was pointed", () => {
    const { container } = render(
      <ShieldedAddressPage
        address={UNIFIED}
        kind="unified"
        searchedName={{
          name: "zenith",
          address: UNIFIED,
          txid: "a".repeat(64),
          height: 3_412_748,
          timestamp: 1_784_087_489,
          lastAction: "UPDATE",
          listingPriceZat: 250_000_000,
        }}
      />,
    );
    const chip = container.querySelector("[data-zns-name]")!;
    expect(chip.textContent).toContain("zenith.zcash");
    expect(chip.textContent).toContain("points here");
    // The verb follows the last action: this row was UPDATED there, not claimed.
    expect(chip.textContent).toContain("updated at block 3,412,748");
    expect(chip.textContent).toContain("listed for sale");
    const hrefs = [...chip.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/name/zenith", `/tx/${"a".repeat(64)}`]);
    // A name is not an identity, and the page says so where the name is.
    expect(chip.textContent).toContain("not who holds this address");
    // The address stays the subject: it is still the heading and still what gets copied.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(UNIFIED);
  });

  it("shows no name at all without a searched one — there is no reverse label", () => {
    const { container } = render(<ShieldedAddressPage address={UNIFIED} kind="unified" />);
    expect(container.querySelector("[data-zns-name]")).toBeNull();
    expect(container.textContent).not.toContain(".zcash");
  });
});
