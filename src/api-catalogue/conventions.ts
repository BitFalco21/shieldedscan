/** The rules every endpoint follows, rendered once at the top of the reference. */
export const API_CONVENTIONS = [
  {
    id: "amounts",
    title: "Amounts are integer zatoshis",
    body: "Every field ending in `Zat` is an integer number of zatoshis; 1 ZEC = 100,000,000 zat. Integers survive JSON parsers that floats do not, and a ledger amount is never rounded on your behalf.",
  },
  {
    id: "nulls",
    title: "Null always has a reason",
    body: "Nullable keys are always present — never omitted. Where a null is ambiguous, the sibling `unknowns` map names why, from a closed vocabulary: `shielded` (encrypted on-chain, by design), `unmeasured` (we have no measurement right now — retry later), `omitted` (exists, but not in this view), `nonexistent` (did not exist at that height), `indeterminate` (answering would require a guess). Coercing a shielded null to 0 is the exact fabrication this explorer exists to refuse.",
  },
  {
    id: "direction",
    title: "Direction is a verb, not an arrow",
    body: "A transaction's `direction` says what it did to the shielded boundary: `shielding` (transparent value entered the pools), `unshielding` (shielded value left them to a transparent address), `shielded` (it stayed inside — it never crossed), or `null`. Null covers two situations, neither of them a gap: no pool is involved at all (`transparent`, `coinbase`), or a `mixed` transaction moved value both ways — including a turnstile migration between pools, where naming a single direction would be a guess. Read it alongside `kind`, which says which pools were touched rather than what happened at the boundary. **These values were `t-to-z`, `z-to-t` and `z-to-z` until 2026-08-06.** The explorer's own pages have said SHIELDING / UNSHIELDING / SHIELDED since 2026-08-01, and one vocabulary across the site and the API was worth a breaking change this early in the API's life; there is no plan for a second.",
  },
  {
    id: "pagination",
    title: "Keyset cursors, no totals",
    body: "Lists return `nextCursor`/`prevCursor` — opaque strings you pass back. **To page forward, send `nextCursor` back as `cursor`.** That is the whole of it for most callers. `cursor` is an alias for `before`, which together with `after` gives you both directions: `before` takes a `nextCursor` and moves toward older rows, `after` takes a `prevCursor` and moves toward newer ones. Note that this is the opposite pairing to Relay and the GraphQL APIs built on it, where the end cursor goes in `after` — carrying that habit over here returns overlapping rows rather than an error, which is exactly why `cursor` exists. Sending `cursor` alongside `before` or `after` is a 400 rather than one silently winning. A null cursor means there is nothing further that way. There are no page numbers and no totals: a real index seek knows neither without a COUNT(*) per page view, and a malformed cursor lands on the first page rather than erroring.",
  },
  {
    id: "shares",
    title: "Percentages carry their denominator",
    body: "Every percentage is `{pct, numerator, denominator}`. A share whose denominator you cannot see carries authority it does not have.",
  },
  {
    id: "coverage",
    title: "Aggregates state their coverage",
    body: 'Cross-chain figures carry `coverage.basis: "floor"` — public swap venues only, so every number is a floor on real movement, never a total. Sampled statistics carry their sample size and `extrapolated: false`. The reorg log carries `basis: "observed"` — one node\'s own rollbacks since a stated date, not a network census.',
  },
  {
    id: "ranking",
    title: "Analytics can be ranked and trimmed",
    body: "Every analytics answer with a list of periods (or of cross-chain groups) takes `sort` (a numeric field path inside one period, such as `transactions.total`), `order`, `top` and `fields`. A ranked answer carries `data.ranking`: what it ranked by, how many periods were considered, how many were left out because the field was null there — a null is never ranked as zero — and `tiedAtTop`, which above 1 means there is no single first. Ranking and trimming apply to the same cached answer, so they cost nothing extra; an unknown field path is a 400 that lists the valid ones.",
  },
  {
    id: "cors",
    title: "Callable from a browser",
    body: "`Access-Control-Allow-Origin: *` on every response, with `ETag`, `Retry-After` and `X-Request-Id` exposed to scripts. There is no key to leak, so there is nothing to protect by refusing cross-origin reads — the try-it panels on this page are ordinary `fetch` calls from your browser, sent nowhere else.",
  },
  {
    id: "caching",
    title: "A repeat request can be free",
    body: "Every 200 carries an `ETag` and a `Cache-Control` max-age suited to how fast that resource actually changes. Send the tag back as `If-None-Match` and an unchanged resource answers `304` with no body — it still counts against the rate limit, but it costs you no parsing and the box no work. If you are polling, poll conditionally.",
  },
  // No "keyless, rate-limited" entry: the Rate limits section below carries the limits and
  // their reasoning, and the page header states the keyless part.
] as const;
