-- =============================================================================
-- LA COTIZACIÓN COMO LA ESCRIBE METAL WORK
-- -----------------------------------------------------------------------------
-- La cotización que sale de esta empresa no es una lista de precios: es una
-- ficha técnica. La COT N° 3675 de una tolva de 10 m3 declara el espesor de
-- cada plancha, la norma de soldadura, cuántos cuerpos tiene el pistón, cuántos
-- faros van por lado y qué accesorios entran y cuáles no. Eso es lo que después
-- el taller fabrica y contra lo que el cliente reclama.
--
-- El sistema guardaba todo eso en dos campos de texto libre —«condiciones» y
-- «observaciones»—, que no se pueden reutilizar, ni comparar, ni copiar de una
-- cotización a la siguiente. Acá pasa a ser dato.
--
-- La ficha no tiene columnas fijas a propósito: una tolva declara SISTEMA
-- HIDRÁULICO y una plataforma declara EJES, SUSPENSIÓN NEUMÁTICA y KING PIN.
-- Se modela como secciones con líneas, y una plantilla por tipo de carrocería
-- las trae ya escritas para que solo haya que llenar los datos.
-- =============================================================================

-- --------------------------------------------------------- la cabecera técnica
alter table public.cotizaciones
  add column if not exists marca            text default 'METAL WORK',
  add column if not exists modelo           text,
  add column if not exists tipo             text,
  add column if not exists largo_m          numeric(6,2) check (largo_m is null or largo_m > 0),
  add column if not exists ancho_m          numeric(6,2) check (ancho_m is null or ancho_m > 0),
  add column if not exists alto_m           numeric(6,2) check (alto_m is null or alto_m > 0),
  add column if not exists capacidad        text,
  add column if not exists peso_neto_tn     numeric(8,2) check (peso_neto_tn is null or peso_neto_tn > 0),
  add column if not exists garantia_meses   int not null default 12
                                            check (garantia_meses between 0 and 120),
  add column if not exists incluye_igv      boolean not null default true,
  -- El plazo de esta empresa siempre se dice en días hábiles: «en 45 días
  -- hábiles». Contarlo en días corridos es prometer una fecha que no existe.
  add column if not exists plazo_en_habiles boolean not null default true,
  add column if not exists nota             text;

comment on column public.cotizaciones.capacidad is
  'Como lo escribe la cotización: «10 M3» o «37 TN de carga, en función al DS 058.2003.MTC».';
comment on column public.cotizaciones.plazo_en_habiles is
  'El plazo ofrecido se cuenta en días de taller. Es lo que la empresa escribe en todas sus cotizaciones.';
comment on column public.cotizaciones.incluye_igv is
  'Si el precio ofrecido ya lleva el IGV. La cotización lo dice con todas sus letras.';

-- ------------------------------------------------------------ las secciones
-- Cada línea de la ficha: la sección a la que pertenece, con qué etiqueta se
-- imprime y qué dice. «ESTRUCTURA · Durmientes · Plancha ASTM A-36 de 6 mm».
create table if not exists public.cotizacion_especificaciones (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  uuid not null references public.cotizaciones(id) on delete cascade,
  seccion        text not null check (length(btrim(seccion)) > 0),
  orden_seccion  smallint not null default 1,
  orden_linea    smallint not null default 1,
  -- La etiqueta es opcional: hay líneas que son una frase suelta, como
  -- «Todo el proceso de soldadura se realiza en GMAW (Mig Mag)».
  etiqueta       text,
  detalle        text not null check (length(btrim(detalle)) > 0),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.cotizacion_especificaciones is
  'La ficha técnica de la cotización, por secciones. Es lo que el taller fabrica y contra lo que el cliente reclama.';

create index if not exists idx_cot_espec_cotizacion
  on public.cotizacion_especificaciones(cotizacion_id, orden_seccion, orden_linea);

-- ----------------------------------------------------------- los accesorios
-- «01 unid. Porta conos (no incluye accesorio)». Ese paréntesis es plata: dice
-- que se entrega el soporte pero no los conos, y es motivo de discusión en la
-- entrega si no queda escrito.
create table if not exists public.cotizacion_accesorios (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  uuid not null references public.cotizaciones(id) on delete cascade,
  orden          smallint not null default 1,
  cantidad       numeric(8,2) not null default 1 check (cantidad > 0),
  unidad         text not null default 'unid',
  descripcion    text not null check (length(btrim(descripcion)) > 0),
  -- Falso cuando se entrega el porta pero no lo que va adentro.
  incluye_el_accesorio boolean not null default true,
  observacion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.cotizacion_accesorios is
  'Equipamiento que la cotización promete. Distingue el que se entrega completo del que es solo el soporte.';
comment on column public.cotizacion_accesorios.incluye_el_accesorio is
  'Falso cuando se entrega el porta pero no lo que va adentro: «porta conos (no incluye accesorio)».';

create index if not exists idx_cot_acces_cotizacion
  on public.cotizacion_accesorios(cotizacion_id, orden);

-- ------------------------------------------------------------- las plantillas
-- Para que llenar una cotización sea llenar datos y no volver a escribir la
-- ficha entera. Una plantilla por tipo de carrocería, con sus secciones y sus
-- líneas ya redactadas; al elegir el tipo, se copian y se ajustan los espesores
-- o las medidas que cambien.
create table if not exists public.plantillas_ficha (
  id                 uuid primary key default gen_random_uuid(),
  tipo_carroceria_id uuid references public.tipos_carroceria(id) on delete cascade,
  nombre             text not null,
  descripcion        text,
  activa             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_plantilla_por_tipo unique (tipo_carroceria_id, nombre)
);

comment on table public.plantillas_ficha is
  'Ficha técnica preescrita por tipo de carrocería. Al cotizar se copia y solo se ajustan los datos que cambian.';

create table if not exists public.plantilla_ficha_lineas (
  id            uuid primary key default gen_random_uuid(),
  plantilla_id  uuid not null references public.plantillas_ficha(id) on delete cascade,
  seccion       text not null,
  orden_seccion smallint not null default 1,
  orden_linea   smallint not null default 1,
  etiqueta      text,
  detalle       text not null,
  creado_en     timestamptz not null default now(),
  -- Lleva actualizado_en porque una línea de plantilla se corrige: cambia un
  -- espesor, se agrega una norma. Sin la columna, el disparador de marcas de
  -- tiempo que se activa más abajo haría fallar todo UPDATE.
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_plantilla_lineas
  on public.plantilla_ficha_lineas(plantilla_id, orden_seccion, orden_linea);

create table if not exists public.plantilla_ficha_accesorios (
  id            uuid primary key default gen_random_uuid(),
  plantilla_id  uuid not null references public.plantillas_ficha(id) on delete cascade,
  orden         smallint not null default 1,
  cantidad      numeric(8,2) not null default 1,
  unidad        text not null default 'unid',
  descripcion   text not null,
  incluye_el_accesorio boolean not null default true,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_plantilla_accesorios
  on public.plantilla_ficha_accesorios(plantilla_id, orden);

-- ------------------------------------------------------ aplicar una plantilla
-- Copia la ficha preescrita a una cotización. Reemplaza lo que hubiera: se usa
-- al elegir el tipo de carrocería, y volver a elegir tiene que dejar la ficha
-- del tipo nuevo, no las dos mezcladas.
create or replace function public.aplicar_plantilla_ficha(
  p_cotizacion uuid,
  p_plantilla  uuid
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_lineas int;
begin
  perform public.exigir_permiso('cotizaciones.editar');

  if not exists (select 1 from public.cotizaciones where id = p_cotizacion) then
    raise exception 'No existe esa cotización';
  end if;
  if not exists (select 1 from public.plantillas_ficha where id = p_plantilla and activa) then
    raise exception 'No existe esa plantilla o está dada de baja';
  end if;

  delete from public.cotizacion_especificaciones where cotizacion_id = p_cotizacion;
  delete from public.cotizacion_accesorios        where cotizacion_id = p_cotizacion;

  insert into public.cotizacion_especificaciones
    (cotizacion_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  select p_cotizacion, l.seccion, l.orden_seccion, l.orden_linea, l.etiqueta, l.detalle
    from public.plantilla_ficha_lineas l
   where l.plantilla_id = p_plantilla;

  get diagnostics v_lineas = row_count;

  insert into public.cotizacion_accesorios
    (cotizacion_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
  select p_cotizacion, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
    from public.plantilla_ficha_accesorios a
   where a.plantilla_id = p_plantilla;

  return v_lineas;
end;
$$;

comment on function public.aplicar_plantilla_ficha(uuid, uuid) is
  'Copia una ficha técnica preescrita a una cotización, reemplazando la que tuviera.';

-- --------------------------------------------------------- la ficha completa
create or replace view public.cotizacion_ficha as
select
  c.id                as cotizacion_id,
  c.numero,
  e.seccion,
  e.orden_seccion,
  e.orden_linea,
  e.etiqueta,
  e.detalle
from public.cotizaciones c
join public.cotizacion_especificaciones e on e.cotizacion_id = c.id;

comment on view public.cotizacion_ficha is
  'Las líneas de la ficha técnica de cada cotización, listas para imprimir en orden.';

-- ---------------------------------------------------------------- seguridad
alter table public.cotizacion_especificaciones  enable row level security;
alter table public.cotizacion_accesorios        enable row level security;
alter table public.plantillas_ficha             enable row level security;
alter table public.plantilla_ficha_lineas       enable row level security;
alter table public.plantilla_ficha_accesorios   enable row level security;

do $$
declare
  t text;
  v_ver text;
  v_escribir text;
begin
  foreach t in array array[
    'cotizacion_especificaciones', 'cotizacion_accesorios',
    'plantillas_ficha', 'plantilla_ficha_lineas', 'plantilla_ficha_accesorios'
  ] loop
    -- La ficha se ve con la cotización; las plantillas las mantiene quien
    -- cotiza, porque es quien sabe qué lleva cada carrocería.
    v_ver := 'cotizaciones.ver';
    v_escribir := 'cotizaciones.editar';

    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))', 'ver_' || t, t, v_ver);

    execute format('drop policy if exists %I on public.%I', 'crear_' || t, t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.es_admin() or public.tiene_permiso(%L))', 'crear_' || t, t, v_escribir);

    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))
         with check (public.es_admin() or public.tiene_permiso(%L))',
      'editar_' || t, t, v_escribir, v_escribir);

    execute format('drop policy if exists %I on public.%I', 'borrar_' || t, t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))', 'borrar_' || t, t, v_escribir);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    perform public.activar_timestamps(t);
  end loop;
end;
$$;

alter view public.cotizacion_ficha set (security_invoker = on);
grant select on public.cotizacion_ficha to authenticated;

revoke all on function public.aplicar_plantilla_ficha(uuid, uuid) from public, anon;
grant execute on function public.aplicar_plantilla_ficha(uuid, uuid) to authenticated;
