# Architecture

How shieldedscan is put together, and the rules every change has to respect. The rules exist
because each one, broken, produces a confident wrong number — the one failure an explorer cannot
afford.

## System

```
Browser ──► Next.js on Netlify ──► read-only API (Hono) ──► Postgres (derived index)
                                        │                └► Zakura archive node (JSON-RPC)
                                        ├─ follower: ingests each block into Postgres
                                        ├─ crawler: Zcash P2P network map
                                        └─ venue pollers: NEAR Intents, Maya, THORChain
```

- **The node is the source of truth; Postgres is a derived index.** Detail pages can always be
  answered by the node. The index makes lists, analytics, address history and fees index seeks
  instead of chain walks.
- **The API is the only public surface.** Postgres and node RPC are never published. Netlify talks
  to the API with a bearer token held server-side; the token never reaches the browser.
- **Testnet is a second deployment, never a parameter.** Separate site, API, database and node, so
  testnet data cannot render under mainnet chrome.

## Repository layout

```
src/
  domain/       Zcash types mirroring real RPC semantics, and every derived fact.
  fixtures/     Typed sample data. Only data/fixture-source.ts may import it.
  data/         The ExplorerDataSource port and its adapters (fixtures, the API).
  lib/          Pure formatting helpers.
  components/   Presentational primitives. Props are domain types or scalars.
  features/     Page compositions, one folder per area. Pure presentation.
  app/          Next.js routes. Thin: call the data port, render a feature page.
server/         API service, follower, backfills, crawler, agent, /v1 and MCP.
e2e/            Playwright invariant suites.
scripts/        Data refresh and validation scripts.
brand/          Reproducible generators for the site's brand assets.
```

## Data rules

1. **The UI never knows where data comes from.** `components/` and `features/` import from
   `domain/` only. If a data-source change touches them, the domain model is wrong.
2. **Shielded values are `null`, never `0`.** Types express "encrypted by design". A missing
   number and an explicit `null` are resolved once, at the adapter boundary; a falsy check that
   turns `0%` into "unknown" is as wrong as one that turns `null` into `0`.
3. **Two kinds of absence, rendered differently.** The Veil (redaction bars) means _encrypted
   on-chain_. `Unmeasured` ("unavailable") means _we could not read it_. Never spend the Veil on
   an outage of ours.
4. **Facts the chain implies are derived in `domain/`, not stored.** The miner is the coinbase's
   largest transparent output; a transaction's kind, direction and pool path come from its
   bundles. One function answers each question — `POOL_BUNDLE` in `domain/pool.ts` is the single
   list of shielded pools, so adding a pool is a compile error until every consumer handles it.
5. **Every shielded pool is a term in the fee equation.** `feeFromTermsZat` is the only fee
   formula. Sprout publishes its public values per JoinSplit, not as a value balance.
6. **Never narrate who paid whom.** Choosing which transparent output is the payment and which is
   change is a chain-analysis heuristic, not a chain fact. An address's net change per transaction
   is arithmetic and is allowed.
7. **A USD figure sits only beside a public ZEC amount.** Historical values use that day's close,
   never today's price.
8. **A percentage names its denominator.** No privacy scores. Sampled figures carry their sample
   size. A share below the display grain prints `<0.1%`, never `0.0%`.
9. **Attacker-controlled bytes are sanitised once, at the parse boundary** — coinbase tags, venue
   labels, third-party symbols. Rendered as text, never HTML.

## List and query rules

10. **Keyset pagination, never `OFFSET`.** Cursors encode the full sort tuple `(sortKey, id)`,
    and the predicate matches the sort direction of every column. Cursors are range-checked
    before they reach SQL.
11. **A list row costs one query, nothing per row.** If a list needs per-row fan-out, the domain
    model is missing a field.
12. **A filter narrows the list, never the page.** Filters are parsed in `domain/`, applied before
    the cursor slice, carried through every pagination link, and echoed back by the API so a stale
    deployment fails loudly instead of returning an unfiltered list.
13. **A cap is honest only when the true count travels with it.** Truncated arrays carry their
    full count and a way to fetch the rest.

## API rules

14. **The private API speaks domain types; `/v1` speaks its own wire types** (`server/v1/dto.ts`),
    so internal renames never break public clients.
15. **`/v1` is keyless and rate-limited by path in Caddy.** Nullable keys are always emitted;
    ambiguous nulls carry a reason in an `unknowns` map; unknown query parameters are a 400.
16. **A 503 is an outage, a 404 is an answer.** Transient upstream failures render as
    "unavailable"; shape errors fail the build, so version skew between API and frontend is loud.
17. **Deploy order: the API ships before a frontend that requires its new fields.** A change that
    only widens what the frontend accepts ships frontend-first.

## Caching and freshness

- Tip-sensitive dynamic routes declare `fetchCache = "force-no-store"`. On a dynamic render Next's
  fetch Data Cache returns a stale entry and refreshes it behind the response, so the first
  visitor after an idle period would see an old chain tip; `unstable_cache` reads are unaffected.
  Prerendered pages instead print the block they were read at.
- A shared CDN cache on a route whose answer depends on a query parameter names that parameter in
  its cache key and echoes it in the response.
- An outage must be cheap: a shared circuit breaker fails fast after repeated upstream failures,
  and live pollers back off.

## Interface rules

- One dark, terminal-style design ("Phosphor"). Colours are OKLCH tokens in `src/app/styles/tokens.css` derived
  from one hue, so themes change one number; every content token clears WCAG AA.
- Styling goes through Tailwind tokens. Inline `style` props are not allowed in `src/` except the
  two geometry values in `components/ChartHover.tsx`.
- Privacy is shown by shape first and colour second (the shield grammar: full, half, outline).
- `prefers-reduced-motion` disables every animation.
- A route that can call `notFound()` must not sit under a `loading.tsx`, or invalid URLs answer
  HTTP 200.

## Quality gates

`npm run verify` (format, typecheck, lint, unit tests, build) runs in CI on every push. The
Playwright suites assert properties over the whole site rather than spot values. Anything that
changes a response — headers, caching, freshness — is verified against the deployed site, not by
reading configuration.
