import { describe, expect, it } from "vitest";
import { parseAddrV2 } from "../p2p/codec";
import { isRoutableHost } from "../p2p/crawl";

/** One addrv2 entry: time, services (compact size 0), network id, length, address, port. */
function addrV2(networkId: number, addr: number[], port = 8233): Buffer {
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  return Buffer.concat([
    Buffer.from([1]), // count
    Buffer.alloc(4), // timestamp
    Buffer.from([0]), // services
    Buffer.from([networkId, addr.length]),
    Buffer.from(addr),
    portBytes,
  ]);
}

describe("gossiped addresses that must never be dialled", () => {
  it("treats an IPv4-mapped IPv6 address as the IPv4 address it is", () => {
    // ::ffff:10.0.0.5 — a private IPv4 address carried in an IPv6 slot.
    const mapped = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 10, 0, 0, 5];
    const { entries } = parseAddrV2(addrV2(2, mapped));
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(isRoutableHost(e.host, e.network)).toBe(false);
  });

  it("refuses special-purpose IPv6 ranges", () => {
    for (const host of [
      "::",
      "::1",
      "::a00:5", // IPv4-compatible
      "::ffff:10.0.0.5",
      "64:ff9b::a00:5", // NAT64
      "2002:a00:5::1", // 6to4
      "2001:0:4136:e378::1", // Teredo
      "2001:db8::1", // documentation
      "ff02::1", // multicast
      "fd00::1",
      "fe80::1",
      "100::1", // discard
    ]) {
      expect(isRoutableHost(host, "ipv6")).toBe(false);
    }
  });

  it("refuses IPv4 documentation and test ranges", () => {
    for (const host of ["192.0.2.1", "198.51.100.7", "203.0.113.9", "192.0.0.1", "192.88.99.1"]) {
      expect(isRoutableHost(host, "ipv4")).toBe(false);
    }
  });

  it("still accepts ordinary public addresses", () => {
    expect(isRoutableHost("8.8.8.8", "ipv4")).toBe(true);
    expect(isRoutableHost("2a01:4f8::1", "ipv6")).toBe(true);
  });
});
