-- Metal Work: un código interno de punta a punta, con las cuentas reales.
-- Ejecutar en usnbwnemfqyjjkzdizgv como postgres, o en una base local con una
-- cuenta activa por puesto. El resultado correcto es una excepción que empieza
-- por «ROLLBACK OK»: revierte todo lo que el ensayo crea (documentos,
-- correlativos, avisos, auditoría y archivos anotados). Nunca quitarla.
--
-- Cada cuenta activa hace su parte con sus propias funciones, con su sesión y
-- `set local role authenticated` (nunca como ADMIN):
--   Ventas sube la cotización → Gerencia la aprueba con el código interno y la
--   OT (sin ellos no se aprueba; Administración ya no emite la OT) → Diseño ve
--   la OT dentro del código y arma las etapas, la lista de materiales y un plano →
--   el supervisor de Maestranza recibe el plano → RR. HH. registra al personal
--   y carga horas → los supervisores de Maestranza y Producción suben su reporte
--   diario → Gerencia y RR. HH. los validan → Requerimientos pide insumos y
--   registra el ingreso del vehículo → Almacén revisa el stock → Logística compra
--   → Gerencia aprueba → Logística programa el recojo → el conductor lo deja en
--   almacén → Almacén lo recibe y lo entrega → Logística emite dos órdenes de
--   servicio y Gerencia aprueba una → Administración registra el subcontrato y
--   dos recibos por honorarios → Tesorería paga uno → Contabilidad factura la
--   cotización → Tesorería registra un cobro.
-- Después Gerencia lee el código como lo leen sus pantallas, y cada cifra se
-- compara con lo que se hizo. Diseño, los supervisores y Requerimientos leen lo
-- suyo del mismo código, y tiene que decir lo mismo. Ninguna otra cuenta abre
-- Códigos internos.
--
-- El costeo completo (migración 20261017300000): Administración registra la
-- luz del mes al 8 %, Tesorería paga S/ 300 por caja chica con el código,
-- Producción reporta horas de más, Diseño evalúa la merma y Gerencia fija el
-- presupuesto. Gerencia, Administración y Supervisión general leen el mismo
-- costo (Supervisión general sin precio ni margen); Gerencia no puede cerrar con
-- horas sin costo y Administración no puede cerrar; Supervisión general no lee
-- los cierres, ni en la tabla ni en la auditoría. Solo las cuentas con
-- codigos_internos.ver o costos.ver leen el costo completo.
--
-- Desde el 2026-10-19 (migración 20261017310000) no hay Supervisión general: la
-- cuenta que la tenía es la del administrador del sistema. Lo de Supervisión
-- general se prueba solo si alguna cuenta activa vuelve a tener ese puesto.
--
-- Lo único que se arma como dueño de la base: el material nuevo del catálogo y
-- las filas de storage.objects de los archivos (la subida real la hace el
-- navegador). Diseño colaborador y Portería (y Supervisión general, si tiene
-- cuenta) no tocan el código: con ellas se prueba que no lo ven.
do $circuito$
declare
  c          constant text := 'ENSAYO_GERENCIA_26/99';
  v_hoy      constant date := (now() at time zone 'America/Lima')::date;
  v_ayer     constant date := (now() at time zone 'America/Lima')::date - 1;
  v_puestos  constant text[] := array['GERENTE', 'ADMINISTRACION', 'ALMACENERO', 'COMPRADOR', 'CONDUCTOR', 'CONTABILIDAD',
    'DISENO', 'DISENO_COLABORADOR', 'PORTERO', 'RECURSOS_HUMANOS', 'REQUERIMIENTOS', 'SUPERVISOR_MTZ', 'SUPERVISOR_PRD',
    'SUPERVISOR_ACB', 'TESORERIA', 'VENDEDOR'];
  -- Puestos que se prueban solo si tienen una cuenta activa.
  v_opcionales constant text[] := array['SUPERVISOR_GENERAL'];
  v_puestos_vistos text[];
  k          jsonb;
  v_mtz uuid; v_prd uuid; v_acb uuid;
  v_cliente uuid; v_tipo uuid; v_cat uuid; v_um uuid;
  v_cot   uuid := gen_random_uuid();  v_ot    uuid := gen_random_uuid();
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid;
  v_plano uuid := gen_random_uuid();  v_rev   uuid := gen_random_uuid();
  v_mat   uuid := gen_random_uuid();
  v_t1    uuid := gen_random_uuid();  v_t2    uuid := gen_random_uuid();
  v_r1    uuid := gen_random_uuid();  v_r2    uuid := gen_random_uuid();
  v_rq    uuid := gen_random_uuid();  v_linea uuid;  v_rq_numero text;
  v_prov  uuid;  v_ruc_prov text;  v_ruc_sub text;
  v_oc    uuid := gen_random_uuid();  v_pend uuid;
  v_sal   uuid := gen_random_uuid();
  v_os1   uuid := gen_random_uuid();  v_os2  uuid := gen_random_uuid();
  v_sub   uuid := gen_random_uuid();  v_sc   uuid := gen_random_uuid();
  v_rh1   uuid := gen_random_uuid();  v_rh2  uuid := gen_random_uuid();  v_pago uuid := gen_random_uuid();
  v_veh   uuid := gen_random_uuid();
  v_fac   uuid := gen_random_uuid();  v_cobro uuid := gen_random_uuid();
  v_ruta  text;  v_ruta2 text;
  v_paso  text := 'preparación';
  v_n     integer;
  v_txt   text;
  v_ctx   text;
  -- Lo que lee Gerencia.
  g_resumen jsonb; g_avance jsonb; g_avance_lista jsonb; g_servicios jsonb; g_subcontratos jsonb; g_costeo jsonb;
  g_personal jsonb; g_trabajos jsonb; g_docs jsonb; g_compras jsonb; g_etapas jsonb; g_planos jsonb;
  g_comparados jsonb; g_diseno jsonb; g_facturas jsonb; g_cotizacion jsonb;
  -- Lo que leen los demás del mismo código.
  o_diseno jsonb; o_etapas_diseno jsonb; o_etapas_area jsonb := '{}'; o_gasto jsonb;
  v_vio   text[] := '{}';
  f       text[] := '{}';
  -- Lo que se agrega para medir lo que NO llega al código.
  v_caja  uuid := gen_random_uuid();  v_r3 uuid := gen_random_uuid();
  -- La cuenta de la que Tesorería paga y a la que cobra (migración 20261019100000).
  v_banco uuid := gen_random_uuid();
  b_antes jsonb; b_despues jsonb; b_ot jsonb; b_ot_admin jsonb; b_margen jsonb; b_tareo_extra jsonb;
  -- El costeo completo (migración 20261017300000).
  n_gerencia jsonb; n_admin jsonb; n_general jsonb; n_gasto jsonb; n_cierre text; n_admin_cierre text;
  n_cierres_general integer; n_cierres_admin integer; n_auditoria_general integer;
  n_leen text[] := '{}'; n_deben text[]; n_lineas jsonb;
begin
  -- ------------------------------------------------------------ las cuentas
  select jsonb_object_agg(llave, id) into k from (
    select distinct on (llave) llave, id from (
      select case when r.codigo = 'SUPERVISOR' then 'SUPERVISOR_' || a.codigo else r.codigo end as llave, u.id, u.creado_en
        from public.usuarios u join public.roles r on r.id = u.rol_id left join public.areas a on a.id = u.area_id
       where u.activo and r.codigo <> 'ADMIN') x
     order by llave, creado_en) y;
  if not coalesce(k ?& v_puestos, false) then
    raise exception 'FALLO: faltan cuentas activas de: %',
      (select string_agg(p, ', ') from unnest(v_puestos) p where not coalesce(k ? p, false));
  end if;
  v_puestos_vistos := v_puestos || array(select p from unnest(v_opcionales) p where k ? p);

  -- ------------------------------------------- lo que el ensayo no puede pisar
  if exists (select 1 from public.unidades where upper(regexp_replace(coalesce(codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = 'ENSAYOGERENCIA2699')
     or exists (select 1 from public.requerimientos where public.normalizar_codigo_interno(codigo_interno) = c)
     or exists (select 1 from public.reportes_diarios where public.normalizar_codigo_interno(codigo_interno) = c)
     or exists (select 1 from public.codigo_etapas where codigo_interno = c)
     or exists (select 1 from public.ordenes_trabajo where numero = '9999-2099')
     or exists (select 1 from public.facturas_venta where numero = 'E999-9999999')
     or exists (select 1 from public.registro_vehiculos where chasis = 'ENSAYOGER2699' and salida_en is null) then
    raise exception 'FALLO: el código, la OT, la factura o el chasis reservados para el ensayo ya existen';
  end if;
  select id into v_mtz from public.areas where codigo = 'MTZ';
  select id into v_prd from public.areas where codigo = 'PRD';
  select id into v_acb from public.areas where codigo = 'ACB';
  select id into v_cliente from public.clientes order by creado_en limit 1;
  select id into v_tipo from public.tipos_carroceria where activo order by nombre limit 1;
  select id into v_cat from public.categorias_material where activo and codigo = 'CONSUMIBLES';
  select id into v_um from public.unidades_medida where activo order by (codigo = 'UND') desc, codigo limit 1;
  if v_mtz is null or v_prd is null or v_acb is null or v_cliente is null or v_tipo is null or v_cat is null or v_um is null then
    raise exception 'FALLO: faltan áreas, un cliente, un tipo de carrocería, la categoría CONSUMIBLES o una unidad de medida';
  end if;
  -- Un RUC válido que nadie use: 20 para el proveedor, 10 para el subcontratista.
  select r into v_ruc_prov from (select '2099999' || lpad(n::text, 4, '0') as r from generate_series(0, 9999) n) x
   where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores p where p.numero_documento = r) limit 1;
  select r into v_ruc_sub from (select '1099999' || lpad(n::text, 4, '0') as r from generate_series(0, 9999) n) x
   where public.ruc_es_valido(r) and not exists (select 1 from public.subcontratistas s where s.ruc = r) limit 1;

  -- Cambiar de cuenta: la sesión de esa persona y el rol de la aplicación.
  execute $f$
    create function pg_temp.ensayo_como(p_usuario uuid) returns void language plpgsql as $b$
    begin
      if p_usuario is null then raise exception 'FALLO: cuenta vacía'; end if;
      perform set_config('request.jwt.claim.sub', p_usuario::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end $b$ $f$;
  -- Un desfase: lo que salió contra lo que se hizo.
  execute $f$
    create function pg_temp.ensayo_dif(p_que text, p_salio anyelement, p_esperado anyelement) returns text
    language sql immutable as $b$
      select case when p_salio is distinct from p_esperado
                  then p_que || ': se esperaba ' || coalesce(p_esperado::text, 'nada') || ' y salió ' || coalesce(p_salio::text, 'nada') end
    $b$ $f$;

  begin
    -- ======================================================== 1. EL CIRCUITO
    v_paso := 'Ventas sube la cotización';
    perform pg_temp.ensayo_como((k->>'VENDEDOR')::uuid);
    -- S/ 29,500 con IGV: S/ 25,000 sin IGV (lo mismo que después se factura).
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, moneda, monto_venta)
    values (v_cot, 'ENSAYO-' || v_cot, v_cliente, v_tipo, 'ensayo.pdf', 'cot/' || v_cot || '/ensayo.pdf', 'application/pdf', 'PEN', 29500);
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'Ventas no pudo subir la cotización'; end if;
    perform public.confirmar_igv_cotizacion(v_cot, true);

    v_paso := 'Gerencia no aprueba sin código ni OT';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    begin
      update public.cotizaciones_pdf set estado = 'APROBADA' where id = v_cot;
      raise exception 'Gerencia aprobó la cotización sin código interno ni OT';
    exception when check_violation then null;
    end;

    v_paso := 'Administración ya no emite la OT de la cotización';
    reset role; perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    begin
      perform public.emitir_orden_de_cotizacion(v_cot, v_ot, '9999-2099', c, 'SEMIRREMOLQUE', null, null, v_hoy + 30,
                                                'ot/' || v_ot || '/ensayo.pdf', 'ensayo.pdf', 100);
      raise exception 'Administración emitió la OT de la cotización';
    exception when insufficient_privilege then null;
    end;

    v_paso := 'Gerencia aprueba la cotización con el código interno y la OT';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    perform public.aprobar_cotizacion_con_ot(v_cot, v_ot, c, '9999-2099', 'SEMIRREMOLQUE', v_hoy + 30,
                                             'ot/' || v_ot || '/ensayo.pdf', 'ensayo.pdf', 100);
    if (select estado::text from public.cotizaciones_pdf where id = v_cot) <> 'APROBADA'
       or public.codigo_interno_de_cotizacion(v_cot) is distinct from c then
      raise exception 'La cotización no quedó aprobada con el código %', c;
    end if;

    v_paso := 'Diseño ve la OT dentro del código, con su PDF';
    reset role; perform pg_temp.ensayo_como((k->>'DISENO')::uuid);
    if (select count(*) from public.ordenes_de_codigo_interno(c) where id = v_ot and pdf_ruta is not null) <> 1 then
      raise exception 'Diseño no ve la OT del código con su PDF';
    end if;

    v_paso := 'Diseño arma las etapas';
    reset role; perform pg_temp.ensayo_como((k->>'DISENO')::uuid);
    v_e1 := public.guardar_etapa_codigo(null, c, 'Habilitado', v_mtz, v_hoy - 3, v_ayer);
    v_e2 := public.guardar_etapa_codigo(null, c, 'Armado y soldadura', v_prd, v_ayer, v_hoy + 5);
    v_e3 := public.guardar_etapa_codigo(null, c, 'Arenado y pintura', v_acb, v_hoy + 5, v_hoy + 10);
    v_e4 := public.guardar_etapa_codigo(null, c, 'Entrega', null, v_hoy + 11, v_hoy + 12);
    perform public.marcar_etapa_codigo(v_e1, 'FIN', v_ayer, null);

    v_paso := 'Diseño carga la lista de materiales y un plano';
    reset role;
    insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id)
    values (v_mat, 'ENS-GER-2699', 'Disco de corte 7 pulgadas (ensayo)', v_cat, v_um);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('planos-codigo', v_plano || '/' || v_rev || '.pdf', k->>'DISENO',
            jsonb_build_object('mimetype', 'application/pdf', 'size', 120000));
    perform pg_temp.ensayo_como((k->>'DISENO')::uuid);
    perform public.guardar_material_codigo(null, c, v_mat, 5, null, 'Para cortar las planchas del chasis');
    perform public.registrar_plano_codigo(v_plano, v_rev, c, '001', 'Estructura del chasis', v_mtz, null, 'chasis.pdf', 25);

    v_paso := 'Maestranza recibe el plano';
    reset role; perform pg_temp.ensayo_como((k->>'SUPERVISOR_MTZ')::uuid);
    perform public.recibir_plano_codigo(v_rev);

    v_paso := 'RR. HH. registra al personal y carga horas';
    reset role; perform pg_temp.ensayo_como((k->>'RECURSOS_HUMANOS')::uuid);
    -- S/ 2400 al mes: S/ 10 la hora. El segundo no tiene costo: sus horas esperan.
    perform public.rrhh_guardar_trabajador(v_t1, 'Ensayo', 'Soldador', '9' || lpad((abs(hashtext(v_t1::text)) % 10000000)::text, 7, '0'),
                                           'Soldador', v_mtz, '08:00', '18:00', 'Banco de ensayo', 'AHORROS', '1910000000099', null);
    perform public.rrhh_guardar_trabajador(v_t2, 'Ensayo', 'Ayudante', '9' || lpad((abs(hashtext(v_t2::text)) % 10000000)::text, 7, '0'),
                                           'Ayudante', v_mtz, '08:00', '18:00', 'Banco de ensayo', 'AHORROS', '1910000000098', null);
    perform public.rrhh_guardar_costo_trabajador(v_t1, 2400);
    perform public.rrhh_registrar_tareo(gen_random_uuid(), v_t1, v_ayer, lower(c), 2, 'Trazado de las planchas');

    v_paso := 'Maestranza sube su reporte diario';
    reset role; perform pg_temp.ensayo_como((k->>'SUPERVISOR_MTZ')::uuid);
    perform public.registrar_reporte_diario(v_r1, v_ayer, c, 'Habilitado del chasis', 'Se cortaron las planchas y se empezó a soldar',
      jsonb_build_array(
        jsonb_build_object('descripcion', 'Corte de planchas', 'avance', 100,
                           'personal', jsonb_build_array(jsonb_build_object('trabajador_id', v_t1, 'horas', 3))),
        jsonb_build_object('descripcion', 'Soldadura', 'avance', 50,
                           'personal', jsonb_build_array(jsonb_build_object('trabajador_id', v_t2, 'horas', 2)))),
      null, null);

    v_paso := 'Producción sube su reporte diario';
    reset role; perform pg_temp.ensayo_como((k->>'SUPERVISOR_PRD')::uuid);
    -- «Soldadura» se llama igual que en Maestranza: es otro trabajo.
    perform public.registrar_reporte_diario(v_r2, v_hoy, c, 'Armado del chasis', 'Se armó el chasis y se soldaron largueros',
      jsonb_build_array(
        jsonb_build_object('descripcion', 'Soldadura', 'avance', 40,
                           'personal', jsonb_build_array(jsonb_build_object('trabajador_id', v_t1, 'horas', 4))),
        jsonb_build_object('descripcion', 'Armado del chasis', 'avance', 20,
                           'personal', jsonb_build_array(jsonb_build_object('trabajador_id', v_t1, 'horas', 1)))),
      null, null);

    v_paso := 'Gerencia y RR. HH. validan los reportes';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    perform public.validar_reporte_diario(v_r1, 'GERENCIA');
    perform public.validar_reporte_diario(v_r2, 'GERENCIA');
    reset role; perform pg_temp.ensayo_como((k->>'RECURSOS_HUMANOS')::uuid);
    perform public.validar_reporte_diario(v_r1, 'RRHH');
    perform public.validar_reporte_diario(v_r2, 'RRHH');

    v_paso := 'Requerimientos pide los insumos';
    reset role; perform pg_temp.ensayo_como((k->>'REQUERIMIENTOS')::uuid);
    perform public.emitir_requerimiento(v_rq, 'OPERACION', v_mtz, c, 'Discos de corte para habilitar las planchas del chasis',
      v_hoy + 2, jsonb_build_array(jsonb_build_object('descripcion', 'Disco de corte 7 pulgadas', 'cantidad', 5,
                                                     'unidad_medida_id', v_um, 'categoria_id', v_cat)));

    v_paso := 'Requerimientos registra el ingreso del vehículo';
    reset role;
    v_ruta := (k->>'REQUERIMIENTOS') || '/' || v_veh || '/ingreso/' || gen_random_uuid() || '.jpg';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('fotos-vehiculos', v_ruta, k->>'REQUERIMIENTOS', jsonb_build_object('mimetype', 'image/jpeg', 'size', 90000));
    perform pg_temp.ensayo_como((k->>'REQUERIMIENTOS')::uuid);
    perform public.registrar_ingreso_vehiculo(v_veh, null, 'ENSAYOGER2699', c, 'Semirremolque plataforma', 'Cliente del ensayo',
                                              'FABRICACION', now(), null, jsonb_build_array(v_ruta));

    v_paso := 'Almacén revisa el stock';
    reset role;
    select id into v_linea from public.requerimiento_lineas where requerimiento_id = v_rq;
    select numero into v_rq_numero from public.requerimientos where id = v_rq;
    perform pg_temp.ensayo_como((k->>'ALMACENERO')::uuid);
    perform public.rq_revisar_stock(v_rq, jsonb_build_array(jsonb_build_object('item', 1, 'en_stock', 0)), 'No hay discos de 7 pulgadas');

    v_paso := 'Logística compra lo que falta';
    reset role; perform pg_temp.ensayo_como((k->>'COMPRADOR')::uuid);
    insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
    values (v_ruc_prov, 'Proveedor del ensayo S.A.C.', 'Av. del Ensayo 123, Lima', '999 000 999')
    returning id into v_prov;
    -- 5 × S/ 13.00 = S/ 65.00 sin IGV.
    perform public.emitir_compra_del_requerimiento(v_oc, v_rq, null, v_prov, null,
      jsonb_build_array(jsonb_build_object('material_id', v_mat, 'cantidad', 5, 'precio', 13)),
      v_hoy, 'CONTADO', 0, 'PEN', false);
    -- La compra se evalúa (monto y aprobación) al confirmar la transacción, como
    -- al final de cada pedido de la aplicación: aquí no hay confirmación.
    set constraints all immediate;

    v_paso := 'Gerencia aprueba la compra';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    perform public.aprobar_compra(v_oc);

    v_paso := 'Logística programa el recojo';
    reset role; perform pg_temp.ensayo_como((k->>'COMPRADOR')::uuid);
    perform public.programar_recojo(v_oc, 12.5, null);

    v_paso := 'El conductor recoge y deja en almacén';
    reset role; perform pg_temp.ensayo_como((k->>'CONDUCTOR')::uuid);
    perform public.marcar_compra_en_recojo(v_oc);
    perform public.marcar_compra_recogida(v_oc);
    perform public.marcar_compra_dejada_almacen(v_oc);

    v_paso := 'Almacén recibe la compra y la entrega a Maestranza';
    reset role;
    select id into v_pend from public.ingresos_pendientes_almacen where orden_compra_id = v_oc;
    v_ruta := (k->>'ALMACENERO') || '/' || v_sal || '.jpg';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', v_ruta, k->>'ALMACENERO', jsonb_build_object('mimetype', 'image/jpeg', 'size', 80000));
    perform pg_temp.ensayo_como((k->>'ALMACENERO')::uuid);
    perform public.validar_ingresos_compra(v_oc, jsonb_build_array(jsonb_build_object('id', v_pend, 'movimiento_id', gen_random_uuid(),
                                                                                         'cantidad', 5, 'observacion', null)),
                                           'Guía del ensayo');
    if (select estado from public.requerimientos where id = v_rq) = 'EN_ATENCION' then
      perform public.rq_marcar_listo_en_almacen(v_rq, null);
    end if;
    perform public.registrar_salida_material(v_sal, v_mat, 5, null, null, 'Discos para el habilitado', 'Supervisor de Maestranza',
                                             v_ruta, v_linea);
    if (select estado from public.requerimientos where id = v_rq) = 'LISTO_EN_ALMACEN' then
      perform public.rq_marcar_entregado(v_rq, 'Lo recogió el supervisor de Maestranza');
    end if;

    v_paso := 'Logística emite dos órdenes de servicio';
    reset role; perform pg_temp.ensayo_como((k->>'COMPRADOR')::uuid);
    perform public.emitir_orden_servicio(v_os1, v_prov, null, v_acb, c, 'Arenado del chasis en el taller del proveedor', null,
      v_hoy, v_hoy + 3, 'PEN', 1200, 'CONTADO', 0, 'NO_SUJETA', 'Ensayo: el proveedor no cobra IGV');
    perform public.emitir_orden_servicio(v_os2, v_prov, null, v_mtz, c, 'Doblado de planchas en una plegadora externa', null,
      v_hoy, v_hoy + 2, 'PEN', 800, 'CONTADO', 0, 'NO_SUJETA', 'Ensayo: el proveedor no cobra IGV');

    v_paso := 'Gerencia aprueba una orden de servicio';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    perform public.aprobar_orden_servicio(v_os1);

    v_paso := 'Administración registra el subcontrato y dos recibos por honorarios';
    reset role;
    v_ruta := v_sc || '/' || gen_random_uuid() || '.pdf';
    v_ruta2 := v_sc || '/' || gen_random_uuid() || '.pdf';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('subcontratos', v_ruta, k->>'ADMINISTRACION', jsonb_build_object('mimetype', 'application/pdf', 'size', 84000)),
           ('subcontratos', v_ruta2, k->>'ADMINISTRACION', jsonb_build_object('mimetype', 'application/pdf', 'size', 84000));
    perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    perform public.guardar_subcontratista(v_sub, v_ruc_sub, 'Soldador del ensayo', null, null, null, null, true);
    perform public.registrar_subcontrato(v_sc, v_sub, c, 'Soldadura de refuerzos del chasis por terceros', 'PEN', 2000, v_ayer, v_hoy + 10, 'PRD');
    perform public.registrar_recibo_honorarios(v_rh1, v_sc, 'E001-1', v_ayer, 'Primer avance', 1000, true, v_ruta);
    perform public.registrar_recibo_honorarios(v_rh2, v_sc, 'E001-2', v_hoy, 'Segundo avance', 500, false, v_ruta2);

    v_paso := 'Tesorería paga un recibo por honorarios';
    reset role;
    v_ruta := v_sc || '/' || gen_random_uuid() || '.jpg';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('subcontratos', v_ruta, k->>'TESORERIA', jsonb_build_object('mimetype', 'image/jpeg', 'size', 60000));
    perform pg_temp.ensayo_como((k->>'TESORERIA')::uuid);
    -- Desde la 20261019100000 todo pago y cobro pide su cuenta de la caja.
    perform public.guardar_caja(v_banco, 'Banco del ensayo 2699', 'BANCO', 'BANCO DEL ENSAYO', 'PEN', 0, v_hoy, true);
    perform public.registrar_pago_recibo_honorarios(v_pago, v_rh1, v_hoy, 'OP-ENSAYO-1', v_ruta, v_banco, null);

    v_paso := 'Contabilidad factura la cotización';
    reset role;
    v_ruta := v_fac || '/' || gen_random_uuid() || '.pdf';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('facturas-venta', v_ruta, k->>'CONTABILIDAD', jsonb_build_object('mimetype', 'application/pdf', 'size', 70000));
    perform pg_temp.ensayo_como((k->>'CONTABILIDAD')::uuid);
    perform public.registrar_factura_venta(v_fac, v_cot, 'E999-9999999', v_hoy, v_hoy + 30, 'PEN', 29500, 'Inicial 50 %', v_ruta, 'factura.pdf');

    v_paso := 'Tesorería registra un cobro';
    reset role;
    v_ruta := v_fac || '/' || gen_random_uuid() || '.pdf';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('cobros-venta', v_ruta, k->>'TESORERIA', jsonb_build_object('mimetype', 'application/pdf', 'size', 50000));
    perform pg_temp.ensayo_como((k->>'TESORERIA')::uuid);
    perform public.registrar_cobro_factura(v_cobro, v_fac, v_hoy, 10000, false, 'OP-ENSAYO-2', v_ruta, v_banco, null);

    -- ================================================ 2. LO QUE LEE GERENCIA
    v_paso := 'Gerencia lee el código';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    select to_jsonb(r) into g_resumen from public.codigos_internos_resumen() r where r.codigo = c;
    select to_jsonb(r) into g_avance from public.codigos_internos_avance(lower(c)) r;
    select to_jsonb(r) into g_avance_lista from public.codigos_internos_avance() r where r.codigo = c;
    select to_jsonb(r) into g_servicios from public.codigos_internos_servicios() r where r.codigo = c;
    select to_jsonb(r) into g_subcontratos from public.codigos_internos_subcontratos() r where r.codigo = c;
    select jsonb_object_agg(x.fuente, jsonb_build_object('lineas', x.lineas, 'monto', x.monto, 'horas', x.horas)) into g_costeo
      from (select l.fuente, count(*) as lineas, coalesce(sum(l.monto), 0) as monto, coalesce(sum(l.horas), 0) as horas
              from public.codigo_interno_costeo(c) l group by l.fuente) x;
    select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'horas', p.horas, 'sin_costo', p.horas_sin_costo, 'dias', p.dias)
                     order by p.horas desc) into g_personal from public.codigo_interno_personal(c) p;
    select jsonb_agg(jsonb_build_object('area', a.area, 'trabajo', a.trabajo, 'avance', a.avance, 'estado', a.estado)
                     order by a.area, a.trabajo_orden) into g_trabajos from public.codigo_interno_avance(c) a;
    select jsonb_object_agg(x.tipo, x.filas) into g_docs
      from (select d.tipo, jsonb_agg(jsonb_build_object('numero', d.numero, 'estado', d.estado) order by d.numero) as filas
              from public.codigo_interno_documentos(c) d group by d.tipo) x;
    select jsonb_agg(jsonb_build_object('aprobacion', x.aprobacion, 'recojo', x.recojo, 'monto', x.monto, 'lineas', x.lineas,
                                        'validaciones', x.validaciones, 'requerimientos', x.requerimientos))
      into g_compras from public.codigo_interno_compras(c) x;
    select jsonb_agg(jsonb_build_object('orden', e.orden, 'area', e.area_codigo, 'fin_real', e.fin_real,
                                        'avance', e.avance_reportado, 'reportes', e.reportes) order by e.orden)
      into g_etapas from public.codigo_interno_etapas(c) e;
    select jsonb_agg(jsonb_build_object('numero', p.numero, 'area', p.area_codigo, 'recibido_por', p.recibido_por_area))
      into g_planos from public.codigo_interno_planos(c) p;
    select jsonb_agg(jsonb_build_object('disenado', m.disenado, 'comprado', m.comprado, 'salido', m.salido))
      into g_comparados from public.codigo_interno_materiales_comparados(c) m;
    select to_jsonb(d) into g_diseno from public.codigos_internos_de_diseno() d where d.codigo = c;
    select jsonb_agg(jsonb_build_object('total', v.total, 'cobrado', v.cobrado, 'saldo', v.saldo, 'cancelada', v.cancelada))
      into g_facturas from public.v_facturas_venta v where v.codigo_interno = c;
    select to_jsonb(q) into g_cotizacion from public.cotizaciones_para_facturar() q where q.codigo_interno = c;

    -- ========================================== 3. LO QUE LEEN LOS DEMÁS
    v_paso := 'Diseño lee el código';
    reset role; perform pg_temp.ensayo_como((k->>'DISENO')::uuid);
    select to_jsonb(d) into o_diseno from public.codigos_internos_de_diseno() d where d.codigo = c;
    select jsonb_agg(jsonb_build_object('orden', e.orden, 'area', e.area_codigo, 'fin_real', e.fin_real,
                                        'avance', e.avance_reportado, 'reportes', e.reportes) order by e.orden)
      into o_etapas_diseno from public.codigo_interno_etapas(c) e;

    v_paso := 'Cada supervisor lee las etapas de su área';
    foreach v_txt in array array['MTZ', 'PRD', 'ACB'] loop
      reset role; perform pg_temp.ensayo_como((k->>('SUPERVISOR_' || v_txt))::uuid);
      o_etapas_area := o_etapas_area || jsonb_build_object(v_txt, (
        select jsonb_agg(jsonb_build_object('orden', e.orden, 'avance', e.avance_reportado, 'fin_real', e.fin_real) order by e.orden)
          from public.codigo_interno_etapas(c) e where e.area_codigo = v_txt));
    end loop;

    v_paso := 'Requerimientos lee el gasto del código';
    reset role; perform pg_temp.ensayo_como((k->>'REQUERIMIENTOS')::uuid);
    select to_jsonb(g) into o_gasto from public.codigos_internos_gasto() g where g.codigo = c;

    -- ===================================== 4. NADIE MÁS ABRE CÓDIGOS INTERNOS
    v_paso := 'Las demás cuentas no ven Códigos internos';
    foreach v_txt in array v_puestos_vistos loop
      continue when v_txt = 'GERENTE';
      reset role; perform pg_temp.ensayo_como((k->>v_txt)::uuid);
      begin
        perform 1 from public.codigos_internos_resumen();
        v_vio := v_vio || (v_txt || ' ve la lista');
      exception when insufficient_privilege then null;
      end;
      begin
        perform 1 from public.codigos_internos_avance(c);
        v_vio := v_vio || (v_txt || ' ve el porcentaje');
      exception when insufficient_privilege then null;
      end;
      begin
        perform 1 from public.codigo_interno_costeo(c);
        v_vio := v_vio || (v_txt || ' ve el costeo');
      exception when insufficient_privilege then null;
      end;
    end loop;
    reset role;

    -- ================================= 6. LO QUE NO LLEGA AL COSTEO DEL CÓDIGO
    v_paso := 'Gerencia lee el costeo antes de las brechas';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    select jsonb_object_agg(x.fuente, x.monto) into b_antes
      from (select l.fuente, coalesce(sum(l.monto), 0) as monto from public.codigo_interno_costeo(c) l group by l.fuente) x;

    v_paso := 'Administración registra la luz del mes (8 % por unidad, como la hoja RESUMEN)';
    reset role; perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    perform public.registrar_gasto_general(gen_random_uuid(), v_hoy, 'ELECTRICIDAD', 'Recibo de luz del ensayo', 1000, 'PEN', 'TASA', 8);

    v_paso := 'Tesorería paga S/ 300 de movilidad por caja chica con el código';
    reset role; perform pg_temp.ensayo_como((k->>'TESORERIA')::uuid);
    perform public.guardar_caja(v_caja, 'Caja chica del ensayo 2699', 'EFECTIVO', null, 'PEN', 1000, v_hoy, true);
    perform public.registrar_movimiento_caja(gen_random_uuid(), v_caja, v_hoy, 'EGRESO', 300,
                                             'Movilidad para recoger las planchas del ensayo', c, null, null);

    v_paso := 'Producción reporta 5 h más del soldador hoy (10 h en el día: 2 h extras)';
    reset role; perform pg_temp.ensayo_como((k->>'SUPERVISOR_PRD')::uuid);
    perform public.registrar_reporte_diario(v_r3, v_hoy, c, 'Soldadura de largueros por la tarde', 'Se siguió soldando hasta la noche',
      jsonb_build_array(
        jsonb_build_object('descripcion', 'Soldadura', 'avance', 60,
                           'personal', jsonb_build_array(jsonb_build_object('trabajador_id', v_t1, 'horas', 5)))),
      null, null);
    reset role;
    select jsonb_build_object('horas', sum(t.horas), 'costo_hora', min(t.costo_hora), 'costo', sum(t.costo))
      into b_tareo_extra
      from public.tareos t join public.reporte_diario_personal l on l.id = t.reporte_linea_id where l.reporte_id = v_r3;

    v_paso := 'Gerencia lee el costeo después de las brechas';
    reset role; perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    select jsonb_object_agg(x.fuente, x.monto) into b_despues
      from (select l.fuente, coalesce(sum(l.monto), 0) as monto from public.codigo_interno_costeo(c) l group by l.fuente) x;
    -- El margen y el costo que da la OT del mismo código (expediente y Dashboard).
    select to_jsonb(m) into b_margen from public.margen_ot(v_ot) m;
    select jsonb_object_agg(x.fuente, x.monto) into b_ot
      from (select s.fuente, coalesce(sum(s.monto_pen), 0) as monto from public.costeo_ot_en_soles(v_ot) s group by s.fuente) x;

    v_paso := 'Administración lee el costo de la OT';
    reset role; perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    select jsonb_object_agg(x.fuente, x.monto) into b_ot_admin
      from (select s.fuente, coalesce(sum(s.monto_pen), 0) as monto from public.costeo_ot_en_soles(v_ot) s group by s.fuente) x;
    reset role;

    -- ================================= 7. EL COSTEO COMPLETO, CON CADA PUESTO
    v_paso := 'Diseño evalúa la merma de la OT en 5 %';
    reset role; perform pg_temp.ensayo_como((k->>'DISENO')::uuid);
    perform public.fijar_merma_ot(v_ot, 5, 'Cortes de los largueros del ensayo');
    reset role;

    v_paso := 'Gerencia fija a mano el presupuesto de la OT';
    perform pg_temp.ensayo_como((k->>'GERENTE')::uuid);
    perform public.fijar_presupuesto_ot(v_ot, 20000, 'Presupuesto acordado en el ensayo');

    v_paso := 'Gerencia lee el costo completo y el margen del código';
    select to_jsonb(x) into n_gerencia from public.codigos_internos_costo(c) x;
    select jsonb_object_agg(x.fuente, x.monto) into n_lineas
      from (select l.fuente, coalesce(sum(l.monto), 0) as monto from public.codigo_interno_costeo(c) l group by l.fuente) x;
    v_paso := 'Gerencia intenta cerrar el costeo con 2 h sin costo';
    begin
      perform public.cerrar_costeo_codigo(c, 'Unidad entregada en el ensayo con su acta');
      n_cierre := 'CERRÓ';
    exception when others then n_cierre := sqlerrm;
    end;
    reset role;

    v_paso := 'Administración lee el mismo costo e intenta cerrar';
    perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    select to_jsonb(x) into n_admin from public.codigos_internos_costo(c) x;
    begin
      perform public.cerrar_costeo_codigo(c, 'Unidad entregada en el ensayo con su acta');
      n_admin_cierre := 'CERRÓ';
    exception when others then n_admin_cierre := sqlstate;
    end;
    reset role;

    if k ? 'SUPERVISOR_GENERAL' then
      v_paso := 'Supervisión general lee el costo sin el precio';
      perform pg_temp.ensayo_como((k->>'SUPERVISOR_GENERAL')::uuid);
      select to_jsonb(x) into n_general from public.codigos_internos_costo(c) x;
      reset role;
    end if;

    -- El cierre guarda el margen: un cierre del ensayo, escrito como dueño de la
    -- tabla (se deshace con todo), lo lee Administración y no Supervisión general.
    v_paso := 'Quién lee la tabla de cierres';
    insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion, cerrado_por)
    values (c, 1, 2, 1, 50, '{}'::jsonb, 'Cierre del ensayo para probar quién lo lee', (k->>'GERENTE')::uuid);
    if k ? 'SUPERVISOR_GENERAL' then
      perform pg_temp.ensayo_como((k->>'SUPERVISOR_GENERAL')::uuid);
      select count(*) into n_cierres_general from public.codigo_interno_cierres where codigo = c;
      -- Supervisión general lee la auditoría (auditoria.ver): el cierre no se copia ahí.
      select count(*) into n_auditoria_general from public.audit_log where tabla = 'codigo_interno_cierres';
      reset role;
    end if;
    perform pg_temp.ensayo_como((k->>'ADMINISTRACION')::uuid);
    select count(*) into n_cierres_admin from public.codigo_interno_cierres where codigo = c;
    reset role;

    v_paso := 'Requerimientos lee su gasto por código';
    perform pg_temp.ensayo_como((k->>'REQUERIMIENTOS')::uuid);
    select to_jsonb(g) into n_gasto from public.codigos_internos_gasto() g where g.codigo = c;
    reset role;

    v_paso := 'Quién lee el costo completo';
    foreach v_txt in array v_puestos_vistos loop
      perform pg_temp.ensayo_como((k->>v_txt)::uuid);
      begin
        perform 1 from public.codigos_internos_costo(c);
        n_leen := n_leen || v_txt;
      exception when insufficient_privilege then null;
      end;
      reset role;
    end loop;
    select array_agg(p order by p) into n_deben from unnest(v_puestos_vistos) p
     where exists (select 1 from public.usuarios u join public.roles_permisos rp on rp.rol_id = u.rol_id
                    where u.id = (k->>p)::uuid and rp.permiso_codigo in ('codigos_internos.ver', 'costos.ver'));
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'FALLO en «%»: % [%]', v_paso, sqlerrm, split_part(v_ctx, E'\n', 1);
  end;

  -- ============================================ 5. CADA CIFRA CONTRA LO HECHO
  reset role;
  if g_resumen is null then raise exception 'FALLO: Gerencia no ve el código % en la lista', c; end if;
  -- El porcentaje: (100 de Habilitado, terminada + 30 de Producción + 0 + 0) / 4 = 32.5 → 33.
  f := f || pg_temp.ensayo_dif('porcentaje del código', (g_avance->>'avance')::numeric, 33::numeric)
         || pg_temp.ensayo_dif('de dónde sale el porcentaje', g_avance->>'fuente', 'ETAPAS'::text)
         || pg_temp.ensayo_dif('etapas', (g_avance->>'etapas')::numeric, 4::numeric)
         || pg_temp.ensayo_dif('etapas terminadas', (g_avance->>'etapas_terminadas')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('trabajos de los reportes (área por área)', (g_avance->>'trabajos')::numeric, 4::numeric)
         || pg_temp.ensayo_dif('trabajos terminados', (g_avance->>'trabajos_terminados')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('último reporte', (g_avance->>'ultimo_reporte')::date, v_hoy)
         || pg_temp.ensayo_dif('el porcentaje de la lista y el del detalle', g_avance_lista, g_avance);
  -- Dónde aparece.
  f := f || pg_temp.ensayo_dif('RQ en la lista', (g_resumen->>'requerimientos')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('OC en la lista', (g_resumen->>'compras')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('salidas en la lista', (g_resumen->>'salidas')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('reportes en la lista', (g_resumen->>'reportes')::numeric, 2::numeric)
         || pg_temp.ensayo_dif('ingresos a la planta', (g_resumen->>'vehiculos')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('unidades', (g_resumen->>'unidades')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('OT', (g_resumen->>'ordenes')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('último reporte en la lista', (g_resumen->>'ultimo_reporte')::date, v_hoy)
         || pg_temp.ensayo_dif('última actividad', (g_resumen->>'ultima_actividad')::date, v_hoy);
  -- El costeo: 2 h a mano + 3 h de Maestranza + 5 h de Producción, a S/ 10; 2 h esperan costo.
  f := f || pg_temp.ensayo_dif('horas', (g_resumen->>'horas')::numeric, 12::numeric)
         || pg_temp.ensayo_dif('horas sin costo', (g_resumen->>'horas_sin_costo')::numeric, 2::numeric)
         || pg_temp.ensayo_dif('mano de obra', (g_resumen->>'mano_obra')::numeric, 100::numeric)
         || pg_temp.ensayo_dif('materiales (5 × S/ 13 que salieron)', (g_resumen->>'materiales_pen')::numeric, 65::numeric)
         || pg_temp.ensayo_dif('salidas sin precio', (g_resumen->>'materiales_sin_precio')::numeric, 0::numeric)
         || pg_temp.ensayo_dif('compras, aparte', (g_resumen->>'compras_pen')::numeric, 65::numeric)
         || pg_temp.ensayo_dif('líneas de OC sin precio', (g_resumen->>'compras_sin_precio')::numeric, 0::numeric)
         || pg_temp.ensayo_dif('OS aprobadas', (g_servicios->>'servicios')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('servicios', (g_servicios->>'servicios_pen')::numeric, 1200::numeric)
         || pg_temp.ensayo_dif('OS por aprobar', (g_servicios->>'por_aprobar')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('servicios por aprobar', (g_servicios->>'por_aprobar_pen')::numeric, 800::numeric)
         || pg_temp.ensayo_dif('recibos por honorarios', (g_subcontratos->>'recibos')::numeric, 2::numeric)
         || pg_temp.ensayo_dif('subcontratos', (g_subcontratos->>'subcontratos_pen')::numeric, 1500::numeric)
         || pg_temp.ensayo_dif('RxH por pagar', (g_subcontratos->>'por_pagar')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('subcontratos por pagar', (g_subcontratos->>'por_pagar_pen')::numeric, 500::numeric);
  -- El detalle del costeo suma lo mismo que la lista.
  f := f || pg_temp.ensayo_dif('costeo: mano de obra', (g_costeo->'MANO_OBRA'->>'monto')::numeric, (g_resumen->>'mano_obra')::numeric)
         || pg_temp.ensayo_dif('costeo: horas', (g_costeo->'MANO_OBRA'->>'horas')::numeric
                                                 + coalesce((g_costeo->'MANO_OBRA_SIN_COSTO'->>'horas')::numeric, 0),
                                (g_resumen->>'horas')::numeric)
         || pg_temp.ensayo_dif('costeo: materiales', (g_costeo->'MATERIALES'->>'monto')::numeric, (g_resumen->>'materiales_pen')::numeric)
         || pg_temp.ensayo_dif('costeo: compras', (g_costeo->'COMPRAS'->>'monto')::numeric, (g_resumen->>'compras_pen')::numeric)
         || pg_temp.ensayo_dif('costeo: servicios', (g_costeo->'SERVICIOS'->>'monto')::numeric, (g_servicios->>'servicios_pen')::numeric)
         || pg_temp.ensayo_dif('costeo: servicios por aprobar', (g_costeo->'SERVICIOS_POR_APROBAR'->>'monto')::numeric,
                                (g_servicios->>'por_aprobar_pen')::numeric)
         || pg_temp.ensayo_dif('costeo: subcontratos', (g_costeo->'SUBCONTRATOS'->>'monto')::numeric
                                                       + coalesce((g_costeo->'SUBCONTRATOS_POR_PAGAR'->>'monto')::numeric, 0),
                                (g_subcontratos->>'subcontratos_pen')::numeric);
  -- Personal: las horas de cada persona suman las del código.
  f := f || pg_temp.ensayo_dif('personas', jsonb_array_length(coalesce(g_personal, '[]'))::numeric, 2::numeric)
         || pg_temp.ensayo_dif('horas por persona', (select sum((p->>'horas')::numeric) from jsonb_array_elements(g_personal) p),
                                (g_resumen->>'horas')::numeric)
         || pg_temp.ensayo_dif('horas del soldador', (g_personal->0->>'horas')::numeric, 10::numeric)
         || pg_temp.ensayo_dif('días del soldador', (g_personal->0->>'dias')::numeric, 2::numeric)
         || pg_temp.ensayo_dif('horas sin costo del ayudante', (g_personal->1->>'sin_costo')::numeric, 2::numeric);
  -- Avance: los cuatro trabajos, validados.
  f := f || pg_temp.ensayo_dif('trabajos en la pestaña Avance', jsonb_array_length(coalesce(g_trabajos, '[]'))::numeric, 4::numeric)
         || pg_temp.ensayo_dif('trabajos validados',
                                (select count(*) from jsonb_array_elements(g_trabajos) t where t->>'estado' = 'VALIDADO')::numeric, 4::numeric);
  -- Etapas: Maestranza reporta 75 (100 y 50), Producción 30 (40 y 20), Acabados nada.
  f := f || pg_temp.ensayo_dif('etapas de Gerencia', g_etapas, jsonb_build_array(
              jsonb_build_object('orden', 1, 'area', 'MTZ', 'fin_real', v_ayer, 'avance', 75, 'reportes', 1),
              jsonb_build_object('orden', 2, 'area', 'PRD', 'fin_real', null, 'avance', 30, 'reportes', 1),
              jsonb_build_object('orden', 3, 'area', 'ACB', 'fin_real', null, 'avance', null, 'reportes', 0),
              jsonb_build_object('orden', 4, 'area', null, 'fin_real', null, 'avance', null, 'reportes', 0)));
  -- Documentos.
  f := f || pg_temp.ensayo_dif('el RQ', g_docs->'REQUERIMIENTO'->0->>'numero', v_rq_numero)
         || pg_temp.ensayo_dif('el RQ entregado', g_docs->'REQUERIMIENTO'->0->>'estado', 'ENTREGADO'::text)
         || pg_temp.ensayo_dif('la OT', g_docs->'OT'->0->>'numero', '9999-2099'::text)
         || pg_temp.ensayo_dif('la cotización', g_docs->'COTIZACION'->0->>'estado', 'APROBADA'::text)
         || pg_temp.ensayo_dif('la unidad', g_docs->'UNIDAD'->0->>'estado', 'ACTIVA'::text)
         || pg_temp.ensayo_dif('el vehículo en la planta', g_docs->'VEHICULO'->0->>'estado', 'EN_PLANTA'::text)
         || pg_temp.ensayo_dif('las OS', jsonb_array_length(coalesce(g_docs->'SERVICIO', '[]'))::numeric, 2::numeric);
  -- La compra, con su camino.
  f := f || pg_temp.ensayo_dif('compras del código', jsonb_array_length(coalesce(g_compras, '[]'))::numeric, 1::numeric)
         || pg_temp.ensayo_dif('la compra aprobada', g_compras->0->>'aprobacion', 'APROBADA'::text)
         || pg_temp.ensayo_dif('la compra dejada en almacén', g_compras->0->>'recojo', 'DEJADO'::text)
         || pg_temp.ensayo_dif('el monto de la compra', (g_compras->0->>'monto')::numeric, 65::numeric)
         || pg_temp.ensayo_dif('el RQ de la compra', g_compras->0->>'requerimientos', v_rq_numero);
  -- Diseño: el plano recibido y lo diseñado contra lo comprado y lo salido.
  f := f || pg_temp.ensayo_dif('el plano', g_planos, jsonb_build_array(jsonb_build_object('numero', '001', 'area', 'MTZ', 'recibido_por', (select nombre from public.areas where id = v_mtz))))
         || pg_temp.ensayo_dif('diseñado, comprado y salido', g_comparados,
                                jsonb_build_array(jsonb_build_object('disenado', 5, 'comprado', 5, 'salido', 5)))
         || pg_temp.ensayo_dif('etapas en la línea de Diseño', (g_diseno->>'etapas')::numeric, 4::numeric)
         || pg_temp.ensayo_dif('terminadas en la línea de Diseño', (g_diseno->>'etapas_terminadas')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('etapa en curso', g_diseno->>'etapa_actual', 'Armado y soldadura'::text);
  -- Factura y cobro (PR #92).
  f := f || pg_temp.ensayo_dif('facturas', jsonb_array_length(coalesce(g_facturas, '[]'))::numeric, 1::numeric)
         || pg_temp.ensayo_dif('facturado', (g_facturas->0->>'total')::numeric, 29500::numeric)
         || pg_temp.ensayo_dif('cobrado', (g_facturas->0->>'cobrado')::numeric, 10000::numeric)
         || pg_temp.ensayo_dif('por cobrar', (g_facturas->0->>'saldo')::numeric, 19500::numeric)
         || pg_temp.ensayo_dif('la cotización en Factura y cobro', g_cotizacion is not null, true);
  -- Los demás ven lo mismo que Gerencia.
  f := f || pg_temp.ensayo_dif('Diseño y Gerencia: la línea del código', o_diseno, g_diseno)
         || pg_temp.ensayo_dif('Diseño y Gerencia: las etapas', o_etapas_diseno, g_etapas)
         || pg_temp.ensayo_dif('Maestranza y Gerencia: su etapa', o_etapas_area->'MTZ',
                                jsonb_build_array(jsonb_build_object('orden', 1, 'avance', 75, 'fin_real', v_ayer)))
         || pg_temp.ensayo_dif('Producción y Gerencia: su etapa', o_etapas_area->'PRD',
                                jsonb_build_array(jsonb_build_object('orden', 2, 'avance', 30, 'fin_real', null)))
         || pg_temp.ensayo_dif('Acabados y Gerencia: su etapa', o_etapas_area->'ACB',
                                jsonb_build_array(jsonb_build_object('orden', 3, 'avance', null, 'fin_real', null)))
         || pg_temp.ensayo_dif('Requerimientos y Gerencia: materiales', (o_gasto->>'materiales_pen')::numeric, (g_resumen->>'materiales_pen')::numeric)
         || pg_temp.ensayo_dif('Requerimientos y Gerencia: compras', (o_gasto->>'compras_pen')::numeric, (g_resumen->>'compras_pen')::numeric)
         || pg_temp.ensayo_dif('Requerimientos y Gerencia: RQ', (o_gasto->>'requerimientos')::numeric, (g_resumen->>'requerimientos')::numeric);
  -- El costeo completo: la luz al 8 %, la caja de S/ 300 y la venta sin IGV.
  f := f || pg_temp.ensayo_dif('gastos del mes (8 % de S/ 1,000)', (n_gerencia->>'gastos_mes_pen')::numeric, 80::numeric)
         || pg_temp.ensayo_dif('caja con el código', (n_gerencia->>'caja_pen')::numeric, 300::numeric)
         || pg_temp.ensayo_dif('egresos de caja', (n_gerencia->>'egresos_caja')::numeric, 1::numeric)
         || pg_temp.ensayo_dif('costo completo = lo que suma el costeo',
                                (n_gerencia->>'costo_pen')::numeric,
                                (select sum(e.monto::numeric) from jsonb_each_text(n_lineas) e(fuente, monto)
                                  where e.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')))
         || pg_temp.ensayo_dif('merma de la OT (5 % de S/ 65 de materiales)', (n_gerencia->>'merma_pen')::numeric, 3.25::numeric)
         || pg_temp.ensayo_dif('el presupuesto fijado en la OT es el del código', (n_gerencia->>'presupuesto_pen')::numeric, 20000::numeric)
         || pg_temp.ensayo_dif('y la base dice que es fijado', (n_gerencia->>'presupuesto_fijado')::boolean, true)
         || pg_temp.ensayo_dif('precio sin IGV', (n_gerencia->>'precio_neto_pen')::numeric, 25000::numeric)
         || pg_temp.ensayo_dif('margen', (n_gerencia->>'margen_pen')::numeric, 25000 - (n_gerencia->>'costo_pen')::numeric)
         || pg_temp.ensayo_dif('el cierre con 2 h sin costo', n_cierre like '%todavía no está completo%', true)
         || pg_temp.ensayo_dif('Administración: el mismo costo', n_admin->>'costo_pen', n_gerencia->>'costo_pen')
         || pg_temp.ensayo_dif('Administración: el mismo margen', n_admin->>'margen_pct', n_gerencia->>'margen_pct')
         || pg_temp.ensayo_dif('Administración no cierra', n_admin_cierre, '42501'::text)
         || pg_temp.ensayo_dif('Administración sí lee los cierres', n_cierres_admin::numeric, 1::numeric)
         || pg_temp.ensayo_dif('Requerimientos: su gasto no cambia con la luz ni la caja', n_gasto - 'ultima_actividad', o_gasto - 'ultima_actividad')
         || pg_temp.ensayo_dif('quién lee el costo completo', (select array_agg(x order by x) from unnest(n_leen) x), n_deben);
  if k ? 'SUPERVISOR_GENERAL' then
    f := f || pg_temp.ensayo_dif('Supervisión general: el mismo costo', n_general->>'costo_pen', n_gerencia->>'costo_pen')
           || pg_temp.ensayo_dif('Supervisión general: sin precio ni margen', coalesce(n_general->>'precio_neto_pen', n_general->>'margen_pct'), null::text)
           || pg_temp.ensayo_dif('Supervisión general no lee los cierres, que guardan el margen', n_cierres_general::numeric, 0::numeric)
           || pg_temp.ensayo_dif('ni por la auditoría', n_auditoria_general::numeric, 0::numeric);
  end if;
  f := f || v_vio;
  f := array_remove(f, null);

  if cardinality(f) > 0 then
    raise exception 'FALLO: % desfases: %', cardinality(f), array_to_string(f, ' | ');
  end if;
  raise exception 'ROLLBACK OK :: % cuentas, % sin acceso a Códigos internos. % al % %% (antes % %%), costo S/ % (mano de obra %, materiales %, servicios %, subcontratos %), compras aparte %, facturado % y cobrado %. BRECHAS :: costeo del código antes % / después % | tareo de las 5 h de la tarde % | costo de la OT según Gerencia % y según Administración % | margen_ot % || COSTEO COMPLETO :: Gerencia % | cierre: % | lo leen %',
    cardinality(v_puestos_vistos), cardinality(v_puestos_vistos) - 1, c, g_avance->>'avance', g_resumen->>'avance_medio',
    (g_resumen->>'mano_obra')::numeric + (g_resumen->>'materiales_pen')::numeric + (g_servicios->>'servicios_pen')::numeric
      + (g_subcontratos->>'subcontratos_pen')::numeric,
    g_resumen->>'mano_obra', g_resumen->>'materiales_pen', g_servicios->>'servicios_pen', g_subcontratos->>'subcontratos_pen',
    g_resumen->>'compras_pen', g_facturas->0->>'total', g_facturas->0->>'cobrado',
    b_antes, b_despues, b_tareo_extra, b_ot, b_ot_admin, b_margen,
    n_gerencia - array['cierre_id', 'cerrado_en', 'cerrado_por', 'costo_cerrado_pen', 'margen_cerrado_pen', 'margen_cerrado_pct'],
    n_cierre, n_leen;
end
$circuito$;
