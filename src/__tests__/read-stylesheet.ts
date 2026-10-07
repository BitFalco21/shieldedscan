import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The site's root stylesheet. */
export const GLOBALS_CSS = resolve(process.cwd(), "src/app/globals.css");

/**
 * The files `globals.css` imports, in cascade order. Package imports such as `tailwindcss` are
 * skipped: only the site's own CSS is checked.
 */
export function stylesheetFiles(): string[] {
  const root = readFileSync(GLOBALS_CSS, "utf8");
  const files = [...root.matchAll(/^@import "(\.[^"]+)";$/gm)].map((m) =>
    join(dirname(GLOBALS_CSS), m[1] as string),
  );
  if (files.length === 0) throw new Error("globals.css imports no local stylesheet");
  return files;
}

/**
 * The site's whole stylesheet as one text, in cascade order: `globals.css` followed by every file
 * it imports. Tests that pin tokens and classes read this rather than one file, so splitting the
 * stylesheet cannot hide a rule from them.
 */
export function readStylesheet(): string {
  return [GLOBALS_CSS, ...stylesheetFiles()].map((f) => readFileSync(f, "utf8")).join("\n");
}
