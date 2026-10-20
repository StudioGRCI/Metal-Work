-- El costeo del código interno, completo y con su margen (migración 20261017300000).
-- Al costo del código entran, además de lo de antes: los gastos del mes (con su
-- tasa, o en partes iguales entre los códigos que trabajaron ese mes; PLANTA no
-- recibe), los egresos de caja escritos a mano con el código (no los anulados,
-- ni los ingresos, ni el que deja un pago del sistema) y el recargo de las horas
-- extras que pagó la planilla diaria, repartido por las horas de cada código,
-- los gastos que Administración aprobó en la OT de la unidad y la merma que
-- Diseño evaluó en ella. El presupuesto fijado a mano en la OT manda sobre el
-- de la hoja; sin costo todavía no hay margen ni cierre.
-- Los dólares van a soles al tipo de cambio de Tesorería, y sin cambio no se
-- adivinan. El margen sale de la cotización aprobada sin IGV. Gerencia cierra
-- el costeo solo cuando está completo, y lo reabre con motivo.
-- Cada paso con la cuenta del área que lo hace —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Lo que la base ya tenga cargado «a todos los activos» este mes se repartiría
-- también entre los códigos de esta prueba y movería sus montos: se saca del mes.
update public.movimientos_materiales set registrado_en = registrado_en - interval '50 years'
 where public.normalizar_codigo_interno(codigo_interno) = 'TODOS LOS ACTIVOS';

insert into public.empresa (ruc, razon_social)
select '20100000397', 'PRUEBAS COSTEO S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA97', 'Taller prueba de costeo') on conflict (codigo) do nothing;

select test.crear_usuario('Rosa', 'Humanos', 'rrhh397@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA97')) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia397@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA97')) as gerente_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria397@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA97')) as tesoreria_id \gset
select test.crear_usuario('Mario', 'Maestranza', 'sup.mtz397@demo.pe', 'SUPERVISOR', (select id from public.sedes where codigo = 'QA97')) as sup_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina397@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA97')) as oficina_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas397@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA97')) as vendedor_id \gset
select test.crear_usuario('Sol', 'General', 'sup.general397@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes where codigo = 'QA97')) as general_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req397@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes where codigo = 'QA97')) as req_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin397@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA97')) as admin_id \gset

-- Armazón (ADMIN): el área del supervisor y el cliente de la cotización.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup_id';
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000397', 'QA CLIENTE 397');
select id as cliente_id from public.clientes where numero_documento = '20990000397' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.tesoreria', :'tesoreria_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.general', :'general_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.carroceria', :'carroceria_id', true);
select set_config('prueba.juan', gen_random_uuid()::text, true);
select set_config('prueba.cot', gen_random_uuid()::text, true);
select set_config('prueba.ot', gen_random_uuid()::text, true);
select set_config('prueba.caja', gen_random_uuid()::text, true);
select set_config('prueba.pd', gen_random_uuid()::text, true);
select set_config('prueba.hoy', (now() at time zone 'America/Lima')::date::text, true);
select set_config('prueba.d1', ((now() at time zone 'America/Lima')::date - 1)::text, true);
select set_config('prueba.periodo', date_trunc('month', (now() at time zone 'America/Lima')::date - 1)::date::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

create or replace function pg_temp.costo(p_codigo text) returns jsonb language sql as $$
  select to_jsonb(k) from public.codigos_internos_costo(p_codigo) k where k.codigo = p_codigo;
$$;
create or replace function pg_temp.lineas(p_codigo text, p_fuente text) returns numeric language sql as $$
  select coalesce(sum(l.monto), 0) from public.codigo_interno_costeo(p_codigo) l where l.fuente = p_fuente;
$$;

-- ---------------------------------------------- RR. HH.: Juan, con su remuneración y su costo
-- Remuneración de S/ 2,400 (la hora de la planilla a S/ 10) y costo mensual de
-- S/ 3,600 (la hora del costeo a S/ 15).
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(current_setting('prueba.juan')::uuid, 'Juan', 'Soldador', '70000397', 'Soldador',
         null, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-97', null);
  v := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.juan')::uuid, 2400);
  perform public.rrhh_guardar_costo_trabajador(current_setting('prueba.juan')::uuid, 3600);
  reset role;
end $$;

-- ------------------------------------- Supervisión: 8 h en A y 2 h en B el mismo día (2 extras)
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  v := public.registrar_reporte_diario(gen_random_uuid(), current_setting('prueba.d1')::date, 'CHK397_A_26/01',
         'Tolva de la unidad A', 'Soldadura de la tolva.',
         format('[{"descripcion": "Soldadura", "avance": 40, "personal": [{"trabajador_id": "%s", "horas": 8}]}]',
                current_setting('prueba.juan'))::jsonb, null, null);
  perform set_config('prueba.r1', v::text, true);
  v := public.registrar_reporte_diario(gen_random_uuid(), current_setting('prueba.d1')::date, 'CHK397_B_26/02',
         'Bastidor de la unidad B', 'Armado del bastidor.',
         format('[{"descripcion": "Armado", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 2}]}]',
                current_setting('prueba.juan'))::jsonb, null, null);
  perform set_config('prueba.r2', v::text, true);
  reset role;
end $$;

-- Gerencia y RR. HH. validan; RR. HH. carga 1 h de Juan a PLANTA, paga las extras y manda la planilla.
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r1')::uuid, 'GERENCIA');
  perform public.validar_reporte_diario(current_setting('prueba.r2')::uuid, 'GERENCIA');
  reset role;

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r1')::uuid, 'RRHH');
  perform public.validar_reporte_diario(current_setting('prueba.r2')::uuid, 'RRHH');
  v := public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.juan')::uuid, current_setting('prueba.d1')::date,
                                   'PLANTA', 1, 'Orden de la zona de corte');
  v := public.rrhh_decidir_horas_extras(gen_random_uuid(), current_setting('prueba.juan')::uuid,
                                        current_setting('prueba.d1')::date, 'PAGAR');
  v := public.enviar_planilla_diaria(current_setting('prueba.pd')::uuid);
  reset role;
end $$;

-- ------------------------------------------------ Administración: los gastos del mes
do $$
declare v uuid; v_anulado uuid := gen_random_uuid();
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  -- Gastos registrados antes de la 20261020110000, con tasa o en partes iguales:
  -- la función ya no los registra así, pero los de antes se siguen repartiendo
  -- igual. Entran como entraron entonces, a nombre de Administración.
  insert into public.gastos_generales_mes (id, periodo, concepto, descripcion, monto, moneda, reparto, tasa) values
    (gen_random_uuid(), current_setting('prueba.periodo')::date, 'ELECTRICIDAD', 'Recibo de luz del mes', 1000, 'PEN', 'TASA', 8),
    (gen_random_uuid(), current_setting('prueba.periodo')::date, 'AGUA', 'Recibo de agua del mes', 300, 'PEN', 'PARTES_IGUALES', null),
    (gen_random_uuid(), current_setting('prueba.periodo')::date, 'INTERNET', 'Internet del mes', 100, 'USD', 'TASA', 10),
    (v_anulado, current_setting('prueba.periodo')::date, 'SEGUROS', 'Seguro registrado dos veces', 5000, 'PEN', 'TASA', 5);
  set local role authenticated;
  v := public.anular_gasto_general(v_anulado, 'Se registró dos veces');
  reset role;
end $$;

-- ------------------------------------------------------ Tesorería: la caja diaria
do $$
declare v uuid; v_anulado uuid := gen_random_uuid();
begin
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  v := public.guardar_caja(current_setting('prueba.caja')::uuid, 'Caja chica QA', 'EFECTIVO', null, 'PEN', 2000,
                           current_setting('prueba.d1')::date, true);
  -- Entra: el egreso escrito a mano con el código.
  v := public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date,
                                        'EGRESO', 300, 'Movilidad para el trámite de placas', 'chk397_a_26/01', null, null);
  -- No entran: sin código, un ingreso con código, y un egreso anulado.
  v := public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date,
                                        'EGRESO', 50, 'Útiles de oficina', null, null, null);
  v := public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date,
                                        'INGRESO', 999, 'Devolución del cliente', 'CHK397_A_26/01', null, null);
  v := public.registrar_movimiento_caja(v_anulado, current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date,
                                        'EGRESO', 70, 'Taxi que se registró dos veces', 'CHK397_A_26/01', null, null);
  v := public.anular_movimiento_caja(v_anulado, 'Se registró dos veces el mismo taxi');
  reset role;
end $$;
-- El egreso que deja un pago del sistema (el día en que se conecten) ya está contado en su OS.
insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, codigo_interno, origen, origen_id, registrado_por)
values (current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date, 'EGRESO', 500, 'Pago de la OS de pintura',
        'CHK397_A_26/01', 'PAGO_ORDEN_SERVICIO', gen_random_uuid(), current_setting('prueba.tesoreria')::uuid);

-- --------------------------------- Ventas y Gerencia: la cotización en dólares, aprobada con el código
do $$
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot')::uuid, 'QA-397', current_setting('prueba.cliente')::uuid,
          current_setting('prueba.carroceria')::uuid, 'QA-397.pdf', 'cot/' || current_setting('prueba.cot') || '/QA-397.pdf',
          'application/pdf', 120, current_setting('prueba.vendedor')::uuid, 11800, 'USD');
  perform public.confirmar_igv_cotizacion(current_setting('prueba.cot')::uuid, true);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.aprobar_cotizacion_con_ot(
    current_setting('prueba.cot')::uuid, current_setting('prueba.ot')::uuid, 'CHK397_A_26/01', '397-2099',
    'SEMIRREMOLQUE', current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot') || '/orden.pdf',
    'orden.pdf', 100);
  reset role;
end $$;

-- ============================================ 1. Sin tipo de cambio, los dólares no se adivinan
do $$
declare k jsonb;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'mano_obra')::numeric = 120, 'la mano de obra de A: 8 h × S/ 15 = 120, salió ' || (k->>'mano_obra'));
  perform test.afirmar((k->>'recargo_extras')::numeric = 4,
    'el recargo de las 2 extras (2 h × S/ 10 × 25 % = 5) va 8/10 a A: 4, salió ' || (k->>'recargo_extras'));
  perform test.afirmar((pg_temp.costo('CHK397_B_26/02')->>'recargo_extras')::numeric = 1, 'y 2/10 a B: 1');
  perform test.afirmar((k->>'caja_pen')::numeric = 300 and (k->>'egresos_caja')::integer = 1,
    'de la caja entra solo el egreso a mano con el código (sin el ingreso, el anulado ni el pago de la OS): 300');
  perform test.afirmar((k->>'gastos_mes_usd')::numeric = 10, 'el internet en dólares: 10 % de 100 = US$ 10');
  perform test.afirmar((k->>'usd_sin_cambio')::numeric = 10 and (k->>'lineas_sin_cambio')::integer = 1,
    'sin tipo de cambio, los US$ 10 se cuentan aparte y no suman');
  perform test.afirmar((k->>'precio_neto_pen') is null and (k->>'venta_sin_cambio')::integer = 1 and (k->>'margen_pct') is null,
    'sin tipo de cambio no hay precio en soles ni margen');
  perform test.afirmar((k->>'cotizaciones')::integer = 1 and k->>'moneda_venta' = 'USD' and (k->>'precio_venta_usd')::numeric = 11800,
    'la cotización aprobada del código, en dólares');
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'Unidad entregada al cliente'),
    'no se cierra con dólares sin cambio', 'sin tipo de cambio');
  reset role;
end $$;

-- Tesorería carga el tipo de cambio del primer día del mes y de hoy.
do $$
begin
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  insert into public.tipos_de_cambio (fecha, compra, venta)
  select f, 3.70, 3.75 from unnest(array[current_setting('prueba.periodo')::date, current_setting('prueba.hoy')::date]) f
  on conflict (fecha) do nothing;
  reset role;
end $$;

-- ============================================ 2. El costo completo y el margen
do $$
declare k jsonb; v_agua numeric; v_luz numeric; v_suma_agua numeric; v_partes integer; v_esperado numeric;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  v_luz := pg_temp.lineas('CHK397_A_26/01', 'GASTOS_DEL_MES');
  select coalesce(sum(l.monto) filter (where l.concepto like 'Agua%'), 0) into v_agua
    from public.codigo_interno_costeo('CHK397_A_26/01') l where l.fuente = 'GASTOS_DEL_MES';
  -- Cada parte se redondea al céntimo: entre muchos códigos, el total se aparta medio céntimo por parte.
  select coalesce(sum(l.monto), 0), count(*) into v_suma_agua, v_partes
    from public.codigo_interno_costeo(null) l where l.fuente = 'GASTOS_DEL_MES' and l.concepto like 'Agua%';
  perform test.afirmar(abs(v_suma_agua - 300) <= v_partes * 0.005, 'el agua en partes iguales se reparte entera: 300, salió ' || v_suma_agua);
  perform test.afirmar(v_agua = (select sum(l.monto) from public.codigo_interno_costeo('CHK397_B_26/02') l
                                  where l.fuente = 'GASTOS_DEL_MES' and l.concepto like 'Agua%'),
    'A y B, que trabajaron ese mes, llevan la misma parte del agua');
  perform test.afirmar(not exists (select 1 from public.codigo_interno_costeo('PLANTA') l where l.fuente = 'GASTOS_DEL_MES'),
    'PLANTA no recibe gastos del mes');
  perform test.afirmar(pg_temp.lineas('PLANTA', 'MANO_OBRA') = 15, 'aunque sí lleva su hora de mano de obra');
  perform test.afirmar((k->>'gastos_mes_pen')::numeric = 80 + v_agua,
    'A lleva la luz al 8 % (80) y su parte del agua, sin el seguro anulado; salió ' || (k->>'gastos_mes_pen'));
  -- 120 de mano de obra + 4 de recargo + 80 de luz + el agua + 37.50 del internet + 300 de caja.
  v_esperado := 120 + 4 + 80 + v_agua + 37.50 + 300;
  perform test.afirmar((k->>'costo_pen')::numeric = v_esperado,
    format('el costo de A en soles: %s, salió %s', v_esperado, k->>'costo_pen'));
  perform test.afirmar((k->>'lineas_sin_cambio')::integer = 0, 'con el cambio cargado, nada queda sin convertir');
  perform test.afirmar((k->>'usd_al_cambio')::numeric = 10 and (k->>'usd_en_soles')::numeric = 37.50,
    'los dólares que pasan a soles se ven aparte (US$ 10 = S/ 37.50), para que las partes cuadren con el total');
  perform test.afirmar((k->>'entregada_el') is null, 'sin acta de entrega en su OT, no hay fecha de entrega');
  perform test.afirmar((k->>'precio_neto_pen')::numeric = 37000,
    'el precio: US$ 11,800 con IGV = US$ 10,000 sin IGV × 3.70 (compra) = S/ 37,000; salió ' || (k->>'precio_neto_pen'));
  perform test.afirmar((k->>'margen_pen')::numeric = 37000 - v_esperado
                       and (k->>'margen_pct')::numeric = round((37000 - v_esperado) / 37000 * 100, 1),
    'el margen: el precio sin IGV menos el costo');
  perform test.afirmar((k->>'presupuesto_pen')::numeric = round(37000 / 1.15, 2) and k->>'semaforo' = 'EN_RANGO',
    'el presupuesto de la hoja (precio sin IGV ÷ 1.15) y su semáforo');
  -- El detalle de Gerencia lista lo mismo que suma.
  perform test.afirmar(pg_temp.lineas('CHK397_A_26/01', 'CAJA') = 300 and pg_temp.lineas('CHK397_A_26/01', 'RECARGO_EXTRAS') = 4,
    'el costeo del código muestra la caja y el recargo');
  -- El resumen de la lista no cambia lo que ya decía.
  perform test.afirmar((select r.mano_obra from public.codigos_internos_resumen() r where r.codigo = 'CHK397_A_26/01') = 120,
    'la mano de obra del resumen sigue siendo la del tareo');
  reset role;
end $$;

-- ============================================ 2b. Los gastos aprobados en la OT de la unidad
-- Lo que Administración aprobó en la pestaña Costos de la OT (un trámite de
-- S/ 450) entra al código; el pendiente, no. Se arma como ADMIN porque aquí se
-- prueba el costeo, no el registro del gasto (eso es del check del expediente).
select test.como_usuario(:'admin_id');
select set_config('prueba.gasto_ot', gen_random_uuid()::text, true);
select set_config('prueba.gasto_ot_pend', gen_random_uuid()::text, true);
select set_config('prueba.costo_antes', (select (x.costo_pen)::text from public.codigos_internos_costo_calculado('CHK397_A_26/01') x), true);
insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre,
                                    estado, registrado_por, revisado_por, revisado_en)
select g.id, current_setting('prueba.ot')::uuid, (select id from public.areas where codigo = 'ADM'), g.tipo, g.descripcion,
       current_setting('prueba.d1')::date, g.monto, 'PEN',
       'ot/' || current_setting('prueba.ot') || '/gastos/' || g.id || '.pdf', 'gasto.pdf', g.estado,
       :'oficina_id', case when g.estado = 'APROBADO' then :'oficina_id'::uuid end, case when g.estado = 'APROBADO' then now() end
  from (values (current_setting('prueba.gasto_ot')::uuid, 'TRAMITE', 'Trámite de placas de la unidad A', 450, 'APROBADO'),
               (current_setting('prueba.gasto_ot_pend')::uuid, 'COMISION', 'Comisión que todavía no se aprueba', 999, 'PENDIENTE')) g(id, tipo, descripcion, monto, estado);

do $$
declare k jsonb;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'gastos_ot_pen')::numeric = 450 and (k->>'costo_pen')::numeric = current_setting('prueba.costo_antes')::numeric + 450,
    'el trámite aprobado en la OT suma al código (450) y el pendiente no; salió ' || (k->>'gastos_ot_pen'));
  perform test.afirmar(pg_temp.lineas('CHK397_A_26/01', 'GASTOS_OT') = 450, 'y el costeo de Gerencia lo lista');
  reset role;
end $$;

-- ============================================ 2c. El IGV es el de la versión que se cobra
-- Ventas corrige la cotización (versión 2, por revisar) sin confirmar el IGV:
-- el código no adivina el precio. Al confirmarlo, vuelve el margen.
do $$
declare k jsonb;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || id || '/QA-397-v2.pdf', nombre_archivo = 'QA-397-v2.pdf', monto_venta = 23600,
         motivo_correccion = 'El cliente pidió otra tolva'
   where id = current_setting('prueba.cot')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'precio_neto_pen') is null and (k->>'margen_pct') is null and (k->>'venta_sin_igv_confirmado')::integer = 1,
    'una corrección sin su IGV confirmado no tiene precio ni margen (como margen_ot); salió ' || coalesce(k->>'precio_neto_pen', 'nada'));
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'Unidad entregada al cliente'),
    'y no se cierra así: el cierre quedaría congelado sin margen', 'incluye IGV');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform public.confirmar_igv_cotizacion(current_setting('prueba.cot')::uuid, true);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'precio_neto_pen')::numeric = 74000,
    'confirmado el IGV de la versión 2: US$ 23,600 con IGV = US$ 20,000 × 3.70 = S/ 74,000; salió ' || (k->>'precio_neto_pen'));
  reset role;
end $$;

-- ============================================ 2d. La merma, el presupuesto fijado y la caja en dólares
-- Almacén saca 10 planchas de S/ 20 al código A (se arma como dueño: lo que se
-- prueba es el costeo, no la salida) y Diseño evalúa la merma de su OT en 5 %.
select test.crear_usuario('Dina', 'Diseño', 'diseno397@demo.pe', 'DISENO', (select id from public.sedes where codigo = 'QA97')) as diseno_id \gset
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.costo_antes', (select (x.costo_pen)::text from public.codigos_internos_costo_calculado('CHK397_A_26/01') x), true);
do $$
declare
  v_m uuid;
  v_cat uuid := (select id from public.categorias_material order by 1 limit 1);
  v_um  uuid := (select id from public.unidades_medida order by 1 limit 1);
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK397-1', 'Plancha de prueba 397', v_cat, v_um) returning id into v_m;
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m, 20, 'INGRESO_GENERAL', 'Compra en tienda', current_setting('prueba.oficina')::uuid,
          20, 'PEN', now() - interval '3 days');
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (gen_random_uuid(), 'SALIDA', v_m, 10, 'SALIDA_GENERAL', 'Para la tolva', current_setting('prueba.oficina')::uuid,
          'Área de Maestranza', 'CHK397_A_26/01', 'CHK397_A_26/01', 10);
end $$;

do $$
declare k jsonb; v uuid;
begin
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  set local role authenticated;
  v := public.fijar_merma_ot(current_setting('prueba.ot')::uuid, 5, 'Cortes de la tolva evaluados en planta');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'merma_pen')::numeric = 10 and pg_temp.lineas('CHK397_A_26/01', 'MERMA') = 10,
    'la merma de la OT va sobre los materiales del código: 5 % de S/ 200 = 10; salió ' || (k->>'merma_pen'));
  perform test.afirmar((k->>'costo_pen')::numeric = current_setting('prueba.costo_antes')::numeric + 200 + 10,
    'el costo suma las planchas (200) y su merma (10)');
  perform test.afirmar(not (k->>'presupuesto_fijado')::boolean and (k->>'presupuesto_pen')::numeric = round(74000 / 1.15, 2),
    'sin presupuesto fijado, el de la hoja');

  -- Gerencia fija a mano el presupuesto de la OT: manda sobre el de la hoja.
  perform public.fijar_presupuesto_ot(current_setting('prueba.ot')::uuid, 1000, 'Presupuesto acordado en la reunión de obra');
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'presupuesto_fijado')::boolean and (k->>'presupuesto_pen')::numeric = 1000 and k->>'semaforo' = 'EXCEDIDO'
                       and (k->>'consumido_pct')::numeric = round((k->>'costo_pen')::numeric / 1000 * 100, 1),
    'el presupuesto fijado en la OT es el del código, con su semáforo: ' || coalesce(k->>'semaforo', 'nada'));
  perform public.fijar_presupuesto_ot(current_setting('prueba.ot')::uuid, null, null);
  perform test.afirmar(not (pg_temp.costo('CHK397_A_26/01')->>'presupuesto_fijado')::boolean,
    'y al devolverlo a la cotización vuelve el de la hoja');
  reset role;

  -- Tesorería paga US$ 50 de una cuenta en dólares al cambio pactado de 3.80: entran S/ 190, no al cambio del día.
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform set_config('prueba.caja_usd', gen_random_uuid()::text, true);
  v := public.guardar_caja(current_setting('prueba.caja_usd')::uuid, 'Cuenta en dólares QA', 'BANCO', 'BCP', 'USD', 500,
                           current_setting('prueba.d1')::date, true);
  v := public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.caja_usd')::uuid, current_setting('prueba.d1')::date,
                                        'EGRESO', 50, 'Repuesto importado de la unidad B', 'CHK397_B_26/02', null, 3.80);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_B_26/02');
  perform test.afirmar((k->>'caja_pen')::numeric = 190 and (k->>'caja_usd')::numeric = 0,
    'el egreso en dólares con su propio cambio entra en soles a ese cambio: 190; salió ' || (k->>'caja_pen') || ' y US$ ' || (k->>'caja_usd'));
  reset role;
end $$;

-- ============================================ 2e. Sin costo no hay margen ni cierre
-- Una cotización aprobada hoy con un código nuevo: todavía no cuesta nada.
select set_config('prueba.cot_c', gen_random_uuid()::text, true);
select set_config('prueba.ot_c', gen_random_uuid()::text, true);
do $$
declare k jsonb;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot_c')::uuid, 'QA-397C', current_setting('prueba.cliente')::uuid,
          current_setting('prueba.carroceria')::uuid, 'QA-397C.pdf', 'cot/' || current_setting('prueba.cot_c') || '/QA-397C.pdf',
          'application/pdf', 120, current_setting('prueba.vendedor')::uuid, 59000, 'PEN');
  perform public.confirmar_igv_cotizacion(current_setting('prueba.cot_c')::uuid, true);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  -- Desde la migración 20261020150000 el correlativo de la OT es global y no
  -- se reinicia cada año: la segunda OT del check lleva otro correlativo.
  perform public.aprobar_cotizacion_con_ot(
    current_setting('prueba.cot_c')::uuid, current_setting('prueba.ot_c')::uuid, 'CHK397_C_26/03', '3972-2098',
    'SEMIRREMOLQUE', current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot_c') || '/orden.pdf',
    'orden.pdf', 100);
  k := pg_temp.costo('CHK397_C_26/03');
  perform test.afirmar((k->>'precio_neto_pen')::numeric = 50000 and (k->>'costo_pen')::numeric = 0,
    'el código nuevo tiene precio (S/ 59,000 con IGV = 50,000) y nada de costo');
  perform test.afirmar((k->>'margen_pct') is null and (k->>'margen_pen') is null,
    'sin costo todavía no hay margen (saldría 100 %); salió ' || coalesce(k->>'margen_pct', 'nada'));
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_C_26/03', 'Unidad entregada al cliente'),
    'ni se cierra un costeo sin costo', 'no tiene costo cargado');
  reset role;
end $$;

-- ============================================ 3. Quién lo ve
do $$
declare k jsonb;
begin
  -- Administración (ve el costo de las OT y el precio): para su Dashboard.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar(k is not null and (k->>'margen_pct') is not null, 'Administración ve el costo y el margen del código');
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'Unidad entregada al cliente'),
    'Administración no cierra el costeo', 'codigos_internos.cerrar');
  -- Desde el 2026-10-19 (migración 20261017400000) lee el detalle, en lectura.
  perform test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK397_A_26/01')),
    'y lee el detalle línea por línea, como Gerencia');
  reset role;

  -- Supervisión general ve el costo, no el precio.
  perform test.como_usuario(current_setting('prueba.general')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar(k is not null and (k->>'costo_pen')::numeric > 0, 'quien ve el costo de las OT ve el del código');
  perform test.afirmar((k->>'precio_neto_pen') is null and (k->>'margen_pct') is null and (k->>'semaforo') is null,
    'pero sin el precio de venta no ve el precio, el margen ni el presupuesto');
  reset role;

  -- Tesorería y Requerimientos no lo leen.
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.codigos_internos_costo()', 'Tesorería no lee el costo de los códigos', 'costos.ver');
  reset role;
  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.codigos_internos_costo()', 'Requerimientos no lee el costo completo', 'costos.ver');
  perform test.afirmar(not exists (select 1 from public.codigo_interno_gasto('CHK397_A_26/01') l
                                    where l.fuente in ('CAJA', 'GASTOS_DEL_MES', 'RECARGO_EXTRAS', 'GASTOS_OT', 'MERMA')),
    'su gasto por código sigue sin la caja, los gastos del mes, el recargo, los gastos de la OT ni la merma');
  perform test.afirmar(not exists (select 1 from public.codigos_internos_gasto() g where g.codigo = 'PLANTA'
                                    and g.salidas = 0 and g.requerimientos = 0 and g.compras = 0),
    'ni le aparecen códigos que solo tienen horas');
  reset role;
end $$;

-- ============================================ 4. El cierre
-- Con horas en el mes en curso no se cierra: los gastos del mes y la oficina se
-- reparten por las horas de todo el mes (migración 20261020110000). Para cerrar,
-- sus horas pasan al mes anterior, como si ese mes ya hubiera terminado.
do $$
begin
  if exists (select 1 from public.horas_por_codigo_del_mes((now() at time zone 'America/Lima')::date) h where h.codigo = 'CHK397_A_26/01') then
    perform test.como_usuario(current_setting('prueba.gerente')::uuid);
    set local role authenticated;
    perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'Unidad entregada al cliente con su acta'),
      'con horas en el mes en curso no se cierra hasta que el mes termine', 'que termine el mes');
    reset role;
  end if;
  set local session_replication_role = replica;
  update public.tareos set fecha = fecha - interval '1 month'
   where public.normalizar_codigo_interno(codigo_interno) = 'CHK397_A_26/01'
     and date_trunc('month', fecha) = date_trunc('month', now() at time zone 'America/Lima');
  update public.reporte_diario_personal l set fecha = l.fecha - interval '1 month'
    from public.reportes_diarios r
   where r.id = l.reporte_id and public.normalizar_codigo_interno(r.codigo_interno) = 'CHK397_A_26/01'
     and date_trunc('month', l.fecha) = date_trunc('month', now() at time zone 'America/Lima');
  set local session_replication_role = origin;
end $$;

do $$
declare v uuid; v2 uuid; k jsonb;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L)', 'PLANTA'), 'PLANTA no se cierra', 'PLANTA');
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L)', 'CHK397_A_26/01'),
    'no se cierra sin decir cómo se entregó la unidad', 'cómo y cuándo');
  perform test.debe_fallar(format('select public.cerrar_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'Listo'),
    'ni con una observación de 5 letras', 'cómo y cuándo');
  v := public.cerrar_costeo_codigo('CHK397_A_26/01', 'Unidad entregada al cliente con su acta');
  v2 := public.cerrar_costeo_codigo('CHK397_A_26/01', 'Unidad entregada al cliente con su acta');
  perform test.afirmar(v = v2, 'un reintento devuelve el mismo cierre');
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'cierre_id')::uuid = v and (k->>'costo_cerrado_pen')::numeric = (k->>'costo_pen')::numeric
                       and (k->>'margen_cerrado_pct')::numeric = (k->>'margen_pct')::numeric and k->>'cerrado_por' is not null,
    'el cierre congela el costo y el margen, con el puesto que lo cerró');
  perform test.debe_fallar(format('insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente) values (%L, 0, %L)',
                                  'CHK397_B_26/02', '{}'),
    'nadie escribe un cierre a mano', 'permission denied');
  reset role;

  -- Llega un gasto después del cierre: el costo se mueve, lo cerrado no.
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  v2 := public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.caja')::uuid, current_setting('prueba.d1')::date,
                                         'EGRESO', 100, 'Flete tardío de la unidad', 'CHK397_A_26/01', null, null);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  k := pg_temp.costo('CHK397_A_26/01');
  perform test.afirmar((k->>'costo_pen')::numeric = (k->>'costo_cerrado_pen')::numeric + 100,
    'lo que llega después se ve como diferencia contra lo cerrado');
  perform test.debe_fallar(format('select public.reabrir_costeo_codigo(%L, %L)', 'CHK397_A_26/01', 'corto'),
    'se reabre solo con motivo', '10 a 500');
  v2 := public.reabrir_costeo_codigo('CHK397_A_26/01', 'Llegó el flete tardío de la unidad');
  perform test.afirmar(v2 = v and (pg_temp.costo('CHK397_A_26/01')->>'cierre_id') is null, 'reabierto, ya no tiene cierre vigente');
  perform test.afirmar((select count(*) from public.codigo_interno_cierres where codigo = 'CHK397_A_26/01') = 1,
    'el cierre reabierto queda como evidencia');
  v2 := public.cerrar_costeo_codigo('CHK397_A_26/01', 'Cerrado con el flete');
  perform test.afirmar(v2 <> v and (pg_temp.costo('CHK397_A_26/01')->>'costo_cerrado_pen')::numeric
                                   = (pg_temp.costo('CHK397_A_26/01')->>'costo_pen')::numeric,
    'y se vuelve a cerrar con el costo de ahora');
  reset role;

  -- El cierre guarda el precio y el margen: el Supervisor General ve el costo
  -- (costos.ver) pero no el precio de venta, así que no lee la tabla. Tampoco por
  -- la auditoría, que él lee (auditoria.ver) y que copiaría la fila entera.
  perform test.afirmar(not exists (select 1 from public.audit_log where tabla = 'codigo_interno_cierres'),
    'el cierre no se copia a la auditoría, que se lee sin el precio de venta');
  perform test.como_usuario(current_setting('prueba.general')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.codigo_interno_cierres) = 0,
    'quien ve el costo sin el precio de venta no lee los cierres, que guardan el margen');
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'codigo_interno_cierres') = 0,
    'ni los lee por la auditoría');
  perform test.afirmar((pg_temp.costo('CHK397_A_26/01')->>'margen_cerrado_pct') is null
                       and (pg_temp.costo('CHK397_A_26/01')->>'costo_cerrado_pen') is not null,
    'y por la función ve el costo cerrado sin el margen');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.codigo_interno_cierres where codigo = 'CHK397_A_26/01') = 2,
    'Administración, que ve el costo y el precio, sí lee los cierres');
  reset role;
end $$;

-- ============================================ 5. Puertas
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.codigos_internos_costo(text)', 'execute'),
    'anon no llama al costo');
  perform test.afirmar(not has_function_privilege('authenticated', 'public.codigos_internos_costo_calculado(text)', 'execute')
                       and not has_function_privilege('authenticated', 'public.codigo_interno_lineas_caja(text)', 'execute')
                       and not has_function_privilege('authenticated', 'public.codigo_interno_lineas_recargo(text)', 'execute')
                       and not has_function_privilege('authenticated', 'public.codigo_interno_lineas_gastos_ot(text)', 'execute'),
    'las funciones internas, sin permiso, no las llama nadie desde fuera');
end $$;

rollback;
