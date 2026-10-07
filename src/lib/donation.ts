/**
 * The donation address, in exactly one place.
 *
 * Everything that shows, copies or encodes this address reads this constant — the page,
 * the copy button, and the QR generation script (`scripts/generate-donate-qr.mjs`), which
 * parses it out of this file so the QR can never drift from the text. A donation address
 * with a transcription error is money sent into the void, which is why the QR is also
 * decoded back and compared against this string before the asset is written.
 *
 * A unified address (u1…), so any wallet pays into whichever receiver it supports — and
 * the site's own `/address/u1…` page correctly shows no balance for it: donations to a
 * shielded-capable address are not a public ledger.
 */
export const DONATION_ADDRESS =
  "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n";

/**
 * The ZIP-321 payment URI the QR encodes. The bare address also scans in most wallets,
 * but the `zcash:` scheme is what marks it as a payment target rather than a string.
 */
export const DONATION_URI = `zcash:${DONATION_ADDRESS}`;
