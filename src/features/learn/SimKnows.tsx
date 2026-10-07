import { AskZeno } from "./AskZeno";
import { DIMMED, PANEL_FADE, RING } from "./learn-ui";
import type { SimNote } from "./sim-model";

export interface SimKnowsProps {
  seen: readonly SimNote[];
  exchangeKnows: readonly SimNote[];
  highlight: string | null;
  /** The tour is pointing at another panel. */
  dimmed: boolean;
}

function Notes({ notes }: { notes: readonly SimNote[] }) {
  if (notes.length === 0) return <p className="mt-2 text-sm text-ink-faint">Nothing yet.</p>;
  return (
    <ul className="mt-2 grid gap-2 text-sm">
      {notes.map((note, i) => (
        <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] text-ink">
          <span aria-hidden className={note.warn ? "font-semibold text-warn" : "text-green-dim"}>
            {note.warn ? "!" : "·"}
          </span>
          <span className={note.warn ? "text-ink-bright" : ""}>
            {note.lead ? (
              <b className="font-semibold break-all text-ink-bright">{note.lead} </b>
            ) : null}
            {note.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Two lists that grow as the reader acts: what anyone watching the chain learns about them, and
 * what the exchange knows on top. The first stops growing once the ZEC is shielded, which is the
 * whole lesson; the second never forgets, which is the honest half of it.
 */
export function SimKnows({ seen, exchangeKnows, highlight, dimmed }: SimKnowsProps) {
  return (
    <div
      id="learn-knows"
      className={[
        "grid gap-4 rounded md:grid-cols-2",
        PANEL_FADE,
        highlight === "knows" ? RING : "",
        dimmed ? DIMMED : "",
      ].join(" ")}
    >
      <section aria-label="What anyone watching the chain can see" className="panel min-w-0 p-4">
        <h3 className="microlabel text-green">anyone watching the chain can see</h3>
        <Notes notes={seen} />
        <div className="mt-3">
          <AskZeno question="Why can’t anyone see a shielded payment?" />
        </div>
      </section>
      <section aria-label="What the exchange also knows" className="panel min-w-0 p-4">
        <h3 className="microlabel text-green">the exchange also knows</h3>
        <Notes notes={exchangeKnows} />
      </section>
    </div>
  );
}
