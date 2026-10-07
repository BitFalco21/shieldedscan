#!/usr/bin/env bash
# Shared checks for the pre-commit and pre-push hooks. They never print a matched value:
# a finding names the file and the rule, so a hook run cannot itself leak what it caught.
#
# Always on: credential file names and, when gitleaks is installed, a secret scan.
# Maintainer-only, enabled with `git config shieldedscan.maintainerChecks true`: a GitHub
# no-reply identity on every commit, and a private blocklist read from
# `git config shieldedscan.blocklist` (one extended regex per line, '#' starts a comment).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NOREPLY_RE='^[0-9]+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$'

fail() {
  printf '\n\033[31mBLOCKED:\033[0m %s\n' "$1" >&2
  exit 1
}

warn() {
  printf '\033[33mwarning:\033[0m %s\n' "$1" >&2
}

maintainer_checks() {
  [[ "$(git config --bool shieldedscan.maintainerChecks 2>/dev/null || true)" == "true" ]]
}

# Succeeds when gitleaks is available. Without it the hooks warn and continue; CI runs the
# same scan on every push and pull request.
have_gitleaks() {
  command -v gitleaks >/dev/null 2>&1 && return 0
  warn "gitleaks is not installed, so this hook did not scan for secrets. Install it: https://github.com/gitleaks/gitleaks#installing"
  return 1
}

check_email() { # $1 = email, $2 = what it belongs to
  maintainer_checks || return 0
  [[ "$1" =~ $NOREPLY_RE ]] ||
    fail "$2 uses an email that is not a GitHub no-reply address. Set: git config user.email <id>+<user>@users.noreply.github.com"
}

check_filenames() { # file names on stdin
  local bad
  bad="$(grep -E '(^|/)(\.env($|\.)|id_(rsa|ed25519|ecdsa)|CLAUDE\.local\.md$)|\.(pem|key|p12|pfx)$' | grep -vE '(^|/)\.env\.example$' || true)"
  [[ -z "$bad" ]] || fail "refusing to commit a credential or private file: $(echo "$bad" | tr '\n' ' ')"
}

check_blocklist() { # text on stdin; $1 = label for the message
  local blocklist text n=0 pattern
  if ! maintainer_checks; then
    cat >/dev/null
    return 0
  fi
  blocklist="$(git config shieldedscan.blocklist 2>/dev/null || true)"
  if [[ -z "$blocklist" ]]; then
    printf 'note: shieldedscan.blocklist is not set; skipping the blocklist check\n' >&2
    cat >/dev/null
    return 0
  fi
  [[ -f "$blocklist" ]] || fail "shieldedscan.blocklist points at a file that does not exist"
  text="$(cat)"
  while IFS= read -r pattern || [[ -n "$pattern" ]]; do
    n=$((n + 1))
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if grep -qiE -- "$pattern" <<<"$text"; then
      fail "$1: a line matches private blocklist entry #$n (the match is not printed)"
    fi
  done <"$blocklist"
}
