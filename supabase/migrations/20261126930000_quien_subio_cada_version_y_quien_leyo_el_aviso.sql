-- =============================================================================
-- QUIÉN SUBIÓ CADA VERSIÓN DE UN PLANO O UN DXF, Y SI EL TALLER LEYÓ EL AVISO
-- -----------------------------------------------------------------------------
-- Plan 6 (Diseño e Ingeniería), entrega 6.3. Diseño sube un plano, una revisión
-- o un envío de DXF y al supervisor del área le llega un aviso. Hasta hoy Diseño
-- veía cuándo subió cada versión, pero no quién de Diseño la subió, ni si
-- Maestranza y Producción ya se enteraron. Lo preguntaba por teléfono.
--
-- El visto del taller sale del aviso leído (decisión del plan): se usa el
-- estado de lectura que el aviso ya guarda (`notificaciones.leida_en`). No se
-- guarda ninguna descarga. «Leído» quiere decir que la cuenta abrió el aviso o
-- marcó todos sus avisos como leídos; no dice que abrió el archivo. Para los
-- planos sigue estando, aparte, la recepción que firma el supervisor.
--
-- Cómo se cruza cada versión con su aviso:
--   · Plano: el aviso lleva `origen_tabla = 'codigo_planos'` y el id del plano,
--     y nace en la misma transacción que la revisión (`registrar_plano_codigo`
--     y `subir_revision_plano`), así que su `creado_en` es el `subido_en` de la
--     revisión. Así se separa el aviso de la R1 del de la R2 y del de la
--     anulación, que llevan el mismo plano.
--   · DXF: un aviso por envío, con `origen_tabla = 'codigo_dxf'` y el id de uno
--     de sus archivos. Si al envío se le suma un archivo, el aviso vuelve a
--     quedar sin leer (`registrar_dxf_codigo`): lo que se ve es lo de ahora.
--
-- Por área se cuenta a las cuentas de esa área que recibieron el aviso: el
-- supervisor de Maestranza o de Producción (`usuarios.area_id`). Quien ve todas
-- las áreas desde otra (`produccion.cualquier_area`) recibe el aviso, pero su
-- cuenta no es de Maestranza ni de Producción, y no se cuenta. Se mira el área
-- que la cuenta tiene hoy, porque el aviso no la guarda: si un supervisor pasa
-- a otra área, las versiones que le llegaron antes quedan «sin aviso» en la
-- de antes. El plano va a un área y da una fila; el envío de DXF va a las dos y
-- da dos.
--
-- Quién subió se dice por su puesto, nunca por el nombre de la persona
-- (decisión del 2026-11-25): `puesto_de`.
--
-- La lee solo Diseño (`diseno.codigos`): son sus pantallas, Planos y Archivos
-- DXF. Es `security definer` porque cada aviso solo lo lee su dueño (RLS de
-- `notificaciones`); devuelve cuántos lo recibieron, cuántos lo leyeron y
-- cuándo, nunca el aviso ni la cuenta. Solo lee.
--
-- El índice: la función busca los avisos por su origen, y `registrar_dxf_codigo`
-- ya lo hacía en cada envío. Sin él, cada lectura recorre todos los avisos de la
-- empresa, que crecen cada día y no se borran. No es de clave foránea: cumple
-- la (b) de la skill `datos` (la aplicación filtra por esa columna). Es parcial,
-- solo con los avisos de planos y DXF.
-- =============================================================================

create index if not exists ix_notificaciones_origen_diseno
  on public.notificaciones (origen_id, creado_en)
  where origen_tabla in ('codigo_planos', 'codigo_dxf');

create or replace function public.quien_subio_y_quien_leyo(p_codigo text)
returns table (
  tipo           text,
  clave          uuid,
  subido_por     text,
  subido_en      timestamptz,
  area           text,
  area_nombre    text,
  destinatarios  integer,
  leidos         integer,
  primera_lectura timestamptz,
  ultima_lectura  timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
rows 50
as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  if not (public.es_admin() or public.tiene_permiso('diseno.codigos')) then
    raise exception 'No tienes permiso para ver quién subió los planos y los DXF ni quién leyó su aviso.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_codigo is null then
    return;
  end if;

  return query
  with revisiones as (
    -- Cada revisión de cada plano del código, también de los anulados.
    select r.id as clave, r.subido_por, r.subido_en, p.id as plano, p.area_id
      from public.codigo_planos p
      join public.codigo_plano_revisiones r on r.plano_id = p.id
     where p.codigo_interno = v_codigo
  ),
  envios as (
    -- Cada envío de DXF con algún archivo que no se quitó. Quien sube es uno
    -- por envío; la llegada, el primero de sus archivos.
    select d.envio as clave, (array_agg(d.subido_por order by d.subido_en))[1] as subido_por, min(d.subido_en) as subido_en
      from public.codigo_dxf d
     where d.codigo_interno = v_codigo and d.quitado_en is null
     group by d.envio
  ),
  versiones as (
    select 'PLANO'::text as tipo, v.clave, v.subido_por, v.subido_en, a.id as area_id, a.codigo as area, a.nombre as area_nombre
      from revisiones v join public.areas a on a.id = v.area_id
    union all
    select 'DXF', e.clave, e.subido_por, e.subido_en, a.id, a.codigo, a.nombre
      from envios e cross join public.areas a
     where a.codigo in ('MTZ', 'PRD')
  ),
  avisos as (
    -- El aviso de cada versión, a cada cuenta.
    select 'PLANO'::text as tipo, v.clave, n.usuario_id, n.leida_en
      from revisiones v
      join public.notificaciones n
        on n.origen_tabla = 'codigo_planos' and n.origen_id = v.plano and n.creado_en = v.subido_en
    union all
    select 'DXF', e.clave, n.usuario_id, n.leida_en
      from envios e
      join public.notificaciones n
        on n.origen_tabla = 'codigo_dxf'
       and n.origen_id in (select d.id from public.codigo_dxf d where d.envio = e.clave)
  )
  select v.tipo, v.clave, public.puesto_de(v.subido_por), v.subido_en, v.area, v.area_nombre,
         count(x.usuario_id)::integer,
         count(x.leida_en)::integer,
         min(x.leida_en),
         max(x.leida_en)
    from versiones v
    left join (avisos x join public.usuarios u on u.id = x.usuario_id)
      on x.tipo = v.tipo and x.clave = v.clave and u.area_id = v.area_id
   group by v.tipo, v.clave, v.subido_por, v.subido_en, v.area, v.area_nombre
   order by v.subido_en desc, v.tipo, v.area;
end;
$$;

comment on function public.quien_subio_y_quien_leyo(text) is
  'Por cada revisión de plano y cada envío de DXF de un código interno: quién lo subió (su puesto) y cuándo, y por área (la del plano; Maestranza y Producción para los DXF) a cuántas cuentas de esa área les llegó el aviso, cuántas lo leyeron y cuándo (la primera y la última lectura). El visto sale del aviso leído; no se guardan descargas. Solo Diseño (diseno.codigos).';

revoke all on function public.quien_subio_y_quien_leyo(text) from public, anon;
grant execute on function public.quien_subio_y_quien_leyo(text) to authenticated;
