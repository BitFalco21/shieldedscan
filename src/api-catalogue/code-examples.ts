import { API_BASE_URL } from "./base-url";
import type { ApiCodeExample } from "./types";

export const API_CODE_EXAMPLES: ApiCodeExample[] = [
  {
    language: "JavaScript",
    code: `const BASE = "${API_BASE_URL}";

// The six-pool supply accounting
const supply = await (await fetch(BASE + "/v1/supply")).json();
console.log(supply.pools.map((p) => p.pool + ": " + p.balanceZat));

// The privacy reading of one transaction
const txid = "25d87ba678308c4b88b5b3cfebf4eda388d2e3523f2cf93c03ea2894b0fe8a1e";
const privacy = await (await fetch(BASE + "/v1/transactions/" + txid + "/privacy")).json();
console.log(privacy.kind, privacy.migration); // "shielded", { fromPools: ["orchard"], ... }

// Nulls always come with reasons — never coerce them
if (privacy.publicValueZat === null) {
  console.log("no public value:", privacy.unknowns.publicValueZat); // "shielded"
}`,
  },
  {
    language: "Python",
    code: `import requests

BASE = "${API_BASE_URL}"

# Halving countdown
halving = requests.get(f"{BASE}/v1/network/halving").json()
print(f"{halving['blocksRemaining']} blocks to halving ~ {halving['estimatedAt']}")

# Where inbound cross-chain ZEC lands — with the denominator, always
dest = requests.get(f"{BASE}/v1/crosschain/destinations", params={"direction": "in"}).json()
share = dest["shieldedCapableShare"]
print(f"shielded-capable: {share['pct']}% ({share['numerator']}/{share['denominator']})")`,
  },
  {
    language: "cURL",
    code: `# Circulating supply as a bare number (aggregator-ready)
curl ${API_BASE_URL}/v1/supply/circulating

# ZIP-317 conventional fees
curl ${API_BASE_URL}/v1/network/fees

# Recent cross-chain transfers, keyset-paginated
curl "${API_BASE_URL}/v1/crosschain/transfers?limit=5"`,
  },
  {
    language: "MCP",
    code: `# Every endpoint on this page as a tool for an AI assistant. Keyless, read-only,
# stateless Streamable HTTP; tool names and descriptions come from this page.
# Server URL: ${API_BASE_URL}/mcp

# Claude Code
claude mcp add --transport http shieldedscan ${API_BASE_URL}/mcp

# Clients configured with JSON
{ "mcpServers": { "shieldedscan": { "url": "${API_BASE_URL}/mcp" } } }`,
  },
];
