import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReorgEvent, ReorgSummary } from "@/domain";
import { ReorgsPage } from "../ReorgsPage";

const event: ReorgEvent = {
  id: 1,
  detectedAt: 1_783_700_000,
  height: 2_481_020,
  depth: 1,
  orphanedHash: "0d".repeat(32),
  replacedBy: "b2".repeat(32),
};

const summary: ReorgSummary = {
  observedCount: 1,
  deepestDepth: 1,
  observingSince: 1_782_000_000,
};

function renderPage(events: ReorgEvent[], sum: ReorgSummary = summary) {
  render(
    <ReorgsPage
      events={events}
      summary={sum}
      now={1_783_875_480}
      newerHref={null}
      olderHref={null}
      newestHref={null}
      oldestHref={null}
    />,
  );
}

describe("ReorgsPage", () => {
  it("links the replacing hash and never the orphaned one", () => {
    renderPage([event]);

    const replacing = screen.getByRole("link", { name: /b2b2b2b2…b2b2b2b2/ });
    expect(replacing.getAttribute("href")).toBe(`/block/${"b2".repeat(32)}`);

    // The orphan is display + copy only: the block is gone, a link would 404.
    expect(screen.queryByRole("link", { name: /0d0d0d0d/ })).toBeNull();
    expect(screen.getByText("0d0d0d0d…0d0d0d0d")).toBeDefined();
    expect(screen.getByText("no longer in the chain")).toBeDefined();
  });

  it("says depth-1 reorgs are routine, so a normal number never reads as an alarm", () => {
    renderPage([event]);
    expect(screen.getByText(/routine on a proof-of-work chain/)).toBeDefined();
    expect(screen.getByText(/not a census of the network/)).toBeDefined();
  });

  it("explains an empty log instead of rendering a bare table", () => {
    renderPage([], { observedCount: 0, deepestDepth: null, observingSince: 1_782_000_000 });
    expect(screen.getByText(/No reorgs observed yet/)).toBeDefined();
    // Both the empty state and the explainer refuse backdating — either match suffices.
    expect(
      screen.getAllByText(/nothing here is backdated|no source to backdate/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("none yet")).toBeDefined();
  });
});
