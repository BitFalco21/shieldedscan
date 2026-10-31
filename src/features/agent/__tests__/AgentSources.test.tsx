import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentExchange } from "../AgentExchange";
import { AgentSources } from "../AgentSources";
import { newExchange, type Exchange } from "../exchange";

const SOURCES = [
  { label: "block 3428143", href: "/block/3428143" },
  { label: "ZIP 2005", href: "/zips/2005" },
];

function settled(id: number, question: string): Exchange {
  return {
    ...newExchange(id, question, 1_000),
    answer: "Ironwood is the fourth shielded pool.",
    sources: SOURCES,
    steps: [],
    status: "complete",
  };
}

describe("AgentSources", () => {
  it("starts closed: the toggle says so and no link is exposed", () => {
    render(<AgentSources sources={SOURCES} />);
    const toggle = screen.getByRole("button", { name: /Sources \(2\)/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("+");
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list?.hidden).toBe(true);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("opens on + and closes again on −", () => {
    render(<AgentSources sources={SOURCES} />);
    const toggle = screen.getByRole("button", { name: /Sources \(2\)/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("−");
    const link = screen.getByRole("link", { name: /block 3428143/ });
    expect(link.getAttribute("href")).toBe("/block/3428143");
    // A new tab, so following a source does not destroy the conversation it is evidence for.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps each turn's state its own", () => {
    const noop = () => {};
    const turn = (exchange: Exchange) => (
      <AgentExchange
        key={exchange.id}
        exchange={exchange}
        live={false}
        editable={false}
        busy={false}
        retryable={false}
        separated={exchange.id > 1}
        onEdit={noop}
        onAskAgain={noop}
      />
    );
    render(<div>{[settled(1, "first"), settled(2, "second")].map(turn)}</div>);

    const [first, second] = screen.getAllByRole("article");
    if (first === undefined || second === undefined) throw new Error("expected two turns");
    fireEvent.click(within(first).getByRole("button", { name: /Sources/ }));

    expect(
      within(first)
        .getByRole("button", { name: /Sources/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(second)
        .getByRole("button", { name: /Sources/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
