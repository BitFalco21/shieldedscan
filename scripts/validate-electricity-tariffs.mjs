/**
 * The tariff alignment check, run against two official statistical offices.
 *
 *   node scripts/validate-electricity-tariffs.mjs            # print the deviations
 *   node scripts/validate-electricity-tariffs.mjs --write    # also record the summary
 *
 * `npm run tariffs:validate`. The committed GlobalPetrolPrices rows (`tariffs.generated.json`)
 * are the one source the page renders, and nothing on the chain can check them. So they are
 * held against two bodies that publish the same figure independently:
 *
 * - Eurostat — `nrg_pc_205` (industrial, band 500–1,999 MWh/yr, which contains GPP's
 *   1,000,000 kWh/yr business tariff) and `nrg_pc_204` (household, band 2,500–4,999 kWh/yr,
 *   the "DC" band Eurostat treats as the typical household), both all taxes and levies included
 *   (`tax=I_TAX`), in EUR per kWh, bi-annual. Converted to USD at the mean ECB reference rate
 *   over the semester the figure covers, via the same Frankfurter mirror `fx-history.ts` uses.
 * - EIA — `electricity/retail-sales`, U.S. total, monthly average revenue per kWh for the
 *   `COM` (commercial — the class a 1 GWh/yr buyer falls in; `IND` is printed beside it, see
 *   `main`) and `RES` (residential) sectors, averaged over the months of GPP's own quarter.
 *   Keyless through `DEMO_KEY` unless `EIA_API_KEY` is set.
 *
 * What a deviation means:
 * - The periods differ: GPP publishes a quarter, Eurostat a semester that ends before it, so
 *   part of every European deviation is time.
 * - The bands differ slightly: GPP's business series is one point inside Eurostat's band.
 * - The conversion rate is ours (a semester mean); GPP's is unstated.
 * So the median says how far GPP sits from the official series in aggregate; a single country's
 * deviation is not evidence that GPP is wrong about it.
 *
 * A run is whole or refused: an unreachable office, an unparseable body, a semester with no
 * values or too few countries all exit non-zero and write nothing. `--write` records
 * `{medianPct, p90Pct, maxPct, countries, checkedOn, …}` per arm into
 * `src/data/electricity/validation.generated.json`, which the page's provenance line reads.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TARIFFS = "src/data/electricity/tariffs.generated.json";
const OUT = "src/data/electricity/validation.generated.json";
const EUROSTAT =
  process.env.EUROSTAT_URL ?? "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const FRANKFURTER = process.env.FRANKFURTER_URL ?? "https://api.frankfurter.dev/v1";
const EIA = process.env.EIA_URL ?? "https://api.eia.gov/v2";
const UA = "shieldedscan/1.0 (+https://shieldedscan.xyz; tariff validation, monthly)";
/** Fewer overlapping countries than this and a median says nothing. */
const MIN_COUNTRIES = 15;

/**
 * Eurostat's `geo` codes are ISO 3166-1 alpha-2 except where the EU's own conventions differ.
 * Aggregates (EU27_2020, EA) are not countries and are dropped by returning null.
 */
const EUROSTAT_AGGREGATES = new Set(["EA", "EU", "EEA", "EFTA"]);

export function eurostatGeoToIso2(geo) {
  if (geo === "EL") return "GR";
  if (geo === "UK") return "GB";
  // `EA` (euro area) is two capital letters and would pass the shape test below.
  if (EUROSTAT_AGGREGATES.has(geo) || !/^[A-Z]{2}$/.test(geo)) return null;
  return geo;
}

/**
 * JSON-stat 2.0 → `{ geo, time, value }` rows. Eurostat's `value` map is keyed by the
 * row-major index over `id`'s dimension order with `size` giving each extent; the index is
 * decoded rather than assumed, because `time` is not always the last dimension.
 */
export function jsonStatRows(body) {
  const ids = body.id;
  const sizes = body.size;
  if (!Array.isArray(ids) || !Array.isArray(sizes) || ids.length !== sizes.length) {
    throw new Error("Eurostat body is not JSON-stat: id/size missing or mismatched");
  }
  const labels = ids.map((id) => {
    const index = body.dimension?.[id]?.category?.index;
    if (!index || typeof index !== "object") throw new Error(`dimension ${id} has no index`);
    // Either {code: position} or [code, ...]
    return Array.isArray(index)
      ? index
      : Object.entries(index)
          .sort((a, b) => a[1] - b[1])
          .map(([code]) => code);
  });
  const geoAt = ids.indexOf("geo");
  const timeAt = ids.indexOf("time");
  if (geoAt < 0 || timeAt < 0) throw new Error("Eurostat body lacks geo or time dimension");
  const rows = [];
  for (const [flat, value] of Object.entries(body.value ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    let rest = Number(flat);
    const coords = new Array(ids.length);
    for (let d = ids.length - 1; d >= 0; d--) {
      coords[d] = rest % sizes[d];
      rest = Math.floor(rest / sizes[d]);
    }
    rows.push({ geo: labels[geoAt][coords[geoAt]], time: labels[timeAt][coords[timeAt]], value });
  }
  return rows;
}

/**
 * The newest semester that carries at least `min` country values — a semester Eurostat has
 * created but not yet populated must not be chosen as "latest" with a few early reporters.
 */
export function newestPopulatedPeriod(rows, min = MIN_COUNTRIES) {
  const counts = new Map();
  for (const r of rows) {
    if (eurostatGeoToIso2(r.geo) === null) continue;
    counts.set(r.time, (counts.get(r.time) ?? 0) + 1);
  }
  const eligible = [...counts.entries()].filter(([, n]) => n >= min).map(([t]) => t);
  if (eligible.length === 0) return null;
  return eligible.sort().at(-1);
}

/** `2025-S2` → the calendar days it covers, as Frankfurter range endpoints. */
export function semesterRange(period) {
  const m = /^(\d{4})-S([12])$/.exec(period);
  if (!m) throw new Error(`not a semester: ${period}`);
  return m[2] === "1"
    ? { start: `${m[1]}-01-01`, end: `${m[1]}-06-30` }
    : { start: `${m[1]}-07-01`, end: `${m[1]}-12-31` };
}

/** `Q2 2026` → the EIA `YYYY-MM` months it covers. */
export function quarterMonths(label) {
  const m = /^Q([1-4]) (\d{4})$/.exec(label);
  if (!m) throw new Error(`not a quarter label: ${label}`);
  const first = (Number(m[1]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${m[2]}-${String(first + i).padStart(2, "0")}`);
}

export function mean(xs) {
  if (xs.length === 0) throw new Error("mean of nothing");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Per-country deviation of GPP from the reference, in percent OF THE REFERENCE, and the
 * summary a provenance line can quote. `signedMedianPct` is the bias (GPP above the office is
 * positive); the headline `medianPct` is over absolute deviations, since a reader asking "how
 * far off" does not want two errors of opposite sign to cancel.
 */
export function deviationStats(pairs) {
  const rows = pairs
    .filter((p) => p.reference > 0 && Number.isFinite(p.gpp))
    .map((p) => ({ ...p, pct: ((p.gpp - p.reference) / p.reference) * 100 }));
  if (rows.length === 0) return null;
  const abs = rows.map((r) => Math.abs(r.pct)).sort((a, b) => a - b);
  const signed = rows.map((r) => r.pct).sort((a, b) => a - b);
  return {
    countries: rows.length,
    medianPct: quantile(abs, 0.5),
    p90Pct: quantile(abs, 0.9),
    maxPct: abs.at(-1),
    signedMedianPct: quantile(signed, 0.5),
    worst: [...rows].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5),
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
}

async function eurostatUsdPerKwh(dataset, band) {
  const url =
    `${EUROSTAT}/${dataset}?format=JSON&lang=EN&freq=S&nrg_cons=${band}` +
    `&unit=KWH&tax=I_TAX&currency=EUR&sinceTimePeriod=2023-S1`;
  const rows = jsonStatRows(await getJson(url));
  const period = newestPopulatedPeriod(rows);
  if (period === null) throw new Error(`${dataset}: no semester since 2023 carries values`);
  const { start, end } = semesterRange(period);
  const fx = await getJson(`${FRANKFURTER}/${start}..${end}?base=EUR&symbols=USD`);
  const usdPerEur = Object.values(fx.rates ?? {})
    .map((r) => r.USD)
    .filter((x) => typeof x === "number" && x > 0);
  if (usdPerEur.length < 100) throw new Error(`ECB EUR/USD: only ${usdPerEur.length} days`);
  const rate = mean(usdPerEur);
  const byIso2 = new Map();
  for (const r of rows) {
    if (r.time !== period) continue;
    const iso2 = eurostatGeoToIso2(r.geo);
    if (iso2 !== null) byIso2.set(iso2, r.value * rate);
  }
  return { period, usdPerEur: rate, byIso2, url };
}

async function eiaUsdPerKwh(sector, months) {
  const key = process.env.EIA_API_KEY ?? "DEMO_KEY";
  const url =
    `${EIA}/electricity/retail-sales/data/?api_key=${encodeURIComponent(key)}` +
    `&frequency=monthly&data[0]=price&facets[sectorid][]=${sector}&facets[stateid][]=US` +
    `&start=${months[0]}&end=${months.at(-1)}&length=12`;
  const body = await getJson(url);
  const prices = (body.response?.data ?? [])
    .filter((d) => months.includes(d.period))
    .map((d) => Number(d.price) / 100) // cents → dollars
    .filter((x) => Number.isFinite(x) && x > 0);
  if (prices.length === 0) throw new Error(`EIA ${sector}: no months of ${months.join(",")}`);
  return { usdPerKwh: mean(prices), months: prices.length, keyed: key !== "DEMO_KEY" };
}

function compareArm(label, gppRows, field, reference) {
  const pairs = [];
  for (const row of gppRows) {
    const ref = reference.get(row.iso2);
    if (ref === undefined) continue;
    pairs.push({ iso2: row.iso2, name: row.name, gpp: row[field], reference: ref });
  }
  const stats = deviationStats(pairs);
  if (stats === null || stats.countries < MIN_COUNTRIES) {
    throw new Error(`${label}: only ${stats?.countries ?? 0} overlapping countries — unvalidated`);
  }
  console.log(
    `${label}: median |Δ| ${stats.medianPct.toFixed(1)}% · p90 ${stats.p90Pct.toFixed(1)}% · ` +
      `max ${stats.maxPct.toFixed(1)}% · bias ${stats.signedMedianPct >= 0 ? "+" : ""}` +
      `${stats.signedMedianPct.toFixed(1)}% · ${stats.countries} countries`,
  );
  for (const w of stats.worst) {
    console.log(
      `   ${w.iso2} ${w.name.padEnd(22)} GPP $${w.gpp.toFixed(3)}  ref $${w.reference.toFixed(3)}` +
        `  ${w.pct >= 0 ? "+" : ""}${w.pct.toFixed(1)}%`,
    );
  }
  return stats;
}

async function main() {
  const write = process.argv.includes("--write");
  const tariffs = JSON.parse(readFileSync(TARIFFS, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  console.log(`GPP ${tariffs.quarter}, read ${tariffs.readOn}, ${tariffs.rows.length} rows\n`);

  const [ind, hh] = await Promise.all([
    eurostatUsdPerKwh("nrg_pc_205", "MWH500-1999"),
    eurostatUsdPerKwh("nrg_pc_204", "KWH2500-4999"),
  ]);
  console.log(
    `Eurostat ${ind.period} at mean ECB ${ind.usdPerEur.toFixed(4)} USD/EUR ` +
      `(${ind.byIso2.size} industrial, ${hh.byIso2.size} household geos)`,
  );
  const business = compareArm("business  vs Eurostat", tariffs.rows, "businessUsdKwh", ind.byIso2);
  const household = compareArm("household vs Eurostat", tariffs.rows, "householdUsdKwh", hh.byIso2);

  const months = quarterMonths(tariffs.quarter);
  const us = tariffs.rows.find((r) => r.iso2 === "US");
  if (!us) throw new Error("GPP has no US row");
  // EIA classes are by customer type (NAICS), not consumption. A 1,000,000 kWh/yr buyer draws
  // ~114 kW on average — a shop, an office block, a small plant — which is EIA's commercial
  // class; the industrial class is dominated by heavy industry buying at transmission voltage
  // and sits far below any small-business tariff. Both are printed; the like-for-like figure
  // is COM.
  const [eiaCom, eiaInd, eiaRes] = await Promise.all([
    eiaUsdPerKwh("COM", months),
    eiaUsdPerKwh("IND", months),
    eiaUsdPerKwh("RES", months),
  ]);
  const pct = (g, r) => ((g - r) / r) * 100;
  const usBiz = pct(us.businessUsdKwh, eiaCom.usdPerKwh);
  const usBizInd = pct(us.businessUsdKwh, eiaInd.usdPerKwh);
  const usHh = pct(us.householdUsdKwh, eiaRes.usdPerKwh);
  const signed = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
  console.log(
    `\nEIA U.S. total, ${months[0]}..${months.at(-1)} (${eiaCom.months} months` +
      `${eiaCom.keyed ? "" : ", DEMO_KEY"}):`,
  );
  console.log(
    `   business  GPP $${us.businessUsdKwh.toFixed(3)}  EIA commercial  $${eiaCom.usdPerKwh.toFixed(4)}` +
      `  ${signed(usBiz)}   (industrial $${eiaInd.usdPerKwh.toFixed(4)} ${signed(usBizInd)} — a different class)`,
  );
  console.log(
    `   household GPP $${us.householdUsdKwh.toFixed(3)}  EIA residential $${eiaRes.usdPerKwh.toFixed(4)}` +
      `  ${signed(usHh)}`,
  );

  const summary = {
    checkedOn: today,
    gppQuarter: tariffs.quarter,
    eurostat: {
      period: ind.period,
      usdPerEur: Number(ind.usdPerEur.toFixed(4)),
      business: pick(business),
      household: pick(household),
    },
    eia: {
      months,
      business: {
        gppUsdKwh: us.businessUsdKwh,
        commercialUsdKwh: r4(eiaCom.usdPerKwh),
        pct: r1(usBiz),
        industrialUsdKwh: r4(eiaInd.usdPerKwh),
        industrialPct: r1(usBizInd),
      },
      household: {
        gppUsdKwh: us.householdUsdKwh,
        residentialUsdKwh: r4(eiaRes.usdPerKwh),
        pct: r1(usHh),
      },
    },
  };
  if (write) {
    writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n");
    console.log(`\nwrote ${OUT}`);
  } else {
    console.log("\n(dry run — pass --write to record the summary for the page)");
  }
}

const r1 = (x) => Number(x.toFixed(1));
const r4 = (x) => Number(x.toFixed(4));
const pick = (s) => ({
  countries: s.countries,
  medianPct: r1(s.medianPct),
  p90Pct: r1(s.p90Pct),
  maxPct: r1(s.maxPct),
  signedMedianPct: r1(s.signedMedianPct),
});

if (process.argv[1] && /validate-electricity-tariffs\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
