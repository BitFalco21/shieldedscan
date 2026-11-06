import type {
  AddressInfo,
  Block,
  MempoolEntry,
  MempoolStats,
  PoolName,
  ShieldedPool,
  SupplyBreakdown,
  Transaction,
  TxKindFilter,
  UpgradeNetwork,
  ValuePoolName,
} from "@/domain";
import { unspendablePools } from "@/domain/consensus";
import { POOL_NAMES, VALUE_POOL_NAMES } from "@/domain/pool";
import type { CursorPage, CursorQuery, Paginated } from "@/data/source";
import type { ChainIndexStore } from "./chain-index-store";
import { NodeRpcError, type RpcBlockSubsidy } from "./node-rpc";
import { clampPageSize } from "./page-size";

/**
 * The chain source of an API with a database and no node: a self-hosted copy of the open dataset.
 *
 * Every figure here is one the node reported when the block was stored, read back from the index
 * at the newest stored block, so the site and `/v1` state the chain as of that block, as they
 * would with a node that stopped there. What only a node can say (block headers, an address's
 * balance and history from the node, the mempool, the subsidy schedule) rejects with
 * `NoNodeError`: an outage, never "not found", because the index cannot prove that something it
 * does not hold does not exist.
 */

/** The answer for a read that needs a node, on an API that has none. */
export class NoNodeError extends NodeRpcError {
  constructor(method: string) {
    super(method, "no node is configured");
    this.name = "NoNodeError";
  }
}

/** What the source reads from the index. `ChainIndexStore` in production. */
export type IndexChainReader = Pick<
  ChainIndexStore,
  "tipHeight" | "blockAt" | "listChainTransactions"
>;

/**
 * The pools the node stated at a block, in one fixed order. NULL is a pool the node did not monitor
 * there (before its activation): omitted, never zero.
 */
function stated(
  pools: Readonly<Record<ValuePoolName, number | null>>,
): { pool: ValuePoolName; balanceZat: number }[] {
  return VALUE_POOL_NAMES.flatMap((pool) => {
    const zat = pools[pool];
    return zat === null ? [] : [{ pool, balanceZat: zat }];
  });
}

export class IndexChainSource {
  constructor(
    private readonly index: IndexChainReader,
    /** Which pools count as circulating depends on the network, as in `NodeChainSource`. */
    private readonly network: UpgradeNetwork = "mainnet",
  ) {}

  /** The newest stored block's pools; an empty index is an outage, not a chain at height 0. */
  async #tipBlock() {
    const height = await this.index.tipHeight();
    const block = height === null ? undefined : await this.index.blockAt(height);
    if (block === undefined) throw new NoNodeError("getblockchaininfo");
    return block.pools;
  }

  async getTipHeight(): Promise<number> {
    return (await this.#tipBlock()).height;
  }

  async getTip(): Promise<{ height: number; hash: string }> {
    const tip = await this.#tipBlock();
    return { height: tip.height, hash: tip.hash };
  }

  /** As `NodeChainSource.getChainFacts`: circulating excludes the pools nothing can spend from. */
  async getChainFacts(): Promise<{
    height: number;
    bestBlockHash: string;
    lastBlockTimestamp: number;
    circulatingSupplyZat: number;
  }> {
    const tip = await this.#tipBlock();
    const unspendable = unspendablePools(this.network, tip.height);
    let circulating = 0;
    for (const { pool, balanceZat } of stated(tip.pools)) {
      if (!unspendable.includes(pool)) circulating += balanceZat;
    }
    return {
      height: tip.height,
      bestBlockHash: tip.hash,
      lastBlockTimestamp: tip.timestamp,
      circulatingSupplyZat: circulating,
    };
  }

  async getPools(): Promise<ShieldedPool[]> {
    const tip = await this.#tipBlock();
    const shielded: readonly ValuePoolName[] = POOL_NAMES;
    return stated(tip.pools).flatMap(({ pool, balanceZat }) =>
      shielded.includes(pool) ? [{ pool: pool as PoolName, balanceZat }] : [],
    );
  }

  /** `nsmZat` is not stored by the follower, so it is unknown here. */
  async getSupplyBreakdown(): Promise<SupplyBreakdown> {
    const tip = await this.#tipBlock();
    return { height: tip.height, pools: stated(tip.pools), nsmZat: null };
  }

  /** The dataset starts at genesis. */
  getOldestHeight(): Promise<number> {
    return Promise.resolve(0);
  }

  async listLatestTransactions(count: number): Promise<Transaction[]> {
    return (await this.index.listChainTransactions("all", { limit: clampPageSize(count) })).items;
  }

  listTransactions(
    query: CursorQuery,
    kind: TxKindFilter = "all",
  ): Promise<CursorPage<Transaction>> {
    return this.index.listChainTransactions(kind, query);
  }

  // Header fields, coinbase details and raw bytes are not in the index.
  getBlock(_idOrHeight: string): Promise<Block | undefined> {
    return Promise.reject(new NoNodeError("getblock"));
  }

  blocksDescending(_top: number, _count: number): Promise<Block[]> {
    return Promise.reject(new NoNodeError("getblock"));
  }

  getBlockTransactions(_height: number): Promise<Transaction[]> {
    return Promise.reject(new NoNodeError("getblock"));
  }

  /** Callers ask the index first; reaching here means the index does not hold it. */
  getTransaction(_txid: string): Promise<Transaction | undefined> {
    return Promise.reject(new NoNodeError("getrawtransaction"));
  }

  getAddress(_address: string): Promise<AddressInfo | undefined> {
    return Promise.reject(new NoNodeError("getaddressbalance"));
  }

  getMempoolStats(): Promise<MempoolStats> {
    return Promise.reject(new NoNodeError("getrawmempool"));
  }

  listMempool(_page: number, _pageSize: number): Promise<Paginated<MempoolEntry>> {
    return Promise.reject(new NoNodeError("getrawmempool"));
  }

  getBlockSubsidy(_height: number): Promise<RpcBlockSubsidy> {
    return Promise.reject(new NoNodeError("getblocksubsidy"));
  }
}
