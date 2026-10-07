import { ecosystemHost, type EcosystemCategoryMeta, type EcosystemEntry } from "@/domain/ecosystem";
import { initial } from "./layout";

export interface EcosystemListGroup {
  meta: EcosystemCategoryMeta;
  slot: number;
  entries: EcosystemEntry[];
}

export interface EcosystemListProps {
  groups: EcosystemListGroup[];
  logos: ReadonlySet<string>;
}

/**
 * Every project on the map, in text, grouped by category: its name as a link out (a new tab,
 * telling the site nothing about where the reader came from), its host so a reader sees where
 * the link goes before following it, and the catalogue that listed it. The map is the shape;
 * this is the evidence, and on a phone it is the whole page.
 */
export function EcosystemList({ groups, logos }: EcosystemListProps) {
  return (
    <div className="gap-10 sm:columns-2 lg:columns-3">
      {groups.map((g) => (
        <section
          key={g.meta.id}
          aria-labelledby={`eco-${g.meta.id}`}
          className="mb-8 min-w-0 break-inside-avoid"
        >
          <h2 id={`eco-${g.meta.id}`} className={`microlabel flow-${g.slot}`}>
            {g.meta.label} <span className="text-ink-faint">{g.entries.length}</span>
          </h2>
          <p className="mt-1 text-xs text-ink-faint">{g.meta.blurb}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {g.entries.map((entry) => (
              <Row key={entry.id} entry={entry} hasLogo={logos.has(entry.id)} slot={g.slot} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ entry, hasLogo, slot }: { entry: EcosystemEntry; hasLogo: boolean; slot: number }) {
  return (
    <li id={`project-${entry.id}`} className="flex min-w-0 items-center gap-3">
      {hasLogo ? (
        // A committed 64px icon from our own origin: next/image would add a loader round
        // trip for a file that is already the size it renders at.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/ecosystem/logos/${entry.id}.png`}
          alt=""
          aria-hidden
          width={20}
          height={20}
          loading="lazy"
          className="shrink-0 rounded-sm"
        />
      ) : (
        <span
          aria-hidden
          className={`flow-${slot} grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[10px] font-bold`}
        >
          {initial(entry.name)}
        </span>
      )}
      <div className="min-w-0">
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-ink hover:text-green"
        >
          {entry.name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <div className="truncate text-xs text-ink-faint" title={entry.source}>
          {ecosystemHost(entry.url)} · {entry.source}
        </div>
      </div>
    </li>
  );
}
