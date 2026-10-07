import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { BADGE_BASE, Badge, type BadgeTone } from "../Badge";
import { KindPill } from "../KindPill";
import { POOL_INK, PoolBadge, type TxTypeName } from "../PoolBadge";
import { StatusPill } from "../StatusPill";

/**
 * One pill size for the site, so two pills in one table row are the same height. These pin the
 * property, not a pixel: every pill renders the shared base classes.
 */

const BASE = BADGE_BASE.split(" ");

function hasBase(el: Element | null): boolean {
  const classes = new Set((el?.getAttribute("class") ?? "").split(/\s+/));
  return BASE.every((c) => classes.has(c));
}

const tx: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 1,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: 140,
  rawHex: null,
  feeZat: 10_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: { actions: 2, valueBalanceZat: -10_000 },
  ironwood: null,
};

describe("Badge", () => {
  it("draws its label at the shared size, in the tone asked for", () => {
    render(<Badge tone="accent">listed</Badge>);
    const badge = screen.getByText("listed");
    expect(hasBase(badge)).toBe(true);
    expect(badge.className).toContain("text-green");
    expect(badge.className).not.toContain("border-dashed");
  });

  it("dashes the edge for something not settled, and draws its icon before the label", () => {
    const { container } = render(
      <Badge tone="outline" dashed icon={<i data-testid="icon" />}>
        pending
      </Badge>,
    );
    const badge = container.firstElementChild!;
    expect(badge.className).toContain("border-dashed");
    expect(badge.firstElementChild).toBe(screen.getByTestId("icon"));
  });

  it("never reaches for a colour outside this site's tokens — no flow palette, no amber", () => {
    const tones = ["accent", "dim", "outline", "neutral", "faint", "bright", "filled", "warn"];
    for (const tone of tones as BadgeTone[]) {
      const { container, unmount } = render(<Badge tone={tone}>x</Badge>);
      expect(container.firstElementChild!.className).not.toMatch(/flow-|amber/);
      unmount();
    }
  });

  it("takes a categorical hue only when asked, at the same size", () => {
    const { container } = render(
      <Badge tone="hue" hue="flow-2">
        updated
      </Badge>,
    );
    const el = container.firstElementChild!;
    expect(hasBase(el)).toBe(true);
    expect(el.className).toContain("flow-2");
    expect(el.className).toContain("border-current/40");
    // A hue passed with any other tone is ignored: the tones stay the site's tokens.
    const { container: other } = render(
      <Badge tone="neutral" hue="flow-2">
        x
      </Badge>,
    );
    expect(other.firstElementChild!.className).not.toContain("flow-2");
  });
});

describe("every pill on the site shares the badge size", () => {
  it("PoolBadge, KindPill and StatusPill all render the shared base", () => {
    const { container } = render(
      <div>
        <PoolBadge pool="orchard" />
        <PoolBadge pool="transparent" shield />
        <KindPill tx={tx} />
        <StatusPill status="pending" />
      </div>,
    );
    const pills = Array.from(container.firstElementChild!.children);
    expect(pills).toHaveLength(4);
    for (const pill of pills) expect(hasBase(pill), pill.outerHTML.slice(0, 120)).toBe(true);
  });
});

describe("PoolBadge's text form — the DIRECTION column", () => {
  const POOLS: TxTypeName[] = [
    "ironwood",
    "orchard",
    "sapling",
    "sprout",
    "transparent",
    "coinbase",
    "mined",
  ];

  it("has no box: no border, no padding", () => {
    const { container } = render(<PoolBadge pool="orchard" variant="text" />);
    const el = container.firstElementChild!;
    expect(el.className).not.toMatch(/\bborder\b|\bpx-|\bpy-|rounded/);
    expect(el.textContent).toBe("orchard");
  });

  it.each(POOLS)("writes %s in the same ink as its chip", (pool) => {
    const ink = (variant: "chip" | "text") => {
      const { container, unmount } = render(<PoolBadge pool={pool} variant={variant} />);
      const found = container.firstElementChild!.className.match(/\btext-(?:green|ink)[a-z-]*/g);
      unmount();
      return found;
    };
    expect(ink("text")).toEqual(ink("chip"));
    expect(ink("text")).toEqual([POOL_INK[pool]]);
  });
});
