import { type FxPort, MemoryFxRates, resolveCurrency, USD } from "../../fx-rates";
import { evaluateExpression, formatCalculationResult } from "../calculator";
import { renderCoverage } from "../coverage";
import {
  REFERENCE_TOPIC_NAMES,
  REFERENCE_TOPICS,
  type ReferenceTopicName,
  renderReferenceTopic,
} from "../reference";
import type { LabelledBalances } from "@/domain";
import {
  asLabelledBalances,
  renderApiEndpointSection,
  renderLabels,
  renderPages,
  renderPrivacy,
} from "../site-guide";
import { callsFor } from "./calls";
import { isRefusal, parseChartArgs } from "./chart-args";
import { ChartSourceCache } from "./chart-cache";
import { refusalResult } from "./chart-refusal";
import { buildChart } from "./chart-tool";
import { parseExportArgs } from "./export-args";
import { ExportPreviewCache } from "./export-cache";
import { exportRefusalResult, isExportRefusal } from "./export-refusal";
import { buildExport, type ExportCaches } from "./export-tool";
import { toolDefinitions } from "./definitions";
import { entityBlock, spotPriceUsdFrom } from "./entities";
import { asRecord, parseJson } from "./json";
import { TOOL_NAMES } from "./names";
import { CALCULATE_NOTE } from "./notes";
import { dataBlock, insightJson, unreadableAggregate } from "./payload";
import {
  API_DOCS_SOURCE,
  COVERAGE_SOURCE,
  LABELS_PATH,
  LABELS_SOURCE,
  MAX_EXPRESSIONS_PER_CALL,
  PRIVACY_SOURCE,
  SITE_GUIDE_SECTIONS,
  SITE_PAGES_SOURCE,
} from "./specs";
import type {
  ChainRequester,
  DispatchedToolName,
  ToolCall,
  ToolResult,
  V1Requester,
  Valuation,
} from "./types";

/**
 * The agent's read-only tools, dispatched in-process against this same service.
 *
 * `request(path)` returns the same Response the API would serve over the wire, without touching
 * the network. Two surfaces, deliberately:
 *
 *  - Entity detail (a transaction, a block, an address) goes through `/v1`. The agent then sees
 *    exactly what a stranger with curl sees and not one field more; every null arrives already
 *    labelled with its `unknowns` reason, so "shielded" cannot be reported as zero; and there is
 *    no second mapping layer to drift from `server/v1/map.ts`.
 *  - Aggregate analytics goes through the private `/chain/*` and `/crosschain/*` routes, some of
 *    which `/v1` does not publish. The pre-labelled-null property matters much less here: a day's
 *    transaction count has no shielded value to mislabel, and a null in a rollup is a coverage gap
 *    rather than an encrypted amount.
 *
 * The dispatch mechanism is the same for both: a renamed route breaks the agent's tests in the
 * same commit, which a direct call into a query function would not.
 *
 * Arguments are URL-encoded into fixed path templates. The dispatcher never builds a host, so an
 * SSRF-shaped argument ("http://169.254.169.254") becomes a path segment that 404s, never a
 * request to somewhere else.
 */
export class AgentTools {
  readonly #v1: V1Requester;
  readonly #chain: ChainRequester;
  readonly #now: () => number;
  readonly #fx: FxPort;
  /** Whether `make_chart` is offered at all (`AGENT_CHARTS_ENABLED`). */
  readonly charts: boolean;
  readonly #chartCache: ChartSourceCache;
  /** Whether `export_data` is offered at all (`AGENT_EXPORTS_ENABLED`). */
  readonly exports: boolean;
  readonly #exportCaches: ExportCaches;

  /**
   * `chain` is required on purpose: an optional dependency would let a caller mount an agent that
   * advertises `explorer_insights` in every prompt and 404s when the model uses it.
   */
  constructor(
    v1: V1Requester,
    chain: ChainRequester,
    now: () => number = Date.now,
    fx: FxPort = new MemoryFxRates([USD], {}, {}),
    opts: {
      charts?: boolean;
      chartCache?: ChartSourceCache;
      exports?: boolean;
      exportCaches?: ExportCaches;
    } = {},
  ) {
    this.#v1 = v1;
    this.#chain = chain;
    this.#now = now;
    this.#fx = fx;
    this.charts = opts.charts ?? true;
    this.#chartCache = opts.chartCache ?? new ChartSourceCache();
    this.exports = opts.exports ?? true;
    this.#exportCaches = opts.exportCaches ?? {
      previews: new ExportPreviewCache(),
      addresses: new ExportPreviewCache(),
    };
  }

  /** The tools this instance offers: every one, less the chart and export tools when off. */
  #toolNames(): readonly string[] {
    return TOOL_NAMES.filter(
      (n) => (this.charts || n !== "make_chart") && (this.exports || n !== "export_data"),
    );
  }

  /** OpenAI-format tool definitions, closed schemas throughout. */
  defs() {
    const offered = this.#toolNames();
    return toolDefinitions().filter((d) => offered.includes(d.function.name));
  }

  /**
   * `make_chart`: validate, read through the shared cache, build. Never throws: whatever goes wrong
   * past validation is a refusal in words, so a chart can fail without taking the answer with it.
   */
  async #chart(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const request = parseChartArgs(args, this.#now());
      if (isRefusal(request)) return refusalResult(request);
      const outcome = await buildChart(
        request,
        async (surface, path) => {
          const res = await (surface === "v1" ? this.#v1 : this.#chain).request(path);
          return { status: res.status, body: await res.text() };
        },
        this.#now(),
        this.#chartCache,
      );
      if ("reason" in outcome) return refusalResult(outcome);
      return { content: outcome.content, endpoints: [], chart: outcome.chart };
    } catch {
      return refusalResult({
        reason: "unavailable",
        message: "the chart could not be built just now — say so, and give no figure in its place",
      });
    }
  }

  /**
   * `export_data`: validate, read the route in-process through the shared cache, card. Never throws:
   * whatever goes wrong past validation is a refusal in words and no file.
   */
  async #export(args: Record<string, unknown>, userText: string): Promise<ToolResult> {
    try {
      const request = parseExportArgs(args, this.#now());
      if (isExportRefusal(request)) return exportRefusalResult(request);
      const outcome = await buildExport(
        request,
        async (path) => {
          const res = await this.#v1.request(path);
          return { status: res.status, body: await res.text() };
        },
        this.#exportCaches,
        userText,
        this.#now(),
      );
      if (isExportRefusal(outcome)) return exportRefusalResult(outcome);
      return { content: outcome.content, endpoints: [], export: outcome.card };
    } catch {
      return exportRefusalResult({
        reason: "unavailable",
        message:
          "the file could not be prepared just now — say so, and give no figure in its place",
      });
    }
  }

  /**
   * The label table with every labelled address's balance beside it, so a question about an
   * entity costs one read rather than one per address.
   *
   * The table is committed and always renders. Only the balances are live, and a failed read prints
   * the table without them, saying so; a balance is never filled in from anywhere else.
   */
  async #labels(): Promise<ToolResult> {
    let balances: LabelledBalances | null = null;
    try {
      const res = await this.#v1.request(LABELS_PATH);
      if (res.ok) balances = asLabelledBalances(parseJson(await res.text()));
    } catch {
      balances = null;
    }
    return {
      content: renderLabels(balances, new Date(this.#now()).toISOString()),
      endpoints: balances ? [LABELS_SOURCE, `GET ${LABELS_PATH}`] : [LABELS_SOURCE],
    };
  }

  /**
   * Run one tool call. `rawArgs` is the JSON string exactly as the model produced it. Never throws for
   * bad input — a malformed call is an error message for the model, so it can correct itself; only a
   * transport-level failure of /v1 itself propagates.
   *
   * `userText` is what the reader typed in this conversation, for the one tool that must know an
   * argument came from the reader rather than from data (an address's history as a file).
   */
  async dispatch(name: string, rawArgs: string, userText = ""): Promise<ToolResult> {
    const offered = this.#toolNames();
    if (!offered.includes(name)) {
      return {
        content: `unknown tool: ${name} — available tools are ${offered.join(", ")}`,
        endpoints: [],
      };
    }

    let args: Record<string, unknown>;
    try {
      const parsed = asRecord(JSON.parse(rawArgs));
      if (parsed === null) throw new Error("not an object");
      args = parsed;
    } catch {
      return { content: `invalid arguments for ${name}: not a JSON object`, endpoints: [] };
    }

    /*
     * `zcash_reference` returns before `callsFor`: it has nothing to call, since its answer is a
     * committed constant in this repo. The usual reason for in-process dispatch — a renamed route
     * breaks the agent's tests — does not apply to a constant with no surface to drift from. Serving it
     * at a real endpoint would create a new API contract and only buy a citation of our own echo of our
     * own string, weaker evidence than the primary source each entry already cites.
     */
    if (name === "zcash_reference") {
      const topic = typeof args.topic === "string" ? args.topic.trim() : "";
      if (!(topic in REFERENCE_TOPICS)) {
        return {
          content: `invalid arguments for zcash_reference: topic must be one of ${REFERENCE_TOPIC_NAMES.join(", ")}`,
          endpoints: [],
        };
      }
      return renderReferenceTopic(topic as ReferenceTopicName, this.#now());
    }

    /*
     * `calculate` also returns before `callsFor`: it evaluates its own arguments and reads nothing (see
     * `calculator.ts`). The only risk left is which numbers the model chose, which is as visible as the
     * expression. A bad expression is an error in its own row, so one typo does not void the others.
     */
    if (name === "calculate") {
      const raw = args.expressions;
      if (!Array.isArray(raw) || raw.length === 0 || !raw.every((e) => typeof e === "string")) {
        return {
          content: `invalid arguments for calculate: expressions must be a non-empty array of strings`,
          endpoints: [],
        };
      }
      if (raw.length > MAX_EXPRESSIONS_PER_CALL) {
        return {
          content: `invalid arguments for calculate: at most ${MAX_EXPRESSIONS_PER_CALL} expressions per call`,
          endpoints: [],
        };
      }
      const results = raw.map((expression) => {
        const outcome = evaluateExpression(expression);
        return outcome.ok
          ? { expression, value: outcome.value, text: formatCalculationResult(outcome.value) }
          : { expression, error: outcome.error };
      });
      // No <data> envelope: the envelope means "anyone may have written this", and nothing here traversed
      // a third party. The note carries the operand responsibility, because the numbers were the model's
      // choice.
      return {
        content: `<note source="calculator">\n${CALCULATE_NOTE}\n</note>\n${JSON.stringify({ results }, null, 1)}`,
        endpoints: [],
      };
    }

    /*
     * `make_chart` also returns before `callsFor`: its paths are fixed by the catalogue, never built
     * from arguments, and its result carries a chart beside the text. The arguments choose series and
     * a window only; every value is read here from the source bodies.
     *
     * No endpoints are cited: the chart links its own `/charts` page, the evidence a reader can open.
     */
    if (name === "make_chart") return this.#chart(args);
    /*
     * `export_data` also returns here: its paths come from the export registry, never from the
     * arguments, and its result carries a card beside the text. The card is its own citation.
     */
    if (name === "export_data") return this.#export(args, userText);

    /*
     * `site_guide`'s committed sections return here: they read constants in this repo (the docs
     * catalogue and the sitemap's path list), so there is nothing to dispatch and nothing to fail.
     *
     * Its `api` section is not here: the descriptor is a live public endpoint and falls through to the
     * normal path. Rate limits, the endpoint list and the refusal list are the API's own current
     * statement about itself and must be read, not remembered.
     */
    if (name === "site_guide") {
      const section = typeof args.section === "string" ? args.section.trim() : "";
      if (section === "pages") return { content: renderPages(), endpoints: [SITE_PAGES_SOURCE] };
      if (section === "coverage")
        return { content: renderCoverage(), endpoints: [COVERAGE_SOURCE] };
      if (section === "privacy") return { content: renderPrivacy(), endpoints: [PRIVACY_SOURCE] };
      if (section === "labels") return this.#labels();
      if (section === "api-endpoint") {
        const endpoint = typeof args.endpoint === "string" ? args.endpoint.trim() : "";
        return {
          content: renderApiEndpointSection(endpoint === "" ? null : endpoint),
          endpoints: [API_DOCS_SOURCE],
        };
      }
      if (section !== "api") {
        return {
          content: `invalid arguments for site_guide: section must be one of ${SITE_GUIDE_SECTIONS.join(", ")}`,
          endpoints: [],
        };
      }
    }

    const nowMs = this.#now();
    /*
     * The currency is resolved before any upstream read, and a refusal short-circuits. A currency we
     * cannot rate must never be answered in dollars: a dollar figure under a euro question is a
     * well-formed answer that nothing downstream can catch. So the tool declines and names the currency.
     */
    const money = resolveCurrency(
      typeof args.currency === "string" ? args.currency : undefined,
      this.#fx,
    );
    if (!money.ok) return { content: money.reason, endpoints: [] };

    const calls = callsFor(name as DispatchedToolName, args, nowMs, money.currency);
    if (typeof calls === "string") {
      return { content: `invalid arguments for ${name}: ${calls}`, endpoints: [] };
    }

    const retrievedAt = new Date(nowMs).toISOString();
    const endpoints: string[] = [];
    // Every call is fetched before any is rendered, because one payload's presentation depends on
    // another's content: a pool balance is valued here using the price from a sibling facet of the same
    // call, and rendering inside the fetch loop would make the valuation depend on facet order.
    const fetched: { call: ToolCall; status: number; body: string }[] = [];
    for (const call of calls) {
      const requester = call.surface === "v1" ? this.#v1 : this.#chain;
      const res = await requester.request(call.path);
      fetched.push({ call, status: res.status, body: await res.text() });
      // Cited only when it answered (see `ToolResult.endpoints`): a 404 on a model-invented identifier must
      // not become a source.
      if (res.status >= 200 && res.status < 300) endpoints.push(`GET ${call.path}`);
    }
    const priceUsd = spotPriceUsdFrom(fetched);
    const valuation: Valuation = { priceUsd, rate: money.rate, currency: money.currency };

    const blocks: string[] = [];
    /*
     * A note is printed once per tool call, however many payloads share it (e.g. `on:` fetching the
     * same path for eight days). Keyed on the note text rather than the path, since that is what would
     * be duplicated; two different notes in one call still both appear.
     */
    const notesEmitted = new Set<string>();
    for (const { call, status, body } of fetched) {
      const spec = call.aggregate;
      if (spec === undefined) {
        blocks.push(entityBlock(call.path, retrievedAt, body, valuation, notesEmitted));
        continue;
      }
      // A failed aggregate read is an error the model is told about, never an empty series: `[]` would
      // state that Zcash has no shielding history, and a `null` body from a missing rollup row would read
      // as "the pool holds nothing".
      const parsed = parseJson(body);
      const unreadable = unreadableAggregate(status, parsed, spec.upstream, spec.emptyIsAnAnswer);
      if (unreadable !== null) {
        blocks.push(
          `<unavailable source="GET ${call.path}" retrieved-at="${retrievedAt}">\n${unreadable}\n</unavailable>`,
        );
        continue;
      }
      // The narrowing the server echoed, checked against the one requested. A payload answering a wider
      // question is refused outright, because nothing in its numbers would give it away.
      const mismatch = spec.verify?.(parsed) ?? null;
      if (mismatch !== null) {
        blocks.push(
          `<unavailable source="GET ${call.path}" retrieved-at="${retrievedAt}">\n${mismatch}\n</unavailable>`,
        );
        continue;
      }
      const data = dataBlock(call.path, retrievedAt, insightJson(parsed, spec, valuation));
      // The note leads its first payload and is omitted on repeats. It stays attached to a path rather
      // than floating above the run, so a call mixing two notes still shows which caveat belongs to which
      // data.
      if (notesEmitted.has(spec.note)) {
        blocks.push(data);
      } else {
        notesEmitted.add(spec.note);
        blocks.push(`<note source="GET ${call.path}">\n${spec.note}\n</note>\n${data}`);
      }
    }
    return { content: blocks.join("\n\n"), endpoints };
  }
}

export { TOOL_NAMES, type ToolName } from "./names";
export { ChartSourceCache } from "./chart-cache";
export { ExportPreviewCache } from "./export-cache";
export { type ToolResult, type SourceLink, type V1Requester, type ChainRequester } from "./types";
export { CHAIN_STATUS_FACETS, INSIGHT_TOPICS } from "./specs";
export { CHAIN_WINDOW_NOTE } from "./notes";
export { MAX_TX_SIDE_ENTRIES, transactionJson } from "./entities";
export { upgradeContextFor, groupedSibling, withFormattedZec } from "./payload";
export {
  SUBJECT_PARTS,
  MAX_STEP_SUBJECT_CHARS,
  describeToolCall,
  sourceLinkFor,
} from "./presentation";
