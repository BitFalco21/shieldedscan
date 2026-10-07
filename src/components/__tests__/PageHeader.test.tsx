import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "../PageHeader";

describe("PageHeader", () => {
  it("renders the eyebrow, one h1 and the lede in order", () => {
    render(
      <PageHeader eyebrow="CHAIN" title="Blocks">
        <p data-testid="lede">Every block.</p>
      </PageHeader>,
    );
    const header = screen.getByRole("banner");
    expect(header.className).toBe("pt-8 pb-6");
    const [eyebrow, h1, lede] = header.children;
    expect(eyebrow?.className).toBe("microlabel");
    expect(eyebrow?.textContent).toBe("CHAIN");
    expect(h1?.tagName).toBe("H1");
    expect(h1?.className).toBe("mt-1 text-2xl font-bold tracking-tight text-ink-bright");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(lede).toBe(screen.getByTestId("lede"));
  });

  it("renders no lede element when the page supplies none", () => {
    render(<PageHeader eyebrow="CHAIN" title="Blocks" />);
    expect(screen.getByRole("banner").children).toHaveLength(2);
  });

  it("accepts a composed eyebrow", () => {
    render(<PageHeader eyebrow={<>NETWORK · {3} COUNTRIES</>} title="x" />);
    expect(screen.getByRole("banner").firstElementChild?.textContent).toBe("NETWORK · 3 COUNTRIES");
  });

  it("opens a detail page with its breadcrumb in place of an eyebrow", () => {
    render(
      <PageHeader breadcrumb={[{ label: "HOME", href: "/" }, { label: "#7" }]} title="Block #7" />,
    );
    const [crumbs, h1] = screen.getByRole("banner").children;
    expect(crumbs?.tagName).toBe("NAV");
    expect(crumbs?.textContent).toBe("HOME / #7");
    expect(h1?.tagName).toBe("H1");
  });

  it("draws an identifier title small and free to break, so a txid stays on screen", () => {
    render(
      <PageHeader
        breadcrumb={[{ label: "HOME" }]}
        title={"ab".repeat(32)}
        titleVariant="identifier"
      />,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("text-lg");
    expect(h1.className).toContain("break-all");
    expect(h1.className).not.toContain("text-2xl");
  });

  it("puts actions beside the title, and meta and lede beneath it at the shared width", () => {
    render(
      <PageHeader
        eyebrow="CHAIN"
        title="Block #7"
        actions={<button type="button">export</button>}
        meta={<span>12 confirmations</span>}
        lede="Every block."
      />,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.parentElement?.contains(screen.getByRole("button", { name: "export" }))).toBe(true);
    expect(screen.getByText("12 confirmations").parentElement?.className).toContain("text-xs");
    expect(screen.getByText("Every block.").className).toBe(
      "mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim",
    );
  });
});
