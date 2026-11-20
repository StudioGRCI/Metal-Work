-- =============================================================================
-- DEL ALMACÉN SALE LO QUE PIDIÓ EL REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- El mismo documento de Almacén (20/11/2026) pide «no entregar materiales que
-- no coincidan con lo solicitado y aprobado», y que toda modificación esté
-- sustentada y autorizada. Hasta hoy la salida de un insumo de RQ solo exigía
-- que el material fuera del mismo almacén: contra un pedido de plancha de 3 mm
-- podía salir la de 6 mm, y la materia prima o un accesorio podían salir sin
-- ningún RQ detrás, solo con quien recibe y la foto. Cuando faltaba material en
-- la unidad, nadie podía decir quién lo había pedido.
--
-- Desde aquí, en cada salida del kardex:
--
--   · La que atiende un insumo de RQ es del material que pidió ese insumo o del
--     que Logística compró para él (otra marca, otra medida: lo que llegó de su
--     OC). Si hace falta otro, quien pidió lo pide en otro RQ, que vuelve a
--     pasar por el metrado de Diseño: es la modificación sustentada. Corregir
--     el material del insumo ya no se puede una vez que Almacén revisó el stock
--     (`corregir_requerimiento`), y la salida siempre viene después.
--   · El insumo que se pasa del metrado de Diseño sin su visto no sale
--     (migración 20261120400000).
--   · La materia prima y los accesorios salen solo contra el RQ que los pide.
--     Si el RQ es de otro código (uno de PLANTA) y la salida va a una unidad
--     que tiene su metrado de Diseño, no sale: lo pide el área con el código de
--     esa unidad, y así pasa por su metrado.
--     Los consumibles y el EPP siguen saliendo como hoy, con quien recibe y la
--     foto.
--   · La planilla «¿Sin internet?» no cambia: anota lo que ya salió del almacén
--     un día sin conexión, y rechazarlo dejaría el kardex sin la salida que de
--     verdad pasó. `registrar_salida_planilla` lo marca para la regla.
--
-- La regla va en un disparador propio sobre el movimiento, no dentro de
-- `registrar_salida_material`, para no reescribir esa función.
--
-- Idempotente. Sin `drop`. `registrar_salida_planilla` se reemplaza entera solo
-- si está como la dejó el repositorio (20261001200000) o como la deja esta.
-- =============================================================================

-- 1. La regla de la salida -------------------------------------------------------
create or replace function public.fn_salida_es_lo_que_pidio_el_rq()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_linea   public.requerimiento_lineas%rowtype;
  v_rq      public.requerimientos%rowtype;
  v_estado  text;
  v_almacen text;
begin
  if new.tipo is distinct from 'SALIDA' then
    return new;
  end if;

  if new.requerimiento_linea_id is null then
    v_almacen := public.almacen_de_material(new.material_id);
    if v_almacen in ('MATERIA_PRIMA', 'ACCESORIOS')
       and coalesce(current_setting('metalwork.desde_planilla', true), '') <> 'si' then
      raise exception '%: elige el RQ en la salida. Si nadie lo pidió, el área lo pide por requerimiento.',
        case v_almacen when 'MATERIA_PRIMA' then 'La materia prima sale solo con el requerimiento que la pide'
                       else 'Un accesorio sale solo con el requerimiento que lo pide' end
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_linea from public.requerimiento_lineas where id = new.requerimiento_linea_id;
  if not found then
    return new;
  end if;
  select * into v_rq from public.requerimientos where id = v_linea.requerimiento_id;

  -- El insumo sin material (de antes de que Almacén lo asociara al revisar) se
  -- sigue atendiendo con uno de su almacén, como dice `registrar_salida_material`.
  if v_linea.material_id is not null and new.material_id is distinct from v_linea.material_id
     and not exists (select 1 from public.orden_compra_material_detalles d
                      where d.id = v_linea.orden_compra_detalle_id and d.material_id = new.material_id)
     and not exists (select 1 from public.movimientos_materiales i
                      where i.orden_compra_detalle_id = v_linea.orden_compra_detalle_id
                        and v_linea.orden_compra_detalle_id is not null
                        and i.tipo = 'INGRESO' and i.material_id = new.material_id) then
    raise exception 'El requerimiento % pide «%» en el insumo %: sale ese material o el que se compró para él. Si hace falta otro, quien lo pidió lo pide en otro requerimiento.',
      v_rq.numero, v_linea.descripcion, v_linea.item using errcode = 'check_violation';
  end if;

  -- Un RQ de PLANTA (u otro código) no lleva materia prima ni accesorios a una
  -- unidad con metrado: ese pedido no pasó por el metrado de esa unidad.
  v_almacen := public.almacen_de_material(new.material_id);
  if v_almacen in ('MATERIA_PRIMA', 'ACCESORIOS')
     and new.codigo_interno is not null
     and public.normalizar_codigo_interno(new.codigo_interno) is distinct from public.normalizar_codigo_interno(v_rq.codigo_interno)
     and not public.codigo_sin_metrado(new.codigo_interno)
     and exists (select 1 from public.codigo_materiales c
                  where c.codigo_interno = public.normalizar_codigo_interno(new.codigo_interno) and c.quitado_en is null) then
    raise exception 'El requerimiento % es para %: no sale hacia %, que tiene su metrado de Diseño. El área lo pide en un requerimiento con el código %.',
      v_rq.numero, v_rq.codigo_interno, new.codigo_interno, new.codigo_interno using errcode = 'check_violation';
  end if;

  select m.estado into v_estado from public.metrado_por_linea(array[v_linea.requerimiento_id]) m where m.linea_id = v_linea.id;
  if v_estado in ('SIN_SUSTENTO', 'POR_AUTORIZAR', 'RECHAZADO') then
    raise exception 'El insumo % del requerimiento % pide más de lo que dice el metrado de Diseño y Diseño todavía no lo autoriza: no sale hasta que lo autorice.',
      v_linea.item, v_rq.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_salida_es_lo_que_pidio_el_rq() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_salida_es_lo_que_pidio_el_rq'
                   and tgrelid = 'public.movimientos_materiales'::regclass) then
    create trigger trg_salida_es_lo_que_pidio_el_rq before insert on public.movimientos_materiales
      for each row execute function public.fn_salida_es_lo_que_pidio_el_rq();
  end if;
end $$;

-- 2. La planilla sin internet lo dice ---------------------------------------------
do $$
declare v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p
   where p.oid = 'public.registrar_salida_planilla(uuid, uuid, numeric, text, text, text, text, timestamptz)'::regprocedure;
  if v_md5 not in ('7b2db7beafb1715a5fb818ba75e4c9e3', 'bc3eacc90b0be23df48c82586bc884aa') then
    raise exception 'registrar_salida_planilla no está como la conoce el repositorio (md5 %): revísala antes de aplicar esta migración.', v_md5;
  end if;
end $$;

create or replace function public.registrar_salida_planilla(p_id uuid, p_material uuid, p_cantidad numeric, p_codigo text,
  p_motivo text, p_recibe text, p_foto text, p_fecha timestamptz)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_existente public.movimientos_materiales%rowtype; v_id uuid;
begin
  perform public.exigir_permiso('almacen.despachar');
  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    if not v_existente.desde_planilla or v_existente.registrado_en <> p_fecha or v_existente.tipo <> 'SALIDA'
       or v_existente.material_id <> p_material or v_existente.cantidad <> p_cantidad or v_existente.foto_ruta <> p_foto
       or v_existente.registrado_por <> public.usuario_actual() then
      raise exception 'Esa salida ya se cargó con otros datos. Revisa la planilla.';
    end if;
    return p_id;
  end if;
  perform public.validar_fecha_planilla_almacen(p_material, p_fecha);
  -- Lo que ya salió un día sin internet entra al kardex aunque no lleve RQ
  -- (migración 20261120410000): la marca vale solo mientras se registra.
  perform set_config('metalwork.desde_planilla', 'si', true);
  v_id := public.registrar_salida_almacen(p_id, p_material, p_cantidad, null, p_codigo, p_motivo, p_recibe, p_foto);
  perform set_config('metalwork.desde_planilla', '', true);
  update public.movimientos_materiales set registrado_en = p_fecha, desde_planilla = true where id = v_id;
  return v_id;
end $$;
revoke all on function public.registrar_salida_planilla(uuid, uuid, numeric, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.registrar_salida_planilla(uuid, uuid, numeric, text, text, text, text, timestamptz) to authenticated;
