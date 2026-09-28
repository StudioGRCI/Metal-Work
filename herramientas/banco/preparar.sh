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
CLAVE="${BANCO_CLAVE:-}"
if [ -z "$CLAVE" ]; then
  echo "Falta BANCO_CLAVE: es la contraseña de la cuenta de administración local." >&2
  echo "  BANCO_CLAVE='la-que-quieras' ./herramientas/banco/preparar.sh" >&2
  exit 1
fi

psql -q -d postgres -c "drop database if exists ${BASE} with (force);" >/dev/null
psql -q -d postgres -c "create database ${BASE};" >/dev/null

ejecutar() { psql -q -v ON_ERROR_STOP=1 -d "$BASE" -f "$1" >/dev/null; }

echo "→ esquema de Supabase para pruebas locales"
ejecutar "$RAIZ/db/test/00_shim_supabase.sql"

for archivo in "$RAIZ"/supabase/migrations/*.sql; do
  # La cuenta inicial de Administración (migración 042) necesita una sede.
  # El banco parte vacío, así que se agrega un sitio exclusivamente de prueba.
  if [[ "$(basename "$archivo")" == "20260101000042_la_cuenta_del_area_de_administracion.sql" ]]; then
    psql -q -v ON_ERROR_STOP=1 -d "$BASE" \
      -c "insert into public.sedes (codigo, nombre) values ('QA', 'Taller local de pruebas') on conflict (codigo) do nothing;" >/dev/null
  fi
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

# Solo el banco local asigna contraseña a las tres cuentas ficticias de área.
# `datos-demo.sql` conserva la regla de no dar credenciales al personal.
echo "→ accesos locales de supervisión"
psql -q -v ON_ERROR_STOP=1 -v clave="$CLAVE" -d "$BASE" >/dev/null <<'SQL'
update auth.users
   set encrypted_password = crypt(:'clave', gen_salt('bf'))
 where email in (
   'supervisor.prd@metalwork.test',
   'supervisor.mtz@metalwork.test',
   'supervisor.acb@metalwork.test'
 );

select count(*) = 3 as supervisores_listos
  from auth.users
 where email in (
   'supervisor.prd@metalwork.test',
   'supervisor.mtz@metalwork.test',
   'supervisor.acb@metalwork.test'
 ) and encrypted_password <> '';
\gset
\if :supervisores_listos
\else
  \echo "Faltan cuentas locales de supervisión."
  \quit 1
\endif
SQL

psql -Atd "$BASE" -c "
  select 'usuarios ' || (select count(*) from public.usuarios)
      || ' | clientes ' || (select count(*) from public.clientes)
      || ' | ordenes ' || (select count(*) from public.ordenes_trabajo)
      || ' | etapas ' || (select count(*) from public.ot_etapas)
      || ' | avances ' || (select count(*) from public.ot_actividad_avances)
      || ' | materiales ' || (select count(*) from public.materiales)"
