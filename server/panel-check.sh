#!/bin/sh
# Alert when a panel stops answering.
#
# The other monitors each watch one thing:
#
#   explorer-watchdog.sh      the venue poller is stuck        -> restarts the API
#   chain-divergence-check.sh our tip disagrees with the world -> writes DIVERGENCE_ALERT
#   testnet-stall-guard.sh    the testnet node stopped syncing -> restarts the node
#   zakura-eos-alert.sh       the node halts soon              -> writes ZAKURA_UPGRADE_ALERT
#
# A query can cross its statement_timeout without any of those firing: the API is healthy, the tip
# is right, the node is fine, and one panel is simply blank. Three layers:
#
#  1. The API endpoints, per network. Precise: it names which endpoint broke.
#  2. The rendered pages, checked for the unavailable panel itself. This matches what a visitor
#     sees and catches causes the endpoint list does not know about (a frontend bug, a bad deploy).
#  3. Staleness, which both of the above miss. A statically rendered page whose revalidation
#     throws keeps serving its last good render (HTTP 200, no unavailable panel, silently frozen),
#     and the `age` header cannot show it. The homepage prints the chain height, so comparing it
#     with the API's own tip measures whether the page is still being rebuilt.
#
# Writes $HOME/PANEL_ALERT on failure and removes it when healthy, like the other monitors
# (.bashrc prints any *_ALERT file at login). Never logs an IP or a token: the bearer token is read
# inside the container from its own environment and never printed.
set -u

ALERT="$HOME/PANEL_ALERT"
LOG="$HOME/log/panel-check.log"
STAMP=$(date -u +%FT%TZ)
mkdir -p "$HOME/log"

FOUND=$(mktemp)
trap 'rm -f "$FOUND"' EXIT

# Every analytics endpoint a page depends on. Any of them can cross its timeout as tables grow and
# query plans change.
PATHS='/chain/info
/chain/pools
/chain/supply
/chain/analytics/ironwood
/chain/analytics/months
/chain/analytics/days
/chain/analytics/activity
/chain/analytics/supply
/chain/analytics/shielding-flow
/chain/analytics/shielding-flow-days
/chain/analytics/fee-kinds
/chain/analytics/fee-kinds-days
/chain/analytics/fee-totals
/chain/analytics/network-daily
/chain/analytics/tx-counts
/chain/analytics/fees24h'

# One `docker exec` per container rather than one per path: the token stays inside the container,
# and the sequential fetches over loopback take about a second.
check_api() {
  container=$1
  label=$2
  docker ps --format '{{.Names}}' | grep -q "^${container}$" || {
    echo "$label: container ${container} is not running" >> "$FOUND"
    return
  }
  out=$(docker exec "$container" node -e '
const H = { authorization: "Bearer " + process.env.EXPLORER_API_TOKEN };
// `.filter(Boolean)`: the shell joins the list with `tr`, which leaves a trailing
// separator, and the empty path fetched the API root and reported a bogus 404. The check
// caught that in itself on its first run.
const paths = process.argv[1].split(",").filter(Boolean);
(async () => {
  for (const p of paths) {
    // One retry, so a single transient blip does not raise an alert a human has to triage.
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const r = await fetch("http://127.0.0.1:8080" + p, { headers: H });
        status = r.status;
        if (status === 200) break;
      } catch { status = 0; }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
    if (status !== 200) console.log(p + " -> " + (status === 0 ? "unreachable" : status));
  }
})();
' "$(echo "$PATHS" | tr '\n' ',')" 2>/dev/null) || {
    echo "$label: could not exec into ${container}" >> "$FOUND"
    return
  }
  [ -n "$out" ] && echo "$out" | sed "s/^/${label} API /" >> "$FOUND"
}

# The visitor's view. `TEMPORARILY UNAVAILABLE` is `DataUnavailable`'s own microlabel, so this
# checks what the reader actually sees.
check_page() {
  base=$1
  path=$2
  label=$3
  body=$(curl -sS --max-time 30 "${base}${path}" 2>/dev/null) || {
    echo "$label page ${path} -> unreachable" >> "$FOUND"
    return
  }
  case "$body" in
    *"TEMPORARILY UNAVAILABLE"*)
      echo "$label page ${path} -> renders an unavailable panel" >> "$FOUND" ;;
  esac
}

# How far the rendered homepage may lag the node before it counts as frozen. A healthy lag is a
# handful of blocks; 200 is hours at mainnet's 75 s target.
MAX_LAG_BLOCKS=200

check_staleness() {
  base=$1
  container=$2
  label=$3
  tip=$(docker exec "$container" node -e '
const H = { authorization: "Bearer " + process.env.EXPLORER_API_TOKEN };
fetch("http://127.0.0.1:8080/chain/info", { headers: H })
  .then((r) => r.json()).then((d) => console.log(d.height)).catch(() => console.log(""));
' 2>/dev/null)
  shown=$(curl -sS --max-time 30 "$base" 2>/dev/null | sed 's/<[^>]*>/ /g' \
    | grep -oE 'block +[0-9,]{5,}' | head -1 | grep -oE '[0-9,]+' | tr -d ',')
  # Either side missing means this check cannot conclude anything; log it rather than alerting (a
  # monitor that alerts on its own failure gets ignored, and layer 1 covers a dead API).
  if [ -z "$tip" ] || [ -z "$shown" ]; then
    echo "$STAMP $label staleness check inconclusive (tip='${tip}' shown='${shown}')" >> "$LOG"
    return
  fi
  lag=$((tip - shown))
  [ "$lag" -lt 0 ] && lag=$(( -lag ))
  if [ "$lag" -gt "$MAX_LAG_BLOCKS" ]; then
    echo "$label homepage is FROZEN: shows block ${shown}, node is at ${tip} (${lag} behind)" >> "$FOUND"
  fi
}

check_api explorer-api mainnet
check_api explorer-api-testnet testnet
check_staleness https://shieldedscan.xyz explorer-api mainnet
check_staleness https://testnet.shieldedscan.xyz explorer-api-testnet testnet

for p in / /shielded /analytics /charts /charts/ironwood-balance /charts/shielding-flow /charts/fee-totals; do
  check_page https://shieldedscan.xyz "$p" mainnet
done
# Testnet serves fewer charts (price and cross-chain are absent there by design), so only pages
# both networks have are checked.
for p in / /shielded /analytics; do
  check_page https://testnet.shieldedscan.xyz "$p" testnet
done

if [ -s "$FOUND" ]; then
  {
    echo "$STAMP panel-check FAILED:"
    sed 's/^/  /' "$FOUND"
  } | tee -a "$LOG" > "$ALERT"
  exit 1
fi

rm -f "$ALERT"
echo "$STAMP panel-check ok" >> "$LOG"
