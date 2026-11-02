import type { Findings } from "./checks";
import { checkFresh, compareRows, daysOf, isMainnetTransparentAddress, upTo } from "./site-checks";
import type { SiteInputs } from "./site-series";
import { MINER_KINDS } from "./site-stream";
import type { SiteViews } from "./site-views";

/**
 * `mining_payouts_daily`, read from the site's `mining_day_payout`: blocks, reward and fee share
 * per (day, miner kind, payout address). Every day must add up to the export's own blocks: the
 * same blocks, of the same kinds, the same transparent rewards and the same fee share, so the
 * tracker's NU7 rule and its coverage are both checked. `mining_day` is read only to require that
 * no published day still had blocks without a recorded miner.
 */

type Row = Record<string, unknown>;

const PAYOUT_KINDS = new Set<string>(["transparent", "shielded", "unknown"]);

/** A row's own shape: a known kind, and a payout address exactly when the kind is transparent. */
function validate(f: Findings, rows: readonly Row[]): void {
  const addresses = new Set<string>();
  for (const r of rows) {
    const where = `${String(r.day)} ${String(r.kind)}`;
    if (!PAYOUT_KINDS.has(String(r.kind))) f.add("mining payout of an unknown kind", where);
    if ((r.kind === "transparent") !== (r.address !== null)) {
      f.add("mining payout address does not match its kind", where);
    }
    if (r.address !== null) addresses.add(String(r.address));
    if (r.reward_zat !== null && r.kind !== "transparent") {
      f.add("mining payout reward on a non-transparent kind", where);
    }
    if ((r.fee_blocks as number) > (r.blocks as number)) {
      f.add("mining payout with more fee blocks than blocks", where);
    }
  }
  for (const a of addresses) {
    if (!isMainnetTransparentAddress(a)) {
      // The value itself is never echoed: it failed validation, so it could be anything.
      f.add("mining payout address is not a mainnet t-address", `${a.length} characters`);
    }
  }
}

interface DayPayouts {
  blocks: number;
  feeBlocks: number;
  fee: bigint;
  /** Null once a transparent row's reward is unknown, as the stream's is for any such block. */
  reward: bigint | null;
  kinds: Map<string, number>;
}

/** Per day, the payout rows summed the way the stream counts its blocks. */
function perDay(rows: readonly Row[]): Row[] {
  const days = new Map<string, DayPayouts>();
  for (const r of rows) {
    const day = String(r.day);
    const d = days.get(day) ?? { blocks: 0, feeBlocks: 0, fee: 0n, reward: 0n, kinds: new Map() };
    const n = r.blocks as number;
    d.blocks += n;
    d.feeBlocks += r.fee_blocks as number;
    d.fee += r.fee_zat as bigint;
    d.kinds.set(String(r.kind), (d.kinds.get(String(r.kind)) ?? 0) + n);
    if (r.kind === "transparent") {
      const reward = r.reward_zat as bigint | null;
      d.reward = d.reward === null || reward === null ? null : d.reward + reward;
    }
    days.set(day, d);
  }
  return [...days].map(([day, d]) => ({
    day,
    blocks: d.blocks,
    fee_blocks: d.feeBlocks,
    fee_zat: d.fee,
    reward_zat: d.reward,
    ...Object.fromEntries(MINER_KINDS.map((k) => [`${k}_blocks`, d.kinds.get(k) ?? 0])),
  }));
}

export function miningPayouts(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  const blocks = new Map(x.blocksDaily.map((b) => [String(b.day), b]));
  if (v.check_mining_day) {
    compareRows(
      f,
      {
        name: "the stream",
        against: "mining_day",
        key: ["day"],
        columns: ["blocks", "unrecorded_blocks"],
      },
      x.blocksDaily.map((b) => ({ day: b.day, blocks: b.blocks, unrecorded_blocks: 0 })),
      upTo(v.check_mining_day, x.finalDay),
    );
  }
  if (!v.mining_payouts_daily) return [];
  checkFresh(f, "mining_day_payout", daysOf(v.mining_payouts_daily), x.finalDay);
  const rows = upTo(v.mining_payouts_daily, x.finalDay);
  validate(f, rows);
  compareRows(
    f,
    {
      name: "mining_payouts_daily",
      against: "the stream",
      key: ["day"],
      columns: [
        "blocks",
        "fee_blocks",
        "fee_zat",
        "reward_zat",
        ...MINER_KINDS.map((k) => `${k}_blocks`),
      ],
    },
    perDay(rows),
    x.stream.minerRows(x.finalDay).map((m) => {
      const b = blocks.get(String(m.day));
      return { ...m, blocks: b?.blocks, fee_blocks: b?.blocks_with_fees };
    }),
  );
  return rows;
}
