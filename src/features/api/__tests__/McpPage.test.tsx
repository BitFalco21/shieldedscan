import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpPage } from "../McpPage";
import { MCP_DEMO } from "../mcp-demo";
import { MCP_URL, mcpToolGroups } from "@/api-catalogue/mcp-tools";

describe("/mcp", () => {
  it("lists every tool the server answers to, each linked to its reference section", () => {
    render(<McpPage />);
    for (const g of mcpToolGroups()) {
      for (const t of g.tools) {
        const link = screen.getByRole("link", { name: t.name });
        expect(link.getAttribute("href")).toBe(`/api-docs#${t.docsId}`);
      }
    }
  });

  it("shows the server URL the API actually serves", () => {
    render(<McpPage />);
    expect(MCP_URL).toMatch(/\/mcp$/);
    expect(screen.getAllByText(MCP_URL).length).toBeGreaterThan(0);
  });

  it("demonstrates only tools that exist", () => {
    const names = new Set(mcpToolGroups().flatMap((g) => g.tools.map((t) => t.name)));
    for (const x of MCP_DEMO) expect(names, x.tool).toContain(x.tool);
  });

  it("without JavaScript, renders every demo exchange and every client's steps", () => {
    // The server render is what a reader without JavaScript keeps: nothing may hide behind a tab.
    const html = renderToStaticMarkup(<McpPage />);
    for (const x of MCP_DEMO) expect(html).toContain(x.question.replace(/'/g, "&#x27;"));
    for (const client of ["Claude Code", "ChatGPT", "Cursor", "VS Code"]) {
      expect(html).toContain(client);
    }
    expect(html).not.toContain('role="tablist"');
  });

  it("switches the demo by tab, one exchange at a time", () => {
    render(<McpPage />);
    const demoTabs = screen.getByRole("tablist", { name: "Example questions" });
    // Every transcript stays mounted in one grid cell, so the box never resizes; only the
    // selected one is visible and reachable — the others are invisible and inert.
    const panel = (i: number) => document.getElementById(`mcp-demo-panel-${MCP_DEMO[i]!.id}`)!;
    const isLive = (i: number) =>
      !panel(i).hasAttribute("inert") && !panel(i).classList.contains("invisible");
    expect([0, 1, 2].map(isLive)).toEqual([true, false, false]);
    fireEvent.click(screen.getByRole("tab", { name: MCP_DEMO[1]!.topic }));
    expect([0, 1, 2].map(isLive)).toEqual([false, true, false]);
    // Arrow keys move between tabs, the ARIA tab pattern.
    fireEvent.keyDown(demoTabs, { key: "ArrowRight" });
    expect([0, 1, 2].map(isLive)).toEqual([false, false, true]);
  });

  it("shows each assistant's own setup", () => {
    render(<McpPage />);
    fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));
    expect(screen.getByText(/"type": "http"/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
    expect(
      screen.getByText(`claude mcp add --transport http shieldedscan ${MCP_URL}`),
    ).toBeTruthy();
  });

  it("filters the tool list, and says when nothing matches", () => {
    render(<McpPage />);
    const filter = screen.getByLabelText("Filter tools");
    fireEvent.change(filter, { target: { value: "ironwood" } });
    expect(screen.getByRole("link", { name: "analytics_ironwood" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "block" })).toBeNull();
    fireEvent.change(filter, { target: { value: "zzzz" } });
    expect(screen.getByText(/No tool matches/)).toBeTruthy();
  });
});
