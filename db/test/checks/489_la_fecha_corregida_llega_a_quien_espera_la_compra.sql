-- La fecha corregida llega a quien espera la compra (migración 20261126946000).
-- Logística corrige dos veces la fecha de una OC (de hoy+5 a hoy+9, y después a
-- hoy+12) y una vez la de una OS por aprobar (a hoy+20). Cada puesto ve la
-- última:
--
--   el conductor        en `compras_en_gestion` (no lee la OC)
--   Gerencia            en `documentos_por_aprobar`, la OC y la OS
--   el supervisor       en `seguimiento_de_insumos` (no lee la OC)
--   Almacén y Requerimientos, que sí leen la OC, en el seguimiento mismo, con
--                       su RLS: es lo que leen Atención de RQ y el kardex
--
-- Ventas no ve el seguimiento. La OC sigue con la fecha que salió en el
-- documento. Con la cuenta de cada puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA489', 'Taller prueba de la fecha corregida') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['SUPERVISOR:MTZ:sup', 'REQUERIMIENTOS:REQ:req', 'COMPRADOR:LOG:log', 'CONDUCTOR:LOG:con',
                           'ALMACENERO:ALM:alm', 'GERENTE:GGE:ger', 'VENDEDOR:GCO:ven'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 3), 'Apellido489', split_part(v, ':', 3) || '.489@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA489'));
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
    perform set_config('prueba.area_' || split_part(v, ':', 3), split_part(v, ':', 2), true);
  end loop;
  foreach v in array array['rq', 'oc', 'os'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id from public.areas where codigo = 'MTZ')::text, true);

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK489-PLA', 'Plancha LAF 3 mm (prueba 489)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und);
  perform set_config('prueba.pla', (select id::text from public.materiales where codigo = 'CHK489-PLA'), true);

  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 489'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(489000, 489200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 489'), true);
end $$;

-- El área de cada cuenta, sin el disparador que solo deja cambiarla a Administración.
set local session_replication_role = replica;
update public.usuarios u set area_id = a.id
  from public.areas a
 where u.correo like '%.489@prueba.local'
   and a.codigo = current_setting('prueba.area_' || split_part(u.correo, '.489@', 1));
set local session_replication_role = origin;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;
-- La fecha que vale según el seguimiento que lee quien mira: la última anotada.
create or replace function pg_temp.ultima_corregida(p_oc uuid) returns date language sql as $$
  select s.fecha_nueva from public.seguimiento_de_compras s
   where s.tipo = 'FECHA_ESPERADA' and s.orden_compra_id = p_oc
   order by s.registrado_en desc, s.creado_en desc, s.id desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Requerimientos registra el RQ de Maestranza; la OC que lo atiende se arma sin
-- disparadores, es el armazón: aprobada, por recoger, para hoy+5. La une al RQ
-- su línea (`requerimiento_lineas.orden_compra_id`); `requerimiento_id` es de
-- los requerimientos de material de antes, así que va como directa.
select pg_temp.como('req');
set local role authenticated;
do $$ begin
  perform public.emitir_requerimiento(pg_temp.id('rq'), 'OPERACION', pg_temp.id('area_mtz'), 'PLANTA',
    'Planchas para la mesa de corte', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 4)));
end $$;
reset role;

set local session_replication_role = replica;
insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en,
                                              creado_por, fecha_estimada, recojo, recojo_pedido_en, recojo_pedido_por, origen, motivo)
values (pg_temp.id('oc'), null, 'PROVEEDOR DE PRUEBA 489', 'OC-0489-MW', 'APROBADA', pg_temp.id('ger'), now(),
        pg_temp.id('log'), pg_temp.hoy() + 5, 'POR_RECOGER', now(), pg_temp.id('log'), 'DIRECTA', 'Compra de prueba 489');
update public.requerimiento_lineas set orden_compra_id = pg_temp.id('oc'), atendida_en = now(), atendida_por = pg_temp.id('log')
 where requerimiento_id = pg_temp.id('rq');
set local session_replication_role = origin;

-- Logística emite una OS, que espera a Gerencia, y corrige las dos fechas.
select pg_temp.como('log');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('os'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'MTZ'),
  'PLANTA', 'Doblado de planchas, prueba 489', null, pg_temp.hoy(), pg_temp.hoy() + 6, 'PEN', 800, 'CONTADO', 0, '025', null);
select public.corregir_fecha_esperada(gen_random_uuid(), 'OC', pg_temp.id('oc'), pg_temp.hoy() + 9, 'PROVEEDOR', 'Avisó que no tiene stock');
select public.corregir_fecha_esperada(gen_random_uuid(), 'OC', pg_temp.id('oc'), pg_temp.hoy() + 12, 'PROVEEDOR', 'Volvió a mover la fecha');
select public.corregir_fecha_esperada(gen_random_uuid(), 'OS', pg_temp.id('os'), pg_temp.hoy() + 20, 'PROVEEDOR', 'Tiene la plegadora en mantenimiento');
reset role;

select test.afirmar((select aprobacion from public.ordenes_servicio where id = pg_temp.id('os')) = 'POR_APROBAR',
  'la OS espera a Gerencia');

-- 1. El conductor, que no lee la OC ------------------------------------------------
select pg_temp.como('con');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = pg_temp.id('oc')) = 0,
  'el conductor no lee la OC: la fecha le llega por la lista de recojos');
select test.afirmar((select fecha_estimada from public.compras_en_gestion() where id = pg_temp.id('oc')) = pg_temp.hoy() + 12,
  format('en su lista de recojos, la última fecha corregida (dice %s)',
         (select fecha_estimada from public.compras_en_gestion() where id = pg_temp.id('oc'))));
reset role;

-- 2. Gerencia, en Aprobación ------------------------------------------------------------
select pg_temp.como('ger');
set local role authenticated;
select test.afirmar((select fecha_estimada from public.documentos_por_aprobar() where id = pg_temp.id('oc')) = pg_temp.hoy() + 12,
  'en Aprobación, la OC con su última fecha corregida');
select test.afirmar((select fecha_estimada from public.documentos_por_aprobar() where id = pg_temp.id('os')) = pg_temp.hoy() + 20,
  'y la OS por aprobar con la suya');
reset role;

-- 3. El supervisor, que tampoco lee la OC -------------------------------------------------
select pg_temp.como('sup');
set local role authenticated;
select test.afirmar((select fecha_esperada from public.seguimiento_de_insumos(array[pg_temp.id('rq')])) = pg_temp.hoy() + 12,
  'el supervisor espera su insumo el día de la última fecha corregida');
reset role;

-- 4. Almacén y Requerimientos leen el seguimiento con su RLS ------------------------------
select pg_temp.como('alm');
set local role authenticated;
select test.afirmar(pg_temp.ultima_corregida(pg_temp.id('oc')) = pg_temp.hoy() + 12,
  'Almacén lee la última fecha corregida, la que muestran el kardex y Atención de RQ');
reset role;
select pg_temp.como('req');
set local role authenticated;
select test.afirmar(pg_temp.ultima_corregida(pg_temp.id('oc')) = pg_temp.hoy() + 12,
  'Requerimientos también, en Atención de RQ');
reset role;

-- 5. Quien no debe -------------------------------------------------------------------------
select pg_temp.como('ven');
set local role authenticated;
select test.afirmar((select count(*) from public.seguimiento_de_compras where orden_compra_id = pg_temp.id('oc')) = 0,
  'Ventas no ve el seguimiento de la compra');
select test.debe_fallar($q$select * from public.compras_en_gestion()$q$, 'ni la lista de recojos');
select test.debe_fallar($q$select * from public.documentos_por_aprobar()$q$, 'ni lo que espera aprobación');
reset role;

-- 6. El documento no cambia -----------------------------------------------------------------
select test.afirmar((select fecha_estimada from public.ordenes_compra_materiales where id = pg_temp.id('oc')) = pg_temp.hoy() + 5
                and (select fecha_fin from public.ordenes_servicio where id = pg_temp.id('os')) = pg_temp.hoy() + 6,
  'la OC y la OS siguen con la fecha que salió en el documento');

rollback;
