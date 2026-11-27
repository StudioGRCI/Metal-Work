-- De la cotización al cobro (migración 20261126640000, plan 12, entrega 12.3):
-- `codigo_interno_recorrido` elige la cotización y la OT que cuentan la
-- historia de un código, con la regla del costeo. Cada lectura con el puesto
-- que la hace —nunca ADMIN— y `set local role authenticated`. Termina en
-- rollback.
--
-- Los documentos se siembran como quedan en la base, con
-- `session_replication_role = replica`: lo que se prueba es la elección, no el
-- circuito que los crea. Los casos son los que encontró la auditoría:
-- - la OT de garantía, en borrador y más nueva, no ocupa el lugar de la de
--   fabricación, ni le roba su fecha de entrega;
-- - la cotización de una OT anulada no cuenta;
-- - entre dos cotizaciones del código, manda la aprobada aunque sea la vieja;
-- - un código con solo una garantía la muestra, sin cotización;
-- - un código sin unidad devuelve una fila vacía, no un error.
-- Y `codigo_interno_lo_vendido`, lo vendido y lo facturado de cada cotización
-- del código, sin el tope de la bandeja: sin las anuladas y sin mezclar monedas.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v text; v_id uuid;
  v_cli uuid; v_car uuid; v_sede uuid; v_uni uuid; v_uni2 uuid;
  v_cot_a uuid := gen_random_uuid(); v_cot_b uuid := gen_random_uuid(); v_cot_c uuid := gen_random_uuid();
  v_ot_fab uuid; v_ot_gar uuid; v_ot_anulada uuid; v_ot_sola uuid;
begin
  foreach v in array array['GERENTE', 'ADMINISTRACION', 'GERENTE_PRODUCCION', 'VENDEDOR'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(v) || '.481@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    select v_id, v, 'Check 481', lower(v) || '.481@prueba.local', r.id from public.roles r where r.codigo = v;
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  perform test.afirmar(
    (select count(*) = 4 from public.usuarios where apellidos = 'Check 481'),
    'los cuatro puestos de la prueba existen (Gerencia, Administración, Gerencia de Producción y Ventas)');

  set local session_replication_role = replica;

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999472011', 'CLIENTE DE PRUEBA 481 S.A.C.') returning id into v_cli;
  select id into v_car from public.tipos_carroceria order by creado_en limit 1;
  select id into v_sede from public.sedes order by creado_en limit 1;

  -- CHK481: la cotización A, aprobada, vendió la unidad; su OT de fabricación ya se entregó.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK481', 'Prueba') returning id into v_uni;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, registrado_por, creado_en)
  values (v_cot_a, 'CHK481-A', v_cli, v_car, 'a.pdf', 'cot/' || v_cot_a || '/a.pdf', 'APROBADA', current_setting('prueba.vendedor')::uuid, now() - interval '60 days'),
         -- B, más nueva y por revisar, también va por una OT de este código: cuenta, pero no manda.
         (v_cot_b, 'CHK481-B', v_cli, v_car, 'b.pdf', 'cot/' || v_cot_b || '/b.pdf', 'POR_REVISAR', current_setting('prueba.vendedor')::uuid, now() - interval '5 days'),
         -- C va por una OT anulada: no cuenta.
         (v_cot_c, 'CHK481-C', v_cli, v_car, 'c.pdf', 'cot/' || v_cot_c || '/c.pdf', 'APROBADA', current_setting('prueba.vendedor')::uuid, now() - interval '2 days');

  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, tipo_trabajo, cotizacion_pdf_id, creado_en)
  values ('9481-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Fabricación', 'ENTREGADA', 'FABRICACION', v_cot_a, now() - interval '55 days')
  returning id into v_ot_fab;
  insert into public.ot_entregas (numero, orden_id, fecha_entrega, recibe_nombre) values ('CHK481-E1', v_ot_fab, date '2026-11-02', 'Cliente de prueba');
  perform set_config('prueba.ot_fab', v_ot_fab::text, true);

  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, tipo_trabajo, abierta_en_taller, creado_en)
  values ('9482-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Garantía', 'BORRADOR', 'GARANTIA', true, now() - interval '1 day')
  returning id into v_ot_gar;
  insert into public.ot_entregas (numero, orden_id, fecha_entrega, recibe_nombre) values ('CHK481-E2', v_ot_gar, date '2026-11-20', 'No es de la fabricación');

  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, tipo_trabajo, cotizacion_pdf_id, creado_en, motivo_anulacion)
  values ('9483-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Anulada', 'ANULADA', 'FABRICACION', v_cot_c, now(), 'Duplicada')
  returning id into v_ot_anulada;

  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, tipo_trabajo, cotizacion_pdf_id, creado_en)
  values ('9484-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Reproceso por revisar', 'BORRADOR', 'FABRICACION', v_cot_b, now() - interval '4 days');

  -- CHK481G: solo una garantía, sin cotización.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK481G', 'Prueba') returning id into v_uni2;
  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, tipo_trabajo, abierta_en_taller, creado_en)
  values ('9485-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni2, v_sede, 'Garantía sola', 'BORRADOR', 'GARANTIA', true, now())
  returning id into v_ot_sola;
  perform set_config('prueba.ot_sola', v_ot_sola::text, true);

  set local session_replication_role = origin;
end $$;

-- Gerencia lee el recorrido del código.
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente'), true);
set local role authenticated;
do $$
declare r record;
begin
  select * into strict r from public.codigo_interno_recorrido('chk481');
  perform test.afirmar(r.cotizacion_numero = 'CHK481-A' and r.cotizacion_estado = 'APROBADA',
    'manda la cotización aprobada, aunque haya otra más nueva por revisar');
  perform test.afirmar(r.cotizaciones = 2,
    'cuenta dos cotizaciones: la de la OT anulada no entra');
  perform test.afirmar(r.ot_id = current_setting('prueba.ot_fab')::uuid and r.ot_tipo = 'FABRICACION' and r.ot_estado = 'ENTREGADA',
    'la OT es la de fabricación de la cotización, no la garantía más nueva');
  perform test.afirmar(r.ot_entregada_el = date '2026-11-02',
    'la fecha de entrega es el acta de esa OT, no la de la garantía');
  perform test.afirmar(r.ordenes = 3 and r.ot_del_taller = false,
    'tres OT no anuladas, y la elegida no la abrió el taller');

  select * into strict r from public.codigo_interno_recorrido('CHK481G');
  perform test.afirmar(r.cotizacion_id is null and r.cotizaciones = 0,
    'el código con solo una garantía no tiene cotización');
  perform test.afirmar(r.ot_id = current_setting('prueba.ot_sola')::uuid and r.ot_tipo = 'GARANTIA' and r.ot_del_taller and r.ordenes = 1,
    'y muestra su garantía, abierta por el taller');

  select * into strict r from public.codigo_interno_recorrido('NO-EXISTE-481');
  perform test.afirmar(r.cotizacion_id is null and r.ot_id is null and r.cotizaciones = 0 and r.ordenes = 0,
    'un código sin unidad da una fila vacía, no un error');

  perform test.afirmar(not exists (select 1 from public.codigo_interno_recorrido(null) x),
    'sin código no devuelve nada');
end $$;
reset role;

-- Lo vendido y lo facturado, cotización por cotización, para comparar en la cabecera.
-- La A, en soles, lleva una factura por la mitad, otra anulada y otra en dólares.
do $$
begin
  set local session_replication_role = replica;
  update public.cotizaciones_pdf set monto_venta = 10000, moneda = 'PEN' where numero = 'CHK481-A';
  insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision, fecha_vencimiento,
                                     moneda, total, ruta_storage, nombre_archivo, tamano_bytes)
  select 'CHK481', c.id, c.numero, 'CLIENTE DE PRUEBA 481 S.A.C.', x.numero, current_date, current_date + 30,
         x.moneda, x.total, 'f/' || x.numero || '.pdf', x.numero || '.pdf', 1024
    from (values ('CHK481-A', 'E481-1', 'PEN', 5000), ('CHK481-A', 'E481-2', 'PEN', 1000), ('CHK481-A', 'E481-3', 'USD', 500)) x(cot, numero, moneda, total)
    join public.cotizaciones_pdf c on c.numero = x.cot;
  -- Sin disparadores no nace la parte de cada factura (20261126998000): se anota aquí.
  insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
  select f.id, 1, 1, f.codigo_interno, f.total from public.facturas_venta f where f.numero like 'E481-%';
  update public.facturas_venta set anulada_en = now(), anulada_por = current_setting('prueba.gerente')::uuid, motivo_anulacion = 'Mal emitida, con otro monto' where numero = 'E481-2';
  set local session_replication_role = origin;
end $$;

select set_config('request.jwt.claim.sub', current_setting('prueba.gerente'), true);
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select array_agg(numero) = array['CHK481-A'] from public.codigo_interno_lo_vendido('CHK481')),
    'lo vendido trae solo la cotización aprobada del código: ni la que espera revisión ni la de la OT anulada');
  select * into strict r from public.codigo_interno_lo_vendido('CHK481');
  perform test.afirmar(r.monto_venta = 10000 and r.facturas = 2 and r.facturado_en_su_moneda = 5000,
    'la A: 10 000 vendidos, dos facturas vigentes y 5 000 en soles (la anulada no cuenta, la de dólares no suma)');
  perform test.afirmar(r.en_otra_moneda, 'y dice que una va en otra moneda');
end $$;
reset role;

-- Administración consulta los códigos en lectura: ve lo mismo.
select set_config('request.jwt.claim.sub', current_setting('prueba.administracion'), true);
set local role authenticated;
do $$
begin
  perform test.afirmar((select cotizacion_numero = 'CHK481-A' and ot_id = current_setting('prueba.ot_fab')::uuid
                          from public.codigo_interno_recorrido('CHK481')),
    'Administración ve la misma cotización y la misma OT');
end $$;
reset role;

-- Gerencia de Producción no ve códigos internos: la base no le abre el recorrido.
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente_produccion'), true);
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.codigo_interno_recorrido('CHK481')$q$,
  'Gerencia de Producción no lee el recorrido del código');
select test.debe_fallar(
  $q$select * from public.codigo_interno_lo_vendido('CHK481')$q$,
  'ni lo vendido del código');
reset role;

do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.codigo_interno_recorrido(text)', 'execute'),
    'anon no ejecuta codigo_interno_recorrido');
  perform test.afirmar(not has_function_privilege('anon', 'public.codigo_interno_lo_vendido(text)', 'execute'),
    'anon no ejecuta codigo_interno_lo_vendido');
end $$;

rollback;
