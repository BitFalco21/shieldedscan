# shieldedscan — instructions for AI assistants

A privacy-first Zcash block explorer: Next.js app in `src/`, API service in `server/`.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything. Its rules are not optional:
each one exists because breaking it puts a wrong number on the page.

## Commands

- `npm run dev` — runs on fixtures, no server needed.
- `npm run verify` — format, typecheck, lint, tests, build. Must pass before a commit.
- `npm run test:e2e` — Playwright suites against a production build.

## Working rules

- Strict TypeScript: no `any`, no unexplained `@ts-ignore`.
- Small focused files, one component per file; exported components declare a
  `<ComponentName>Props` interface.
- Styling through Tailwind tokens only; no inline `style` props.
- No new dependency without a stated reason.
- Comments explain _why_ in a few lines. History belongs in commit messages.
- Never render a shielded value as a number, and never substitute a fallback figure for one
  we failed to read.
