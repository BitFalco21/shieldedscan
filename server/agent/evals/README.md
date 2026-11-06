# Zeno evals

The corpus in `cases/` is Zeno's quality process. `run.ts` runs it against a real model; it is not in
the commit gate because it costs money and depends on a provider. `npm run verify` checks the
corpus's structure and every latency route without a model.

## Running it

```sh
npm run build:eval                       # bundles run.ts into dist/eval-agent.mjs (no node_modules needed)
node dist/eval-agent.mjs --dump run.json # the whole corpus; needs the provider's key (NEAR_AI_API_KEY)
node dist/eval-agent.mjs --only latency --repeat 3 --dump latency.json
node dist/eval-agent.mjs --case latency-tx-24h --verbose
```

Live cases read the public API (`EVAL_V1_BASE_URL`, production by default). The private analytics
surface needs `EVAL_CHAIN_BASE_URL` and `EVAL_CHAIN_TOKEN`; without both, those reads answer
"unavailable", which some cases then fail honestly.

Exit codes: 0 clean, 1 a mechanical failure, 3 clean but with rubrics awaiting a person.

## Latency

Every case records its wall time, model calls, tool rounds, each read's time, and per model call the
time to first data and the prompt, cached and output tokens the provider reported. The run ends with
a table per category (p50 and p90 wall time, mean calls and rounds) and the share of prompt tokens
served from the provider's cache on a turn's first call against its later ones. `--dump` keeps all
of it per case.

The `latency` category is ~30 common questions, each with the tool rounds a well-routed answer
needs (`maxToolRounds`) and the detours it must not take (`mustNotCall`). Run it with `--repeat 3`
or more: one run of a hosted model is noise.

## Without a key

```sh
node dist/eval-agent.mjs --only latency --model scripted
```

`--model scripted` replaces the model with one that makes each case's `route` calls in a single round
and answers with a fixed sentence. It proves the wiring (dispatch, timing, the summary) and nothing
else: its times are our side only, and its PASS says nothing about the real model.
