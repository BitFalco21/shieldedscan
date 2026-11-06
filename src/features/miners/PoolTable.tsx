"use client";

import { Fragment, useState } from "react";
import {
  blockSharePct,
  type MinerAddressRow,
  type MinersOverview,
  type MiningPoolGroup,
} from "@/domain";
import { DataTable, type TableColumn } from "@/components/DataTable";
import Link from "@/components/Link";
import { MiningPoolMark } from "@/components/MiningPoolMark";
import { Redacted } from "@/components/Redacted";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatSharePct } from "@/lib/format";
import { miningGroupClass } from "@/lib/mining-pool-palette";
import { PoolAddressRows } from "./PoolAddressRows";
import { grouped, usdText, zecShort } from "./miners-view";

export interface PoolTableProps {
  overview: MinersOverview;
  livePriceUsd: number | null;
}

const WIDE = "hidden sm:table-cell";

const COLUMNS: TableColumn[] = [
  { label: "POOL" },
  { label: "BLOCKS", align: "right", className: WIDE },
  { label: "SHARE", align: "right" },
  { label: "ZEC", align: "right" },
  { label: "USD", align: "right", className: WIDE },
  { label: "ADDR", align: "right", className: WIDE },
];

/** Pool names link to their page, lit green on hover, focus and press. */
const POOL_LINK =
  "font-bold text-ink-bright hover:text-green focus-visible:text-green active:text-green";

/**
 * Pools by blocks over the window, each the sum of its reviewed payout addresses; a row opens to
 * list them. Unattributed addresses are one row that opens to the largest of them, never merged
 * into an operator; a shielded coinbase is counted and its amounts veiled.
 */
export function PoolTable({ overview, livePriceUsd }: PoolTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const { pools, strays } = grouped(overview);
  const share = (blocks: number) => {
    const pct = blockSharePct(blocks, overview.blocks);
    return pct === null ? "—" : formatSharePct(pct);
  };
  const zec = (zat: number | null) => (zat === null ? <Unmeasured /> : zecShort(zat));
  const usd = (zat: number | null, parts: MiningPoolGroup["usd"]) =>
    usdText(zat, parts, livePriceUsd) ?? <Unmeasured />;
  const toggle = (key: string) => setOpen(open === key ? null : key);
  const disclosure = (key: string, label: string) => (
    <button
      type="button"
      aria-expanded={open === key}
      aria-controls={`addresses-${key}`}
      aria-label={`${open === key ? "Hide" : "Show"} ${label}'s payout addresses`}
      onClick={() => toggle(key)}
      className="mr-2 w-3 cursor-pointer text-xs text-ink-faint hover:text-green"
    >
      {open === key ? "▾" : "▸"}
    </button>
  );
  const addressRows = (key: string, rows: readonly MinerAddressRow[]) =>
    open === key ? (
      <PoolAddressRows id={`addresses-${key}`} rows={rows} livePriceUsd={livePriceUsd} />
    ) : null;

  return (
    <DataTable caption="Mining pools by blocks in the window" columns={COLUMNS}>
      {pools.map((g) => (
        <Fragment key={g.pool.id}>
          <tr className="row-hover hairline-b">
            <td>
              <span className="flex items-center gap-2 whitespace-nowrap">
                {disclosure(g.pool.id, g.pool.name)}
                <MiningPoolMark miningPool={g.pool} />
                <Link href={`/miners/${g.pool.id}`} className={POOL_LINK}>
                  {g.pool.name}
                </Link>
              </span>
            </td>
            <td className={`${WIDE} text-right tabular-nums`}>{formatCount(g.blocks)}</td>
            <td className="text-right text-ink-dim tabular-nums">{share(g.blocks)}</td>
            <td className="text-right tabular-nums">{zec(g.rewardZat)}</td>
            <td className={`${WIDE} text-right text-ink-dim tabular-nums`}>
              {usd(g.rewardZat, g.usd)}
            </td>
            <td className={`${WIDE} text-right text-ink-faint tabular-nums`}>
              {g.addresses.length}
            </td>
          </tr>
          {addressRows(g.pool.id, g.addresses)}
        </Fragment>
      ))}

      {strays.length > 0 ? (
        <Fragment>
          <tr className="row-hover hairline-b">
            <td>
              {disclosure("strays", "other labelled pools")}
              <span className="text-ink-dim">other labelled pools</span>
            </td>
            <td className={`${WIDE} text-right tabular-nums`}>
              {formatCount(strays.reduce((s, r) => s + r.blocks, 0))}
            </td>
            <td className="text-right text-ink-dim tabular-nums">
              {share(strays.reduce((s, r) => s + r.blocks, 0))}
            </td>
            <td colSpan={3} className="text-right text-ink-faint">
              by address
            </td>
          </tr>
          {addressRows("strays", strays)}
        </Fragment>
      ) : null}

      {overview.unattributed.blocks > 0 ? (
        <Fragment>
          <tr className="row-hover hairline-b">
            <td>
              <span className="flex items-center gap-2">
                {disclosure("unattributed", "unattributed")}
                <span aria-hidden className={`${miningGroupClass("unattributed")} text-xs`}>
                  ▉
                </span>
                <span className="text-ink-dim">
                  unattributed · {formatCount(overview.unattributed.addresses)}{" "}
                  {overview.unattributed.addresses === 1 ? "address" : "addresses"}
                </span>
              </span>
            </td>
            <td className={`${WIDE} text-right tabular-nums`}>
              {formatCount(overview.unattributed.blocks)}
            </td>
            <td className="text-right text-ink-dim tabular-nums">
              {share(overview.unattributed.blocks)}
            </td>
            <td className="text-right tabular-nums">{zec(overview.unattributed.rewardZat)}</td>
            <td className={`${WIDE} text-right text-ink-dim tabular-nums`}>
              {usd(overview.unattributed.rewardZat, overview.unattributed.usd)}
            </td>
            <td className={`${WIDE} text-right text-ink-faint tabular-nums`}>
              {formatCount(overview.unattributed.addresses)}
            </td>
          </tr>
          {addressRows("unattributed", overview.unattributed.largest)}
        </Fragment>
      ) : null}

      {overview.shieldedBlocks > 0 ? (
        <tr className="row-hover hairline-b">
          <td>
            <span className="flex items-center gap-2 pl-5 whitespace-nowrap">
              <span aria-hidden className={`${miningGroupClass("shielded")} text-xs`}>
                ▉
              </span>
              <span className="text-ink-dim">shielded coinbase</span>
            </span>
          </td>
          <td className={`${WIDE} text-right tabular-nums`}>
            {formatCount(overview.shieldedBlocks)}
          </td>
          <td className="text-right text-ink-dim tabular-nums">{share(overview.shieldedBlocks)}</td>
          <td className="text-right">
            <Redacted glyphs={4} label="paid into a shielded pool: amount encrypted" />
          </td>
          <td className={`${WIDE} text-right`}>
            <Redacted glyphs={4} label="paid into a shielded pool: amount encrypted" />
          </td>
          <td className={WIDE} />
        </tr>
      ) : null}

      {overview.noAddressBlocks > 0 ? (
        <tr className="row-hover hairline-b">
          <td className="pl-5 text-ink-dim">no address · bare public key</td>
          <td className={`${WIDE} text-right tabular-nums`}>
            {formatCount(overview.noAddressBlocks)}
          </td>
          <td className="text-right text-ink-dim tabular-nums">
            {share(overview.noAddressBlocks)}
          </td>
          <td className="text-right">
            <Unmeasured />
          </td>
          <td className={WIDE} />
          <td className={WIDE} />
        </tr>
      ) : null}

      <tr>
        <td className="pl-5 text-ink-dim">all blocks</td>
        <td className={`${WIDE} text-right tabular-nums`}>{formatCount(overview.blocks)}</td>
        <td className="text-right text-ink-dim tabular-nums">
          {overview.blocks > 0 ? "100%" : "—"}
        </td>
        <td className="text-right whitespace-nowrap tabular-nums">
          {zec(overview.transparent.rewardZat)}
          {overview.shieldedBlocks > 0 ? (
            <>
              {" + "}
              <Redacted glyphs={2} label="plus the shielded coinbase amounts, encrypted" />
            </>
          ) : null}
        </td>
        <td className={`${WIDE} text-right whitespace-nowrap text-ink-dim tabular-nums`}>
          {/* A dollar figure only ever sits beside a public ZEC amount, never beside a veil. */}
          {usd(overview.transparent.rewardZat, overview.transparent.usd)}
        </td>
        <td className={WIDE} />
      </tr>
    </DataTable>
  );
}
