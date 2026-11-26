-- Cada compra contra su fecha (migración 20261126200000, Plan 4.1). Con la cuenta
-- de cada puesto —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Logística emite cuatro OC directas y dos OS; Gerencia las aprueba.
--   1. OC «a medias»: prometida hace 5 días, el conductor la deja y Almacén
--      recibe 6 de 10 discos: atrasada, 5 días, faltan 4 discos y nada del perno.
--      Almacén devuelve 1 disco que el proveedor repone: falta 5. Recibe la
--      reposición y los 4 por otro ingreso: completa hoy, llegó con 5 días.
--   2. OC «a tiempo»: prometida en 3 días, sin llegar: no atrasada, 0 días.
--   3. OC «tarde»: prometida hace 2 días, llega completa hoy: no atrasada, 2 días.
--   4. OC anulada, prometida hace 9 días: no se atrasa.
--   5. OS en ejecución con fin hace 4 días: atrasada, 4 días. La OS conforme
--      que debía volver hace 1 día y vuelve hoy: 1 día, no atrasada.
--   6. Lo leen Logística y Gerencia; Ventas no; sin sesión, nadie.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONDUCTOR:LOG', 'ALMACENERO:ALM', 'VENDEDOR:VEN'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 472', lower(replace(v, ':', '.')) || '.472@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 472') = 5,
    'se crearon los cinco usuarios del check, uno por puesto');
  foreach v in array array['oc1', 'oc2', 'oc3', 'oc4', 'os1', 'os2', 'mov1', 'mov3', 'dev', 'rep', 'mov_resto'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select current_setting('prueba.' || p)::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;

-- Armazón, como dueño: dos materiales y un proveedor con un RUC inventado.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK472-1', 'Disco de corte de prueba 472', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.disco', v_m::text, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK472-2', 'Perno de prueba 472', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.perno', v_m::text, true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 472'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(472000, 472200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 472'), true);
end $$;

-- Logística emite: cada OC con su fecha prometida (la que puso al emitir).
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v text;
begin
  perform public.emitir_compra_directa(pg_temp.id('oc1'), pg_temp.id('proveedor'), 'COT-472-1', 'Discos y pernos para el almacén',
    jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('disco'), 'cantidad', 10, 'precio', 8),
                      jsonb_build_object('material_id', pg_temp.id('perno'), 'cantidad', 20, 'precio', 1)),
    pg_temp.hoy() + 10, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  foreach v in array array['oc2', 'oc3', 'oc4'] loop
    perform public.emitir_compra_directa(pg_temp.id(v), pg_temp.id('proveedor'), 'COT-472-' || v, 'Discos para el almacén',
      jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('disco'), 'cantidad', 5, 'precio', 8)),
      pg_temp.hoy() + 3, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  end loop;
  perform public.emitir_orden_servicio(pg_temp.id('os1'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Torneado de ejes, prueba 472', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
  perform public.emitir_orden_servicio(pg_temp.id('os2'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Pintura de la tolva, prueba 472', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 700, 'CONTADO', 0, '025', null);
end $$;
reset role;
set constraints all immediate;
set constraints all deferred;

-- Las fechas pasan: como dueño se corren hacia atrás, como si se hubieran emitido antes.
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 5 where id = pg_temp.id('oc1');
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 2 where id = pg_temp.id('oc3');
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 9 where id = pg_temp.id('oc4');
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 10, fecha_fin = pg_temp.hoy() - 4 where id = pg_temp.id('os1');
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 10, fecha_fin = pg_temp.hoy() - 1 where id = pg_temp.id('os2');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc1'));
select public.aprobar_compra(pg_temp.id('oc2'));
select public.aprobar_compra(pg_temp.id('oc3'));
select public.aprobar_compra(pg_temp.id('oc4'));
select public.anular_orden_compra(pg_temp.id('oc4'), 'El proveedor ya no tiene stock de los discos');
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(pg_temp.id('oc1'), 25, null);
select public.programar_recojo(pg_temp.id('oc3'), 10, null);
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'CONFORME', null);
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(pg_temp.id('oc1'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc1'));
select public.marcar_compra_recogida(pg_temp.id('oc3'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc3'));
reset role;

-- La tercera se dejó ayer: Almacén la valida hoy, y esa demora no es del proveedor.
-- El recojo registrado no se corrige: se corre sin disparadores, como dueño.
set local session_replication_role = replica;
update public.ordenes_compra_materiales
   set recogido_en = now() - interval '1 day', dejado_en = now() - interval '1 day', entregado_almacen_en = now() - interval '1 day'
 where id = pg_temp.id('oc3');
update public.ingresos_pendientes_almacen set dejado_en = now() - interval '1 day' where orden_compra_id = pg_temp.id('oc3');
set local session_replication_role = origin;

-- Dejada y sin validar: no falta nada, está por validar, y todavía no está completa.
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.plazos_de_compras(array[pg_temp.id('oc1')]);
  perform test.afirmar(r.llego_en is not null and r.completa_en is null and r.por_validar
                       and jsonb_array_length(coalesce(r.por_llegar, '[]'::jsonb)) = 0,
    format('la OC dejada y sin validar está por validar, sin nada que falte (por_llegar %s, por_validar %s)', r.por_llegar, r.por_validar));
  perform test.afirmar(r.atrasada, 'la OC dejada sin validar y vencida sigue atrasada hasta que Almacén la valida');
end $$;
reset role;

-- Almacén recibe 6 de 10 discos y nada del perno de la primera; la tercera, entera.
select set_config('prueba.ingresos1', (
  select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', case when i.material_id = pg_temp.id('disco') then pg_temp.id('mov1') end,
                                      'cantidad', case when i.material_id = pg_temp.id('disco') then 6 else 0 end,
                                      'observacion', 'Llegó incompleto, el proveedor manda el resto'))
    from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oc1'))::text, true);
select set_config('prueba.ingresos3', (
  select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', pg_temp.id('mov3'), 'cantidad', i.cantidad))
    from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oc3'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc1'), current_setting('prueba.ingresos1')::jsonb, null);
select public.validar_ingresos_compra(pg_temp.id('oc3'), current_setting('prueba.ingresos3')::jsonb, null);
reset role;

-- ============================================ 1 a 4. Lo que ve Logística
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare r record; v_n integer;
begin
  select * into r from public.plazos_de_compras(array[pg_temp.id('oc1')]);
  perform test.afirmar(r.esperada = pg_temp.hoy() - 5 and r.llego_en is not null and r.completa_en is null,
    'la OC a medias llegó y no está completa');
  perform test.afirmar(r.atrasada and r.dias_atraso = 5, format('la OC a medias está atrasada 5 días (dice %s)', r.dias_atraso));
  perform test.afirmar(jsonb_array_length(r.por_llegar) = 2, 'de la OC a medias faltan dos materiales');
  perform test.afirmar(exists (select 1 from jsonb_array_elements(r.por_llegar) x
                                where x ->> 'material' = 'Disco de corte de prueba 472' and (x ->> 'falta')::numeric = 4
                                  and (x ->> 'pedido')::numeric = 10 and x ->> 'unidad' = 'UND'),
    'faltan 4 de los 10 discos, en UND');
  perform test.afirmar(exists (select 1 from jsonb_array_elements(r.por_llegar) x
                                where x ->> 'material' = 'Perno de prueba 472' and (x ->> 'falta')::numeric = 20),
    'faltan los 20 pernos');

  select * into r from public.plazos_de_compras(array[pg_temp.id('oc2')]);
  perform test.afirmar(not r.atrasada and r.dias_atraso = 0 and r.llego_en is null and r.por_llegar is null,
    'la OC prometida en 3 días no está atrasada y no dice lo que falta antes de llegar');

  select * into r from public.plazos_de_compras(array[pg_temp.id('oc3')]);
  perform test.afirmar(r.completa_en is not null and not r.atrasada and r.dias_atraso = 1 and r.por_llegar is null
                       and not r.por_validar,
    format('la OC dejada ayer y validada hoy llegó con 1 día de atraso, no con 2 (dice %s)', r.dias_atraso));

  select * into r from public.plazos_de_compras(array[pg_temp.id('oc4')]);
  perform test.afirmar(not r.atrasada and r.dias_atraso is null, 'la OC anulada no se atrasa');

  -- El día del taller: a las 11 p. m. de Lima ya son las 4 a. m. del día siguiente en UTC.
  perform test.afirmar(public.fecha_de_lima('2026-11-26 04:00:00+00') = date '2026-11-25'
                       and public.fecha_de_lima('2026-11-26 05:00:00+00') = date '2026-11-26',
    'la fecha de Lima cambia a las 5 a. m. UTC');

  select count(*) into v_n from public.plazos_de_compras(array[]::uuid[]);
  perform test.afirmar(v_n = 0, 'sin OC no devuelve nada');
end $$;
select test.debe_fallar(
  'select * from public.plazos_de_compras(array(select gen_random_uuid() from generate_series(1, 501)))',
  'más de 500 a la vez lo dice', 'hasta 500');

-- La OS
do $$
declare r record;
begin
  select * into r from public.plazos_de_servicios(array[pg_temp.id('os1')]);
  perform test.afirmar(r.atrasada and r.dias_atraso = 4 and r.completa_en is null, 'la OS en ejecución vencida hace 4 días está atrasada');
  select * into r from public.plazos_de_servicios(array[pg_temp.id('os2')]);
  perform test.afirmar(not r.atrasada and r.dias_atraso = 1 and r.completa_en is not null,
    'la OS que volvió conforme hoy, un día tarde, no está atrasada: llegó con 1 día');
  perform test.afirmar(r.atrasada = (select l.atrasada from public.ordenes_servicio_listado() l where l.id = pg_temp.id('os2'))
                   and (select l.atrasada from public.ordenes_servicio_listado() l where l.id = pg_temp.id('os1')),
    'la OS atrasada es la misma que el listado ya marcaba');
end $$;
reset role;

-- Almacén devuelve 1 disco que se repone: la OC vuelve a esperar 5.
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(pg_temp.id('dev'), pg_temp.id('mov1'), 1, 'GR-472', 'Un disco llegó rajado de fábrica', true);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select (x ->> 'falta')::numeric from public.plazos_de_compras(array[pg_temp.id('oc1')]) p,
                            jsonb_array_elements(p.por_llegar) x where x ->> 'material' = 'Disco de corte de prueba 472') = 5,
  'lo devuelto que el proveedor repone vuelve a faltar');
reset role;

-- Llega la reposición y el resto por un ingreso suelto: completa.
select pg_temp.como('almacenero');
set local role authenticated;
select public.recibir_reposicion(pg_temp.id('rep'), pg_temp.id('dev'), 1, 'GR-472-R');
reset role;
insert into public.movimientos_materiales (id, tipo, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
select pg_temp.id('mov_resto'), 'INGRESO', d.id, d.material_id, case when d.material_id = pg_temp.id('disco') then 4 else 20 end,
       'GR-472-2', pg_temp.id('almacenero')
  from public.orden_compra_material_detalles d where d.orden_compra_id = pg_temp.id('oc1') and d.material_id = pg_temp.id('disco');
insert into public.movimientos_materiales (id, tipo, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
select gen_random_uuid(), 'INGRESO', d.id, d.material_id, 20, 'GR-472-2', pg_temp.id('almacenero')
  from public.orden_compra_material_detalles d where d.orden_compra_id = pg_temp.id('oc1') and d.material_id = pg_temp.id('perno');
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.plazos_de_compras(array[pg_temp.id('oc1')]);
  perform test.afirmar(r.completa_en is not null and not r.atrasada and r.dias_atraso = 5 and r.por_llegar is null,
    format('con todo adentro la OC queda completa hoy y llegó con 5 días (dice %s, completa %s)', r.dias_atraso, r.completa_en));
end $$;
reset role;

-- ============================================ 6. Quién lo lee
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.plazos_de_compras(array[pg_temp.id('oc1'), pg_temp.id('oc2')])) = 2,
  'Gerencia, que consulta las compras, lee los plazos');
select test.afirmar((select count(*) from public.plazos_de_servicios(array[pg_temp.id('os1')])) = 1,
  'Gerencia lee el plazo de la OS');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.plazos_de_compras(array[''' || pg_temp.id('oc1') || '''::uuid])',
  'Ventas no lee el plazo de las OC', 'permiso');
select test.debe_fallar('select * from public.plazos_de_servicios(array[''' || pg_temp.id('os1') || '''::uuid])',
  'Ventas no lee el plazo de las OS', 'permiso');
reset role;
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.plazos_de_compras(uuid[])', 'execute')
                   and not has_function_privilege('anon', 'public.plazos_de_servicios(uuid[])', 'execute')
                   and not has_function_privilege('anon', 'public.fecha_de_lima(timestamptz)', 'execute'),
    'sin sesión no se ejecutan');
end $$;

rollback;
