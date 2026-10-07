import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { HealthPage } from "../health/HealthPage";
import { SoftwarePage } from "../software/SoftwarePage";

/**
 * The two static tabs, rendered from the fixtures. Pinned: every share prints beside its
 * denominator, the newest release and protocol version are tagged as the newest seen rather
 * than as current, the health tab refuses a score in as many words, the /24 label never
 * carries a fourth octet, and neither tab carries an inline style or an address.
 */

const summary = await fixtureDataSource.getNetworkSummary();
const health = await fixtureDataSource.getNetworkHealth();
const peers = await fixtureDataSource.getNetworkPeers();

describe("SoftwarePage", () => {
  it("draws every client's share, and NO per-client answer-rate comparison", () => {
    // No per-client crawl-answer comparison: it would measure our one-shared-address refusal per
    // client (Zebra-family nodes accept one connection per address), not node quality.
    const { container } = render(<SoftwarePage summary={summary} />);
    expect(container.querySelectorAll(".net-stack svg")).toHaveLength(summary.clients.length);
    expect(container.textContent).toContain(`${summary.reachable} nodes`);
    expect(container.textContent).not.toMatch(/answers our crawls/i);
    for (const c of summary.clients) {
      expect(container.textContent).not.toContain(
        `${c.answerRate.numerator.toLocaleString("en-US")} of ${c.answerRate.denominator.toLocaleString("en-US")}`,
      );
    }
  });

  it("tags the newest release per client and the newest protocol version as SEEN, never current", () => {
    const { container } = render(<SoftwarePage summary={summary} />);
    expect(container.textContent).toContain("newest seen");
    expect(container.textContent).toContain("newest declared");
    expect(container.textContent).not.toMatch(/\bcurrent\b/);
    expect(container.textContent).toContain("6.3.0");
  });

  it("counts a client whose nodes declare no version", () => {
    render(<SoftwarePage summary={summary} />);
    expect(screen.getAllByText(/declare no version|declares no version/).length).toBeGreaterThan(0);
  });

  it("draws Zebra in stripes and the others solid", () => {
    const { container } = render(<SoftwarePage summary={summary} />);
    expect(container.querySelectorAll(".net-client-zebra .net-bar-stripe").length).toBeGreaterThan(
      0,
    );
    expect(container.querySelectorAll(".net-client-zakura .net-bar-stripe")).toHaveLength(0);
  });

  it("carries no inline style and no address-shaped string", () => {
    const { container } = render(<SoftwarePage summary={summary} />);
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});

describe("HealthPage", () => {
  it("refuses a health score in as many words and nowhere else", () => {
    const { container } = render(<HealthPage health={health} peers={peers} />);
    const text = container.textContent ?? "";
    expect(text).toContain("No health score.");
    expect(text.replace("No health score.", "")).not.toMatch(/health score/i);
  });

  it("states that the real concentration can only be higher than the reachable set shows", () => {
    const { container } = render(<HealthPage health={health} peers={peers} />);
    const t = health.concentration.top3;
    expect(container.textContent).toContain(
      `Three networks host ${t.numerator} of ${t.denominator}`,
    );
    expect(container.textContent).toContain("concentration can only be higher");
  });

  it("draws the reliability histogram with a bar per bucket, and no latency at all", () => {
    const { container } = render(<HealthPage health={health} peers={peers} />);
    const hists = container.querySelectorAll(".net-hist");
    expect(hists).toHaveLength(1);
    expect(hists[0]!.querySelectorAll("rect")).toHaveLength(health.uptime.buckets.length);
    expect(container.textContent).toContain("every crawl");
    expect(container.textContent).not.toMatch(/latency|Vienna|\bms\b/);
  });

  it("names a shared /24 as a label with an x, and our node's peers as ours", () => {
    const { container } = render(<HealthPage health={health} peers={peers} />);
    expect(container.textContent).toContain("10.0.7.x");
    expect(container.textContent).toContain(`holds ${peers!.count} peers`);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it("says nothing about our node when it was not read", () => {
    const { container } = render(<HealthPage health={health} peers={null} />);
    expect(container.textContent).not.toContain("Our own node currently holds");
    expect(container.textContent).toContain("Nodes behind NAT");
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
  });
});
