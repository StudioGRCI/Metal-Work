-- La oficina libera una cotización aceptada para que Tesorería la observe;
-- Logística adjunta sus documentos de compra en un espacio financiero privado.
-- Diseño asigna un líder por OT y responsables por plano, sin cambiar las
-- cuentas existentes ni tocar los documentos comerciales ya registrados.

insert into public.permisos (codigo, modulo, descripcion) values
  ('cotizaciones.ver_pdf_comercial', 'Cotizaciones', 'Consultar cotizaciones PDF del circuito comercial'),
  ('cotizaciones.liberar_tesoreria', 'Administración', 'Liberar a Tesorería una cotización PDF ya aprobada'),
  ('tesoreria.ver_documentos', 'Tesorería', 'Consultar cotizaciones liberadas y documentos de compras'),
  ('diseno.asignar', 'Diseño', 'Asignar líder de Diseño y responsables de planos')
on conflict (codigo) do update
  set modulo = excluded.modulo, descripcion = excluded.descripcion;

-- Los perfiles conservan sus cuentas. El rol nuevo queda disponible para que
-- Administración asigne a la persona que lidere Diseño; no crea usuarios.
insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values ('DISENO_LIDER', 'Líder de Diseño', 'Coordina responsables y revisiones de planos por orden', 55, true)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  nivel = excluded.nivel,
  es_sistema = excluded.es_sistema;

with asignaciones(rol, permiso) as (
  values
    ('VENDEDOR', 'cotizaciones.ver_pdf_comercial'),
    ('GERENTE', 'cotizaciones.ver_pdf_comercial'),
    ('ADMINISTRACION', 'cotizaciones.ver_pdf_comercial'),
    ('ADMINISTRACION', 'cotizaciones.liberar_tesoreria'),
    ('GERENTE', 'tesoreria.ver_documentos'),
    ('COSTOS', 'tesoreria.ver_documentos'),
    ('DISENO_LIDER', 'diseno.planos'),
    ('DISENO_LIDER', 'diseno.revisar'),
    ('DISENO_LIDER', 'diseno.asignar'),
    ('DISENO_LIDER', 'requerimientos.ver'),
    ('DISENO_LIDER', 'requerimientos.crear'),
    ('DISENO_LIDER', 'clientes.ver'),
    ('DISENO_LIDER', 'cotizaciones.ver'),
    ('DISENO_LIDER', 'cotizaciones.ver_pdf_comercial'),
    ('DISENO_LIDER', 'cotizaciones.costear'),
    ('DISENO_LIDER', 'produccion.ver'),
    ('DISENO_LIDER', 'configuracion.ver'),
    ('DISENO_LIDER', 'ordenes.listar'),
    ('DISENO_LIDER', 'ordenes.ver')
)
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, a.permiso from asignaciones a join public.roles r on r.codigo = a.rol
on conflict (rol_id, permiso_codigo) do nothing;

-- Costos/tesorería y los perfiles técnicos solo acceden al PDF por la bandeja
-- después de la liberación; quita asignaciones antiguas si se reejecuta.
delete from public.roles_permisos rp
using public.roles r
where rp.rol_id = r.id
  and rp.permiso_codigo = 'cotizaciones.ver_pdf_comercial'
  and r.codigo in ('COSTOS', 'DISENO', 'JEFE_TALLER', 'JEFE_PRODUCCION', 'SUPERVISOR', 'OPERARIO');

-- La liberación de una cotización comercial es distinta de liberar la salida
-- física del vehículo. Se conserva como evidencia y no se borra.
create table if not exists public.cotizaciones_pdf_liberaciones_tesoreria (
  id uuid primary key default gen_random_uuid(),
  cotizacion_pdf_id uuid not null unique
    references public.cotizaciones_pdf(id) on delete restrict,
  liberado_por uuid not null default public.usuario_actual()
    references public.usuarios(id) on delete restrict,
  liberado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.cotizaciones_pdf_liberaciones_tesoreria is
  'Constancia de Administración: cotización comercial aprobada y liberada para observación de Tesorería.';

create table if not exists public.cotizaciones_pdf_observaciones_tesoreria (
  id uuid primary key default gen_random_uuid(),
  cotizacion_pdf_id uuid not null
    references public.cotizaciones_pdf(id) on delete restrict,
  observacion text not null check (length(btrim(observacion)) between 3 and 2000),
  registrado_por uuid not null default public.usuario_actual()
    references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now()
);
create index if not exists idx_cotizaciones_pdf_observaciones_tesoreria_cotizacion
  on public.cotizaciones_pdf_observaciones_tesoreria (cotizacion_pdf_id, creado_en desc);
comment on table public.cotizaciones_pdf_observaciones_tesoreria is
  'Historial append-only de observaciones de Tesorería sobre cotizaciones liberadas.';

alter table public.cotizaciones_pdf_liberaciones_tesoreria enable row level security;
alter table public.cotizaciones_pdf_observaciones_tesoreria enable row level security;
revoke all on public.cotizaciones_pdf_liberaciones_tesoreria,
  public.cotizaciones_pdf_observaciones_tesoreria from public, anon, authenticated;
grant select, insert on public.cotizaciones_pdf_liberaciones_tesoreria to authenticated;
grant select, insert on public.cotizaciones_pdf_observaciones_tesoreria to authenticated;

drop policy if exists ver_liberaciones_cotizacion_tesoreria
  on public.cotizaciones_pdf_liberaciones_tesoreria;
create policy ver_liberaciones_cotizacion_tesoreria
  on public.cotizaciones_pdf_liberaciones_tesoreria for select to authenticated
  using (public.es_admin() or public.tiene_permiso('tesoreria.ver_documentos')
    or public.tiene_permiso('cotizaciones.ver_pdf_comercial'));
drop policy if exists crear_liberacion_cotizacion_tesoreria
  on public.cotizaciones_pdf_liberaciones_tesoreria;
create policy crear_liberacion_cotizacion_tesoreria
  on public.cotizaciones_pdf_liberaciones_tesoreria for insert to authenticated
  with check (
    public.tiene_permiso('cotizaciones.liberar_tesoreria')
    and liberado_por = public.usuario_actual()
    and exists (select 1 from public.cotizaciones_pdf c
      join public.usuarios u on u.id = c.revisado_por and u.activo
      join public.roles r on r.id = u.rol_id and r.codigo = 'GERENTE'
      where c.id = cotizacion_pdf_id and c.estado = 'APROBADA')
  );
drop policy if exists ver_observaciones_cotizacion_tesoreria
  on public.cotizaciones_pdf_observaciones_tesoreria;
create policy ver_observaciones_cotizacion_tesoreria
  on public.cotizaciones_pdf_observaciones_tesoreria for select to authenticated
  using (public.es_admin() or public.tiene_permiso('tesoreria.ver_documentos'));
drop policy if exists crear_observacion_cotizacion_tesoreria
  on public.cotizaciones_pdf_observaciones_tesoreria;
create policy crear_observacion_cotizacion_tesoreria
  on public.cotizaciones_pdf_observaciones_tesoreria for insert to authenticated
  with check (
    public.tiene_permiso('tesoreria.ver_documentos')
    and registrado_por = public.usuario_actual()
    and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
      where l.cotizacion_pdf_id = cotizaciones_pdf_observaciones_tesoreria.cotizacion_pdf_id)
  );

select public.activar_timestamps('cotizaciones_pdf_liberaciones_tesoreria');
select public.activar_auditoria('cotizaciones_pdf_liberaciones_tesoreria');
select public.activar_registro_de_prueba('cotizaciones_pdf_liberaciones_tesoreria');
select public.activar_registro_de_prueba('cotizaciones_pdf_observaciones_tesoreria');

-- RLS existente permitía leer el PDF a cualquier persona con cotizaciones.ver,
-- incluso perfiles de taller. Esta política restrictiva deja el original a
-- Ventas/Gerencia/Administración; Tesorería lo ve solo tras la liberación.
drop policy if exists alcance_cotizacion_pdf_comercial_tesoreria on public.cotizaciones_pdf;
create policy alcance_cotizacion_pdf_comercial_tesoreria on public.cotizaciones_pdf
  as restrictive for select to authenticated using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
    or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
      select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
      where l.cotizacion_pdf_id = cotizaciones_pdf.id
    ))
  );
drop policy if exists ver_cotizaciones_pdf on public.cotizaciones_pdf;
create policy ver_cotizaciones_pdf on public.cotizaciones_pdf
  for select to authenticated using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
    or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
      select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
      where l.cotizacion_pdf_id = cotizaciones_pdf.id
    ))
  );
drop policy if exists alcance_versiones_cotizacion_pdf_comercial_tesoreria
  on public.cotizaciones_pdf_versiones;
create policy alcance_versiones_cotizacion_pdf_comercial_tesoreria
  on public.cotizaciones_pdf_versiones as restrictive for select to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
    or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
      select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
      where l.cotizacion_pdf_id = cotizaciones_pdf_versiones.cotizacion_id
    ))
  );
drop policy if exists ver_cotizaciones_pdf_versiones on public.cotizaciones_pdf_versiones;
create policy ver_cotizaciones_pdf_versiones on public.cotizaciones_pdf_versiones
  for select to authenticated using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
    or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
      select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
      where l.cotizacion_pdf_id = cotizaciones_pdf_versiones.cotizacion_id
    ))
  );
-- La vista legacy tiene security_invoker=false para formar nombres del personal;
-- sus permisos y el enlace al almacenamiento deben seguir exactamente el RLS.
-- El enlace firmado aplica también las mismas fronteras que la fila PDF.
drop policy if exists mw_leer_cotizaciones_pdf on storage.objects;
create policy mw_leer_cotizaciones_pdf on storage.objects
  for select to authenticated using (
    bucket_id = 'cotizaciones-pdf'
    and (
      public.es_admin()
      or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
      or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
        select 1 from public.cotizaciones_pdf c
        join public.cotizaciones_pdf_liberaciones_tesoreria l
          on l.cotizacion_pdf_id = c.id
        where c.ruta_storage = objects.name
      ))
      or (public.tiene_permiso('tesoreria.ver_documentos') and exists (
        select 1 from public.cotizaciones_pdf_versiones v
        join public.cotizaciones_pdf_liberaciones_tesoreria l
          on l.cotizacion_pdf_id = v.cotizacion_id
        where v.ruta_storage = objects.name
      ))
    )
  );

-- La función es la única puerta para liberar: valida estado y permite reintento
-- seguro cuando el navegador perdió la respuesta después de guardar.
create or replace function public.liberar_cotizacion_a_tesoreria(p_cotizacion uuid)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_estado public.estado_cotizacion_pdf; v_revisor uuid; v_rol text; v_id uuid;
begin
  perform public.exigir_permiso('cotizaciones.liberar_tesoreria');
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  select estado, revisado_por into v_estado, v_revisor
    from public.cotizaciones_pdf where id = p_cotizacion for update;
  if not found then raise exception 'La cotización no existe.' using errcode = 'foreign_key_violation'; end if;
  if v_estado <> 'APROBADA' or v_revisor is null then
    raise exception 'Solo se puede liberar a Tesorería una cotización aprobada por Gerencia.' using errcode = 'check_violation';
  end if;
  select r.codigo into v_rol from public.usuarios u join public.roles r on r.id = u.rol_id
   where u.id = v_revisor and u.activo;
  if v_rol is distinct from 'GERENTE' then
    raise exception 'La aprobación registrada debe pertenecer a Gerencia.' using errcode = 'check_violation';
  end if;
  select id into v_id from public.cotizaciones_pdf_liberaciones_tesoreria
    where cotizacion_pdf_id = p_cotizacion;
  if v_id is not null then return v_id; end if;
  insert into public.cotizaciones_pdf_liberaciones_tesoreria (cotizacion_pdf_id, liberado_por)
    values (p_cotizacion, public.usuario_actual()) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.liberar_cotizacion_a_tesoreria(uuid) from public, anon;
grant execute on function public.liberar_cotizacion_a_tesoreria(uuid) to authenticated;

-- Logística conserva los documentos que explican cada compra. Tesorería y
-- Logística pueden consultarlos; ningún perfil de taller recibe permisos aquí.
create table if not exists public.documentos_compra_material (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  tipo text not null check (tipo in ('ORDEN_COMPRA','ORDEN_PAGO','ORDEN_SERVICIO','FACTURA','OTRO')),
  nombre_archivo text not null check (length(btrim(nombre_archivo)) between 1 and 200),
  ruta_storage text not null unique,
  mime_type text not null check (mime_type = 'application/pdf'),
  tamano_bytes bigint not null check (tamano_bytes between 1 and 20971520),
  subido_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists idx_documentos_compra_material_orden_compra
  on public.documentos_compra_material (orden_compra_id, creado_en desc);
comment on table public.documentos_compra_material is
  'PDF de orden de compra, pago, servicio o factura adjuntos por Logística y visibles para Tesorería.';

alter table public.documentos_compra_material enable row level security;
revoke all on public.documentos_compra_material from public, anon, authenticated;
grant select, insert on public.documentos_compra_material to authenticated;
drop policy if exists ver_documentos_compra_material on public.documentos_compra_material;
create policy ver_documentos_compra_material on public.documentos_compra_material
  for select to authenticated using (
    public.es_admin() or public.tiene_permiso('compras.ver')
    or public.tiene_permiso('tesoreria.ver_documentos')
  );
drop policy if exists ver_ordenes_compra_materiales on public.ordenes_compra_materiales;
create policy ver_ordenes_compra_materiales on public.ordenes_compra_materiales
  for select to authenticated using (
    (public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir')
      or public.tiene_permiso('tesoreria.ver_documentos'))
    and (public.tiene_permiso('tesoreria.ver_documentos') or exists (
      select 1 from public.requerimientos_materiales r
       where r.id = requerimiento_id and public.puede_ver_area_material(r.area_destino)
    ))
  );
drop policy if exists crear_documentos_compra_material on public.documentos_compra_material;
create policy crear_documentos_compra_material on public.documentos_compra_material
  for insert to authenticated with check (
    public.tiene_permiso('compras.crear')
    and subido_por = public.usuario_actual()
    and exists (select 1 from public.ordenes_compra_materiales oc
      where oc.id = orden_compra_id)
  );
select public.activar_timestamps('documentos_compra_material');
select public.activar_auditoria('documentos_compra_material');
select public.activar_registro_de_prueba('documentos_compra_material');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-compras', 'documentos-compras', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.orden_compra_de_ruta(p_ruta text)
returns uuid language plpgsql immutable set search_path = 'public' as $$
declare v text[];
begin
  v := string_to_array(coalesce(p_ruta, ''), '/');
  if array_length(v, 1) < 3 or v[1] <> 'compra'
     or v[2] !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return v[2]::uuid;
exception when others then return null;
end;
$$;
revoke all on function public.orden_compra_de_ruta(text) from public, anon, authenticated;

drop policy if exists mw_leer_documentos_compra on storage.objects;
create policy mw_leer_documentos_compra on storage.objects for select to authenticated
  using (bucket_id = 'documentos-compras' and exists (
    select 1 from public.documentos_compra_material d
    where d.ruta_storage = objects.name
      and (public.es_admin() or public.tiene_permiso('compras.ver')
        or public.tiene_permiso('tesoreria.ver_documentos'))
  ));
drop policy if exists mw_subir_documentos_compra on storage.objects;
create policy mw_subir_documentos_compra on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-compras'
    and public.tiene_permiso('compras.crear')
    and owner_id = auth.uid()::text
    and public.orden_compra_de_ruta(name) is not null
    and exists (select 1 from public.ordenes_compra_materiales oc
      where oc.id = public.orden_compra_de_ruta(name)));
drop policy if exists mw_eliminar_documento_compra_sin_registro on storage.objects;
create policy mw_eliminar_documento_compra_sin_registro on storage.objects for delete to authenticated
  using (bucket_id = 'documentos-compras' and owner_id = auth.uid()::text
    and not exists (select 1 from public.documentos_compra_material d
      where d.ruta_storage = objects.name));

create or replace view public.v_documentos_compra_tesoreria
with (security_invoker = false) as
select d.id, d.orden_compra_id, d.tipo, d.nombre_archivo, d.ruta_storage,
       d.mime_type, d.tamano_bytes, d.subido_por, d.creado_en,
       oc.proveedor, oc.referencia, oc.fecha_estimada,
       r.orden_id, ot.numero as numero_ot, r.area_destino
  from public.documentos_compra_material d
  join public.ordenes_compra_materiales oc on oc.id = d.orden_compra_id
  left join public.requerimientos_materiales r on r.id = oc.requerimiento_id
  left join public.ordenes_trabajo ot on ot.id = r.orden_id
 where public.es_admin() or public.tiene_permiso('compras.ver')
    or public.tiene_permiso('tesoreria.ver_documentos');
comment on view public.v_documentos_compra_tesoreria is
  'Solo roles de Compras, Tesorería y administración: documentos financieros con proveedor, OT y área; no expone líneas técnicas ni importes al taller.';
revoke all on public.v_documentos_compra_tesoreria from public, anon, authenticated;
grant select on public.v_documentos_compra_tesoreria to authenticated;

-- Añadir el identificador de cabecera a las líneas pendientes para que
-- Logística pueda adjuntar documentos al pedido completo, una sola vez.
create or replace view public.v_orden_compra_material_pendiente
with (security_invoker = true) as
select ocd.id, oc.requerimiento_id, ocd.requerimiento_detalle_id,
       oc.proveedor, oc.referencia, oc.fecha_estimada,
       ocd.cantidad as cantidad_comprada,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0)::public.cantidad as cantidad_recibida,
       greatest(ocd.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0), 0)::public.cantidad as cantidad_pendiente,
       oc.id as orden_compra_id
  from public.orden_compra_material_detalles ocd
  join public.ordenes_compra_materiales oc on oc.id = ocd.orden_compra_id
  left join public.movimientos_materiales m on m.orden_compra_detalle_id = ocd.id
 group by ocd.id, oc.id, oc.requerimiento_id, ocd.requerimiento_detalle_id,
          oc.proveedor, oc.referencia, oc.fecha_estimada, ocd.cantidad;

-- El líder coordina una OT; cada plano puede tener más de un responsable.
alter table public.ordenes_trabajo
  add column if not exists diseno_lider_id uuid references public.usuarios(id) on delete restrict;
alter table public.ot_planos
  add column if not exists responsable_diseno_id uuid references public.usuarios(id) on delete restrict;
create index if not exists idx_ordenes_trabajo_diseno_lider
  on public.ordenes_trabajo (diseno_lider_id) where diseno_lider_id is not null;
create index if not exists idx_ot_planos_responsable_diseno
  on public.ot_planos (responsable_diseno_id) where responsable_diseno_id is not null;
comment on column public.ordenes_trabajo.diseno_lider_id is
  'Persona líder de Diseño que coordina los planos y responsables de esta OT.';
comment on column public.ot_planos.responsable_diseno_id is
  'Responsable principal de preparar y actualizar este plano.';

create or replace function public.validar_asignacion_diseno()
returns trigger language plpgsql set search_path = 'public' as $$
declare v_usuario uuid; v_rol text;
begin
  if tg_table_name = 'ordenes_trabajo' then
    if new.diseno_lider_id is distinct from old.diseno_lider_id then
      perform public.exigir_permiso('diseno.asignar');
      v_usuario := new.diseno_lider_id;
      if v_usuario is not null then
        select r.codigo into v_rol from public.usuarios u join public.roles r on r.id = u.rol_id
          where u.id = v_usuario and u.activo;
        if v_rol is distinct from 'DISENO_LIDER' then
          raise exception 'El líder asignado debe tener el puesto Líder de Diseño.' using errcode = 'check_violation';
        end if;
      end if;
    end if;
  elsif new.responsable_diseno_id is distinct from old.responsable_diseno_id then
    perform public.exigir_permiso('diseno.asignar');
    v_usuario := new.responsable_diseno_id;
    if v_usuario is not null then
      select r.codigo into v_rol from public.usuarios u join public.roles r on r.id = u.rol_id
        where u.id = v_usuario and u.activo;
      if v_rol not in ('DISENO', 'DISENO_LIDER') then
        raise exception 'El responsable del plano debe pertenecer a Diseño y estar activo.' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validar_asignacion_diseno() from public, anon, authenticated;
drop trigger if exists trg_asignar_lider_diseno on public.ordenes_trabajo;
create trigger trg_asignar_lider_diseno before update of diseno_lider_id on public.ordenes_trabajo
  for each row execute function public.validar_asignacion_diseno();
drop trigger if exists trg_asignar_responsable_plano on public.ot_planos;
create trigger trg_asignar_responsable_plano before update of responsable_diseno_id on public.ot_planos
  for each row execute function public.validar_asignacion_diseno();

-- Un RPC acotado permite leer nombres de diseñadores sin exponer al navegador
-- los datos de personal ni abrir UPDATE general de las órdenes y planos.
create or replace function public.asignar_equipo_diseno(p_orden uuid, p_lider text, p_responsables jsonb)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v record;
begin
  perform public.exigir_permiso('diseno.asignar');
  if not public.puede_ver_orden(p_orden) then raise exception 'La orden no está dentro de tu alcance.' using errcode = 'insufficient_privilege'; end if;
  if p_responsables is null or jsonb_typeof(p_responsables) <> 'object'
     or (select count(*) from jsonb_object_keys(p_responsables)) > 100 then raise exception 'La lista de responsables no es válida.' using errcode = 'check_violation'; end if;
  if p_lider <> '' and p_lider !~ '^[0-9a-fA-F-]{36}$' then raise exception 'El líder seleccionado no es válido.' using errcode = 'check_violation'; end if;
  update public.ordenes_trabajo set diseno_lider_id = nullif(p_lider, '')::uuid where id = p_orden;
  if not found then raise exception 'La orden no existe.' using errcode = 'foreign_key_violation'; end if;
  for v in select key as plano_id, value as usuario_id from jsonb_each_text(p_responsables) loop
    if v.plano_id !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Hay un plano no válido.' using errcode = 'check_violation'; end if;
    if v.usuario_id = '' then
      update public.ot_planos set responsable_diseno_id = null
       where id = v.plano_id::uuid and orden_id = p_orden;
    else
      if v.usuario_id !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Hay un responsable no válido.' using errcode = 'check_violation'; end if;
      update public.ot_planos set responsable_diseno_id = v.usuario_id::uuid
       where id = v.plano_id::uuid and orden_id = p_orden;
    end if;
    if not found then raise exception 'Uno de los planos no pertenece a esta orden.' using errcode = 'foreign_key_violation'; end if;
  end loop;
end;
$$;
revoke all on function public.asignar_equipo_diseno(uuid, text, jsonb) from public, anon;
grant execute on function public.asignar_equipo_diseno(uuid, text, jsonb) to authenticated;

create or replace view public.v_equipo_diseno_ot
with (security_invoker = false) as
select o.id as orden_id, o.diseno_lider_id,
       nullif(btrim(coalesce(l.nombres, '') || ' ' || coalesce(l.apellidos, '')), '') as lider_nombre,
       p.id as plano_id, p.numero_plano, p.nombre as plano_nombre, p.responsable_diseno_id,
       nullif(btrim(coalesce(r.nombres, '') || ' ' || coalesce(r.apellidos, '')), '') as responsable_nombre
  from public.ordenes_trabajo o
  left join public.usuarios l on l.id = o.diseno_lider_id
  left join public.ot_planos p on p.orden_id = o.id
  left join public.usuarios r on r.id = p.responsable_diseno_id
 where public.es_admin()
    or (public.tiene_permiso('diseno.asignar') and public.puede_ver_orden(o.id));
revoke all on public.v_equipo_diseno_ot from public, anon, authenticated;
grant select on public.v_equipo_diseno_ot to authenticated;
comment on view public.v_equipo_diseno_ot is
  'Solo líder/administración con acceso a la OT: devuelve nombre y responsable de cada plano sin abrir lectura general del personal.';

create or replace function public.usuarios_diseno_asignables()
returns table(id uuid, nombre text, rol text)
language sql stable security definer set search_path = 'public' as $$
  select u.id, nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), ''), r.codigo
    from public.usuarios u join public.roles r on r.id = u.rol_id
   where u.activo and r.codigo in ('DISENO', 'DISENO_LIDER')
     and nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') is not null
     and (public.es_admin() or public.tiene_permiso('diseno.asignar'))
   order by case r.codigo when 'DISENO_LIDER' then 0 else 1 end, u.apellidos, u.nombres;
$$;
revoke all on function public.usuarios_diseno_asignables() from public, anon;
grant execute on function public.usuarios_diseno_asignables() to authenticated;
