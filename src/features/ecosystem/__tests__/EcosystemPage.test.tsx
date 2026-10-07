import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import { EcosystemPage } from "../EcosystemPage";
import { X_AUTHOR_URL } from "@/lib/links";
import { ECOSYSTEM_LOGOS } from "../logos.generated";

// Every test renders the whole page (a hundred-odd SVG marks and list rows), which can pass
// vitest's 5 s default under parallel load, so the budget is raised rather than coverage cut.
describe("EcosystemPage", { timeout: 30_000 }, () => {
  it("renders one h1 and every project twice — once on the map, once in the list", () => {
    render(<EcosystemPage />);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    for (const e of ECOSYSTEM_ENTRIES) {
      expect(document.querySelectorAll(`a[href="${e.url}"]`).length, e.id).toBe(2);
    }
  });

  it("tells a reader where to report a missing project, above both views, linking the author's X", () => {
    render(<EcosystemPage />);
    const line = document.querySelector("[data-ecosystem-contact]");
    expect(line?.textContent).toMatch(/Missing a project\?/);
    const link = line?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(X_AUTHOR_URL);
    // Before the map and the list, so it is seen before the gap is.
    const firstView = document.querySelector('svg[aria-label^="Map of"], ul, table');
    expect(
      line!.compareDocumentPosition(firstView!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens every project in a new tab and tells its site nothing about where the reader came from", () => {
    render(<EcosystemPage />);
    for (const a of document.querySelectorAll("a[href^='https://']")) {
      const href = a.getAttribute("href") ?? "";
      expect(a.getAttribute("target"), href).toBe("_blank");
      expect(a.getAttribute("rel"), href).toContain("noopener");
      expect(a.getAttribute("rel"), href).toContain("noreferrer");
    }
  });

  it("loads icons only from this origin, and draws an initial where there is none", () => {
    render(<EcosystemPage />);
    const srcs = [
      ...[...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? ""),
      ...[...document.querySelectorAll("image")].map((i) => i.getAttribute("href") ?? ""),
    ];
    expect(srcs.length).toBe(ECOSYSTEM_LOGOS.size * 2);
    for (const s of srcs) expect(s).toMatch(/^\/ecosystem\/logos\/[a-z0-9-]+\.png$/);
    const without = ECOSYSTEM_ENTRIES.find((e) => !ECOSYSTEM_LOGOS.has(e.id));
    if (without)
      expect(document.getElementById(`project-${without.id}`)?.textContent).toContain(without.name);
  });

  it("says a listing is not an endorsement", () => {
    render(<EcosystemPage />);
    expect(document.body.textContent).toMatch(/not an endorsement/);
  });

  it("offers a map and a list, and the list filter narrows the list", () => {
    render(<EcosystemPage />);
    fireEvent.click(screen.getByRole("button", { name: "> list" }));
    expect(document.querySelector(".eco-explorer")?.getAttribute("data-mode")).toBe("list");
    const list = document.querySelector(".eco-list-view") as HTMLElement;
    fireEvent.change(within(list).getByRole("searchbox", { name: "Filter projects" }), {
      target: { value: "kraken" },
    });
    expect(list.querySelectorAll("a[href^='https://']")).toHaveLength(1);
    expect(list.textContent).toContain(`1 of ${ECOSYSTEM_ENTRIES.length} projects`);
  });

  it("searches the map and lights the picked project while the rest recede", async () => {
    render(<EcosystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /Search projects/ }));
    const box = screen.getByRole("combobox", { name: "Search projects" });
    fireEvent.change(box, { target: { value: "kraken" } });
    const option = screen.getByRole("option", { name: /Kraken/ });
    await act(async () => {
      fireEvent.click(option);
    });
    const node = document.querySelector('.eco-map [data-eco-id="kraken"]');
    expect(node?.getAttribute("class")).toContain("is-lit");
    expect(document.querySelectorAll(".eco-map .eco-node.is-dim").length).toBe(
      ECOSYSTEM_ENTRIES.length - 1,
    );
  });

  it("names every control so a screen reader can find it", () => {
    render(<EcosystemPage />);
    for (const name of [/Zoom in/, /Zoom out/, /Search projects/, /Reset view/, /PNG snapshot/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("true");
  });
});
