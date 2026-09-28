-- La empresa arma sus cotizaciones fuera del sistema y registra el PDF como
-- referencia. Las cotizaciones estructuradas de esta beta eran datos de prueba;
-- se quitan junto con su circuito, conservando cotizaciones_pdf y las OT.

-- Antes de quitar el esquema antiguo, las fichas de OT toman accesorios del
-- patrón técnico de su carrocería. El catálogo y las plantillas sí pertenecen
-- al trabajo de Diseño y permanecen.
create or replace function public.armar_ficha_ot(p_orden uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo uuid;
  v_plantilla uuid;
begin
  if pg_trigger_depth()=0 then
    if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
    perform public.exigir_permiso('diseno.planos');
    if not exists(select 1 from public.ordenes_trabajo
      where id=p_orden and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
      raise exception 'La OT no existe o está cerrada.';
    end if;
  end if;
  if public.usuario_actual() is not null and not (
       public.puede_ver_orden(p_orden)
       and (public.es_admin()
            or public.tiene_permiso('ordenes.editar')
            or public.tiene_permiso('ordenes.crear')
            or public.tiene_permiso('ordenes.aprobar')
            or public.tiene_permiso('ordenes.cambiar_estado')
            or public.tiene_permiso('produccion.registrar')
            or public.tiene_permiso('diseno.planos'))) then
    raise exception 'No puede armar la ficha de una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  select tipo_carroceria_id into v_tipo
    from public.ordenes_trabajo where id = p_orden;

  if v_tipo is not null then
    select id into v_plantilla
      from public.plantillas_ficha
     where tipo_carroceria_id = v_tipo and activa
     order by creado_en desc
     limit 1;
  end if;

  if v_plantilla is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.plantilla_ficha_accesorios a
     where a.plantilla_id = v_plantilla;
  end if;

  if not exists (select 1 from public.ot_verificaciones where orden_id = p_orden) then
    if v_tipo is not null
       and exists (select 1 from public.plantillas_verificacion where tipo_carroceria_id = v_tipo) then
      v_plantilla := v_tipo;
    else
      v_plantilla := null;
    end if;

    insert into public.ot_verificaciones (orden_id, numero, descripcion)
    select p_orden, v.numero, v.descripcion
      from public.plantillas_verificacion v
     where v.tipo_carroceria_id is not distinct from v_plantilla;
  end if;
end;
$$;

-- La planificación ahora parte de la fecha de la OT y del catálogo de etapas.
create or replace function public.programar_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_cursor date;
  v_inicio date;
  v_fin date;
  v_programadas integer := 0;
  r record;
begin
  select coalesce(o.fecha_inicio_programada, current_date)
    into v_cursor
    from public.ordenes_trabajo o
   where o.id = p_orden_id;

  if v_cursor is null then return 0; end if;

  for r in
    select e.id, greatest(ec.dias_estandar, 0) as dias
      from public.ot_etapas e
      join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
     where e.orden_id = p_orden_id
       and ec.activo
       and ec.dias_estandar > 0
       and e.fecha_inicio_programada is null
     order by e.orden_secuencia
  loop
    v_inicio := public.sumar_dias_habiles(v_cursor, 0);
    v_fin := public.sumar_dias_habiles(v_inicio, r.dias - 1);

    update public.ot_etapas
       set fecha_inicio_programada = v_inicio,
           fecha_fin_programada = v_fin
     where id = r.id;

    v_cursor := v_fin + 1;
    v_programadas := v_programadas + 1;
  end loop;

  return v_programadas;
end;
$$;

comment on function public.programar_etapas_ot(uuid) is
  'Programa las etapas de la OT desde su fecha de inicio y los días estándar del catálogo, encadenadas con el calendario laboral.';

-- El cambio de cliente sigue funcionando con cotizaciones PDF aprobadas. Se
-- quita de la rutina el vínculo antiguo y la tabla de pagos que desaparecen.
create or replace function public.editar_ot_con_historial(
  p_orden uuid, p_version timestamptz, p_datos jsonb, p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o public.ordenes_trabajo%rowtype;
  u public.unidades%rowtype;
  c public.cotizaciones_pdf%rowtype;
  antes jsonb;
  despues jsonb;
  detalle text;
  nuevo_cliente uuid;
begin
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  perform public.exigir_permiso('ordenes.editar');
  if not public.puede_ver_orden(p_orden) then raise exception 'No puedes editar esta orden.'; end if;
  if length(btrim(coalesce(p_motivo,''))) not between 5 and 1000 then
    raise exception 'Explica el motivo del cambio (5 a 1000 caracteres).';
  end if;
  if jsonb_typeof(p_datos) <> 'object' or p_datos is null then raise exception 'Datos incompletos.'; end if;
  if exists(select 1 from jsonb_object_keys(p_datos) k where k not in
    ('descripcion','prioridad','fecha_entrega_comprometida','codigo_interno','marca','modelo','unidad_version','cotizacion_nueva_id')) then
    raise exception 'El cambio contiene campos no permitidos.';
  end if;
  if length(btrim(coalesce(p_datos->>'descripcion',''))) not between 5 and 5000
    or coalesce(p_datos->>'prioridad','') not in ('BAJA','NORMAL','ALTA','URGENTE')
    or coalesce(p_datos->>'fecha_entrega_comprometida','') !~ '^\d{4}-\d{2}-\d{2}$'
    or length(coalesce(p_datos->>'codigo_interno','')) > 40
    or (nullif(btrim(coalesce(p_datos->>'codigo_interno','')),'') is not null
        and regexp_replace(btrim(p_datos->>'codigo_interno'), '[^A-Za-z0-9]', '', 'g') = '')
    or length(coalesce(p_datos->>'marca','')) > 80 or length(coalesce(p_datos->>'modelo','')) > 80 then
    raise exception 'Revisa descripción, prioridad, fecha y datos del chasis.';
  end if;

  select * into o from public.ordenes_trabajo where id=p_orden for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.actualizado_en is distinct from p_version then
    raise exception 'La OT cambió mientras la editabas. Recarga y revisa antes de guardar.';
  end if;
  if o.estado in ('ENTREGADA','FACTURADA','ANULADA') then raise exception 'La OT ya está cerrada.'; end if;
  select * into u from public.unidades where id=o.unidad_id for update;
  if u.id is not null and u.actualizado_en is distinct from (p_datos->>'unidad_version')::timestamptz then
    raise exception 'Los datos de la unidad cambiaron. Recarga antes de guardar.';
  end if;

  antes := jsonb_build_object('descripcion',o.descripcion,'prioridad',o.prioridad,
    'fecha_entrega_comprometida',o.fecha_entrega_comprometida,
    'codigo_interno',u.codigo_interno,'marca',u.marca,'modelo',u.modelo,
    'cliente',(select razon_social from public.clientes where id=o.cliente_id),
    'cliente_id',o.cliente_id,'cotizacion_pdf_id',o.cotizacion_pdf_id);
  nuevo_cliente := o.cliente_id;

  if nullif(p_datos->>'cotizacion_nueva_id','') is not null then
    perform public.exigir_permiso('cotizaciones.ver_pdf_comercial');
    select * into c from public.cotizaciones_pdf
     where id=(p_datos->>'cotizacion_nueva_id')::uuid for update;
    if not found or c.estado <> 'APROBADA' then raise exception 'Elige una nueva cotización aprobada.'; end if;
    if c.cliente_id is not distinct from o.cliente_id then raise exception 'La nueva venta debe corresponder a otro cliente.'; end if;
    if c.tipo_carroceria_id is distinct from o.tipo_carroceria_id then raise exception 'La nueva cotización debe ser de la misma carrocería.'; end if;
    if not exists(select 1 from public.clientes where id=c.cliente_id and activo) then raise exception 'El nuevo cliente no está activo.'; end if;
    if exists(select 1 from public.ordenes_trabajo where cotizacion_pdf_id=c.id and id<>o.id and estado<>'ANULADA') then
      raise exception 'La nueva cotización ya tiene una OT.';
    end if;
    if exists(select 1 from public.liberaciones_tesoreria where orden_id=o.id)
       or exists(select 1 from public.ot_entregas where orden_id=o.id) then
      raise exception 'Esta OT ya tiene liberación o entrega registrada. Resuelve esos documentos antes de cambiar de cliente.';
    end if;
    nuevo_cliente := c.cliente_id;
  end if;

  if u.id is not null and (
    nuevo_cliente is distinct from o.cliente_id
    or coalesce(u.codigo_interno,'') is distinct from btrim(coalesce(p_datos->>'codigo_interno',''))
    or coalesce(u.marca,'') is distinct from btrim(coalesce(p_datos->>'marca',''))
    or coalesce(u.modelo,'') is distinct from btrim(coalesce(p_datos->>'modelo',''))
  ) then
    if exists(select 1 from public.ordenes_trabajo where unidad_id=u.id and id<>o.id) then
      raise exception 'La unidad tiene otras OT. No se pueden cambiar sus datos compartidos desde esta orden.';
    end if;
    if exists(select 1 from public.unidades where id<>u.id
      and upper(regexp_replace(btrim(coalesce(codigo_interno,'')), '[^A-Za-z0-9]', '', 'g')) =
          upper(regexp_replace(btrim(coalesce(p_datos->>'codigo_interno','')), '[^A-Za-z0-9]', '', 'g'))
      and nullif(btrim(p_datos->>'codigo_interno'),'') is not null) then
      raise exception 'Ese código interno ya identifica otra unidad.';
    end if;
    update public.unidades set
      codigo_interno=nullif(upper(btrim(p_datos->>'codigo_interno')),''),
      marca=nullif(btrim(p_datos->>'marca'),''), modelo=nullif(btrim(p_datos->>'modelo'),''),
      cliente_id=case when nuevo_cliente is distinct from o.cliente_id then nuevo_cliente else cliente_id end
    where id=u.id;
  end if;

  if c.id is not null then
    insert into public.ot_ventas_anteriores(orden_id,cliente_id,cotizacion_pdf_id,datos,creado_por)
    values(o.id,o.cliente_id,o.cotizacion_pdf_id,antes,public.usuario_actual());
  end if;

  update public.ordenes_trabajo set
    descripcion=btrim(p_datos->>'descripcion'),
    prioridad=(p_datos->>'prioridad')::public.prioridad_ot,
    fecha_entrega_comprometida=(p_datos->>'fecha_entrega_comprometida')::date,
    cliente_id=nuevo_cliente,
    cotizacion_pdf_id=coalesce(c.id,o.cotizacion_pdf_id)
  where id=o.id;

  select jsonb_build_object('descripcion',ot.descripcion,'prioridad',ot.prioridad,
    'fecha_entrega_comprometida',ot.fecha_entrega_comprometida,
    'codigo_interno',un.codigo_interno,'marca',un.marca,'modelo',un.modelo,
    'cliente',cl.razon_social,'cliente_id',ot.cliente_id,'cotizacion_pdf_id',ot.cotizacion_pdf_id)
    into despues from public.ordenes_trabajo ot
    left join public.unidades un on un.id=ot.unidad_id
    left join public.clientes cl on cl.id=ot.cliente_id where ot.id=o.id;
  if antes=despues then raise exception 'No hay cambios para guardar.'; end if;
  select string_agg(format('%s: %s → %s',k,coalesce(antes->>k,'Sin dato'),coalesce(despues->>k,'Sin dato')),E'\n')
    into detalle from jsonb_object_keys(despues) k
   where antes->k is distinct from despues->k and k not in ('cliente_id','cotizacion_pdf_id');
  perform public.ot_registrar_evento_interna(o.id,'COMENTARIO',
    'Edición de OT. Motivo: '||btrim(p_motivo)||E'\n'||coalesce(detalle,''),
    jsonb_build_object('edicion_ot',true,'antes',antes,'despues',despues,'motivo',btrim(p_motivo)));
  return o.id;
end;
$$;

revoke all on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text) from public, anon;
grant execute on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text) to authenticated;

-- La OT abierta por taller ya no tiene una columna de cotización antigua.
create or replace function public.fn_ot_del_taller()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    if new.abierta_en_taller is distinct from old.abierta_en_taller then
      raise exception 'Que la orden % la abrió el taller no se cambia después.', old.numero
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.abierta_en_taller then
    if public.usuario_actual() is not null
       and not (public.es_admin() or public.tiene_permiso('ordenes.abrir_taller')) then
      raise exception 'Las órdenes del taller las abre el supervisor o el jefe de producción.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.estado <> 'BORRADOR' then
      raise exception 'Una orden del taller nace por revisar.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_del_taller() from public, anon, authenticated;

-- Las rutinas comerciales retiradas ya no deben bloquear la baja de sus tablas.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array[
         'arrancar_plazo_de_cotizacion', 'recalcular_totales_cotizacion',
         'cotizacion_sembrar_etapas', 'fn_cotizacion_etapa_totalizar',
         'fn_cotizacion_etapa_bloquear_cerrada', 'fn_cotizacion_transicion',
         'fn_cotizacion_avisar', 'fn_cotizacion_numero_inmutable',
         'fn_cotizacion_sembrar_programa', 'fn_cotizacion_traer_medidas_del_tipo',
         'fn_cotizacion_anular', 'fn_cotizacion_bloquear_borrado',
         'fn_cotizacion_calcular', 'fn_cotizacion_exigir_ficha_para_revision',
         'fn_cotizacion_traer_ficha_del_tipo', 'fn_partida_bloquear_cerrada',
         'fn_partida_calcular', 'fn_partida_recalcular_cabecera',
         'aplicar_plantilla_ficha', 'marcar_cotizaciones_vencidas',
         'guardar_cotizacion_como_plantilla', 'cotizaciones_por_estado',
         'fn_ot_una_por_unidad_cotizada', 'fn_pago_arranca_plazo',
         'generar_presupuesto_desde_cotizacion'
       ])
  loop
    execute format('drop function if exists %s cascade', f.firma);
  end loop;
end;
$$;

drop view if exists public.v_pagos_cotizacion;
drop view if exists public.cotizacion_ficha;
drop view if exists public.cotizaciones_detalle;

-- El resumen de OT deja de exponer campos comerciales; no hay vistas que
-- dependan de él en la base actual, y su lectura conserva los permisos actuales.
drop view public.ot_resumen;
create view public.ot_resumen with (security_invoker = true) as
select o.id, o.numero, o.estado, o.prioridad, o.tipo_trabajo,
       o.sede_id, s.nombre as sede, o.cliente_id, c.razon_social as cliente,
       c.numero_documento as cliente_documento, o.unidad_id,
       coalesce(u.placa::text, 'FMI '::text || u.numero_fmi) as placa,
       tc.nombre as tipo_carroceria, o.descripcion, o.fecha_registro,
       o.fecha_inicio_programada, o.fecha_fin_programada,
       o.fecha_entrega_comprometida, o.fecha_inicio_real, o.fecha_fin_real,
       o.avance_porcentaje, o.horas_estimadas, o.horas_reales,
       o.horas_reales::numeric - o.horas_estimadas::numeric as desviacion_horas,
       o.responsable_id, public.puesto_de(o.responsable_id) as responsable,
       count(e.id) as etapas_total,
       count(e.id) filter (where e.estado = 'TERMINADA'::public.estado_etapa_ot) as etapas_terminadas,
       count(e.id) filter (where e.estado = 'EN_PROCESO'::public.estado_etapa_ot) as etapas_en_proceso,
       case when o.estado = any(array['ENTREGADA'::public.estado_ot,'FACTURADA'::public.estado_ot,'ANULADA'::public.estado_ot]) then 0
            when o.fecha_entrega_comprometida is null then 0
            else greatest(current_date - o.fecha_entrega_comprometida, 0) end as dias_atraso,
       case when o.estado = any(array['ENTREGADA'::public.estado_ot,'FACTURADA'::public.estado_ot,'ANULADA'::public.estado_ot]) then null::integer
            when o.fecha_entrega_comprometida is null then null::integer
            else public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida) end as dias_habiles_restantes,
       u.codigo_interno, u.numero_chasis, u.marca, u.modelo, o.abierta_en_taller
  from public.ordenes_trabajo o
  left join public.clientes c on c.id=o.cliente_id
  left join public.sedes s on s.id=o.sede_id
  left join public.unidades u on u.id=o.unidad_id
  left join public.tipos_carroceria tc on tc.id=o.tipo_carroceria_id
  left join public.ot_etapas e on e.orden_id=o.id
 group by o.id,c.id,s.id,u.id,tc.id;
grant select on public.ot_resumen to authenticated;

-- La OT conserva su enlace y archivos PDF, pero no el vínculo heredado ni un
-- monto comercial que se inventaba al convertir la cotización de prueba.
alter table public.ordenes_trabajo
  drop column if exists cotizacion_id,
  drop column if exists moneda,
  drop column if exists monto_presupuestado;

alter table public.ot_ventas_anteriores
  drop column if exists cotizacion_id;

-- Quitar tablas dependientes de la cotización anterior, de más hijas a padre.
drop table if exists public.notas_cotizacion cascade;
drop table if exists public.cotizacion_etapas cascade;
drop table if exists public.cotizacion_especificaciones cascade;
drop table if exists public.cotizacion_accesorios cascade;
drop table if exists public.cotizacion_partidas cascade;
drop table if exists public.pagos_cliente cascade;
drop table if exists public.cotizaciones cascade;
drop table if exists public.clasificaciones_costeo cascade;

-- La serie y el tipo de correlativo para estas cotizaciones de prueba tampoco
-- quedan habilitados. Las otras series documentarias conservan sus valores.
delete from public.series_documentarias where tipo::text = 'COTIZACION';
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
     where t.typnamespace='public'::regnamespace
       and t.typname='tipo_correlativo' and e.enumlabel='COTIZACION'
  ) then
    drop function public.siguiente_correlativo(public.tipo_correlativo, text, uuid);
    drop function public.produccion_siguiente_numero(public.tipo_correlativo, uuid);
    alter type public.tipo_correlativo rename to tipo_correlativo_beta;
    create type public.tipo_correlativo as enum (
      'ORDEN_TRABAJO','REQUERIMIENTO','ORDEN_COMPRA','INGRESO_ALMACEN',
      'SALIDA_ALMACEN','DEVOLUCION_ALMACEN','AJUSTE_INVENTARIO','PARTE_DIARIO',
      'ACTA_CONFORMIDAD','INSPECCION_CALIDAD','TRANSFERENCIA_ALMACEN',
      'RECEPCION_COMPRA','ORDEN_SERVICIO'
    );
    alter table public.series_documentarias
      alter column tipo type public.tipo_correlativo
      using tipo::text::public.tipo_correlativo;
    drop type public.tipo_correlativo_beta;
  end if;
end;
$$;

create or replace function public.siguiente_correlativo(
  p_tipo public.tipo_correlativo,
  p_serie text default null,
  p_sede uuid default null
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_serie_id uuid;
  v_serie text;
  v_prefijo text;
  v_longitud int;
  v_formato text;
  v_numero bigint;
  v_texto text;
  v_resultado text;
begin
  if public.lote_de_prueba() is not null then
    return 'PRUEBA-' || lpad(nextval('public.pruebas_numero')::text, 4, '0');
  end if;

  if p_sede is not null then
    select id into v_serie_id from public.series_documentarias
     where tipo=p_tipo and (p_serie is null or serie=p_serie) and activo and sede_id=p_sede
     order by serie limit 1 for update;
  end if;
  if v_serie_id is null then
    select id into v_serie_id from public.series_documentarias
     where tipo=p_tipo and (p_serie is null or serie=p_serie) and activo and sede_id is null
     order by serie limit 1 for update;
  end if;
  if v_serie_id is null then
    raise exception 'No existe una serie documentaria activa para el tipo % (serie %, sede %)',
      p_tipo,coalesce(p_serie,'<cualquiera>'),coalesce(p_sede::text,'<global>')
      using errcode='no_data_found';
  end if;

  update public.series_documentarias
     set correlativo_actual=correlativo_actual+1,actualizado_en=now()
   where id=v_serie_id
  returning serie,prefijo,longitud,correlativo_actual,formato
    into v_serie,v_prefijo,v_longitud,v_numero,v_formato;

  v_texto:=v_numero::text;
  if length(v_texto)<v_longitud then v_texto:=lpad(v_texto,v_longitud,'0'); end if;
  v_resultado:=replace(v_formato,'{numero}',v_texto);
  v_resultado:=replace(v_resultado,'{serie}',v_serie);
  v_resultado:=replace(v_resultado,'{anio}',to_char(now(),'YYYY'));
  v_resultado:=replace(v_resultado,'{prefijo}',coalesce(nullif(v_prefijo,''),''));
  return regexp_replace(btrim(v_resultado,'-'),'-{2,}','-','g');
end;
$$;
comment on function public.siguiente_correlativo(public.tipo_correlativo,text,uuid) is
  'Entrega el siguiente número de una serie documentaria, bloqueando su fila para que dos procesos simultáneos no reciban el mismo.';
revoke all on function public.siguiente_correlativo(public.tipo_correlativo,text,uuid) from public,anon,authenticated;
grant execute on function public.siguiente_correlativo(public.tipo_correlativo,text,uuid) to service_role;

create or replace function public.produccion_siguiente_numero(
  p_tipo public.tipo_correlativo, p_sede uuid
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_sede is null then
    return public.siguiente_correlativo(p_tipo,null,null);
  end if;
  begin
    return public.siguiente_correlativo(p_tipo,null,p_sede);
  exception when no_data_found then
    return public.siguiente_correlativo(p_tipo,null,null);
  end;
end;
$$;
revoke all on function public.produccion_siguiente_numero(public.tipo_correlativo,uuid) from public,anon,authenticated;
grant execute on function public.produccion_siguiente_numero(public.tipo_correlativo,uuid) to service_role;

delete from public.roles_permisos
 where permiso_codigo in (
   'cotizaciones.ver', 'cotizaciones.editar', 'cotizaciones.aprobar',
   'cotizaciones.anular', 'cotizaciones.costear', 'pagos.ver', 'pagos.registrar'
 );
delete from public.permisos
 where codigo in (
   'cotizaciones.ver', 'cotizaciones.editar', 'cotizaciones.aprobar',
   'cotizaciones.anular', 'cotizaciones.costear', 'pagos.ver', 'pagos.registrar'
 );

-- Ajustes técnicos que solo existían para fabricar el PDF de venta dentro del
-- sistema. El tipo USD sigue siendo útil en el catálogo de clientes.
alter table public.empresa
  drop column if exists firma_nombre,
  drop column if exists firma_cargo,
  drop column if exists igv_porcentaje,
  drop column if exists moneda_base;

drop function if exists public.tipo_cambio_exigido(date);
drop function if exists public.tipo_cambio_vigente(date);
drop function if exists public.tipo_cambio_vigente();
drop table if exists public.tipos_cambio;

-- Los enum solo se quitan cuando ya no tengan lectores.
drop type if exists public.tipo_pago_cliente;
drop type if exists public.medio_pago;
drop type if exists public.tipo_costo_partida;
drop type if exists public.estado_cotizacion;

do $$
begin
  if to_regclass('public.cotizaciones') is not null
     or to_regclass('public.cotizacion_partidas') is not null
     or to_regclass('public.cotizacion_especificaciones') is not null
     or to_regclass('public.cotizacion_accesorios') is not null
     or to_regclass('public.cotizacion_etapas') is not null
     or to_regclass('public.pagos_cliente') is not null
     or to_regclass('public.clasificaciones_costeo') is not null
     or to_regclass('public.cotizacion_ficha') is not null
     or to_regclass('public.cotizaciones_detalle') is not null
     or to_regclass('public.v_pagos_cotizacion') is not null
     or to_regclass('public.tipos_cambio') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'ordenes_trabajo'
                   and column_name in ('cotizacion_id', 'moneda', 'monto_presupuestado'))
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'ot_ventas_anteriores'
                   and column_name = 'cotizacion_id')
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'empresa'
                   and column_name in ('firma_nombre','firma_cargo','igv_porcentaje','moneda_base')) then
    raise exception 'La limpieza de cotizaciones beta quedó incompleta.';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
              where t.typnamespace='public'::regnamespace
                and t.typname='tipo_correlativo' and e.enumlabel='COTIZACION') then
    raise exception 'Quedó activa la serie beta de cotizaciones.';
  end if;
end;
$$;
