import Link from "@/components/Link";
import { classifySearchQuery } from "@/domain";
import { entityHrefIsRoutable } from "@/lib/entity-page";
import { isSameOriginPath } from "@/lib/safe-href";
import { splitBlocks, type Block } from "./answer-blocks";

export interface AnswerMarkdownProps {
  text: string;
  /**
   * `dim` for text that is ours rather than an answer — the server's unanswered closing — so it
   * reads as a note about the turn and not as something Zeno found out.
   */
  tone?: "normal" | "dim";
}

/**
 * A deliberately tiny markdown renderer for a model's answer: paragraphs, `-`/`*` lists, pipe
 * tables, inline code, and links. Nothing else, and never `dangerouslySetInnerHTML`.
 *
 * This is the second of two independent defences against an injected exfiltration link
 * (`guard.ts`'s server-side sanitiser is the first). It fails safe by construction: it can only
 * emit the element types below, so there is no path from model output to a `<script>`, an
 * `<img>` or an `<iframe>` — the syntax is not implemented.
 *
 * External links are marked `rel="noreferrer"`, matching the venue-link rule.
 */
export function AnswerMarkdown({ text, tone = "normal" }: AnswerMarkdownProps) {
  const blocks = splitBlocks(text);
  return (
    <div
      className={`space-y-3 text-sm leading-relaxed ${tone === "dim" ? "text-ink-dim" : "text-ink"}`}
    >
      {blocks.map((block, i) => {
        if (block.kind === "list") {
          return (
            <ul key={i} className="answer-block list-outside list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "table") return <Table key={i} block={block} />;
        return (
          <p key={i} className="answer-block">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * A pipe table, rendered as a real table.
 *
 * Only `table`/`thead`/`tbody`/`tr`/`th`/`td` are added to the emitted element types, and every
 * cell goes through `Inline` — the same safe subset — so the no-script/no-image property is
 * unchanged. These elements are inert.
 *
 * It scrolls inside its own container: a seven-column table must not make the page scroll
 * sideways. Sized by its content (`w-auto`), never stretched to the pane, so a narrow two-column
 * answer does not have its columns pushed to opposite edges; wide tables already overflow into
 * the scroll since cells are `whitespace-nowrap`.
 */
function Table({ block }: { block: Extract<Block, { kind: "table" }> }) {
  return (
    <div className="answer-block -mx-1 overflow-x-auto px-1">
      <table className="w-auto border-collapse text-xs">
        <thead>
          <tr className="border-b border-edge">
            {block.header.map((cell, i) => (
              <th
                key={i}
                scope="col"
                className={`px-2 py-1.5 font-medium whitespace-nowrap text-ink-dim ${
                  block.align[i] === "right" ? "text-right" : "text-left"
                }`}
              >
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  /*
                   * Nothing in a cell wraps; the container scrolls instead. Wrapping would split
                   * tokens like "Aug 10" mid-value, and inside a scrolling container not
                   * wrapping costs nothing.
                   */
                  className={`px-2 py-1.5 align-top whitespace-nowrap ${
                    block.align[j] === "right" ? "text-right tabular-nums" : "text-left"
                  }`}
                >
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Inline spans: `code`, [label](href), **bold**, *emphasis*. Split on the constructs in one pass
 * so a nested case degrades to plain text rather than to a half-parsed element.
 *
 * Emphasis matches only when the asterisks hug a word on both sides (`*some*`), so arithmetic
 * written out — `2 * 3 * 4` — stays as typed; bold is tried first, so `**x**` is never read as two
 * emphases. Like bold it renders text alone in an inert element.
 */
function Inline({ text }: { text: string }) {
  const pattern =
    /(`[^`]+`)|(\[[^\]]*\]\([^)]*\))|(\*\*[^*]+\*\*)|((?<![\w*])\*(?=[^\s*])[^*\n]*?[^\s*]\*(?![\w*]))/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(<CodeSpan key={match.index} value={token.slice(1, -1)} />);
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={match.index} className="text-ink-bright">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2] ?? "";
      parts.push(<SafeLink key={match.index} href={href} label={label} />);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * Inline code — and a link out of it when the content is a Zcash identifier a page exists for.
 *
 * The signal is that the model marked it as code: the prompt tells it to use inline code for
 * hashes and field names, so a backticked token is the one place an identifier is declared
 * rather than guessed at. Linkifying bare prose would eventually turn a transaction count into a
 * block link.
 *
 * `classifyZcashAddress` and `classifySearchQuery` are the site's own classifiers, shared with
 * the search box, so the console and the ⌘K palette cannot disagree about what a txid looks
 * like.
 *
 * A 64-hex string goes to `/search`: it is ambiguous between a txid and a block hash, and
 * `/search?q=` redirects when only one exists and disambiguates when both do, where `/tx/` would
 * 404 on every block hash.
 *
 * A height is not linked: a number in an answer is far more often a count than a block, and its
 * meaning cannot be read off its shape.
 */
function CodeSpan({ value }: { value: string }) {
  const className =
    "rounded-sm bg-green-wash-strong px-1 py-0.5 text-[0.92em] break-all text-green";
  const href = identifierHref(value.trim());
  if (href === null) return <code className={className}>{value}</code>;
  return (
    <a
      href={href}
      // A new tab, for the reason every link out of an answer gets one: the conversation lives
      // only in this component's React state, so navigating in place destroys the answer the
      // link came out of — and this page stores nothing, by promise.
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-green/40 underline-offset-2 hover:decoration-green"
    >
      <code className={className}>{value}</code>
    </a>
  );
}

/** The page for an identifier, or null when the token is not one we can resolve honestly. */
function identifierHref(value: string): string | null {
  const parsed = classifySearchQuery(value);
  if (parsed.type === "transparent-address" || parsed.type === "shielded-address") {
    return `/address/${encodeURIComponent(parsed.address)}`;
  }
  if (parsed.type === "hash64") return `/search?q=${encodeURIComponent(parsed.hash)}`;
  return null;
}

/**
 * A link the renderer is willing to emit. The server sanitiser has already dropped every
 * non-allowlisted href, so anything arriving here should be relative or allowlisted —
 * this re-checks anyway rather than trusting that, because "the other layer handled it"
 * is how both layers end up trusting each other.
 */
function SafeLink({ href, label }: { href: string; label: string }) {
  // An entity path whose identifier the model invented is dropped to its label, exactly as the
  // server sanitiser drops it. Re-checked here for this function's own stated reason: "the other
  // layer handled it" is how both layers end up trusting each other.
  if (!entityHrefIsRoutable(href)) return <>{label}</>;
  if (href.startsWith("/")) {
    if (!isSameOriginPath(href)) return <>{label}</>;
    return (
      <Link
        href={href}
        // A new tab, for the same reason the SOURCES links get one: the conversation lives only in
        // the console's own React state, so following a link in this tab destroys the answer the
        // link came out of. This is scoped to the agent's rendered answers — the rest of the site
        // navigates in place, as it should.
        target="_blank"
        rel="noopener noreferrer"
        className="text-green underline decoration-green/40 hover:decoration-green"
      >
        {label}
      </Link>
    );
  }
  if (/^https:\/\/([a-z0-9-]+\.)*(shieldedscan\.xyz|z\.cash|electriccoin\.co)(\/|$)/.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-green underline decoration-green/40 hover:decoration-green"
      >
        {label}
      </a>
    );
  }
  return <>{label}</>;
}
