-- Los avisos de permiso ya no nombran puestos (migración 20261023120000).
--
-- DKS objetó los avisos que, al negar algo, dicen qué puestos sí pueden: no eran
-- ciertos y cambian con cada permiso. Ahora dicen «No tienes permiso para …».
-- Aquí, con una cuenta de un puesto real que no tiene el permiso y `set local
-- role authenticated`, cada función del cambio da el texto nuevo, y quien sí
-- tiene el permiso sigue entrando. La rama del administrador de
-- exigir_permiso_del_puesto se prueba con el administrador, porque es suya; la
-- de los demás, con Gerencia. Los disparadores, con el puesto que de verdad
-- choca. El código de cada error no cambia.
--
-- Lo que otros checks ya montan se prueba allí, con el texto nuevo: anular el
-- reporte diario (342), el código interno de la OS (348), comprar un
-- requerimiento del otro tipo (349 y 383), los pasos de la ficha (100), la
-- hoja del área (220), la revisión de los reportes del taller (323), y el alta de
-- una cuenta con su DNI y el costo por hora propio (403_lo_que_dks_decidio_el_20_de_octubre).
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- ============================================ 0. El catálogo
-- Ninguna función de la base dice ya un aviso viejo: una migración que copie una
-- versión anterior de alguna lo devolvería sin que nada avise. Y cada una de las
-- 40 dice el suyo.
do $$
declare v_quedan text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_quedan
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and exists (select 1 from unnest(array[
           $t$'Los documentos de la orden de servicio los adjuntan Logística y Tesorería.'$t$,
           $t$'Los documentos de la orden de servicio los anulan Logística y Tesorería.'$t$,
           $t$'Anular un documento de compra corresponde a Logística.'$t$,
           $t$'El cronograma lo carga Diseño, el supervisor del área o el jefe.'$t$,
           $t$'La gestión de compras la ven Logística y el conductor.'$t$,
           $t$'Las cotizaciones aprobadas las ven Administración, Gerencia, Contabilidad y Tesorería.'$t$,
           $t$'Las guías de remisión las carga Contabilidad.'$t$,
           $t$'Lo ve Tesorería.'$t$,
           $t$'Las boletas de una parte las paga Tesorería.'$t$,
           $t$'Las OC con boleta las paga Tesorería.'$t$,
           $t$'Los pagos de servicio los lleva Tesorería.'$t$,
           $t$'Lo pagado de más lo descuenta Tesorería.'$t$,
           $t$'Lo descuenta Tesorería.'$t$,
           $t$'Las cuentas de la planilla las ve Tesorería, que paga.'$t$,
           $t$'Lo devuelve Almacén.'$t$,
           $t$'Lo dice Almacén o Logística.'$t$,
           $t$'El DNI del personal lo ve Recursos Humanos.'$t$,
           $t$'La búsqueda por DNI es de la portería y de Recursos Humanos.'$t$,
           $t$'Las marcas las anula Recursos Humanos; la portería, solo las de hoy.'$t$,
           $t$'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'$t$,
           $t$'El DNI y el costo por hora de una cuenta los cambia Recursos Humanos.'$t$,
           $t$'El DNI y el costo por hora de una cuenta los pone Recursos Humanos: da de alta la cuenta sin ellos.'$t$,
           $t$'Solo quien subió el reporte o Recursos Humanos lo pueden anular.'$t$,
           $t$'El costo lo cierran Costos y Materiales o Administración.'$t$,
           $t$'Solo Ventas, Gerencia o Administración confirman si el precio de la cotización incluye IGV.'$t$,
           $t$'El presupuesto de una OT lo fijan Gerencia o Administración.'$t$,
           $t$'Corregir una orden de servicio corresponde a Logística, y su detracción también a Contabilidad.'$t$,
           $t$'El código interno de la orden de servicio lo corrige Logística.'$t$,
           $t$'La cotización la aprueba o la rechaza Gerencia.'$t$,
           $t$'Las órdenes del taller las abre el supervisor o el jefe de producción.'$t$,
           $t$'Marcar la orden como facturada es de la oficina.'$t$,
           $t$'Solo Costos y Materiales registra el control vehicular.'$t$,
           $t$'Administración revisa los reportes de Supervisión.'$t$,
           $t$'Solo Diseño puede adjuntar versiones de planos.'$t$,
           $t$'No tienes permiso: este es un requerimiento de Administración y su orden de compra la hace la administradora.'$t$,
           $t$'No tienes permiso: este es un requerimiento de operación y su orden de compra la hace Logística.'$t$,
           $t$'No tienes permiso: el requerimiento de Administración lo registra y lo anula la administradora.'$t$,
           $t$'No tienes permiso: el requerimiento de operación lo registra y lo anula el área de Requerimientos.'$t$,
           $t$'Solo Administración puede crear pasos de verificación.'$t$,
           $t$'Solo Administración puede modificar los datos del paso.'$t$,
           $t$'Solo Diseño define las horas previstas de la etapa'$t$,
           $t$'Solo Diseño ordena las etapas de producción'$t$,
           $t$'Solo Producción registra el avance de las etapas'$t$,
           $t$'Solo Supervisión del área puede modificar esta tarea.'$t$,
           $t$'Solo Supervisión del área puede crear o modificar esta tarea.'$t$,
           $t$'El reporte de la tarea corresponde al supervisor.'$t$,
           $t$'La resuelve %, quien la anotó o el jefe de producción.'$t$,
           $t$'Solo un administrador puede cambiar el rol, el área, la sede, el costo por hora, el alcance o el estado de un usuario'$t$
         ]) v where position(v in p.prosrc) > 0);
  perform test.afirmar(v_quedan is null,
    'ninguna función nombra puestos en un aviso de permiso' || coalesce(': quedan ' || v_quedan, ''));

  select string_agg(f, ', ') into v_quedan
    from (values
           ('public.adjuntar_documento_servicio(uuid,uuid,text,text,text,text)', $t$'No tienes permiso para adjuntar documentos a la orden de servicio.'$t$),
           ('public.anular_documento_servicio(uuid,text)', $t$'No tienes permiso para anular documentos de la orden de servicio.'$t$),
           ('public.anular_documento_compra(uuid,text)', $t$'No tienes permiso para anular documentos de compra.'$t$),
           ('public.cargar_cronograma(uuid,jsonb)', $t$'No tienes permiso para cargar el cronograma.'$t$),
           ('public.compras_en_gestion()', $t$'No tienes permiso para ver la gestión de compras.'$t$),
           ('public.cotizaciones_para_facturar()', $t$'No tienes permiso para ver las cotizaciones aprobadas.'$t$),
           ('public.guias_por_emitir()', $t$'No tienes permiso para cargar guías de remisión.'$t$),
           ('public.notas_credito_a_favor()', $t$'No tienes permiso para ver las notas de crédito a favor.'$t$),
           ('public.partes_con_boleta_por_pagar()', $t$'No tienes permiso para ver las boletas de una parte por pagar.'$t$),
           ('public.compras_con_boleta_por_pagar()', $t$'No tienes permiso para ver las OC con boleta por pagar.'$t$),
           ('public.servicios_por_pagar()', $t$'No tienes permiso para ver los pagos de servicio.'$t$),
           ('public.facturas_para_descontar(uuid)', $t$'No tienes permiso para descontar lo pagado de más.'$t$),
           ('public.facturas_para_la_nota(uuid)', $t$'No tienes permiso para descontar notas de crédito.'$t$),
           ('public.planilla_diaria_cuentas(uuid)', $t$'No tienes permiso para ver las cuentas de la planilla.'$t$),
           ('public.ingresos_para_devolver()', $t$'No tienes permiso para devolver al proveedor.'$t$),
           ('public.dejar_de_esperar_reposicion(uuid,text)', $t$'No tienes permiso para dejar de esperar la reposición.'$t$),
           ('public.rrhh_dni_de_trabajadores()', $t$'No tienes permiso para ver el DNI del personal.'$t$),
           ('public.asistencia_buscar_por_dni(text)', $t$'No tienes permiso para buscar por DNI.'$t$),
           ('public.anular_asistencia(uuid,text)', $t$'No tienes permiso para anular marcas de asistencia.'$t$),
           ('public.anular_asistencia(uuid,text)', $t$'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.'$t$),
           ('public.exigir_permiso_del_puesto(text)', $t$'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.'$t$),
           ('public.fn_usuario_reservar_datos()', $t$'No tienes permiso para cambiar el DNI ni el costo por hora de una cuenta.'$t$),
           ('public.fn_usuario_reservar_datos_alta()', $t$'No tienes permiso para poner el DNI ni el costo por hora de una cuenta: da de alta la cuenta sin ellos.'$t$),
           ('public.anular_reporte_diario(uuid,text)', $t$'No tienes permiso para anular este reporte.'$t$),
           ('public.cerrar_costo_ot(uuid,text)', $t$'No tienes permiso para cerrar el costo de la OT.'$t$),
           ('public.confirmar_igv_cotizacion(uuid,boolean)', $t$'No tienes permiso para confirmar si el precio de la cotización incluye IGV.'$t$),
           ('public.fijar_presupuesto_ot(uuid,numeric,text)', $t$'No tienes permiso para fijar el presupuesto de una OT.'$t$),
           ('public.corregir_orden_servicio(uuid,text,text,text)', $t$'No tienes permiso para corregir la orden de servicio.'$t$),
           ('public.corregir_orden_servicio(uuid,text,text,text)', $t$'No tienes permiso para corregir el código interno de la orden de servicio.'$t$),
           ('public.fn_cotizacion_pdf_revision()', $t$'No tienes permiso para aprobar ni rechazar la cotización.'$t$),
           ('public.fn_ot_del_taller()', $t$'No tienes permiso para abrir órdenes del taller.'$t$),
           ('public.fn_ot_permiso_por_estado()', $t$'No tienes permiso para marcar la orden como facturada.'$t$),
           ('public.fn_proteger_control_vehicular()', $t$'No tienes permiso para registrar el control vehicular.'$t$),
           ('public.fn_reporte_revision()', $t$'No tienes permiso para revisar estos reportes.'$t$),
           ('public.registrar_version_plano(uuid,uuid,uuid,text)', $t$'No tienes permiso para adjuntar versiones de planos.'$t$),
           ('public.rq_exigir(text,text)', $t$'No tienes permiso para hacer la orden de compra de un requerimiento de Administración.'$t$),
           ('public.rq_exigir(text,text)', $t$'No tienes permiso para hacer la orden de compra de un requerimiento de operación.'$t$),
           ('public.rq_exigir(text,text)', $t$'No tienes permiso para registrar, corregir ni anular un requerimiento de Administración.'$t$),
           ('public.rq_exigir(text,text)', $t$'No tienes permiso para registrar, corregir ni anular un requerimiento de operación.'$t$),
           ('public.fn_guardar_marcas_verificacion()', $t$'No tienes permiso para crear pasos de verificación.'$t$),
           ('public.fn_guardar_marcas_verificacion()', $t$'No tienes permiso para modificar los datos del paso.'$t$),
           ('public.fn_ot_etapa_responsabilidades()', $t$'No tienes permiso para definir las horas previstas de la etapa.'$t$),
           ('public.fn_ot_etapa_responsabilidades()', $t$'No tienes permiso para ordenar las etapas de producción.'$t$),
           ('public.fn_ot_etapa_responsabilidades()', $t$'No tienes permiso para registrar el avance de las etapas.'$t$),
           ('public.validar_editor_tarea_ot()', $t$'No tienes permiso para modificar ni quitar esta tarea.'$t$),
           ('public.validar_editor_tarea_ot()', $t$'No tienes permiso para crear ni modificar esta tarea.'$t$),
           ('public.validar_reporte_taller()', $t$'No tienes permiso para registrar ni corregir el reporte de la tarea.'$t$),
           ('public.resolver_observacion_ot(uuid,text)', $t$'No tienes permiso para resolver esta observación.'$t$),
           ('public.fn_usuario_proteger_rol()', $t$'No tienes permiso para cambiar estos datos de la cuenta.'$t$)
         ) as x(f, nuevo)
   where position(nuevo in (select p.prosrc from pg_proc p where p.oid = f::regprocedure)) = 0;
  perform test.afirmar(v_quedan is null,
    'las 40 funciones dicen su aviso nuevo, los 49' || coalesce(': falta en ' || v_quedan, ''));
end $$;

-- ============================================ 1. Las cuentas, cada una con su puesto
insert into public.sedes (codigo, nombre) values ('QA435', 'Taller prueba 435') on conflict (codigo) do nothing;
do $$
declare v text; v_rol text; v_id uuid;
begin
  foreach v in array array['ADMIN:', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'CONDUCTOR:LOG',
                           'CONTABILIDAD:CON', 'COSTOS:', 'COSTOS_MATERIALES:', 'DISENO:DIS', 'GERENTE:GGE',
                           'OPERARIO:PRD', 'PORTERO:', 'RECURSOS_HUMANOS:RRH', 'REQUERIMIENTOS:REQ',
                           'SUPERVISOR:PRD', 'TESORERIA:TES', 'VENDEDOR:GCO'] loop
    v_rol := split_part(v, ':', 1);
    -- Una sola Supervisión activa por área: si la base ya tiene la de Producción, se usa esa.
    select u.id into v_id from public.usuarios u
      join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
      join public.areas a on a.id = u.area_id and a.codigo = 'PRD'
     where v_rol = 'SUPERVISOR' and u.activo limit 1;
    if v_id is not null then
      perform set_config('prueba.supervisor', v_id::text, true);
      continue;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(v_rol) || '.435@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id)
    select v_id, initcap(replace(v_rol, '_', ' ')), 'Check 435', lower(v_rol) || '.435@prueba.local', r.id,
           (select a.id from public.areas a where a.codigo = nullif(split_part(v, ':', 2), '')),
           (select s.id from public.sedes s where s.codigo = 'QA435')
      from public.roles r where r.codigo = v_rol;
    if not found then
      raise exception 'No existe el puesto %', v_rol;
    end if;
    perform set_config('prueba.' || lower(v_rol), v_id::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- El puesto no tiene ninguno de esos permisos. Sale del catálogo: si un día los
-- recibe, la prueba lo dice aquí y no con un «se esperaba un error».
create or replace function pg_temp.sin(p_clave text, p_permisos text[]) returns void language plpgsql as $$
begin
  perform test.afirmar(not exists (select 1 from public.usuarios u
                                     join public.roles_permisos rp on rp.rol_id = u.rol_id
                                    where u.id = pg_temp.id(p_clave) and rp.permiso_codigo = any (p_permisos)),
                       p_clave || ' no tiene ' || array_to_string(p_permisos, ', '));
end $$;
-- El código del error, que el banco y la aplicación leen (42501 responde 403).
create or replace function pg_temp.codigo(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'pasó';
exception when others then
  return sqlstate;
end $$;

-- ============================================ 2. Lo de Tesorería, Contabilidad y Logística, visto desde Almacén
select pg_temp.sin('almacenero', array['compras.crear', 'compras.programar_recojo', 'compras.recojo', 'compras.guia_remision',
  'compras.detraccion', 'contabilidad.facturar', 'cotizaciones.ver_aprobadas', 'tesoreria.registrar_pagos',
  'tesoreria.ver_documentos', 'tesoreria.pagar_servicios', 'cotizaciones.crear', 'cotizaciones.revisar',
  'cotizaciones.liberar_tesoreria', 'costos.controlar_ot', 'ordenes.editar', 'produccion.actividades', 'diseno.planos',
  'diseno.subir_pdf', 'planilla_diaria.pagar', 'planilla_diaria.preparar', 'rrhh.personal', 'asistencia.marcar',
  'requerimientos.emitir', 'requerimientos.administracion']);
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar('select count(*) from public.compras_en_gestion()',
  'Almacén no ve la gestión de compras', 'No tienes permiso para ver la gestión de compras.');
select test.debe_fallar('select count(*) from public.guias_por_emitir()',
  'ni carga guías de remisión', 'No tienes permiso para cargar guías de remisión.');
select test.debe_fallar('select count(*) from public.cotizaciones_para_facturar()',
  'ni ve las cotizaciones aprobadas', 'No tienes permiso para ver las cotizaciones aprobadas.');
select test.debe_fallar('select count(*) from public.compras_con_boleta_por_pagar()',
  'ni las OC con boleta por pagar', 'No tienes permiso para ver las OC con boleta por pagar.');
select test.debe_fallar('select count(*) from public.partes_con_boleta_por_pagar()',
  'ni las boletas de una parte', 'No tienes permiso para ver las boletas de una parte por pagar.');
select test.debe_fallar('select count(*) from public.notas_credito_a_favor()',
  'ni las notas de crédito a favor', 'No tienes permiso para ver las notas de crédito a favor.');
select test.debe_fallar('select count(*) from public.servicios_por_pagar()',
  'ni los pagos de servicio', 'No tienes permiso para ver los pagos de servicio.');
select test.debe_fallar($$ select public.adjuntar_documento_servicio(gen_random_uuid(), gen_random_uuid(), 'OTRO', null, 'x.pdf', 'x') $$,
  'no adjunta documentos a una OS', 'No tienes permiso para adjuntar documentos a la orden de servicio.');
select test.debe_fallar($$ select public.anular_documento_servicio(gen_random_uuid(), 'Era de otra orden de servicio') $$,
  'ni los anula', 'No tienes permiso para anular documentos de la orden de servicio.');
select test.debe_fallar($$ select public.anular_documento_compra(gen_random_uuid(), 'Era de otra compra del proveedor') $$,
  'ni anula un documento de compra', 'No tienes permiso para anular documentos de compra.');
select test.debe_fallar($$ select public.corregir_orden_servicio(gen_random_uuid(), 'PLANTA', null, null) $$,
  'ni corrige una OS', 'No tienes permiso para corregir la orden de servicio.');
select test.afirmar(pg_temp.codigo('select count(*) from public.compras_en_gestion()') = '42501',
  'el aviso sigue siendo de permiso (42501): el banco responde 403');
reset role;

-- Los que sí: Logística y el conductor la gestión; Contabilidad las guías y las
-- cotizaciones; Tesorería sus listas.
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_en_gestion()) >= 0, 'Logística ve la gestión de compras');
select test.debe_fallar($$ select public.adjuntar_documento_servicio(null, gen_random_uuid(), 'OTRO', null, 'x.pdf', 'x') $$,
  'Logística pasa el permiso de adjuntar a la OS', 'Vuelve a abrir el formulario');
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_en_gestion()) >= 0, 'el conductor también');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.guias_por_emitir()) >= 0, 'Contabilidad ve las guías por emitir');
select test.afirmar((select count(*) from public.cotizaciones_para_facturar()) >= 0, 'y las cotizaciones aprobadas');
select test.debe_fallar($$ select public.corregir_orden_servicio(gen_random_uuid(), null, 'NO_SUJETA', 'Prueba 435') $$,
  'Contabilidad pasa el permiso de corregir la OS', 'La orden de servicio no existe');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar()) >= 0
                    and (select count(*) from public.partes_con_boleta_por_pagar()) >= 0
                    and (select count(*) from public.notas_credito_a_favor()) >= 0
                    and (select count(*) from public.servicios_por_pagar()) >= 0
                    and (select count(*) from public.facturas_para_descontar(gen_random_uuid())) >= 0
                    and (select count(*) from public.facturas_para_la_nota(gen_random_uuid())) >= 0
                    and (select count(*) from public.planilla_diaria_cuentas(gen_random_uuid())) >= 0
                    and (select count(*) from public.cotizaciones_para_facturar()) >= 0,
  'Tesorería ve sus listas, lo que se descuenta y las cuentas de la planilla');
select test.debe_fallar($$ select public.anular_documento_servicio(gen_random_uuid(), 'corto') $$,
  'Tesorería pasa el permiso de anular documentos de la OS', 'Cuenta por qué se anula');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar($$ select public.anular_documento_compra(gen_random_uuid(), 'corto') $$,
  'Administración pasa el permiso de anular un documento de compra', 'Cuenta por qué se anula');
reset role;

-- ============================================ 3. Gerencia y Costos miran lo de Tesorería, pero no lo descuentan
-- tesoreria.ver_documentos sin tesoreria.registrar_pagos: «ver» les deja pasar, «descontar» no.
select pg_temp.sin('gerente', array['tesoreria.registrar_pagos', 'almacen.recibir', 'compras.crear', 'rrhh.personal',
  'planilla_diaria.pagar', 'planilla_diaria.preparar', 'asistencia.marcar']);
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar()) >= 0
                    and (select count(*) from public.partes_con_boleta_por_pagar()) >= 0
                    and (select count(*) from public.notas_credito_a_favor()) >= 0
                    and (select count(*) from public.servicios_por_pagar()) >= 0,
  'Gerencia ve las listas de Tesorería');
select test.debe_fallar('select count(*) from public.facturas_para_descontar(gen_random_uuid())',
  'pero no descuenta lo pagado de más', 'No tienes permiso para descontar lo pagado de más.');
select test.debe_fallar('select count(*) from public.facturas_para_la_nota(gen_random_uuid())',
  'ni una nota de crédito', 'No tienes permiso para descontar notas de crédito.');
select test.debe_fallar('select count(*) from public.ingresos_para_devolver()',
  'ni devuelve al proveedor', 'No tienes permiso para devolver al proveedor.');
select test.debe_fallar($$ select public.dejar_de_esperar_reposicion(gen_random_uuid(), 'El proveedor ya no lo repone') $$,
  'ni dice que ya no se espera la reposición', 'No tienes permiso para dejar de esperar la reposición.');
select test.debe_fallar('select count(*) from public.planilla_diaria_cuentas(gen_random_uuid())',
  'ni ve las cuentas de la planilla', 'No tienes permiso para ver las cuentas de la planilla.');
select test.debe_fallar('select count(*) from public.rrhh_dni_de_trabajadores()',
  'ni el DNI del personal', 'No tienes permiso para ver el DNI del personal.');
select test.debe_fallar($$ select public.asistencia_buscar_por_dni('40440435') $$,
  'ni busca por DNI', 'No tienes permiso para buscar por DNI.');
select test.debe_fallar($$ select public.anular_asistencia(gen_random_uuid(), 'Se marcó a otra persona') $$,
  'ni anula una marca', 'No tienes permiso para anular marcas de asistencia.');
-- La rama de los demás de exigir_permiso_del_puesto no cambia.
select test.debe_fallar('select public.rrhh_guardar_regla_tardanza(0, 3, 5)',
  'a Gerencia, lo de RR. HH. le sale con el permiso que falta', 'No tiene el permiso rrhh.personal');
reset role;
select pg_temp.como('costos');
set local role authenticated;
select test.afirmar((select count(*) from public.notas_credito_a_favor()) >= 0
                    and (select count(*) from public.compras_con_boleta_por_pagar()) >= 0,
  'Costos también mira lo de Tesorería');
reset role;
-- Almacén sí devuelve, y Logística dice que ya no se espera.
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.ingresos_para_devolver()) >= 0, 'Almacén ve lo que se puede devolver');
select test.debe_fallar($$ select public.dejar_de_esperar_reposicion(gen_random_uuid(), 'corto') $$,
  'y pasa el permiso de dejar de esperar la reposición', 'Cuenta por qué ya no se espera');
reset role;

-- ============================================ 4. RR. HH., la portería y el administrador
select pg_temp.como('recursos_humanos');
set local role authenticated;
select test.afirmar((select count(*) from public.rrhh_dni_de_trabajadores()) >= 0
                    and (select count(*) from public.planilla_diaria_cuentas(gen_random_uuid())) >= 0
                    and public.asistencia_buscar_por_dni('40440435') is null,
  'Recursos Humanos ve los DNI y las cuentas de la planilla, y busca por DNI');
select test.debe_fallar($$ select public.anular_asistencia(gen_random_uuid(), 'corto') $$,
  'y pasa el permiso de anular una marca', 'Cuenta por qué se anula');
reset role;
select pg_temp.como('portero');
set local role authenticated;
select test.afirmar(public.asistencia_buscar_por_dni('40440435') is null, 'la portería busca por DNI');
reset role;

-- El administrador ve lo de RR. HH. y no lo cambia: es su rama, y la de todas las
-- funciones que llaman a exigir_permiso_del_puesto (también marcar la asistencia,
-- que es de la portería).
select pg_temp.como('admin');
set local role authenticated;
select test.debe_fallar('select public.rrhh_guardar_regla_tardanza(0, 3, 5)',
  'el administrador no cambia la regla de tardanza',
  'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.');
select test.debe_fallar($$ select public.marcar_asistencia(gen_random_uuid(), gen_random_uuid(), 'SALIDA', null) $$,
  'ni marca la asistencia', 'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.');
select test.debe_fallar($$ select public.anular_asistencia(gen_random_uuid(), 'Se marcó a otra persona') $$,
  'ni anula una marca', 'No tienes permiso para cambiar esto: el administrador lo ve, pero no lo cambia.');
select test.debe_fallar(format('update public.usuarios set costo_hora = 18 where id = %L', pg_temp.id('portero')),
  'ni cambia el costo por hora de una cuenta', 'No tienes permiso para cambiar el DNI ni el costo por hora de una cuenta.');
reset role;

-- ============================================ 5. La OT, la cotización, el plano y el requerimiento
select pg_temp.sin('vendedor', array['costos.controlar_ot', 'ordenes.editar']);
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($$ select public.cerrar_costo_ot(gen_random_uuid(), '') $$,
  'Ventas no cierra el costo de una OT', 'No tienes permiso para cerrar el costo de la OT.');
select test.debe_fallar($$ select public.confirmar_igv_cotizacion(gen_random_uuid(), true) $$,
  'Ventas pasa el permiso de confirmar el IGV', 'La cotización no existe');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($$ select public.confirmar_igv_cotizacion(gen_random_uuid(), true) $$,
  'Almacén no confirma el IGV de una cotización', 'No tienes permiso para confirmar si el precio de la cotización incluye IGV.');
select test.debe_fallar($$ select public.cargar_cronograma(gen_random_uuid(), '[]'::jsonb) $$,
  'ni carga el cronograma', 'No tienes permiso para cargar el cronograma.');
select test.debe_fallar($$ select public.registrar_version_plano(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'plano.pdf') $$,
  'ni adjunta versiones de planos', 'No tienes permiso para adjuntar versiones de planos.');
select test.debe_fallar($$ select public.emitir_requerimiento(gen_random_uuid(), 'OPERACION', gen_random_uuid(), 'PLANTA',
                                                             'Para la prueba 435', null, '[]'::jsonb) $$,
  'ni registra un requerimiento de operación', 'No tienes permiso para registrar, corregir ni anular un requerimiento de operación.');
reset role;
select pg_temp.sin('costos_materiales', array['cotizaciones.revisar', 'ordenes.editar', 'cotizaciones.ver_pdf_comercial']);
select pg_temp.como('costos_materiales');
set local role authenticated;
select test.debe_fallar($$ select public.fijar_presupuesto_ot(gen_random_uuid(), 1000, 'Presupuesto de la prueba 435') $$,
  'Costos y Materiales no fija el presupuesto', 'No tienes permiso para fijar el presupuesto de una OT.');
select test.debe_fallar($$ select public.cerrar_costo_ot(gen_random_uuid(), '') $$,
  'pero pasa el permiso de cerrar el costo', 'La OT no existe');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select public.fijar_presupuesto_ot(gen_random_uuid(), 1000, 'Presupuesto de la prueba 435') $$,
  'Gerencia pasa el permiso de fijar el presupuesto', 'La OT no existe');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar($$ select public.cargar_cronograma(gen_random_uuid(), '[]'::jsonb) $$,
  'el supervisor pasa el permiso de cargar el cronograma', 'No se encontró la orden');
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select test.debe_fallar($$ select public.registrar_version_plano(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'plano.pdf') $$,
  'Diseño pasa el permiso de adjuntar versiones', 'No tienes acceso a este plano');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar($$ select public.emitir_requerimiento(gen_random_uuid(), 'ADMINISTRACION', gen_random_uuid(), 'PLANTA',
                                                             'Para la prueba 435', null, '[]'::jsonb) $$,
  'Requerimientos no registra uno de Administración',
  'No tienes permiso para registrar, corregir ni anular un requerimiento de Administración.');
select test.debe_fallar($$ select public.emitir_requerimiento(null, 'OPERACION', gen_random_uuid(), 'PLANTA',
                                                             'Para la prueba 435', null, '[]'::jsonb) $$,
  'pero pasa el permiso del de operación', 'Vuelve a abrir el formulario del requerimiento');
reset role;

-- ============================================ 6. Los disparadores, con el puesto que choca
-- El armazón —el cliente, la OT y sus etapas— lo ponen el administrador y Diseño.
select pg_temp.como('admin');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000435', 'QA CLIENTE 435');
do $$
declare v text;
begin
  foreach v in array array['ot', 'ot_cerrada', 'etapa1', 'etapa2', 'cotizacion'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;
select set_config('prueba.cliente', (select id::text from public.clientes where numero_documento = '20990000435'), true);
select set_config('prueba.sede', (select id::text from public.sedes where codigo = 'QA435'), true);
insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
select pg_temp.id(x.clave), x.numero, pg_temp.id('cliente'), pg_temp.id('sede'), 'FABRICACION', 'NORMAL', 'Tolva de la prueba 435', 'APROBADA'
  from (values ('ot', '8435-2026'), ('ot_cerrada', '8436-2026')) as x(clave, numero);
select pg_temp.como('diseno');
set local role authenticated;
select public.guardar_etapas_libres(pg_temp.id('ot'), jsonb_build_array(
  jsonb_build_object('id', pg_temp.id('etapa1'), 'nombre', 'Planos de fabricación',
                     'area_id', (select id from public.areas where codigo = 'DIS'), 'peso_pct', 40),
  jsonb_build_object('id', pg_temp.id('etapa2'), 'nombre', 'Armado de estructura',
                     'area_id', (select id from public.areas where codigo = 'PRD'), 'peso_pct', 60)), null);
reset role;

-- Las etapas: Administración (ordenes.editar, sin diseno.planos ni produccion.registrar) no las define.
select pg_temp.sin('administracion', array['diseno.planos', 'produccion.registrar']);
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format('update public.ot_etapas set horas_estimadas = 12 where id = %L', pg_temp.id('etapa2')),
  'Administración no define las horas previstas de una etapa', 'No tienes permiso para definir las horas previstas de la etapa.');
select test.debe_fallar(format('update public.ot_etapas set orden_secuencia = 9 where id = %L', pg_temp.id('etapa2')),
  'ni ordena las etapas', 'No tienes permiso para ordenar las etapas de producción.');
select test.afirmar(pg_temp.codigo(format('update public.ot_etapas set horas_estimadas = 12 where id = %L', pg_temp.id('etapa2'))) = 'P0001',
  'el aviso del disparador sigue sin código propio (P0001): el banco responde 400');
reset role;
select pg_temp.como('diseno');
set local role authenticated;
do $$
declare v_n integer;
begin
  update public.ot_etapas set horas_estimadas = 12 where id = pg_temp.id('etapa2');
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Diseño sí define las horas previstas');
end $$;
reset role;
-- El avance de una etapa: en las OT de antes del plan de Diseño (plan_etapas_manual
-- en falso, que ya no se puede crear) lo registra quien tiene produccion.registrar.
set local session_replication_role = replica;
update public.ordenes_trabajo set plan_etapas_manual = false where id = pg_temp.id('ot');
set local session_replication_role = origin;
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format('update public.ot_etapas set avance_porcentaje = 10 where id = %L', pg_temp.id('etapa2')),
  'Administración no registra el avance de una etapa', 'No tienes permiso para registrar el avance de las etapas.');
reset role;
select pg_temp.como('operario');
set local role authenticated;
do $$
declare v_n integer;
begin
  update public.ot_etapas set avance_porcentaje = 10 where id = pg_temp.id('etapa2');
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'el operario, con produccion.registrar, sí lo registra');
end $$;
reset role;

-- Abrir una orden del taller: el supervisor ya no tiene ordenes.abrir_taller.
select pg_temp.sin('supervisor', array['ordenes.abrir_taller']);
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(format($q$insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad,
                                                                       descripcion, estado, abierta_en_taller)
                                  values ('8437-2026', %L, %L, 'REPARACION', 'NORMAL', 'Abierta en el taller 435', 'BORRADOR', true)$q$,
                               pg_temp.id('cliente'), pg_temp.id('sede')),
  'el supervisor no abre una orden del taller', 'No tienes permiso para abrir órdenes del taller.');
reset role;

-- La observación de una OT: la resuelve su área, quien la anotó o quien aprueba los reportes.
select pg_temp.como('gerente');
set local role authenticated;
select set_config('prueba.observacion', public.levantar_observacion_ot(pg_temp.id('ot'),
         (select id from public.areas where codigo = 'PRD'), 'Falta soldar el larguero de la prueba 435')::text, true);
reset role;
select pg_temp.sin('comprador', array['produccion.aprobar_reportes']);
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(format($q$select public.resolver_observacion_ot(%L, 'Ya se soldó')$q$, pg_temp.id('observacion')),
  'Logística ve la OT, pero no resuelve una observación de Producción', 'No tienes permiso para resolver esta observación.');
select test.afirmar(pg_temp.codigo(format($q$select public.resolver_observacion_ot(%L, 'Ya se soldó')$q$, pg_temp.id('observacion'))) = '23514',
  'esa sigue siendo check_violation (23514)');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select public.resolver_observacion_ot(pg_temp.id('observacion'), 'Se soldó el larguero y se revisó con la plantilla');
reset role;
select test.afirmar((select resuelta_en is not null and resuelta_por = pg_temp.id('administracion')
                       from public.ot_observaciones where id = pg_temp.id('observacion')),
  'Administración, que aprueba los reportes del taller, sí la resuelve');

-- El control vehicular: Almacén no lo registra; Costos y Materiales sí pasa.
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format('insert into public.ot_control_vehicular (orden_id, placa) values (%L, %L)', pg_temp.id('ot'), 'QA435'),
  'Almacén no registra el control vehicular', 'No tienes permiso para registrar el control vehicular.');
reset role;
select pg_temp.como('costos_materiales');
set local role authenticated;
do $$
declare v_n integer;
begin
  insert into public.ot_control_vehicular (orden_id, placa, registrado_por)
  values (pg_temp.id('ot'), 'QA435', pg_temp.id('costos_materiales'));
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Costos y Materiales sí lo registra');
end $$;
reset role;

-- La cotización: Ventas la registra, pero no la aprueba ni la rechaza.
select pg_temp.como('vendedor');
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                     mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
select pg_temp.id('cotizacion'), 'QA-435-2026', pg_temp.id('cliente'), (select id from public.tipos_carroceria order by nombre limit 1),
       'QA-435-2026.pdf', 'cot/' || pg_temp.id('cotizacion') || '/QA-435-2026.pdf', 'application/pdf', 120,
       pg_temp.id('vendedor'), 10000, 'PEN';
set local role authenticated;
select test.debe_fallar(format($q$update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Otra vez' where id = %L$q$,
                               pg_temp.id('cotizacion')),
  'Ventas no rechaza su cotización', 'No tienes permiso para aprobar ni rechazar la cotización.');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el detalle de la tolva' where id = pg_temp.id('cotizacion');
reset role;
select test.afirmar((select estado = 'RECHAZADA' from public.cotizaciones_pdf where id = pg_temp.id('cotizacion')),
  'Gerencia sí la rechaza');

-- Facturada: la OT entregada la marca quien edita las órdenes o cambia su
-- estado; Gerencia aprueba y anula, pero no la marca. La entrega se pone a mano.
set local session_replication_role = replica;
update public.ordenes_trabajo set estado = 'ENTREGADA' where id = pg_temp.id('ot_cerrada');
set local session_replication_role = origin;
select pg_temp.sin('gerente', array['ordenes.editar', 'ordenes.cambiar_estado']);
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar(format($q$update public.ordenes_trabajo set estado = 'FACTURADA' where id = %L$q$, pg_temp.id('ot_cerrada')),
  'Gerencia no marca la orden como facturada', 'No tienes permiso para marcar la orden como facturada.');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
update public.ordenes_trabajo set estado = 'FACTURADA' where id = pg_temp.id('ot_cerrada');
reset role;
select test.afirmar((select estado = 'FACTURADA' from public.ordenes_trabajo where id = pg_temp.id('ot_cerrada')),
  'Administración sí la marca');

rollback;
