"use client";

import { useMemo, useState } from "react";
import type { ZipEntry, ZipIndex, ZipSortOrder } from "@/domain";
import { ZIP_SECTIONS, ZIP_SORT_ORDERS, sortZips, zipCanonicalUrl, zipSectionOf } from "@/domain";
import { Panel } from "@/components/Panel";
import { ScrollSpy } from "@/components/ScrollSpy";
import { formatUtc } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";

export interface ZipsPageProps {
  index: ZipIndex;
}

function statusInkClass(kind: ZipEntry["statusKind"]): string {
  switch (kind) {
    case "final":
    case "active":
      return "text-green-dim";
    case "proposed":
      return "text-ink";
    case "reserved":
      return "text-ink-faint";
    case "withdrawn":
    case "rejected":
    case "obsolete":
      return "text-ink-faint";
    default:
      return "text-ink-dim";
  }
}

/** One section's table. Wide content scrolls in its own box, never the page. */
function ZipTable({ zips }: { zips: ZipEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table w-full min-w-[36rem] text-sm">
        <caption className="sr-only">
          ZIPs in this section, with their category, proposal date and status
        </caption>
        <thead>
          <tr className="microlabel text-left">
            <th className="border-b border-edge-faint pb-2 font-normal">ZIP</th>
            <th className="border-b border-edge-faint pb-2 font-normal">TITLE</th>
            <th className="border-b border-edge-faint pb-2 font-normal">CATEGORY</th>
            <th className="border-b border-edge-faint pb-2 font-normal">CREATED</th>
            <th className="border-b border-edge-faint pb-2 font-normal">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {zips.map((z) => (
            <tr key={z.zip} className="hairline-b last:border-0">
              <td className="align-top font-mono text-ink-dim tabular-nums">{z.zip}</td>
              <td className="align-top">
                <a
                  href={zipCanonicalUrl(z.zip)}
                  rel="noreferrer"
                  target="_blank"
                  className="group text-ink hover:text-green"
                >
                  <span>{z.title}</span>
                  {"\u00A0"}
                  {/* The site's outbound mark, decorative; the words beside it are what a screen
                      reader hears. The space before it is non-breaking so the mark stays with
                      the title's last word. */}
                  <span aria-hidden className="font-extrabold text-ink-dim group-hover:text-green">
                    ↗
                  </span>
                  <span className="sr-only"> (opens a new tab on zips.z.cash)</span>
                </a>
              </td>
              {/* An absent category or Created date is an empty cell, never a dash standing in
                  for nothing (Reserved placeholders like zip-0002 carry neither). */}
              <td className="align-top text-ink-dim">{z.category ?? ""}</td>
              <td className="align-top whitespace-nowrap text-ink-dim tabular-nums">
                {z.created ?? ""}
              </td>
              <td className={`align-top ${statusInkClass(z.statusKind)}`}>{z.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Buttons, not links: an order rearranges rows already on the page and changes no claim, so it
 * is client state and the route stays prerendered. Date orders sort within each section; the
 * sections do not move. State is conveyed by `aria-pressed` plus the accent, never colour alone.
 */
function SortToggle({
  value,
  onChange,
}: {
  value: ZipSortOrder;
  onChange: (order: ZipSortOrder) => void;
}) {
  return (
    <div role="group" aria-label="Sort order" className="flex flex-wrap items-center gap-1.5">
      <span className="microlabel mr-1 text-ink-faint">ORDER</span>
      {ZIP_SORT_ORDERS.map((order) => {
        const active = order === value;
        return (
          <button
            key={order}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(order)}
            className={`microlabel cursor-pointer rounded-sm border px-2 py-0.5 transition-colors ${
              active
                ? "border-edge text-green"
                : "border-edge-faint text-ink-faint hover:text-ink-dim"
            }`}
          >
            {order === "number" ? "NUMBER" : order === "newest" ? "NEWEST" : "OLDEST"}
          </button>
        );
      })}
    </div>
  );
}

interface NavSection {
  id: string;
  label: string;
  count: number;
}

/** The section's DOM id, shared by the anchor and its target so the two cannot drift. */
const anchorId = (sectionId: string) => `zips-${sectionId}`;

/**
 * The api-docs sidebar, one level simpler: four anchors, the count beside each so it reads
 * as a table of contents. Plain links — with JavaScript off it is still a working menu;
 * `ScrollSpy` stamps `aria-current="location"` on the one whose section is on screen and
 * the stylesheet lights it, which is the enhancement rather than the navigation.
 */
function SectionNav({ sections }: { sections: NavSection[] }) {
  return (
    <nav aria-label="ZIP sections" className="text-sm">
      <div className="microlabel">SECTIONS</div>
      <ul className="mt-2 space-y-1.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${anchorId(s.id)}`}
              className="flex items-baseline justify-between gap-2 border-l-2 border-transparent pl-2 text-ink-dim hover:text-green [&[aria-current]]:border-green [&[aria-current]]:text-green"
            >
              <span>{s.label}</span>
              <span className="text-xs text-ink-faint tabular-nums">{s.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ZipsPage({ index }: ZipsPageProps) {
  const [order, setOrder] = useState<ZipSortOrder>("number");
  const bySection = new Map(ZIP_SECTIONS.map((s) => [s.id, [] as ZipEntry[]]));
  for (const z of index.zips) bySection.get(zipSectionOf(z.statusKind))!.push(z);
  for (const [id, zips] of bySection) bySection.set(id, sortZips(zips, order));
  // Only sections with rows are rendered, so the menu derives from the same map: a link
  // must never point at a section that is not on the page.
  const navSections: NavSection[] = ZIP_SECTIONS.filter((s) => bySection.get(s.id)!.length > 0).map(
    (s) => ({ id: s.id, label: s.label, count: bySection.get(s.id)!.length }),
  );
  // Stable across sort toggles, or the observer is rebuilt on every click.
  const spyIds = useMemo(
    () =>
      ZIP_SECTIONS.filter((s) => index.zips.some((z) => zipSectionOf(z.statusKind) === s.id)).map(
        (s) => anchorId(s.id),
      ),
    [index],
  );

  return (
    <>
      <ScrollSpy ids={spyIds} />
      {/* Page copy stays short: one sentence, one scope note. */}
      <PageHeader
        eyebrow="PROTOCOL"
        title="Zcash Improvement Proposals"
        lede="The documents that specify Zcash, read from their own headers — numbered ZIPs only, each linking to its canonical page."
      />

      {/* Mobile: a native disclosure; no JS, no state, and it never overlays content. */}
      <details className="panel mb-6 p-5 lg:hidden">
        <summary className="microlabel cursor-pointer select-none">ON THIS PAGE</summary>
        <div className="mt-3">
          <SectionNav sections={navSections} />
        </div>
      </details>

      <div className="flex gap-10">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">
            <SectionNav sections={navSections} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4">
            <SortToggle value={order} onChange={setOrder} />
          </div>

          <div className="flex flex-col gap-3">
            {ZIP_SECTIONS.map((section) => {
              const zips = bySection.get(section.id)!;
              if (zips.length === 0) return null;
              // `scroll-mt-24` keeps an anchored section clear of the top edge.
              const body =
                section.id === "retired" ? (
                  // The heading is always visible, like every other section's; only the table
                  // is collapsed, since withdrawn, rejected and obsolete proposals matter least.
                  // Content, not a menu: no `data-popover`, so `DismissPopovers` never closes it.
                  <Panel title={`${section.label} · ${zips.length}`}>
                    <details>
                      <summary className="microlabel cursor-pointer text-ink-dim">show</summary>
                      <div className="mt-3">
                        <ZipTable zips={zips} />
                      </div>
                    </details>
                  </Panel>
                ) : (
                  <Panel title={section.label}>
                    <ZipTable zips={zips} />
                  </Panel>
                );
              return (
                <div key={section.id} id={anchorId(section.id)} className="scroll-mt-24">
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-faint">
        index read {formatUtc(index.asOf)} · source: {index.source}
      </p>
    </>
  );
}
