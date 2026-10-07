/** The shapes of the API catalogue: one entry per documented `/v1` endpoint. */

export interface ApiParam {
  name: string;
  kind: "query" | "path";
  type: string;
  required: boolean;
  description: string;
  /**
   * A REAL value the playground prefills, so the first click returns a real response
   * instead of a 404. Real means verified: the txid is a captured mainnet Ironwood
   * migration (block 3,428,150, in `__fixtures__/`), the transfer id is the oldest
   * completed Maya swap read from the production store. A fabricated example teaches a
   * 404 as the first experience of the API.
   */
  example?: string;
}

export interface ApiEndpoint {
  /** Anchor id, unique across the page. */
  id: string;
  method: "GET";
  path: string;
  title: string;
  description: string;
  params: ApiParam[];
  /** Pretty-printed JSON, pinned by hand. */
  exampleResponse: string;
  /** Caveats shown beneath the endpoint. The runnable curl is built by `curlCommand()`. */
  notes?: string[];
  /**
   * What the MCP tool carries in place of `notes`, where those are long-form explanation for a
   * developer reading this page. Absent: the tool carries `notes` as written. Kept short on
   * purpose, because every tool definition is paid for in every conversation that connects —
   * but never shorter than what a model needs to read the answer correctly.
   */
  toolNotes?: string[];
}

export interface ApiGroup {
  id: string;
  label: string;
  endpoints: ApiEndpoint[];
}

export interface ApiErrorRow {
  status: string;
  meaning: string;
}

export interface ApiRateLimitRow {
  scope: string;
  limit: string;
  window: string;
  note: string;
}

export interface ApiCodeExample {
  language: string;
  code: string;
}
