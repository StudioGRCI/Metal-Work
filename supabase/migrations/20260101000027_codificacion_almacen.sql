-- =============================================================================
-- LA CODIFICACIÓN DE ALMACÉN QUE EL ÁREA YA DISEÑÓ
-- -----------------------------------------------------------------------------
-- De «PROYECTO CODIFICACION ALMACEN -MWP.xlsx» (proyecto SIG 2026 del área,
-- una hoja por persona). El código de material tiene cinco segmentos:
--
--     FAMILIA - SUBFAMILIA - MATERIAL - TIPO - CORRELATIVO
--     MP      - PL         - AC       - HX   - 0001         (plancha Hardox)
--
-- Hasta hoy `materiales.codigo` era un texto libre. Con texto libre el mismo
-- Hardox puede entrar tres veces con tres códigos, y nadie puede listar «todas
-- las planchas de acero» sin leerse el catálogo entero. Los segmentos se
-- guardan como columnas y el código se ARMA, no se escribe: así no puede
-- existir un MP-PL que en realidad sea un perfil.
--
-- El área también pide lo que le falta a la ficha: criticidad A/B/C (qué se
-- compra primero cuando falta plata), ubicación física, costo de reposición y
-- el control por serie o caducidad. El código por proveedor ya existía en
-- `proveedor_materiales.codigo_proveedor`.
--
-- El producto terminado usa su propio esquema (VO-SM-STD-0001); queda para
-- cuando se modele la venta de unidades, que hoy pasa por tipos_carroceria.
-- =============================================================================

-- ------------------------------------------------------------- los catálogos
create table if not exists public.codificacion_familias (
  codigo         text primary key check (codigo ~ '^[A-Z]{2}$'),
  nombre         text not null,
  agrupa         text,
  orden_visual   int not null default 0,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.codificacion_familias is
  'Primer segmento del código de material: la familia. Las doce del proyecto de codificación del área.';

create table if not exists public.codificacion_subfamilias (
  familia_codigo text not null references public.codificacion_familias(codigo) on delete cascade,
  codigo         text not null check (codigo ~ '^[A-Z]{2}$'),
  nombre         text not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (familia_codigo, codigo)
);

comment on table public.codificacion_subfamilias is
  'Segundo segmento, dentro de su familia: en materia prima, planchas / perfiles / tubos / barras / FRP.';

create table if not exists public.codificacion_materiales (
  codigo         text primary key check (codigo ~ '^[A-Z]{2}$'),
  nombre         text not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.codificacion_materiales is
  'Tercer segmento: de qué está hecho. Acero A36, inoxidable, aluminio, negro, galvanizado, SAE 1045.';

create table if not exists public.codificacion_tipos (
  subfamilia_codigo text not null check (subfamilia_codigo ~ '^[A-Z]{2}$'),
  codigo            text not null check (codigo ~ '^[A-Z]{2}$'),
  nombre            text not null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  primary key (subfamilia_codigo, codigo)
);

comment on table public.codificacion_tipos is
  'Cuarto segmento, que depende de la subfamilia: una plancha puede ser estriada, Strenx o Hardox; un tubo, redondo, rectangular o cuadrado.';

-- Las doce familias, tal como las enumera el archivo del área.
insert into public.codificacion_familias (codigo, nombre, agrupa, orden_visual) values
  ('MP', 'Materia prima',            'Planchas, perfiles, tubos, ángulos, aluminio, acero, FRP', 1),
  ('MT', 'Materiales de producción', 'Lijas, discos, abrasivos, adhesivos, tornillería',          2),
  ('RP', 'Repuestos mecánicos',      'Frenos, suspensión, motor, transmisión',                    3),
  ('RE', 'Repuestos eléctricos',     'Baterías, cableado, luces, alternadores',                   4),
  ('PQ', 'Pintura y químicos',       'Pinturas, primers, solventes, catalizadores',               5),
  ('AC', 'Accesorios',               'Cierres, bisagras, burletes, emblemas',                     6),
  ('EQ', 'Equipos y maquinaria',     'Cortadora, plasma, compresores, taladros',                  7),
  ('HE', 'Herramientas',             'Llaves, alicates, taladros, esmeriles',                     8),
  ('CO', 'Consumibles e insumos',    'Guantes, trapos, EPP, silicona, lubricantes',               9),
  ('IN', 'Instrumentos',             'Los que requieren calibración',                            10),
  ('SH', 'Sistema hidráulico',       'Bombas, válvulas, cilindros, mangueras, racores, filtros', 11),
  ('SN', 'Sistema neumático',        'Válvulas, bolsas de aire, muelles, conectores',            12)
on conflict (codigo) do update set nombre = excluded.nombre, agrupa = excluded.agrupa;

insert into public.codificacion_subfamilias (familia_codigo, codigo, nombre) values
  ('MP', 'PL', 'Planchas'),
  ('MP', 'PR', 'Perfiles'),
  ('MP', 'TB', 'Tubos'),
  ('MP', 'BR', 'Barras'),
  ('MP', 'FB', 'FRP y fibra')
on conflict (familia_codigo, codigo) do update set nombre = excluded.nombre;

insert into public.codificacion_materiales (codigo, nombre) values
  ('AC', 'Acero ASTM A36'),
  ('IN', 'Acero inoxidable'),
  ('AL', 'Aluminio'),
  ('AN', 'Acero negro'),
  ('AG', 'Acero galvanizado'),
  ('AS', 'Acero SAE 1045')
on conflict (codigo) do update set nombre = excluded.nombre;

insert into public.codificacion_tipos (subfamilia_codigo, codigo, nombre) values
  ('PL', 'ET', 'Estriada'),
  ('PL', 'ST', 'Strenx'),
  ('PL', 'HX', 'Hardox'),
  ('TB', 'RD', 'Redondo'),
  ('TB', 'RT', 'Rectangular'),
  ('TB', 'CO', 'Cuadrado'),
  ('PR', 'PT', 'Platina'),
  ('PR', 'VG', 'Viga'),
  ('PR', 'CN', 'Canal'),
  ('PR', 'AG', 'Ángulo'),
  ('BR', 'RS', 'Redonda sólida'),
  ('BR', 'RP', 'Redonda perforada'),
  ('BR', 'RO', 'Roscada'),
  ('BR', 'CD', 'Cuadrada')
on conflict (subfamilia_codigo, codigo) do update set nombre = excluded.nombre;

-- ------------------------------------------- lo que le faltaba a la ficha
alter table public.materiales
  add column if not exists cod_familia    text references public.codificacion_familias(codigo) on delete restrict,
  add column if not exists cod_subfamilia text,
  add column if not exists cod_material   text references public.codificacion_materiales(codigo) on delete restrict,
  add column if not exists cod_tipo       text,
  add column if not exists cod_correlativo int check (cod_correlativo is null or cod_correlativo between 1 and 9999),
  -- Es lo que decide qué se compra primero cuando falta plata. Nula mientras
  -- el área no clasifique el material: obligarla inventaría criticidades.
  add column if not exists criticidad     text check (criticidad in ('A', 'B', 'C')),
  -- Pasillo–rack–nivel–posición, como el mapa LOC del proyecto: «P2-R3-N1-05».
  add column if not exists ubicacion      text,
  -- Lo que costaría reponerlo hoy; el promedio ponderado mira al pasado.
  add column if not exists costo_reposicion public.monto check (costo_reposicion is null or costo_reposicion >= 0),
  add column if not exists controla_serie    boolean not null default false,
  add column if not exists controla_caducidad boolean not null default false;

comment on column public.materiales.criticidad is
  'A/B/C del proyecto de codificación: la A se repone antes que nada. Nula = sin clasificar todavía.';
comment on column public.materiales.ubicacion is
  'Ubicación física por defecto: pasillo–rack–nivel–posición.';
comment on column public.materiales.cod_correlativo is
  'Quinto segmento del código de almacén. Lo asigna asignar_codigo_almacen(), nunca la mano.';

-- La subfamilia solo existe dentro de su familia, y el tipo dentro de su
-- subfamilia: las claves compuestas hacen imposible un MP-XX inventado.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_material_subfamilia') then
    alter table public.materiales
      add constraint fk_material_subfamilia
      foreign key (cod_familia, cod_subfamilia)
      references public.codificacion_subfamilias(familia_codigo, codigo) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_material_tipo') then
    alter table public.materiales
      add constraint fk_material_tipo
      foreign key (cod_subfamilia, cod_tipo)
      references public.codificacion_tipos(subfamilia_codigo, codigo) on delete restrict;
  end if;
  -- Sin subfamilia no hay tipo: la FK compuesta no valida con nulos y dejaba
  -- colar un tipo inventado.
  if not exists (select 1 from pg_constraint where conname = 'ck_material_tipo_con_subfamilia') then
    alter table public.materiales
      add constraint ck_material_tipo_con_subfamilia check (
        cod_tipo is null or cod_subfamilia is not null);
  end if;
  -- El código está entero o no está: cinco segmentos a medias no codifican nada.
  if not exists (select 1 from pg_constraint where conname = 'ck_material_codigo_entero') then
    alter table public.materiales
      add constraint ck_material_codigo_entero check (
        (cod_familia is null and cod_subfamilia is null and cod_material is null
          and cod_tipo is null and cod_correlativo is null)
        or (cod_familia is not null and cod_material is not null and cod_correlativo is not null)
      );
  end if;
end;
$$;

-- El código armado, siempre derivado de sus segmentos. Subfamilia y tipo
-- pueden faltar en familias que no los usan (un guante no tiene subfamilia);
-- el archivo del área solo definió subfamilias para materia prima.
alter table public.materiales
  add column if not exists codigo_almacen text generated always as (
    case when cod_familia is not null then
      cod_familia
      || coalesce('-' || cod_subfamilia, '')
      || '-' || cod_material
      || coalesce('-' || cod_tipo, '')
      || '-' || lpad(cod_correlativo::text, 4, '0')
    end
  ) stored;

comment on column public.materiales.codigo_almacen is
  'FAMILIA-SUBFAMILIA-MATERIAL-TIPO-CORRELATIVO, armado de los segmentos. MP-PL-AC-HX-0001 = plancha Hardox.';

create unique index if not exists uq_material_codigo_almacen
  on public.materiales(codigo_almacen) where codigo_almacen is not null;

create index if not exists idx_materiales_criticidad
  on public.materiales(criticidad) where criticidad is not null and activo;

-- --------------------------------------------------- asignar el código
-- El correlativo es por grupo (familia+subfamilia+material+tipo) y lo entrega
-- la función con la fila bloqueada, para que dos altas simultáneas no se
-- lleven el mismo número.
create or replace function public.asignar_codigo_almacen(
  p_material   uuid,
  p_familia    text,
  p_subfamilia text default null,
  p_material_cod text default null,
  p_tipo       text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_siguiente int;
  v_codigo    text;
begin
  perform public.exigir_permiso('almacen.maestros');

  if p_material_cod is null then
    raise exception 'El código necesita el segmento de material (AC, IN, AL, AN, AG o AS)';
  end if;

  -- El bloqueo de la familia serializa las altas del mismo grupo.
  perform 1 from public.codificacion_familias where codigo = p_familia for update;
  if not found then
    raise exception 'La familia % no está en el catálogo de codificación', p_familia;
  end if;

  select coalesce(max(cod_correlativo), 0) + 1 into v_siguiente
    from public.materiales
   where cod_familia = p_familia
     and cod_subfamilia is not distinct from p_subfamilia
     and cod_material = p_material_cod
     and cod_tipo is not distinct from p_tipo;

  -- La bandera que el disparador de abajo exige: los segmentos solo se
  -- escriben pasando por acá.
  perform set_config('metalwork.asignando_codigo', 'si', true);

  update public.materiales
     set cod_familia = p_familia,
         cod_subfamilia = p_subfamilia,
         cod_material = p_material_cod,
         cod_tipo = p_tipo,
         cod_correlativo = v_siguiente
   where id = p_material
  returning codigo_almacen into v_codigo;

  perform set_config('metalwork.asignando_codigo', '', true);

  if v_codigo is null then
    raise exception 'El material no existe o el código no se pudo armar';
  end if;

  return v_codigo;
end;
$$;

-- El candado de la promesa: los segmentos del código no se tocan a mano.
-- El correlativo lo reparte la función con la familia bloqueada; si cualquiera
-- pudiera escribirlo por su cuenta, dos materiales terminarían con el mismo
-- número y el catálogo dejaría de ser confiable.
create or replace function public.fn_materiales_codigo_protegido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.cod_familia    is distinct from old.cod_familia
   or new.cod_subfamilia is distinct from old.cod_subfamilia
   or new.cod_material   is distinct from old.cod_material
   or new.cod_tipo       is distinct from old.cod_tipo
   or new.cod_correlativo is distinct from old.cod_correlativo)
   and coalesce(current_setting('metalwork.asignando_codigo', true), '') <> 'si' then
    raise exception 'El código de almacén se asigna con la función, no se escribe a mano'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_materiales_codigo_protegido on public.materiales;
create trigger trg_materiales_codigo_protegido
  before update on public.materiales
  for each row execute function public.fn_materiales_codigo_protegido();

revoke all on function public.fn_materiales_codigo_protegido() from public, anon, authenticated;

comment on function public.asignar_codigo_almacen(uuid, text, text, text, text) is
  'Arma el código de cinco segmentos de un material y le asigna el siguiente correlativo de su grupo.';

revoke all on function public.asignar_codigo_almacen(uuid, text, text, text, text) from public, anon;
grant execute on function public.asignar_codigo_almacen(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- seguridad
do $$
declare t text;
begin
  foreach t in array array[
    'codificacion_familias', 'codificacion_subfamilias',
    'codificacion_materiales', 'codificacion_tipos'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.es_admin() or public.tiene_permiso(''almacen.ver''))', 'ver_' || t, t);

    -- El catálogo de codificación lo mantiene quien administra los maestros.
    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.es_admin() or public.tiene_permiso(''almacen.maestros''))
         with check (public.es_admin() or public.tiene_permiso(''almacen.maestros''))',
      'editar_' || t, t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    perform public.activar_timestamps(t);
  end loop;
end;
$$;
