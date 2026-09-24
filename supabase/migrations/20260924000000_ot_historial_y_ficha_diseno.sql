-- La oficina corrige la misma OT con motivo y versiones; Diseño llena su ficha.
-- No se renumeran documentos ni se trasladan pagos de una venta a otra.
create table if not exists public.ot_ventas_anteriores (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id),
  cliente_id uuid references public.clientes(id),
  cotizacion_id uuid references public.cotizaciones(id),
  cotizacion_pdf_id uuid references public.cotizaciones_pdf(id),
  datos jsonb not null,
  creado_por uuid not null references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.ot_ventas_anteriores enable row level security;
revoke all on public.ot_ventas_anteriores from public,anon,authenticated;
grant select on public.ot_ventas_anteriores to authenticated;
drop policy if exists ver_ventas_anteriores on public.ot_ventas_anteriores;
create policy ver_ventas_anteriores on public.ot_ventas_anteriores for select to authenticated
  using (public.puede_ver_orden(orden_id) and (public.es_admin() or public.tiene_permiso('cotizaciones.ver')));
select public.activar_timestamps('ot_ventas_anteriores');
select public.activar_auditoria('ot_ventas_anteriores');
select public.activar_registro_de_prueba('ot_ventas_anteriores');
-- Se consulta el historial por OT; las FK conservan cada documento comercial anterior.
create index if not exists ix_ot_ventas_anteriores_orden on public.ot_ventas_anteriores(orden_id);

-- codigo_interno ya existe por separado de numero_fmi. Impedir colisiones,
-- incluso si dos usuarios emiten una orden al mismo tiempo.
create unique index if not exists uq_unidades_codigo_interno_normalizado
  on public.unidades (upper(regexp_replace(btrim(codigo_interno), '[^A-Za-z0-9]', '', 'g')))
  where nullif(btrim(codigo_interno), '') is not null
    and regexp_replace(btrim(codigo_interno), '[^A-Za-z0-9]', '', 'g') <> '';

-- Se conserva el nombre del argumento RPC por compatibilidad; el dato ahora
-- se busca y guarda en codigo_interno. numero_fmi queda intacto.
create or replace function public.emitir_orden_de_cotizacion(
  p_cotizacion uuid, p_orden uuid, p_numero text, p_numero_fmi text,
  p_tipo_unidad public.tipo_unidad_carroceria, p_marca text, p_modelo text,
  p_fecha_entrega date, p_ruta_pdf text, p_nombre_pdf text, p_tamano_pdf bigint default null
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cot record;
  v_codigo constant text := nullif(upper(btrim(coalesce(p_numero_fmi,''))), '');
  v_clave constant text := upper(regexp_replace(coalesce(p_numero_fmi,''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo text := btrim(coalesce(p_numero,'')); v_numero text; v_correl bigint;
  v_unidad uuid; v_ajena text; v_sede uuid; v_nombre text;
  v_tipo constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
    when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
begin
  perform public.exigir_permiso('ordenes.crear');
  if v_crudo ~ '^\d{1,6}$' then
    v_numero := lpad(v_crudo,4,'0') || '-' || to_char((now() at time zone 'America/Lima')::date,'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_numero := lpad(split_part(v_crudo,'-',1),4,'0') || '-' || split_part(v_crudo,'-',2);
  else raise exception 'El número de la orden es el que trae su papel: 2922 o 2922-2026.' using errcode='check_violation'; end if;
  if exists(select 1 from public.ordenes_trabajo where numero=v_numero) then
    raise exception 'Ya hay una orden de trabajo %: revisa el número del papel.',v_numero using errcode='unique_violation';
  end if;
  select c.*,tc.nombre as carroceria into v_cot from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id=c.tipo_carroceria_id where c.id=p_cotizacion for update of c;
  if v_cot.id is null then raise exception 'No se encontró la cotización.' using errcode='foreign_key_violation'; end if;
  if v_cot.estado <> 'APROBADA' then raise exception 'La cotización % todavía no está aprobada por Gerencia.',v_cot.numero using errcode='check_violation'; end if;
  if exists(select 1 from public.ordenes_trabajo where cotizacion_pdf_id=p_cotizacion and estado<>'ANULADA') then
    raise exception 'La cotización % ya tiene su orden de trabajo.',v_cot.numero using errcode='unique_violation'; end if;
  if p_tipo_unidad is null then raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode='check_violation'; end if;
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/'||p_orden::text||'/'||split_part(p_ruta_pdf,'/',3) then
    raise exception 'El PDF de la orden no llegó en su sitio.' using errcode='check_violation'; end if;
  if v_clave='' and nullif(btrim(p_marca),'') is null and nullif(btrim(p_modelo),'') is null then
    raise exception 'Escribe el código interno, o la marca y el modelo si todavía no tiene.' using errcode='check_violation'; end if;
  if v_codigo is not null and v_clave='' then raise exception 'El código interno debe contener letras o números.' using errcode='check_violation'; end if;
  if v_clave<>'' then
    select u.id into v_unidad from public.unidades u
     where upper(regexp_replace(coalesce(u.codigo_interno,''),'[^A-Za-z0-9]','','g'))=v_clave
       and (u.cliente_id=v_cot.cliente_id or u.cliente_id is null)
     order by (u.cliente_id is not null) desc,u.creado_en desc limit 1;
    if v_unidad is null then
      select coalesce(cl.razon_social,'otro cliente') into v_ajena from public.unidades u
        left join public.clientes cl on cl.id=u.cliente_id
       where upper(regexp_replace(coalesce(u.codigo_interno,''),'[^A-Za-z0-9]','','g'))=v_clave limit 1;
      if v_ajena is not null then raise exception 'El código interno % ya pertenece a una unidad de %.',v_codigo,v_ajena using errcode='unique_violation'; end if;
    else update public.unidades set cliente_id=v_cot.cliente_id where id=v_unidad and cliente_id is null;
    end if;
  end if;
  if v_unidad is null then
    insert into public.unidades(cliente_id,codigo_interno,tipo_vehiculo,marca,modelo)
    values(v_cot.cliente_id,v_codigo,case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
      nullif(btrim(p_marca),''),nullif(btrim(p_modelo),'')) returning id into v_unidad;
  end if;
  v_sede:=coalesce(public.mi_sede(),(select id from public.sedes where activo order by nombre limit 1));
  insert into public.ordenes_trabajo(id,numero,cliente_id,unidad_id,tipo_carroceria_id,sede_id,tipo_trabajo,prioridad,
    descripcion,fecha_entrega_comprometida,estado,cotizacion_pdf_id,tipo_unidad)
  values(p_orden,v_numero,v_cot.cliente_id,v_unidad,v_cot.tipo_carroceria_id,v_sede,'FABRICACION','NORMAL',
    format('%s · %s · cotización %s',v_cot.carroceria,v_tipo,v_cot.numero),p_fecha_entrega,'APROBADA',p_cotizacion,p_tipo_unidad);
  v_correl:=split_part(v_numero,'-',1)::bigint;
  update public.series_documentarias set correlativo_actual=greatest(correlativo_actual,v_correl)
    where tipo='ORDEN_TRABAJO' and (sede_id is null or sede_id=v_sede) and correlativo_actual<v_correl;
  insert into public.ot_adjuntos(orden_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por)
    values(p_orden,'ORDEN',coalesce(nullif(btrim(p_nombre_pdf),''),'orden.pdf'),p_ruta_pdf,'application/pdf',p_tamano_pdf,public.usuario_actual());
  v_nombre:=coalesce(v_codigo,nullif(btrim(concat_ws(' ',nullif(btrim(p_marca),''),nullif(btrim(p_modelo),''))),''));
  perform public.notificar_a_permiso('produccion.actividades','Orden nueva en el taller',
    format('%s: %s, %s (%s). Armen la lista de su área.',v_numero,v_cot.carroceria,lower(v_tipo),coalesce(v_nombre,'sin código interno')),
    '/ordenes/'||p_orden||'?vista=actividades','ordenes_trabajo',p_orden,public.usuario_actual());
  perform public.notificar_a_permiso('diseno.planos','Orden nueva para desglosar',
    format('%s: %s, %s. Falta el desglose de Diseño.',v_numero,v_cot.carroceria,lower(v_tipo)),
    '/ordenes/'||p_orden||'?vista=cumplimiento','ordenes_trabajo',p_orden,public.usuario_actual());
  return p_orden;
end;
$function$;
revoke all on function public.emitir_orden_de_cotizacion(uuid,uuid,text,text,public.tipo_unidad_carroceria,text,text,date,text,text,bigint) from public,anon;
grant execute on function public.emitir_orden_de_cotizacion(uuid,uuid,text,text,public.tipo_unidad_carroceria,text,text,date,text,text,bigint) to authenticated;
create or replace function public.editar_ot_con_historial(
  p_orden uuid, p_version timestamptz, p_datos jsonb, p_motivo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_trabajo%rowtype;
  u public.unidades%rowtype;
  c public.cotizaciones_pdf%rowtype;
  antes jsonb; despues jsonb; detalle text; nuevo_cliente uuid;
begin
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  perform public.exigir_permiso('ordenes.editar');
  if not public.puede_ver_orden(p_orden) then raise exception 'No puedes editar esta orden.'; end if;
  if length(btrim(coalesce(p_motivo,''))) not between 5 and 1000 then
    raise exception 'Explica el motivo del cambio (5 a 1000 caracteres).'; end if;
  if jsonb_typeof(p_datos) <> 'object' or p_datos is null then raise exception 'Datos incompletos.'; end if;
  if exists(select 1 from jsonb_object_keys(p_datos) k where k not in
    ('descripcion','prioridad','fecha_entrega_comprometida','codigo_interno','marca','modelo','unidad_version','cotizacion_nueva_id')) then
    raise exception 'El cambio contiene campos no permitidos.'; end if;
  if length(btrim(coalesce(p_datos->>'descripcion',''))) not between 5 and 5000
    or coalesce(p_datos->>'prioridad','') not in ('BAJA','NORMAL','ALTA','URGENTE')
    or coalesce(p_datos->>'fecha_entrega_comprometida','') !~ '^\d{4}-\d{2}-\d{2}$'
    or length(coalesce(p_datos->>'codigo_interno','')) > 40
    or (nullif(btrim(coalesce(p_datos->>'codigo_interno','')),'') is not null
        and regexp_replace(btrim(p_datos->>'codigo_interno'), '[^A-Za-z0-9]', '', 'g') = '')
    or length(coalesce(p_datos->>'marca','')) > 80 or length(coalesce(p_datos->>'modelo','')) > 80 then
    raise exception 'Revisa descripción, prioridad, fecha y datos del chasis.'; end if;
  select * into o from public.ordenes_trabajo where id=p_orden for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.actualizado_en is distinct from p_version then raise exception 'La OT cambió mientras la editabas. Recarga y revisa antes de guardar.'; end if;
  if o.estado in ('ENTREGADA','FACTURADA','ANULADA') then raise exception 'La OT ya está cerrada.'; end if;
  select * into u from public.unidades where id=o.unidad_id for update;
  if u.id is not null and u.actualizado_en is distinct from (p_datos->>'unidad_version')::timestamptz then
    raise exception 'Los datos de la unidad cambiaron. Recarga antes de guardar.'; end if;
  antes := jsonb_build_object('descripcion',o.descripcion,'prioridad',o.prioridad,
    'fecha_entrega_comprometida',o.fecha_entrega_comprometida,
    'codigo_interno',u.codigo_interno,'marca',u.marca,'modelo',u.modelo,
    'cliente',(select razon_social from public.clientes where id=o.cliente_id),
    'cliente_id',o.cliente_id,'cotizacion_id',o.cotizacion_id,'cotizacion_pdf_id',o.cotizacion_pdf_id);
  nuevo_cliente := o.cliente_id;
  if nullif(p_datos->>'cotizacion_nueva_id','') is not null then
    perform public.exigir_permiso('cotizaciones.ver');
    select * into c from public.cotizaciones_pdf where id=(p_datos->>'cotizacion_nueva_id')::uuid for update;
    if not found or c.estado <> 'APROBADA' then raise exception 'Elige una nueva cotización aprobada.'; end if;
    if c.cliente_id is not distinct from o.cliente_id then raise exception 'La nueva venta debe corresponder a otro cliente.'; end if;
    if c.tipo_carroceria_id is distinct from o.tipo_carroceria_id then raise exception 'La nueva cotización debe ser de la misma carrocería.'; end if;
    if not exists(select 1 from public.clientes where id=c.cliente_id and activo) then raise exception 'El nuevo cliente no está activo.'; end if;
    if exists(select 1 from public.ordenes_trabajo where cotizacion_pdf_id=c.id and id<>o.id and estado<>'ANULADA') then
      raise exception 'La nueva cotización ya tiene una OT.'; end if;
    if exists(select 1 from public.liberaciones_tesoreria where orden_id=o.id)
      or exists(select 1 from public.ot_entregas where orden_id=o.id)
      or exists(select 1 from public.pagos_cliente where orden_id=o.id
        or (o.cotizacion_id is not null and cotizacion_id=o.cotizacion_id)) then
      raise exception 'Esta OT ya tiene liberación, entrega o pagos registrados. Resuelve esos documentos antes de cambiar de cliente.'; end if;
    nuevo_cliente := c.cliente_id;
  end if;
  if u.id is not null and (
    nuevo_cliente is distinct from o.cliente_id or
    coalesce(u.codigo_interno,'') is distinct from btrim(coalesce(p_datos->>'codigo_interno','')) or
    coalesce(u.marca,'') is distinct from btrim(coalesce(p_datos->>'marca','')) or
    coalesce(u.modelo,'') is distinct from btrim(coalesce(p_datos->>'modelo',''))
  ) then
    if exists(select 1 from public.ordenes_trabajo where unidad_id=u.id and id<>o.id) then
      raise exception 'La unidad tiene otras OT. No se pueden cambiar sus datos compartidos desde esta orden.'; end if;
    if exists(select 1 from public.unidades where id<>u.id and
      upper(regexp_replace(btrim(coalesce(codigo_interno,'')), '[^A-Za-z0-9]', '', 'g')) =
        upper(regexp_replace(btrim(coalesce(p_datos->>'codigo_interno','')), '[^A-Za-z0-9]', '', 'g'))
      and nullif(btrim(p_datos->>'codigo_interno'),'') is not null) then
      raise exception 'Ese código interno ya identifica otra unidad.'; end if;
    update public.unidades set
      codigo_interno=nullif(upper(btrim(p_datos->>'codigo_interno')),''),
      marca=nullif(btrim(p_datos->>'marca'),''), modelo=nullif(btrim(p_datos->>'modelo'),''),
      cliente_id=case when nuevo_cliente is distinct from o.cliente_id then nuevo_cliente else cliente_id end
    where id=u.id;
  end if;
  if c.id is not null then
    insert into public.ot_ventas_anteriores(orden_id,cliente_id,cotizacion_id,cotizacion_pdf_id,datos,creado_por)
    values(o.id,o.cliente_id,o.cotizacion_id,o.cotizacion_pdf_id,antes,public.usuario_actual());
  end if;
  update public.ordenes_trabajo set descripcion=btrim(p_datos->>'descripcion'),
    prioridad=(p_datos->>'prioridad')::public.prioridad_ot,
    fecha_entrega_comprometida=(p_datos->>'fecha_entrega_comprometida')::date,
    cliente_id=nuevo_cliente,
    cotizacion_id=case when c.id is not null then null else o.cotizacion_id end,
    cotizacion_pdf_id=coalesce(c.id,o.cotizacion_pdf_id),
    monto_presupuestado=case when c.id is not null then 0 else o.monto_presupuestado end
  where id=o.id;
  select jsonb_build_object('descripcion',ot.descripcion,'prioridad',ot.prioridad,
    'fecha_entrega_comprometida',ot.fecha_entrega_comprometida,
    'codigo_interno',un.codigo_interno,'marca',un.marca,'modelo',un.modelo,
    'cliente',cl.razon_social,'cliente_id',ot.cliente_id,
    'cotizacion_id',ot.cotizacion_id,'cotizacion_pdf_id',ot.cotizacion_pdf_id)
    into despues from public.ordenes_trabajo ot left join public.unidades un on un.id=ot.unidad_id
    left join public.clientes cl on cl.id=ot.cliente_id where ot.id=o.id;
  if antes=despues then raise exception 'No hay cambios para guardar.'; end if;
  select string_agg(format('%s: %s → %s',k,coalesce(antes->>k,'Sin dato'),coalesce(despues->>k,'Sin dato')),E'\n')
    into detalle from jsonb_object_keys(despues) k where antes->k is distinct from despues->k
      and k not in ('cliente_id','cotizacion_id','cotizacion_pdf_id');
  perform public.ot_registrar_evento_interna(o.id,'COMENTARIO',
    'Edición de OT. Motivo: '||btrim(p_motivo)||E'\n'||coalesce(detalle,''),
    jsonb_build_object('edicion_ot',true,'antes',antes,'despues',despues,'motivo',btrim(p_motivo)));
  return o.id;
end $$;
revoke all on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text) from public,anon;
grant execute on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text) to authenticated;

-- Diseño recibe una función acotada; no se le abre UPDATE general sobre la OT.
create or replace function public.guardar_ficha_diseno(p_orden uuid,p_datos jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.ordenes_trabajo%rowtype; v public.ordenes_trabajo%rowtype;
begin
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  perform public.exigir_permiso('diseno.planos');
  if not public.puede_ver_orden(p_orden) then raise exception 'No puedes llenar esta ficha.'; end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or exists(
    select 1 from jsonb_object_keys(p_datos) k where k not in
    ('largo_m','ancho_m','alto_m','capacidad_carga','ruedas','tipo_llantas','cantidad_ejes',
     'tipo_suspension','colores','caracteristicas_especiales','correo_contacto','encargado_produccion_id')
  ) then raise exception 'La ficha contiene campos no permitidos.'; end if;
  if pg_column_size(p_datos)>20000 then raise exception 'La ficha es demasiado extensa.'; end if;
  select * into o from public.ordenes_trabajo where id=p_orden for update;
  if not found or o.estado in ('ENTREGADA','FACTURADA','ANULADA') then raise exception 'La OT no existe o está cerrada.'; end if;
  v:=jsonb_populate_record(o,p_datos);
  if v.largo_m<=0 or v.ancho_m<=0 or v.alto_m<=0 or v.cantidad_ejes not between 1 and 8 then
    raise exception 'Revisa las medidas y la cantidad de ejes.'; end if;
  update public.ordenes_trabajo set largo_m=v.largo_m,ancho_m=v.ancho_m,alto_m=v.alto_m,
    capacidad_carga=v.capacidad_carga,ruedas=v.ruedas,tipo_llantas=v.tipo_llantas,cantidad_ejes=v.cantidad_ejes,
    tipo_suspension=v.tipo_suspension,colores=v.colores,caracteristicas_especiales=v.caracteristicas_especiales,
    correo_contacto=v.correo_contacto,encargado_produccion_id=v.encargado_produccion_id where id=p_orden;
  return p_orden;
end $$;
revoke all on function public.guardar_ficha_diseno(uuid,jsonb) from public,anon;
grant execute on function public.guardar_ficha_diseno(uuid,jsonb) to authenticated;

-- Solo Diseño (y el administrador) escribe las tres secciones.
do $$
declare t text; p record;
begin
  foreach t in array array['ot_accesorios','ot_repuestos','ot_verificaciones'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t and cmd<>'SELECT' loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('drop policy if exists ficha_diseno_insert on public.%I',t);
    execute format('drop policy if exists ficha_diseno_update on public.%I',t);
    execute format('drop policy if exists ficha_diseno_delete on public.%I',t);
    execute format('create policy ficha_diseno_insert on public.%I for insert to authenticated with check
      ((public.es_admin() or public.tiene_permiso(''diseno.planos'')) and public.puede_ver_orden(orden_id)
       and exists(select 1 from public.ordenes_trabajo o where o.id=orden_id and o.estado not in (''ENTREGADA'',''FACTURADA'',''ANULADA'')))',t);
    execute format('create policy ficha_diseno_update on public.%I for update to authenticated using
      ((public.es_admin() or public.tiene_permiso(''diseno.planos'')) and public.puede_ver_orden(orden_id)
       and exists(select 1 from public.ordenes_trabajo o where o.id=orden_id and o.estado not in (''ENTREGADA'',''FACTURADA'',''ANULADA'')))
      with check ((public.es_admin() or public.tiene_permiso(''diseno.planos'')) and public.puede_ver_orden(orden_id)
       and exists(select 1 from public.ordenes_trabajo o where o.id=orden_id and o.estado not in (''ENTREGADA'',''FACTURADA'',''ANULADA'')))',t);
    execute format('create policy ficha_diseno_delete on public.%I for delete to authenticated using
      ((public.es_admin() or public.tiene_permiso(''diseno.planos'')) and public.puede_ver_orden(orden_id)
       and exists(select 1 from public.ordenes_trabajo o where o.id=orden_id and o.estado not in (''ENTREGADA'',''FACTURADA'',''ANULADA'')))',t);
  end loop;
end $$;

-- Las vistas de plazos usan este cálculo como invoker. La base de producción
-- ya lo concede a usuarios autenticados; hacerlo explícito mantiene el banco
-- local y una instalación limpia con el mismo acceso, sin abrirlo a anon.
revoke all on function public.estado_del_plazo(date,timestamptz) from public, anon;
grant execute on function public.estado_del_plazo(date,timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.armar_ficha_ot(p_orden uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cotizacion uuid;
  v_tipo       uuid;
  v_fuente     uuid;
begin
  if pg_trigger_depth()=0 then
    if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
    perform public.exigir_permiso('diseno.planos');
    if not exists(select 1 from public.ordenes_trabajo where id=p_orden and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
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

  select cotizacion_id, tipo_carroceria_id into v_cotizacion, v_tipo
    from public.ordenes_trabajo where id = p_orden;

  if v_cotizacion is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.cotizacion_accesorios a
     where a.cotizacion_id = v_cotizacion;
  end if;

  if not exists (select 1 from public.ot_verificaciones where orden_id = p_orden) then
    if v_tipo is not null
       and exists (select 1 from public.plantillas_verificacion where tipo_carroceria_id = v_tipo) then
      v_fuente := v_tipo;
    end if;

    insert into public.ot_verificaciones (orden_id, numero, descripcion)
    select p_orden, v.numero, v.descripcion
      from public.plantillas_verificacion v
     where v.tipo_carroceria_id is not distinct from v_fuente;
  end if;
end;
$function$;
