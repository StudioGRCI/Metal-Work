-- =============================================================================
-- LA PRUEBA TRAE SUS DATOS Y SE LOS LLEVA
-- -----------------------------------------------------------------------------
-- Una pantalla o un flujo no se puede dar por bueno sin verlo funcionar con
-- datos, y la base es la de la empresa. Hasta hoy eso dejaba dos salidas
-- malas: no probar «para no ensuciar», o probar y dejar clientes, cotizaciones
-- y números de serie inventados mezclados con los de verdad. La primera
-- cotización del sistema es la 1-2026: una de prueba que se quede con un
-- número real deja un hueco que nadie puede explicar después.
--
-- Lo que se hace aquí:
--
-- 1. UN LOTE DE PRUEBA. Se abre con un motivo. Mientras está abierto, cada
--    fila que se inserta queda anotada en `pruebas_filas`, con su tabla y su
--    orden. Se reconoce que una inserción es de prueba por una de dos vías:
--      · la sesión SQL dice `set_config('pruebas.lote', '<id>', true)`, o
--      · quien inserta es una CUENTA DE PRUEBA (`pruebas_cuentas`) atada al
--        lote. Las cuentas de la gente nunca: lo que hace una persona real
--        no se barre con la prueba.
--    Una cuenta de prueba sin lote abierto no puede crear nada: así no deja
--    datos sueltos que nadie anotó.
--
-- 2. LOS NÚMEROS DE PRUEBA SON DE PRUEBA. Dentro de un lote,
--    `siguiente_correlativo` no toca `series_documentarias`: devuelve
--    PRUEBA-0001, PRUEBA-0002… de su propia secuencia. La serie de la empresa
--    no se mueve y al borrar no queda hueco.
--
-- 3. AL CONFIRMAR, SE LLEVA TODO. `pruebas_limpiar(lote)` borra lo anotado en
--    orden inverso, con su rastro en `audit_log`. Los candados que impiden
--    borrar documentos (cotización enviada, bitácora, reportes…) se apagan
--    solo para las tablas del lote y dentro de la misma transacción, y se
--    vuelven a encender antes de terminar; si algo falla, todo vuelve atrás
--    y los candados quedan como estaban.
--    Antes de borrar comprueba que ninguna fila real cuelgue de un dato de
--    prueba: si una persona le agregó algo a un cliente de prueba, no se
--    limpia y se dice qué es.
--    Los archivos de Storage no se pueden borrar por SQL (ver la skill
--    `esquema`): se dejan listados en el lote para quitarlos por la API.
--
-- El lote no se borra: queda como constancia de qué se probó, cuándo y
-- cuántas filas se llevó.
-- =============================================================================


-- ------------------------------------------------------------------ las tablas
create table if not exists public.pruebas_cuentas (
  usuario_id     uuid primary key references public.usuarios (id) on delete cascade,
  motivo         text not null check (length(btrim(motivo)) >= 5),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.pruebas_cuentas is
  'Cuentas que solo existen para probar. Lo que crean se anota en su lote de prueba; sin lote abierto no pueden crear nada.';

create table if not exists public.pruebas_lotes (
  id                  uuid primary key default gen_random_uuid(),
  motivo              text not null check (length(btrim(motivo)) >= 5),
  cuentas             uuid[] not null default '{}',
  abierto_en          timestamptz not null default now(),
  limpiado_en         timestamptz,
  filas_borradas      integer,
  archivos_pendientes jsonb,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

comment on table public.pruebas_lotes is
  'Una prueba con datos inventados: qué se probó, cuándo se abrió, cuándo se limpió y cuántas filas se llevó. No se borra.';

-- Se consulta en cada inserción de la base mientras alguien tenga sesión:
-- con el índice parcial, cuando no hay lotes abiertos la búsqueda no lee nada.
create index if not exists ix_pruebas_lotes_abiertos
  on public.pruebas_lotes (abierto_en) where limpiado_en is null;

create table if not exists public.pruebas_filas (
  orden          bigint generated always as identity primary key,
  lote_id        uuid not null references public.pruebas_lotes (id),
  tabla          text not null,
  fila_id        uuid not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_pruebas_filas_fila unique (tabla, fila_id)
);

-- Índice de la llave a pruebas_lotes: cumple (b), `pruebas_limpiar` filtra por
-- lote_id en cada paso.
create index if not exists ix_pruebas_filas_lote on public.pruebas_filas (lote_id, orden);

comment on table public.pruebas_filas is
  'Cada fila creada dentro de un lote de prueba, en el orden en que nació. La limpieza la recorre al revés.';

create sequence if not exists public.pruebas_numero;

-- Nadie las toca desde la API: se leen como administrador y se escriben solo
-- con las funciones de abajo.
alter table public.pruebas_cuentas enable row level security;
alter table public.pruebas_lotes   enable row level security;
alter table public.pruebas_filas   enable row level security;

drop policy if exists ver_pruebas_cuentas on public.pruebas_cuentas;
create policy ver_pruebas_cuentas on public.pruebas_cuentas
  for select to authenticated using (public.es_admin());

drop policy if exists ver_pruebas_lotes on public.pruebas_lotes;
create policy ver_pruebas_lotes on public.pruebas_lotes
  for select to authenticated using (public.es_admin());

drop policy if exists ver_pruebas_filas on public.pruebas_filas;
create policy ver_pruebas_filas on public.pruebas_filas
  for select to authenticated using (public.es_admin());

revoke all on public.pruebas_cuentas, public.pruebas_lotes, public.pruebas_filas from public, anon, authenticated;
grant select on public.pruebas_cuentas, public.pruebas_lotes, public.pruebas_filas to authenticated;
revoke all on sequence public.pruebas_numero from public, anon, authenticated;

do $timestamps$
begin
  perform public.activar_timestamps('pruebas_cuentas');
  perform public.activar_timestamps('pruebas_lotes');
  perform public.activar_timestamps('pruebas_filas');
end
$timestamps$;


-- ------------------------------------------------ ¿esta inserción es de prueba?
create or replace function public.lote_de_prueba()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_marca text := nullif(current_setting('pruebas.lote', true), '');
  v_lote  uuid;
  v_uid   uuid;
begin
  if v_marca is not null then
    select id into v_lote
      from public.pruebas_lotes
     where id = v_marca::uuid and limpiado_en is null;
    if v_lote is null then
      raise exception 'El lote de prueba % no existe o ya se limpió: fuera de un lote abierto no se crean datos de prueba.', v_marca
        using errcode = 'invalid_parameter_value';
    end if;
    return v_lote;
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return null;
  end if;

  select id into v_lote
    from public.pruebas_lotes
   where limpiado_en is null and v_uid = any (cuentas)
   order by abierto_en desc
   limit 1;
  return v_lote;
end;
$$;

comment on function public.lote_de_prueba is
  'El lote de prueba en curso para esta sesión: el que marca pruebas.lote, o el que tiene atada a la cuenta de prueba que está dentro. NULL si no se está probando.';

revoke all on function public.lote_de_prueba() from public, anon, authenticated;


-- ---------------------------------------------------------- anotar cada fila
create or replace function public.fn_prueba_registrar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lote uuid := public.lote_de_prueba();
  v_uid  uuid;
begin
  if v_lote is null then
    v_uid := auth.uid();
    if v_uid is not null and exists (select 1 from public.pruebas_cuentas where usuario_id = v_uid) then
      raise exception 'Esta es una cuenta de prueba y no tiene un lote de prueba abierto: sin lote no puede crear datos, porque quedarían sueltos.'
        using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;

  insert into public.pruebas_filas (lote_id, tabla, fila_id)
  values (v_lote, tg_table_name, new.id)
  on conflict (tabla, fila_id) do nothing;
  return null;
end;
$$;

revoke all on function public.fn_prueba_registrar() from public, anon, authenticated;

create or replace function public.activar_registro_de_prueba(p_tabla text)
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  execute format('drop trigger if exists trg_prueba_registrar on public.%I', p_tabla);
  execute format(
    'create trigger trg_prueba_registrar after insert on public.%I
       for each row execute function public.fn_prueba_registrar()', p_tabla);
end;
$$;

comment on function public.activar_registro_de_prueba is
  'Engancha una tabla al registro de datos de prueba. Toda tabla nueva con id uuid lo necesita, igual que activar_timestamps.';

revoke all on function public.activar_registro_de_prueba(text) from public, anon, authenticated;

-- Todas las tablas de public con id uuid, menos el propio registro y la serie
-- de la empresa, que se actualiza pero no se inserta al probar.
do $enganchar$
declare
  t text;
begin
  for t in
    select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'id'
                      and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and c.relname not in ('pruebas_lotes', 'series_documentarias')
  loop
    perform public.activar_registro_de_prueba(t);
  end loop;
end
$enganchar$;


-- ------------------------------------------------ los números de prueba
-- Definición viva al 2026-09-14 más el bloque del principio. Nada más cambia.
create or replace function public.siguiente_correlativo(
  p_tipo  public.tipo_correlativo,
  p_serie text default null,
  p_sede  uuid default null
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_serie_id  uuid;
  v_serie     text;
  v_prefijo   text;
  v_longitud  int;
  v_formato   text;
  v_numero    bigint;
  v_texto     text;
  v_resultado text;
begin
  -- Dentro de un lote de prueba el número sale de su propia cuenta: la serie
  -- de la empresa no se mueve, y al limpiar no queda hueco.
  if public.lote_de_prueba() is not null then
    return 'PRUEBA-' || lpad(nextval('public.pruebas_numero')::text, 4, '0');
  end if;

  if p_sede is not null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo and (p_serie is null or serie = p_serie)
       and activo and sede_id = p_sede
     order by serie limit 1 for update;
  end if;

  if v_serie_id is null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo and (p_serie is null or serie = p_serie)
       and activo and sede_id is null
     order by serie limit 1 for update;
  end if;

  if v_serie_id is null then
    raise exception 'No existe una serie documentaria activa para el tipo % (serie %, sede %)',
      p_tipo, coalesce(p_serie, '<cualquiera>'), coalesce(p_sede::text, '<global>')
      using errcode = 'no_data_found';
  end if;

  update public.series_documentarias
     set correlativo_actual = correlativo_actual + 1,
         actualizado_en = now()
   where id = v_serie_id
  returning serie, prefijo, longitud, correlativo_actual, formato
    into v_serie, v_prefijo, v_longitud, v_numero, v_formato;

  -- El relleno con ceros nunca recorta: si el número ya superó el ancho de la
  -- serie, se emite completo. Un número largo es feo; uno truncado es un
  -- duplicado.
  v_texto := v_numero::text;
  if length(v_texto) < v_longitud then
    v_texto := lpad(v_texto, v_longitud, '0');
  end if;

  v_resultado := replace(v_formato,    '{numero}',  v_texto);
  v_resultado := replace(v_resultado,  '{serie}',   v_serie);
  v_resultado := replace(v_resultado,  '{anio}',    to_char(now(), 'YYYY'));
  v_resultado := replace(v_resultado,  '{prefijo}', coalesce(nullif(v_prefijo, ''), ''));

  v_resultado := btrim(v_resultado, '-');
  return regexp_replace(v_resultado, '-{2,}', '-', 'g');
end;
$$;


-- ------------------------------------------------------------ abrir un lote
create or replace function public.pruebas_abrir(p_motivo text, p_cuentas uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ajena uuid;
  v_lote  uuid;
begin
  select c into v_ajena
    from unnest(coalesce(p_cuentas, '{}')) c
   where not exists (select 1 from public.pruebas_cuentas pc where pc.usuario_id = c)
   limit 1;
  if v_ajena is not null then
    raise exception 'La cuenta % no está registrada como cuenta de prueba: lo que hace una persona real no se ata a un lote.', v_ajena
      using errcode = 'invalid_parameter_value';
  end if;

  select c into v_ajena
    from unnest(coalesce(p_cuentas, '{}')) c
   where exists (select 1 from public.pruebas_lotes l where l.limpiado_en is null and c = any (l.cuentas))
   limit 1;
  if v_ajena is not null then
    raise exception 'La cuenta de prueba % ya está en otro lote abierto: límpialo antes de abrir uno nuevo.', v_ajena
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.pruebas_lotes (motivo, cuentas)
  values (p_motivo, coalesce(p_cuentas, '{}'))
  returning id into v_lote;
  return v_lote;
end;
$$;

revoke all on function public.pruebas_abrir(text, uuid[]) from public, anon, authenticated;


-- --------------------------------------------------- limpiar al confirmar
create or replace function public.pruebas_limpiar(p_lote uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lote     public.pruebas_lotes%rowtype;
  v_tablas   text[];
  v_apagados text[] := '{}';
  v_ajenas   text[] := '{}';
  v_archivos jsonb;
  v_total    integer := 0;
  v_n        integer;
  r          record;
  v_par      text;
begin
  select * into v_lote from public.pruebas_lotes where id = p_lote for update;
  if not found then
    raise exception 'No existe el lote de prueba %.', p_lote using errcode = 'no_data_found';
  end if;
  if v_lote.limpiado_en is not null then
    raise exception 'El lote de prueba % ya se limpió el %.', p_lote, v_lote.limpiado_en;
  end if;

  -- Lo que se borre desde aquí no se anota como prueba nueva.
  perform set_config('pruebas.lote', '', true);

  v_tablas := array(select distinct tabla from public.pruebas_filas where lote_id = p_lote);

  -- 1. Ninguna fila real puede colgar de un dato de prueba.
  for r in
    select hija.relname as hija, col.attname as columna, padre.relname as padre,
           exists (select 1 from pg_attribute ia
                    where ia.attrelid = hija.oid and ia.attname = 'id'
                      and ia.atttypid = 'uuid'::regtype and not ia.attisdropped) as hija_con_id
      from pg_constraint con
      join pg_class hija   on hija.oid  = con.conrelid
      join pg_class padre  on padre.oid = con.confrelid
      join pg_attribute col  on col.attrelid  = con.conrelid  and col.attnum  = con.conkey[1]
      join pg_attribute pcol on pcol.attrelid = con.confrelid and pcol.attnum = con.confkey[1]
     where con.contype = 'f'
       and array_length(con.conkey, 1) = 1
       and pcol.attname = 'id'
       and hija.relnamespace = 'public'::regnamespace
       and padre.relnamespace = 'public'::regnamespace
       and padre.relname = any (v_tablas)
       and hija.relname not in ('pruebas_filas')
  loop
    if r.hija_con_id then
      execute format(
        'select count(*) from public.%I h
          where h.%I in (select f.fila_id from public.pruebas_filas f where f.lote_id = $1 and f.tabla = $2)
            and not exists (select 1 from public.pruebas_filas f2
                             where f2.lote_id = $1 and f2.tabla = $3 and f2.fila_id = h.id)',
        r.hija, r.columna)
        using p_lote, r.padre, r.hija into v_n;
    else
      execute format(
        'select count(*) from public.%I h
          where h.%I in (select f.fila_id from public.pruebas_filas f where f.lote_id = $1 and f.tabla = $2)',
        r.hija, r.columna)
        using p_lote, r.padre into v_n;
    end if;
    if v_n > 0 then
      v_ajenas := v_ajenas || format('%s fila(s) de %s por %s', v_n, r.hija, r.columna);
    end if;
  end loop;

  if cardinality(v_ajenas) > 0 then
    raise exception 'No se limpia el lote %: hay datos que no son de la prueba colgando de ella (%). Revísalos antes de borrar.',
      p_lote, array_to_string(v_ajenas, '; ')
      using errcode = 'foreign_key_violation';
  end if;

  -- 2. Archivos que subió la prueba: se listan, Storage no se borra por SQL.
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'ruta', o.name)), '[]'::jsonb)
    into v_archivos
    from storage.objects o
   where o.created_at >= v_lote.abierto_en
     and (o.owner = any (v_lote.cuentas)
          or exists (select 1 from public.pruebas_filas f
                      where f.lote_id = p_lote and o.name like '%' || f.fila_id::text || '%'));

  -- 3. Los candados de borrado, apagados solo en las tablas del lote y solo
  --    dentro de esta transacción.
  for r in
    select c.relname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname = any (v_tablas)
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and (t.tgtype & 2) = 2      -- BEFORE
       and (t.tgtype & 8) = 8      -- DELETE
       and (t.tgtype & 64) = 0     -- no INSTEAD OF
  loop
    execute format('alter table public.%I disable trigger %I', r.relname, r.tgname);
    v_apagados := v_apagados || (r.relname || '|' || r.tgname);
  end loop;

  -- 4. Borrar en orden inverso al de nacimiento: primero los hijos.
  for r in
    select tabla, fila_id from public.pruebas_filas where lote_id = p_lote order by orden desc
  loop
    execute format('delete from public.%I where id = $1', r.tabla) using r.fila_id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  -- 5. El rastro de auditoría de la prueba, incluido el que dejó este borrado.
  delete from public.audit_log a
   where a.registro_id in (select f.fila_id from public.pruebas_filas f where f.lote_id = p_lote);

  -- 6. Los candados vuelven a su sitio antes de terminar.
  foreach v_par in array v_apagados loop
    execute format('alter table public.%I enable trigger %I',
                   split_part(v_par, '|', 1), split_part(v_par, '|', 2));
  end loop;

  update public.pruebas_lotes
     set limpiado_en = now(),
         filas_borradas = v_total,
         archivos_pendientes = v_archivos
   where id = p_lote;

  return jsonb_build_object(
    'lote', p_lote,
    'filas_borradas', v_total,
    'tablas', to_jsonb(v_tablas),
    'archivos_pendientes', v_archivos);
end;
$$;

comment on function public.pruebas_limpiar is
  'Borra todo lo que creó un lote de prueba, con su auditoría, y lo da por limpiado. Se niega si alguna fila real cuelga de un dato de prueba.';

revoke all on function public.pruebas_limpiar(uuid) from public, anon, authenticated;
