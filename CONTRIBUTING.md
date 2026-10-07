# Contributing

Thanks for your interest. shieldedscan is maintained by one person, so the bar is that a change
keeps the data honest and the site fast.

1. Read [ARCHITECTURE.md](ARCHITECTURE.md). Most review comments come from those rules.
2. Open an issue before a large change, so we can agree on the approach first.
3. Run `npm run verify` before opening a pull request. It is what CI runs.
4. Add a test for what you change. For a data fix, a test that fails without the fix.

The site runs offline on fixtures (`npm run dev`), so most UI work needs no server.

## Secret safety

`npm install` points git at the hooks in `.githooks/`. Before every commit and push they refuse
credential files (`.env`, private keys) and, when [gitleaks](https://github.com/gitleaks/gitleaks#installing)
is installed, scan the changes for secrets. Without gitleaks the hooks warn and continue.

CI runs the same scan on every push and pull request. Never put a secret in the repository, an
issue or a commit message; configuration belongs in environment variables (see `.env.example`).

By submitting a contribution you agree that it is licensed under the project's AGPL-3.0, and
that the maintainer may also distribute it under other open-source licences in the future.
