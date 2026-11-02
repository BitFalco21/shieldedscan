import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base58checkEncode } from "@/domain/encoding/base58check";
import { PostgresChainStore } from "../../postgres-chain-store";
import {
  MAX_REWIND,
  readAddresses,
  rewind,
  sortAndValidate,
  type AddressesOutcome,
  type Balances,
  type Delta,
} from "../addresses";
import { Findings } from "../checks";
import { exportTypes } from "../read";
import { ADDRESS_COLUMNS } from "../tables";

/** A mainnet t-address: P2PKH (1cb8) or P2SH (1cbd), with a payload made from `seed`. */
const tAddress = (seed: number, p2sh = false) =>
  base58checkEncode(
    Uint8Array.from([0x1c, p2sh ? 0xbd : 0xb8, ...new Array<number>(20).fill(seed)]),
  );

const run = (fn: (f: Findings) => void) => {
  const f = new Findings();
  fn(f);
  return f.list();
};

describe("rewinding the rich list to the release height", () => {
  const at: Balances = {
    address: ["a", "b", "c", "d"],
    balance: [100n, 50n, 30n, 5n],
    txCount: [3n, null, 2n, 1n],
  };

  it("subtracts what moved after N, restores emptied addresses, and drops zero balances", () => {
    const deltas = new Map<string, Delta>([
      ["a", { zat: 40n, txs: 1n }],
      ["b", { zat: -10n, txs: 1n }],
      ["d", { zat: 5n, txs: 1n }],
      ["e", { zat: -7n, txs: 2n }],
    ]);
    let out: Balances | undefined;
    expect(run((f) => (out = rewind(at, deltas, f)))).toEqual([]);
    expect(out).toEqual({
      address: ["a", "b", "c", "e"],
      balance: [60n, 60n, 30n, 7n],
      // b's count stays unknown; e was dropped from the rich list after N, its count with it.
      txCount: [2n, null, 2n, null],
    });
  });

  it("fails on a balance below zero, or a balance with no transaction", () => {
    const deltas = new Map<string, Delta>([
      ["a", { zat: 101n, txs: 1n }],
      ["c", { zat: 10n, txs: 2n }],
      ["f", { zat: 3n, txs: 1n }],
    ]);
    expect(run((f) => rewind(at, deltas, f))).toEqual([
      "address balance below zero at the release height: 2 (e.g. -1 zat; -3 zat)",
      "address balance with no transaction: 1 (e.g. 0 txs)",
    ]);
  });

  it("sorts by code point and fails on an invalid or repeated address", () => {
    const [lower, upper] = [tAddress(200), tAddress(1)].sort();
    let out: Balances | undefined;
    const ok = {
      address: [lower!, upper!],
      balance: [1n, 2n],
      txCount: [null, 1n],
    };
    expect(run((f) => (out = sortAndValidate(ok, f)))).toEqual([]);
    expect(out!.address).toEqual([upper, lower].sort((a, b) => (a! < b! ? -1 : 1)));
    expect(out!.balance[out!.address.indexOf(upper!)]).toBe(2n);

    const testnet = base58checkEncode(
      Uint8Array.from([0x1d, 0x25, ...new Array<number>(20).fill(1)]),
    );
    const typo = `${upper!.slice(0, -1)}${upper!.endsWith("a") ? "b" : "a"}`;
    const failures = run((f) =>
      sortAndValidate(
        {
          address: [upper!, upper!, testnet, typo],
          balance: [1n, 1n, 1n, 1n],
          txCount: [1n, 1n, 1n, 1n],
        },
        f,
      ),
    );
    expect(failures).toHaveLength(2);
    expect(failures).toContain(
      "address is not a mainnet t-address: 2 (e.g. 35 characters; 35 characters)",
    );
    expect(failures.join("\n")).toMatch(/^address listed twice: 1 \(e\.g\. row \d\)$/m);
  });
});

/**
 * Against a real PostgreSQL, through `opendata_reader`: a small chain whose rich list is built
 * by the follower's own `bootstrapRichList`, then read and rewound. Skips without
 * TEST_DATABASE_URL, like the other DB suites.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB = `opendata_addr_test_${process.pid}`;
const READER_PASSWORD = "opendata-test-only";
const ROOT = join(__dirname, "../../..");

const TIP = 140;
const N = 40;
const hex = (n: number) => n.toString(16).padStart(64, "0");

const A = tAddress(1);
const B = tAddress(2, true);
const C = tAddress(3);
const D = tAddress(4);
const E = tAddress(5);

interface Io {
  address: string | null;
  value: bigint;
  prev?: [string, number];
}
interface Tx {
  height: number;
  txid: string;
  ins: Io[];
  outs: Io[];
}

/**
 * Each block's coinbase pays A 1,000 zat, and every tenth also pays 7 zat to a bare key (no
 * address). Then: A pays B and D at 10, A pays C at 20; after N, D spends everything to E (D
 * leaves the rich list), B pays itself and A, and the bare key's 7 zat goes to A.
 */
function chain(): Tx[] {
  const txs: Tx[] = [];
  const cb = (h: number) => hex(1_000_000 + h);
  for (let h = 0; h <= TIP; h++) {
    const outs: Io[] = [{ address: A, value: 1000n }];
    if (h % 10 === 0) outs.push({ address: null, value: 7n });
    txs.push({ height: h, txid: cb(h), ins: [], outs });
  }
  const pay = (height: number, n: number, ins: Io[], outs: Io[]) =>
    txs.push({ height, txid: hex(2_000_000 + n), ins, outs });
  pay(
    10,
    1,
    [{ address: A, value: 1000n, prev: [cb(9), 0] }],
    [
      { address: B, value: 600n },
      { address: D, value: 400n },
    ],
  );
  pay(20, 2, [{ address: A, value: 1000n, prev: [cb(19), 0] }], [{ address: C, value: 1000n }]);
  pay(
    60,
    3,
    [{ address: D, value: 400n, prev: [hex(2_000_001), 1] }],
    [{ address: E, value: 400n }],
  );
  pay(
    70,
    4,
    [{ address: B, value: 600n, prev: [hex(2_000_001), 0] }],
    [
      { address: B, value: 300n },
      { address: A, value: 300n },
    ],
  );
  pay(80, 5, [{ address: null, value: 7n, prev: [cb(0), 1] }], [{ address: A, value: 7n }]);
  return txs;
}

describe.skipIf(!ADMIN_URL)("the addresses snapshot", () => {
  let admin: Client;
  let db: Client;
  let reader: Client;
  let ownerUrl: string;
  let connection: { connectionString: string };
  const outDirs: string[] = [];

  const read = async (
    opts: {
      height?: number;
      hash?: string;
      chunk?: number;
      rewindChunk?: number;
      maxRewind?: number;
    } = {},
  ): Promise<AddressesOutcome> => {
    const outDir = mkdtempSync(join(tmpdir(), "opendata-addr-test-"));
    outDirs.push(outDir);
    const height = opts.height ?? N;
    return readAddresses(
      { client: reader, height, hash: opts.hash ?? hex(height + 1), afterChunk: async () => {} },
      { outDir, chunk: opts.chunk, rewindChunk: opts.rewindChunk, maxRewind: opts.maxRewind },
    );
  };
  const rowsOf = (o: AddressesOutcome) => {
    const dir = outDirs.at(-1)!;
    const t = tableFromIPC(readParquet(readFileSync(join(dir, o.file!.path))).intoIPCStream());
    expect(t.schema.fields.map((f) => f.name)).toEqual(ADDRESS_COLUMNS.map((c) => c.name));
    return t.toArray().map((r) => [r.address, r.balance_zat, r.tx_count] as const);
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    ownerUrl = url.toString();
    db = new Client({ connectionString: ownerUrl });
    await db.connect();
    for (const f of ["server/schema-chain.sql", "server/schema.sql", "server/schema-net.sql"]) {
      await db.query(readFileSync(join(ROOT, f), "utf8"));
    }
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendata_reader') THEN
        CREATE ROLE opendata_reader LOGIN CONNECTION LIMIT 2 PASSWORD '${READER_PASSWORD}';
      END IF; END $$`);
    await db.query(`ALTER ROLE opendata_reader PASSWORD '${READER_PASSWORD}'`);
    await db.query(readFileSync(join(ROOT, "server/schema-opendata.sql"), "utf8"));
    const r = new URL(ownerUrl);
    r.username = "opendata_reader";
    r.password = READER_PASSWORD;
    connection = { connectionString: r.toString() };

    const txs = chain();
    let pool = 0n;
    for (let h = 0; h <= TIP; h++) {
      const here = txs.filter((t) => t.height === h);
      for (const t of here) {
        for (const o of t.outs) pool += o.value;
        for (const i of t.ins) pool -= i.value;
      }
      await db.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, transparent_pool_zat)
         VALUES ($1, $2, $3, $4, 1000, $5, $6)`,
        [h, hex(h + 1), hex(h), 1_477_612_800 + h * 150, here.length, pool],
      );
      for (const t of here) {
        const coinbase = t.ins.length === 0;
        await db.query(
          `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind)
           VALUES ($1, $2, $3, $4, 4, 200, $5)`,
          [t.txid, h, 1_477_612_800 + h * 150, coinbase, coinbase ? "coinbase" : "transparent"],
        );
        const io = [
          ...t.ins.map((x, k) => ["in", k, x] as const),
          ...t.outs.map((x, k) => ["out", k, x] as const),
        ];
        for (const [side, k, x] of io) {
          await db.query(
            `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, script_type,
               prev_txid, prev_vout, block_height)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              t.txid,
              side,
              k,
              x.address,
              x.value,
              x.address === null ? "pubkey" : "pubkeyhash",
              x.prev?.[0] ?? null,
              x.prev?.[1] ?? null,
              h,
            ],
          );
        }
      }
    }
    // The rich list as the follower builds it, at the tip.
    const store = new PostgresChainStore(ownerUrl);
    try {
      await store.bootstrapRichList();
    } finally {
      await store.close();
    }
    reader = new Client({ ...connection, types: exportTypes });
    await reader.connect();
  }, 120_000);

  afterAll(async () => {
    await reader?.end();
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
    for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("reads the rich list through its views only, and never its rank", async () => {
    const plain = new Client(connection);
    await plain.connect();
    try {
      for (const sql of [
        "SELECT address FROM chain_address_balance LIMIT 1",
        "SELECT computed_height FROM chain_rich_list_meta",
      ]) {
        await expect(plain.query(sql)).rejects.toThrow(/permission denied/);
      }
      await expect(plain.query("SELECT rank FROM opendata.addresses")).rejects.toThrow(
        /column "rank" does not exist/,
      );
      const { rows } = await plain.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM opendata.addresses",
      );
      expect(rows[0]!.n).toBe(4); // A, B, C and E: D spent everything at 60
    } finally {
      await plain.end();
    }
  });

  it("publishes the balances at N, rewound from the rich list's height", async () => {
    const o = await read();
    expect(o.failures).toEqual([]);
    expect(o.rewoundFrom).toBe(TIP);
    // What every address held at N, derived independently from the ledger itself.
    const { rows } = await db.query<{ address: string; balance: string; txs: string }>(
      `SELECT address, SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END)::text AS balance,
              COUNT(DISTINCT txid)::text AS txs
         FROM tx_transparent_io WHERE address IS NOT NULL AND block_height <= $1
        GROUP BY address HAVING SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END) > 0`,
      [N],
    );
    const expected = rows
      .map((r) => [r.address, BigInt(r.balance), r.address === D ? null : BigInt(r.txs)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(rowsOf(o)).toEqual(expected);
    expect(expected.map((r) => r[0]).sort()).toEqual([A, B, C, D].sort());
    expect(o.rows).toBe(4);
  });

  it("keeps a count the backfill has not filled as NULL, never 0", async () => {
    await db.query("UPDATE chain_address_balance SET tx_count = NULL WHERE address = $1", [B]);
    try {
      const o = await read();
      expect(o.failures).toEqual([]);
      expect(rowsOf(o).find((r) => r[0] === B)).toEqual([B, 600n, null]);
    } finally {
      await db.query("UPDATE chain_address_balance SET tx_count = 2 WHERE address = $1", [B]);
    }
  });

  it("writes the same bytes twice, whatever the chunk sizes", async () => {
    const [a, b] = [await read(), await read()];
    const small = await read({ chunk: 2, rewindChunk: 7 });
    expect(small.failures).toEqual([]);
    expect(b.file!.sha256).toBe(a.file!.sha256);
    expect(small.file!.sha256).toBe(a.file!.sha256);
  });

  const breaks: [string, string, string, RegExp][] = [
    [
      "balances that do not add up to the pool at the rich list's height",
      "UPDATE chain_rich_list_meta SET unattributed_zat = unattributed_zat + 1",
      "UPDATE chain_rich_list_meta SET unattributed_zat = unattributed_zat - 1",
      // The unattributed total is shared, so the rewound side is off by the same zatoshi.
      new RegExp(`do not add up to the transparent pool: 2 \\(e\\.g\\. height ${TIP}: `),
    ],
    [
      "balances that do not add up to the pool at the release height",
      `UPDATE block SET transparent_pool_zat = transparent_pool_zat + 1 WHERE height = ${N}`,
      `UPDATE block SET transparent_pool_zat = transparent_pool_zat - 1 WHERE height = ${N}`,
      new RegExp(`do not add up to the transparent pool: 1 \\(e\\.g\\. height ${N}:`),
    ],
    [
      "an address that is not a mainnet t-address",
      `UPDATE chain_address_balance SET address = 't1' || repeat('a', 33) WHERE address = '${C}'`,
      `UPDATE chain_address_balance SET address = '${C}' WHERE address = 't1' || repeat('a', 33)`,
      /address is not a mainnet t-address: 1/,
    ],
  ];
  for (const [what, breakSql, fixSql, expected] of breaks) {
    it(`stops on ${what}`, async () => {
      await db.query(breakSql);
      try {
        const o = await read();
        expect(o.failures.join("\n")).toMatch(expected);
        expect(o.file).toBeNull();
      } finally {
        await db.query(fixSql);
      }
      expect((await read()).failures).toEqual([]);
    });
  }

  it("stops when the rich list is below the release height, or too far above it", async () => {
    const tooFar = (height: number, most: number) =>
      `address balances too far from the release height: 1 (e.g. at ${TIP}, release ${height}, rewound at most ${most} blocks down)`;
    const below = await read({ height: TIP + 1 });
    expect(below.failures).toEqual([tooFar(TIP + 1, MAX_REWIND)]);
    expect(below.file).toBeNull();
    const above = await read({ maxRewind: TIP - N - 1 });
    expect(above.failures).toEqual([tooFar(N, TIP - N - 1)]);
    expect((await read({ maxRewind: TIP - N })).failures).toEqual([]);
  });

  it("stops when block N is not the one the release read", async () => {
    const o = await read({ hash: hex(999) });
    expect(o.failures.join("\n")).toMatch(/block at the release height changed/);
  });
});
