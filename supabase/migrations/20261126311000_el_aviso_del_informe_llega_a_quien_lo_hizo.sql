-- =============================================================================
-- EL AVISO DEL INFORME LLEGA A QUIEN LO HIZO, Y EL RECORRIDO TOMA LA ÚLTIMA
-- VUELTA DE SUS COLUMNAS
-- -----------------------------------------------------------------------------
-- Arreglos de la revisión de la migración 20261126300000 (Plan 7, entrega 7.1),
-- que ya está en producción y por eso no se reescribe:
--
--   1. Cuando Diseño aprueba o devuelve el informe, el aviso de la campana —que
--      ahora trae el motivo— iba a toda cuenta que llena informes. Va a quien lo
--      hizo: la cuenta que lo empezó y las que anotaron actividades en esa
--      semana. Si ninguna de ellas sigue activa, va como antes a todo el puesto,
--      para que nadie se quede sin saber que hay algo por corregir. El aviso de
--      «pendiente de revisión» a Diseño no cambia.
--   2. El número del aviso va con tres cifras como mínimo, sin cortar: con
--      `lpad(n, 3)` el N.º 1000 salía «100».
--   3. El recorrido toma de la bitácora solo lo que no tiene columna (Plan 0):
--      las vueltas anteriores. La última vuelta —el envío, la revisión, la
--      recepción— sale de sus columnas (`enviado_en`, `revisado_por`,
--      `revisado_en`…) si la bitácora no tiene esa misma fila; así un informe
--      enviado antes de que se auditara la tabla no pierde pasos.
--   4. La función del recorrido exige lo mismo que la política
--      `diseno_informes_ver`, sin el `es_admin()` que la política no tiene y
--      con el `diseno.ver_informes` de Gerencia (migración 20261126310000,
--      que corre antes que esta y le sumó ese permiso a la función).
--   5. «Lo tiene Diseño» nombra el puesto como los pasos hechos: el cargo de
--      la cuenta de Diseño, no el nombre del rol. Decía «Diseño e ingeniería»
--      en un paso y «Diseño» en el de al lado.
-- =============================================================================

-- =============================================================================
-- 1. EL RECORRIDO, CON LA ÚLTIMA VUELTA DE SUS COLUMNAS
-- =============================================================================
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
  -- Quien lo revisa, nombrado como en los pasos hechos: el puesto de la cuenta
  -- activa de Diseño (su cargo); sin ninguna, el nombre del rol.
  v_diseno constant text := coalesce(
    (select public.puesto(u) from public.usuarios u join public.roles r on r.id = u.rol_id
      where r.codigo = 'DISENO' and u.activo order by u.creado_en limit 1),
    (select r.nombre from public.roles r where r.codigo = 'DISENO'), 'Diseño');
begin
  -- La política `diseno_informes_ver`, tal cual: no depende de la fila. Con
  -- `diseno.ver_informes`, que le sumó la migración 20261126310000 para que
  -- Gerencia consulte el informe: sin él, a Gerencia se le cae la pantalla.
  if not (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general') or public.tiene_permiso('diseno.ver_informes')) then
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
    -- Cada vuelta que la bitácora guarda
    select c.inf, c.seq,
           case c.estado when 'EN_REVISION' then 1 when 'OBSERVADO' then 2 when 'APROBADO' then 3 else 4 end,
           case c.estado when 'EN_REVISION' then 'ENVIO' when 'OBSERVADO' then 'DEVOLUCION'
                         when 'APROBADO' then 'APROBACION' when 'RECIBIDO' then 'RECEPCION' end,
           'HECHO', c.quien, null, c.en, null, case when c.estado = 'OBSERVADO' then c.motivo end
      from cambios c
     where c.estado in ('EN_REVISION', 'OBSERVADO', 'APROBADO', 'RECIBIDO')
    union all
    -- La última vuelta, de sus columnas, si la bitácora no la tiene. La hora de
    -- la columna y la de su fila de bitácora son la misma: las dos son la de la
    -- transacción que cambió el estado.
    select i.id, 0, 1, 'ENVIO', 'HECHO', i.creado_por, null, i.enviado_en, null, null
      from inf i
     where i.enviado_en is not null
       and not exists (select 1 from cambios c where c.inf = i.id and c.estado = 'EN_REVISION' and c.en = i.enviado_en)
    union all
    select i.id, 0,
           case when i.estado in ('APROBADO', 'RECIBIDO') then 3 else 2 end,
           case when i.estado in ('APROBADO', 'RECIBIDO') then 'APROBACION' else 'DEVOLUCION' end,
           'HECHO', i.revisado_por, null, i.revisado_en, null,
           case when i.estado = 'OBSERVADO' then nullif(btrim(i.observacion_revision), '') end
      from inf i
     where i.revisado_en is not null
       and not exists (select 1 from cambios c where c.inf = i.id and c.estado in ('OBSERVADO', 'APROBADO') and c.en = i.revisado_en)
    union all
    select i.id, 0, 4, 'RECEPCION', 'HECHO', i.recibido_por, null, i.recibido_en, null, null
      from inf i
     where i.recibido_en is not null
       and not exists (select 1 from cambios c where c.inf = i.id and c.estado = 'RECIBIDO' and c.en = i.recibido_en)
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
  'El recorrido de cada informe semanal de Diseño, un paso por fila: lo hecho (borrador, cada envío, cada devolución con su motivo, la aprobación) con el puesto de quien lo hizo y su hora; quién lo tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. La última vuelta sale de sus columnas; las anteriores, de la bitácora. Lo lee quien ve el informe (diseno_informes_ver).';

revoke all on function public.recorrido_de_informes_diseno(uuid[]) from public, anon;
grant execute on function public.recorrido_de_informes_diseno(uuid[]) to authenticated;

-- =============================================================================
-- 2. EL AVISO, A QUIEN HIZO EL INFORME
-- =============================================================================
do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.notificar_revision_informe_diseno()');
  if huella is null then
    raise exception 'Falta la función notificar_revision_informe_diseno: esta base no tiene las migraciones anteriores.';
  end if;
  -- La de la migración 20261126300000 y la de esta.
  if huella not in ('7290ccfd98f5819936d8e8e08d1c3d86', 'fb19890f2110bf4801540ff602044c99') then
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
  v_titulo  text;
  v_cuerpo  text;
  v_motivo  text;
  v_ruta    text;
  v_numero  text;
  v_filas   integer;
begin
  if new.estado = old.estado then return new; end if;
  if new.estado not in ('EN_REVISION', 'APROBADO', 'OBSERVADO') then return new; end if;

  v_numero := new.numero::text;
  v_numero := lpad(v_numero, greatest(3, length(v_numero)), '0');
  v_cuerpo := 'Informe N.º ' || v_numero || ' · semana del ' || to_char(new.semana_inicio, 'DD/MM/YYYY');
  v_ruta := '/diseno/informe-semanal?semana=' || new.semana_inicio;

  -- Enviado: a quien lo revisa, como siempre.
  if new.estado = 'EN_REVISION' then
    perform public.notificar_a_permiso('diseno.revisar_informe', 'Informe de Diseño pendiente de revisión', v_cuerpo,
      v_ruta, 'diseno_informes', new.id, public.usuario_actual());
    return new;
  end if;

  if new.estado = 'APROBADO' then
    v_titulo := 'Informe de Diseño aprobado';
  else
    v_titulo := 'Informe de Diseño devuelto para corregir';
    v_motivo := regexp_replace(btrim(coalesce(new.observacion_revision, '')), '\s+', ' ', 'g');
    if v_motivo <> '' then
      v_cuerpo := v_cuerpo || '. Motivo: '
               || case when length(v_motivo) > 180 then left(v_motivo, 179) || '…' else v_motivo end;
    end if;
  end if;

  -- Aprobado o devuelto: a quien lo hizo, la cuenta que lo empezó y las que
  -- anotaron actividades en esa semana, si siguen llenando informes.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, v_titulo, v_cuerpo, v_ruta, 'diseno_informes', new.id
    from public.usuarios u
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = u.rol_id and rp.permiso_codigo = 'diseno.preparar_informe')
     and (u.id = new.creado_por
          or exists (select 1 from public.diseno_tareas t
                      where t.creado_por = u.id
                        and t.fecha_inicio <= new.semana_inicio + 6
                        and t.fecha_entrega >= new.semana_inicio));
  get diagnostics v_filas = row_count;

  -- Si ya no está ninguno, al puesto entero: alguien tiene que saberlo.
  if v_filas = 0 then
    perform public.notificar_a_permiso('diseno.preparar_informe', v_titulo, v_cuerpo,
      v_ruta, 'diseno_informes', new.id, public.usuario_actual());
  end if;
  return new;
end $$;

revoke all on function public.notificar_revision_informe_diseno() from public, anon, authenticated;
