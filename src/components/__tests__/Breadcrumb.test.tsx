import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "../Breadcrumb";

describe("Breadcrumb", () => {
  it("draws the trail as the detail pages did — one micro-label line, real ` / ` separators", () => {
    render(
      <Breadcrumb
        items={[
          { label: "HOME", href: "/" },
          { label: "BLOCKS", href: "/blocks" },
          { label: "#7" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.className).toBe("microlabel");
    // Copied, the trail reads as one: the separators are text, not CSS.
    expect(nav.textContent).toBe("HOME / BLOCKS / #7");
    expect(screen.getByRole("link", { name: "BLOCKS" }).getAttribute("href")).toBe("/blocks");
    expect(screen.getByText("#7").getAttribute("aria-current")).toBe("page");
  });
});
