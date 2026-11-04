/**
 * What may leave this API as a file, beyond what may leave it as JSON.
 *
 * Cross-chain swap records come from the swap protocols' own feeds. Answering a question about them
 * is one thing; handing out the whole set as a file is redistribution in bulk, which waits for the
 * protocols' permission. Turning this on is the single switch: the layer then exports a
 * `/v1/crosschain/*` route once it has a spec in `registry.ts`.
 */
export const CROSSCHAIN_EXPORT_ENABLED = false;

/** Why there is no cross-chain file, in words that suit both an API client and a chat reader. */
export const CROSSCHAIN_EXPORT_REASON =
  "cross-chain swap data is not offered as a file yet: bulk redistribution awaits the swap protocols' permission.";

export const CROSSCHAIN_EXPORT_REFUSAL = `${CROSSCHAIN_EXPORT_REASON} The JSON answer is unchanged without format.`;

export const CROSSCHAIN_PREFIX = "/v1/crosschain";

/**
 * The query parameter the export layer answers on every `/v1` route. A leaf constant, so the
 * parameter rejectors can name it without importing the specs.
 */
export const EXPORT_PARAM = "format";
