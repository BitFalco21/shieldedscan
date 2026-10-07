/**
 * A public value the site does not currently have.
 *
 * Deliberately not the Veil: redaction bars mean "encrypted on-chain, hidden by design", and a
 * cold price feed of ours is not a privacy property of Zcash. A shielded amount is unknowable;
 * these numbers are merely unmeasured, and the honest thing is to say which.
 *
 * Also not a substituted number, a `0`, or a bare `—`: "unavailable" in words cannot be misread
 * as data. Same faint ink as the "unknown" used for a fee we could not derive, so the two read
 * as one idea.
 */
export function Unmeasured() {
  return <span className="text-ink-faint">unavailable</span>;
}
