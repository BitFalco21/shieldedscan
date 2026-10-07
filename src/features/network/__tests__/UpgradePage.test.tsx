import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { NU7 } from "@/domain";
import { UpgradePage } from "../upgrade/UpgradePage";

const releases = await fixtureDataSource.getNetworkReleases();

describe("UpgradePage", () => {
  it("leads with the strict figure: no release can activate NU7 before the height exists", () => {
    const { container } = render(<UpgradePage releases={releases} />);
    const headline = container.querySelector("[data-upgrade-headline]")!.textContent!;
    expect(headline).toMatch(/^0 of 40 answering nodes run a release that can activate NU7/);
    expect(container.textContent).toContain("to be set on October 20");
    // Fixture Zakura 1.5/1.6 declare 170190 without being ready — the case the tab exists for.
    expect(container.querySelectorAll('[data-release-state="ready"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-release-state="declares"]').length).toBeGreaterThan(0);
  });

  it("states the protocol-version count separately and never as readiness", () => {
    const { container } = render(<UpgradePage releases={releases} />);
    expect(container.textContent).toContain("declare 170190+");
    expect(container.textContent).toContain("The protocol version alone is not readiness");
    expect(container.textContent).not.toMatch(/\d+% ready/);
  });

  it("counts a release as ready once one carries the mainnet height", () => {
    const { container } = render(
      <UpgradePage
        releases={releases}
        upgrade={{ ...NU7, activationHeight: { ...NU7.activationHeight, mainnet: 3_600_000 } }}
        upgradeReleases={[
          {
            client: "Zakura",
            firstVersion: "1.6.0",
            network: "mainnet",
            source: "https://example.invalid/notes",
            verifiedOn: "2026-10-21",
          },
        ]}
      />,
    );
    const headline = container.querySelector("[data-upgrade-headline]")!.textContent!;
    expect(headline).toMatch(/^5 of 40/);
    expect(container.querySelectorAll('[data-release-state="ready"]')).toHaveLength(1);
    expect(container.textContent).toContain("3,600,000");
  });

  it("counts behind-the-tip nodes over the nodes whose height could be compared", () => {
    const { container } = render(<UpgradePage releases={releases} />);
    // Fixture: three nodes far behind, two that declared no height.
    expect(container.textContent).toContain("of 38 · over 10 blocks at last answer");
  });

  it("says when the daily record is too short to draw a line, rather than drawing one point", () => {
    const { container } = render(
      <UpgradePage releases={{ ...releases, history: releases.history.slice(-1) }} />,
    );
    expect(container.textContent).toMatch(/Recording since \d{4}-\d{2}-\d{2}/);
    expect(container.querySelector("svg[role='img']")).toBeNull();
  });
});
