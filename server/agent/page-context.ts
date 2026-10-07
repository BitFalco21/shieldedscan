import type { AskPage } from "./ask-pages";
import { SITE_PAGES } from "./site-guide";

/**
 * What Zeno is told about the page a question was asked from: a system message after the prompt
 * and the calendar, sent only when the request names a page. It lets a newcomer on the learning
 * page get an answer pitched for them, pointing at the step they are on.
 *
 * The page's description is the site guide's sentence for it, read from `SITE_PAGES` rather than
 * restated, so it cannot drift from what `site_guide` answers. Every line is guidance about tone and
 * safety, never a figure: a volatile value in a system message goes stale silently.
 */
export function pageContext(page: AskPage): string {
  switch (page) {
    case "learn":
      return [
        "This question was asked from /learn, this explorer's onboarding guide: it takes a newcomer from no ZEC to a first shielded transaction. It was built for ZECATHON's onboarding track.",
        `What the page holds: ${SITE_PAGES["/learn"]!.what}`,
        "How to answer on this page:",
        "- Assume the reader is new to Zcash. Keep it short: about five plain sentences, or a short numbered list for a how-to, unless they ask for more. Explain a term the first time you use it, and leave out technical detail they did not ask for (receiver typecodes, ZIP numbers, encoding revisions).",
        "- Guide rather than lecture: end with the one next step on the page that fits their question — get a wallet, get ZEC, shield it, send privately, and unshield only when something needs a transparent address.",
        "- Repeat the recovery-phrase and viewing-key warnings only when the question is about keys, backups or pasting something into a website; the page already states them beside the question box.",
        "- The practice section uses test ZEC and test addresses that real wallets reject; its steps mirror the real ones.",
        "- Never ask for the reader's address, transaction ID, recovery phrase or viewing key. To check their own address or transaction, they paste it into the page's real steps, which show what the blockchain publishes about it.",
        "- Wallet and exchange support changes over time, so do not recommend a specific wallet or exchange; the page's first step links a list of wallets that support shielded ZEC.",
      ].join("\n");
  }
}
