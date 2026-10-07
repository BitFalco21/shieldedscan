#!/bin/bash
# Alert before the disk fills, and record what grew. The archive node and Postgres share one disk.
#
# Every run records the top consumers alongside the percentage: a percentage alone says "full"
# without saying "of what", and by the time anyone looks the cause may already be gone.
set -u

STAMP=$(date -u +%FT%TZ)
USE=$(df / --output=pcent | tail -1 | tr -dc 0-9)
LOG=~/log/disk.log
DETAIL=~/log/disk-detail.log

echo "$STAMP disk at ${USE}%" >> "$LOG"

# Composition, always — not only when alarming, because the baseline is what makes a spike
# legible. Volumes, images and per-container LOG sizes: container logs are the classic
# unbounded consumer and they live on the main disk however the data volumes are mounted.
{
  echo "=== $STAMP  disk ${USE}%  $(df -h / | tail -1)"
  docker system df 2>/dev/null | sed 's/^/    /'
  echo "    -- container log bytes:"
  for c in $(docker ps --format '{{.Names}}'); do
    n=$(docker logs "$c" 2>&1 | wc -c)
    echo "       $c $((n / 1024 / 1024)) MB"
  done
  echo "    -- postgres:"
  docker exec pg sh -c 'du -sh $PGDATA/base $PGDATA/pg_wal 2>/dev/null' 2>/dev/null | sed 's/^/       /'
} >> "$DETAIL" 2>&1

# Keep the detail log from becoming its own disk problem.
tail -n 2000 "$DETAIL" > "$DETAIL.tmp" 2>/dev/null && mv "$DETAIL.tmp" "$DETAIL"

# The two block devices: the mainnet node's state on /dev/vdc (volume zakura-mainnet-bs) and the
# testnet node + Postgres on /dev/vdb. `df` on the mount point needs root; a throwaway container
# sees it.
vol_use() { docker run --rm -v "$1":/v alpine df -P /v 2>/dev/null | awk 'NR==2{print $5}' | tr -dc 0-9; }
VDC=$(vol_use zakura-mainnet-bs)
VDB=$(vol_use zakura-testnet-bs)
echo "$STAMP mainnet-node vdc at ${VDC:-?}%  testnet vdb at ${VDB:-?}%" >> "$LOG"
echo "    -- block devices: vdc (mainnet node) ${VDC:-?}%  vdb (testnet) ${VDB:-?}%" >> "$DETAIL"

reason=""
[ "$USE" -ge 85 ] && reason="$reason / at ${USE}%;"
[ "${VDC:-0}" -ge 85 ] && reason="$reason mainnet node disk (vdc) at ${VDC}%;"
[ "${VDB:-0}" -ge 85 ] && reason="$reason testnet disk (vdb) at ${VDB}%;"
if [ -n "$reason" ]; then
  echo "$STAMP DISK:$reason — see ~/log/disk-detail.log for composition" > ~/DISK_ALERT
else
  rm -f ~/DISK_ALERT
fi
