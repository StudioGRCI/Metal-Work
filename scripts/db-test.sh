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
# Las migraciones van cada una en su transacción, como las aplica Supabase
# (apply_migration y db push): una tabla temporal `on commit drop` vive hasta
# el final del archivo y no muere en la primera sentencia.
migrar() { psql -q -1 -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

echo "→ shim supabase"
run "$ROOT/db/test/00_shim_supabase.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  # La cuenta inicial de Administración (migración 042) necesita una sede.
  # El esquema es local y vacío; se crea aquí antes de que la migración la use.
  if [[ "$(basename "$f")" == "20260101000042_la_cuenta_del_area_de_administracion.sql" ]]; then
    psql -q -v ON_ERROR_STOP=1 -d "$DB" \
      -c "insert into public.sedes (codigo, nombre) values ('QA', 'Taller local de pruebas') on conflict (codigo) do nothing;" >/dev/null
  fi
  echo "→ $(basename "$f")"
  migrar "$f"
done

# Todos los checks corren aunque uno falle: parar en el primero escondía lo que
# decían los demás. El veredicto sigue siendo el código de salida.
fallidos=()
if [ -d "$ROOT/db/test/checks" ]; then
  for f in "$ROOT"/db/test/checks/*.sql; do
    [ -e "$f" ] || continue
    echo "→ check $(basename "$f")"
    run "$f" || fallidos+=("$(basename "$f")")
  done
fi

if [ ${#fallidos[@]} -gt 0 ]; then
  echo "✘ ${#fallidos[@]} check(s) fallan sobre ${DB}:"
  printf '   %s\n' "${fallidos[@]}"
  exit 3
fi
echo "✔ esquema aplicado sin errores sobre ${DB}"
