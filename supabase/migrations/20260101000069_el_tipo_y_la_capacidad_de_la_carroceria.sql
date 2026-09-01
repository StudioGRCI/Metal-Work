-- El tipo y la capacidad de la carrocería, como los codifica la empresa.
--
-- De `SEGUIMIENTO DE FABRICACIÓN - MWP.xlsx`, hoja COD. Cada unidad que fabrican
-- lleva un código como `VSC_SR_O4_6_26/30`, y sus dos primeras piezas después de
-- la subfamilia son justo las que faltaban acá:
--
--   VSC _ **SR** _ **O4** _ 6 _ 26 / 30
--          │       └── la CATEGORÍA, que ellos llaman «capacidad»
--          └────────── el TIPO: semirremolque o carrocería montada
--
-- El TIPO tiene dos valores y su propia regla, escrita en la hoja:
--
--   «TODA COTIZACIÓN QUE LLEVA EJES ES SEMIRREMOLQUE»
--   «TODA COTIZACIÓN QUE NO LLEVA EJES ES MONTAJE - CARROCERÍA»
--
-- La CAPACIDAD no es el volumen —eso ya vive en `capacidad`, que dice «17 m³»—
-- sino la categoría vehicular por peso bruto, y depende del tipo:
--
--   Semirremolques   O3  más de 3,5 t hasta 10 t
--                    O4  más de 10 t
--   Montadas         N1
--                    N2  más de 3,5 t hasta 12 t
--                    N3  más de 12 t
--
-- Van en el catálogo de carrocerías como valor por omisión y bajan solas a la
-- cotización, igual que las medidas: ahí se corrigen si esta unidad es distinta.
-- Es lo que su propia hoja pide con «REVISAR EN COT LA CAPACIDAD».

-- =============================================================================
-- LOS DOS VOCABULARIOS
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_unidad_carroceria') then
    create type public.tipo_unidad_carroceria as enum ('SEMIRREMOLQUE', 'CARROCERIA_MONTADA');
  end if;

  if not exists (select 1 from pg_type where typname = 'categoria_vehicular') then
    create type public.categoria_vehicular as enum ('O3', 'O4', 'N1', 'N2', 'N3');
  end if;
end $$;

comment on type public.tipo_unidad_carroceria is
  'SR o CM en la codificación de la empresa: la que lleva ejes es semirremolque, la que no, montaje sobre chasis.';
comment on type public.categoria_vehicular is
  'La «capacidad» de su codificación: categoría por peso bruto vehicular. O3 y O4 son de semirremolque; N1, N2 y N3 de carrocería montada.';

-- =============================================================================
-- EN EL CATÁLOGO
-- =============================================================================

alter table public.tipos_carroceria
  add column if not exists tipo_unidad public.tipo_unidad_carroceria,
  add column if not exists categoria_vehicular public.categoria_vehicular;

comment on column public.tipos_carroceria.tipo_unidad is
  'Semirremolque o carrocería montada. Es el SR/CM del código de producto.';
comment on column public.tipos_carroceria.categoria_vehicular is
  'La categoría por peso bruto —lo que la empresa llama capacidad— y que en el código va después del tipo.';

-- Un semirremolque no puede ser N2 ni una montada O4: son dos escalas distintas
-- y mezclarlas produce un código de producto que no existe en su catálogo.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_carroceria_categoria_del_tipo') then
    alter table public.tipos_carroceria
      add constraint ck_carroceria_categoria_del_tipo check (
        tipo_unidad is null
        or categoria_vehicular is null
        or (tipo_unidad = 'SEMIRREMOLQUE'      and categoria_vehicular in ('O3', 'O4'))
        or (tipo_unidad = 'CARROCERIA_MONTADA' and categoria_vehicular in ('N1', 'N2', 'N3'))
      );
  end if;
end $$;

-- =============================================================================
-- Y EN LA COTIZACIÓN
-- =============================================================================

alter table public.cotizaciones
  add column if not exists tipo_unidad public.tipo_unidad_carroceria,
  add column if not exists categoria_vehicular public.categoria_vehicular;

comment on column public.cotizaciones.tipo_unidad is
  'Semirremolque o carrocería montada de ESTA unidad. Baja del catálogo y acá se corrige.';
comment on column public.cotizaciones.categoria_vehicular is
  'La categoría por peso bruto de ESTA unidad. Su hoja lo dice: «revisar en cot la capacidad».';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cotizacion_categoria_del_tipo') then
    alter table public.cotizaciones
      add constraint ck_cotizacion_categoria_del_tipo check (
        tipo_unidad is null
        or categoria_vehicular is null
        or (tipo_unidad = 'SEMIRREMOLQUE'      and categoria_vehicular in ('O3', 'O4'))
        or (tipo_unidad = 'CARROCERIA_MONTADA' and categoria_vehicular in ('N1', 'N2', 'N3'))
      );
  end if;
end $$;

-- Bajan con las medidas, en el mismo disparador y con la misma regla: solo al
-- elegir el tipo o al cambiarlo, y sin pisar lo que ya se escribió a mano.
create or replace function public.fn_cotizacion_traer_medidas_del_tipo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo public.tipos_carroceria%rowtype;
begin
  if new.tipo_carroceria_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.tipo_carroceria_id is not distinct from old.tipo_carroceria_id then
    return new;
  end if;

  select * into v_tipo from public.tipos_carroceria t where t.id = new.tipo_carroceria_id;
  if not found then
    return new;
  end if;

  new.modelo           := coalesce(new.modelo, v_tipo.modelo);
  new.tipo             := coalesce(new.tipo, v_tipo.tipo);
  new.largo_m          := coalesce(new.largo_m, v_tipo.largo_m);
  new.ancho_m          := coalesce(new.ancho_m, v_tipo.ancho_m);
  new.alto_m           := coalesce(new.alto_m, v_tipo.alto_m);
  new.capacidad        := coalesce(new.capacidad, v_tipo.capacidad);
  new.peso_neto_tn     := coalesce(new.peso_neto_tn, v_tipo.peso_neto_tn);
  new.carroceria_texto := coalesce(new.carroceria_texto, v_tipo.carroceria_texto);
  new.largo_util_m     := coalesce(new.largo_util_m, v_tipo.largo_util_m);
  new.ejes             := coalesce(new.ejes, v_tipo.ejes);
  new.normas           := coalesce(new.normas, v_tipo.normas);
  new.anio_fabricacion := coalesce(new.anio_fabricacion, extract(year from new.fecha_emision)::int);

  -- Los dos de la codificación.
  new.tipo_unidad          := coalesce(new.tipo_unidad, v_tipo.tipo_unidad);
  new.categoria_vehicular  := coalesce(new.categoria_vehicular, v_tipo.categoria_vehicular);

  return new;
end;
$$;

-- =============================================================================
-- LO QUE YA SE PUEDE DEDUCIR
-- -----------------------------------------------------------------------------
-- Las carrocerías del catálogo que la empresa ya codifica solo como
-- semirremolque o solo como montaje quedan marcadas; las que aparecen de las dos
-- formas en su hoja COD —tolvas, furgones, cisternas, barandas— se quedan en
-- blanco a propósito: elegir una por ellas sería inventar.
-- =============================================================================

update public.tipos_carroceria
   set tipo_unidad = 'SEMIRREMOLQUE'
 where codigo in ('CB', 'CAMA_BAJA', 'PC', 'PORTACONTENEDOR', 'MA', 'HOR', 'CIG', 'BOB')
   and tipo_unidad is null;

update public.tipos_carroceria
   set tipo_unidad = 'CARROCERIA_MONTADA'
 where codigo in ('ABR', 'ABU', 'COS', 'COA')
   and tipo_unidad is null;
