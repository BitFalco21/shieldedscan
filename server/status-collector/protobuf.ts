/**
 * Just enough protobuf to read two lightwalletd messages (service.proto): `LightdInfo` and
 * `BlockID`. Unknown fields are skipped, so a server adding fields still parses.
 */

type Field = { n: number; varint?: bigint; bytes?: Buffer };

function readVarint(buf: Buffer, at: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  for (let i = at; i < buf.length; i++) {
    const b = buf[i]!;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [value, i + 1];
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new Error("truncated varint");
}

/** Every top-level field, in order. Wire types 0 (varint), 2 (bytes), 1 and 5 (fixed, skipped). */
export function fields(buf: Buffer): Field[] {
  const out: Field[] = [];
  let at = 0;
  while (at < buf.length) {
    const [key, next] = readVarint(buf, at);
    at = next;
    const n = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [v, after] = readVarint(buf, at);
      out.push({ n, varint: v });
      at = after;
    } else if (wire === 2) {
      const [len, after] = readVarint(buf, at);
      const end = after + Number(len);
      if (end > buf.length) throw new Error("truncated field");
      out.push({ n, bytes: buf.subarray(after, end) });
      at = end;
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw new Error(`wire type ${wire}`);
  }
  return out;
}

export interface LightdInfo {
  version: string | null;
  vendor: string | null;
  chainName: string | null;
  consensusBranchId: string | null;
  blockHeight: number | null;
  estimatedHeight: number | null;
  zcashdBuild: string | null;
  zcashdSubversion: string | null;
}

const str = (fs: Field[], n: number) => fs.find((f) => f.n === n)?.bytes?.toString("utf8") ?? null;
const num = (fs: Field[], n: number) => {
  const v = fs.find((f) => f.n === n)?.varint;
  return v === undefined ? null : Number(v);
};

/** `LightdInfo`: field numbers from lightwalletd's service.proto. */
export function parseLightdInfo(buf: Buffer): LightdInfo {
  const fs = fields(buf);
  return {
    version: str(fs, 1),
    vendor: str(fs, 2),
    chainName: str(fs, 4),
    consensusBranchId: str(fs, 6),
    blockHeight: num(fs, 7),
    estimatedHeight: num(fs, 12),
    zcashdBuild: str(fs, 13),
    zcashdSubversion: str(fs, 14),
  };
}

/** `BlockID`: height, and the hash as displayed (the wire order is reversed). */
export function parseBlockId(buf: Buffer): { height: number | null; hash: string | null } {
  const fs = fields(buf);
  const raw = fs.find((f) => f.n === 2)?.bytes;
  return {
    height: num(fs, 1),
    hash: raw ? Buffer.from(raw).reverse().toString("hex") : null,
  };
}
