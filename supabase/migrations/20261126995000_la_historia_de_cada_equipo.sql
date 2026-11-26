-- =============================================================================
-- LA HISTORIA DE CADA EQUIPO
-- -----------------------------------------------------------------------------
-- DKS, Plan 16 (Mantenimiento de equipos), entrega 16.4: «historia de cada
-- equipo (averías, tiempo parado, repetidas) y lectura de Gerencia (equipos
-- parados hoy, los que más fallan).»
--
--   * LA HISTORIA sale de lo que ya se anota: los reportes de avería del equipo
--     y sus pasos (`averia_pasos`, de la 16.3). No se guarda nada aparte que se
--     pueda desfasar.
--       - Averías: los reportes del equipo que no se anularon (el anulado era
--         un error, no una falla).
--       - Tiempo parado: la suma de las horas que Mantenimiento anotó en cada
--         cierre, también en los cierres que después no quedaron bien; y, si el
--         equipo está parado ahora por un reporte, desde cuándo.
--       - Repetida: la avería que se reporta cuando no han pasado 30 días desde
--         que Mantenimiento cerró otra del mismo equipo. Cuántas veces una
--         avería «no quedó bien» se cuenta aparte.
--   * QUIÉN LA VE: quien ve el padrón (Mantenimiento, Almacén y Gerencia) ve
--     las cifras de cada equipo; cada reporte, con lo que dice, solo lo ve quien
--     ya lo veía (`averias_visibles`): Mantenimiento y Gerencia todos; los demás,
--     los suyos y los de su área.
--   * LA LECTURA DE GERENCIA, en Equipos: los parados hoy (desde cuándo y por
--     qué reporte) y los que más fallan en los últimos 90 días.
--
-- Y lo que DKS decidió el 2026-11-26 al ver la 16.3: si quien reportó la avería
-- ya no tiene cuenta activa, la confirma el responsable del área del equipo o
-- Mantenimiento. Antes quedaba «por confirmar» para siempre. La confirmación
-- queda a nombre de quien la hizo, y el recorrido dice que fue en lugar de
-- quien la reportó.
-- =============================================================================

-- 1. Quién confirma -------------------------------------------------------------------------
-- Quien la reportó; si su cuenta ya no está activa, el responsable del área del
-- equipo (`areas.jefe_id`, con cuenta activa) o Mantenimiento. La misma regla la
-- usan el disparador, la función que confirma y la lista que dice a quién le toca.
create or replace function public.averias_puede_confirmar(p_registrado_por uuid, p_area uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.usuario_actual() is not null and public.es_usuario_activo()
     and (p_registrado_por = public.usuario_actual()
          or (not exists (select 1 from public.usuarios u where u.id = p_registrado_por and u.activo)
              and (public.tiene_permiso('averias.atender')
                   or exists (select 1 from public.areas a
                                join public.usuarios j on j.id = a.jefe_id and j.activo
                               where a.id = p_area and a.activo and a.jefe_id = public.usuario_actual()))));
$$;
comment on function public.averias_puede_confirmar(uuid, uuid) is
  'Si quien llama puede decir si quedó bien una avería: quien la reportó; si su cuenta ya no está activa, el responsable activo del área del equipo o Mantenimiento (averias.atender). DKS, 2026-11-26.';
revoke all on function public.averias_puede_confirmar(uuid, uuid) from public, anon, authenticated;

-- 2. El reporte cambia solo por su camino: confirma quien puede ----------------------------
create or replace function public.fn_averia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Lo que dijo quien reportó: no cambia nunca.
  v_reporte constant text[] := array['id', 'numero', 'equipo_id', 'tipo', 'detiene_trabajo', 'riesgo_personas',
                                     'descripcion', 'area_id', 'registrado_por', 'creado_en', 'paro_al_reportar'];
  v_paro    constant text[] := array['paro_el_equipo', 'equipo_estado_antes', 'equipo_nota_antes', 'equipo_parado_desde'];
  v_paso    text := old.estado || '>' || new.estado;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte de avería no se borra: Mantenimiento lo anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'El reporte % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if old.estado = 'CONFIRMADA' then
    raise exception 'El reporte % ya está cerrado y confirmado: queda como evidencia. Si el equipo vuelve a fallar, se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_reporte) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_reporte) k) then
    raise exception 'Lo que dice el reporte % no se corrige: si está mal, Mantenimiento lo anula con su motivo y se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  -- El paro del equipo lo mueven solo las funciones que lo saben: el cierre, la
  -- reapertura y el traspaso al otro reporte que detiene el trabajo.
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_paro) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_paro) k)
     and coalesce(current_setting('averias.cambia_el_paro', true), '') <> old.id::text then
    raise exception 'El paro del equipo no se corrige a mano en el reporte %: lo mueven el cierre y la anulación.', old.numero
      using errcode = 'check_violation';
  end if;

  -- Quién escribió el diagnóstico y cuándo los pone la base, cada vez que cambia.
  if new.diagnostico is distinct from old.diagnostico then
    new.diagnostico_por := coalesce(public.usuario_actual(), new.diagnostico_por);
    new.diagnostico_en := now();
  else
    new.diagnostico_por := old.diagnostico_por;
    new.diagnostico_en := old.diagnostico_en;
  end if;

  if new.estado = old.estado then
    -- Sin cambiar de paso, solo se corrige el diagnóstico mientras se atiende.
    if (to_jsonb(new) - v_paro - 'diagnostico' - 'diagnostico_por' - 'diagnostico_en' - 'actualizado_en')
       is distinct from (to_jsonb(old) - v_paro - 'diagnostico' - 'diagnostico_por' - 'diagnostico_en' - 'actualizado_en')
       or (new.diagnostico is distinct from old.diagnostico and old.estado <> 'EN_ATENCION') then
      raise exception 'El reporte % no se cambia así: sigue su camino (atender, cerrar, confirmar).', old.numero using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if v_paso not in ('REPORTADA>EN_ATENCION', 'REPORTADA>ANULADA', 'EN_ATENCION>CERRADA', 'EN_ATENCION>ANULADA',
                    'CERRADA>CONFIRMADA', 'CERRADA>EN_ATENCION') then
    raise exception 'El reporte % está %: no pasa a %.', old.numero,
      case old.estado when 'REPORTADA' then 'reportado' when 'EN_ATENCION' then 'en atención' when 'CERRADA' then 'cerrado' else lower(old.estado) end,
      case new.estado when 'REPORTADA' then 'reportado' when 'EN_ATENCION' then 'en atención' when 'CERRADA' then 'cerrado'
                      when 'CONFIRMADA' then 'confirmado' when 'ANULADA' then 'anulado' else lower(new.estado) end
      using errcode = 'check_violation';
  end if;

  -- Quién y cuándo los pone la base, venga de donde venga el UPDATE.
  if v_paso = 'REPORTADA>EN_ATENCION' then
    new.atendida_por := coalesce(public.usuario_actual(), new.atendida_por);
    new.atendida_en := now();
  elsif v_paso = 'EN_ATENCION>CERRADA' then
    new.cerrada_por := coalesce(public.usuario_actual(), new.cerrada_por);
    new.cerrada_en := now();
  elsif v_paso = 'CERRADA>CONFIRMADA' then
    new.confirmada_en := now();
  elsif v_paso = 'CERRADA>EN_ATENCION' then
    new.veces_reabierta := old.veces_reabierta + 1;
    new.reabierta_en := now();
    new.cerrada_por := null;
    new.cerrada_en := null;
    new.trabajo_hecho := null;
    new.horas_parado := null;
  end if;
  if v_paso in ('CERRADA>CONFIRMADA', 'CERRADA>EN_ATENCION')
     and not public.averias_puede_confirmar(old.registrado_por, old.area_id) then
    raise exception 'Si quedó bien lo confirma quien reportó la avería; si ya no tiene cuenta, el responsable del área o Mantenimiento.'
      using errcode = 'insufficient_privilege';
  end if;

  -- La anulación se sella aquí y no solo en la función que anula.
  if new.estado = 'ANULADA' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular el reporte % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'El reporte % no está anulado: quién, cuándo y el motivo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_averia_guardia() from public, anon, authenticated;

-- 3. La avería que repite ------------------------------------------------------------------
-- La que se reporta antes de 30 días desde que Mantenimiento cerró otra del
-- mismo equipo. Devuelve la anterior (la más reciente que cumple). Lo usan la
-- lista de reportes y la historia del equipo: la misma regla en los dos.
create or replace function public.averia_que_repite(p_equipo uuid, p_averia uuid, p_creado timestamptz)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.id
    from public.averias p
   where p.equipo_id = p_equipo and p.id <> p_averia and p.estado <> 'ANULADA' and p.creado_en < p_creado
     and exists (select 1 from public.averia_pasos s
                  where s.averia_id = p.id and s.paso = 'CIERRE'
                    and s.hecho_en <= p_creado and s.hecho_en > p_creado - interval '30 days')
   order by p.creado_en desc
   limit 1;
$$;
comment on function public.averia_que_repite(uuid, uuid, timestamptz) is
  'La avería anterior del mismo equipo que Mantenimiento cerró en los 30 días antes de que se reportara esta, o null: esta es una avería repetida.';
revoke all on function public.averia_que_repite(uuid, uuid, timestamptz) from public, anon, authenticated;

-- 4. Cerrar: dice quién confirma ---------------------------------------------------------------
drop function if exists public.averias_cerrar(uuid, text, numeric);
create or replace function public.averias_cerrar(p_id uuid, p_trabajo text, p_horas numeric)
returns table (averia uuid, equipo_vuelve_a text, sigue_parado_por text, avisada boolean, equipo_estado text, confirma text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_trabajo text := btrim(coalesce(p_trabajo, ''));
  v_av      public.averias%rowtype;
  r         record;
  v_activo  boolean;
  v_otro    text;
  v_jefe    uuid;
  -- Quién dice si quedó bien: quien la reportó; si ya no tiene cuenta, el
  -- responsable del área del equipo o, sin él, Mantenimiento.
  v_confirma text;
begin
  perform public.averias_exigir_mantenimiento();
  if char_length(v_trabajo) not between 10 and 2000 then
    raise exception 'Cuenta el trabajo hecho, en 10 a 2000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_horas is null or p_horas < 0 or p_horas > 9999 then
    raise exception 'Anota las horas que el equipo estuvo parado (0 si no se paró).' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias v where v.id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  select u.activo into v_activo from public.usuarios u where u.id = v_av.registrado_por;
  select a.jefe_id into v_jefe
    from public.areas a join public.usuarios j on j.id = a.jefe_id and j.activo
   where a.id = v_av.area_id and a.activo;
  v_confirma := case when coalesce(v_activo, false) then 'QUIEN_REPORTO' when v_jefe is not null then 'RESPONSABLE' else 'MANTENIMIENTO' end;
  if v_av.estado = 'CERRADA' and v_av.trabajo_hecho = v_trabajo and v_av.horas_parado = round(p_horas, 1) and v_av.cerrada_por = v_yo then
    -- El mismo cierre otra vez: ya quedó.
    return query select p_id, null::text, null::text,
                        v_av.registrado_por <> v_yo and coalesce(v_activo, false),
                        (select e.estado from public.equipos e where e.id = v_av.equipo_id), v_confirma;
    return;
  end if;
  if v_av.estado = 'REPORTADA' then
    raise exception 'Antes de cerrar el reporte % anota el diagnóstico: qué tenía el equipo.', v_av.numero using errcode = 'check_violation';
  end if;
  if v_av.estado <> 'EN_ATENCION' then
    raise exception 'El reporte % ya está %.', v_av.numero,
      case v_av.estado when 'CERRADA' then 'cerrado, esperando que quien lo reportó confirme' when 'CONFIRMADA' then 'cerrado y confirmado' else 'anulado' end
      using errcode = 'check_violation';
  end if;

  -- Primero se suelta el equipo (sigue en atención: el paro todavía es suyo).
  select * into r from public.averias_soltar_el_equipo(p_id, 'OPERATIVO');
  -- Si esta no tenía el paro, puede tenerlo otra vigente del mismo equipo: se
  -- dice cuál, para que nadie lo pase a operativo a mano con ese reporte abierto.
  if r.vuelve_a is null and r.sigue_parado_por is null then
    select a2.numero into v_otro
      from public.averias a2
     where a2.equipo_id = v_av.equipo_id and a2.id <> p_id and a2.paro_el_equipo
       and a2.estado in ('REPORTADA', 'EN_ATENCION')
     order by a2.creado_en
     limit 1;
  end if;
  update public.averias
     set estado = 'CERRADA', trabajo_hecho = v_trabajo, horas_parado = round(p_horas, 1), nota_de_quien_reporto = null
   where id = p_id;

  -- A quien la reportó, si su cuenta sigue activa: si no, nadie lo va a leer y la
  -- pantalla no dice «le avisamos». Sin su cuenta, al responsable del área, que
  -- es quien la confirma; sin responsable, la confirma Mantenimiento desde su bandeja.
  if v_av.registrado_por <> v_yo and coalesce(v_activo, false) then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_av.registrado_por, left('Mantenimiento cerró tu reporte ' || v_av.numero || ': confirma si quedó bien', 200),
            left(v_trabajo, 500), '/averias/' || p_id::text, 'averias', p_id);
  elsif v_confirma = 'RESPONSABLE' and v_jefe <> v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_jefe, left('Mantenimiento cerró el reporte ' || v_av.numero || ' de tu área: quien lo reportó ya no tiene cuenta, confirma tú si quedó bien', 200),
            left(v_trabajo, 500), '/averias/' || p_id::text, 'averias', p_id);
  end if;
  return query select p_id, r.vuelve_a, coalesce(r.sigue_parado_por, v_otro), v_av.registrado_por <> v_yo and coalesce(v_activo, false),
                      (select e.estado from public.equipos e where e.id = v_av.equipo_id), v_confirma;
end;
$$;
comment on function public.averias_cerrar(uuid, text, numeric) is
  'Mantenimiento cierra una avería en atención con el trabajo hecho y las horas parado; si el equipo sigue parado por ella vuelve a operativo (o sigue parado por el otro reporte que detiene el trabajo) y avisa a quien la reportó para que confirme, si su cuenta sigue activa (avisada). equipo_estado: cómo quedó el equipo en el padrón. confirma: quién dice si quedó bien (QUIEN_REPORTO; sin su cuenta, RESPONSABLE del área, al que se le avisa, o MANTENIMIENTO). Exige averias.atender.';
revoke all on function public.averias_cerrar(uuid, text, numeric) from public, anon;
grant execute on function public.averias_cerrar(uuid, text, numeric) to authenticated;

-- 5. Confirmar: también el responsable del área o Mantenimiento --------------------------------
create or replace function public.averias_confirmar(p_id uuid, p_quedo_bien boolean, p_nota text)
returns table (averia uuid, estado text, equipo_parado boolean, avisado_a text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_av     public.averias%rowtype;
  v_equipo public.equipos%rowtype;
  v_desde  timestamptz;
  v_paro   boolean := false;
  v_titulo text;
  v_a_quien text;
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para confirmar.' using errcode = 'insufficient_privilege';
  end if;
  if p_quedo_bien is null then
    raise exception 'Elige si el equipo quedó bien.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if not p_quedo_bien and char_length(coalesce(v_nota, '')) < 10 then
    raise exception 'Cuenta qué sigue fallando, en al menos 10 caracteres: vuelve a Mantenimiento con eso.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias v where v.id = p_id for update;
  if not found or not public.averias_puede_confirmar(v_av.registrado_por, v_av.area_id) then
    raise exception 'Si quedó bien lo confirma quien reportó la avería; si ya no tiene cuenta, el responsable del área o Mantenimiento.'
      using errcode = 'insufficient_privilege';
  end if;
  -- El mismo pedido otra vez (se perdió la respuesta): ya quedó.
  if p_quedo_bien and v_av.estado = 'CONFIRMADA' and v_av.nota_de_quien_reporto is not distinct from v_nota then
    return query select p_id, v_av.estado, false, null::text;
    return;
  end if;
  if not p_quedo_bien and v_av.estado = 'EN_ATENCION' and v_av.veces_reabierta > 0
     and v_av.nota_de_quien_reporto is not distinct from v_nota then
    -- A quién le llegó la primera vez (o, si quien la devolvió es de Mantenimiento, a su propia bandeja).
    return query select p_id, v_av.estado, v_av.paro_el_equipo,
      case when public.tiene_permiso('averias.atender') then 'SU_BANDEJA' else
      (select case when n.titulo like '% (%' then 'GERENCIA' else 'MANTENIMIENTO' end
         from public.notificaciones n
        where n.origen_tabla = 'averias' and n.origen_id = p_id and n.titulo like 'No quedó bien: %' and n.creado_en >= v_av.reabierta_en
        order by n.creado_en desc limit 1) end;
    return;
  end if;
  if v_av.estado <> 'CERRADA' then
    raise exception 'El reporte % %.', v_av.numero,
      case v_av.estado when 'REPORTADA' then 'todavía no lo atiende Mantenimiento: se confirma cuando lo cierre'
                       when 'EN_ATENCION' then 'todavía lo atiende Mantenimiento: se confirma cuando lo cierre'
                       when 'CONFIRMADA' then 'ya está confirmado'
                       else 'está anulado' end
      using errcode = 'check_violation';
  end if;

  if p_quedo_bien then
    update public.averias set estado = 'CONFIRMADA', nota_de_quien_reporto = v_nota where id = p_id;
    return query select p_id, 'CONFIRMADA'::text, false, null::text;
    return;
  end if;

  -- No quedó bien: vuelve a Mantenimiento. La avería que detiene el trabajo
  -- vuelve a dejar el equipo parado, como al reportarla.
  select * into v_equipo from public.equipos where id = v_av.equipo_id for update;
  if v_av.detiene_trabajo and v_equipo.activo and v_equipo.estado <> 'PARADO' then
    update public.equipos
       set estado = 'PARADO', estado_nota = left('Avería ' || v_av.numero || ': sigue fallando. ' || v_nota, 300)
     where id = v_av.equipo_id
     returning estado_desde into v_desde;
    v_paro := true;
  end if;
  perform set_config('averias.cambia_el_paro', p_id::text, true);
  update public.averias
     set estado = 'EN_ATENCION', nota_de_quien_reporto = v_nota,
         paro_el_equipo = v_paro,
         equipo_estado_antes = case when v_paro then v_equipo.estado end,
         equipo_nota_antes = case when v_paro then v_equipo.estado_nota end,
         equipo_parado_desde = case when v_paro then v_desde end
   where id = p_id;
  perform set_config('averias.cambia_el_paro', '', true);

  -- A Mantenimiento; sin nadie de Mantenimiento con cuenta activa, a Gerencia,
  -- para que no se pierda (como al reportar). La pantalla dice a quién llegó.
  v_titulo := 'No quedó bien: ' || v_av.numero || ' vuelve a Mantenimiento';
  perform public.avisar_a_permiso('averias.atender', v_titulo, v_nota, '/averias/' || p_id::text, 'averias', p_id);
  if exists (select 1 from public.notificaciones n
              where n.origen_tabla = 'averias' and n.origen_id = p_id and n.titulo = v_titulo and n.creado_en = now()) then
    v_a_quien := 'MANTENIMIENTO';
  elsif public.tiene_permiso('averias.atender') then
    -- Quien la devuelve es de Mantenimiento (reportó la suya): vuelve a su
    -- bandeja, y no es que falte nadie que la reciba.
    v_a_quien := 'SU_BANDEJA';
  else
    perform public.avisar_a_permiso('averias.ver', v_titulo || ' (no hay cuenta de Mantenimiento que la reciba)', v_nota,
                                    '/averias/' || p_id::text, 'averias', p_id);
    v_a_quien := case when exists (select 1 from public.notificaciones n
                                    where n.origen_tabla = 'averias' and n.origen_id = p_id and n.creado_en = now()
                                      and n.titulo like v_titulo || ' (%') then 'GERENCIA' end;
  end if;
  return query select p_id, 'EN_ATENCION'::text, v_paro, v_a_quien;
end;
$$;
comment on function public.averias_confirmar(uuid, boolean, text) is
  'Quien reportó la avería (si ya no tiene cuenta activa, el responsable del área o Mantenimiento) confirma que quedó bien (CERRADA → CONFIRMADA) o dice qué sigue fallando y vuelve a Mantenimiento (→ EN_ATENCION, y el equipo parado otra vez si la avería detiene el trabajo).';
revoke all on function public.averias_confirmar(uuid, boolean, text) from public, anon;
grant execute on function public.averias_confirmar(uuid, boolean, text) to authenticated;

-- 6. Lo que cada quien lee: a quién le toca confirmar y si repite ---------------------------
drop function if exists public.averias_visibles(uuid);
create or replace function public.averias_visibles(p_id uuid)
returns table (
  id uuid, numero text, tipo text, detiene_trabajo boolean, riesgo_personas boolean, descripcion text,
  estado text, creado_en timestamptz, dias_en_espera integer, alcance text,
  equipo_id uuid, equipo_codigo text, equipo_descripcion text, equipo_ubicacion text, equipo_estado text,
  area_id uuid, area text, paro_el_equipo boolean,
  reporto text, reporto_puesto text, fotos integer,
  anulado_en timestamptz, anulo text, motivo_anulacion text,
  gravedad integer, espera_de text, espera_desde timestamptz, es_mia boolean,
  diagnostico text, atendida_en timestamptz, atendio text,
  trabajo_hecho text, horas_parado numeric, cerrada_en timestamptz, cerro text,
  confirmada_en timestamptz, nota_de_quien_reporto text, veces_reabierta integer,
  paro_al_reportar boolean, equipo_parado_desde timestamptz, rq_enlazados integer,
  diagnostico_de text, diagnostico_en timestamptz,
  puede_confirmar boolean, reporto_activo boolean, confirmo_en_lugar text, devolvio_en_lugar text,
  repite_a text)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, public.averias_areas_de_la_cuenta() as areas, public.puede_ver_todas_las_averias() as todo,
           public.averias_ve_las_de_riesgo() as riesgo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select v.*, case when yo.todo then 'TODAS' when v.registrado_por = yo.id then 'PROPIA'
                     when v.area_id = any(yo.areas) then 'AREA' else 'RIESGO' end as alcance,
           v.registrado_por = yo.id as mia,
           -- Desde cuándo espera, lo mismo que cuentan los días: a Mantenimiento,
           -- desde que se reportó o desde que volvió; a quien reportó, desde el cierre.
           case when v.estado in ('REPORTADA', 'EN_ATENCION') then coalesce(v.reabierta_en, v.creado_en)
                when v.estado = 'CERRADA' then v.cerrada_en end as desde
      from public.averias v
      cross join yo
     where (p_id is null or v.id = p_id)
       -- La política `ver_averias`, tal cual.
       and (yo.todo or v.registrado_por = yo.id or v.area_id = any(yo.areas) or (v.riesgo_personas and yo.riesgo))
  )
  select v.id, v.numero, v.tipo, v.detiene_trabajo, v.riesgo_personas, v.descripcion,
         v.estado, v.creado_en,
         -- Lo que espera a Mantenimiento cuenta desde que se reportó (o desde que volvió);
         -- lo que espera la confirmación, desde que se cerró. Con la fecha de Lima.
         case when v.estado in ('REPORTADA', 'EN_ATENCION')
              then (now() at time zone 'America/Lima')::date - (coalesce(v.reabierta_en, v.creado_en) at time zone 'America/Lima')::date
              when v.estado = 'CERRADA'
              then (now() at time zone 'America/Lima')::date - (v.cerrada_en at time zone 'America/Lima')::date end,
         v.alcance,
         e.id, e.codigo, e.descripcion, e.ubicacion, e.estado,
         v.area_id, a.nombre, v.paro_el_equipo,
         btrim(u.nombres || ' ' || u.apellidos), ro.nombre,
         (select count(*)::integer from public.averia_fotos f where f.averia_id = v.id),
         v.anulado_en, btrim(an.nombres || ' ' || an.apellidos), v.motivo_anulacion,
         case when v.detiene_trabajo and v.riesgo_personas then 1
              when v.detiene_trabajo then 2
              when v.riesgo_personas then 3
              when v.tipo = 'AVERIA' then 4
              else 5 end,
         case when v.estado in ('REPORTADA', 'EN_ATENCION') then 'MANTENIMIENTO' when v.estado = 'CERRADA' then 'QUIEN_REPORTO' end,
         v.desde, v.mia,
         v.diagnostico, v.atendida_en, btrim(ate.nombres || ' ' || ate.apellidos),
         v.trabajo_hecho, v.horas_parado, v.cerrada_en, btrim(ce.nombres || ' ' || ce.apellidos),
         v.confirmada_en, v.nota_de_quien_reporto, v.veces_reabierta,
         v.paro_al_reportar,
         -- Desde cuándo está parado el equipo por este reporte, para proponer las horas al cerrar.
         case when v.paro_el_equipo and e.estado = 'PARADO' and e.estado_desde = v.equipo_parado_desde then v.equipo_parado_desde end,
         (select count(*)::integer from public.averia_requerimientos q where q.averia_id = v.id and q.quitado_en is null),
         btrim(dg.nombres || ' ' || dg.apellidos), v.diagnostico_en,
         -- A quién le toca decir si quedó bien: la misma regla que la función que confirma.
         v.estado = 'CERRADA' and public.averias_puede_confirmar(v.registrado_por, v.area_id),
         u.activo,
         -- Quién la confirmó o la devolvió en lugar de quien la reportó, si fue otra persona.
         (select btrim(c.nombres || ' ' || c.apellidos) from public.averia_pasos s join public.usuarios c on c.id = s.hecho_por
           where s.averia_id = v.id and s.paso = 'CONFIRMACION' and s.hecho_por <> v.registrado_por
           order by s.hecho_en desc limit 1),
         (select btrim(c.nombres || ' ' || c.apellidos) from public.averia_pasos s join public.usuarios c on c.id = s.hecho_por
           where s.averia_id = v.id and s.paso = 'REAPERTURA' and s.hecho_por <> v.registrado_por
             and s.hecho_en >= v.reabierta_en
           order by s.hecho_en desc limit 1),
         -- La avería que esta repite: otra del mismo equipo cerrada en los 30 días antes.
         (select r.numero from public.averias r where r.id = public.averia_que_repite(v.equipo_id, v.id, v.creado_en))
    from visibles v
    join public.equipos e on e.id = v.equipo_id
    left join public.areas a on a.id = v.area_id
    join public.usuarios u on u.id = v.registrado_por
    left join public.roles ro on ro.id = u.rol_id
    left join public.usuarios an on an.id = v.anulado_por
    left join public.usuarios ate on ate.id = v.atendida_por
    left join public.usuarios ce on ce.id = v.cerrada_por
    left join public.usuarios dg on dg.id = v.diagnostico_por
   order by v.creado_en desc;
$$;
comment on function public.averias_visibles(uuid) is
  'Los reportes de avería que ve quien pregunta (uno, o todos con p_id vacío), con su equipo y su atención: todos (Mantenimiento, Gerencia), los suyos, los del área donde trabaja o que tiene a cargo, y SSOMA los que son un riesgo. gravedad 1 (detiene y es un riesgo) a 5 (posible avería); dias_en_espera con la fecha de Lima, de quien la tiene ahora (espera_de). puede_confirmar: si quien pregunta dice si quedó bien (averias_puede_confirmar); repite_a: el número de la avería del mismo equipo cerrada en los 30 días antes de esta.';
revoke all on function public.averias_visibles(uuid) from public, anon;
grant execute on function public.averias_visibles(uuid) to authenticated;

-- 7. El recorrido: la confirmación en lugar de quien la reportó --------------------------------
create or replace function public.recorrido_de_averias(p_ids uuid[])
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
  v_yo   constant uuid := public.usuario_actual();
  v_todo constant boolean := public.puede_ver_todas_las_averias();
  v_areas  constant uuid[] := public.averias_areas_de_la_cuenta();
  v_riesgo constant boolean := public.averias_ve_las_de_riesgo();
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para ver el recorrido.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 reportes a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with av as (
    select v.id, v.estado, v.registrado_por, v.creado_en, v.paro_al_reportar,
           v.atendida_en, v.reabierta_en, v.cerrada_en, v.area_id,
           exists (select 1 from public.usuarios u where u.id = v.registrado_por and u.activo) as reporto_activo
      from public.averias v
     where v.id = any(p_ids)
       -- La política `ver_averias`, tal cual.
       and (v_todo or v.registrado_por = v_yo or v.area_id = any(v_areas) or (v.riesgo_personas and v_riesgo))
  ),
  pasos as (
    select a.id as av, 10 as canon, 'REPORTE' as paso, 'HECHO' as situacion, a.registrado_por as quien, null::text as puesto_fijo,
           a.creado_en as en, null::text as espera, case when a.paro_al_reportar then 'PARADO' end as detalle
      from av a
    union all
    -- Lo hecho después, en el orden en que pasó. El cierre dice las horas parado;
    -- la reapertura, que no quedó bien.
    select p.averia_id, 20, p.paso, 'HECHO', p.hecho_por, null, p.hecho_en, null,
           -- El cierre: las horas parado y el trabajo hecho, «26.5|Se cambió…».
           case when p.paso = 'CIERRE' then trim(to_char(p.horas_parado, 'FM9999990.0')) || coalesce('|' || left(p.texto, 300), '')
                -- Lo que dijo quien la reportó al devolverla: la ficha solo guarda la última.
                when p.paso = 'REAPERTURA' then left(p.texto, 300)
                -- Quien la reportó ya no tenía cuenta: la confirmó otra persona en su lugar.
                when p.paso = 'CONFIRMACION' and p.hecho_por <> a.registrado_por then 'EN_LUGAR' end
      from public.averia_pasos p
      join av a on a.id = p.averia_id
    union all
    -- Quién la tiene ahora.
    select a.id, 30,
           case a.estado when 'REPORTADA' then 'ATENCION' when 'EN_ATENCION' then 'CIERRE' else 'CONFIRMACION' end,
           'AHORA', null,
           case when a.estado = 'CERRADA' then null else 'Mantenimiento' end,
           -- El mismo origen que los días en espera de la bandeja.
           case when a.estado in ('REPORTADA', 'EN_ATENCION') then coalesce(a.reabierta_en, a.creado_en)
                else a.cerrada_en end,
           case a.estado when 'REPORTADA' then 'ATENCION' when 'EN_ATENCION' then 'CIERRE' else 'CONFIRMACION' end,
           case when a.estado = 'CERRADA' and not a.reporto_activo then 'SIN_CUENTA' end
      from av a where a.estado in ('REPORTADA', 'EN_ATENCION', 'CERRADA')
    union all
    -- Lo que falta.
    select a.id, 40, 'CIERRE', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado = 'REPORTADA'
    union all
    select a.id, 50, 'CONFIRMACION', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado in ('REPORTADA', 'EN_ATENCION')
  )
  select p.av,
         (row_number() over (
            partition by p.av
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u)
              -- La confirmación la tiene quien reportó: su puesto, no su nombre.
              when p.situacion = 'AHORA' and p.paso = 'CONFIRMACION' then
                case when a2.reporto_activo then public.puesto(r)
                     -- Sin su cuenta, el responsable del área o Mantenimiento.
                     when exists (select 1 from public.areas ar join public.usuarios j on j.id = ar.jefe_id and j.activo
                                   where ar.id = a2.area_id and ar.activo) then 'Responsable del área o Mantenimiento'
                     else 'Mantenimiento' end
              else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien
    left join av a2 on a2.id = p.av
    left join public.usuarios r on r.id = a2.registrado_por;
end;
$$;
comment on function public.recorrido_de_averias(uuid[]) is
  'El recorrido de cada reporte de avería, un paso por fila: lo hecho (de averia_pasos) con el puesto de quien lo hizo y su fecha; quién lo tiene ahora (Mantenimiento o quien la reportó, para confirmar) y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo los que la política ver_averias deja ver a quien llama.';
revoke all on function public.recorrido_de_averias(uuid[]) from public, anon;
grant execute on function public.recorrido_de_averias(uuid[]) to authenticated;

-- 8. La historia de cada equipo ------------------------------------------------------------
-- Las cifras de cada equipo, para quien ve el padrón. Corre por encima del RLS
-- de las averías porque cuenta todos los reportes del equipo, también los de
-- otras áreas; no devuelve qué dice ninguno ni quién lo hizo.
create or replace function public.equipos_historia(p_equipo uuid)
returns table (
  equipo_id         uuid,
  averias           integer,
  averias_90        integer,
  repetidas         integer,
  repetidas_90      integer,
  no_quedo_bien     integer,
  horas_parado      numeric,
  horas_parado_90   numeric,
  abiertas          integer,
  parado_por        text,
  parado_desde      timestamptz,
  ultima_en         timestamptz)
language plpgsql stable security definer set search_path to 'public' rows 100 as $$
#variable_conflict use_column
declare
  -- «Los últimos 90 días» con la fecha de Lima, como los días en espera.
  v_desde constant timestamptz := ((now() at time zone 'America/Lima')::date - 90)::timestamp at time zone 'America/Lima';
begin
  if public.usuario_actual() is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('equipos.ver') or public.tiene_permiso('equipos.gestionar')
             or public.tiene_permiso('equipos.asignar') or public.puede_ver_todas_las_averias()) then
    raise exception 'La historia de los equipos la ve quien ve el padrón.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with av as (
    select v.id, v.equipo_id, v.creado_en, v.estado, v.veces_reabierta, v.paro_el_equipo, v.numero, v.equipo_parado_desde,
           public.averia_que_repite(v.equipo_id, v.id, v.creado_en) is not null as repite
      from public.averias v
     where v.estado <> 'ANULADA' and (p_equipo is null or v.equipo_id = p_equipo)
  ), horas as (
    select a.equipo_id,
           sum(s.horas_parado) as todas,
           sum(s.horas_parado) filter (where s.hecho_en >= v_desde) as ultimas
      from public.averia_pasos s
      join av a on a.id = s.averia_id
     where s.paso = 'CIERRE'
     group by a.equipo_id
  ), paro as (
    -- El reporte que tiene parado el equipo ahora, si lo hay (el más antiguo).
    select distinct on (a.equipo_id) a.equipo_id, a.numero, a.equipo_parado_desde
      from av a
      join public.equipos e on e.id = a.equipo_id
     where a.paro_el_equipo and a.estado in ('REPORTADA', 'EN_ATENCION')
       and e.estado = 'PARADO' and e.estado_desde = a.equipo_parado_desde
     order by a.equipo_id, a.creado_en
  )
  select e.id,
         count(a.id)::integer,
         (count(a.id) filter (where a.creado_en >= v_desde))::integer,
         (count(a.id) filter (where a.repite))::integer,
         (count(a.id) filter (where a.repite and a.creado_en >= v_desde))::integer,
         coalesce(sum(a.veces_reabierta), 0)::integer,
         coalesce(max(h.todas), 0),
         coalesce(max(h.ultimas), 0),
         (count(a.id) filter (where a.estado in ('REPORTADA', 'EN_ATENCION', 'CERRADA')))::integer,
         max(p.numero),
         max(p.equipo_parado_desde),
         max(a.creado_en)
    from public.equipos e
    left join av a on a.equipo_id = e.id
    left join horas h on h.equipo_id = e.id
    left join paro p on p.equipo_id = e.id
   where (p_equipo is null and e.activo) or e.id = p_equipo
   group by e.id;
end;
$$;
comment on function public.equipos_historia(uuid) is
  'La historia de cada equipo del padrón (o de uno): averías sin las anuladas, en total y en los últimos 90 días (fecha de Lima); repetidas (reportadas antes de 30 días del cierre de otra del mismo equipo); cuántas veces no quedó bien; horas parado anotadas en los cierres; las que siguen abiertas; y el reporte que lo tiene parado ahora. Para quien ve el padrón; no dice qué dice cada reporte.';
revoke all on function public.equipos_historia(uuid) from public, anon;
grant execute on function public.equipos_historia(uuid) to authenticated;
