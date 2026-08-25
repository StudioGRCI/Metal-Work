#!/usr/bin/env bash
# Genera src/types/database.ts leyendo el catálogo de Postgres.
#
#   ./scripts/generar-tipos.sh                                  # base local de pruebas
#   DB=metalwork_test PGPORT=5433 ./scripts/generar-tipos.sh
#   PGURL="postgresql://postgres:...@db.xxx.supabase.co:5432/postgres" ./scripts/generar-tipos.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -n "${PGURL:-}" ]; then
  CONEXION=("$PGURL")
else
  CONEXION=(-h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d "${DB:-metalwork_test}")
fi

psql "${CONEXION[@]}" -t -A -q -f "$ROOT/db/tools/introspeccion.sql" \
  | node "$ROOT/scripts/generar-tipos.mjs"
