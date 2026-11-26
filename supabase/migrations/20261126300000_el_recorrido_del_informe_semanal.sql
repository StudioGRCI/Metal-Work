-- =============================================================================
-- EL RECORRIDO DEL INFORME SEMANAL DE DISEÑO
-- -----------------------------------------------------------------------------
-- El colaborador de Diseño llena cada semana el informe MW-IF-DI-01 y lo envía;
-- Diseño lo aprueba o se lo devuelve con un motivo. Hasta hoy el colaborador
-- veía solo el estado de la semana que tenía abierta: no sabía cuándo lo envió,
-- cuántas veces se lo devolvieron ni por qué, y para mirar una semana anterior
-- tenía que acordarse de su fecha (Plan 7, entrega 7.1).
--
-- Tres piezas, ninguna tabla nueva:
--
--   1. `recorrido_de_informes_diseno`: el recorrido del informe con la misma
--      forma que el del RQ y la cotización (migración 20261125130000), para el
--      componente «Recorrido». Las fechas y firmas de la última vuelta están en
--      columnas (`enviado_en`, `revisado_por`, `revisado_en`), pero cada envío
--      pisa la anterior y borra el motivo de la devolución: las vueltas de antes
--      salen de la bitácora (`audit_log`), que guarda cada cambio de estado con
--      quién y cuándo. Si un informe no tiene bitácora, salen las columnas.
--   2. `informes_de_diseno_propios`: las semanas del colaborador, para abrirlas
--      en lectura. El informe es uno por semana para toda el área (la serie
--      N.º 022, 023… del formato), así que «suyas» son las que él empezó o en
--      las que anotó alguna actividad.
--   3. El aviso de la campana cuando Diseño devuelve el informe ya trae el
--      motivo, y el número va con sus tres cifras, como en el formato (N.º 022).
--
-- Quién lee el recorrido: quien ya ve el informe (`diseno_informes_ver`), ni uno
-- más. De cada paso sale el puesto de quien lo hizo, nunca su nombre (DKS,
-- 2026-11-25), y nunca un importe ni un dato de RR. HH.
-- =============================================================================

-- =============================================================================
-- 1. EL RECORRIDO DEL INFORME
-- =============================================================================
-- Borrador → enviado a Diseño → aprobado, o devuelto con su motivo → corregido
-- y enviado otra vez → … Mientras está en borrador o devuelto, lo tiene el
-- colaborador; enviado, Diseño. Aprobado, ya no espera a nadie.
--
-- Las claves de cada paso y de cada espera se ponen en palabras en
-- `src/lib/dominio/recorrido.ts`.
create or replace function public.recorrido_de_informes_diseno(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  -- Quien lo revisa: el puesto que tiene `diseno.revisar_informe`.
  v_diseno constant text := coalesce((select r.nombre from public.roles r where r.codigo = 'DISENO'), 'Diseño');
begin
  -- La política `diseno_informes_ver`, tal cual: no depende de la fila.
  if not (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general')) then
    raise exception 'No tienes permiso para ver el informe semanal de Diseño.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'Pide el recorrido de hasta 200 informes a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with inf as (
    select i.id, i.estado, i.creado_por, i.creado_en, i.enviado_en, i.revisado_por, i.revisado_en,
           i.recibido_por, i.recibido_en, i.observacion_revision
      from public.diseno_informes i
     where i.id = any(p_ids)
  ),
  -- Cada cambio de estado, con quién y cuándo, de la bitácora.
  cambios as (
    select b.registro_id as inf, b.id as seq, b.creado_en as en, b.usuario_id as quien,
           b.datos_despues ->> 'estado' as estado,
           nullif(btrim(b.datos_despues ->> 'observacion_revision'), '') as motivo
      from public.audit_log b
      join inf i on i.id = b.registro_id
     where b.tabla = 'diseno_informes'
       and b.accion = 'UPDATE'
       and (b.datos_antes ->> 'estado') is distinct from (b.datos_despues ->> 'estado')
  ),
  con_bitacora as (
    select distinct c.inf from cambios c
  ),
  -- La última vez que se devolvió: desde ahí espera la corrección.
  ultima_devolucion as (
    select distinct on (c.inf) c.inf, c.en
      from cambios c where c.estado = 'OBSERVADO'
     order by c.inf, c.en desc
  ),
  pasos as (
    -- Lo que pasó a la misma hora (en una prueba, toda la transacción) se
    -- desempata por el orden de la bitácora (`seq`) y, sin ella, por el del
    -- circuito (`canon`).
    -- El colaborador lo empezó
    select i.id as inf, 0::bigint as seq, 0 as canon, 'REGISTRO' as paso, 'HECHO' as situacion, i.creado_por as quien,
           null::text as puesto_fijo, i.creado_en as en, null::text as espera, null::text as detalle
      from inf i
    union all
    -- Cada vuelta, de la bitácora
    select c.inf, c.seq,
           case c.estado when 'EN_REVISION' then 1 when 'OBSERVADO' then 2 when 'APROBADO' then 3 else 4 end,
           case c.estado when 'EN_REVISION' then 'ENVIO' when 'OBSERVADO' then 'DEVOLUCION'
                         when 'APROBADO' then 'APROBACION' when 'RECIBIDO' then 'RECEPCION' end,
           'HECHO', c.quien, null, c.en, null, case when c.estado = 'OBSERVADO' then c.motivo end
      from cambios c
     where c.estado in ('EN_REVISION', 'OBSERVADO', 'APROBADO', 'RECIBIDO')
    union all
    -- Sin bitácora, la última vuelta sale de las columnas.
    select i.id, 0, 1, 'ENVIO', 'HECHO', i.creado_por, null, i.enviado_en, null, null
      from inf i
     where i.enviado_en is not null and not exists (select 1 from con_bitacora b where b.inf = i.id)
    union all
    select i.id, 0,
           case when i.estado in ('APROBADO', 'RECIBIDO') then 3 else 2 end,
           case when i.estado in ('APROBADO', 'RECIBIDO') then 'APROBACION' else 'DEVOLUCION' end,
           'HECHO', i.revisado_por, null, i.revisado_en, null,
           case when i.estado = 'OBSERVADO' then nullif(btrim(i.observacion_revision), '') end
      from inf i
     where i.revisado_en is not null and not exists (select 1 from con_bitacora b where b.inf = i.id)
    union all
    select i.id, 0, 4, 'RECEPCION', 'HECHO', i.recibido_por, null, i.recibido_en, null, null
      from inf i
     where i.recibido_en is not null and not exists (select 1 from con_bitacora b where b.inf = i.id)
    union all
    -- En borrador: lo tiene el colaborador hasta que lo envía.
    select i.id, 0, 10, 'ENVIO', 'AHORA', null, coalesce(public.puesto_de(i.creado_por), 'Colaborador de Diseño'),
           i.creado_en, 'ENVIO', null
      from inf i where i.estado = 'BORRADOR'
    union all
    -- Devuelto: lo tiene el colaborador para corregirlo, desde la devolución.
    select i.id, 0, 10, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(i.creado_por), 'Colaborador de Diseño'),
           coalesce(d.en, i.revisado_en), 'CORRECCION', null
      from inf i left join ultima_devolucion d on d.inf = i.id
     where i.estado = 'OBSERVADO'
    union all
    -- Enviado: lo tiene Diseño, desde el envío.
    select i.id, 0, 10, 'REVISION', 'AHORA', null, v_diseno, i.enviado_en, 'REVISION', null
      from inf i where i.estado = 'EN_REVISION'
    union all
    -- Lo que falta: la revisión de Diseño.
    select i.id, 0, 20, 'REVISION', 'PENDIENTE', null, null, null, null, null
      from inf i where i.estado in ('BORRADOR', 'OBSERVADO')
  )
  select p.inf,
         (row_number() over (
            partition by p.inf
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.seq, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien
   where p.paso is not null;
end;
$$;

comment on function public.recorrido_de_informes_diseno(uuid[]) is
  'El recorrido de cada informe semanal de Diseño, un paso por fila: lo hecho (borrador, cada envío, cada devolución con su motivo, la aprobación) con el puesto de quien lo hizo y su hora; quién lo tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Las vueltas anteriores salen de la bitácora. Lo lee quien ve el informe (diseno_informes_ver).';

revoke all on function public.recorrido_de_informes_diseno(uuid[]) from public, anon;
grant execute on function public.recorrido_de_informes_diseno(uuid[]) to authenticated;

-- =============================================================================
-- 2. LAS SEMANAS DEL COLABORADOR
-- =============================================================================
-- Las que empezó o en las que anotó una actividad, de la más reciente a la más
-- antigua. Corre con el RLS de quien la llama (`security invoker`): no abre
-- nada que el informe y sus actividades no dejen ver ya.
create or replace function public.informes_de_diseno_propios()
returns table (
  id            uuid,
  numero        integer,
  semana_inicio date,
  estado        text,
  enviado_en    timestamptz,
  revisado_en   timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select i.id, i.numero, i.semana_inicio, i.estado, i.enviado_en, i.revisado_en
    from public.diseno_informes i
   where i.creado_por = public.usuario_actual()
      or exists (select 1 from public.diseno_tareas t
                  where t.creado_por = public.usuario_actual()
                    and t.fecha_inicio <= i.semana_inicio + 6
                    and t.fecha_entrega >= i.semana_inicio)
   order by i.semana_inicio desc
   limit 104;
$$;

comment on function public.informes_de_diseno_propios() is
  'Los informes semanales de Diseño que la cuenta empezó o en cuya semana anotó una actividad, de los dos últimos años, del más reciente al más antiguo. Security invoker: respeta el RLS de diseno_informes y diseno_tareas.';

revoke all on function public.informes_de_diseno_propios() from public, anon;
grant execute on function public.informes_de_diseno_propios() to authenticated;

-- =============================================================================
-- 3. EL AVISO CUANDO DISEÑO RESPONDE
-- =============================================================================
-- La campana ya avisaba al colaborador cuando Diseño aprobaba o devolvía el
-- informe (migración 20261001213000), pero el aviso de la devolución no decía
-- por qué: había que abrir la semana para enterarse. Ahora el motivo va en el
-- aviso, y el número con sus tres cifras, como en el formato.
--
-- Producción pudo cambiar la función a mano: si no es la que conoce el
-- repositorio, la migración se detiene en vez de pisarla.
do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.notificar_revision_informe_diseno()');
  if huella is null then
    raise exception 'Falta la función notificar_revision_informe_diseno: esta base no tiene las migraciones anteriores.';
  end if;
  -- La de la migración 20261001213000 y la de esta.
  if huella not in ('39016c20a0736ddba939b5772fb17d58', '7290ccfd98f5819936d8e8e08d1c3d86') then
    raise exception 'La función notificar_revision_informe_diseno no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', huella;
  end if;
end $$;

create or replace function public.notificar_revision_informe_diseno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_permiso text;
  v_titulo  text;
  v_cuerpo  text;
  v_motivo  text;
begin
  if new.estado = old.estado then return new; end if;
  if new.estado = 'EN_REVISION' then v_permiso := 'diseno.revisar_informe'; v_titulo := 'Informe de Diseño pendiente de revisión';
  elsif new.estado = 'APROBADO' then v_permiso := 'diseno.preparar_informe'; v_titulo := 'Informe de Diseño aprobado';
  elsif new.estado = 'OBSERVADO' then v_permiso := 'diseno.preparar_informe'; v_titulo := 'Informe de Diseño devuelto para corregir';
  else return new; end if;
  v_cuerpo := 'Informe N.º ' || lpad(new.numero::text, 3, '0') || ' · semana del ' || to_char(new.semana_inicio, 'DD/MM/YYYY');
  if new.estado = 'OBSERVADO' then
    v_motivo := regexp_replace(btrim(coalesce(new.observacion_revision, '')), '\s+', ' ', 'g');
    if v_motivo <> '' then
      v_cuerpo := v_cuerpo || '. Motivo: '
               || case when length(v_motivo) > 180 then left(v_motivo, 179) || '…' else v_motivo end;
    end if;
  end if;
  perform public.notificar_a_permiso(v_permiso, v_titulo, v_cuerpo,
    '/diseno/informe-semanal?semana=' || new.semana_inicio, 'diseno_informes', new.id, public.usuario_actual());
  return new;
end $$;

revoke all on function public.notificar_revision_informe_diseno() from public, anon, authenticated;
