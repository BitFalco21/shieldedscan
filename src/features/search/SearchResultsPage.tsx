import { network } from "@/lib/network";
import Link from "@/components/Link";
import { ZnsExplorerChip } from "@/components/ZnsExplorerChip";
import { formatZnsName, targetSpacingSeconds } from "@/domain";
import { formatCount } from "@/lib/format";

export type SearchState =
  | { kind: "prompt" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "beyond-tip"; height: number; tip: number }
  | { kind: "ambiguous"; blockHref: string; txHref: string; hash: string }
  /** A well-formed ZNS name the registry has not registered. */
  | { kind: "name-not-found"; name: string }
  /**
   * The registry was unreadable, or too far behind our chain to trust. Never rendered as a miss:
   * "not registered" is a claim about the registry, and we could not read it.
   */
  | { kind: "name-unavailable"; name: string };

/**
 * The search page's own heading block: centred, unlike every other page's `PageHeader`, because
 * the page is a single answer rather than a list or a record. Its rhythm is the shared one — the
 * microlabel, then the `<h1>` at `mt-1` — so the two cannot drift by a few pixels.
 */
function Shell({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl pt-16 text-center">
      <div className="microlabel">{label}</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-bright">{title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-ink-dim">{children}</div>
    </div>
  );
}

export interface SearchResultsPageProps {
  state: SearchState;
  query: string;
}

export function SearchResultsPage({ state, query }: SearchResultsPageProps) {
  switch (state.kind) {
    case "prompt":
      return (
        <Shell label="SEARCH" title="What are you looking for?">
          <p>
            Paste a block height, block hash, transaction id, address, or Zcash name into the search
            box above.
          </p>
        </Shell>
      );
    case "invalid":
      return (
        <Shell label="SEARCH" title="That doesn't look like anything on the chain">
          <p>
            <span className="font-mono break-all text-ink">{query}</span> isn&apos;t a block height
            (digits), a hash (64 hex characters), a Zcash address (t1…, t3…, zs1…, u1…), or a Zcash
            name (lowercase letters and digits).
          </p>
        </Shell>
      );
    case "not-found":
      return (
        <Shell label="SEARCH" title="Valid shape, but nothing found">
          <p>
            <span className="font-mono break-all text-ink">{query}</span> is well-formed but
            doesn&apos;t match any block, transaction, or address we know.
          </p>
        </Shell>
      );
    case "beyond-tip":
      return (
        <Shell label="SEARCH" title="That block hasn't been mined yet">
          <p>
            Height <b className="font-mono text-ink">#{formatCount(state.height)}</b> is beyond the
            current tip{" "}
            <Link href={`/block/${state.tip}`} className="font-mono underline">
              #{formatCount(state.tip)}
            </Link>
            . Check back in about{" "}
            {formatCount(
              Math.ceil(
                ((state.height - state.tip) * targetSpacingSeconds(network, state.tip)) / 60,
              ),
            )}{" "}
            minutes.
          </p>
        </Shell>
      );
    case "ambiguous":
      return (
        <Shell label="SEARCH" title="Two things match this hash">
          <p className="font-mono break-all text-ink">{state.hash}</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href={state.blockHref} className="btn btn-secondary px-4 py-2 text-sm">
              View as block
            </Link>
            <Link href={state.txHref} className="btn btn-secondary px-4 py-2 text-sm">
              View as transaction
            </Link>
          </div>
        </Shell>
      );
    case "name-not-found":
      return (
        <Shell label="ZCASH NAME" title="No one has registered this name">
          <p>
            <span className="font-mono break-all text-ink">{formatZnsName(state.name)}</span> is not
            in the Zcash Name System registry.
          </p>
          <div className="mt-5">
            <ZnsExplorerChip name={state.name}>see it on zcashnames.com</ZnsExplorerChip>
          </div>
        </Shell>
      );
    case "name-unavailable":
      return (
        <Shell label="ZCASH NAME" title="Name lookup unavailable right now">
          <p>
            We could not get an up-to-date answer from the Zcash Name System registry for{" "}
            <span className="font-mono break-all text-ink">{formatZnsName(state.name)}</span>, so we
            are not showing an address for it. Try again in a few minutes.
          </p>
        </Shell>
      );
  }
}
