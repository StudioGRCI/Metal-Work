#!/usr/bin/env bash
# Rehace desde cero la base local que usa el banco de pruebas: esquema completo,
# empresa, cuenta de administración y datos de demostración.
#
#   ./herramientas/banco/preparar.sh
#
# Variables: BANCO_BASE (mw_demo), BANCO_CORREO, BANCO_CLAVE, PGHOST, PGPORT.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
BASE="${BANCO_BASE:-mw_demo}"
CORREO="${BANCO_CORREO:-studiogrci@gmail.com}"
CLAVE="${BANCO_CLAVE:-Mw-Carroceria-2026!}"

psql -q -d postgres -c "drop database if exists ${BASE} with (force);" >/dev/null
psql -q -d postgres -c "create database ${BASE};" >/dev/null

ejecutar() { psql -q -v ON_ERROR_STOP=1 -d "$BASE" -f "$1" >/dev/null; }

echo "→ esquema de Supabase para pruebas locales"
ejecutar "$RAIZ/db/test/00_shim_supabase.sql"

for archivo in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ $(basename "$archivo")"
  ejecutar "$archivo"
done

echo "→ empresa y cuenta de administración"
psql -q -v ON_ERROR_STOP=1 -d "$BASE" \
     -v correo="$CORREO" -v clave="$CLAVE" >/dev/null <<'SQL'
-- Los parámetros de psql no se sustituyen dentro de un bloque $$, así que la
-- cuenta se crea con instrucciones sueltas y su identificador viaja en una
-- tabla temporal.
with nueva as (
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (gen_random_uuid(), :'correo', crypt(:'clave', gen_salt('bf')),
          jsonb_build_object('nombres', 'Gerencia', 'apellidos', 'Metal Work'))
  returning id
)
select id into temp table _cuenta from nueva;

insert into public.empresa (ruc, razon_social, nombre_comercial, direccion, distrito, provincia, departamento)
values ('20601538840', 'METAL WORK PERU S.A.C.', 'Metal Work Perú',
        'Carretera Industrial s/n', 'Trujillo', 'Trujillo', 'La Libertad');

insert into public.sedes (codigo, nombre) values ('PRIN', 'Planta principal');

insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id)
select (select id from _cuenta), 'Gerencia', 'Metal Work', :'correo', 'Gerencia',
       (select id from public.roles where codigo = 'ADMIN'),
       (select id from public.sedes where codigo = 'PRIN');
SQL

echo "→ datos de demostración"
ejecutar "$RAIZ/db/demo/datos-demo.sql"

psql -Atd "$BASE" -c "
  select 'usuarios ' || (select count(*) from public.usuarios)
      || ' · clientes ' || (select count(*) from public.clientes)
      || ' · órdenes ' || (select count(*) from public.ordenes_trabajo)
      || ' · etapas ' || (select count(*) from public.ot_etapas)
      || ' · partes ' || (select count(*) from public.partes_diarios)
      || ' · materiales ' || (select count(*) from public.materiales)"
