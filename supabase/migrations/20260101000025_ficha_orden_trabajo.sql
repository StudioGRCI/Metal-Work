-- =============================================================================
-- LA ORDEN DE TRABAJO COMO LA LLENA EL TALLER
-- -----------------------------------------------------------------------------
-- El formato de OT de Metal Work tiene once secciones. El sistema cubría los
-- datos principales, las fechas, las etapas y el costeo; le faltaban las tres
-- que el taller usa con lapicero en la mano:
--
--   4. MEDIDAS / COLORES / CARACTERÍSTICAS ESPECIALES
--   6. ACCESORIOS ................ con su V°B° uno por uno
--  11. VERIFICACIÓN Y FUNCIONAMIENTO .. 18 pasos, responsable y dos avances
--
-- Más repuestos y estructura, que hoy caían en «observaciones».
--
-- Lo importante del diseño: los accesorios de la OT salen de los que se
-- cotizaron. Lo que se prometió es lo que hay que verificar antes de entregar,
-- y hasta ahora esas dos listas vivían en papeles distintos.
-- =============================================================================

-- ------------------------------------------------- sección 4: la ficha física
alter table public.ordenes_trabajo
  add column if not exists largo_m          numeric(6,2) check (largo_m is null or largo_m > 0),
  add column if not exists ancho_m          numeric(6,2) check (ancho_m is null or ancho_m > 0),
  add column if not exists alto_m           numeric(6,2) check (alto_m is null or alto_m > 0),
  add column if not exists capacidad_carga  text,
  add column if not exists ruedas           text,
  add column if not exists tipo_llantas     text,
  add column if not exists cantidad_ejes    smallint check (cantidad_ejes is null or cantidad_ejes between 1 and 8),
  add column if not exists tipo_suspension  text,
  add column if not exists colores          text,
  add column if not exists caracteristicas_especiales text,
  -- El formato los pide por separado: quien responde por la orden y quien la
  -- lleva en planta no siempre son la misma persona.
  add column if not exists encargado_produccion_id uuid references public.usuarios(id) on delete set null,
  add column if not exists correo_contacto  public.email;

comment on column public.ordenes_trabajo.capacidad_carga is
  'Como lo escribe la OT: «37 TN de carga» o «18 M3».';
comment on column public.ordenes_trabajo.encargado_produccion_id is
  'Quien lleva la unidad en planta. El formato lo pide aparte del responsable de la orden.';

-- --------------------------------------------------- sección 6: los accesorios
-- Cada accesorio con su visto bueno. Lo que se cotizó es lo que hay que
-- verificar antes de entregar, así que se copian de la cotización y acá se van
-- marcando a medida que se montan.
create table if not exists public.ot_accesorios (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes_trabajo(id) on delete cascade,
  orden          smallint not null default 1,
  cantidad       numeric(8,2) not null default 1 check (cantidad > 0),
  unidad         text not null default 'unid',
  descripcion    text not null check (length(btrim(descripcion)) > 0),
  -- Falso cuando la cotización entregó el porta pero no lo que va adentro.
  incluye_el_accesorio boolean not null default true,
  -- El V°B° del formato: quién lo dio y cuándo.
  verificado     boolean not null default false,
  verificado_por uuid references public.usuarios(id) on delete set null,
  verificado_en  timestamptz,
  observacion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Verificado y sin firma, o sin verificar y con firma, son estados a medias.
  constraint ck_accesorio_visto_bueno check ((verificado = false) = (verificado_en is null))
);

comment on table public.ot_accesorios is
  'Sección 6 del formato de OT: el equipamiento que hay que montar, con el V°B° de cada uno.';

create index if not exists idx_ot_accesorios on public.ot_accesorios(orden_id, orden);
create index if not exists idx_ot_accesorios_pendientes on public.ot_accesorios(orden_id)
  where not verificado;

-- ------------------------------------------------- sección 8: los repuestos
create table if not exists public.ot_repuestos (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes_trabajo(id) on delete cascade,
  orden          smallint not null default 1,
  cantidad       numeric(8,2) not null default 1 check (cantidad > 0),
  descripcion    text not null check (length(btrim(descripcion)) > 0),
  marca          text,
  observacion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.ot_repuestos is
  'Sección 8 del formato de OT: repuestos con su cantidad y su marca.';

create index if not exists idx_ot_repuestos on public.ot_repuestos(orden_id, orden);

-- --------------------------------- sección 11: verificación y funcionamiento
-- Los 18 pasos que el taller recorre antes de dar la unidad por terminada.
-- Cada uno con su responsable y dos avances, como en el papel: la primera
-- pasada y la revisión.
create table if not exists public.ot_verificaciones (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes_trabajo(id) on delete cascade,
  numero         smallint not null check (numero between 1 and 40),
  descripcion    text not null,
  responsable_id uuid references public.usuarios(id) on delete set null,
  avance_1       boolean not null default false,
  avance_1_en    timestamptz,
  avance_2       boolean not null default false,
  avance_2_en    timestamptz,
  observaciones  text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint uq_ot_verificacion unique (orden_id, numero),
  constraint ck_verif_avance_1 check ((avance_1 = false) = (avance_1_en is null)),
  constraint ck_verif_avance_2 check ((avance_2 = false) = (avance_2_en is null)),
  -- No se marca la segunda pasada sin la primera.
  constraint ck_verif_orden check (avance_2 = false or avance_1 = true)
);

comment on table public.ot_verificaciones is
  'Sección 11 del formato de OT: los pasos de verificación y funcionamiento, con sus dos avances.';

create index if not exists idx_ot_verificaciones on public.ot_verificaciones(orden_id, numero);

-- ------------------------------------------------- la lista estándar de pasos
-- Transcrita de la OT 2925. Es la de una plataforma semirremolque; otras
-- carrocerías cambian algunos pasos, y por eso la lista se guarda por tipo.
create table if not exists public.plantillas_verificacion (
  id                 uuid primary key default gen_random_uuid(),
  tipo_carroceria_id uuid references public.tipos_carroceria(id) on delete cascade,
  numero             smallint not null check (numero between 1 and 40),
  descripcion        text not null,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_plantilla_verif unique (tipo_carroceria_id, numero)
);

comment on table public.plantillas_verificacion is
  'Los pasos de verificación que corresponden a cada tipo de carrocería. Al aprobar la OT se copian.';

-- ------------------------------------- armar la ficha al aprobar la orden
-- Cuando la OT se aprueba ya se sabe qué se va a fabricar: es el momento de
-- bajar los accesorios de la cotización y los pasos de verificación del tipo
-- de carrocería. Antes no, porque todavía se puede cambiar.
create or replace function public.armar_ficha_ot(p_orden uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_tipo       uuid;
begin
  select cotizacion_id, tipo_carroceria_id into v_cotizacion, v_tipo
    from public.ordenes_trabajo where id = p_orden;

  -- Los accesorios prometidos en la cotización son los que hay que montar.
  if v_cotizacion is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.cotizacion_accesorios a
     where a.cotizacion_id = v_cotizacion;
  end if;

  -- Y los pasos de verificación del tipo de carrocería.
  if v_tipo is not null
     and not exists (select 1 from public.ot_verificaciones where orden_id = p_orden) then
    insert into public.ot_verificaciones (orden_id, numero, descripcion)
    select p_orden, v.numero, v.descripcion
      from public.plantillas_verificacion v
     where v.tipo_carroceria_id = v_tipo;
  end if;
end;
$$;

comment on function public.armar_ficha_ot(uuid) is
  'Baja a la OT los accesorios que se cotizaron y los pasos de verificación de su carrocería.';

-- ------------------------------------------------------------ el resumen
create or replace view public.ot_ficha_resumen as
select
  o.id as orden_id,
  o.numero,
  (select count(*) from public.ot_accesorios a where a.orden_id = o.id)                       as accesorios,
  (select count(*) from public.ot_accesorios a where a.orden_id = o.id and a.verificado)      as accesorios_verificados,
  (select count(*) from public.ot_verificaciones v where v.orden_id = o.id)                   as pasos,
  (select count(*) from public.ot_verificaciones v where v.orden_id = o.id and v.avance_1)    as pasos_avance_1,
  (select count(*) from public.ot_verificaciones v where v.orden_id = o.id and v.avance_2)    as pasos_avance_2,
  (select count(*) from public.ot_repuestos r where r.orden_id = o.id)                        as repuestos
from public.ordenes_trabajo o;

comment on view public.ot_ficha_resumen is
  'Cuánto lleva verificado cada orden: accesorios con V°B° y pasos de verificación cumplidos.';

-- ---------------------------------------------------------------- seguridad
do $$
declare t text;
begin
  foreach t in array array['ot_accesorios', 'ot_repuestos', 'ot_verificaciones'] loop
    execute format('alter table public.%I enable row level security', t);

    -- Se ven con la orden: el operario, solo las suyas.
    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.puede_ver_orden(orden_id))', 'ver_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'crear_' || t, t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (
           (public.es_admin()
            or public.tiene_permiso(''ordenes.editar'')
            or public.tiene_permiso(''produccion.registrar''))
           and public.puede_ver_orden(orden_id))', 'crear_' || t, t);

    -- Dar el V°B° o marcar un paso es registrar producción: lo hace el taller.
    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           (public.es_admin()
            or public.tiene_permiso(''ordenes.editar'')
            or public.tiene_permiso(''produccion.registrar'')
            or public.tiene_permiso(''calidad.inspeccionar''))
           and public.puede_ver_orden(orden_id))
         with check (public.puede_ver_orden(orden_id))', 'editar_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'borrar_' || t, t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.es_admin() or public.tiene_permiso(''ordenes.editar''))', 'borrar_' || t, t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    perform public.activar_timestamps(t);
    perform public.activar_auditoria(t);
  end loop;
end;
$$;

alter table public.plantillas_verificacion enable row level security;

drop policy if exists ver_plantillas_verificacion    on public.plantillas_verificacion;
drop policy if exists crear_plantillas_verificacion  on public.plantillas_verificacion;
drop policy if exists editar_plantillas_verificacion on public.plantillas_verificacion;
drop policy if exists borrar_plantillas_verificacion on public.plantillas_verificacion;

create policy ver_plantillas_verificacion on public.plantillas_verificacion
  for select to authenticated using (public.es_admin() or public.tiene_permiso('ordenes.ver'));

create policy crear_plantillas_verificacion on public.plantillas_verificacion
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy editar_plantillas_verificacion on public.plantillas_verificacion
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('configuracion.editar'))
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy borrar_plantillas_verificacion on public.plantillas_verificacion
  for delete to authenticated using (public.es_admin());

grant select, insert, update, delete on public.plantillas_verificacion to authenticated;
select public.activar_timestamps('plantillas_verificacion');

alter view public.ot_ficha_resumen set (security_invoker = on);
grant select on public.ot_ficha_resumen to authenticated;

revoke all on function public.armar_ficha_ot(uuid) from public, anon;
grant execute on function public.armar_ficha_ot(uuid) to authenticated;
