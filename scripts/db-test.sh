#!/usr/bin/env bash
# Aplica el shim de Supabase y todas las migraciones sobre una base de datos
# limpia, para verificar que el esquema es válido antes de subirlo.
#
#   ./scripts/db-test.sh            # recrea la base y aplica todo
#   PGPORT=5433 ./scripts/db-test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-metalwork_test}"
export PGHOST PGPORT PGUSER

psql -q -d postgres -c "drop database if exists ${DB} with (force);" >/dev/null
psql -q -d postgres -c "create database ${DB};" >/dev/null

run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

echo "→ shim supabase"
run "$ROOT/db/test/00_shim_supabase.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run "$f"
done

if [ -d "$ROOT/db/test/checks" ]; then
  for f in "$ROOT"/db/test/checks/*.sql; do
    [ -e "$f" ] || continue
    echo "→ check $(basename "$f")"
    run "$f"
  done
fi

echo "✔ esquema aplicado sin errores sobre ${DB}"
