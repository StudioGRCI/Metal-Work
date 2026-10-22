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
# Sin JIT, como Supabase (`jit = off` en su configuración). Con él, una función
# que el planificador cree de mil filas pasa el umbral y se compila en cada
# lectura: la lista de Tesorería tardaba 3,4 s con 250 OC y 2,6 s eran el JIT.
psql -q -d postgres -c "alter database ${BASE} set jit = off;" >/dev/null

ejecutar() { psql -q -v ON_ERROR_STOP=1 -d "$BASE" -f "$1" >/dev/null; }
# Cada migración en su transacción, como las aplica Supabase: una tabla
# temporal `on commit drop` vive hasta el final del archivo.
migrar() { psql -q -1 -v ON_ERROR_STOP=1 -d "$BASE" -f "$1" >/dev/null; }

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
  migrar "$archivo"
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

# Una cuenta `*.local@metalwork.test` por cada puesto que tiene acceso en
# producción, con la clave local. Son las que usan los `probar-*.mjs` y los
# auditores: probar como ADMIN no prueba nada. `datos-demo.sql` conserva la
# regla de no dar credenciales al personal; esto solo pasa en el banco.
# La supervisión es una por área: si la demostración ya trae la de esa área, a
# esa ficha se le cambia el correo y conserva su historia.
echo "→ una cuenta local por puesto"
psql -q -v ON_ERROR_STOP=1 -v clave="$CLAVE" -v admin="$CORREO" -d "$BASE" >/dev/null <<'SQL'
select set_config('banco.clave', :'clave', false);
select set_config('request.jwt.claim.sub',
  (select id::text from public.usuarios where correo = :'admin'), false);
do $$
declare
  c record;
  v_id uuid;
begin
  for c in select * from (values
    ('gerencia.local@metalwork.test',       'GERENTE',            'GGE', 'Gerencia'),
    ('administracion.local@metalwork.test', 'ADMINISTRACION',     'ADM', 'Administración'),
    ('almacen.local@metalwork.test',        'ALMACENERO',         'ALM', 'Almacén'),
    ('logistica.local@metalwork.test',      'COMPRADOR',          'LOG', 'Logística'),
    ('conductor.local@metalwork.test',      'CONDUCTOR',          'LOG', 'Conductor'),
    ('contabilidad.local@metalwork.test',   'CONTABILIDAD',       null,  'Contabilidad'),
    ('diseno.local@metalwork.test',         'DISENO',             'DIS', 'Diseño'),
    ('colaborador.local@metalwork.test',    'DISENO_COLABORADOR', 'DIS', 'Colaborador de Diseño'),
    ('porteria.local@metalwork.test',       'PORTERO',            'RRH', 'Portería'),
    ('rrhh.local@metalwork.test',           'RECURSOS_HUMANOS',   null,  'Recursos Humanos'),
    ('requerimientos.local@metalwork.test', 'REQUERIMIENTOS',     'REQ', 'Requerimientos'),
    ('sup.prd.local@metalwork.test',        'SUPERVISOR',         'PRD', 'Supervisión de Producción'),
    ('sup.mtz.local@metalwork.test',        'SUPERVISOR',         'MTZ', 'Supervisión de Maestranza'),
    ('sup.acb.local@metalwork.test',        'SUPERVISOR',         'ACB', 'Supervisión de Acabados'),
    ('tesoreria.local@metalwork.test',      'TESORERIA',          null,  'Tesorería'),
    ('ventas.local@metalwork.test',         'VENDEDOR',           'GCO', 'Ventas')
  ) as t(correo, rol, area, nombre)
  loop
    if exists (select 1 from public.usuarios where correo = c.correo) then
      continue;
    end if;
    v_id := null;
    if c.rol = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id
        join public.areas a on a.id = u.area_id
       where u.activo and r.codigo = 'SUPERVISOR' and a.codigo = c.area
       limit 1;
    end if;
    if v_id is not null then
      update auth.users set email = c.correo where id = v_id;
      update public.usuarios set correo = c.correo where id = v_id;
    else
      v_id := gen_random_uuid();
      insert into auth.users (id, email, raw_user_meta_data)
      values (v_id, c.correo, jsonb_build_object('nombres', c.nombre, 'apellidos', 'Banco'));
      insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
      values (v_id, c.nombre, 'Banco', c.correo, c.nombre,
              (select id from public.roles where codigo = c.rol),
              (select id from public.sedes where activo order by creado_en limit 1),
              (select id from public.areas where codigo = c.area));
    end if;
  end loop;

  update auth.users
     set encrypted_password = crypt(current_setting('banco.clave'), gen_salt('bf'))
   where email like '%.local@metalwork.test';

  if (select count(*) from auth.users
       where email like '%.local@metalwork.test' and encrypted_password <> '') < 16 then
    raise exception 'Faltan cuentas locales por puesto.';
  end if;
end $$;
SQL

psql -Atd "$BASE" -c "
  select 'usuarios ' || (select count(*) from public.usuarios)
      || ' | clientes ' || (select count(*) from public.clientes)
      || ' | ordenes ' || (select count(*) from public.ordenes_trabajo)
      || ' | etapas ' || (select count(*) from public.ot_etapas)
      || ' | avances ' || (select count(*) from public.ot_actividad_avances)
      || ' | materiales ' || (select count(*) from public.materiales)"
