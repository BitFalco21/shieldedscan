import { Fragment, type ReactNode } from "react";
import Link from "@/components/Link";

/**
 * One claim from `privacy-facts.ts`, drawn.
 *
 * The claims are plain strings so that one copy can serve both this page and the agent's
 * `site_guide` payload — see that file's header for why a second copy is not an option here.
 * Three markers carry what the prose genuinely needs and nothing more: a code span for a
 * header name or a host, an emphasis for a phrase the page leans on, and a link.
 *
 * It is a parser over a fixed set of committed strings, not a markdown renderer: no HTML is
 * ever produced from the text, every branch emits a React element, and an unmatched marker is
 * left as the literal character it is.
 */
const MARKER = /`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

export interface PrivacyTextProps {
  /** A `PrivacyClaim` body, a summary, or any other string from `privacy-facts.ts`. */
  text: string;
}

export function PrivacyText({ text }: PrivacyTextProps) {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MARKER)) {
    const [whole, code, emph, linkText, href] = m;
    if (m.index > at) nodes.push(text.slice(at, m.index));
    at = m.index + whole.length;
    const key = `${m.index}`;
    if (code !== undefined) {
      nodes.push(
        <span key={key} className="font-mono text-xs break-all text-ink-faint">
          {code}
        </span>,
      );
    } else if (emph !== undefined) {
      nodes.push(
        <span key={key} className="text-ink">
          {emph}
        </span>,
      );
    } else if (linkText !== undefined && href !== undefined) {
      nodes.push(
        href.startsWith("/") ? (
          <Link key={key} href={href} className="text-green hover:underline">
            {linkText}
          </Link>
        ) : (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green hover:underline"
          >
            {linkText}
          </a>
        ),
      );
    }
  }
  if (at < text.length) nodes.push(text.slice(at));
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
}
