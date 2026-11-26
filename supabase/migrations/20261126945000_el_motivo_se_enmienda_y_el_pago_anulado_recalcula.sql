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
--    pase la corregida. La OC cuenta como llegada cuando llegó todo, como en el
--    cumplimiento. Y la pantalla ofrece «Anotar motivo» en esas compras
--    (`compras_que_aceptan_motivo`): sin eso, la base lo aceptaba y nadie podía
--    pedirlo.
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
--    Solo si la OS tiene la cifra de un valor que ese cambio tuvo antes de
--    corregirse (según `audit_log`): la que se emitió con el último cambio
--    registrado, de otro día, sin que nadie corrigiera nada, se queda como está.
--    No toca la anulada ni la rechazada.
--
-- Idempotente y sin DROP.

-- 1. La compra que pasó la fecha del documento ---------------------------------------------
-- La OC cuenta como llegada cuando llegó todo (o quedó completa), como en el
-- cumplimiento: la que llegó por partes y completó tarde también pasó su fecha.
-- La OS, cuando volvió conforme. La que no llegó, con la fecha de hoy.
create or replace function public.compras_que_pasaron_su_primera_fecha(p_tipo text, p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.documento
    from public.plazos_de_compras_calculados(p_ids) p
   where p_tipo = 'OC'
     and p.original is not null
     and coalesce(public.fecha_de_lima(coalesce(p.completa_en, p.llego_todo_en)), public.fecha_de_lima(now())) > p.original
  union all
  select o.id
    from public.ordenes_servicio o
   where p_tipo = 'OS'
     and o.id = any(p_ids)
     and o.fecha_fin is not null
     and coalesce(case when o.estado = 'CONFORME' then public.fecha_de_lima(o.conformidad_en) end,
                  public.fecha_de_lima(now())) > o.fecha_fin;
$$;
comment on function public.compras_que_pasaron_su_primera_fecha(text, uuid[]) is
  'De esas OC (o OS), las que llegaron completas, o siguen sin llegar, después de la fecha que salió en el documento, sin contar las corregidas. Ayudante interno de anotar_motivo_atraso y compras_que_aceptan_motivo.';
revoke all on function public.compras_que_pasaron_su_primera_fecha(text, uuid[]) from public, anon, authenticated;

create or replace function public.compra_paso_su_primera_fecha(p_tipo text, p_documento uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.compras_que_pasaron_su_primera_fecha(p_tipo, array[p_documento]));
$$;
comment on function public.compra_paso_su_primera_fecha(text, uuid) is
  'Si la OC (o la OS) pasó la fecha que salió en el documento (compras_que_pasaron_su_primera_fecha). Ayudante interno de anotar_motivo_atraso.';
revoke all on function public.compra_paso_su_primera_fecha(text, uuid) from public, anon, authenticated;

-- Para que la pantalla ofrezca «Anotar motivo» en esas compras, y no solo en las
-- atrasadas contra la fecha corregida. Solo a quien anota (compras.crear); a los
-- demás no les devuelve nada. La regla es la misma de `anotar_motivo_atraso`,
-- que decide al final.
create or replace function public.compras_que_aceptan_motivo(p_tipo text, p_ids uuid[])
returns table (documento uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select x.id
    from public.compras_que_pasaron_su_primera_fecha(p_tipo, p_ids[1:500]) as x(id)
   where (public.es_admin() or public.tiene_permiso('compras.crear'))
     and case p_tipo
           when 'OC' then exists (select 1 from public.ordenes_compra_materiales c
                                   where c.id = x.id and c.aprobacion not in ('RECHAZADA', 'ANULADA'))
           when 'OS' then exists (select 1 from public.ordenes_servicio o
                                   where o.id = x.id and o.estado <> 'ANULADA' and o.aprobacion <> 'RECHAZADA')
           else false
         end;
$$;
comment on function public.compras_que_aceptan_motivo(text, uuid[]) is
  'De esas OC (o OS) vigentes, las que pasaron la fecha del documento: aceptan el motivo del atraso aunque no pasen la corregida (20261126945000). Solo con compras.crear; sin él, ninguna. Hasta 500 a la vez.';
revoke all on function public.compras_que_aceptan_motivo(text, uuid[]) from public, anon;
grant execute on function public.compras_que_aceptan_motivo(text, uuid[]) to authenticated;

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

comment on function public.anotar_motivo_atraso(uuid, text, uuid, text, text) is
  'Anota por qué se atrasó una OC u OS vigente que pasó su fecha prometida, la corregida o la que salió en el documento (para enmendar un motivo, 20261126945000): proveedor, pago, transporte, aprobación u otro (con nota). Exige compras.crear. No toca el documento.';

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
  -- El cambio que le toca a su día (el mismo de `cambio_del_dia`), y solo si la OS
  -- tiene la cifra de un valor que ese cambio tuvo antes de corregirse: la que se
  -- emitió con el último cambio registrado, sin que nadie corrigiera nada, no se
  -- toca (`emitir_orden_servicio` toma el último, aunque sea de otro día).
  update public.ordenes_servicio s
     set monto_pen = round(s.monto * x.venta, 2)
    from (select o.id, t.id as tc_id, t.venta
            from public.ordenes_servicio o
            cross join lateral (
              select c.id, c.venta from public.tipos_de_cambio c
               where c.fecha <= public.fecha_de_lima(o.creado_en)
                 and c.fecha > public.fecha_de_lima(o.creado_en) - 10
               order by c.fecha desc
               limit 1) t
           where o.id = new.orden_servicio_id) x
   where s.id = x.id
     and x.venta is not null
     and s.moneda <> 'PEN'
     and s.monto is not null
     and s.monto_pen is not null
     and s.estado <> 'ANULADA'
     and s.aprobacion <> 'RECHAZADA'
     and s.monto_pen is distinct from round(s.monto * x.venta, 2)
     and exists (select 1 from public.audit_log a
                  where a.tabla = 'tipos_de_cambio' and a.registro_id = x.tc_id and a.accion = 'UPDATE'
                    and (a.datos_antes->>'venta')::numeric is distinct from x.venta
                    and s.monto_pen = round(s.monto * (a.datos_antes->>'venta')::numeric, 2));
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
-- Se quita la condición «anotado antes de llegar» y se cambia el comentario que
-- la explicaba; el comentario nuevo es la marca de que ya se aplicó.
do $$
declare
  v_def text;
  v_viejo constant text := $v$
                        and (t.llego is null or s.registrado_en <= t.llego)$v$;
  v_nota_vieja constant text := $v$  -- anotado ANTES de que llegara: lo que se anota después no cambia el
  -- veredicto.$v$;
  v_nota_nueva constant text := $v$  -- anotado, también el que se enmendó después de llegar (20261126945000).$v$;
begin
  select replace(pg_get_functiondef('public.cumplimiento_de_proveedores(uuid[])'::regprocedure), E'\r', '')
    into v_def;
  if position(v_nota_nueva in v_def) > 0 and position(v_viejo in v_def) = 0 then
    return;
  end if;
  if position(v_viejo in v_def) = 0 or position(v_nota_vieja in v_def) = 0 then
    raise exception 'cumplimiento_de_proveedores tiene otra versión de esta regla: revisa esta migración a mano.';
  end if;
  execute replace(replace(v_def, v_viejo, ''), v_nota_vieja, v_nota_nueva);
end $$;

comment on function public.cumplimiento_de_proveedores(uuid[]) is
  'De cada proveedor, solo cuentas y sin importes (lo lee quien ve el padrón, proveedores.ver). compras: OC aprobadas y OS aprobadas no anuladas. llegaron: las que llegaron (la OC cuando se dejó lo último en almacén, la OS cuando volvió conforme). medidas: de las que llegaron, las que tenían fecha prometida, menos las atrasadas por causa nuestra. a_tiempo: de las medidas, las que llegaron a más tardar la fecha prometida al emitirlas (por fecha de Lima). devueltas: OC de las que Almacén le devolvió algo. atrasadas: las que pasaron la fecha prometida al emitirlas sin llegar completas (la OC a medias cuenta como sin llegar), menos las nuestras. sin_fecha: llegaron sin fecha prometida. nuestras: atrasadas cuyo último motivo anotado (también el enmendado después de llegar, 20261126945000) es pago, transporte o aprobación; si vino con una fecha corregida, solo mientras no se pase esa fecha.';
