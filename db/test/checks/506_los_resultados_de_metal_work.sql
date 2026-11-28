-- Los resultados de Metal Work (migración 20261128100000), con el rol real:
-- Gerencia y Contabilidad lo ven; Administración y el almacenero, no. Cada paso
-- con `set local role authenticated`. Termina en rollback.
--
-- Lo que se arma:
--   A. La cotización QA-506-A, de una unidad, en soles: 11 800 con IGV (10 000
--      sin IGV). Su código cuesta S/ 1 000 de horas, más S/ 100 del gasto del
--      mes por horas de este mes (es la única unidad con horas): S/ 1 100.
--      Se factura el 50 % el mes pasado, el otro 50 % este mes y, también este
--      mes, 1 180 de más (un adicional sin cotizar).
--   B. La cotización QA-506-B, de una unidad, en dólares: 1 180 con IGV; se
--      factura entera este mes. Primero sin tipo de cambio; después con 3,50.
--   C. Lo que no es de ninguna carrocería: S/ 50 de horas a PLANTA (gasto
--      operativo), S/ 30 a OFICINA, S/ 20 que siguen en TODOS LOS ACTIVOS y un
--      gasto del mes por horas de S/ 300 el mes pasado, cuando ninguna unidad
--      tenía horas.
--
-- 1. El mes pasado: A lleva 5 000 de ingreso, la mitad de su costo (550) y 4 450
--    de ganancia; los S/ 300 del gasto del mes salen sin repartir.
-- 2. Este mes: A lleva 6 000 de ingreso y la otra mitad del costo (lo facturado
--    de más no lleva costo): 5 450 de ganancia. El gasto del mes de este mes sí
--    se repartió y no sale sin repartir. B, sin cambio, no tiene ganancia y dice
--    cuánto falta pasar; con el cambio, 3 500. El gasto operativo, la oficina y
--    TODOS LOS ACTIVOS salen con su monto.
-- 3. Los dos meses juntos: A, el costo entero una sola vez.
-- 4. Una factura anulada deja de contar.
-- 5. Sin permiso no se ve; el periodo al revés o de más de un año se rechaza; el
--    cálculo interno no lo llama nadie, y el permiso lo tiene algún rol.
-- 6. El sueldo de la oficina del mes pasado, sin horas en ninguna unidad, sale
--    sin repartir (con `null`, `sueldos_oficina_del_mes` solo da los meses con
--    horas: la primera versión nunca lo restaba).
-- 7. C, cotizada en soles (11 800) y facturada en dólares el mes pasado (US$ 1 180
--    al 3,50 = S/ 4 130, el 35 % de la unidad) y en soles este mes (5 900, el
--    50 %): cada mes lleva su parte medida en la moneda de la cotización, y los
--    dos meses suman lo mismo que el periodo de los dos.
-- 8. D, cotizada sin monto: su costo se reparte por lo facturado entre todas sus
--    facturas, no solo las de hasta el periodo: 1 180 el mes pasado (25 %) y
--    3 540 este mes (75 %). Con la primera versión el mes pasado llevaba el 100 %.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000506', 'PRUEBAS 506 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA506', 'Taller prueba de los resultados') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR', 'GERENTE', 'ADMINISTRACION', 'CONTABILIDAD', 'ALMACENERO'] loop
    v_id := test.crear_usuario(initcap(v), 'Check 506', lower(v) || '.506@prueba.local', v, (select id from public.sedes where codigo = 'QA506'));
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  foreach v in array array['cota', 'cotb', 'ota', 'otb', 'fa1', 'fa2', 'fa3', 'fb'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  foreach v in array array['fa1', 'fa2', 'fa3', 'fb'] loop
    perform set_config('prueba.' || v || '_ruta', current_setting('prueba.' || v) || '/' || gen_random_uuid() || '.pdf', true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.mes', (date_trunc('month', now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.pasado', ((date_trunc('month', now() at time zone 'America/Lima') - interval '1 month')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000506', 'QA CLIENTE DE LOS RESULTADOS S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.dia(p_clave text) returns date language sql as $$
  select current_setting('prueba.' || p_clave)::date;
$$;
create or replace function pg_temp.cargar(p_cot text, p_ot text, p_codigo text, p_numero text) returns uuid language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || current_setting('prueba.' || p_ot) || '/orden.pdf', current_setting('prueba.administracion'),
          '{"mimetype": "application/pdf", "size": 100}');
  return public.cargar_codigo_y_ot_de_cotizacion(
    pg_temp.id(p_cot), pg_temp.id(p_ot), p_codigo, p_numero, 'SEMIRREMOLQUE',
    pg_temp.dia('hoy') + 30, 'ot/' || current_setting('prueba.' || p_ot) || '/orden.pdf', 'orden.pdf', 100);
end $$;
create or replace function pg_temp.facturar(p_f text, p_cot text, p_numero text, p_emision date, p_moneda text, p_total numeric)
returns uuid language sql as $$
  select public.registrar_factura_venta_de_unidad(pg_temp.id(p_f), pg_temp.id(p_cot), p_numero,
    p_emision, p_emision + 30, p_moneda, p_total, null, current_setting('prueba.' || p_f || '_ruta'), 'f.pdf', 1);
$$;
-- La fila de un código, o de un tipo y su clave, en un periodo.
create or replace function pg_temp.fila(p_desde date, p_hasta date, p_tipo text, p_clave text)
returns setof record language sql as $$
  select r.facturado_soles, r.facturado_usd_sin_cambio, r.facturas_sin_cambio, r.parte_del_costo, r.costo_del_codigo,
         r.soles, r.ganancia, r.lineas, r.facturas
    from public.resultados_metal_work(p_desde, p_hasta) r
   where r.tipo = p_tipo and r.clave is not distinct from p_clave;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Lo que ya hubiera en la base fuera de este check (empieza vacía, pero así vale en cualquiera).
create temp table antes on commit drop as
  select p.periodo, r.tipo, r.clave, coalesce(r.soles, 0) as soles
    from (values ('pasado'), ('mes')) p(periodo)
    cross join lateral public.resultados_metal_work(pg_temp.dia(p.periodo),
      (pg_temp.dia(p.periodo) + interval '1 month' - interval '1 day')::date) r
   where r.tipo <> 'CODIGO';
grant select on antes to authenticated;
create or replace function pg_temp.antes(p_periodo text, p_tipo text, p_clave text) returns numeric language sql as $$
  select coalesce((select sum(a.soles) from antes a where a.periodo = p_periodo and a.tipo = p_tipo and a.clave is not distinct from p_clave), 0);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ Las dos cotizaciones, aprobadas, con su OT
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cota', 'cotb']) c;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'facturas-venta', current_setting('prueba.' || f || '_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['fa1', 'fa2', 'fa3', 'fb']) f;

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
select pg_temp.id(c), 'QA-506-' || upper(right(c, 1)), pg_temp.id('cliente'), pg_temp.id('carroceria'),
       'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), m, mon::public.moneda, 1
  from (values ('cota', 11800, 'PEN'), ('cotb', 1180, 'USD')) x(c, m, mon);
reset role;
insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por)
values (pg_temp.id('cota'), 1, true, pg_temp.id('vendedor')), (pg_temp.id('cotb'), 1, true, pg_temp.id('vendedor'))
on conflict (cotizacion_id) do update set incluye_igv = excluded.incluye_igv;

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (pg_temp.id('cota'), pg_temp.id('cotb'));
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cota', 'ota', 'qa-506 a', '95061');
select pg_temp.cargar('cotb', 'otb', 'qa-506 b', '95062');
reset role;

-- ============================================ Las facturas, por Contabilidad
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('fa1', 'cota', 'E001-5061', pg_temp.dia('pasado') + 4, 'PEN', 5900);
select pg_temp.facturar('fa2', 'cota', 'E001-5062', pg_temp.dia('hoy'), 'PEN', 5900);
select pg_temp.facturar('fa3', 'cota', 'E001-5063', pg_temp.dia('hoy'), 'PEN', 1180);
select pg_temp.facturar('fb', 'cotb', 'E001-5064', pg_temp.dia('hoy'), 'USD', 1180);
reset role;

-- ============================================ El costo y lo que no es de ninguna carrocería
-- Se siembra directo: lo que se prueba es cómo lo cuenta el reporte, no cómo se
-- registran las horas ni los gastos (sus checks son otros).
set local session_replication_role = replica;
do $$
declare v_trab uuid := gen_random_uuid(); v_ger uuid := pg_temp.id('gerente');
begin
  insert into public.trabajadores (id, nombres, apellidos, dni, area_id)
  values (v_trab, 'OPERARIO', 'DEL CHECK 506', '99950601', (select id from public.areas where codigo = 'PRD'));
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, costo_hora, costo, registrado_por)
  values (v_trab, pg_temp.dia('hoy'), 'QA-506 A', 10, 100, 1000, v_ger),
         (v_trab, pg_temp.dia('hoy'), 'PLANTA', 5, 10, 50, v_ger),
         (v_trab, pg_temp.dia('hoy'), 'OFICINA', 3, 10, 30, v_ger),
         (v_trab, pg_temp.dia('hoy'), 'TODOS LOS ACTIVOS', 2, 10, 20, v_ger);
  insert into public.gastos_generales_mes (id, periodo, concepto, descripcion, monto, moneda, reparto, registrado_por, creado_en)
  values (gen_random_uuid(), pg_temp.dia('pasado'), 'ELECTRICIDAD', 'Luz del mes pasado, check 506', 300, 'PEN', 'HORAS', v_ger,
          (pg_temp.dia('pasado') + 4)::timestamp at time zone 'America/Lima' + interval '10 hours'),
         (gen_random_uuid(), pg_temp.dia('mes'), 'ELECTRICIDAD', 'Luz de este mes, check 506', 100, 'PEN', 'HORAS', v_ger, now());
end $$;
set local session_replication_role = origin;

-- La prueba vale: el mes pasado ninguna unidad tiene horas, y este mes A sí.
select test.afirmar(not exists (select 1 from public.horas_por_codigo_del_mes(pg_temp.dia('pasado')))
  and exists (select 1 from public.horas_por_codigo_del_mes(pg_temp.dia('mes')) h where h.codigo = 'QA-506 A'),
  'el mes pasado no tiene horas en ninguna unidad, y este mes las tiene QA-506 A');
select test.afirmar((select costo_pen from public.codigos_internos_costo_calculado('QA-506 A')) = 1100,
  'el costo de QA-506 A es S/ 1 100: sus horas y el gasto de este mes');

-- ============================================ 1 a 3, con Gerencia y con Contabilidad
do $$
declare
  v_quien text; v record;
  v_pasado date := pg_temp.dia('pasado'); v_fin_pasado date := (pg_temp.dia('mes') - 1);
  v_mes date := pg_temp.dia('mes'); v_fin_mes date := (pg_temp.dia('mes') + interval '1 month' - interval '1 day')::date;
begin
  foreach v_quien in array array['gerente', 'contabilidad'] loop
    perform pg_temp.como(v_quien);
    set local role authenticated;

    -- 1. El mes pasado.
    select * into v from pg_temp.fila(v_pasado, v_fin_pasado, 'CODIGO', 'QA-506 A')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.facturado = 5000 and v.parte = 0.5 and v.costo = 1100 and v.soles = 550 and v.ganancia = 4450 and v.facturas = 1,
      format('%s: el mes pasado, QA-506 A lleva 5 000 sin IGV, la mitad de su costo y 4 450 de ganancia (dice %s, %s, %s, %s)',
             v_quien, v.facturado, v.parte, v.soles, v.ganancia));
    select * into v from pg_temp.fila(v_pasado, v_fin_pasado, 'SIN_REPARTIR', 'GASTOS_DEL_MES')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.soles - pg_temp.antes('pasado', 'SIN_REPARTIR', 'GASTOS_DEL_MES') = 300,
      format('%s: el gasto del mes pasado, sin horas en ninguna unidad, sale sin repartir (dice %s)', v_quien, v.soles));
    perform test.afirmar(not exists (select 1 from public.resultados_metal_work(v_pasado, v_fin_pasado) r where r.clave = 'QA-506 B'),
      v_quien || ': B no se facturó el mes pasado y no aparece');

    -- 2. Este mes.
    select * into v from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 A')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.facturado = 6000 and v.parte = 0.5 and v.soles = 550 and v.ganancia = 5450 and v.facturas = 2,
      format('%s: este mes, QA-506 A lleva 6 000 y la otra mitad del costo; lo facturado de más no lleva costo (dice %s, %s, %s, %s)',
             v_quien, v.facturado, v.parte, v.soles, v.ganancia));
    select * into v from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 B')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.facturado = 0 and v.usd = 1000 and v.sin_cambio = 1 and v.ganancia is null and v.parte = 1,
      format('%s: B en dólares sin cambio no tiene ganancia y dice que faltan US$ 1 000 sin IGV (dice %s, %s, %s)',
             v_quien, v.usd, v.sin_cambio, v.ganancia));
    perform test.afirmar(
      (select coalesce(sum(r.soles), 0) from public.resultados_metal_work(v_mes, v_fin_mes) r where r.tipo = 'GASTO_OPERATIVO' and r.clave is null)
        - pg_temp.antes('mes', 'GASTO_OPERATIVO', null) = 50
      and (select coalesce(sum(r.soles), 0) from public.resultados_metal_work(v_mes, v_fin_mes) r where r.tipo = 'OFICINA' and r.clave = 'MANO_OBRA')
        - pg_temp.antes('mes', 'OFICINA', 'MANO_OBRA') = 30
      and (select coalesce(sum(r.soles), 0) from public.resultados_metal_work(v_mes, v_fin_mes) r where r.tipo = 'SIN_REPARTIR' and r.clave = 'TODOS_LOS_ACTIVOS')
        - pg_temp.antes('mes', 'SIN_REPARTIR', 'TODOS_LOS_ACTIVOS') = 20,
      v_quien || ': este mes salen S/ 50 de gasto operativo (Planta, sin área), S/ 30 de oficina y S/ 20 en TODOS LOS ACTIVOS');
    perform test.afirmar(
      (select coalesce(sum(r.soles), 0) from public.resultados_metal_work(v_mes, v_fin_mes) r where r.tipo = 'SIN_REPARTIR' and r.clave = 'GASTOS_DEL_MES')
        = pg_temp.antes('mes', 'SIN_REPARTIR', 'GASTOS_DEL_MES'),
      v_quien || ': el gasto del mes de este mes ya está en el costo de A y no sale sin repartir');

    -- 3. Los dos meses juntos: el costo entero, una sola vez.
    select * into v from pg_temp.fila(v_pasado, v_fin_mes, 'CODIGO', 'QA-506 A')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.facturado = 11000 and v.parte = 1 and v.soles = 1100 and v.ganancia = 9900 and v.facturas = 3,
      format('%s: los dos meses juntos, A lleva su costo entero una vez (dice %s, %s, %s)', v_quien, v.parte, v.soles, v.ganancia));
    reset role;
  end loop;
end $$;

-- Con el cambio del día, B ya tiene ingreso y ganancia en soles.
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.dia('hoy'), 3.50, 3.55, 'OTRO', pg_temp.id('gerente'))
on conflict (fecha) do update set compra = excluded.compra, venta = excluded.venta;

select pg_temp.como('gerente');
set local role authenticated;
do $$
declare v record; v_mes date := pg_temp.dia('mes'); v_fin_mes date := (pg_temp.dia('mes') + interval '1 month' - interval '1 day')::date;
begin
  select * into v from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 B')
    as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
  perform test.afirmar(v.facturado = 3500 and v.usd = 0 and v.sin_cambio = 0 and v.ganancia = 3500,
    format('con el cambio de compra de 3,50, B lleva S/ 3 500 sin IGV de ingreso y de ganancia (dice %s, %s)', v.facturado, v.ganancia));
end $$;
reset role;

-- ============================================ 4. Una factura anulada deja de contar
update public.facturas_venta set anulada_en = now(), anulada_por = pg_temp.id('contabilidad'), motivo_anulacion = 'Emitida con el monto equivocado, check 506'
 where id = pg_temp.id('fa3');
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record; v_mes date := pg_temp.dia('mes'); v_fin_mes date := (pg_temp.dia('mes') + interval '1 month' - interval '1 day')::date;
begin
  select * into v from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 A')
    as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
  perform test.afirmar(v.facturado = 5000 and v.facturas = 1 and v.ganancia = 4450,
    format('la factura anulada ya no suma (dice %s en %s facturas)', v.facturado, v.facturas));
end $$;
reset role;

-- ============================================ 5. Quién no lo ve, y lo que se rechaza
do $$
declare v_quien text;
begin
  foreach v_quien in array array['administracion', 'almacenero'] loop
    perform pg_temp.como(v_quien);
    set local role authenticated;
    perform test.debe_fallar(format('select * from public.resultados_metal_work(%L, %L)', pg_temp.dia('mes'), pg_temp.dia('hoy')),
      v_quien || ' no ve los resultados', 'No tienes permiso para ver los resultados de Metal Work');
    perform test.debe_fallar('select * from public.resultados_facturas_calculado(null)',
      v_quien || ' no llama el cálculo interno', 'permission denied');
    reset role;
  end loop;

  perform pg_temp.como('gerente');
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.resultados_metal_work(%L, %L)', pg_temp.dia('hoy'), pg_temp.dia('hoy') - 1),
    'el periodo al revés se rechaza', 'termina antes de empezar');
  perform test.debe_fallar(format('select * from public.resultados_metal_work(%L, %L)', pg_temp.dia('hoy') - 400, pg_temp.dia('hoy')),
    'más de un año se rechaza', 'hasta un año a la vez');
  perform test.debe_fallar('select * from public.resultados_metal_work(null, null)', 'sin fechas se pide el periodo', 'Elige el día');
  perform test.debe_fallar('select * from public.resultados_facturas_calculado(null)', 'ni Gerencia llama el cálculo interno', 'permission denied');
  reset role;
end $$;

-- ============================================ 6 a 8: el sueldo sin horas, otra moneda y sin precio
do $$
declare v text; v_id uuid;
begin
  foreach v in array array['cotc', 'cotd', 'otc', 'otd', 'fc1', 'fc2', 'fd1', 'fd2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  foreach v in array array['fc1', 'fc2', 'fd1', 'fd2'] loop
    perform set_config('prueba.' || v || '_ruta', current_setting('prueba.' || v) || '/' || gen_random_uuid() || '.pdf', true);
  end loop;
end $$;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cotc', 'cotd']) c;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'facturas-venta', current_setting('prueba.' || f || '_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['fc1', 'fc2', 'fd1', 'fd2']) f;

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
select pg_temp.id(c), 'QA-506-' || upper(right(c, 1)), pg_temp.id('cliente'), pg_temp.id('carroceria'),
       'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), m, 'PEN', 1
  from (values ('cotc', 11800), ('cotd', null)) x(c, m);
reset role;
insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por)
values (pg_temp.id('cotc'), 1, true, pg_temp.id('vendedor')), (pg_temp.id('cotd'), 1, true, pg_temp.id('vendedor'))
on conflict (cotizacion_id) do update set incluye_igv = excluded.incluye_igv;

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (pg_temp.id('cotc'), pg_temp.id('cotd'));
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cotc', 'otc', 'qa-506 c', '95063');
select pg_temp.cargar('cotd', 'otd', 'qa-506 d', '95064');
reset role;

-- El cambio del día de la factura en dólares del mes pasado.
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.dia('pasado') + 9, 3.50, 3.55, 'OTRO', pg_temp.id('gerente'))
on conflict (fecha) do update set compra = excluded.compra, venta = excluded.venta;

select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('fc1', 'cotc', 'E001-5065', pg_temp.dia('pasado') + 9, 'USD', 1180);
select pg_temp.facturar('fc2', 'cotc', 'E001-5066', pg_temp.dia('hoy'), 'PEN', 5900);
select pg_temp.facturar('fd1', 'cotd', 'E001-5067', pg_temp.dia('pasado') + 4, 'PEN', 1180);
select pg_temp.facturar('fd2', 'cotd', 'E001-5068', pg_temp.dia('hoy'), 'PEN', 3540);
reset role;

-- Las horas de C y de D (para que tengan costo) y un sueldo de la oficina el mes
-- pasado, de alguien de planilla administrativa que no cargó horas.
set local session_replication_role = replica;
do $$
declare v_trab uuid := gen_random_uuid(); v_ofi uuid := gen_random_uuid(); v_ger uuid := pg_temp.id('gerente');
begin
  insert into public.trabajadores (id, nombres, apellidos, dni, area_id)
  values (v_trab, 'OPERARIO', 'DOS DEL CHECK 506', '99950602', (select id from public.areas where codigo = 'PRD'));
  insert into public.trabajadores (id, nombres, apellidos, dni, planilla)
  values (v_ofi, 'ASISTENTE', 'DE OFICINA DEL CHECK 506', '99950603', 'ADMINISTRATIVA');
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, costo_hora, costo, registrado_por)
  values (v_trab, pg_temp.dia('hoy'), 'QA-506 C', 8, 100, 800, v_ger),
         (v_trab, pg_temp.dia('hoy'), 'QA-506 D', 4, 100, 400, v_ger);
  insert into public.oficina_pagos (trabajador_id, desde, hasta, monto, aportes, registrado_por)
  values (v_ofi, pg_temp.dia('pasado'), pg_temp.dia('mes') - 1, 2000, 180, v_ger);
end $$;
set local session_replication_role = origin;

select test.afirmar(not exists (select 1 from public.horas_por_codigo_del_mes(pg_temp.dia('pasado')))
  and (select monto from public.sueldos_oficina_del_mes(pg_temp.dia('pasado'))) >= 2180,
  'la prueba vale: el mes pasado sigue sin horas en ninguna unidad y tiene S/ 2 180 de sueldo de la oficina');

do $$
declare
  v_quien text; v record; w record; t record;
  v_pasado date := pg_temp.dia('pasado'); v_fin_pasado date := (pg_temp.dia('mes') - 1);
  v_mes date := pg_temp.dia('mes'); v_fin_mes date := (pg_temp.dia('mes') + interval '1 month' - interval '1 day')::date;
begin
  foreach v_quien in array array['gerente', 'contabilidad'] loop
    perform pg_temp.como(v_quien);
    set local role authenticated;

    -- 6. El sueldo de la oficina sin horas.
    perform test.afirmar(
      (select coalesce(sum(r.soles), 0) from public.resultados_metal_work(v_pasado, v_fin_pasado) r where r.tipo = 'SIN_REPARTIR' and r.clave = 'SUELDOS_OFICINA')
        - pg_temp.antes('pasado', 'SIN_REPARTIR', 'SUELDOS_OFICINA') = 2180
      and (select r.nombre from public.resultados_metal_work(v_pasado, v_fin_pasado) r where r.tipo = 'SIN_REPARTIR' and r.clave = 'SUELDOS_OFICINA')
        = to_char(v_pasado, 'YYYY-MM'),
      v_quien || ': el sueldo de la oficina del mes pasado, sin horas en ninguna unidad, sale sin repartir con su mes');

    -- 7. Otra moneda que la cotización.
    select * into v from pg_temp.fila(v_pasado, v_fin_pasado, 'CODIGO', 'QA-506 C')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    select * into w from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 C')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    select * into t from pg_temp.fila(v_pasado, v_fin_mes, 'CODIGO', 'QA-506 C')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.facturado = 3500 and v.parte = 0.35 and w.parte = 0.5 and t.parte = 0.85 and v.costo > 0
      and v.soles = round(v.costo * 0.35, 2) and w.soles = round(w.costo * 0.5, 2)
      and abs(v.soles + w.soles - t.soles) <= 0.01
      and not (select r.sin_precio_de_venta from public.resultados_metal_work(v_pasado, v_fin_pasado) r where r.clave = 'QA-506 C'),
      format('%s: C en dólares contra su cotización en soles lleva el 35 %% el mes pasado y el 50 %% este mes, y los meses suman el periodo (dice %s + %s = %s)',
             v_quien, v.parte, w.parte, t.parte));

    -- 8. Sin precio de venta.
    select * into v from pg_temp.fila(v_pasado, v_fin_pasado, 'CODIGO', 'QA-506 D')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    select * into w from pg_temp.fila(v_mes, v_fin_mes, 'CODIGO', 'QA-506 D')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    select * into t from pg_temp.fila(v_pasado, v_fin_mes, 'CODIGO', 'QA-506 D')
      as (facturado numeric, usd numeric, sin_cambio integer, parte numeric, costo numeric, soles numeric, ganancia numeric, lineas integer, facturas integer);
    perform test.afirmar(v.parte = 0.25 and w.parte = 0.75 and t.parte = 1 and v.costo > 0
      and abs(v.soles + w.soles - t.soles) <= 0.01
      and (select r.sin_precio_de_venta from public.resultados_metal_work(v_pasado, v_fin_pasado) r where r.clave = 'QA-506 D'),
      format('%s: D sin precio reparte su costo entre todas sus facturas: 25 %% el mes pasado y 75 %% este (dice %s + %s = %s)',
             v_quien, v.parte, w.parte, t.parte));
    reset role;
  end loop;
end $$;

select test.afirmar(
  not has_function_privilege('anon', 'public.resultados_metal_work(date, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.resultados_facturas_calculado(date)', 'execute')
  and (select count(*) from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
        where rp.permiso_codigo = 'resultados.ver' and r.codigo in ('GERENTE', 'CONTABILIDAD')) = 2
  and not exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
                   where rp.permiso_codigo = 'resultados.ver' and r.codigo not in ('GERENTE', 'CONTABILIDAD')),
  'sin sesión no se llama, el cálculo es interno, y el permiso lo tienen Gerencia y Contabilidad y nadie más');

rollback;
