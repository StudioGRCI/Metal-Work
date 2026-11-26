-- =============================================================================
-- EL VISTO DE DISEÑO VALE PARA SU CÓDIGO, Y EL SUSTENTO QUE NO CAMBIÓ NO VUELVE
-- A EMPEZAR SUS DÍAS
-- -----------------------------------------------------------------------------
-- Plan 6 (Diseño e Ingeniería), entrega 6.2, con dos fallas del metrado que
-- encontró la revisión del Plan 0. Las dos tocan lo que se pide de más sobre el
-- metrado de Diseño (migración 20261120400000):
--
--   1. El visto de Diseño seguía valiendo si después se corregía el código del
--      RQ a otro que también se pasa del metrado. Diseño autorizó contra el
--      metrado de SR-101, el RQ pasaba a SR-102 y Almacén lo revisaba sin que
--      nadie mirara el metrado de SR-102. Ahora el sustento es para el código
--      que tenía el RQ al sustentarlo: si el código cambia después
--      (`requerimientos.codigo_desde`, que pone el disparador de la revisión),
--      el insumo vuelve a «sin sustento» y se sustenta contra el código nuevo.
--      Si en el código nuevo entra en el metrado, no se pide nada (EN_METRADO
--      va antes). Volver al código de antes también pide sustentar de nuevo:
--      la regla mira cuándo cambió el código, no cuál era.
--
--   2. «Corregir el sustento» reenvía todos los insumos que esperan a Diseño, y
--      `sustentar_insumos` les ponía la hora de hoy aunque el texto no cambiara:
--      sus días en espera volvían a cero. Ahora el insumo que ya espera el visto
--      con el mismo texto, el mismo material y la misma cantidad conserva su
--      hora, quién lo sustentó y lo que decía el metrado entonces. Si nada
--      cambió, a Diseño no le llega otro aviso.
--
-- La hora del sustento sigue siendo la de su transacción (`now()`), como la
-- del visto de Diseño: el recorrido los ordena por hora. La del código es la
-- del reloj (`fn_rq_metrado_al_revisar`). Si una corrección del código entra
-- justo mientras el sustento espera el bloqueo del RQ, el insumo queda «sin
-- sustento» y hay que sustentarlo otra vez: falla hacia el lado seguro.
--
-- Las dos funciones se redefinen enteras, con la misma firma y los mismos
-- permisos; el resto queda como estaba. Sin DROP. Antes se mira que sean las
-- que conoce el repositorio (las de la 20261120400000, o estas si la migración
-- ya corrió): si en producción se cambiaron a mano, se detiene y no las pisa
-- (skill `esquema`).
-- =============================================================================

do $$
declare
  v_metrado text;
  v_sustentar text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_metrado
    from pg_proc p where p.oid = to_regprocedure('public.metrado_por_linea(uuid[])');
  select md5(replace(p.prosrc, E'\r', '')) into v_sustentar
    from pg_proc p where p.oid = to_regprocedure('public.sustentar_insumos(uuid, jsonb)');
  if v_metrado is null or v_sustentar is null then
    raise exception 'Aplica antes la migración 20261120400000 (el RQ se sustenta con el metrado).';
  end if;
  if v_metrado not in ('bb8593c9a4e7703eb344e532afdee83c', '51e45ef463a6f1e7cd0aa0fc6d41bccb') then
    raise exception 'La función metrado_por_linea no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v_metrado;
  end if;
  if v_sustentar not in ('18c07949fb05cf49d9f78ddfb44db967', '21b232a41a8b1b054e481a8f44a6aa8f') then
    raise exception 'La función sustentar_insumos no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v_sustentar;
  end if;
end $$;

-- 1. Cada insumo contra el metrado: el visto, para el código que tenía el RQ ------
create or replace function public.metrado_por_linea(p_requerimientos uuid[])
returns table (linea_id uuid, requerimiento_id uuid, item smallint, aplica boolean, metrado numeric,
               pedido_antes numeric, exceso numeric, sustento_id uuid, estado text)
language sql stable security definer set search_path to 'public' as $$
  with l as (
    select l.id, l.requerimiento_id, l.item, l.cantidad, l.material_id, l.recompra_de,
           r.numero, r.estado as rq_estado, r.con_metrado,
           public.normalizar_codigo_interno(r.codigo_interno) as codigo,
           coalesce(cm.almacen, cl.almacen) as almacen,
           greatest(coalesce(l.cantidad_desde, r.creado_en), coalesce(r.codigo_desde, r.creado_en)) as desde,
           r.codigo_desde,
           r.revision_stock_en as revisado
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
      left join public.materiales m on m.id = l.material_id
      left join public.categorias_material cm on cm.id = m.categoria_id
      left join public.categorias_material cl on cl.id = l.categoria_id
     where l.requerimiento_id = any(p_requerimientos)
  ), rq_del_codigo as (
    select ro.id, ro.numero, ro.creado_en, ro.codigo_desde, public.normalizar_codigo_interno(ro.codigo_interno) as codigo
      from public.requerimientos ro
     where ro.estado <> 'ANULADO'
       and public.normalizar_codigo_interno(ro.codigo_interno) in (select distinct l.codigo from l where l.codigo is not null)
  ), antes as (
    select o.id,
           coalesce(sum(o.cantidad) over (
             partition by ro.codigo, o.material_id
             order by greatest(coalesce(o.cantidad_desde, ro.creado_en), coalesce(ro.codigo_desde, ro.creado_en)), ro.numero, o.item
             rows between unbounded preceding and 1 preceding), 0) as pedido_antes
      from public.requerimiento_lineas o
      join rq_del_codigo ro on ro.id = o.requerimiento_id
     -- La recompra es lo que el proveedor no repuso de un insumo ya pedido: no se
     -- mide, pero cuenta como pedido (el insumo original bajó en esa cantidad).
     where o.material_id is not null
  ), medido as (
    select l.*,
           (select sum(c.cantidad) from public.codigo_materiales c
             where c.codigo_interno = l.codigo and c.material_id = l.material_id and c.quitado_en is null) as metrado,
           coalesce(a.pedido_antes, 0) as pedido_antes
      from l
      left join antes a on a.id = l.id
  ), con_regla as (
    select m.*,
           m.con_metrado and m.rq_estado <> 'ANULADO' and m.recompra_de is null
             and not public.codigo_sin_metrado(m.codigo)
             -- Sin ningún material en el metrado del código, no hay contra qué medir.
             and exists (select 1 from public.codigo_materiales c where c.codigo_interno = m.codigo and c.quitado_en is null)
             -- Lo pedido antes de que Diseño cargara el primer material del código
             -- no se mide (como los RQ de antes de esta regla): se pidió sin metrado.
             and m.desde >= (select min(c.creado_en) from public.codigo_materiales c where c.codigo_interno = m.codigo)
             and (m.almacen in ('MATERIA_PRIMA', 'ACCESORIOS') or m.metrado is not null) as aplica
      from medido m
  ), con_exceso as (
    select c.*,
           case when not c.aplica then 0
                when c.metrado is null or c.material_id is null then c.cantidad
                else least(c.cantidad, greatest(c.pedido_antes + c.cantidad - c.metrado, 0)) end as exceso
      from con_regla c
  ), con_estado as (
    select e.id, e.requerimiento_id, e.item, e.aplica, e.metrado, e.pedido_antes, e.exceso, s.id as sustento_id,
           e.desde, e.revisado,
           case when not e.aplica then 'NO_APLICA'
                when e.exceso <= 0 then 'EN_METRADO'
                when s.id is null then 'SIN_SUSTENTO'
                -- El insumo pedido sin material (uno nuevo) lo asocia Almacén al
                -- revisar: el visto que se dio por su descripción sigue valiendo.
                when s.material_id is not null and s.material_id is distinct from e.material_id then 'SIN_SUSTENTO'
                -- El visto es para el código que tenía el RQ al sustentarlo: si
                -- después pasó a otro código que también se pasa del metrado,
                -- se sustenta de nuevo, contra el metrado de ese código.
                when e.codigo_desde is not null and e.codigo_desde > s.sustentado_en then 'SIN_SUSTENTO'
                when s.decision = 'AUTORIZADO' and s.cantidad >= e.cantidad then 'AUTORIZADO'
                when s.decision = 'AUTORIZADO' then 'SIN_SUSTENTO'
                when s.cantidad <> e.cantidad then 'SIN_SUSTENTO'
                when s.decision = 'RECHAZADO' then 'RECHAZADO'
                else 'POR_AUTORIZAR' end as estado
      from con_exceso e
      left join lateral (
        select x.id, x.material_id, x.cantidad, x.decision, x.sustentado_en
          from public.requerimiento_sustentos x
         where x.requerimiento_linea_id = e.id
         order by x.sustentado_en desc, x.creado_en desc
         limit 1) s on true
  )
  -- Almacén lo revisó en regla (la revisión no pasa con un insumo frenado) y no
  -- cambió después: ni su cantidad hacia arriba, ni su material, ni el código del
  -- RQ. Lo que Diseño cambie luego en el metrado no lo vuelve a frenar en la OC
  -- ni en la salida: se congela en la revisión (REVISADO, en regla). La hora es
  -- la del RQ, no la de cada insumo: `rq_revisar_stock` anota primero los
  -- insumos y después el estado del RQ, y con la del insumo la puerta de la
  -- revisión (`fn_rq_metrado_al_revisar`) ya lo veía revisado y lo dejaba pasar.
  select c.id, c.requerimiento_id, c.item, c.aplica, c.metrado, c.pedido_antes, c.exceso, c.sustento_id,
         case when c.estado in ('SIN_SUSTENTO', 'POR_AUTORIZAR', 'RECHAZADO') and c.revisado is not null and c.desde <= c.revisado
              then 'REVISADO' else c.estado end
    from con_estado c;
$$;
revoke all on function public.metrado_por_linea(uuid[]) from public, anon, authenticated;

-- 2. El sustento: el que no cambió conserva su hora ----------------------------------
create or replace function public.sustentar_insumos(p_requerimiento uuid, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_x       record;
  v_m       record;
  v_linea   public.requerimiento_lineas%rowtype;
  v_items   text := '';
  v_n       integer := 0;
begin
  select * into v_rq from public.requerimientos where id = p_requerimiento for update;
  if not found then
    raise exception 'El requerimiento no existe.';
  end if;
  perform public.rq_exigir_del_area(v_rq.tipo, 'CORREGIR', v_rq.area_id, v_rq.creado_por);
  -- El colaborador de Diseño pide con `requerimientos.emitir`, pero corrige, anula
  -- y sustenta solo los RQ que registró él (migración 20261106100000).
  if public.mi_rol() = 'DISENO_COLABORADOR' and v_rq.creado_por is distinct from public.usuario_actual() then
    raise exception 'Ese requerimiento lo registró otra persona: tú sustentas solo los tuyos.' using errcode = 'insufficient_privilege';
  end if;
  if v_rq.estado in ('ANULADO', 'ENTREGADO') then
    raise exception 'El requerimiento % ya está %: no se sustenta.', v_rq.numero,
      case v_rq.estado when 'ANULADO' then 'anulado' else 'entregado' end using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) not between 1 and 100 then
    raise exception 'Escribe el sustento de cada insumo que se pasa del metrado.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x.item) from jsonb_to_recordset(p_lineas) x(item smallint)) <> jsonb_array_length(p_lineas) then
    raise exception 'Escribe un solo sustento por insumo.' using errcode = 'check_violation';
  end if;

  for v_x in select * from jsonb_to_recordset(p_lineas) x(item smallint, sustento text) order by x.item loop
    if v_x.item is null or char_length(btrim(coalesce(v_x.sustento, ''))) not between 10 and 500 then
      raise exception 'Cuenta en cada insumo por qué hace falta más de lo que dice el metrado, de 10 a 500 caracteres.'
        using errcode = 'check_violation';
    end if;
    select * into v_linea from public.requerimiento_lineas
     where requerimiento_id = p_requerimiento and item = v_x.item for update;
    if not found then
      raise exception 'El requerimiento % no tiene el insumo %.', v_rq.numero, v_x.item using errcode = 'check_violation';
    end if;
    select * into v_m from public.metrado_por_linea(array[p_requerimiento]) m where m.linea_id = v_linea.id;
    if v_m.estado in ('NO_APLICA', 'EN_METRADO', 'REVISADO') then
      raise exception 'El insumo % entra en el metrado de Diseño: no necesita sustento. Recarga la pantalla.', v_x.item
        using errcode = 'check_violation';
    end if;
    if v_m.estado = 'AUTORIZADO' then
      raise exception 'Diseño ya autorizó el insumo %: no hace falta sustentarlo otra vez.', v_x.item
        using errcode = 'check_violation';
    end if;
    -- El que ya espera el visto (POR_AUTORIZAR: ni su cantidad, ni su material,
    -- ni el código del RQ cambiaron) con el mismo texto no cambió: «Corregir el
    -- sustento» reenvía todos los insumos, y ponerle la hora de hoy volvía a
    -- cero sus días en espera. Se deja como está, con lo que decía el metrado
    -- cuando se sustentó, y sin aviso.
    if v_m.estado = 'POR_AUTORIZAR' and exists (
         select 1 from public.requerimiento_sustentos
          where requerimiento_linea_id = v_linea.id and decision is null
            and sustento = btrim(v_x.sustento)
            and material_id is not distinct from v_linea.material_id and cantidad = v_linea.cantidad) then
      continue;
    end if;
    update public.requerimiento_sustentos
       set sustento = btrim(v_x.sustento), material_id = v_linea.material_id, cantidad = v_linea.cantidad,
           exceso = v_m.exceso, metrado = v_m.metrado,
           sustentado_por = public.usuario_actual(), sustentado_en = now()
     where requerimiento_linea_id = v_linea.id and decision is null;
    if not found then
      insert into public.requerimiento_sustentos
        (requerimiento_linea_id, material_id, cantidad, exceso, metrado, sustento)
      values (v_linea.id, v_linea.material_id, v_linea.cantidad, v_m.exceso, v_m.metrado, btrim(v_x.sustento));
    end if;
    v_n := v_n + 1;
    v_items := v_items || case when v_items = '' then '' else ', ' end || v_x.item;
  end loop;

  -- Nada cambió: no hay nada nuevo que avisarle a Diseño.
  if v_n = 0 then
    return p_requerimiento;
  end if;

  -- A quien autoriza, salvo a quien lo escribió.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Por autorizar: ' || v_rq.numero,
         case when v_n = 1 then 'El insumo ' || v_items else 'Los insumos ' || v_items end
           || ' de ' || public.normalizar_codigo_interno(v_rq.codigo_interno)
           || case when v_n = 1 then ' se pasa' else ' se pasan' end
           || ' del metrado. Quien pidió escribió por qué: revísalo y autorízalo o no.',
         '/requerimientos/metrado', 'requerimientos', v_rq.id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = r.id and rp.permiso_codigo = 'requerimientos.autorizar_metrado');
  return p_requerimiento;
end;
$$;
revoke all on function public.sustentar_insumos(uuid, jsonb) from public, anon;
grant execute on function public.sustentar_insumos(uuid, jsonb) to authenticated;
