#!/bin/bash
# Alert before the mainnet node reaches its end-of-support halt.
#
# Zakura releases carry an end-of-support height and the node refuses to run past it, so missing
# this alert takes the whole site down on a schedule. Releases currently halt about a month after
# they ship, so expect this to fire roughly monthly.
#
# The halt height is derived, not hardcoded: the node logs "Zakura release is supported until
# block N" on every check, so the newest occurrence in its log is the truth and an upgrade needs
# no edit here.
#
# The stable-release check is ordered (`sort -V`), not `!=`: GitHub's /releases/latest excludes
# prereleases, so a running prerelease can be newer than "latest stable", and an inequality check
# would then advise a downgrade.
set -u

STAMP=$(date -u +%FT%TZ)
LOG=~/log/zakura-eos.log
ALERT=~/ZAKURA_UPGRADE_ALERT
# Only used if the node's own log cannot be read, so a log-rotation gap cannot silence the
# monitor. Keep it at the halt height of the installed release.
EOS_HEIGHT_FALLBACK=3528681

installed=$(docker exec explorer-api node -e '
fetch("http://zakura:8232",{method:"POST",headers:{"content-type":"application/json"},
body:JSON.stringify({jsonrpc:"1.0",id:1,method:"getinfo",params:[]})})
 .then(r=>r.json()).then(d=>console.log(d.result.subversion.replace(/[^0-9.]/g,""))).catch(()=>console.log(""))' 2>/dev/null)
[ -n "$installed" ] && installed="v${installed}"

tip=$(docker exec explorer-api node -e '
fetch("http://zakura:8232",{method:"POST",headers:{"content-type":"application/json"},
body:JSON.stringify({jsonrpc:"1.0",id:1,method:"getblockchaininfo",params:[]})})
 .then(r=>r.json()).then(d=>console.log(d.result.blocks)).catch(()=>console.log(""))' 2>/dev/null)

# The node's own figure; the newest occurrence wins.
eos=$(docker logs --tail 2000 zakura 2>&1 \
  | grep -oE 'supported until block [0-9]+' | tail -1 | grep -oE '[0-9]+')
eos_source=node
if [ -z "$eos" ]; then
  eos=$EOS_HEIGHT_FALLBACK
  eos_source=fallback
fi

# Latest STABLE release (GitHub excludes prereleases/drafts from /latest).
latest=$(curl -fsS --max-time 20 https://api.github.com/repos/zakura-core/zakura/releases/latest \
  | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')

msgs=""
if [ -n "$tip" ]; then
  remaining=$((eos - tip))
  days=$((remaining * 75 / 86400))
  [ "$days" -le 6 ] && msgs="${msgs}ONLY ${days} DAYS until node halts at block ${eos} — upgrade NOW. "
else
  remaining=na; days=na
  msgs="${msgs}could not read mainnet tip. "
fi

# Ordered, not merely unequal: alert only when the newest stable is strictly newer than what is
# running. `sort -V` puts the greater version last.
if [ -n "$latest" ] && [ -n "$installed" ] && [ "$latest" != "$installed" ]; then
  newest=$(printf '%s\n%s\n' "$latest" "$installed" | sort -V | tail -1)
  [ "$newest" = "$latest" ] && msgs="${msgs}Stable ${latest} is newer than installed ${installed} — snapshot then upgrade. "
fi

line="$STAMP tip=${tip:-na} installed=${installed:-na} eos=${eos}(${eos_source}) days_to_halt=${days} latest_stable=${latest:-na}"
if [ -n "$msgs" ]; then
  echo "$line ALERT: $msgs" | tee -a "$LOG" > "$ALERT"
else
  echo "$line" >> "$LOG"
  rm -f "$ALERT"
fi
