-- Ventas y Tesorería necesitan consultar el importe real de la cotización; los catálogos
-- conservan su historial y solo se pueden borrar físicamente si no tienen referencias.
alter table public.cotizaciones_pdf
  add column if not exists monto_venta public.monto,
  add column if not exists moneda public.moneda;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cotizaciones_pdf'::regclass
      and conname = 'cotizaciones_pdf_monto_venta_positivo'
  ) then
    alter table public.cotizaciones_pdf
      add constraint cotizaciones_pdf_monto_venta_positivo
      check (monto_venta is null or monto_venta > 0);
  end if;
end;
$$;

create or replace view public.v_cotizaciones_pdf as
 select c.id,
    c.numero,
    c.estado::text as estado,
    c.observacion,
    c.cliente_id,
    cl.razon_social as cliente,
    c.tipo_carroceria_id,
    tc.nombre as carroceria,
    c.nombre_archivo,
    c.ruta_storage,
    c.tamano_bytes,
    c.creado_en,
    c.registrado_por,
    public.puesto_de(c.registrado_por) as registrado_por_nombre,
    c.revisado_en,
    public.puesto_de(c.revisado_por) as revisado_por_nombre,
    o.id as orden_id,
    o.numero as orden_numero,
    o.estado::text as orden_estado,
    exists (
      select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id
    ) as tuvo_orden,
    c.version,
    c.mime_type,
    c.archivo_subido_en,
    c.monto_venta,
    c.moneda
   from public.cotizaciones_pdf c
   left join public.clientes cl on cl.id = c.cliente_id
   left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
   left join lateral (
     select ot.id, ot.numero, ot.estado
       from public.ordenes_trabajo ot
      where ot.cotizacion_pdf_id = c.id and ot.estado <> 'ANULADA'::public.estado_ot
      limit 1
   ) o on true;
alter view public.v_cotizaciones_pdf set (security_invoker = on);
grant select on public.v_cotizaciones_pdf to authenticated;

update public.roles set nombre = 'Agente de Ventas' where codigo = 'VENDEDOR' and nombre = 'Comercial';
update public.usuarios u set cargo = 'Agente de Ventas'
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'VENDEDOR' and u.cargo = 'Ejecutiva comercial';

create or replace function public.editar_carroceria_ventas(p_id uuid, p_nombre text, p_descripcion text, p_activo boolean)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  if not (public.es_admin() or public.tiene_permiso('cotizaciones.crear')) then
    raise exception 'No tienes permiso para editar el catálogo de carrocerías.' using errcode = '42501';
  end if;
  if length(btrim(p_nombre)) < 3 or length(p_nombre) > 120 then
    raise exception 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.' using errcode = '22023';
  end if;
  update public.tipos_carroceria
     set nombre = btrim(p_nombre), descripcion = nullif(btrim(p_descripcion), ''), activo = p_activo
   where id = p_id
   returning id into v_id;
  if v_id is null then
    raise exception 'No se encontró la carrocería o tu perfil no tiene acceso.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
revoke all on function public.editar_carroceria_ventas(uuid,text,text,boolean) from public, anon;
grant execute on function public.editar_carroceria_ventas(uuid,text,text,boolean) to authenticated;

create or replace function public.fn_proteger_borrado_catalogos()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if tg_table_name = 'clientes' and (
    exists (select 1 from public.contactos_cliente where cliente_id = old.id)
    or exists (select 1 from public.unidades where cliente_id = old.id)
    or exists (select 1 from public.cotizaciones_pdf where cliente_id = old.id)
    or exists (select 1 from public.ordenes_trabajo where cliente_id = old.id)
    or exists (select 1 from public.ot_ventas_anteriores where cliente_id = old.id)
  ) then
    raise exception 'El cliente tiene contactos, unidades o historial. Desactívalo para conservar sus datos.' using errcode = '23503';
  elsif tg_table_name = 'unidades' and exists (
    select 1 from public.ordenes_trabajo where unidad_id = old.id
  ) then
    raise exception 'La unidad pertenece al historial de una orden. Desactívala para conservar sus datos.' using errcode = '23503';
  elsif tg_table_name = 'tipos_carroceria' and (
    exists (select 1 from public.cotizaciones_pdf where tipo_carroceria_id = old.id)
    or exists (select 1 from public.ordenes_trabajo where tipo_carroceria_id = old.id)
    or exists (select 1 from public.unidades where tipo_carroceria_id = old.id)
    or exists (select 1 from public.plantillas_ficha where tipo_carroceria_id = old.id)
    or exists (select 1 from public.plantillas_verificacion where tipo_carroceria_id = old.id)
  ) then
    raise exception 'La carrocería tiene cotizaciones, órdenes, unidades o fichas. Desactívala para conservar su historial.' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.fn_proteger_borrado_catalogos() from public, anon, authenticated;

drop trigger if exists proteger_borrado_cliente_con_historial on public.clientes;
create trigger proteger_borrado_cliente_con_historial before delete on public.clientes
  for each row execute function public.fn_proteger_borrado_catalogos();
drop trigger if exists proteger_borrado_unidad_con_historial on public.unidades;
create trigger proteger_borrado_unidad_con_historial before delete on public.unidades
  for each row execute function public.fn_proteger_borrado_catalogos();
drop trigger if exists proteger_borrado_carroceria_con_historial on public.tipos_carroceria;
create trigger proteger_borrado_carroceria_con_historial before delete on public.tipos_carroceria
  for each row execute function public.fn_proteger_borrado_catalogos();
