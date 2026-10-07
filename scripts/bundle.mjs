#!/usr/bin/env node
/**
 * Bundles one server entry point into a single self-contained ES module:
 *
 *   node scripts/bundle.mjs <entry.ts> <outfile.mjs>
 *
 * The `@/` alias is resolved at build time from tsconfig.json, so the output needs no
 * node_modules. The banner gives the module a `require`, which some bundled CommonJS
 * dependencies call.
 */
import { build } from "esbuild";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("usage: node scripts/bundle.mjs <entry.ts> <outfile.mjs>");
  process.exit(2);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
