import { describe, expect, it, vi } from "vitest";
import { ShieldedAddressPage } from "@/features/address/ShieldedAddressPage";
import Page from "../address/[addr]/page";

/**
 * A shielded address is never looked up — there is nothing to look up by design. The page
 * consults `classifyZcashAddress` first, so a shielded address renders its explanatory page
 * whatever the API would answer.
 */

const getAddress = vi.fn(async () => {
  throw new Error("a shielded address must not reach the data source");
});

vi.mock("@/data", () => ({
  getDataSource: () => ({ getAddress }),
}));

const props = (addr: string) => ({
  params: Promise.resolve({ addr }),
  searchParams: Promise.resolve({}),
});

describe("/address/[addr] with a shielded address", () => {
  it.each([
    [
      "unified",
      "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n",
    ],
    ["sapling", "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly"],
  ])("renders the explanatory page without any data-source call (%s)", async (kind, addr) => {
    getAddress.mockClear();
    const element = await Page(props(addr));
    expect(element.type).toBe(ShieldedAddressPage);
    expect(element.props).toMatchObject({ address: addr, kind });
    expect(getAddress).not.toHaveBeenCalled();
  });
});
