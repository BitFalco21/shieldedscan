import type {
  AddressInfo,
  Block,
  MempoolEntry,
  MempoolStats,
  PoolName,
  ShieldedPool,
  SupplyBreakdown,
  Transaction,
  TransparentAddress,
  TxKind,
  TxKindFilter,
  ValuePoolName,
} from "@/domain";

import type { CursorPage, CursorQuery, Paginated } from "@/data/source";
import { decodeCursor, encodeCursor } from "@/data/cursor";
import { clampPageSize } from "./page-size";
import {
  classifyTxKind,
  computeFeeZat,
  parseBlock,
  parseTransaction,
  parsedMatchesTxKindFilter,
} from "@/data/chain/parse";
import type { ParsedTransaction } from "@/data/chain/parse";
import type { RpcTransaction } from "@/data/chain/rpc-types";
import {
  NodeRpcError,
  type HttpNodeRpc,
  type RpcBlockSubsidy,
  type RpcChainInfo,
  type RpcTransactionDetail,
} from "./node-rpc";
import { countKinds, entryFeeRateZatPerByte, summariseMempool } from "./chain-stats";
import { POOL_NAMES } from "@/domain/pool";
import { classifySearchQuery } from "@/domain/search";

/**
 * The chain half of `ExplorerDataSource`, served from the node.
 *
 * The node runs in archive mode and exposes the transparent address RPCs, so it is the source of
 * truth for detail reads; Postgres holds the derived index used for lists and analytics.
 *
 * The fan-out is cheap because every call is loopback to a container on the same host, a
 * millisecond or two each, and independent calls run concurrently.
 */

/**
 * Whether a node error is the node's own answer that the block or transaction does not exist, as
 * opposed to a failure to answer.
 *
 * A height past the tip answers `-8 block height not in best chain`, a malformed id
 * `-8 parse error`, an unknown block hash `-5`, and an unknown or malformed txid `-5`. Everything
 * else (a transport failure, an HTTP status, a timeout, the public client's own "node busy"
 * refusal, all with a null code) says nothing about the identifier and must propagate, so the
 * route answers 503 instead of claiming a real block does not exist. A 503 is never a 404; under
 * load, catching everything would turn refused calls into 404s and short pages that look whole.
 */
function nodeSaysNotFound(error: unknown): boolean {
  return error instanceof NodeRpcError && (error.code === -5 || error.code === -8);
}

/**
 * Whether an address lookup failed because the address is malformed: the only address failure
 * that may read as "not found". Everything else propagates (a 503 is never a 404).
 *
 * `parse error` is the node's `-5` prefix for an undecodable identifier, and its detail wording
 * varies (a valid `u1…` says "unexpected payload length", not "invalid Bech32 encoding"). Safe to
 * absorb: no transport failure carries the phrase (fetch says "fetch failed"/timeout, an HTTP
 * failure says "HTTP 503", and a JSON parse failure throws a bare SyntaxError).
 */
function isMalformedAddressError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /parse error|bech32|invalid address|not a valid|base58/i.test(message);
}

/** Most blocks a single filtered page request may scan before returning a short page. */
const WALK_CAP_BLOCKS = 60;

/**
 * Most txids returned inside AddressInfo. `getaddresstxids` is unpaginated, so a busy address can
 * hold hundreds of thousands, a multi-megabyte payload per view. Nothing renders the raw list
 * whole, so the cap truncates nothing user-visible.
 */
const ADDRESS_TXIDS_CAP = 2_000;
const ADDRESS_CACHE_MS = 60_000;
const ADDRESS_FAILURE_MEMORY_MS = 60_000;
/** Most distinct source transactions one transaction may need resolved on the node. */
const MAX_NODE_INPUT_SOURCES = 1_000;
const ADDRESS_MAP_MAX = 200;

/** Insert into a map used as a small FIFO cache, evicting the oldest entry past the cap. */
function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  if (map.size >= ADDRESS_MAP_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** Most pending transactions fetched to classify the mempool's privacy composition. */
const MEMPOOL_SAMPLE_CAP = 100;
const MEMPOOL_SAMPLE_CONCURRENCY = 16;
/**
 * How many source transactions to fetch from the node at once when resolving inputs. A cap rather
 * than `Promise.all` over the whole set: a transaction with thousands of inputs would otherwise
 * open that many concurrent calls against the node that serves every page.
 */
const RESOLVE_CONCURRENCY = 16;
/** See `#blockchainInfo`. */
const INFO_MEMO_MS = 1_000;

/** A cursor's numeric key, or null — a malformed or non-numeric token means "first page". */
function cursorKey(raw: string | undefined): number | null {
  if (!raw) return null;
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  const key = Number(decoded.sortKey);
  return Number.isFinite(key) ? key : null;
}

export class NodeChainSource {
  /**
   * Confirmed blocks and transactions are immutable, so caching them in-process is safe and removes
   * repeat input-resolution cost (the same previous transaction is often referenced by several
   * inputs). Bounded, so a large walk cannot grow it without limit.
   */
  readonly #txCache = new Map<string, RpcTransaction>();
  readonly #maxCache = 2_000;
  /** Full per-address txid lists, so paging a busy address is one node call per minute. */
  readonly #addrCache = new Map<string, { at: number; txids: string[] }>();
  /** Lookups in flight, so concurrent requests for one address share one node call. */
  readonly #addrInFlight = new Map<string, Promise<string[]>>();
  /** Recent failures, so an address whose history makes the node time out is not re-asked on
   * every request. A failure is remembered, never cached as an answer. */
  readonly #addrFailedAt = new Map<string, number>();

  readonly #pageRpc: HttpNodeRpc;

  constructor(
    private readonly rpc: HttpNodeRpc,
    /**
     * Fee totals from the chain index, by height, when a Postgres index is present. The index holds
     * every block's `total_fee_zat`, so a block detail's fee is one primary-key read instead of
     * resolving every input against the node. Absent (no Postgres, as in tests), or on a failed
     * index read, the fee is null ("unknown"), never a node walk and never a failed page.
     */
    private readonly index: {
      blockFees?: (heights: readonly number[]) => Promise<Map<number, number | null>>;
    } = {},
    /**
     * The client a block page's fan-out reads through, when it should not share `rpc`'s slots. A
     * 100-row page is a hundred `getblock`s, and on one shared pool a flood of deep pages would
     * make single-block, address and tip reads wait behind them. The public source passes its own
     * small pool here, so pages wait only behind pages. Absent, pages use `rpc`.
     */
    pages: { rpc?: HttpNodeRpc } = {},
  ) {
    this.#pageRpc = pages.rpc ?? rpc;
  }

  // -------------------------------------------------------------------- chain

  /**
   * The node's chain info, remembered for one second. Every detail request asks for the tip (to
   * size a cache window, to count confirmations); a block arrives every 75 s, so a one-second memo
   * changes no visible answer and turns the call into one per second under any traffic. A failed
   * read is not remembered, so an outage is never served as the tip.
   */
  #info: { at: number; value: Promise<RpcChainInfo> } | null = null;
  #blockchainInfo(): Promise<RpcChainInfo> {
    const now = Date.now();
    if (this.#info && now - this.#info.at < INFO_MEMO_MS) return this.#info.value;
    const value = this.rpc.getBlockchainInfo();
    this.#info = { at: now, value };
    value.catch(() => {
      if (this.#info?.value === value) this.#info = null;
    });
    return value;
  }

  async getTipHeight(): Promise<number> {
    return (await this.#blockchainInfo()).blocks;
  }

  /** The tip's height and hash from one read — what a block list pages against (`block-list.ts`). */
  async getTip(): Promise<{ height: number; hash: string }> {
    const info = await this.#blockchainInfo();
    return { height: info.blocks, hash: info.bestblockhash };
  }

  /**
   * The chain facts `ChainInfo` needs that the node can answer. Price and 24-hour activity come
   * from separate trackers, not from a per-render aggregation here.
   *
   * `circulatingSupplyZat` is the six-pool partition minus the lockbox. The six pools partition all
   * mined ZEC, so this needs no separate source and cannot drift from `/shielded`; the NU6 lockbox
   * holds deferred subsidy no transaction can spend, so counting it as circulating would overstate
   * every figure derived from circulating supply (market cap is supply × price). It matches
   * `/v1/supply/circulating` (mined − lockbox).
   */
  async getChainFacts(): Promise<{
    height: number;
    bestBlockHash: string;
    lastBlockTimestamp: number;
    circulatingSupplyZat: number;
  }> {
    const info = await this.#blockchainInfo();
    // The tip's timestamp is not on getblockchaininfo, so the block itself is fetched (without
    // fees: only the timestamp is read).
    const tip = await this.#blockWithoutFees(String(info.blocks));
    // The tip the node just reported, answered as missing: a node mid-reorg or inconsistent. Never
    // a timestamp of 0: every relative age on a page is measured against this clock, so a
    // fabricated one would misdate every row.
    if (tip === undefined) throw new NodeRpcError("getblock", `tip ${info.blocks} not readable`);
    return {
      height: info.blocks,
      bestBlockHash: info.bestblockhash,
      lastBlockTimestamp: tip.timestamp,
      circulatingSupplyZat: info.valuePools.reduce(
        (sum, p) => (p.id === "lockbox" ? sum : sum + (p.chainValueZat ?? 0)),
        0,
      ),
    };
  }

  /**
   * Current shielded pool balances.
   *
   * Shielded pools only: `transparent` is not shielded and `lockbox` is a protocol reserve, so
   * either would overstate the headline. A pool the node reports as `monitored: false` (a pool
   * before activation) is omitted rather than shown as zero.
   */
  async getPools(): Promise<ShieldedPool[]> {
    const info = await this.#blockchainInfo();
    const wanted: readonly PoolName[] = POOL_NAMES;
    return info.valuePools
      .filter((p) => wanted.includes(p.id as PoolName))
      .filter((p) => p.monitored !== false && p.chainValueZat !== null)
      .map((p) => ({ pool: p.id as PoolName, balanceZat: p.chainValueZat! }));
  }

  /** Consensus subsidy at a height, straight from the node's schedule. */
  getBlockSubsidy(height: number): Promise<RpcBlockSubsidy> {
    return this.rpc.getBlockSubsidy(height);
  }

  /** The difficulty of one block, by hash, from `getblockheader` — one small call. */
  async getDifficultyByHash(hash: string): Promise<number> {
    return (await this.rpc.getBlockHeaderByHash(hash)).difficulty;
  }

  /** `getnetworksolps`, or null where the node does not implement it. */
  getNetworkSolps(): Promise<number | null> {
    return this.rpc.getNetworkSolps();
  }

  /**
   * Every value pool's balance: the whole supply, split by where it sits. Unlike `getPools` this
   * keeps `transparent` and `lockbox`, because an accounting without them does not add up to the
   * supply. `monitored: false` pools are still omitted: the node declines to state a figure, and a
   * zero would be our invention.
   */
  async getSupplyBreakdown(): Promise<SupplyBreakdown> {
    const info = await this.#blockchainInfo();
    return {
      height: info.blocks,
      pools: info.valuePools
        .filter((p) => p.monitored !== false && p.chainValueZat !== null)
        .map((p) => ({ pool: p.id as ValuePoolName, balanceZat: p.chainValueZat! })),
    };
  }

  /** Genesis. The node holds the whole chain, so nothing bounds this above 0. */
  getOldestHeight(): Promise<number> {
    return Promise.resolve(0);
  }

  // ------------------------------------------------------------------- blocks

  /**
   * One block, with its fee total: the detail path.
   *
   * The fee total is the only `Block` field a block response cannot answer on its own; it is read
   * from the index's stored total rather than by resolving every input against the node, so a block
   * detail costs one `getblock` and one primary-key read.
   */
  async getBlock(idOrHeight: string): Promise<Block | undefined> {
    const raw = await this.#rawBlock(idOrHeight);
    if (raw === undefined) return undefined;
    const { block } = parseBlock(raw);
    // No input resolution: the index answers the fee in one read.
    return { ...block, totalFeeZat: await this.#indexedFee(block.height) };
  }

  async #indexedFee(height: number): Promise<number | null> {
    if (!this.index.blockFees) return null;
    try {
      return (await this.index.blockFees([height])).get(height) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * A block without its fee total, for the list and for chain facts. Everything else on `Block`
   * (including the miner, the coinbase tag and the funding streams) comes from the block response,
   * so a list row costs one node call and no input resolution.
   */
  async #blockWithoutFees(idOrHeight: string, rpc = this.rpc): Promise<Block | undefined> {
    const raw = await this.#rawBlock(idOrHeight, rpc);
    return raw === undefined ? undefined : parseBlock(raw).block;
  }

  async getBlockTransactions(height: number): Promise<Transaction[]> {
    const raw = await this.#rawBlock(String(height));
    if (raw === undefined) return [];
    const parsed = parseBlock(raw);
    // The block already carries every transaction, so this needs no per-tx fetch — only
    // the inputs' source transactions, which resolveInputs batches.
    return this.#resolveMany(parsed.transactions);
  }

  /**
   * Blocks `top` down to `top - count + 1` (never below 0), newest first, one `getblock` each: the
   * node's half of the block list in `block-list.ts`. A height the node cannot answer is absent.
   */
  blocksDescending(top: number, count: number): Promise<Block[]> {
    return this.#blocksDescending(top, clampPageSize(count));
  }

  // ------------------------------------------------------------- transactions

  async getTransaction(txid: string): Promise<Transaction | undefined> {
    let raw: RpcTransactionDetail;
    try {
      raw = await this.rpc.getRawTransaction(txid);
    } catch (error) {
      // A node "no such transaction" and a malformed id both answer `-5`, which a route reads as
      // 404. Anything else is a failure to answer and propagates.
      if (nodeSaysNotFound(error)) return undefined;
      throw error;
    }
    const parsed = parseTransaction(
      raw,
      raw.height ?? 0,
      raw.blocktime ?? 0,
      raw.blockhash ?? null,
    );
    const [resolved] = await this.#resolveMany([parsed]);
    if (resolved === undefined) return undefined;
    // The single-transaction path is the one place rawHex is carried. A mempool transaction has no
    // height; the domain types that as null.
    const withHex = { ...resolved, rawHex: raw.hex ?? null };
    return raw.height === undefined ? { ...withHex, blockHeight: null } : withHex;
  }

  /** The raw hex and nothing else — see `V1ChainPort.getRawTransactionHex` for why this exists. */
  async getRawTransactionHex(txid: string): Promise<string | null | undefined> {
    try {
      const raw = await this.rpc.getRawTransaction(txid);
      return raw.hex ?? null;
    } catch (error) {
      if (nodeSaysNotFound(error)) return undefined;
      throw error;
    }
  }

  /**
   * The newest transactions, by walking blocks back from the tip: shallow pages cost a block or
   * two, deep pages a walk. The cursor is the height to resume from, so paging is stateless. The
   * index serves this when available.
   */
  async listLatestTransactions(count: number): Promise<Transaction[]> {
    const tip = await this.rpc.getTipHeight();
    return (await this.#walkTransactions(tip, clampPageSize(count))).items;
  }

  async listTransactions(
    query: CursorQuery,
    kind: TxKindFilter = "all",
  ): Promise<CursorPage<Transaction>> {
    const limit = clampPageSize(query.limit);
    const tip = await this.rpc.getTipHeight();
    const before = cursorKey(query.before);
    const after = before === null ? cursorKey(query.after) : null;

    // `after` walks up from the cursor height and `before` walks down from it; neither walks from
    // the tip.
    //
    // ORIGIN_CURSOR carries a sort key below every real height, so it lands at 0 and the ascent
    // starts at genesis: that is what makes "last page" reach the oldest transactions.
    const ascending = after !== null;
    const from = ascending ? Math.max(0, after + 1) : before !== null ? before - 1 : tip;

    const { items, nextHeight } = await this.#walkTransactions(
      from,
      limit,
      kind,
      ascending ? "up" : "down",
      tip,
    );

    // Cursors are stated in the page's terms, not the walk's: whichever way we walked, `nextCursor`
    // pages older and `prevCursor` newer.
    const oldest = items.length > 0 ? (items[items.length - 1]?.blockHeight ?? null) : null;
    const newest = items.length > 0 ? (items[0]?.blockHeight ?? null) : null;

    return {
      items,
      // A cursor exists whenever unwalked blocks remain, even on a short page: for a rare kind the
      // walk cap can fill less than a page while history remains, and a null cursor would wrongly
      // read as "no more such transactions exist".
      nextCursor: ascending
        ? oldest !== null && oldest > 0
          ? encodeCursor(oldest, String(oldest))
          : null
        : nextHeight === null
          ? null
          : encodeCursor(nextHeight, String(nextHeight)),
      prevCursor: ascending
        ? nextHeight === null
          ? null
          : encodeCursor(nextHeight - 1, String(nextHeight - 1))
        : newest !== null && newest < tip
          ? encodeCursor(newest, String(newest))
          : null,
    };
  }

  // ---------------------------------------------------------------- addresses

  /**
   * A transparent address, from the node's own address index. Both calls are native and cheap;
   * `getaddresstxids` is unpaginated, so a busy address returns a large array that the caller
   * pages.
   */
  async getAddress(address: string): Promise<AddressInfo | undefined> {
    try {
      const [balance, txids] = await Promise.all([
        this.rpc.getAddressBalance(address),
        this.#addressTxids(address),
      ]);
      if (txids.length === 0 && balance.received === 0) return undefined;
      return {
        kind: "transparent",
        address,
        balanceZat: balance.balance,
        totalReceivedZat: balance.received,
        // The node reports received; sent is the difference, needing no UTXO walk.
        totalSentZat: balance.received - balance.balance,
        // Newest first, capped: balances and counts stay exact; only the raw id list is bounded.
        txids: txids.slice(0, ADDRESS_TXIDS_CAP),
      };
    } catch (error) {
      // An unparseable address raises a parse error rather than an empty result, and that is the
      // only thing this catch may absorb. Anything else (for example the node timing out on the
      // unpaginated `getaddresstxids` of an address with millions of transactions) must propagate
      // so the route answers 503: a 503 is never a 404, and claiming such an address does not exist
      // would be false.
      if (!isMalformedAddressError(error)) throw error;
      return undefined;
    }
  }

  /**
   * A transparent address's balance, received and sent, without its transaction list.
   *
   * `/v1/addresses/{address}` reads only these figures (its transaction count comes from the
   * index), and the list is the expensive half of `getAddress`: for the busiest addresses (the
   * funding-stream addresses) `getaddresstxids` takes seconds and then fails as too large, while
   * `getaddressbalance` answers in milliseconds.
   *
   * A never-used address and one that received only zero-value outputs both report `received: 0`,
   * and only the second has a history, so that case alone falls back to the full lookup (whose list
   * for a never-used address is empty and cheap).
   */
  async getAddressBalance(address: string): Promise<Omit<TransparentAddress, "txids"> | undefined> {
    let balance: { balance: number; received: number };
    try {
      balance = await this.rpc.getAddressBalance(address);
    } catch (error) {
      if (isMalformedAddressError(error)) return undefined;
      throw error;
    }
    if (balance.received === 0) {
      const full = await this.getAddress(address);
      if (full === undefined || full.kind !== "transparent") return undefined;
    }
    return {
      kind: "transparent",
      address,
      balanceZat: balance.balance,
      totalReceivedZat: balance.received,
      totalSentZat: balance.received - balance.balance,
    };
  }

  /*
   * Address history is served by `ChainIndexStore.listTransactions` over the chain index; the route answers
   * 503 without it rather than walking the node.
   */

  /** The full newest-first txid list, cached briefly so paging costs one node call. */
  async #addressTxids(address: string): Promise<string[]> {
    const cached = this.#addrCache.get(address);
    if (cached && Date.now() - cached.at < ADDRESS_CACHE_MS) return cached.txids;
    const failedAt = this.#addrFailedAt.get(address);
    if (failedAt !== undefined && Date.now() - failedAt < ADDRESS_FAILURE_MEMORY_MS) {
      throw new Error("address history unavailable (recent node failure)");
    }
    const inFlight = this.#addrInFlight.get(address);
    if (inFlight) return inFlight;
    const lookup = this.#fetchAddressTxids(address).finally(() => {
      this.#addrInFlight.delete(address);
    });
    this.#addrInFlight.set(address, lookup);
    return lookup;
  }

  async #fetchAddressTxids(address: string): Promise<string[]> {
    let all: readonly string[];
    try {
      all = await this.rpc.getAddressTxids(address);
    } catch (error) {
      if (!isMalformedAddressError(error)) {
        boundedSet(this.#addrFailedAt, address, Date.now());
      }
      throw error;
    }
    // Newest first, and only what a page can show: the full list of a busy address is millions
    // of ids and must not be held in memory.
    const txids: string[] = [];
    for (let i = all.length - 1; i >= 0 && txids.length < ADDRESS_TXIDS_CAP; i -= 1) {
      txids.push(all[i]!);
    }
    boundedSet(this.#addrCache, address, { at: Date.now(), txids });
    return txids;
  }

  // ------------------------------------------------------------------ mempool

  async listMempool(page: number, pageSize: number): Promise<Paginated<MempoolEntry>> {
    // One verbose call carries every per-entry fact (arrival time, fee, size, parents), so the join
    // below adds no RPC round beyond the page's own transaction fetches.
    const verbose = await this.rpc.getRawMempoolVerbose();
    const entries = Object.entries(verbose)
      // Newest seen first. The mempool has no canonical order; the node's arrival clock is the one
      // deterministic, meaningful sort available.
      .sort(([aId, a], [bId, b]) => (b.time ?? 0) - (a.time ?? 0) || bId.localeCompare(aId));
    const size = clampPageSize(pageSize);
    const start = Math.max(0, (page - 1) * size);
    const slice = entries.slice(start, start + size);
    const txs = await Promise.all(slice.map(([txid]) => this.getTransaction(txid)));

    const items: MempoolEntry[] = [];
    for (const [index, [, entry]] of slice.entries()) {
      const tx = txs[index];
      // Mined or evicted between the two calls: a shorter page beats a phantom row.
      if (tx === undefined) continue;
      items.push({
        // The entry's arrival time is the honest timestamp for a transaction with no block time
        // yet.
        transaction: entry.time !== undefined ? { ...tx, timestamp: entry.time } : tx,
        seenAt: entry.time ?? tx.timestamp,
        // The node reports fee and size on every live entry; the resolved transaction is the
        // fallback, and 0 only when neither side knows.
        feeRateZatPerByte:
          entryFeeRateZatPerByte(entry) ??
          (tx.feeZat !== null && tx.sizeBytes > 0 ? tx.feeZat / tx.sizeBytes : 0),
        dependsOn: entry.depends ?? [],
      });
    }
    return { items, totalPages: Math.ceil(entries.length / size) };
  }

  /**
   * Mempool statistics from one verbose call, plus a privacy composition classified from a capped
   * sample of transactions.
   *
   * The cap keeps a busy mempool from turning one request into hundreds of fetches;
   * `composition.sampled` travels with the counts so the UI can say "of N sampled". Classification
   * uses the parse-level structure (no input resolution), and a transaction that vanishes
   * mid-sample is skipped, shrinking the sample rather than distorting it. An empty mempool reports
   * a null median fee and a null composition: unknown is not zero.
   */
  async getMempoolStats(): Promise<MempoolStats> {
    const verbose = await this.rpc.getRawMempoolVerbose();
    const sampleIds = Object.entries(verbose)
      // Same order as the list: the sample is the most recently seen slice, deterministic for a
      // given mempool.
      .sort(([aId, a], [bId, b]) => (b.time ?? 0) - (a.time ?? 0) || bId.localeCompare(aId))
      .slice(0, MEMPOOL_SAMPLE_CAP)
      .map(([txid]) => txid);

    const kinds: TxKind[] = [];
    for (let i = 0; i < sampleIds.length; i += MEMPOOL_SAMPLE_CONCURRENCY) {
      const batch = await Promise.all(
        sampleIds.slice(i, i + MEMPOOL_SAMPLE_CONCURRENCY).map(async (txid) => {
          try {
            const raw = await this.rpc.getRawTransaction(txid);
            return classifyTxKind(parseTransaction(raw, 0, 0));
          } catch {
            return null;
          }
        }),
      );
      for (const kind of batch) if (kind !== null) kinds.push(kind);
    }

    return {
      ...summariseMempool(verbose),
      composition: kinds.length > 0 ? countKinds(kinds) : null,
    };
  }

  // ---------------------------------------------------------------- internals

  async #rawBlock(idOrHeight: string, rpc = this.rpc) {
    // Only a height or a 64-hex hash reaches the node, classified by the domain's single definition
    // of each. `getblock` reads a negative number as a height counted back from the tip (`-5` is
    // five blocks below it), so passing anything else through would answer for a block the request
    // never named.
    const id = classifySearchQuery(idOrHeight);
    try {
      if (id.type === "height") return await rpc.getBlock(id.height);
      if (id.type === "hash64") return await rpc.getBlockByHash(id.hash);
      return undefined;
    } catch (error) {
      if (nodeSaysNotFound(error)) return undefined;
      throw error;
    }
  }

  async #blocksDescending(top: number, limit: number): Promise<Block[]> {
    if (top < 0) return [];
    const heights: number[] = [];
    for (let h = top; h > top - limit && h >= 0; h -= 1) heights.push(h);
    // Refused whole and at once when the node queue cannot take the page, never queued to time out
    // call by call, which would make every other public node read wait behind doomed pages. Only
    // the public source's page client bounds its queue (`maxQueued`). A full page or a 503, never a
    // short page.
    if (!this.#pageRpc.admits(heights.length)) {
      throw new NodeRpcError(
        "getblock",
        `node busy: no room to queue ${heights.length} block reads`,
      );
    }
    // Concurrent: independent loopback calls, so latency is one round trip, not `limit` of them.
    const blocks = await Promise.all(
      heights.map((h) => this.#blockWithoutFees(String(h), this.#pageRpc)),
    );
    return blocks.filter((b): b is Block => b !== undefined);
  }

  /**
   * Walks blocks downward collecting transactions until `limit` is reached, optionally keeping only
   * those matching `keep`.
   *
   * The walk is capped: a filter for a rare kind would otherwise make one page an unbounded chain
   * scan. Hitting the cap returns a short page with a cursor, so the UI keeps paging. The index is
   * what makes filtered pages exact.
   */
  async #walkTransactions(
    from: number,
    limit: number,
    kind: TxKindFilter = "all",
    /**
     * `down` walks toward genesis (older); `up` walks toward the tip (newer). `tipHeight` bounds
     * the ascent the way 0 bounds the descent.
     */
    dir: "down" | "up" = "down",
    tipHeight = Number.POSITIVE_INFINITY,
  ): Promise<{ items: Transaction[]; nextHeight: number | null }> {
    const maxBlocks = kind === "all" ? 3 * limit : WALK_CAP_BLOCKS;
    const items: Transaction[] = [];
    const step = dir === "up" ? 1 : -1;
    const inRange = (h: number) => (dir === "up" ? h <= tipHeight : h >= 0);
    let height = from;
    let walked = 0;
    while (items.length < limit && inRange(height) && walked < maxBlocks) {
      const raw = await this.#rawBlock(String(height));
      if (raw !== undefined) {
        // Classified before input resolution, from the parse-level input references: classifying
        // the resolved form would let a failed prev-tx fetch flip a mixed transaction to
        // "shielded", and filtering first means a filtered walk resolves inputs only for
        // transactions it keeps.
        const parsed = parseBlock(raw).transactions.filter((t) =>
          parsedMatchesTxKindFilter(t, kind),
        );
        items.push(...(await this.#resolveMany(parsed)));
      }
      height += step;
      walked += 1;
    }
    // The walk collected oldest-first when ascending, and the caller wants newest-first like every
    // other page; reversing here keeps the ordering contract in one place.
    const ordered = dir === "up" ? items.reverse() : items;
    return {
      // Ascending, keep the newest `limit` (adjacent to where the reader was); descending, keep the
      // first `limit`, for the same reason.
      items: dir === "up" ? ordered.slice(0, limit) : ordered.slice(0, limit),
      // Resume one past the last block consumed, not mid-block: a height cursor cannot address "the
      // 4th transaction of block N", so a page may return slightly more than asked rather than
      // split a block.
      nextHeight: inRange(height) ? height : null,
    };
  }

  /**
   * Resolve every input's source output and derive fees, exactly.
   *
   * `getblock` gives an input only as `(txid, vout)`, with no address and no value, so resolving
   * means reading the referenced output from its own transaction. The distinct set of sources is
   * fetched once, in bounded batches.
   *
   * - The batch resolves against a local map that cannot be evicted; `#txCache` is populated for
   *   cross-call reuse but never decides whether an input appears.
   * - Fetches are bounded by `RESOLVE_CONCURRENCY`, so one request cannot fire thousands of
   *   concurrent calls at the node.
   * - An unresolvable input throws, and the route answers 503: a transient failure must reject,
   *   never return a transaction whose inputs are quietly incomplete.
   *
   * The index path (`ChainIndexStore.getTransaction`) is preferred wherever available, since
   * Postgres holds every input resolved. This remains the mempool path and the no-database
   * fallback.
   */
  async #resolveMany(parsed: ParsedTransaction[]): Promise<Transaction[]> {
    const needed = new Set<string>();
    for (const tx of parsed) {
      // Each source is one node call held in memory until the answer is built. A transaction
      // needing more than the cap is refused (the route answers unavailable) rather than
      // resolved: a wide transaction is cheap to broadcast, and serving part of its inputs would
      // look complete. Once mined, the index serves it whole.
      const sources = new Set(tx.inputRefs.map((ref) => ref.prevTxid));
      if (sources.size > MAX_NODE_INPUT_SOURCES) {
        throw new Error(
          `transaction ${tx.txid} needs ${sources.size} source transactions resolved on the node; the cap is ${MAX_NODE_INPUT_SOURCES}`,
        );
      }
      for (const txid of sources) needed.add(txid);
    }

    // Local to this call: `#txCache` is a cross-call optimisation and must never decide whether an
    // input appears. Seeded from it, then filled with whatever is missing.
    const sources = new Map<string, RpcTransaction>();
    const missing: string[] = [];
    for (const txid of needed) {
      const cached = this.#txCache.get(txid);
      if (cached === undefined) missing.push(txid);
      else sources.set(txid, cached);
    }

    for (let i = 0; i < missing.length; i += RESOLVE_CONCURRENCY) {
      const batch = missing.slice(i, i + RESOLVE_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (txid) => [txid, await this.rpc.getRawTransaction(txid)] as const),
      );
      for (const [txid, raw] of fetched) {
        sources.set(txid, raw);
        if (this.#txCache.size >= this.#maxCache) {
          const oldest = this.#txCache.keys().next().value;
          if (oldest !== undefined) this.#txCache.delete(oldest);
        }
        this.#txCache.set(txid, raw);
      }
    }

    return parsed.map((tx) => {
      let transparentInZat: number | null = 0;
      const transparentInputs = tx.inputRefs.map((ref) => {
        const source = sources.get(ref.prevTxid);
        const out = source?.vout.find((o) => o.n === ref.prevVout);
        if (out === undefined) {
          // Unreachable unless the node contradicts itself (a spent output's transaction always
          // exists). Throwing rather than dropping keeps a partial transaction from being returned
          // as complete.
          throw new Error(
            `input ${ref.prevTxid}:${ref.prevVout} of ${tx.txid} could not be resolved`,
          );
        }
        if (transparentInZat !== null) transparentInZat += out.valueZat;
        const addresses = out.scriptPubKey.addresses ?? [];
        const address = addresses.length === 1 ? addresses[0]! : (out.scriptPubKey.address ?? null);
        // `""` for a script naming no address is the domain's convention, matching the index path,
        // so the two paths agree on a transaction's input count.
        return { address: address ?? "", valueZat: out.valueZat };
      });

      return {
        txid: tx.txid,
        blockHeight: tx.blockHeight,
        blockHash: tx.blockHash,
        timestamp: tx.timestamp,
        isCoinbase: tx.isCoinbase,
        version: tx.version,
        sizeBytes: tx.sizeBytes,
        lockTime: tx.lockTime,
        expiryHeight: tx.expiryHeight,
        // Never on a many-transaction path — see the domain note on Transaction.rawHex.
        rawHex: null,
        feeZat: computeFeeZat(tx, transparentInZat),
        bindingSigValid: null,
        transparentInputs,
        transparentOutputs: tx.outputs.flatMap((o) =>
          o.address === null ? [] : [{ address: o.address, valueZat: o.valueZat }],
        ),
        sprout: tx.sprout,
        sapling: tx.sapling,
        orchard: tx.orchard,
        ironwood: tx.ironwood,
      };
    });
  }
}
