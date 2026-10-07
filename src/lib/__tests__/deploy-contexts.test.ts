import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteUrl } from "../site";

/**
 * Deploy-context configuration, pinned.
 *
 *  - `NEXT_PUBLIC_SITE_URL` must be set for production, or `siteUrl` falls back to its local
 *    default and the sitemap and robots.txt advertise localhost URLs to crawlers.
 *  - `NEXT_PUBLIC_STAGE` must be scoped per context. A Netlify UI variable applies to every
 *    context unless scoped, which would make every branch deploy and PR preview an indexable
 *    duplicate of the site: `robots.ts` and the `X-Robots-Tag` both key off that flag.
 *
 * These assertions cannot prove a deploy carried the right values (only a request against
 * the deployed site does); they prove the scoping has not been deleted.
 */

const toml = readFileSync(join(process.cwd(), "netlify.toml"), "utf8");

/**
 * Every line belonging to `[context.<name>]` and its sub-tables.
 *
 * A line scanner rather than a regex: JavaScript has no `\Z`, and a block regex that
 * over-captures to the end of the file passes for the wrong reason.
 */
function contextBlock(name: string): string {
  const prefix = `[context.${name}`;
  const lines = toml.split("\n");
  const collected: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.startsWith("[")) inside = line.startsWith(prefix);
    if (inside) collected.push(line);
  }
  return collected.join("\n");
}

const PREVIEW_CONTEXTS = ["deploy-preview", "branch-deploy"] as const;

describe("netlify deploy contexts", () => {
  it("gives production the public stage and a real canonical origin", () => {
    const production = contextBlock("production");
    expect(production, "no [context.production] block").not.toBe("");
    expect(production).toMatch(/NEXT_PUBLIC_STAGE\s*=\s*"public"/);

    const url = production.match(/NEXT_PUBLIC_SITE_URL\s*=\s*"([^"]+)"/)?.[1];
    expect(url, "production sets no NEXT_PUBLIC_SITE_URL").toBeTruthy();
    expect(url).toMatch(/^https:\/\//);
    expect(url, "production would advertise a localhost sitemap").not.toContain("localhost");
    expect(
      url,
      "trailing slash would double the separator in `${siteUrl}/sitemap.xml`",
    ).not.toMatch(/\/$/);
  });

  it.each(PREVIEW_CONTEXTS)("keeps %s un-indexable", (name) => {
    const block = contextBlock(name);
    expect(block, `no [context.${name}] block`).not.toBe("");
    expect(block).toMatch(/NEXT_PUBLIC_STAGE\s*=\s*"preview"/);
    expect(block, `${name} must never be the public stage`).not.toMatch(
      /NEXT_PUBLIC_STAGE\s*=\s*"public"/,
    );
  });

  it.each(PREVIEW_CONTEXTS)("gives %s its own deploy URL rather than localhost", (name) => {
    // Netlify does not interpolate variables inside [context.*.environment], so the preview
    // URL has to arrive through the build command. If this is ever "simplified" into the
    // environment table it will be the literal string `$DEPLOY_PRIME_URL`.
    const block = contextBlock(name);
    expect(block).toMatch(/command\s*=\s*"NEXT_PUBLIC_SITE_URL=\$DEPLOY_PRIME_URL /);
  });

  /**
   * The AI agent's release gate. `isAgentEnabled` is false unless the flag is exactly "1",
   * so a deleted line fails safe; what these tests catch is the flag set in the wrong place,
   * such as the shared `[build.environment]` block that applies to every context.
   */
  it.each(PREVIEW_CONTEXTS)("enables the AI agent on %s", (name) => {
    expect(contextBlock(name)).toMatch(/NEXT_PUBLIC_AGENT_ENABLED\s*=\s*"1"/);
  });

  it("enables the AI agent in production", () => {
    // The flag must be set here, in the production context, and never in the Netlify UI or
    // in `[build.environment]`.

    expect(contextBlock("production")).toMatch(/NEXT_PUBLIC_AGENT_ENABLED\s*=\s*"1"/);
  });

  it("does not enable the AI agent globally, which would reach production", () => {
    // [build.environment] applies to every context, so the flag must never be assigned
    // there. TOML comments are stripped first, since prose explaining the flag may mention it.
    const buildEnv = (toml.split("[build.environment]")[1]?.split("\n[")[0] ?? "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(buildEnv).not.toMatch(/NEXT_PUBLIC_AGENT_ENABLED\s*=/);
  });

  it("only falls back to localhost when nothing set the variable", () => {
    // The fallback is correct for local dev; the contexts above exist to displace it in
    // deployed builds.
    expect(siteUrl).toBe(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  });
});
