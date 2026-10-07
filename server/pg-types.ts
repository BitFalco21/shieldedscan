import { types } from "pg";

/**
 * BIGINT (oid 20) and NUMERIC (oid 1700) as JS numbers rather than the driver's default strings,
 * process-wide. The BIGINT columns are zatoshis, unix seconds and counters, and max supply
 * (2.1e15 zat) is well inside `Number.MAX_SAFE_INTEGER`; as strings, `+` would concatenate and
 * comparisons would be lexical.
 *
 * A side-effect module, imported by every module whose queries rely on it, so each works on its
 * own (in a test, or in a single-purpose entrypoint) whatever else was loaded first. Registration
 * is idempotent.
 */
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);
