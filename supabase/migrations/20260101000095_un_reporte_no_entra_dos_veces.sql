-- =============================================================================
-- UN REPORTE NO ENTRA DOS VECES
-- -----------------------------------------------------------------------------
-- El 9 de septiembre un supervisor registró el reporte del día de una unidad
-- sin orden y entraron tres, iguales, con un segundo de diferencia. El botón no
-- se desactivaba mientras enviaba —React 19 no pinta el estado que se prende
-- dentro de una acción de formulario— y cada toque de más quedó en cola. Antes
-- había pasado lo mismo con dos contactos iguales.
--
-- La pantalla ya está arreglada (`src/lib/envio.ts`), pero la regla es del
-- negocio y vive en la base: el mismo reporte, con las mismas palabras, sobre
-- lo mismo y el mismo día, no se escribe dos veces. Si hubo algo más que
-- contar, se cuenta con otras palabras.
--
-- «Las mismas palabras» se comparan sin mayúsculas ni espacios de más: «Se
-- soldó el piso» y «se soldó  el piso » son el mismo reporte.
--
-- Comprobado antes de escribirla: ninguna de las tres tablas tiene hoy dos
-- reportes que choquen con estas reglas (los dos repetidos de Tac-890 se
-- borraron el 2026-09-10, con el visto del cliente).
-- =============================================================================

-- ---------------------------------------- 1. el reporte de un trabajo sin orden
-- Un trabajo, un área, un día. Dos áreas pueden contar lo suyo del mismo día.
create unique index if not exists uq_flota_avance_no_se_repite
  on public.flota_avances (
    flota_id, area_id, fecha,
    md5(lower(regexp_replace(btrim(descripcion), '\s+', ' ', 'g')))
  );

comment on index public.uq_flota_avance_no_se_repite is
  'El mismo reporte, con las mismas palabras, sobre el mismo trabajo, del mismo área y el mismo día, no entra dos veces. Existe por el reporte que entró tres veces el 2026-09-09.';

-- ------------------------------------------- 2. el avance con foto de una orden
create unique index if not exists uq_ot_avance_no_se_repite
  on public.ot_avances (
    orden_id, fecha,
    md5(lower(regexp_replace(btrim(descripcion), '\s+', ' ', 'g')))
  );

comment on index public.uq_ot_avance_no_se_repite is
  'El mismo avance, con las mismas palabras, sobre la misma orden y el mismo día, no entra dos veces.';

-- ------------------------------------ 3. lo que un área reporta en los plazos
-- No tiene fecha propia sino la hora en que se escribió, y un índice no puede
-- partir esa hora en días de Lima. La regla va por tiempo: la misma persona,
-- sobre la misma etapa, con el mismo texto, dentro de diez minutos, es un
-- toque de más. Mañana puede volver a escribir «sigue faltando la plancha».
--
-- El autor se toma de la sesión y no de `new.creado_por`: este disparador corre
-- antes que `trg_reporte_sellar_autor` (van por orden alfabético), y lo que
-- mande el formulario en esa columna no vale.
create or replace function public.fn_reporte_no_se_repite()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (
    select 1
      from public.ot_etapa_reportes r
     where r.etapa_id = new.etapa_id
       and r.creado_por = public.usuario_actual()
       and r.creado_en > now() - interval '10 minutes'
       and lower(regexp_replace(btrim(r.texto), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(new.texto), '\s+', ' ', 'g'))
  ) then
    raise exception 'Ese reporte ya se envió hace un momento. Si hay algo más, escríbelo con otras palabras.';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_reporte_no_se_repite() from public, anon, authenticated;

drop trigger if exists trg_reporte_no_se_repite on public.ot_etapa_reportes;
create trigger trg_reporte_no_se_repite
  before insert on public.ot_etapa_reportes
  for each row execute function public.fn_reporte_no_se_repite();

-- =============================================================================
-- COMPROBACIÓN
-- =============================================================================
do $$
declare v_faltan text;
begin
  select string_agg(n, ', ') into v_faltan
    from unnest(array['uq_flota_avance_no_se_repite', 'uq_ot_avance_no_se_repite']) as n
   where to_regclass('public.' || n) is null;

  if v_faltan is not null then
    raise exception 'No se crearon los índices: %', v_faltan;
  end if;

  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_reporte_no_se_repite'
                    and tgrelid = 'public.ot_etapa_reportes'::regclass) then
    raise exception 'No se creó el disparador trg_reporte_no_se_repite';
  end if;
end $$;
