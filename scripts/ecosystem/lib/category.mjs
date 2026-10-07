/**
 * A DRAFT category for each candidate, read off where it was found rather than guessed from
 * its name. A project listed on ZecHub's Wallets page is drafted as a wallet because a page
 * about wallets listed it; a crate that depends on `zcash_primitives` is drafted as a library
 * because crates.io says so. Every draft carries its basis, so a reviewer can see why a row sits
 * where it does and overrule it.
 *
 * Rules are ordered strongest first: a ZecHub catalogue ENTRY outranks a mention, and a
 * catalogue page outranks a code signal (a wallet with a crate dependency is still a wallet).
 * Nothing matching yields "unsorted" — never a guess.
 */

/** ZecHub page path (after `site/`) → category. First match wins. */
const ZECHUB_PAGES = [
  [/Using_Zcash\/Wallets\.md$/, "wallet"],
  [/Using_Zcash\/Metamask_Snap\.md$/, "wallet"],
  [/Using_Zcash\/Zcash_Mining_Pools\.md$/, "mining"],
  [/Using_Zcash\/(Custodial_Exchanges|Buying_ZEC)\.md$/, "exchange"],
  [/Using_Zcash\/(Payment_Processors|Creators_and_Tips)\.md$/, "payments"],
  [/Using_Zcash\/Spend_Zcash\//, "payments"],
  [/Zcash_Tech\/(Full_Nodes|Lightwallet_Nodes)\.md$/, "node"],
  [/Zcash_Organizations\//, "organisation"],
  [/Start_Here\/Developer_Resources\.md$/, "developer"],
  [/Zcash_Community\/(Community_Blogs|Zcon_Vozes)\.md$/, "media"],
  [/Zcash_Community\//, "community"],
];

const TOPICS = { "zcash-wallet": "wallet", lightwalletd: "node" };

function zechubPage(where) {
  const m = /\/blob\/[^/]+\/site\/(.+)$/.exec(where ?? "");
  return m ? m[1] : null;
}

function fromZechub(mentions, strength) {
  for (const m of mentions) {
    if (m.source !== "zechub" || m.strength !== strength) continue;
    const page = zechubPage(m.where);
    if (!page) continue;
    for (const [re, category] of ZECHUB_PAGES) {
      if (re.test(page)) return { category, basis: `ZecHub ${strength}: ${page}` };
    }
  }
  return null;
}

/**
 * @param {{ mentions: { source: string, strength: string, where?: string, topic?: string }[] }} c
 * @returns {{ category: string, basis: string }}
 */
export function draftCategory(c) {
  const mentions = c.mentions ?? [];
  const entry = fromZechub(mentions, "entry");
  if (entry) return entry;

  const topic = mentions.find((m) => m.source === "github" && m.topic && TOPICS[m.topic]);
  if (topic) return { category: TOPICS[topic.topic], basis: `GitHub topic: ${topic.topic}` };

  const mention = fromZechub(mentions, "mention");
  if (mention) return mention;

  if (mentions.some((m) => m.source === "crates")) {
    return { category: "library", basis: "crates.io: depends on a Zcash crate" };
  }
  return { category: "unsorted", basis: "no source says what it is" };
}
