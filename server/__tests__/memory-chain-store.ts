import type { ParsedBlock } from "@/data/chain/parse";
import type { ChainStorePort, ChainSyncState, ReorgEventRecord } from "../chain-store";

/**
 * In-memory `ChainStorePort`, for the follower's tests.
 *
 * Stores only what the follower's own logic depends on (hashes by height and the sync state). It
 * does not reimplement input resolution or fee derivation, which would let the follower's tests
 * pass against semantics the Postgres adapter does not share.
 */
export class MemoryChainStore implements ChainStorePort {
  readonly #hashes = new Map<number, string>();
  #state: ChainSyncState | null = null;
  /** Every block handed to `ingestBlock`, in call order — for assertions. */
  readonly ingested: ParsedBlock[] = [];
  /** Every reorg event handed to `rollbackAbove`, in call order — for assertions. */
  readonly reorgs: ReorgEventRecord[] = [];

  getSyncState(): Promise<ChainSyncState | null> {
    return Promise.resolve(this.#state);
  }

  hashAt(height: number): Promise<string | null> {
    return Promise.resolve(this.#hashes.get(height) ?? null);
  }

  rollbackAbove(height: number, event?: ReorgEventRecord): Promise<void> {
    if (event !== undefined) this.reorgs.push(event);
    for (const stored of [...this.#hashes.keys()]) {
      if (stored > height) this.#hashes.delete(stored);
    }
    const hash = this.#hashes.get(height);
    this.#state = hash === undefined ? null : { tipHeight: height, tipHash: hash };
    return Promise.resolve();
  }

  ingestBlock(parsed: ParsedBlock): Promise<void> {
    this.ingested.push(parsed);
    this.#hashes.set(parsed.block.height, parsed.block.hash);
    this.#state = { tipHeight: parsed.block.height, tipHash: parsed.block.hash };
    return Promise.resolve();
  }
}
