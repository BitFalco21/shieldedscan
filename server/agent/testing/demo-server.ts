import { serve } from "@hono/node-server";
import { agentRoutes } from "../index";
import { demoStreamer } from "./demo-streamer";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "./fixture-world";

/**
 * The agent's real HTTP route over the fixture world and a scripted model, on localhost only: a
 * way to see a chart reply in `npm run dev` with no key and nothing leaving the machine.
 *
 *   npm run dev:agent-demo
 *   NEXT_PUBLIC_AGENT_ENABLED=1 NEXT_PUBLIC_API_BASE_URL=http://localhost:8787 npm run dev
 *
 * The clock is pinned to the fixture world's day (2026-08-03), where its data ends.
 */

const PORT = 8787;

const app = agentRoutes({
  v1: makeV1(),
  chain: makeChain(),
  streamer: demoStreamer,
  now: () => FIXTURE_NOW_MS,
  budget: { check: async () => ({ allowed: true, tokensUsed: 0 }), record: async () => {} },
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Zeno chart demo on http://localhost:${PORT}/agent/ask (scripted, fixture data)`);
});
