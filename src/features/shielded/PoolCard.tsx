import type { ShieldedPool } from "@/domain";
import { Panel } from "@/components/Panel";
import { PrivacyShield } from "@/components/PrivacyShield";
import { formatZecCompact } from "@/lib/format";

const meta: Record<ShieldedPool["pool"], { name: string; sub: string }> = {
  ironwood: { name: "Ironwood", sub: "NU6.3 (2026) — turnstile-guarded" },
  orchard: { name: "Orchard", sub: "NU5 (2022) — current standard" },
  sapling: { name: "Sapling", sub: "2018 — still active" },
  sprout: { name: "Sprout", sub: "2016 — legacy, winding down" },
};

/**
 * The pool's label, or the pool's own name for one this build has never heard of.
 *
 * The API deploys separately and first, so it may know a pool this build does not; an
 * unguarded lookup would take `/shielded` down. Dropping the row would be worse:
 * `totalShieldedZat` sums every pool it is given, so a hidden card would leave the headline
 * total unexplained by the cards beneath it. Naming the pool and saying nothing else is the
 * honest degradation.
 */
function poolMeta(pool: string): { name: string; sub: string } {
  return meta[pool as ShieldedPool["pool"]] ?? { name: pool, sub: "pool not known to this build" };
}

/**
 * Segmented amber gauge — hand-rolled SVG, dashes echoing the redaction bars.
 * Amber because this is chart territory: a magnitude, not a privacy kind.
 */
function PoolGauge({ pct }: { pct: number }) {
  const w = 200;
  const h = 12;
  const inset = 2;
  const span = (Math.max(0, Math.min(100, pct)) / 100) * (w - inset * 2);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-3 w-full"
      role="img"
      aria-label={`${pct.toFixed(1)}% of the shielded supply`}
      preserveAspectRatio="none"
    >
      <rect
        x="0.5"
        y="0.5"
        width={w - 1}
        height={h - 1}
        rx="2"
        fill="var(--series-wash)"
        stroke="var(--series-edge)"
      />
      {span > 1 ? (
        <line
          x1={inset}
          y1={h / 2}
          x2={inset + span}
          y2={h / 2}
          stroke="var(--series)"
          strokeWidth={h - inset * 2 - 1}
          strokeDasharray="4 2"
          opacity={0.85}
        />
      ) : null}
    </svg>
  );
}

export interface PoolCardProps {
  pool: ShieldedPool;
  /** True from NU7, which disallows v4 transactions and with them every Sprout spend (ZIP 2003). */
  sproutFrozen?: boolean;
  /** This pool's share of the total shielded supply, 0–100. */
  sharePct: number;
}

export function PoolCard({ pool, sharePct, sproutFrozen = false }: PoolCardProps) {
  const base = poolMeta(pool.pool);
  const m =
    pool.pool === "sprout" && sproutFrozen
      ? { ...base, sub: "2016 — frozen since NU7, can no longer be spent" }
      : base;
  return (
    <Panel density="compact" className="flex-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <PrivacyShield variant="shielded" />
          <span className="text-sm font-semibold text-ink-bright">{m.name}</span>
        </span>
        <span className="text-xs text-ink-dim tabular-nums">{sharePct.toFixed(1)}%</span>
      </div>
      <div className="mt-2 text-xl font-bold tracking-tight text-ink-bright">
        {formatZecCompact(pool.balanceZat)}
      </div>
      <PoolGauge pct={sharePct} />
      <div className="mt-2 text-xs text-ink-faint">{m.sub}</div>
    </Panel>
  );
}
