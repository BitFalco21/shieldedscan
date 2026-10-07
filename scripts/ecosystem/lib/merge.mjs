/**
 * Merges source items into candidates: one row per project, however many links name it.
 *
 * An item may name several links for one project — a GitHub repo and its homepage, a crate's
 * repository and its site — so the links an item names are UNIONED (union-find over keys). That
 * is what joins ZecHub's `zingolabs.org` to GitHub's `github.com/zingolabs/zingolib`.
 *
 * One guard, because the naive union is wrong in a specific way: a site many repositories name
 * as their homepage (every `zcash/*` repo points at `z.cash`) is an UMBRELLA, not the project
 * itself, and unioning through it would collapse dozens of distinct projects into one row. A
 * site named as homepage by UMBRELLA_MIN or more distinct repositories is not unioned through;
 * each repository keeps its row and records the umbrella.
 */
import { candidateKey } from "./candidate-key.mjs";

export const UMBRELLA_MIN = 3;

/** Link texts that are not names. A candidate never takes one of these as its name. */
const GENERIC_LABELS = new Set([
  "here",
  "visit",
  "github",
  "website",
  "link",
  "click here",
  "read more",
  "source",
  "docs",
  "download",
  "learn more",
  "app",
  "web",
  "home",
  "homepage",
  "faq",
  "faqs",
  "repo",
  "repository",
  "github link",
  "github repo",
  "official website",
  "website link",
  "this",
]);

/** Compared with punctuation stripped, so "Visit ->" and "here." are caught as well as "Visit". */
export function isGenericLabel(name) {
  if (!name) return true;
  // A URL pasted as link text names nothing; the page title is the better name.
  if (/^\s*(https?:\/\/|www\.)/i.test(name)) return true;
  const bare = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return bare.length < 2 || GENERIC_LABELS.has(bare);
}

/** Every link an item names, in the order it names them. */
function linksOf(item) {
  return [item.url, item.repo, item.homepage].filter((u) => typeof u === "string" && u.trim());
}

/** A link that is plainly internal to the page it came from: relative paths and anchors. */
export function isInternalLink(url) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url.trim());
}

function bestName(names) {
  const counts = new Map();
  for (const name of names)
    if (!isGenericLabel(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? null;
}

const STRENGTH_ORDER = ["entry", "dependent", "topic", "mention"];

/**
 * @typedef {{ source: string, strength: string, name: string | null, url: string, repo?: string | null, homepage?: string | null, [field: string]: unknown }} SourceItem
 * @typedef {{ grant: string, grantee: string, status: string, lastPaid: string | null }} GrantRef
 * @typedef {{ key: string, keys: string[], kind: string, name: string | null, sources: string[], strongest: string, umbrellas: string[], mentions: SourceItem[], possibleGrants?: GrantRef[] }} Candidate
 */

/**
 * @param {SourceItem[]} items
 * @returns {{ candidates: Candidate[], internal: number, unkeyable: SourceItem[], umbrellas: string[] }}
 */
export function mergeItems(items) {
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const add = (k) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  // First pass: which site keys are homepages of many distinct repositories.
  const reposBySite = new Map();
  for (const item of items) {
    const keys = linksOf(item).map(candidateKey).filter(Boolean);
    const repos = keys.filter((k) => k.kind === "repo").map((k) => k.key);
    for (const site of keys.filter((k) => k.kind === "site")) {
      if (!reposBySite.has(site.key)) reposBySite.set(site.key, new Set());
      for (const r of repos) reposBySite.get(site.key).add(r);
    }
  }
  const umbrellas = new Set(
    [...reposBySite].filter(([, r]) => r.size >= UMBRELLA_MIN).map(([s]) => s),
  );

  let internal = 0;
  const unkeyable = [];
  const placed = [];
  const kinds = new Map();
  for (const item of items) {
    const links = linksOf(item);
    if (links.length > 0 && links.every(isInternalLink)) {
      internal += 1;
      continue;
    }
    const keys = links.map(candidateKey).filter(Boolean);
    if (keys.length === 0) {
      unkeyable.push(item);
      continue;
    }
    const joinable = keys.filter(
      (k) => !(k.kind === "site" && umbrellas.has(k.key) && keys.length > 1),
    );
    const anchor = (joinable[0] ?? keys[0]).key;
    for (const k of keys) {
      add(k.key);
      kinds.set(k.key, k.kind);
    }
    for (const k of joinable) union(anchor, k.key);
    placed.push({ item, anchor, umbrella: keys.find((k) => umbrellas.has(k.key))?.key ?? null });
  }

  const groups = new Map();
  for (const { item, anchor, umbrella } of placed) {
    const root = find(anchor);
    if (!groups.has(root)) groups.set(root, { mentions: [], umbrellas: new Set() });
    const g = groups.get(root);
    g.mentions.push(item);
    if (umbrella) g.umbrellas.add(umbrella);
  }
  const keysByRoot = new Map();
  for (const k of parent.keys()) {
    const root = find(k);
    if (!keysByRoot.has(root)) keysByRoot.set(root, []);
    keysByRoot.get(root).push(k);
  }

  const candidates = [...groups].map(([root, g]) => {
    const keys = (keysByRoot.get(root) ?? [root])
      .filter((k) => !umbrellas.has(k) || k === root)
      .sort();
    const kindsHere = keys.map((k) => kinds.get(k));
    const primary =
      keys.find((k) => kinds.get(k) === "site") ??
      keys.find((k) => kinds.get(k) === "repo") ??
      keys[0];
    const strengths = new Set(g.mentions.map((m) => m.strength));
    return {
      key: primary,
      keys,
      kind: kindsHere.includes("site")
        ? "site"
        : kindsHere.includes("repo")
          ? "repo"
          : kinds.get(primary),
      name: bestName(g.mentions.map((m) => m.name)),
      sources: [...new Set(g.mentions.map((m) => m.source))].sort(),
      strongest: STRENGTH_ORDER.find((s) => strengths.has(s)) ?? "mention",
      umbrellas: [...g.umbrellas].sort(),
      mentions: g.mentions,
    };
  });
  return { candidates, internal, unkeyable, umbrellas: [...umbrellas].sort() };
}

function normalize(text) {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Names any Zcash project may carry: the protocol's own components. A repo called `zcash`
 * matched 96 grant titles and a copy called `zebra` inherited the Zcash Foundation's grants,
 * so a match on one of these says nothing about which project was funded.
 */
const PROTOCOL_WORDS = new Set([
  "zcash",
  "zcashd",
  "zebra",
  "zebrad",
  "orchard",
  "sapling",
  "sprout",
  "ironwood",
  "halo2",
  "halo 2",
  "lightwalletd",
  "frost",
  "shielded",
]);

/**
 * Attaches POSSIBLE Zcash Community Grants matches: a grant whose title or grantee contains the
 * candidate's name as whole words. Possible, never confirmed — "Edge" or "Cake" can appear in a
 * title that is about something else, so a person decides. Names under 4 characters are skipped
 * outright because they match too much.
 */
/**
 * @template {{ name: string | null }} T
 * @param {T[]} candidates
 * @param {{ grant: string, grantee: string, status: string, lastPaid: string | null }[]} grants
 * @returns {(T & { possibleGrants: GrantRef[] })[]}
 */
export function attachGrantMatches(candidates, grants) {
  const prepared = grants.map((g) => ({ g, text: normalize(`${g.grant} ${g.grantee}`) }));
  for (const c of candidates) {
    const n = c.name ? normalize(c.name).trim() : "";
    if (n.replace(/ /g, "").length < 4 || PROTOCOL_WORDS.has(n)) {
      c.possibleGrants = [];
      continue;
    }
    c.possibleGrants = prepared
      .filter(({ text }) => text.includes(` ${n} `))
      .map(({ g }) => ({
        grant: g.grant,
        grantee: g.grantee,
        status: g.status,
        lastPaid: g.lastPaid,
      }));
  }
  return candidates;
}
