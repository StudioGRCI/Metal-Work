-- Lo que Gerencia ya decidió (migración 20261126460000, plan 12, entrega 12.2):
-- `decisiones_tomadas` reúne lo que el puesto de quien pregunta aprobó, devolvió,
-- anuló, dio por visto o cerró en el periodo, de las columnas de cada documento
-- y de la bitácora de la OT. Cada lectura con el puesto que la hace —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Los documentos se siembran ya decididos con `session_replication_role =
-- replica`, como quedan en la base: lo que se prueba es la lectura, no el
-- circuito de cada aprobación (eso lo prueba el check de cada pantalla). Las
-- formas sembradas son las que dejan los caminos reales: el reporte observado
-- guarda en `observacion_area` quién observó, no por qué; la versión aprobada
-- que Ventas corrige se archiva con «Corrección: …»; y la OT anulada estando
-- pausada se anota en su bitácora como REANUDACION.
--
-- Dos casos pasan por los disparadores de verdad, sin `replica`, porque lo que
-- se lee es lo que ellos dejan en `audit_log`: la cotización que Gerencia
-- devuelve y después anula (la anulación escribe su motivo encima de la
-- observación), y la OC aprobada que sube de monto y vuelve a pedir aprobación.
--
-- Las horas se cuentan desde las 10 de la mañana de hoy, si todavía no son:
-- el día 1 de madrugada, «hace 9 horas» caía en el mes anterior.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v text; v_id uuid;
  v_cli uuid; v_car uuid; v_prov uuid; v_sede uuid; v_uni uuid; v_ot uuid; v_flota uuid;
  v_cot1 uuid := gen_random_uuid(); v_cot2 uuid := gen_random_uuid(); v_cot3 uuid := gen_random_uuid(); v_cot4 uuid := gen_random_uuid();
  v_ot2 uuid;
  v_mes  constant timestamptz := date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima';
  v_ahora constant timestamptz := greatest(now(), (date_trunc('day', now() at time zone 'America/Lima') + interval '10 hours') at time zone 'America/Lima');
begin
  perform set_config('prueba.ahora', v_ahora::text, true);
  foreach v in array array['GERENTE', 'GERENTE_PRODUCCION', 'ALMACENERO', 'VENDEDOR'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(v) || '.479@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    select v_id, v, 'Check 479', lower(v) || '.479@prueba.local', r.id from public.roles r where r.codigo = v;
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  perform test.afirmar(
    (select count(*) = 4 from public.usuarios where apellidos = 'Check 479'),
    'los cuatro puestos de la prueba existen (Gerencia, Gerencia de Producción, Almacén y Ventas)');

  set local session_replication_role = replica;

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999472011', 'CLIENTE DE PRUEBA 479 S.A.C.') returning id into v_cli;
  select id into v_car from public.tipos_carroceria order by creado_en limit 1;
  insert into public.proveedores (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999472029', 'PROVEEDOR DE PRUEBA 479 S.A.C.') returning id into v_prov;
  select id into v_sede from public.sedes order by creado_en limit 1;

  -- Cotización 1: aprobada por Gerencia General hace un rato.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado,
                                       registrado_por, revisado_por, revisado_en)
  values (v_cot1, 'CHK479-1', v_cli, v_car, 'c1.pdf', 'cot/' || v_cot1 || '/c1.pdf', 'APROBADA',
          current_setting('prueba.vendedor')::uuid, current_setting('prueba.gerente')::uuid, v_ahora - interval '1 hour');
  -- Cotización 2: devuelta con su observación; antes, su primera versión también se devolvió.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado,
                                       observacion, registrado_por, revisado_por, revisado_en, version)
  values (v_cot2, 'CHK479-2', v_cli, v_car, 'c2.pdf', 'cot/' || v_cot2 || '/c2.pdf', 'RECHAZADA',
          'Falta el plano de la baranda', current_setting('prueba.vendedor')::uuid, current_setting('prueba.gerente')::uuid,
          v_ahora - interval '2 hours', 2);
  insert into public.cotizaciones_pdf_versiones (cotizacion_id, version, nombre_archivo, ruta_storage, subido_en, observacion,
                                                 rechazado_por, rechazado_en, estado_al_archivar)
  values (v_cot2, 1, 'c2-v1.pdf', 'cot/' || v_cot2 || '/c2-v1.pdf', v_ahora - interval '5 hours', 'El precio no incluye IGV',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '4 hours', 'RECHAZADA');
  -- Cotización 3: anulada por Gerencia el mes pasado: no entra en este mes.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado,
                                       registrado_por, motivo_anulacion, anulado_por, anulado_en)
  values (v_cot3, 'CHK479-3', v_cli, v_car, 'c3.pdf', 'cot/' || v_cot3 || '/c3.pdf', 'ANULADA',
          current_setting('prueba.vendedor')::uuid, 'El cliente desistió', current_setting('prueba.gerente')::uuid,
          v_mes - interval '2 days');
  -- Cotización 4: aprobada y después corregida por Ventas: su versión aprobada se archiva con el motivo de la corrección.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado,
                                       registrado_por, version)
  values (v_cot4, 'CHK479-4', v_cli, v_car, 'c4.pdf', 'cot/' || v_cot4 || '/c4.pdf', 'POR_REVISAR',
          current_setting('prueba.vendedor')::uuid, 2);
  insert into public.cotizaciones_pdf_versiones (cotizacion_id, version, nombre_archivo, ruta_storage, subido_en, observacion,
                                                 rechazado_por, rechazado_en, estado_al_archivar)
  values (v_cot4, 1, 'c4-v1.pdf', 'cot/' || v_cot4 || '/c4-v1.pdf', v_ahora - interval '9 hours', 'Corrección: cambió el chasis',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '8 hours', 'APROBADA');

  -- Compras: una aprobada y una devuelta con su motivo; un servicio anulado.
  insert into public.ordenes_compra_materiales (origen, motivo, creado_por, proveedor, proveedor_id, referencia, numero, aprobacion, aprobado_por, aprobado_en)
  values ('DIRECTA', 'Compra directa de prueba', current_setting('prueba.vendedor')::uuid, 'PROVEEDOR DE PRUEBA 479 S.A.C.', v_prov, 'CHK479-OC1', 'OC-9479-MW', 'APROBADA',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '3 hours');
  insert into public.ordenes_compra_materiales (origen, motivo, creado_por, proveedor, proveedor_id, referencia, numero, aprobacion, rechazado_por, rechazado_en, motivo_rechazo)
  values ('DIRECTA', 'Compra directa de prueba', current_setting('prueba.vendedor')::uuid, 'PROVEEDOR DE PRUEBA 479 S.A.C.', v_prov, 'CHK479-OC2', 'OC-9473-MW', 'RECHAZADA',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '30 minutes', 'Pide tres cotizaciones');
  insert into public.ordenes_servicio (creado_por, numero, proveedor_id, proveedor, descripcion, monto, condicion_pago, dias_credito,
                                       aprobacion, estado, anulado_por, anulado_en, motivo_anulacion)
  values (current_setting('prueba.vendedor')::uuid, 'OS-9479', v_prov, 'PROVEEDOR DE PRUEBA 479 S.A.C.', 'Arenado de chasis de prueba', 500, 'CONTADO', 0,
          'POR_APROBAR', 'ANULADA', current_setting('prueba.gerente')::uuid, v_ahora - interval '40 minutes', 'Se hizo en el taller');

  -- Reportes diarios: uno con el visto de Gerencia General y otro con el de Gerencia de Producción.
  insert into public.reportes_diarios (registrado_por, fecha, codigo_interno, asunto, descripcion, area_id, visto_gerencia_por, visto_gerencia_en)
  values (current_setting('prueba.vendedor')::uuid, current_date, 'CHK479', 'Armado', 'Avance del día', (select id from public.areas where codigo = 'MTZ'),
          current_setting('prueba.gerente')::uuid, v_ahora - interval '50 minutes'),
         (current_setting('prueba.vendedor')::uuid, current_date, 'CHK479', 'Soldadura', 'Avance del día', (select id from public.areas where codigo = 'MTZ'),
          current_setting('prueba.gerente_produccion')::uuid, v_ahora - interval '55 minutes');
  -- Y uno que Gerencia observó: `observacion_area` dice quién (GERENCIA), `observacion` dice por qué.
  insert into public.reportes_diarios (registrado_por, fecha, codigo_interno, asunto, descripcion, area_id,
                                       observado_por, observado_en, observacion_area, observacion)
  values (current_setting('prueba.vendedor')::uuid, current_date, 'CHK479', 'Pintura', 'Avance del día', (select id from public.areas where codigo = 'MTZ'),
          current_setting('prueba.gerente')::uuid, v_ahora - interval '45 minutes', 'GERENCIA', 'Falta la foto del chasis');

  -- Trabajo sin orden: uno aprobado, y otro que Gerencia observó y el supervisor ya corrigió. Al
  -- corregirlo, `fn_reporte_revision` deja en nulo quién lo revisó: la devolución queda solo en
  -- `audit_log`, con la fila como quedó al observarla.
  insert into public.flota_unidades (registrado_por, placa, trabajo) values (current_setting('prueba.vendedor')::uuid, 'CHK-479', 'Reparación de baranda') returning id into v_flota;
  insert into public.flota_avances (registrado_por, flota_id, area_id, fecha, descripcion, avance_porcentaje, revision, revisado_por, revisado_en)
  values (current_setting('prueba.vendedor')::uuid, v_flota, (select id from public.areas where codigo = 'PRD'), current_date - 1, 'Cambio de piso', 100, 'APROBADO',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '25 minutes');
  insert into public.flota_avances (registrado_por, flota_id, area_id, fecha, descripcion, avance_porcentaje, revision, corregido_en)
  values (current_setting('prueba.vendedor')::uuid, v_flota, (select id from public.areas where codigo = 'PRD'), current_date, 'Cambio de baranda', 60, 'PENDIENTE', now())
  returning id into v_id;
  insert into public.audit_log (tabla, registro_id, accion, datos_antes, datos_despues, usuario_id, creado_en)
  values ('flota_avances', v_id, 'UPDATE',
          jsonb_build_object('revision', 'PENDIENTE', 'flota_id', v_flota),
          jsonb_build_object('revision', 'OBSERVADO', 'flota_id', v_flota, 'fecha', current_date,
                             'area_id', (select id from public.areas where codigo = 'PRD'),
                             'revisado_por', current_setting('prueba.gerente'), 'revisado_en', v_ahora - interval '20 minutes',
                             'observacion', 'Falta la foto del lado derecho'),
          current_setting('prueba.gerente')::uuid, v_ahora - interval '20 minutes');

  -- Cierre del costeo de un código.
  insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por, cerrado_en, observacion)
  values ('CHK479', 1200, '{}'::jsonb, current_setting('prueba.gerente')::uuid, v_ahora - interval '10 minutes', null);

  -- La OT: su aprobación y su anulación solo están en la bitácora.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK479', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, motivo_anulacion)
  values ('9479-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Check 479', 'ANULADA', 'Duplicada') returning id into v_ot;
  perform set_config('prueba.ot', v_ot::text, true);
  insert into public.ot_bitacora (orden_id, tipo_evento, descripcion, datos, usuario_id, creado_en)
  values (v_ot, 'CAMBIO_ESTADO', 'Estado de la OT: BORRADOR → APROBADA',
          '{"estado_nuevo": "APROBADA", "estado_anterior": "BORRADOR", "motivo": null}', current_setting('prueba.gerente')::uuid, v_ahora - interval '6 hours'),
         (v_ot, 'CAMBIO_ESTADO', 'Estado de la OT: APROBADA → ANULADA',
          '{"estado_nuevo": "ANULADA", "estado_anterior": "APROBADA", "motivo": "Duplicada"}', current_setting('prueba.gerente')::uuid, v_ahora - interval '5 minutes'),
         -- Lo que hizo otro puesto en la misma OT no es de Gerencia.
         (v_ot, 'CAMBIO_ESTADO', 'Estado de la OT: BORRADOR → APROBADA',
          '{"estado_nuevo": "APROBADA", "estado_anterior": "BORRADOR"}', current_setting('prueba.vendedor')::uuid, v_ahora - interval '7 hours');
  -- Otra OT, pausada y después anulada por Gerencia: `fn_ot_despues_update` anota todo lo que sale de
  -- PAUSADA como REANUDACION. Volver a APROBADA desde PROGRAMADA no es aprobarla: aprobar es salir del borrador.
  insert into public.ordenes_trabajo (numero, creado_por, cliente_id, unidad_id, sede_id, descripcion, estado, motivo_anulacion)
  values ('9473-2026', current_setting('prueba.vendedor')::uuid, v_cli, v_uni, v_sede, 'Check 479 pausada', 'ANULADA', 'El cliente la canceló') returning id into v_ot2;
  insert into public.ot_bitacora (orden_id, tipo_evento, descripcion, datos, usuario_id, creado_en)
  values (v_ot2, 'CAMBIO_ESTADO', 'Estado de la OT: PROGRAMADA → APROBADA',
          '{"estado_nuevo": "APROBADA", "estado_anterior": "PROGRAMADA"}', current_setting('prueba.gerente')::uuid, v_ahora - interval '4 hours'),
         (v_ot2, 'REANUDACION', 'Estado de la OT: PAUSADA → ANULADA',
          '{"estado_nuevo": "ANULADA", "estado_anterior": "PAUSADA", "motivo": "El cliente la canceló"}', current_setting('prueba.gerente')::uuid, v_ahora - interval '3 minutes');

  -- Cotización 5 y la OC que vuelve a pedir aprobación: se siembran sin decidir; lo demás, abajo, con los disparadores.
  v_id := gen_random_uuid();
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, registrado_por)
  values (v_id, 'CHK479-5', v_cli, v_car, 'c5.pdf', 'cot/' || v_id || '/c5.pdf', 'POR_REVISAR', current_setting('prueba.vendedor')::uuid);
  perform set_config('prueba.cot5', v_id::text, true);
  insert into public.ordenes_compra_materiales (origen, motivo, creado_por, proveedor, proveedor_id, referencia, numero, aprobacion,
                                                aprobado_por, aprobado_en, monto_pen, monto_aprobado_pen)
  values ('DIRECTA', 'Compra directa de prueba', current_setting('prueba.vendedor')::uuid, 'PROVEEDOR DE PRUEBA 479 S.A.C.', v_prov, 'CHK479-OC3', 'OC-9480-MW', 'APROBADA',
          current_setting('prueba.gerente')::uuid, v_ahora - interval '2 hours', 1000, 1000)
  returning id into v_id;
  perform set_config('prueba.oc3', v_id::text, true);

  set local session_replication_role = origin;
end $$;

-- Gerencia devuelve la cotización 5 y después la anula, por sus políticas y sus disparadores.
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente'), true);
set local role authenticated;
update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el detalle del piso'
 where id = current_setting('prueba.cot5')::uuid;
update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente compró en otro taller'
 where id = current_setting('prueba.cot5')::uuid;
reset role;
-- La OC aprobada sube de monto: `evaluar_aprobacion_compra` la vuelve a pedir y borra quién la aprobó.
update public.ordenes_compra_materiales
   set aprobacion = 'POR_APROBAR', aprobacion_pedida_en = now(), aprobado_por = null, aprobado_en = null, monto_pen = 1500
 where id = current_setting('prueba.oc3')::uuid;
do $$
begin
  perform test.afirmar((select estado = 'ANULADA' and revisado_por = current_setting('prueba.gerente')::uuid
                          from public.cotizaciones_pdf where id = current_setting('prueba.cot5')::uuid),
    'Gerencia devolvió y anuló la cotización 5 por el camino de la base');
  perform test.afirmar(exists (select 1 from public.audit_log where tabla = 'ordenes_compra_materiales'
                                 and registro_id = current_setting('prueba.oc3')::uuid and datos_antes ->> 'aprobacion' = 'APROBADA'),
    'la bitácora guardó la aprobación que la OC perdió al subir de monto');
end $$;

-- Gerencia General: lo suyo de este mes, y nada de los demás puestos.
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente'), true);
set local role authenticated;
create temp table g as
  select * from public.decisiones_tomadas(date_trunc('month', current_date)::date, current_date)
   where nombre like 'CHK479%' or nombre like 'OC-947%' or nombre like 'OS-9479' or detalle like '%479%'
      or codigo = 'CHK479' or nombre like 'CHK-479%';
reset role;

do $$
begin
  perform test.afirmar((select count(*) from g where tipo = 'COTIZACION') = 6,
    'Gerencia ve seis decisiones de cotización: la aprobada, la devuelta, su versión anterior devuelta, la versión aprobada que Ventas corrigió, y la devolución y la anulación de la 5');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-5' and decision = 'DEVUELTO' and motivo = 'Falta el detalle del piso'),
    'la cotización devuelta y después anulada conserva el motivo de la devolución, no el de la anulación');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-5' and decision = 'ANULADO' and motivo = 'El cliente compró en otro taller'),
    'y su anulación lleva el suyo');
  perform test.afirmar((select count(*) from g where tipo = 'COMPRA' and nombre = 'OC-9480-MW' and decision = 'APROBADO') = 1,
    'la aprobación de la OC que subió de monto sigue en la lista, una vez, aunque la columna ya no la diga');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-4' and decision = 'APROBADO' and motivo is null),
    'la versión aprobada que Ventas corrigió sale aprobada y sin el motivo de la corrección, que no es de Gerencia');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-2' and enlace = 'RECHAZADA'),
    'la cotización lleva su estado de hoy, para que el salto la encuentre con su filtro');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-1' and decision = 'APROBADO' and motivo is null),
    'la cotización aprobada sale aprobada y sin motivo');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-2' and decision = 'DEVUELTO' and motivo = 'Falta el plano de la baranda'),
    'la cotización devuelta lleva su observación');
  perform test.afirmar(exists (select 1 from g where nombre = 'CHK479-2' and decision = 'DEVUELTO' and motivo = 'El precio no incluye IGV'),
    'la versión anterior devuelta sale con la observación de entonces');
  perform test.afirmar(not exists (select 1 from g where nombre = 'CHK479-3'),
    'la cotización anulada el mes pasado no entra en este mes');
  perform test.afirmar(exists (select 1 from g where tipo = 'COMPRA' and nombre = 'OC-9479-MW' and decision = 'APROBADO'),
    'la orden de compra aprobada sale con su número');
  perform test.afirmar(exists (select 1 from g where tipo = 'COMPRA' and nombre = 'OC-9473-MW' and decision = 'DEVUELTO' and motivo = 'Pide tres cotizaciones'),
    'la orden de compra devuelta lleva su motivo');
  perform test.afirmar(exists (select 1 from g where tipo = 'SERVICIO' and decision = 'ANULADO' and motivo = 'Se hizo en el taller'),
    'la orden de servicio anulada lleva su motivo');
  perform test.afirmar((select count(*) from g where tipo = 'REPORTE_DIARIO') = 2,
    'de los reportes, Gerencia General ve su visto y su observación: el visto de Gerencia de Producción no es suyo');
  perform test.afirmar(exists (select 1 from g where tipo = 'REPORTE_DIARIO' and decision = 'DEVUELTO' and motivo = 'Falta la foto del chasis'
                                and nombre = 'Pintura' and codigo = 'CHK479' and detalle like to_char(current_date, 'DD/MM/YYYY') || ' · %'),
    'el reporte observado lleva el motivo de la observación (no «GERENCIA»), se nombra por su asunto y dice su código, fecha y área');
  perform test.afirmar(exists (select 1 from g where tipo = 'TRABAJO_SIN_ORDEN' and decision = 'DEVUELTO' and motivo = 'Falta la foto del lado derecho'
                                and enlace is not null),
    'el trabajo sin orden observado sale devuelto, con su motivo y la unidad para el salto, aunque el supervisor ya lo corrigió');
  perform test.afirmar(exists (select 1 from g where tipo = 'TRABAJO_SIN_ORDEN' and decision = 'APROBADO'),
    'el trabajo sin orden aprobado sale aprobado');
  perform test.afirmar(exists (select 1 from g where tipo = 'CIERRE_CODIGO' and decision = 'CERRADO' and nombre = 'CHK479'),
    'el cierre del costeo sale con su código');
  perform test.afirmar((select count(*) from g where tipo = 'ORDEN_TRABAJO') = 3,
    'la primera OT sale aprobada y anulada por Gerencia (la aprobación de Ventas no), y la pausada, solo anulada');
  perform test.afirmar(exists (select 1 from g where tipo = 'ORDEN_TRABAJO' and decision = 'ANULADO' and motivo = 'El cliente la canceló'),
    'la OT anulada estando pausada sale, con su motivo; volver a APROBADA desde PROGRAMADA no cuenta como aprobarla');
  perform test.afirmar(not exists (select 1 from g where tipo = 'ORDEN_TRABAJO' and codigo is distinct from 'CHK479'),
    'cada OT dice el código interno de su unidad');
  perform test.afirmar(exists (select 1 from g where tipo = 'ORDEN_TRABAJO' and decision = 'ANULADO' and motivo = 'Duplicada'),
    'la OT anulada lleva el motivo que guardó la bitácora');
  perform test.afirmar(not exists (select 1 from g where puesto is distinct from (select public.puesto_de(current_setting('prueba.gerente')::uuid))),
    'cada fila dice el puesto de quien decidió, y todas son de Gerencia General');
  perform test.afirmar((select array_agg(decidido_en order by decidido_en desc) = array_agg(decidido_en) from g),
    'lo más reciente primero');
end $$;

-- Gerencia de Producción da el visto a los reportes, pero la lista es de la Gerencia General:
-- la base pide la misma puerta que «Por decidir».
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente_produccion'), true);
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.decisiones_tomadas(current_date - 30, current_date)$q$,
  'Gerencia de Producción no lee la lista de decisiones');
reset role;

-- Almacén no decide nada de esto: la base no le abre la lista.
select set_config('request.jwt.claim.sub', current_setting('prueba.almacenero'), true);
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.decisiones_tomadas(current_date - 30, current_date)$q$,
  'Almacén no lee las decisiones de Gerencia');
reset role;

-- Gerencia: el periodo tiene que ser razonable.
select set_config('request.jwt.claim.sub', current_setting('prueba.gerente'), true);
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.decisiones_tomadas(current_date - 400, current_date)$q$,
  'más de un año a la vez no se pide');
select test.debe_fallar(
  $q$select * from public.decisiones_tomadas(current_date, current_date - 1)$q$,
  'el periodo al revés no se pide');
reset role;

-- Y anon no la ejecuta.
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.decisiones_tomadas(date, date)', 'execute'),
    'anon no ejecuta decisiones_tomadas');
end $$;

rollback;
