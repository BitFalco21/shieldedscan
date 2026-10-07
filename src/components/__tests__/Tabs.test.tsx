import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "../Tabs";

const TABS = [
  { key: "transfers" as const, href: "/cross-chain", label: "transfers" },
  { key: "flows" as const, href: "/cross-chain/flows", label: "flows" },
];

describe("Tabs", () => {
  it("is a named row of links, the current one marked as the page", () => {
    render(<Tabs label="Cross-chain views" tabs={TABS} active="flows" />);
    const nav = screen.getByRole("navigation", { name: "Cross-chain views" });
    expect(nav.classList.contains("tabs")).toBe(true);
    expect(screen.getByRole("link", { name: "flows" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "transfers" }).hasAttribute("aria-current")).toBe(
      false,
    );
    expect(screen.getByRole("link", { name: "transfers" }).getAttribute("href")).toBe(
      "/cross-chain",
    );
  });

  it("carries its look in the shared .tabs class, not per-link utilities", () => {
    // The look lives in the stylesheet's `.tabs`, so no row can drift from another.
    render(<Tabs label="x" tabs={TABS} active="transfers" />);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("class")).toBeNull();
  });
});
