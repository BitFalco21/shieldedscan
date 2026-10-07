import Link from "@/components/Link";
import type { MarketAsset } from "@/domain";
import { FilterPopover } from "@/components/FilterPopover";
import { formatUsdCompact } from "@/lib/format";
import { AssetLabel } from "./AssetLabel";
import { compareHref } from "./compareHref";

export interface AssetPickerProps {
  /** Every asset that may be compared against, largest first. */
  assets: MarketAsset[];
  /** The one currently shown, or null when the URL named something we cannot compare. */
  selected: MarketAsset | null;
}

/**
 * The page's one control: which asset Zcash is measured against.
 *
 * A `<details>` disclosure of links, like every other selector on this site — no JavaScript,
 * no client component, no state, and every choice is a URL that can be shared or bookmarked.
 * `data-popover` opts it into `DismissPopovers`, which closes it on an outside click; with
 * scripting off it still opens, still chooses, and simply waits for its own summary.
 *
 * The whole chip opens it, not just the caret: `FilterPopover`'s `label` puts the visible
 * content inside the `<summary>`, so everything bordered is the target.
 *
 * Deliberately not labelled "Filter by …": it re-asks the page's question rather than narrowing
 * a list, and `e2e/filters.spec.ts` discovers filter groups by that exact prefix.
 *
 * Each entry carries the asset's market cap, because that is what makes one choice different
 * from another here — a bare list of tickers would ask the reader to already know the answer
 * the page exists to give.
 */
export function AssetPicker({ assets, selected }: AssetPickerProps) {
  return (
    <FilterPopover
      // The accessible name CONTAINS the visible text, per WCAG 2.5.3: a screen-reader user
      // and a speech-input user must be able to refer to this control by what it says.
      ariaLabel={
        selected === null
          ? "Choose an asset to compare with"
          : `${selected.symbol} — choose an asset to compare with`
      }
      filtered={selected !== null}
      icon="caret"
      /*
       * Left-anchored, which is correct only because `ComparePage` stacks the label above this
       * chip below `sm`, so the chip starts at the content's left edge and the panel fits at
       * 375px. `overflow.spec.ts` cannot see a panel escaping a non-scrolling container, so
       * `compare.spec.ts` measures the open panel's box at both viewports.
       */
      align="left"
      label={
        selected === null ? (
          <span className="text-ink-faint">choose an asset</span>
        ) : (
          <span className="text-green">
            <AssetLabel asset={selected} />
          </span>
        )
      }
    >
      {assets.map((asset) => {
        const active = asset.id === selected?.id;
        return (
          <Link
            key={asset.id}
            href={compareHref(asset.id)}
            aria-current={active ? "page" : undefined}
            className={`microlabel flex items-center gap-3 rounded-sm px-2 py-1.5 whitespace-nowrap ${
              active ? "text-green" : "text-ink-dim hover:text-green"
            }`}
          >
            <AssetLabel asset={asset} emphasis="normal" />
            <span className="flex-1" />
            <span className="text-ink-faint">{formatUsdCompact(asset.marketCapUsd)}</span>
          </Link>
        );
      })}
    </FilterPopover>
  );
}
