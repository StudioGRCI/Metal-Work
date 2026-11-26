-- =============================================================================
-- EL MOTIVO DEL ATRASO SE ENMIENDA Y EL PAGO ANULADO DEVUELVE LA OS A SU CAMBIO
-- =============================================================================
-- Dos cosas que DKS decidió el 2026-11-26, al revisar los PR del Plan 4 y de
-- compras:
--
-- 1. El motivo del atraso se puede enmendar contra la fecha prometida al emitir.
--    Si Logística corrigió la fecha con un motivo equivocado y la compra llegó
--    entre la fecha prometida y la corregida, ya no se podía anotar otro motivo:
--    contra la fecha nueva no estaba atrasada («no está atrasada…»), y la fecha
--    ya no se corrige. Ese motivo decide si el atraso cuenta contra el proveedor
--    (20261126463000), así que un error tiene que poder corregirse. Ahora
--    `anotar_motivo_atraso` acepta también la compra que pasó la fecha que salió
--    en el documento (la OC su `fecha_estimada`, la OS su `fecha_fin`), aunque no
--    pase la corregida.
--
--    Y la enmienda cuenta: en el cumplimiento del proveedor (20261126463000) vale
--    el último motivo anotado, también si se anotó después de llegar. Antes
--    valía solo el último anotado antes de la llegada, y la enmienda no
--    cambiaba nada.
--
-- 2. Anular el pago de una OS la devuelve a su tipo de cambio. Si el cambio de un
--    día se corrigió mientras la OS tenía un pago vigente, no se recalculó
--    (20261126626000: lo pagado se hizo con esa cifra). Anular ese pago después
--    la dejaba con la cifra vieja para siempre. Ahora, cuando la OS se queda sin
--    pagos vigentes, toma el cambio que le toca a su día de emisión
--    (`cambio_del_dia`, fecha de Lima), con la misma marca que usan las guardas.
--    Solo si ese cambio existe y da otra cifra. No toca la anulada ni la
--    rechazada.
--
-- Idempotente y sin DROP.

-- 1. La compra que pasó la fecha del documento ---------------------------------------------
create or replace function public.compra_paso_su_primera_fecha(p_tipo text, p_documento uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case p_tipo
    when 'OC' then (
      select c.fecha_estimada is not null
         and coalesce(public.fecha_de_lima(c.entregado_almacen_en), public.fecha_de_lima(now())) > c.fecha_estimada
        from public.ordenes_compra_materiales c where c.id = p_documento)
    when 'OS' then (
      select o.fecha_fin is not null
         and coalesce(case when o.estado = 'CONFORME' then public.fecha_de_lima(o.conformidad_en) end,
                      public.fecha_de_lima(now())) > o.fecha_fin
        from public.ordenes_servicio o where o.id = p_documento)
  end;
$$;
comment on function public.compra_paso_su_primera_fecha(text, uuid) is
  'Si la OC (o la OS) llegó, o sigue sin llegar, después de la fecha que salió en el documento, sin contar las corregidas. Ayudante interno de anotar_motivo_atraso.';
revoke all on function public.compra_paso_su_primera_fecha(text, uuid) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_viejo constant text := $v$  if coalesce(v_dias, 0) <= 0 then$v$;
  v_nuevo constant text := $v$  -- La que pasó la fecha del documento también: así se enmienda el motivo de
  -- una fecha corregida por error (20261126945000).
  if coalesce(v_dias, 0) <= 0 and not coalesce(public.compra_paso_su_primera_fecha(p_tipo, p_documento), false) then$v$;
begin
  select replace(pg_get_functiondef('public.anotar_motivo_atraso(uuid, text, uuid, text, text)'::regprocedure), E'\r', '')
    into v_def;
  if position(v_nuevo in v_def) > 0 then
    return;
  end if;
  if position('compra_paso_su_primera_fecha' in v_def) > 0 then
    raise exception 'anotar_motivo_atraso tiene otra versión de este cambio: revisa esta migración a mano.';
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'anotar_motivo_atraso ya no tiene la regla que esta migración cambia: revísala a mano.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- 2. El pago anulado devuelve la OS a su cambio --------------------------------------------
create or replace function public.fn_pago_anulado_recalcula_servicio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.pagos_orden_servicio p
              where p.orden_servicio_id = new.orden_servicio_id and p.anulado_en is null) then
    return null;
  end if;
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio s
     set monto_pen = round(s.monto * x.tc, 2)
    from (select o.id, public.cambio_del_dia(public.fecha_de_lima(o.creado_en), 'VENTA') as tc
            from public.ordenes_servicio o where o.id = new.orden_servicio_id) x
   where s.id = x.id
     and x.tc is not null
     and s.moneda <> 'PEN'
     and s.monto is not null
     and s.monto_pen is not null
     and s.estado <> 'ANULADA'
     and s.aprobacion <> 'RECHAZADA'
     and s.monto_pen is distinct from round(s.monto * x.tc, 2);
  perform set_config('metalwork.completando_monto_pen', '', true);
  return null;
end;
$$;
revoke all on function public.fn_pago_anulado_recalcula_servicio() from public, anon, authenticated;

create or replace trigger trg_pago_anulado_recalcula_servicio
  after update of anulado_en on public.pagos_orden_servicio
  for each row
  when (old.anulado_en is null and new.anulado_en is not null)
  execute function public.fn_pago_anulado_recalcula_servicio();

-- 3. En el cumplimiento, la enmienda cuenta --------------------------------------------------
do $$
declare
  v_def text;
  v_viejo constant text := $v$
                        and (t.llego is null or s.registrado_en <= t.llego)$v$;
begin
  select replace(pg_get_functiondef('public.cumplimiento_de_proveedores(uuid[])'::regprocedure), E'\r', '')
    into v_def;
  if position(v_viejo in v_def) = 0 then
    if position('s.registrado_en <= t.llego' in v_def) > 0 then
      raise exception 'cumplimiento_de_proveedores tiene otra versión de esta regla: revisa esta migración a mano.';
    end if;
    return;
  end if;
  execute replace(v_def, v_viejo, '');
end $$;

comment on function public.cumplimiento_de_proveedores(uuid[]) is
  'De cada proveedor, solo cuentas y sin importes (lo lee quien ve el padrón, proveedores.ver). compras: OC aprobadas y OS aprobadas no anuladas. llegaron: las que llegaron (la OC cuando se dejó lo último en almacén, la OS cuando volvió conforme). medidas: de las que llegaron, las que tenían fecha prometida, menos las atrasadas por causa nuestra. a_tiempo: de las medidas, las que llegaron a más tardar la fecha prometida al emitirlas (por fecha de Lima). devueltas: OC de las que Almacén le devolvió algo. atrasadas: las que pasaron la fecha prometida al emitirlas sin llegar completas (la OC a medias cuenta como sin llegar), menos las nuestras. sin_fecha: llegaron sin fecha prometida. nuestras: atrasadas cuyo último motivo anotado (también el enmendado después de llegar, 20261126945000) es pago, transporte o aprobación; si vino con una fecha corregida, solo mientras no se pase esa fecha.';
