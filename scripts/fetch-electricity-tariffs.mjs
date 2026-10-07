/**
 * Refreshes src/data/electricity/tariffs.generated.json from GlobalPetrolPrices.com.
 *
 *   node scripts/fetch-electricity-tariffs.mjs            # write, if the read is whole
 *   node scripts/fetch-electricity-tariffs.mjs --check    # fetch and diff, write nothing
 *
 * Run by hand, monthly. The output is committed and the site never talks to this host at
 * runtime: a committed script re-derives a committed file, the diff is reviewable, and the file
 * carries the day it was read. That day is stamped here and must never be edited by hand.
 *
 * Where the data is:
 * - The map page's "Download" button saves a PNG of its Google GeoChart, not data, and
 *   "Download data" is the paid dataset.
 * - The ranking table at /electricity_prices/ shows multi-year averages, not the quarter.
 * - Each map page embeds the current quarter as JSON in its source:
 *   `var cData = [{country_name, currency_code, code, code2, price}, …]` — `code` is ISO2
 *   (South American rows carry a "|S" GeoChart-region suffix to strip), `code2` is ISO3,
 *   `price` is USD per kWh, all taxes included. Household is the "average" series; business
 *   is the "industrial" series (the site's own 1,000,000 kWh/yr band).
 * - The quarter label is only stated on the ranking page, so it is read from there.
 *
 * A refresh is whole or kept: either series empty, any malformed row, or a row count below the
 * floor fails without writing. Zero rows is never an empty dataset.
 *
 * Licence: CC BY-NC-ND 3.0, reproduced with attribution. The page credits the source by name
 * with a link.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const HOST = process.env.GPP_URL ?? "https://www.globalpetrolprices.com";
const OUT = "src/data/electricity/tariffs.generated.json";
const SERIES = {
  household: `${HOST}/map/electricity_average/`,
  business: `${HOST}/map/electricity_industrial/`,
};
const TABLE = `${HOST}/electricity_prices/`;
/** Below this many rows something upstream changed shape; refuse rather than shrink the map. */
const MIN_ROWS = 120;
const UA = "Mozilla/5.0 (shieldedscan tariff refresh; monthly; contact via shieldedscan.xyz)";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.text();
}

/**
 * The venue's `code2` is ISO 3166-1 alpha-3 everywhere but here: Costa Rica is published as
 * "CRC", the colón's currency code, not the country's (CRI). Corrected at the parse boundary so
 * the committed file is keyed by the real ISO code. Add to this table only when a row fails the
 * geometry test, never by guessing.
 */
const ISO3_CORRECTIONS = { CRC: "CRI" };

export function extractCData(html) {
  const marker = "var cData = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("no `var cData` in page — the page shape changed");
  const end = html.indexOf("];", start);
  const rows = JSON.parse(html.slice(start + marker.length, end + 1));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("cData is empty");
  return rows.map((r) => {
    const iso2 = String(r.code).split("|")[0];
    const iso3 = ISO3_CORRECTIONS[String(r.code2)] ?? String(r.code2);
    const usdPerKwh = Number(r.price);
    if (!/^[A-Z]{2}$/.test(iso2) || !/^[A-Z]{3}$/.test(iso3)) {
      throw new Error(`malformed country code in row ${JSON.stringify(r)}`);
    }
    if (!Number.isFinite(usdPerKwh) || usdPerKwh <= 0) {
      throw new Error(`malformed price in row ${JSON.stringify(r)}`);
    }
    return { iso2, iso3, name: String(r.country_name).trim(), usdPerKwh };
  });
}

export function extractQuarter(html) {
  // The page lists several quarter labels (the columns of its change table); the newest is
  // the one the map pages are serving.
  const labels = [...html.matchAll(/Q([1-4]) (20\d\d)/g)].map((m) => ({
    q: Number(m[1]),
    y: Number(m[2]),
  }));
  if (labels.length === 0) throw new Error("no quarter label on the ranking page");
  labels.sort((a, b) => b.y - a.y || b.q - a.q);
  return `Q${labels[0].q} ${labels[0].y}`;
}

export function merge(household, business) {
  const byIso3 = new Map();
  for (const r of household) {
    byIso3.set(r.iso3, { ...r, householdUsdKwh: r.usdPerKwh, businessUsdKwh: null });
  }
  for (const r of business) {
    const cur = byIso3.get(r.iso3);
    if (cur) cur.businessUsdKwh = r.usdPerKwh;
    else byIso3.set(r.iso3, { ...r, householdUsdKwh: null, businessUsdKwh: r.usdPerKwh });
  }
  return [...byIso3.values()]
    .map(({ iso2, iso3, name, householdUsdKwh, businessUsdKwh }) => ({
      iso2,
      iso3,
      name,
      householdUsdKwh,
      businessUsdKwh,
    }))
    .sort((a, b) => a.iso3.localeCompare(b.iso3));
}

function diffSummary(prev, next) {
  if (!prev) return "no previous file";
  const p = new Map(prev.rows.map((r) => [r.iso3, r]));
  const n = new Map(next.rows.map((r) => [r.iso3, r]));
  const added = [...n.keys()].filter((k) => !p.has(k));
  const removed = [...p.keys()].filter((k) => !n.has(k));
  const moves = [];
  for (const [k, r] of n) {
    const o = p.get(k);
    if (!o) continue;
    for (const f of ["householdUsdKwh", "businessUsdKwh"]) {
      if (o[f] != null && r[f] != null && o[f] !== r[f]) {
        moves.push({ k, f, from: o[f], to: r[f], pct: ((r[f] - o[f]) / o[f]) * 100 });
      }
    }
  }
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return [
    `quarter ${prev.quarter} → ${next.quarter}; rows ${prev.rows.length} → ${next.rows.length}`,
    `added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"}`,
    `${moves.length} values moved; largest:`,
    ...moves.slice(0, 8).map((m) => `  ${m.k} ${m.f} ${m.from} → ${m.to} (${m.pct.toFixed(1)}%)`),
  ].join("\n");
}

async function main() {
  const check = process.argv.includes("--check");
  const [hh, bh, th] = await Promise.all([
    fetchText(SERIES.household),
    fetchText(SERIES.business),
    fetchText(TABLE),
  ]);
  const household = extractCData(hh);
  const business = extractCData(bh);
  if (household.length < MIN_ROWS || business.length < MIN_ROWS * 0.9) {
    throw new Error(
      `too few rows (household ${household.length}, business ${business.length}); refusing to write`,
    );
  }
  const next = {
    source: "GlobalPetrolPrices.com",
    sourceUrls: [SERIES.household, SERIES.business, TABLE],
    licence: "CC BY-NC-ND 3.0",
    bands: {
      household: "average annual household consumption, all taxes included",
      business: "1,000,000 kWh per year, all taxes included",
    },
    quarter: extractQuarter(th),
    readOn: new Date().toISOString().slice(0, 10),
    rows: merge(household, business),
  };
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  console.log(diffSummary(prev, next));
  if (check) {
    console.log("--check: nothing written");
    return;
  }
  writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote ${OUT}: ${next.rows.length} countries, ${next.quarter}, read ${next.readOn}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
