import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// `next/link` prefetches every dynamic route in view, which costs a server render per row.
// `components/Link.tsx` defaults prefetch off and is the only file allowed to import the real one.
const NEXT_LINK = {
  name: "next/link",
  message: "Import Link from @/components/Link — it defaults prefetch to false.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/Link.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [NEXT_LINK] }],
    },
  },
  {
    // One import style for the primitives, the one the rest of `src/` uses to reach them. This
    // block replaces the rule above for these files, so it restates the `next/link` path.
    files: ["src/components/*.{ts,tsx}"],
    ignores: ["src/components/Link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [NEXT_LINK],
          patterns: [{ group: ["./*", "../*"], message: "Import through @/components/… instead." }],
        },
      ],
    },
  },
  {
    // A leading underscore marks a value that is intentionally unused, such as a field
    // destructured away so the rest can be passed on.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // The film pages load these as classic scripts that share top-level functions, so a
    // top-level declaration used by another file is not unused.
    files: ["brand/trailer/*.js"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The esbuild bundle of the API service — generated, never hand-edited.
    "dist/**",
    // Local tool state, including git worktrees of other branches.
    ".claude/**",
  ]),
]);

export default eslintConfig;
