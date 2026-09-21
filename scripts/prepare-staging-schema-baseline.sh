#!/usr/bin/env bash
# Export only the application schema for review before rebuilding Eclipse Staging.
# Run on a machine with Supabase CLI, Docker and access to the production database.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/outside-the-repository/eclipse-public-schema.sql" >&2
  exit 2
fi
if [ -z "${ECLIPSE_PRODUCTION_DB_URL:-}" ]; then
  echo "Set ECLIPSE_PRODUCTION_DB_URL to the percent-encoded production connection URL." >&2
  exit 2
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required." >&2
  exit 2
fi
if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required." >&2
  exit 2
fi

destination="$1"
case "$destination" in
  /*) ;;
  *) echo "Use an absolute output path." >&2; exit 2 ;;
esac
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
parent="$(dirname "$destination")"
if [ ! -d "$parent" ]; then
  echo "Output directory does not exist." >&2
  exit 2
fi
parent="$(cd "$parent" && pwd -P)"
case "$parent/" in
  "$repo_root/"*) echo "Save the schema outside the repository for review." >&2; exit 2 ;;
esac
if [ -e "$destination" ]; then
  echo "Output already exists; refusing to overwrite it." >&2
  exit 2
fi

tmp="$(mktemp "$destination.tmp.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
supabase db dump --db-url "$ECLIPSE_PRODUCTION_DB_URL" --schema public --file "$tmp"
if [ ! -s "$tmp" ]; then
  echo "Schema dump is empty." >&2
  exit 1
fi
# A schema-only export must not contain top-level data operations.
if rg -qi '^(COPY|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)[[:space:]]' "$tmp"; then
  echo "Dump contains a data operation; refusing to keep it." >&2
  exit 1
fi
mv "$tmp" "$destination"
trap - EXIT
chmod 600 "$destination"
echo "Schema-only export ready: $destination"
echo "Public tables: $(rg -c '^CREATE TABLE public\.' "$destination" || true)"
sha256sum "$destination"
