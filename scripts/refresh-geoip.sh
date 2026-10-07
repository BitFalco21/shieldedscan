#!/usr/bin/env bash
#
# Loads MaxMind GeoLite2 (City + ASN) into the crawler's range tables, so IP enrichment is a
# local SQL join — no .mmdb reader, no per-lookup third-party call, and no node IP ever
# leaves the box. Run monthly by cron (GeoLite2 refreshes weekly; monthly is plenty for a
# node map).
#
# Requires:
#   MAXMIND_LICENSE_KEY   the only external credential the crawler needs — a free key from
#                         maxmind.com -> Manage License Keys. Kept in an env file on the host,
#                         never in the repo.
#   DATABASE_URL, or the PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE set the containers use,
#                         passed through to psql as-is.
#
# Needs only curl, python3 and Docker: archives are unpacked with python's zipfile, and psql
# runs from the postgres:17 image with the work directory mounted, which keeps `\copy`
# (client-side file reads) and the single atomic transaction exactly as written. A host psql
# is used instead when present.
#
# The load is atomic: CSV -> temp tables, then one transaction truncates the live tables and
# swaps the new rows in, so stale ranges never linger. A failed download or parse leaves the
# previous ranges untouched.
set -euo pipefail

: "${MAXMIND_LICENSE_KEY:?set MAXMIND_LICENSE_KEY}"
# psql reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (or DATABASE_URL) itself. They are
# never assembled into a URL here: a special character in the password would break the URL,
# and psql's error message would echo part of it into a log. Pass-through only.
if [[ -z "${DATABASE_URL:-}" && -z "${PGHOST:-}" ]]; then
  echo "set DATABASE_URL or the PG* variables" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

base="https://download.maxmind.com/app/geoip_download"
fetch() {
  local edition="$1"
  curl -fsSL "${base}?edition_id=${edition}&license_key=${MAXMIND_LICENSE_KEY}&suffix=zip" \
    -o "${WORK}/${edition}.zip"
  python3 -m zipfile -e "${WORK}/${edition}.zip" "$WORK"
}

fetch "GeoLite2-City-CSV"
fetch "GeoLite2-ASN-CSV"

# The archives unpack into a dated subdirectory per edition; the SQL below reads them under
# /work, which is where the container (or the host psql, via a symlink) sees $WORK.
city_dir="$(cd "$WORK" && find . -maxdepth 1 -type d -name 'GeoLite2-City-CSV_*' | head -1 | sed 's#^\./##')"
asn_dir="$(cd "$WORK" && find . -maxdepth 1 -type d -name 'GeoLite2-ASN-CSV_*' | head -1 | sed 's#^\./##')"
[[ -n "$city_dir" && -n "$asn_dir" ]] || { echo "GeoLite2 archives did not unpack as expected" >&2; exit 1; }

cat > "${WORK}/load.sql" <<SQL
\\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE geo_block_raw (
  network TEXT, geoname_id TEXT, registered_country_geoname_id TEXT,
  represented_country_geoname_id TEXT, is_anonymous_proxy TEXT, is_satellite_provider TEXT,
  postal_code TEXT, latitude TEXT, longitude TEXT, accuracy_radius TEXT, is_anycast TEXT
);
\\copy geo_block_raw FROM '/work/${city_dir}/GeoLite2-City-Blocks-IPv4.csv' WITH (FORMAT csv, HEADER true)
\\copy geo_block_raw FROM '/work/${city_dir}/GeoLite2-City-Blocks-IPv6.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE geo_loc_raw (
  geoname_id TEXT, locale_code TEXT, continent_code TEXT, continent_name TEXT,
  country_iso_code TEXT, country_name TEXT, subdivision_1_iso_code TEXT,
  subdivision_1_name TEXT, subdivision_2_iso_code TEXT, subdivision_2_name TEXT,
  city_name TEXT, metro_code TEXT, time_zone TEXT, is_in_european_union TEXT
);
\\copy geo_loc_raw FROM '/work/${city_dir}/GeoLite2-City-Locations-en.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE asn_block_raw (
  network TEXT, autonomous_system_number TEXT, autonomous_system_organization TEXT
);
\\copy asn_block_raw FROM '/work/${asn_dir}/GeoLite2-ASN-Blocks-IPv4.csv' WITH (FORMAT csv, HEADER true)
\\copy asn_block_raw FROM '/work/${asn_dir}/GeoLite2-ASN-Blocks-IPv6.csv' WITH (FORMAT csv, HEADER true)

TRUNCATE net_geo_block;
INSERT INTO net_geo_block (network, geoname_id, lat, lon)
SELECT network::cidr,
       NULLIF(geoname_id, '')::bigint,
       NULLIF(latitude, '')::double precision,
       NULLIF(longitude, '')::double precision
FROM geo_block_raw;

TRUNCATE net_geo_location;
INSERT INTO net_geo_location (geoname_id, country, city)
SELECT geoname_id::bigint, NULLIF(country_name, ''), NULLIF(city_name, '')
FROM geo_loc_raw WHERE geoname_id <> '';

TRUNCATE net_asn_block;
INSERT INTO net_asn_block (network, asn, asn_org)
SELECT network::cidr,
       NULLIF(autonomous_system_number, '')::bigint,
       NULLIF(autonomous_system_organization, '')
FROM asn_block_raw;

-- Clearing the stamp is what re-enriches every already-seen node against the NEW ranges on
-- the crawler's next cycle. A location that moved ASN or city is corrected; a NULL that now
-- resolves gets filled. Without this line, only nodes seen after today would ever be placed.
UPDATE net_node SET geo_checked_at = NULL;

SELECT (SELECT count(*) FROM net_geo_block) AS geo_blocks,
       (SELECT count(*) FROM net_geo_location) AS locations,
       (SELECT count(*) FROM net_asn_block) AS asn_blocks;
COMMIT;
SQL

# Connection parameters reach psql as environment variables (PG*), or as DATABASE_URL when
# that is what the caller set — never assembled by this script.
run_psql() {
  if [[ -n "${DATABASE_URL:-}" ]]; then psql "$DATABASE_URL" "$@"; else psql "$@"; fi
}

if command -v psql >/dev/null 2>&1; then
  # A host psql reads the files directly; /work is where the SQL expects them.
  ln -sfn "$WORK" /work 2>/dev/null || { echo "cannot expose $WORK as /work for host psql" >&2; exit 1; }
  run_psql -f "${WORK}/load.sql"
else
  # The box: psql from the postgres image already present, on the containers' network so the
  # `pg` hostname resolves, with the work directory mounted read-only. `-e NAME` (no value)
  # forwards each variable from THIS environment without putting it on the command line.
  docker run --rm --network "${GEOIP_DOCKER_NETWORK:-zcash}" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e DATABASE_URL \
    -v "${WORK}:/work:ro" "${GEOIP_PSQL_IMAGE:-postgres:17}" \
    sh -c 'if [ -n "${DATABASE_URL:-}" ]; then psql "$DATABASE_URL" -f /work/load.sql; else psql -f /work/load.sql; fi'
fi

echo "GeoIP range tables refreshed"
