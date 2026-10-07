import type {
  RpcBlock,
  RpcBlockHeader,
  RpcBlockSummary,
  RpcTransaction,
} from "@/data/chain/rpc-types";
import type { NodeRpcPort } from "./follow";

/**
 * JSON-RPC client for the Zcash node.
 *
 * Thin by design: everything that decides meaning lives in the pure parsers under
 * `src/data/chain/`, and this file only moves bytes, the same split as `venues.ts`.
 *
 * The node's RPC port is never published to the host or the internet; it is reached over the
 * private Docker network. Network isolation is why no authentication is configured here.
 */

/**
 * Generous, because `getblock` at verbosity 2 is heavy: a block's JSON is several times its
 * serialised size (mostly `hex` and `scriptSig`, which nothing here reads), and busy blocks are
 * larger still.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string } | null;
}

/**
 * One entry of `getblocksubsidy`'s stream arrays, as the node returns it: a funding stream carries
 * `address`, a lockbox stream does not (it is paid into a pool), and both carry `specification`, a
 * `zips.z.cash` URL. `recipient` is the node's own label and can lag the ZIP's current recipient
 * name (see `dto.ts`'s `V1SubsidyStream`).
 */
export interface RpcSubsidyStream {
  recipient: string;
  specification?: string;
  value: number;
  valueZat: number;
  address?: string;
}

export interface RpcBlockSubsidy {
  miner: number;
  founders: number;
  fundingstreamstotal: number;
  lockboxtotal: number;
  totalblocksubsidy: number;
  /** Omitted by the node when no such stream is active at that height, not empty. */
  fundingstreams?: RpcSubsidyStream[];
  lockboxstreams?: RpcSubsidyStream[];
}

export class NodeRpcError extends Error {
  constructor(
    readonly method: string,
    detail: string,
    /**
     * The node's JSON-RPC error code when the node answered with an error, null when it did not
     * answer at all (a transport failure, an HTTP status, our own "node busy" refusal). Only an
     * answer from the node can mean "no such block"; see `nodeSaysNotFound` in `chain-source.ts`.
     */
    readonly code: number | null = null,
  ) {
    super(`node RPC ${method} failed: ${detail}`);
    this.name = "NodeRpcError";
  }
}

/** One `getpeerinfo` entry, the fields we read. `pingtime` is seconds and may be absent. */
export interface RpcPeerInfo {
  addr: string;
  inbound: boolean;
  pingtime?: number;
}

/** Note commitment tree sizes at one block; see `HttpNodeRpc.getBlockTrees`. */
export interface BlockTreeSizes {
  sapling: number | null;
  orchard: number | null;
  ironwood: number | null;
}

/**
 * An optional ceiling on concurrent calls. Extra calls queue, and a call that cannot get a slot
 * within `maxWaitMs` fails as a transient `NodeRpcError`, answered upstream as a 503, never as
 * data.
 *
 * Opt-in: the follower and the backfill tools construct their own clients unchanged; the API gives
 * its public surface (`/v1`, the MCP server, the agent) a capped client of its own, so a crowd
 * there can neither overload the node nor slow the site's pages.
 */
export interface HttpNodeRpcLimits {
  maxInFlight: number;
  maxWaitMs: number;
  /**
   * Most calls allowed to wait for a slot, consulted by callers about to fan out (`admits`).
   * Without it, a flood of large pages could queue thousands of calls that every other node read
   * waits behind, for pages that would fail anyway. Absent, `admits` always says yes.
   */
  maxQueued?: number;
}

export class HttpNodeRpc implements NodeRpcPort {
  #inFlight = 0;
  /** Waiters not yet admitted and not yet timed out; `#waiting` also holds cancelled entries. */
  #queued = 0;
  readonly #waiting: Array<{ go: () => void; cancelled: boolean }> = [];

  private readonly timeoutMs: number;
  private readonly limits: HttpNodeRpcLimits | undefined;

  constructor(
    private readonly url: string,
    options: { timeoutMs?: number; limits?: HttpNodeRpcLimits } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.limits = options.limits;
  }

  /** The calls currently in flight — exposed for tests and nothing else. */
  get inFlight(): number {
    return this.#inFlight;
  }

  /** The calls currently waiting for a slot — exposed for tests and nothing else. */
  get queued(): number {
    return this.#queued;
  }

  /**
   * Whether `calls` more calls can start without the waiting queue passing `maxQueued`. A caller
   * about to fan out (a 100-block page) asks first and refuses the whole request at once rather
   * than queueing work that would time out anyway. Always yes for a client with no queue bound.
   */
  admits(calls: number): boolean {
    const limits = this.limits;
    if (limits?.maxQueued === undefined) return true;
    const free = Math.max(0, limits.maxInFlight - this.#inFlight);
    return this.#queued + Math.max(0, calls - free) <= limits.maxQueued;
  }

  async #acquire(method: string): Promise<void> {
    const limits = this.limits;
    if (!limits) return;
    if (this.#inFlight < limits.maxInFlight) {
      this.#inFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const entry = {
        cancelled: false,
        go: () => {
          clearTimeout(timer);
          this.#queued -= 1;
          this.#inFlight += 1;
          resolve();
        },
      };
      const timer = setTimeout(() => {
        entry.cancelled = true;
        this.#queued -= 1;
        reject(new NodeRpcError(method, `node busy: no RPC slot within ${limits.maxWaitMs} ms`));
      }, limits.maxWaitMs);
      this.#queued += 1;
      this.#waiting.push(entry);
    });
  }

  #release(): void {
    if (!this.limits) return;
    this.#inFlight -= 1;
    while (this.#waiting.length > 0) {
      const next = this.#waiting.shift()!;
      if (next.cancelled) continue;
      next.go();
      return;
    }
  }

  async #call<T>(method: string, params: unknown[]): Promise<T> {
    await this.#acquire(method);
    try {
      return await this.#send<T>(method, params);
    } finally {
      this.#release();
    }
  }

  async #send<T>(method: string, params: unknown[]): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // A transport failure is transient (the node restarting, a timeout); the follower retries
      // these, unlike a reconciliation failure.
      throw new NodeRpcError(method, error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw new NodeRpcError(method, `HTTP ${response.status}`);

    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new NodeRpcError(method, `${body.error.code} ${body.error.message}`, body.error.code);
    }
    if (body.result === undefined) throw new NodeRpcError(method, "response had no result");
    return body.result;
  }

  async getTipHeight(): Promise<number> {
    const info = await this.#call<{ blocks: number }>("getblockchaininfo", []);
    return info.blocks;
  }

  /**
   * Height is passed as a string, matching the node's own convention for `getblock`.
   * Both methods accept a hash or a height in that position.
   */
  getBlockHash(height: number): Promise<string> {
    return this.#call<string>("getblockhash", [height]);
  }

  /** Verbosity 2 inlines full transactions — one call per block rather than one per tx. */
  getBlock(height: number): Promise<RpcBlock> {
    return this.#call<RpcBlock>("getblock", [String(height), 2]);
  }

  /**
   * Each shielded pool's note commitment tree size as of one block: the number of notes ever
   * created in that pool, which is the anonymity set a spend from it hides in. Read from `getblock`
   * at verbosity 1, which carries `trees` but no transactions. A pool the node does not report
   * (Sprout, or a pool before activation) is null, never 0.
   */
  async getBlockTrees(height: number): Promise<BlockTreeSizes> {
    const block = await this.#call<{ trees?: Record<string, { size?: unknown } | undefined> }>(
      "getblock",
      [String(height), 1],
    );
    const size = (pool: "sapling" | "orchard" | "ironwood"): number | null => {
      const v = block.trees?.[pool]?.size;
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    };
    return { sapling: size("sapling"), orchard: size("orchard"), ironwood: size("ironwood") };
  }

  /** By hash rather than height. Same method — the node accepts either in that position. */
  getBlockByHash(hash: string): Promise<RpcBlock> {
    return this.#call<RpcBlock>("getblock", [hash, 2]);
  }

  /**
   * The header alone, keyed by hash: one small response instead of every transaction.
   *
   * By hash rather than height: a height names whatever block is at that height on the node's
   * current chain, so a reorg between reading a row and filling it in could write another block's
   * data into it. A hash names one block or nothing, and the node answers an unknown hash with an
   * error (`-5 block height not in best chain`), so the caller can skip rather than guess.
   */
  getBlockHeaderByHash(hash: string): Promise<RpcBlockHeader> {
    return this.#call<RpcBlockHeader>("getblockheader", [hash]);
  }

  /**
   * The header and the txids, keyed by hash: verbosity 1, a few KB for an old block instead of tens
   * or hundreds at verbosity 2. What the miner repair reads, together with the coinbase alone.
   */
  getBlockSummaryByHash(hash: string): Promise<RpcBlockSummary> {
    return this.#call<RpcBlockSummary>("getblock", [hash, 1]);
  }

  getBlockchainInfo(): Promise<RpcChainInfo> {
    return this.#call<RpcChainInfo>("getblockchaininfo", []);
  }

  /** Verbose form, so outputs carry addresses and values. */
  getRawTransaction(txid: string): Promise<RpcTransactionDetail> {
    return this.#call<RpcTransactionDetail>("getrawtransaction", [txid, 1]);
  }

  /**
   * Balance for one transparent address, native to the node. Without it a balance would mean
   * replaying the address's whole history.
   */
  getAddressBalance(address: string): Promise<{ balance: number; received: number }> {
    return this.#call<{ balance: number; received: number }>("getaddressbalance", [
      { addresses: [address] },
    ]);
  }

  /**
   * Every txid touching an address, newest last. Unbounded: the node offers no pagination, so a
   * very active address returns a large array; callers cache the list and page in memory.
   */
  getAddressTxids(address: string): Promise<string[]> {
    return this.#call<string[]>("getaddresstxids", [{ addresses: [address] }]);
  }

  /**
   * The node's own peer table: the one `/network` figure that does not come from the crawl.
   * Zakura's answer carries `addr`, `inbound` and `pingtime` but no `subver`, so nothing here can
   * name a peer's software. The route reduces it to counts before serialising; a peer address never
   * leaves the box.
   */
  getPeerInfo(): Promise<RpcPeerInfo[]> {
    return this.#call<RpcPeerInfo[]>("getpeerinfo", []);
  }

  getRawMempool(): Promise<string[]> {
    return this.#call<string[]>("getrawmempool", []);
  }

  /**
   * The consensus subsidy at a height, from the node's own schedule, never hand-computed here
   * (recomputing it through the halvings and Blossom is error-prone). For example 4,406,399 →
   * 1.5625 ZEC and 4,406,400 → 0.78125 ZEC.
   */
  getBlockSubsidy(height: number): Promise<RpcBlockSubsidy> {
    return this.#call<RpcBlockSubsidy>("getblocksubsidy", [height]);
  }

  /**
   * The node's own network solution rate, in solutions per second, over its trailing 120-block
   * window (`getnetworkhashps` returns the same figure).
   *
   * Null on `-32601` (method not found), so a node build without it degrades the caller to the
   * labelled estimate rather than failing the page. Every other failure propagates.
   */
  async getNetworkSolps(): Promise<number | null> {
    try {
      return await this.#call<number>("getnetworksolps", []);
    } catch (error) {
      if (error instanceof NodeRpcError && error.message.includes("-32601")) return null;
      throw error;
    }
  }

  /**
   * The node's solution rate averaged over `blocks` ending at `height`. Its cost grows with the
   * span (milliseconds for a day, close to a minute for a year), so callers bound `blocks`. Null
   * where the method does not exist.
   */
  async getNetworkSolpsOver(blocks: number, height: number): Promise<number | null> {
    try {
      return await this.#call<number>("getnetworksolps", [blocks, height]);
    } catch (error) {
      if (error instanceof NodeRpcError && error.message.includes("-32601")) return null;
      throw error;
    }
  }

  /** Verbose form: per-entry size, fee, arrival time and parents, in one call. */
  getRawMempoolVerbose(): Promise<
    Record<string, { size?: number; fee?: number; time?: number; depends?: string[] }>
  > {
    return this.#call<
      Record<string, { size?: number; fee?: number; time?: number; depends?: string[] }>
    >("getrawmempool", [true]);
  }
}

/** `getblockchaininfo`, narrowed to what the explorer reads. */
export interface RpcChainInfo {
  blocks: number;
  bestblockhash: string;
  valuePools: Array<{
    id: string;
    chainValueZat: number | null;
    valueDeltaZat: number | null;
    monitored: boolean;
  }>;
}

/**
 * `getrawtransaction` verbose. A superset of the per-transaction shape inside `getblock`,
 * plus the block context a standalone lookup needs.
 */
export interface RpcTransactionDetail extends RpcTransaction {
  height?: number;
  blocktime?: number;
  blockhash?: string;
  confirmations?: number;
  /**
   * The full serialised transaction. Read only on the single-lookup path; the same field inside
   * `getblock` is never touched.
   */
  hex?: string;
}
