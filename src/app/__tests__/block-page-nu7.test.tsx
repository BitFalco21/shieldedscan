import { beforeEach, describe, expect, it, vi } from "vitest";
import { NU7_HEIGHT } from "@/domain";
import { BlockDetailPage } from "@/features/blocks/BlockDetailPage";
import { Nu7CountdownPage } from "@/features/blocks/nu7/Nu7CountdownPage";

/**
 * `/block/[id]` answers the NU7 activation height with a countdown while that block does not
 * exist, on mainnet only, and every other missing block with a 404.
 */

const net = vi.hoisted(() => ({ testnet: false }));
vi.mock("@/lib/network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network")>();
  return {
    ...actual,
    get isTestnet() {
      return net.testnet;
    },
  };
});

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const data = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getChainInfo: vi.fn(),
  listBlocks: vi.fn(),
  getBlockTransactions: vi.fn(),
  getOldestHeight: vi.fn(),
}));
vi.mock("@/data", () => ({ getDataSource: () => data }));

const { default: Page, generateMetadata } = await import("../block/[id]/page");

const props = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  net.testnet = false;
  data.getBlock.mockReset().mockResolvedValue(undefined);
  data.getChainInfo.mockReset().mockResolvedValue({ height: 100, lastBlockTimestamp: 5 });
  data.listBlocks.mockReset().mockResolvedValue({ items: [], nextCursor: null, prevCursor: null });
});

describe("/block/[id] when the block does not exist", () => {
  it("renders the NU7 countdown at the activation height", async () => {
    const element = await Page(props(String(NU7_HEIGHT)));
    expect(element.type).toBe(Nu7CountdownPage);
    expect(element.props).toMatchObject({ tipHeight: 100, tipTimestamp: 5, recent: [] });
    expect(await generateMetadata(props(String(NU7_HEIGHT)))).toEqual({
      title: "NU7 countdown",
    });
  });

  it.each([String(NU7_HEIGHT + 1), `0${NU7_HEIGHT}`, "f".repeat(64)])(
    "is a 404 for any other id (%s)",
    async (id) => {
      await expect(Page(props(id))).rejects.toBe(NOT_FOUND);
      expect(await generateMetadata(props(id))).toEqual({ title: `Block ${id}` });
    },
  );

  it("is a 404 on testnet, where NU7 is already active", async () => {
    net.testnet = true;
    await expect(Page(props(String(NU7_HEIGHT)))).rejects.toBe(NOT_FOUND);
    expect(await generateMetadata(props(String(NU7_HEIGHT)))).toEqual({
      title: `Block ${NU7_HEIGHT}`,
    });
  });

  it("renders the real block once it exists, with the blocks after it", async () => {
    const block = { height: NU7_HEIGHT };
    const after = [{ height: NU7_HEIGHT + 1 }, { height: NU7_HEIGHT }];
    data.getBlock.mockResolvedValue(block);
    data.getBlockTransactions.mockResolvedValue([]);
    data.getOldestHeight.mockResolvedValue(0);
    data.listBlocks.mockResolvedValue({ items: after, nextCursor: null, prevCursor: null });
    const element = await Page(props(String(NU7_HEIGHT)));
    expect(element.type).toBe(BlockDetailPage);
    expect(element.props.nu7Blocks).toBe(after);
    // One keyset page ending at the eighth block after the activation.
    const query = data.listBlocks.mock.calls[0]![0];
    expect(query.limit).toBe(9);
    expect(Buffer.from(query.before, "base64url").toString()).toBe(`${NU7_HEIGHT + 9}|0`);
    expect(await generateMetadata(props(String(NU7_HEIGHT)))).toEqual({
      title: `Block ${NU7_HEIGHT}`,
    });
  });

  it("reads no extra blocks for any other block", async () => {
    data.getBlock.mockResolvedValue({ height: NU7_HEIGHT - 1 });
    data.getBlockTransactions.mockResolvedValue([]);
    data.getOldestHeight.mockResolvedValue(0);
    const element = await Page(props(String(NU7_HEIGHT - 1)));
    expect(element.props.nu7Blocks).toBeNull();
    expect(data.listBlocks).not.toHaveBeenCalled();
  });
});
