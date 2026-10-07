import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Popover } from "@/components/Popover";

describe("Popover", () => {
  it("is a details disclosure opted in to outside-click dismissal", () => {
    const { container } = render(
      <Popover
        trigger="menu"
        triggerLabel="Open the menu"
        triggerTitle="Menu"
        triggerClassName="toggle"
        panelClassName="panel"
      >
        <a href="/x">x</a>
      </Popover>,
    );
    const details = container.querySelector("details");
    expect(details?.hasAttribute("data-popover")).toBe(true);
    expect(details?.className).toBe("relative inline-block align-middle");
    expect(details?.hasAttribute("name")).toBe(false);
    const summary = details?.querySelector(":scope > summary");
    expect(summary?.textContent).toBe("menu");
    expect(summary?.getAttribute("aria-label")).toBe("Open the menu");
    expect(summary?.getAttribute("title")).toBe("Menu");
    expect(summary?.className).toBe("toggle");
    const panel = details?.querySelector(":scope > div");
    expect(panel?.className).toBe("panel");
    expect(panel?.querySelector("a")?.getAttribute("href")).toBe("/x");
  });

  it("renders a list panel with its own name, and joins an accordion by name", () => {
    const { container } = render(
      <Popover
        name="group"
        className="relative"
        trigger="more"
        triggerClassName="toggle"
        panelAs="ul"
        panelClassName="panel"
        panelLabel="Choose one"
      >
        <li>one</li>
      </Popover>,
    );
    const details = container.querySelector("details");
    expect(details?.getAttribute("name")).toBe("group");
    expect(details?.className).toBe("relative");
    const panel = details?.querySelector(":scope > ul");
    expect(panel?.getAttribute("aria-label")).toBe("Choose one");
    expect(panel?.querySelectorAll("li")).toHaveLength(1);
    expect(details?.querySelector("summary")?.hasAttribute("aria-label")).toBe(false);
  });
});
