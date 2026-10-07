/**
 * The FX alignment gate, run against live venues: `npm run fx:validate`.
 *
 * Kept out of the boot path: it reaches three third-party venues, and the API's start-up must not
 * depend on them. Run it before a deploy that adds or changes a currency.
 *
 * Two arms of different strength. The strong arm compares a derived cross-rate against a venue
 * that quotes the pair (only EUR on Kraken `XZECZEUR` and BTC on Binance `ZECBTC`). The weak arm
 * compares our ECB rate against a second FX vendor for the other fiats: it shows our rate is the
 * rate, not that the cross-rate matches a traded ZEC pair, because none exists for them.
 */
import {
  crossRateError,
  passes,
  PASS_MEDIAN_PCT,
  rateAgreement,
  type CrossRateCheck,
} from "./fx-alignment";
import { deriveOfferedCurrencies, fetchEcbRange, fetchYahooBtcDaily } from "./fx-history";
import { fetchYahooDaily } from "./price-history";
import { utcDayFromMs } from "@/domain/time";

async function krakenCloses(pair: string): Promise<Map<string, number>> {
  const body = (await (
    await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440`)
  ).json()) as { result?: Record<string, unknown> };
  const candles = Object.values(body.result ?? {}).find(Array.isArray) as
    [number, ...string[]][] | undefined;
  return new Map((candles ?? []).map((c) => [utcDayFromMs(c[0] * 1000), Number(c[4])]));
}

async function binanceCloses(symbol: string): Promise<Map<string, number>> {
  const rows = (await (
    await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=1000`)
  ).json()) as [number, ...string[]][];
  return new Map(rows.map((k) => [utcDayFromMs(k[0]), Number(k[4])]));
}

async function yahooFx(currency: string, nowSeconds: number): Promise<Map<string, number>> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/USD${currency.toUpperCase()}=X` +
    `?period1=1477612800&period2=${nowSeconds}&interval=1d`;
  const body = (await (
    await fetch(url, { headers: { "User-Agent": "shieldedscan/1.0" } })
  ).json()) as {
    chart?: {
      result?: {
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  };
  const result = body.chart?.result?.[0];
  const out = new Map<string, number>();
  (result?.timestamp ?? []).forEach((t, i) => {
    const close = result?.indicators?.quote?.[0]?.close?.[i];
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      out.set(utcDayFromMs(t * 1000), close);
    }
  });
  return out;
}

const report = (label: string, check: CrossRateCheck | null, ok: boolean): void => {
  if (check === null) {
    console.error(`FAIL ${label}: no overlapping days — unvalidated, never passing`);
    return;
  }
  console.log(
    `${ok ? "pass" : "FAIL"} ${label}: median ${check.medianPct.toFixed(3)}% ` +
      `p90 ${check.p90Pct.toFixed(3)}% max ${check.maxPct.toFixed(2)}% over ${check.days} days`,
  );
};

async function main(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const today = utcDayFromMs(Date.now());
  let failed = false;

  // The USD leg must be the one production multiplies (`zec_price_daily`, Yahoo's close).
  // Kraken's own ZEC/USD would validate a pipeline the site does not ship, and its thin-day wicks
  // distort the comparison.
  const zecUsd = new Map((await fetchYahooDaily(nowSeconds)).map((p) => [p.day, p.usd]));
  // The full span, so the offered set is derived exactly as the ingest derives it; a shorter
  // window would admit currencies excluded for gaps outside it.
  const ecb = await fetchEcbRange("2016-10-28", today);
  const offered = deriveOfferedCurrencies(ecb);
  const btc = await fetchYahooBtcDaily(nowSeconds);

  const ratesFor = (currency: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [d, row] of ecb) {
      const rate = row[currency];
      if (rate !== undefined) out.set(d, rate);
    }
    return out;
  };

  // Strong arm: a cross-rate against a venue that quotes the pair.
  const strong: [string, CrossRateCheck | null][] = [
    [
      "zec->eur vs kraken XZECZEUR",
      crossRateError(zecUsd, ratesFor("eur"), await krakenCloses("XZECZEUR")),
    ],
    [
      "zec->btc vs binance ZECBTC",
      crossRateError(
        zecUsd,
        new Map(btc.map((r) => [r.day, r.rate])),
        await binanceCloses("ZECBTC"),
      ),
    ],
  ];
  for (const [label, check] of strong) {
    const ok = passes(check);
    if (!ok) failed = true;
    report(label, check, ok);
  }

  // Weak arm: our ECB rate against a second FX vendor, for every fiat with no ZEC pair.
  console.log("");
  for (const currency of offered) {
    if (currency === "eur") continue; // already covered by the strong arm
    const check = rateAgreement(ratesFor(currency), await yahooFx(currency, nowSeconds));
    const ok = check !== null && check.medianPct <= PASS_MEDIAN_PCT;
    if (!ok) failed = true;
    report(`${currency} (fx-leg vs yahoo USD${currency.toUpperCase()}=X)`, check, ok);
  }

  console.log(`\n${failed ? "GATE FAILED — do not ship" : "gate passed"}`);
  process.exit(failed ? 1 : 0);
}

void main();
