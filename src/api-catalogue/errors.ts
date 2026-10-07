import type { ApiErrorRow } from "./types";

/** The status table the docs render — one row per status the API can actually emit. */
export const API_ERRORS: ApiErrorRow[] = [
  // These two rows say what the status means and nothing more; ETag and Cache-Control are
  // explained once, in the "A repeat request can be free" convention.
  {
    status: "200",
    meaning:
      "Success. Carries `X-Request-Id` — the same value an error body puts in `requestId`, so any request can be quoted back to us either way.",
  },
  {
    status: "304",
    meaning: "Not modified — your `If-None-Match` tag still matches. No body to re-parse.",
  },
  {
    status: "400",
    meaning:
      "Bad request — including any query parameter the endpoint does not define. `?cachebust=x` is a 400 by design, not a cache miss.",
  },
  {
    status: "404",
    meaning: "The block, transaction or transfer does not exist. Never used for outages.",
  },
  {
    status: "429",
    meaning:
      "Rate limited. Carries `Retry-After` and the same JSON error envelope as every other error — parse it like any response.",
  },
  {
    status: "503",
    meaning:
      "An upstream source (node or store) is unavailable. Deliberately never a 404: an outage is not an absence.",
  },
];
