"use client";

import { useEffect, useState } from "react";
import { canonicalSearchQuery, classifySearchQuery } from "@/domain";
import { type SearchSuggestion, searchSuggestions } from "./search-suggestions";

export interface ResolvedSuggestions {
  suggestions: SearchSuggestion[];
  /**
   * True while the resolver has been asked about the current value and has not answered.
   * Visible rows show a "checking…" hint, which also clears on a miss or failure.
   */
  checking: boolean;
}

/**
 * Shape suggestions instantly, upgraded to confirmed rows when the resolver answers.
 *
 * Heights and addresses render their local row on the first keystroke, since their type is
 * known from shape. A 64-hex string is ambiguous (txid or block hash), so its list stays empty
 * while the resolver is out (with no debounce) and the first row shown is the confirmed one;
 * the ambiguous /search row appears only as the final state on a miss or failure, so it never
 * flips. A miss or outage can never empty the list.
 *
 * Requests go only to this origin's resolver, and only for plausible identifiers. Zcash names
 * are answered from the API's own snapshot of the registry, never forwarded to it, and wait
 * longer before asking because a word is usually still being typed.
 */
export function useResolvedSuggestions(value: string): ResolvedSuggestions {
  const local = searchSuggestions(value);
  const kind = classifySearchQuery(value).type;
  const ambiguous = kind === "hash64";
  const isName = kind === "name";
  const [resolved, setResolved] = useState<{ for: string; rows: SearchSuggestion[] } | null>(null);
  const [settledFor, setSettledFor] = useState<string | null>(null);

  useEffect(() => {
    if (searchSuggestions(value).length === 0) return;
    const kindNow = classifySearchQuery(value).type;
    const isHash = kindNow === "hash64";
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        // The canonical spelling: the route refuses any other, so the CDN keeps one entry per
        // question.
        const q = canonicalSearchQuery(value);
        fetch(`/api/resolve?q=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : { found: [] }))
          .then((body: { q?: string; found?: SearchSuggestion[] }) => {
            // The route echoes `q`; an answer to a different question (a cache or proxy keyed
            // wrongly) falls through to the local shape suggestions. A missing echo is rejected
            // too, since that is what a stale cached response from an older route looks like.
            if (body.q === q && Array.isArray(body.found) && body.found.length > 0) {
              setResolved({ for: value, rows: body.found });
            }
            setSettledFor(value);
          })
          .catch(() => {
            // A failed or aborted lookup is still settled, so `checking` clears.
            setSettledFor(value);
          });
      },
      // Debounced so typing does not fire per keystroke. A complete 64-hex value cannot grow
      // into anything else, so it resolves immediately.
      isHash ? 0 : kindNow === "name" ? 500 : 300,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  if (resolved?.for === value) {
    return { suggestions: resolved.rows, checking: false };
  }
  if (isName) {
    // A name's local row is only a gate, never a destination: offering "zenith.zcash" for a word
    // nobody registered would say we found something. Confirmed row or nothing.
    return { suggestions: [], checking: settledFor !== value };
  }
  const checking = local.length > 0 && settledFor !== value;
  if (ambiguous && checking) {
    // The one case where waiting beats showing: the local row's type is a guess here.
    return { suggestions: [], checking: true };
  }
  return { suggestions: local, checking };
}
