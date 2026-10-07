#!/bin/sh
# Makes the cron monitors' alerts visible. Append to ~/.bashrc on the host.
#
# Every monitor in `server/crontab` reports by writing a ~/*_ALERT file and removing it when
# healthy. An interactive login prints any outstanding alert and nothing when all is well.
#
# It globs rather than naming files, so a new monitor's alert is shown without editing this list.
for f in ~/*_ALERT ~/*_ALERT_*; do
  [ -f "$f" ] && { echo "!!! $(basename "$f"):"; cat "$f"; }
done
