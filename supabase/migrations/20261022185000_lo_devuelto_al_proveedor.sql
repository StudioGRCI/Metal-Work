-- Lo que llegó malo se devuelve al proveedor, y si no lo repone, Logística lo recompra.
--
-- Decisiones de DKS del 22/10 (pregunta 10 de compras pendientes, opción «En el
-- sistema», y la tarjeta siguiente, «Logística lo recompra»):
--
-- 1. Almacén anota la devolución al proveedor. Hasta hoy no había cómo: lo que
--    llegaba roto o equivocado seguía en el kardex, sumando stock que no estaba,
--    y la OC decía «recibida» aunque faltara.
-- 2. Al devolverlo, Almacén dice si el proveedor lo repone. Si lo repone, la OC
--    vuelve a esperar esa cantidad y la reposición entra contra la devolución.
--    Si no la repone (o se deja de esperarla), lo que falta vuelve a la lista de
--    Logística para comprarlo en otra OC, y el RQ espera esa compra.
-- 3. La nota de crédito de Contabilidad y el costeo van en la migración siguiente.
--
-- La devolución es un movimiento más del kardex (`DEVOLUCION_PROVEEDOR`): sale del
-- almacén como un egreso, con el precio del ingreso que devuelve, y no va a
-- ninguna unidad ni a ningún código (no es un consumo). Igual que todo movimiento,
-- no se borra ni se corrige.
--
-- Cuánto queda de cada línea de OC se calcula en un solo sitio,
-- `cuenta_de_la_linea_de_compra`: lo que hay en mano (lo que entró menos lo
-- devuelto), lo que el proveedor no va a reponer y lo que falta que reponga.
-- Lo que falta recibir de la línea es lo comprado menos lo que no se repone menos
-- lo que hay en mano.

-- 1. El movimiento ---------------------------------------------------------------------------------
alter table public.movimientos_materiales add column if not exists devuelve_ingreso uuid
  references public.movimientos_materiales(id) on delete restrict;
alter table public.movimientos_materiales add column if not exists se_repone boolean;
alter table public.movimientos_materiales add column if not exists motivo_devolucion text;
alter table public.movimientos_materiales add column if not exists repone_devolucion uuid
  references public.movimientos_materiales(id) on delete restrict;
alter table public.movimientos_materiales add column if not exists reposicion_cancelada_en timestamptz;
alter table public.movimientos_materiales add column if not exists reposicion_cancelada_por uuid
  references public.usuarios(id) on delete restrict;
alter table public.movimientos_materiales add column if not exists reposicion_cancelada_motivo text;

-- Índices: las dos llaves nuevas se suman en cada cuenta de la línea de OC (se
-- filtra por ellas en `cuenta_de_la_linea_de_compra` y en las listas de Almacén).
create index if not exists ix_movimientos_devuelve_ingreso on public.movimientos_materiales (devuelve_ingreso)
  where devuelve_ingreso is not null;
create index if not exists ix_movimientos_repone_devolucion on public.movimientos_materiales (repone_devolucion)
  where repone_devolucion is not null;

alter table public.movimientos_materiales drop constraint if exists movimientos_materiales_tipo_check;
alter table public.movimientos_materiales add constraint movimientos_materiales_tipo_check
  check (tipo in ('INGRESO', 'DESPACHO', 'SALIDA', 'DEVOLUCION_PROVEEDOR'));

alter table public.movimientos_materiales drop constraint if exists ck_movimiento_material_origen;
alter table public.movimientos_materiales add constraint ck_movimiento_material_origen check (
  (tipo = 'INGRESO' and responsable_id is null and nullif(btrim(documento_referencia), '') is not null
   and ((orden_compra_detalle_id is not null and material_id is not null and origen = 'COMPRA')
        or (orden_compra_detalle_id is null and material_id is not null
            and origen in ('SALDO_INICIAL', 'INGRESO_GENERAL', 'DEVOLUCION'))))
  or (tipo = 'DESPACHO' and requerimiento_detalle_id is not null and orden_compra_detalle_id is null and responsable_id is not null)
  or (tipo = 'SALIDA' and origen = 'SALIDA_GENERAL' and requerimiento_detalle_id is null and orden_compra_detalle_id is null
      and material_id is not null and nullif(btrim(documento_referencia), '') is not null
      and nullif(btrim(recibido_por_nombre), '') is not null)
  or (tipo = 'DEVOLUCION_PROVEEDOR' and origen = 'DEVOLUCION_PROVEEDOR' and responsable_id is null
      and requerimiento_detalle_id is null and orden_compra_detalle_id is not null and material_id is not null
      and devuelve_ingreso is not null and se_repone is not null
      and nullif(btrim(documento_referencia), '') is not null
      and char_length(btrim(coalesce(motivo_devolucion, ''))) between 10 and 500)
);

-- Las columnas de la devolución, solo en la devolución; la reposición, solo en un ingreso de compra.
alter table public.movimientos_materiales drop constraint if exists ck_movimiento_devolucion_proveedor;
alter table public.movimientos_materiales add constraint ck_movimiento_devolucion_proveedor check (
  ((tipo = 'DEVOLUCION_PROVEEDOR') = (devuelve_ingreso is not null))
  and ((tipo = 'DEVOLUCION_PROVEEDOR') = (se_repone is not null))
  and ((tipo = 'DEVOLUCION_PROVEEDOR') = (motivo_devolucion is not null))
  and (repone_devolucion is null or (tipo = 'INGRESO' and origen = 'COMPRA'))
  and ((reposicion_cancelada_en is null) = (reposicion_cancelada_por is null))
  and ((reposicion_cancelada_en is null) = (reposicion_cancelada_motivo is null))
  and (reposicion_cancelada_en is null or (tipo = 'DEVOLUCION_PROVEEDOR' and se_repone = false
                                           and char_length(btrim(reposicion_cancelada_motivo)) between 10 and 500))
);

-- Lo que sale hacia el proveedor no tiene unidad: la regla de la unidad es de las salidas al taller.
alter table public.movimientos_materiales drop constraint if exists ck_movimiento_salida_con_unidad;
alter table public.movimientos_materiales add constraint ck_movimiento_salida_con_unidad check (
  tipo in ('INGRESO', 'DEVOLUCION_PROVEEDOR')
  or (length(btrim(coalesce(codigo_unidad, ''))) between 2 and 160)
) not valid;

-- El insumo que se recompra: de qué insumo salió y por qué devolución.
alter table public.requerimiento_lineas add column if not exists recompra_de uuid
  references public.requerimiento_lineas(id) on delete restrict;
alter table public.requerimiento_lineas add column if not exists recompra_por uuid
  references public.movimientos_materiales(id) on delete restrict;
alter table public.requerimiento_lineas drop constraint if exists ck_rq_linea_recompra;
alter table public.requerimiento_lineas add constraint ck_rq_linea_recompra
  check ((recompra_de is null) = (recompra_por is null));
-- Sin índice para las dos: no se filtra por ellas (la pantalla las lee con su
-- insumo) y ni el insumo ni el movimiento se borran nunca.

-- 2. La cuenta de cada línea de OC ------------------------------------------------------------------
create or replace function public.cuenta_de_la_linea_de_compra(p_detalle uuid)
returns table (neto numeric, sin_reponer numeric, por_reponer numeric)
language sql stable set search_path to 'public' as $$
  select coalesce(sum(case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end), 0),
         coalesce(sum(m.cantidad::numeric - r.repuesto) filter (where m.tipo = 'DEVOLUCION_PROVEEDOR' and not m.se_repone), 0),
         coalesce(sum(m.cantidad::numeric - r.repuesto) filter (where m.tipo = 'DEVOLUCION_PROVEEDOR' and m.se_repone), 0)
    from public.movimientos_materiales m
    cross join lateral (
      select coalesce(sum(x.cantidad::numeric), 0) as repuesto
        from public.movimientos_materiales x
       where m.tipo = 'DEVOLUCION_PROVEEDOR' and x.repone_devolucion = m.id) r
   where m.orden_compra_detalle_id = p_detalle
     and m.tipo in ('INGRESO', 'DEVOLUCION_PROVEEDOR')
$$;
revoke all on function public.cuenta_de_la_linea_de_compra(uuid) from public, anon;
grant execute on function public.cuenta_de_la_linea_de_compra(uuid) to authenticated;

-- Cuánto de lo que entró de una línea de OC le tocó a cada insumo que la espera.
-- Lo que ya se le entregó a un insumo llegó de seguro: se le cuenta primero (sin
-- lo que tenía en stock y sin lo que volvió del taller); lo demás que entró se
-- reparte en el orden en que se pidió. Sin esto, devolver de una línea cuyo RQ
-- más nuevo ya se entregó le quitaba lo devuelto a ese RQ, y el RQ abierto decía
-- que le llegó todo con la mitad en el almacén (auditor de funcionamiento, 22/10).
create or replace function public.llegado_de_la_linea_de_compra(p_detalle uuid, p_neto numeric)
returns table (linea_id uuid, requerimiento_id uuid, falta numeric, entregado numeric, llegado numeric)
language sql stable set search_path to 'public' as $$
  with l as (
    select l.id, l.requerimiento_id, r.creado_en, r.numero, l.item,
           greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0)::numeric as falta,
           least(greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0),
                 greatest(coalesce((
                   select sum(greatest(m.cantidad::numeric - coalesce((
                            select sum(d.cantidad::numeric) from public.movimientos_materiales d
                             where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0))
                     from public.movimientos_materiales m
                    where m.requerimiento_linea_id = l.id and m.tipo = 'SALIDA'), 0) - coalesce(l.cantidad_en_stock, 0), 0))::numeric
             as entregado
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where l.orden_compra_detalle_id = p_detalle and r.estado <> 'ANULADO'
  ), c as (
    select l.*,
           coalesce(sum(l.falta - l.entregado) over (order by l.creado_en, l.numero, l.item
                                                     rows between unbounded preceding and 1 preceding), 0) as antes,
           greatest(coalesce(p_neto, 0) - sum(l.entregado) over (), 0) as libre
      from l
  )
  select c.id, c.requerimiento_id, c.falta, c.entregado,
         c.entregado + least(c.falta - c.entregado, greatest(c.libre - c.antes, 0))
    from c
$$;
revoke all on function public.llegado_de_la_linea_de_compra(uuid, numeric) from public, anon, authenticated;

-- Lo que de una línea de OC sigue en el almacén: lo neto que entró menos lo que ya
-- se entregó a sus insumos. Es el tope de lo que se devuelve de ella: el saldo del
-- material entero dejaba devolver «de un ingreso» stock de otro origen cuando lo
-- de la OC ya había salido al taller (auditor de funcionamiento, 22/10). Lo que se
-- entregó antes de que entrara la OC no salió de ella, sino de otro stock: no se
-- descuenta, y lo de la OC sigue en el almacén para devolverse (auditor de
-- realización, 22/10). Lo que el insumo tenía en stock se da por entregado primero.
create or replace function public.en_mano_de_la_linea_de_compra(p_detalle uuid)
returns numeric language sql stable set search_path to 'public' as $$
  with k as (
    select k.neto,
           (select min(m.registrado_en) from public.movimientos_materiales m
             where m.orden_compra_detalle_id = p_detalle and m.tipo = 'INGRESO') as llego
      from public.cuenta_de_la_linea_de_compra(p_detalle) k
  ), s as (
    select greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0)::numeric as falta,
           coalesce(l.cantidad_en_stock, 0)::numeric as en_stock,
           coalesce(sum(n.neta) filter (where m.registrado_en < k.llego), 0) as antes,
           coalesce(sum(n.neta) filter (where m.registrado_en >= k.llego), 0) as despues
      from k
      join public.requerimiento_lineas l on l.orden_compra_detalle_id = p_detalle
      join public.requerimientos r on r.id = l.requerimiento_id and r.estado <> 'ANULADO'
      left join public.movimientos_materiales m on m.requerimiento_linea_id = l.id and m.tipo = 'SALIDA'
      left join lateral (
        select greatest(m.cantidad::numeric - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                                                          where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0) as neta) n on true
     group by l.id, l.cantidad, l.cantidad_en_stock
  )
  select greatest(k.neto - coalesce((select sum(least(s.falta, greatest(s.despues - greatest(s.en_stock - s.antes, 0), 0))) from s), 0), 0)
    from k
$$;
revoke all on function public.en_mano_de_la_linea_de_compra(uuid) from public, anon, authenticated;

create or replace view public.v_orden_compra_material_pendiente with (security_invoker = true) as
select d.id, d.requerimiento_id, d.requerimiento_detalle_id, c.proveedor, c.referencia, c.fecha_estimada,
       d.cantidad as cantidad_comprada,
       greatest(k.neto, 0)::public.cantidad as cantidad_recibida,
       greatest(d.cantidad::numeric - k.sin_reponer - k.neto, 0)::public.cantidad as cantidad_pendiente,
       c.id as orden_compra_id
  from public.orden_compra_material_detalles d
  join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
 cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k;
revoke all on public.v_orden_compra_material_pendiente from public, anon;
grant select on public.v_orden_compra_material_pendiente to authenticated;

-- 3. Las cuentas que miraban solo lo que entró -------------------------------------------------------
-- Copiadas de su última versión; cambia solo lo que se cuenta como recibido o
-- pendiente de la línea de OC. `corregir_requerimiento` deja que el insumo que se
-- recompra repita el material de su insumo de origen. `fn_destino_movimiento_almacen`
-- deja pasar la devolución, que no va a ninguna unidad.

CREATE OR REPLACE FUNCTION public.fn_destino_movimiento_almacen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_orden uuid;
  v_unidad uuid;
  v_numero text;
  v_abiertas uuid[];
  v_original public.movimientos_materiales%rowtype;
begin
  -- Lo devuelto al proveedor no va a ninguna unidad: sale del almacén hacia quien lo vendió.
  if new.tipo = 'DEVOLUCION_PROVEEDOR' then
    return new;
  end if;
  if new.tipo = 'DESPACHO' then
    select r.orden_id, ot.unidad_id, ot.numero into v_orden, v_unidad, v_numero
      from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ordenes_trabajo ot on ot.id = r.orden_id
     where d.id = new.requerimiento_detalle_id;
    new.orden_id := v_orden;
    new.unidad_id := coalesce(new.unidad_id, v_unidad);
  elsif new.tipo = 'INGRESO' then
    if new.devolucion_de is not null then
      select * into v_original from public.movimientos_materiales where id = new.devolucion_de;
      new.orden_id := v_original.orden_id;
      new.unidad_id := v_original.unidad_id;
      new.codigo_unidad := v_original.codigo_unidad;
    end if;
    return new;
  elsif new.tipo = 'SALIDA' and new.unidad_id is not null and new.orden_id is null then
    select array_agg(ot.id) into v_abiertas from public.ordenes_trabajo ot
     where ot.unidad_id = new.unidad_id and ot.estado::text not in ('ANULADA', 'ENTREGADA', 'FACTURADA');
    if cardinality(v_abiertas) = 1 then new.orden_id := v_abiertas[1]; end if;
  end if;

  if new.unidad_id is not null then
    select public.nombre_unidad_almacen(u) into new.codigo_unidad
      from public.unidades u where u.id = new.unidad_id;
  end if;
  new.codigo_unidad := nullif(btrim(new.codigo_unidad), '');

  if new.codigo_unidad is null then
    if new.tipo = 'DESPACHO' then
      raise exception 'La OT % no tiene vehículo ni código de unidad. Pide a Administración que registre la unidad en la OT antes de despachar.', coalesce(v_numero, '');
    end if;
    raise exception 'Indica el vehículo o el código de la unidad que recibe el material.';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_recepcion_material(p_id uuid, p_orden_compra_detalle_id uuid, p_cantidad cantidad, p_documento_referencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req uuid; v_material uuid; v_pendiente numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad <= 0
     or length(btrim(coalesce(p_documento_referencia, ''))) not between 2 and 100 then
    raise exception 'Indica una cantidad recibida y el documento del proveedor.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then return p_id; end if;
  select requerimiento_detalle_id, material_id into v_req, v_material
    from public.orden_compra_material_detalles
   where id = p_orden_compra_detalle_id for update;
  if not found then raise exception 'La línea de compra no existe.' using errcode = 'foreign_key_violation'; end if;
  if exists (select 1 from public.ingresos_pendientes_almacen
              where orden_compra_detalle_id = p_orden_compra_detalle_id and estado = 'PENDIENTE') then
    raise exception 'El conductor ya dejó esta compra en almacén: valídala en el kardex, en «Ingresos por validar».'
      using errcode = 'check_violation';
  end if;
  -- Lo que espera reposición entra solo por `recibir_reposicion`, contra su devolución.
  select ocd.cantidad - k.sin_reponer - k.por_reponer - k.neto
    into v_pendiente from public.orden_compra_material_detalles ocd
   cross join lateral public.cuenta_de_la_linea_de_compra(ocd.id) k
   where ocd.id = p_orden_compra_detalle_id;
  if p_cantidad > v_pendiente then
    raise exception 'La recepción supera lo pendiente de esta compra (%).', v_pendiente using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
  values (p_id, 'INGRESO', v_req, p_orden_compra_detalle_id, case when v_req is null then v_material end, p_cantidad,
          btrim(p_documento_referencia), public.usuario_actual());
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_ingresos_compra(p_compra uuid, p_lineas jsonb, p_documento text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_linea record;
  v_fila public.ingresos_pendientes_almacen%rowtype;
  v_documento text;
  v_observacion text;
  v_estado text;
  v_hechas integer := 0;
  v_observadas text[] := '{}';
  v_falta numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_compra is null or p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 200 then
    raise exception 'Indica qué llegó de cada material de la compra.' using errcode = 'check_violation';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra ya no está disponible. Vuelve a cargar el kardex.' using errcode = 'foreign_key_violation';
  end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_lineas) as x(id uuid)) <> jsonb_array_length(p_lineas) then
    raise exception 'Hay materiales repetidos en la validación. Vuelve a cargar el kardex.' using errcode = 'unique_violation';
  end if;
  v_documento := left(coalesce(nullif(btrim(p_documento), ''), v_compra.numero, v_compra.referencia), 100);
  if length(v_documento) < 2 then
    raise exception 'Escribe la guía o el documento con que llegó la compra.' using errcode = 'check_violation';
  end if;

  for v_linea in
    select * from jsonb_to_recordset(p_lineas) as x(id uuid, movimiento_id uuid, cantidad numeric, observacion text)
  loop
    select * into v_fila from public.ingresos_pendientes_almacen
     where id = v_linea.id and orden_compra_id = p_compra for update;
    if not found then
      raise exception 'Un material no pertenece a la compra %. Vuelve a cargar el kardex.', coalesce(v_compra.numero, v_compra.referencia)
        using errcode = 'foreign_key_violation';
    end if;
    -- Reintento del mismo envío: ya quedó hecho con este movimiento.
    if v_fila.estado <> 'PENDIENTE' then
      if v_linea.movimiento_id is not null and v_fila.movimiento_id = v_linea.movimiento_id then
        continue;
      end if;
      if v_linea.movimiento_id is null and v_fila.estado = 'OBSERVADO' and v_fila.movimiento_id is null
         and v_fila.validado_por = public.usuario_actual() then
        continue;
      end if;
      raise exception 'Alguien ya revisó esta compra. Vuelve a cargar el kardex.' using errcode = 'check_violation';
    end if;

    v_observacion := nullif(btrim(coalesce(v_linea.observacion, '')), '');
    if v_linea.cantidad is null or v_linea.cantidad < 0 or v_linea.cantidad <> round(v_linea.cantidad, 3) then
      raise exception 'La cantidad que llegó debe ser un número de cero en adelante.' using errcode = 'check_violation';
    end if;
    if v_linea.cantidad > v_fila.cantidad then
      raise exception 'Llegó más de lo que dejó el conductor (%). Si sobra, regístralo como ingreso general.',
        rtrim(rtrim(to_char(v_fila.cantidad, 'FM99999999990.000'), '0'), '.') using errcode = 'check_violation';
    end if;
    if (v_linea.cantidad < v_fila.cantidad or v_observacion is not null)
       and length(coalesce(v_observacion, '')) not between 10 and 500 then
      raise exception 'Cuenta qué faltó o qué pasó con el material (de 10 a 500 letras).' using errcode = 'check_violation';
    end if;
    -- Una compra de requerimiento todavía puede recibirse a mano: lo que se
    -- valida no pasa de lo que de verdad falta recibir de la línea ahora.
    select d.cantidad - k.sin_reponer - k.por_reponer - k.neto into v_falta
      from public.orden_compra_material_detalles d
     cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k
     where d.id = v_fila.orden_compra_detalle_id;
    if v_linea.cantidad > coalesce(v_falta, 0) then
      raise exception 'De % ya se recibió parte por otro lado: solo falta recibir %. Corrige la cantidad u obsérvalo.',
        (select m.descripcion from public.materiales m where m.id = v_fila.material_id),
        rtrim(rtrim(to_char(greatest(coalesce(v_falta, 0), 0), 'FM99999999990.000'), '0'), '.') using errcode = 'check_violation';
    end if;
    if v_linea.cantidad > 0 and v_linea.movimiento_id is null then
      raise exception 'Falta el identificador del ingreso. Vuelve a cargar el kardex.' using errcode = 'check_violation';
    end if;

    v_estado := case when v_linea.cantidad = v_fila.cantidad and v_observacion is null then 'VALIDADO' else 'OBSERVADO' end;
    if v_linea.cantidad > 0 then
      insert into public.movimientos_materiales
        (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
      values (v_linea.movimiento_id, 'INGRESO', v_fila.requerimiento_detalle_id, v_fila.orden_compra_detalle_id,
              v_fila.material_id, v_linea.cantidad, v_documento, public.usuario_actual());
    end if;
    update public.ingresos_pendientes_almacen
       set estado = v_estado,
           cantidad_validada = case when v_linea.cantidad > 0 then v_linea.cantidad end,
           movimiento_id = case when v_linea.cantidad > 0 then v_linea.movimiento_id end,
           validado_por = public.usuario_actual(),
           validado_en = now(),
           observacion = v_observacion
     where id = v_fila.id;
    v_hechas := v_hechas + 1;
    if v_estado = 'OBSERVADO' then
      v_observadas := v_observadas || (select m.descripcion from public.materiales m where m.id = v_fila.material_id);
    end if;
  end loop;

  -- Lo observado lo resuelve Logística: le llega a quien emitió la compra.
  if cardinality(v_observadas) > 0 then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, 'Almacén observó la compra ' || coalesce(v_compra.numero, v_compra.referencia),
           left(array_to_string(v_observadas, ', ') || ': revisa lo que anotó Almacén al recibir.', 500),
           '/compras', 'ordenes_compra_materiales', v_compra.id
      from public.usuarios u
     where u.id = v_compra.creado_por and u.activo;
  end if;
  return v_hechas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_compra_dejada_almacen(p_compra uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_compra public.ordenes_compra_materiales%rowtype; v_lineas int;
begin
  perform public.exigir_permiso('compras.recojo');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo = 'DEJADO' then
    return p_compra;
  end if;
  if v_compra.recojo is distinct from 'RECOGIDO' then
    raise exception 'Marca primero que recogiste la compra %.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;

  update public.ordenes_compra_materiales
     set recojo = 'DEJADO', dejado_en = now(), dejado_por = public.usuario_actual(),
         entregado_almacen_en = coalesce(entregado_almacen_en, now()),
         entregado_almacen_por = coalesce(entregado_almacen_por, public.usuario_actual())
   where id = p_compra;

  -- Una fila por línea, con lo que todavía falta recibir de ella.
  insert into public.ingresos_pendientes_almacen
    (orden_compra_id, orden_compra_detalle_id, material_id, requerimiento_detalle_id, orden_id,
     cantidad, precio_unitario, moneda, dejado_por, dejado_en)
  select p_compra, d.id, coalesce(d.material_id, om.material_id), d.requerimiento_detalle_id, r.orden_id,
         d.cantidad - rec.sin_reponer - rec.por_reponer - rec.neto, d.precio_unitario, v_compra.moneda,
         public.usuario_actual(), now()
    from public.orden_compra_material_detalles d
    left join public.requerimientos_materiales r on r.id = d.requerimiento_id
    left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    left join public.ot_materiales om on om.id = rd.ot_material_id
    cross join lateral public.cuenta_de_la_linea_de_compra(d.id) rec
   where d.orden_compra_id = p_compra
     and d.cantidad - rec.sin_reponer - rec.por_reponer - rec.neto > 0
  on conflict (orden_compra_detalle_id) do nothing;
  get diagnostics v_lineas = row_count;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Ingreso por validar: ' || coalesce(v_compra.numero, v_compra.referencia),
         v_compra.proveedor || '. ' || v_lineas || case when v_lineas = 1 then ' línea' else ' líneas' end
           || ' dejadas en el almacén por el conductor.',
         '/almacen/kardex', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'almacen.recibir'
   where u.activo;
  return p_compra;
end;
$function$;

CREATE OR REPLACE FUNCTION public.entregado_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(requerimiento_id uuid, item integer, entregado numeric, llegado numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide lo entregado de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with pedidas as (
    select l.id, l.requerimiento_id, l.item, l.orden_compra_detalle_id as detalle
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  ),
  ingresado as (
    select m.orden_compra_detalle_id as detalle,
           sum(case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end) as cantidad
      from public.movimientos_materiales m
     where m.tipo in ('INGRESO', 'DEVOLUCION_PROVEEDOR') and m.devolucion_de is null
       and m.orden_compra_detalle_id in (select p.detalle from pedidas p where p.detalle is not null)
     group by m.orden_compra_detalle_id
  )
  select p.requerimiento_id, p.item::integer,
         coalesce((
           select sum(greatest(m.cantidad - coalesce((
                    select sum(d.cantidad) from public.movimientos_materiales d
                     where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0))
             from public.movimientos_materiales m
            where m.requerimiento_linea_id = p.id and m.tipo = 'SALIDA'), 0)::numeric,
         -- Lo que ingresó se reparte entre todos los insumos de la línea de OC, también
         -- los de RQ que no se pidieron aquí: primero lo que ya se le entregó a cada uno.
         case when p.detalle is not null then
           (select x.llegado from public.llegado_de_la_linea_de_compra(p.detalle, coalesce(i.cantidad, 0)) x where x.linea_id = p.id)
         end
    from pedidas p
    left join ingresado i on i.detalle = p.detalle
   order by p.requerimiento_id, p.item;
end;
$function$;

CREATE OR REPLACE FUNCTION public.separado_de_cada_linea(p_materiales uuid[])
 RETURNS TABLE(linea uuid, material_id uuid, codigo text, numero text, cantidad numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Toda línea de un RQ abierto con material o con compra (un insumo escrito a
  -- mano antes del catálogo no tiene material, pero lo que llega de su compra
  -- sí es suyo), y las de los RQ ya entregados que comparten una línea de OC
  -- con uno abierto: el reparto de lo que llega de ella mira también a esos
  -- (los demás entregados no cambian nada y con el tiempo serían todo el
  -- histórico). No se filtra por material: lo comprado puede ser otro.
  with oc_con_rq_abierto as (
    select distinct l.orden_compra_detalle_id as detalle
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where l.orden_compra_detalle_id is not null
       and r.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
  ),
  lineas as (
    select l.id, l.material_id, l.item, l.cantidad::numeric as cantidad,
           coalesce(l.cantidad_en_stock, 0)::numeric as en_stock,
           l.orden_compra_detalle_id as detalle, r.numero, r.estado, r.creado_en,
           coalesce(public.normalizar_codigo_interno(r.codigo_interno), 'SIN CÓDIGO') as codigo
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where (l.material_id is not null or l.orden_compra_detalle_id is not null)
       and (r.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
            or (r.estado = 'ENTREGADO'
                and l.orden_compra_detalle_id in (select o.detalle from oc_con_rq_abierto o)))
  ),
  -- Cuánto entró al kardex de cada línea de OC, y de qué material es.
  -- Lo que entró y lo que falta comprar se reparten con la misma regla que
  -- `entregado_de_requerimientos` (20261020191000), para que «Stock en almacén»
  -- y el avance del RQ digan lo mismo: si cambia una, cambia la otra.
  recibido as (
    select d.id as detalle, d.material_id,
           coalesce((select sum(case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end)
                       from public.movimientos_materiales m
                      where m.orden_compra_detalle_id = d.id and m.tipo in ('INGRESO', 'DEVOLUCION_PROVEEDOR')
                        and m.devolucion_de is null), 0) as cantidad
      from public.orden_compra_material_detalles d
     where d.id in (select l.detalle from lineas l where l.detalle is not null)
  ),
  -- Lo que le llegó a cada una, con `llegado_de_la_linea_de_compra`, como el
  -- avance del RQ: lo ya entregado a un insumo cuenta primero (auditor de
  -- funcionamiento, 22/10: con una reposición pendiente esto separaba de más).
  con_llegado as (
    select c.*, coalesce(rc.material_id, c.material_id) as material_comprado,
           coalesce((select x.llegado from public.llegado_de_la_linea_de_compra(c.detalle, coalesce(rc.cantidad, 0)) x
                      where x.linea_id = c.id), 0) as llegado
      from lineas c
      left join recibido rc on rc.detalle = c.detalle
     where c.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
  ),
  -- Cada línea abierta en dos partes: la que Almacén separó de su stock, del
  -- material pedido (todo lo que no llegó de la compra, si está listo), y la
  -- que llegó de su compra, del material comprado. Si las dos son del mismo
  -- material, una sola.
  partes as (
    select u.id, u.material_id, u.codigo, u.numero, sum(u.cantidad) as separado, min(u.orden) as orden
      from (select c.id, c.material_id, c.codigo, c.numero, 1 as orden,
                   case when c.estado = 'LISTO_EN_ALMACEN' then c.cantidad - c.llegado else c.en_stock end as cantidad
              from con_llegado c
             where c.material_id is not null
            union all
            select c.id, c.material_comprado, c.codigo, c.numero, 2, c.llegado
              from con_llegado c
             where c.llegado > 0) u
     group by u.id, u.material_id, u.codigo, u.numero
  ),
  -- Lo entregado de cada línea abierta, por material: cada salida con esa
  -- línea, menos lo que de ella volvió. Aparte, lo que salió de lo separado:
  -- sin lo que la salida le descontó a una unidad (de_la_unidad), que no era
  -- de la línea, y que lo devuelto le devuelve primero. Las salidas de antes
  -- de esta migración quedaron anotadas al aplicarla (anotar_salidas_de_antes).
  entregas as (
    select x.id, x.material_id, sum(x.neto) as entregado,
           sum(x.neto - greatest(x.de_la_unidad - x.devuelto, 0)) as de_lo_separado
      from (select s.requerimiento_linea_id as id, s.material_id,
                   coalesce(s.de_la_unidad, 0) as de_la_unidad,
                   s.cantidad::numeric - d.devuelto as neto, d.devuelto
              from public.movimientos_materiales s
              join con_llegado c on c.id = s.requerimiento_linea_id
              cross join lateral (
                select coalesce(sum(d.cantidad::numeric), 0) as devuelto from public.movimientos_materiales d
                 where d.devolucion_de = s.id and d.tipo = 'INGRESO') d
             where s.tipo = 'SALIDA') x
     group by x.id, x.material_id
  ),
  -- Lo que salió de lo separado se descuenta de la parte de su mismo material. Y la
  -- línea entera nunca tiene separado más de lo que le falta entregar (lo
  -- pedido menos todo lo entregado, de cualquier material): lo que sobra se
  -- recorta primero de la parte del pedido, que es stock general, y después de
  -- lo comprado para ella. Así, si Almacén entrega el pedido en vez de lo
  -- comprado, o un tercero, lo que no salió no queda separado para siempre; y
  -- si entrega de otro material antes de que llegue la compra, lo que separó
  -- del pedido sigue siendo de la línea mientras le falte.
  restos as (
    select p.id, p.material_id, p.codigo, p.numero, p.orden,
           greatest(p.separado - coalesce(e.de_lo_separado, 0), 0) as resto
      from partes p
      left join entregas e on e.id = p.id and e.material_id = p.material_id
  ),
  falta as (
    select c.id, greatest(c.cantidad - coalesce(t.entregado, 0), 0) as cantidad
      from con_llegado c
      left join (select e.id, sum(e.entregado) as entregado from entregas e group by e.id) t on t.id = c.id
  )
  select s.linea, s.material_id, s.codigo, s.numero, s.cantidad
    from (select r.id as linea, r.material_id, r.codigo, r.numero,
                 greatest(r.resto - greatest(sum(r.resto) over (partition by r.id) - f.cantidad
                                             - coalesce(sum(r.resto) over (partition by r.id order by r.orden
                                                          rows between unbounded preceding and 1 preceding), 0), 0), 0) as cantidad
            from restos r
            join falta f on f.id = r.id) s
   where p_materiales is null or s.material_id = any(p_materiales)
$function$;

-- `corregir_requerimiento` no se copia entera: la 20261022180000 (otro hilo) la
-- cambia antes que esta, y copiarla de su versión anterior le borraría eso. Se
-- cambia solo la línea que cuenta el material repetido, como hace esa migración.
do $$
declare
  v_def   text;
  v_viejo text := E'group by l.material_id having count(*) > 1) then';
  v_nuevo text := E'group by l.material_id having count(*) filter (where l.recompra_de is null) > 1) then';
begin
  v_def := replace(pg_get_functiondef('public.corregir_requerimiento(uuid,uuid,text,text,text,jsonb)'::regprocedure), E'\r', '');
  if position(v_nuevo in v_def) > 0 then
    return;  -- ya estaba
  end if;
  if (char_length(v_def) - char_length(replace(v_def, v_viejo, ''))) / char_length(v_viejo) <> 1 then
    raise exception 'corregir_requerimiento cambió: la cuenta del material repetido no está como la conoce el repositorio. Revisarla a mano antes de seguir.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- 4. Avisos ----------------------------------------------------------------------------------------
-- Una cantidad como la escribe la gente: 2, 2.5, 0.125 (sin ceros de más).
create or replace function public.cantidad_en_texto(p numeric)
returns text language sql immutable set search_path to 'public' as $$
  select rtrim(rtrim(to_char(p, 'FM999999999990.000'), '0'), '.')
$$;
revoke all on function public.cantidad_en_texto(numeric) from public, anon;
grant execute on function public.cantidad_en_texto(numeric) to authenticated;
-- A quien tiene el permiso, salvo a quien hizo el cambio.
create or replace function public.avisar_a_permiso(p_permiso text, p_titulo text, p_cuerpo text, p_ruta text,
                                                   p_tabla text, p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, left(p_titulo, 200), left(p_cuerpo, 500), p_ruta, p_tabla, p_id
    from public.usuarios u
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = p_permiso)
$$;
revoke all on function public.avisar_a_permiso(text, text, text, text, text, uuid) from public, anon, authenticated;

-- 5. El RQ que espera lo devuelto -------------------------------------------------------------------
-- Lo que llega de una línea de OC se reparte entre sus insumos en el orden en que
-- se pidieron (`entregado_de_requerimientos`): lo devuelto le falta al último.
-- Un RQ «listo en almacén» al que la devolución le quitó lo que tenía vuelve a
-- «en atención»: ya no está todo.
create or replace function public.reabrir_rq_por_lo_devuelto(p_detalle uuid, p_neto_antes numeric, p_neto_despues numeric,
                                                             p_compra text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_l   record;
  v_rq  public.requerimientos%rowtype;
  v_ya  uuid[] := '{}';
begin
  for v_l in
    select a.requerimiento_id, a.llegado as antes, d.llegado as despues
      from public.llegado_de_la_linea_de_compra(p_detalle, p_neto_antes) a
      join public.llegado_de_la_linea_de_compra(p_detalle, p_neto_despues) d on d.linea_id = a.linea_id
  loop
    continue when v_l.requerimiento_id = any (v_ya);
    continue when v_l.despues >= v_l.antes;
    select * into v_rq from public.requerimientos where id = v_l.requerimiento_id for update;
    continue when v_rq.estado <> 'LISTO_EN_ALMACEN';
    update public.requerimientos
       set estado = 'EN_ATENCION', listo_en_almacen_en = null, listo_en_almacen_por = null
     where id = v_rq.id;
    v_ya := v_ya || v_rq.id;
    perform public.fn_rq_avisar(v_rq, 'Ya no está listo: ' || v_rq.numero,
      'Almacén devolvió al proveedor parte de lo que llegó de la ' || p_compra || ': espera que llegue.', 'AREA');
    perform public.fn_rq_avisar(v_rq, 'Ya no está listo: ' || v_rq.numero,
      'Almacén devolvió al proveedor parte de lo que llegó de la ' || p_compra || ': espera que llegue.', 'EMISOR');
  end loop;
end;
$$;
revoke all on function public.reabrir_rq_por_lo_devuelto(uuid, numeric, numeric, text) from public, anon, authenticated;

-- Lo que el proveedor no repone vuelve a la lista de Logística. A cada insumo
-- afectado, del último al primero, se le quita lo que ya no va a llegar: si se
-- queda sin nada que esperar de la OC, se suelta de ella entero; si no, se parte
-- y lo que falta pasa a un insumo nuevo del mismo RQ, sin compra, que dice de qué
-- insumo y de qué devolución salió. Lo que Logística compró de más para el stock
-- cubre primero. Un RQ ya entregado no cambia: se avisa a Logística y a quien lo pidió.
create or replace function public.recomprar_lo_devuelto(p_detalle uuid, p_devolucion uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_d       public.orden_compra_material_detalles%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_k       record;
  v_deficit numeric;
  v_l       record;
  v_x       numeric;
  v_rq      public.requerimientos%rowtype;
  v_item    integer;
  v_compra  text;
  v_unidad  text;
  v_hechas  integer := 0;
begin
  select * into v_d from public.orden_compra_material_detalles where id = p_detalle;
  select * into v_c from public.ordenes_compra_materiales where id = v_d.orden_compra_id;
  v_compra := coalesce(v_c.numero, 'OC ' || v_c.referencia);
  -- Los RQ en orden, como al emitir la OC, para no cruzarse con otra compra.
  perform 1 from public.requerimientos r
   where r.id in (select l.requerimiento_id from public.requerimiento_lineas l where l.orden_compra_detalle_id = p_detalle)
   order by r.id
     for update;
  select * into v_k from public.cuenta_de_la_linea_de_compra(p_detalle);
  select coalesce(sum(greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0)), 0) - (v_d.cantidad - v_k.sin_reponer)
    into v_deficit
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
   where l.orden_compra_detalle_id = p_detalle and r.estado <> 'ANULADO';

  -- Solo lo que todavía no se le entregó a cada insumo puede faltarle; primero a los
  -- RQ abiertos, del último al primero, y al final a los ya entregados, que solo se avisan.
  for v_l in
    select l.*, x.falta - x.entregado as resto
      from public.llegado_de_la_linea_de_compra(p_detalle, v_k.neto) x
      join public.requerimiento_lineas l on l.id = x.linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
     order by r.estado = 'ENTREGADO', r.creado_en desc, r.numero desc, l.item desc
  loop
    exit when v_deficit <= 0;
    v_x := least(v_l.resto, v_deficit);
    continue when v_x <= 0;
    v_deficit := v_deficit - v_x;
    select * into v_rq from public.requerimientos where id = v_l.requerimiento_id;
    select um.codigo into v_unidad from public.unidades_medida um where um.id = v_l.unidad_medida_id;
    if v_rq.estado = 'ENTREGADO' then
      perform public.fn_rq_avisar(v_rq, 'Devuelto sin reponer: ' || v_rq.numero,
        format('%s %s de %s volvieron al proveedor de la %s, que no los repone. El %s ya se entregó: si todavía hace falta, pide otro requerimiento.',
               public.cantidad_en_texto(v_x), coalesce(v_unidad, ''), v_l.descripcion, v_compra, v_rq.numero), 'LOGISTICA');
      perform public.fn_rq_avisar(v_rq, 'Devuelto sin reponer: ' || v_rq.numero,
        format('%s %s de %s volvieron al proveedor de la %s, que no los repone. Si todavía hace falta, pide otro requerimiento.',
               public.cantidad_en_texto(v_x), coalesce(v_unidad, ''), v_l.descripcion, v_compra), 'EMISOR');
      continue;
    end if;
    perform set_config('metalwork.corrigiendo', 'requerimiento', true);
    if v_x >= v_l.cantidad then
      update public.requerimiento_lineas
         set orden_compra_id = null, orden_compra_detalle_id = null, atendida_en = null, atendida_por = null
       where id = v_l.id;
    else
      update public.requerimiento_lineas set cantidad = cantidad - v_x where id = v_l.id;
      select max(item) + 1 into v_item from public.requerimiento_lineas where requerimiento_id = v_rq.id;
      if v_item > 100 then
        raise exception 'El requerimiento % ya tiene cien insumos: lo que no repone el proveedor no cabe. Pide a Requerimientos otro RQ para comprarlo.',
          v_rq.numero using errcode = 'check_violation';
      end if;
      insert into public.requerimiento_lineas
        (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id, material_id, material_nuevo,
         cantidad_en_stock, stock_revisado_en, stock_revisado_por, recompra_de, recompra_por)
      values (v_rq.id, v_item, v_l.descripcion, v_x, v_l.unidad_medida_id, v_l.categoria_id, v_l.material_id, false,
              0, now(), public.usuario_actual(), v_l.id, p_devolucion);
    end if;
    perform set_config('metalwork.corrigiendo', '', true);
    if v_rq.estado = 'LISTO_EN_ALMACEN' then
      update public.requerimientos
         set estado = 'EN_ATENCION', listo_en_almacen_en = null, listo_en_almacen_por = null
       where id = v_rq.id;
      perform public.fn_rq_avisar(v_rq, 'Ya no está listo: ' || v_rq.numero,
        'El proveedor de la ' || v_compra || ' no repone lo devuelto: Logística lo compra otra vez.', 'AREA');
    end if;
    perform public.fn_rq_avisar(v_rq, 'Por comprar otra vez: ' || v_rq.numero,
      format('%s %s de %s: el proveedor de la %s no repone lo devuelto.', public.cantidad_en_texto(v_x), coalesce(v_unidad, ''),
             v_l.descripcion, v_compra), 'LOGISTICA');
    perform public.fn_rq_avisar(v_rq, 'Por comprar otra vez: ' || v_rq.numero,
      format('%s %s de %s volvieron al proveedor de la %s, que no los repone: Logística los compra otra vez.',
             public.cantidad_en_texto(v_x), coalesce(v_unidad, ''), v_l.descripcion, v_compra), 'EMISOR');
    v_hechas := v_hechas + 1;
  end loop;
  return v_hechas;
end;
$$;
revoke all on function public.recomprar_lo_devuelto(uuid, uuid) from public, anon, authenticated;

-- 6. Devolver ----------------------------------------------------------------------------------------
create or replace function public.devolver_al_proveedor(p_id uuid, p_ingreso uuid, p_cantidad numeric, p_documento text,
                                                        p_motivo text, p_se_repone boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_ing     public.movimientos_materiales%rowtype;
  v_d       public.orden_compra_material_detalles%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_mat     public.materiales%rowtype;
  v_unidad  text;
  v_devuelto numeric;
  v_saldo   numeric;
  v_neto    numeric;
  v_compra  text;
  v_texto   text;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta no llegó) devuelve lo que ya entró; con otros datos no da «listo».
  if exists (select 1 from public.movimientos_materiales where id = p_id) then
    if exists (select 1 from public.movimientos_materiales m
                where m.id = p_id and m.tipo = 'DEVOLUCION_PROVEEDOR' and m.devuelve_ingreso = p_ingreso
                  and m.cantidad::numeric = p_cantidad and m.documento_referencia = btrim(p_documento)
                  and m.registrado_por = public.usuario_actual()
                  and (m.se_repone = p_se_repone or m.reposicion_cancelada_en is not null)) then
      return p_id;
    end if;
    raise exception 'Esa devolución ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3) or p_cantidad > 999999999 then
    raise exception 'Escribe cuánto vuelve al proveedor: más de cero, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_documento, ''))) not between 2 and 100 then
    raise exception 'Escribe la guía o el documento con que sale lo devuelto.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se devuelve (de 10 a 500 letras).' using errcode = 'check_violation';
  end if;
  if p_se_repone is null then
    raise exception 'Di si el proveedor lo repone.' using errcode = 'check_violation';
  end if;

  select * into v_ing from public.movimientos_materiales where id = p_ingreso;
  if not found or v_ing.tipo <> 'INGRESO' or v_ing.origen <> 'COMPRA' or v_ing.orden_compra_detalle_id is null then
    raise exception 'Elige un ingreso de una compra.' using errcode = 'check_violation';
  end if;
  if v_ing.requerimiento_detalle_id is not null then
    raise exception 'Ese ingreso es de un pedido de material de OT de antes del requerimiento: no se devuelve por aquí.'
      using errcode = 'check_violation';
  end if;
  -- La línea de OC y el material, tomados: otra devolución u otro ingreso de la misma línea espera.
  select * into v_d from public.orden_compra_material_detalles where id = v_ing.orden_compra_detalle_id for update;
  select * into v_c from public.ordenes_compra_materiales where id = v_d.orden_compra_id;
  select * into v_mat from public.materiales where id = v_ing.material_id for update;
  select um.codigo into v_unidad from public.unidades_medida um where um.id = v_mat.unidad_medida_id;
  v_compra := coalesce(v_c.numero, 'OC ' || v_c.referencia);

  select coalesce(sum(m.cantidad::numeric), 0) into v_devuelto
    from public.movimientos_materiales m where m.devuelve_ingreso = p_ingreso;
  if p_cantidad > v_ing.cantidad - v_devuelto then
    raise exception 'De ese ingreso de la % quedan % % por devolver.', v_compra,
      public.cantidad_en_texto(greatest(v_ing.cantidad - v_devuelto, 0)), coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;
  v_saldo := public.saldo_material_interno(v_mat.id);
  if p_cantidad > v_saldo then
    raise exception 'En el almacén hay % % de %: lo que ya salió al taller vuelve primero como devolución del taller.',
      public.cantidad_en_texto(greatest(v_saldo, 0)), coalesce(v_unidad, ''), v_mat.descripcion using errcode = 'check_violation';
  end if;
  -- De la OC, no del material entero: lo que de ella se entregó a sus RQ ya no está aquí.
  v_saldo := public.en_mano_de_la_linea_de_compra(v_d.id);
  if p_cantidad > v_saldo then
    raise exception 'De lo que llegó con la % quedan % % en el almacén: lo que ya se entregó a sus RQ vuelve primero como devolución del taller.',
      v_compra, public.cantidad_en_texto(v_saldo), coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;

  select k.neto into v_neto from public.cuenta_de_la_linea_de_compra(v_d.id) k;
  insert into public.movimientos_materiales
    (id, tipo, origen, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por,
     precio_unitario, moneda, codigo_interno, requerimiento_linea_id, devuelve_ingreso, se_repone, motivo_devolucion)
  values (p_id, 'DEVOLUCION_PROVEEDOR', 'DEVOLUCION_PROVEEDOR', v_d.id, v_mat.id, p_cantidad, btrim(p_documento),
          public.usuario_actual(), v_ing.precio_unitario, v_ing.moneda, v_ing.codigo_interno, v_ing.requerimiento_linea_id,
          p_ingreso, p_se_repone, btrim(p_motivo));

  perform public.reabrir_rq_por_lo_devuelto(v_d.id, v_neto, v_neto - p_cantidad, v_compra);
  if not p_se_repone then
    perform public.recomprar_lo_devuelto(v_d.id, p_id);
  end if;

  v_texto := format('%s %s de %s: %s', public.cantidad_en_texto(p_cantidad), coalesce(v_unidad, ''), v_mat.descripcion, btrim(p_motivo));
  perform public.avisar_a_permiso('compras.crear', 'Devuelto al proveedor: ' || v_compra,
    v_texto || case when p_se_repone then ' El proveedor lo repone.'
                    else ' No lo repone: lo que haga falta vuelve a la lista para comprarlo en otra OC.' end,
    '/compras', 'ordenes_compra_materiales', v_c.id);
  if not p_se_repone then
    perform public.avisar_a_permiso('adquisiciones.registrar', 'Espera la nota de crédito: ' || v_compra,
      v_texto || ' El proveedor no lo repone: registra su nota de crédito contra la factura.',
      '/adquisiciones?vista=facturas#notas-credito', 'ordenes_compra_materiales', v_c.id);
  end if;
  return p_id;
end;
$$;
revoke all on function public.devolver_al_proveedor(uuid, uuid, numeric, text, text, boolean) from public, anon;
grant execute on function public.devolver_al_proveedor(uuid, uuid, numeric, text, text, boolean) to authenticated;

-- 7. La reposición entra contra su devolución ---------------------------------------------------------
create or replace function public.recibir_reposicion(p_id uuid, p_devolucion uuid, p_cantidad numeric, p_documento text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_dev     public.movimientos_materiales%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_repuesto numeric;
  v_falta   numeric;
  v_unidad  text;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then
    if exists (select 1 from public.movimientos_materiales m
                where m.id = p_id and m.tipo = 'INGRESO' and m.repone_devolucion = p_devolucion
                  and m.cantidad::numeric = p_cantidad and m.documento_referencia = btrim(p_documento)
                  and m.registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esa reposición ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3) then
    raise exception 'Escribe cuánto llegó de la reposición: más de cero, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_documento, ''))) not between 2 and 100 then
    raise exception 'Escribe la guía o el documento con que llegó la reposición.' using errcode = 'check_violation';
  end if;
  select * into v_dev from public.movimientos_materiales where id = p_devolucion for update;
  if not found or v_dev.tipo <> 'DEVOLUCION_PROVEEDOR' then
    raise exception 'Esa devolución no existe. Vuelve a cargar el kardex.' using errcode = 'check_violation';
  end if;
  if not v_dev.se_repone then
    raise exception 'De esa devolución ya no se espera reposición: lo que llegue de más entra como ingreso general.'
      using errcode = 'check_violation';
  end if;
  perform 1 from public.orden_compra_material_detalles where id = v_dev.orden_compra_detalle_id for update;
  select coalesce(sum(m.cantidad::numeric), 0) into v_repuesto
    from public.movimientos_materiales m where m.repone_devolucion = p_devolucion;
  select um.codigo into v_unidad from public.materiales mt join public.unidades_medida um on um.id = mt.unidad_medida_id
   where mt.id = v_dev.material_id;
  if p_cantidad > v_dev.cantidad - v_repuesto then
    raise exception 'De esa devolución faltan reponer % %.', public.cantidad_en_texto(greatest(v_dev.cantidad - v_repuesto, 0)),
      coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;
  -- Tampoco pasa de lo que la línea de OC todavía espera: lo que entró por otro lado ya cuenta.
  select d.cantidad - k.sin_reponer - k.neto into v_falta
    from public.orden_compra_material_detalles d
   cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k
   where d.id = v_dev.orden_compra_detalle_id;
  if p_cantidad > coalesce(v_falta, 0) then
    raise exception 'La compra ya recibió por otro lado lo que se devolvió: solo espera % %.', public.cantidad_en_texto(greatest(coalesce(v_falta, 0), 0)),
      coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, origen, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por, repone_devolucion,
     precio_unitario, moneda)
  values (p_id, 'INGRESO', 'COMPRA', v_dev.orden_compra_detalle_id, v_dev.material_id, p_cantidad, btrim(p_documento),
          public.usuario_actual(), p_devolucion, v_dev.precio_unitario, v_dev.moneda);
  return p_id;
end;
$$;
revoke all on function public.recibir_reposicion(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.recibir_reposicion(uuid, uuid, numeric, text) to authenticated;

-- 8. Ya no se espera la reposición -------------------------------------------------------------------
-- Almacén o Logística, cuando el proveedor dice que no repone (o emite su nota de
-- crédito). Lo que faltaba reponer pasa a la lista de Logística.
create or replace function public.dejar_de_esperar_reposicion(p_devolucion uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_dev     public.movimientos_materiales%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_repuesto numeric;
  v_compra  text;
  v_texto   text;
begin
  -- Contabilidad también, sin pedirlo aparte: al registrar la nota de crédito de
  -- esa devolución (`registrar_nota_credito`, migración 20261022190000).
  if public.usuario_actual() is not null
     and current_setting('metalwork.nota_credito', true) is distinct from p_devolucion::text
     and not (public.es_admin() or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('compras.crear')) then
    raise exception 'Lo dice Almacén o Logística.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué ya no se espera (de 10 a 500 letras).' using errcode = 'check_violation';
  end if;
  select * into v_dev from public.movimientos_materiales where id = p_devolucion for update;
  if not found or v_dev.tipo <> 'DEVOLUCION_PROVEEDOR' then
    raise exception 'Esa devolución no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not v_dev.se_repone then
    return p_devolucion;
  end if;
  perform 1 from public.orden_compra_material_detalles where id = v_dev.orden_compra_detalle_id for update;
  select coalesce(sum(m.cantidad::numeric), 0) into v_repuesto
    from public.movimientos_materiales m where m.repone_devolucion = p_devolucion;
  if v_repuesto >= v_dev.cantidad then
    raise exception 'Esa devolución ya se repuso entera.' using errcode = 'check_violation';
  end if;
  update public.movimientos_materiales
     set se_repone = false, reposicion_cancelada_en = now(), reposicion_cancelada_por = public.usuario_actual(),
         reposicion_cancelada_motivo = btrim(p_motivo)
   where id = p_devolucion;
  perform public.recomprar_lo_devuelto(v_dev.orden_compra_detalle_id, p_devolucion);

  select c.* into v_c from public.ordenes_compra_materiales c
    join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
   where d.id = v_dev.orden_compra_detalle_id;
  v_compra := coalesce(v_c.numero, 'OC ' || v_c.referencia);
  v_texto := format('%s %s ya no se reponen: %s', public.cantidad_en_texto(v_dev.cantidad - v_repuesto),
                    (select mt.descripcion from public.materiales mt where mt.id = v_dev.material_id), btrim(p_motivo));
  perform public.avisar_a_permiso('compras.crear', 'No repone lo devuelto: ' || v_compra,
    v_texto || ' Lo que haga falta vuelve a la lista para comprarlo en otra OC.', '/compras', 'ordenes_compra_materiales', v_c.id);
  if current_setting('metalwork.nota_credito', true) is distinct from p_devolucion::text then
    perform public.avisar_a_permiso('adquisiciones.registrar', 'Espera la nota de crédito: ' || v_compra,
      v_texto || ' Registra su nota de crédito contra la factura.', '/adquisiciones?vista=facturas#notas-credito',
      'ordenes_compra_materiales', v_c.id);
  end if;
  return p_devolucion;
end;
$$;
revoke all on function public.dejar_de_esperar_reposicion(uuid, text) from public, anon;
grant execute on function public.dejar_de_esperar_reposicion(uuid, text) to authenticated;

-- 9. Lo que Almacén ve ---------------------------------------------------------------------------------
-- Los ingresos de compra que todavía se pueden devolver: lo que entró menos lo
-- devuelto, sin pasar de lo que hay en el almacén.
create or replace function public.ingresos_para_devolver()
returns table (ingreso_id uuid, fecha timestamptz, compra text, proveedor text, material_id uuid, material text,
               unidad text, ingresado numeric, se_puede numeric, documento text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('almacen.recibir')) then
    raise exception 'Lo devuelve Almacén.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select x.id, x.registrado_en, x.compra, x.proveedor, x.material_id, x.material, x.unidad, x.cantidad,
         least(x.cantidad - x.devuelto, greatest(public.saldo_material_interno(x.material_id), 0),
               public.en_mano_de_la_linea_de_compra(x.detalle)), x.documento_referencia
    from (select m.id, m.registrado_en, coalesce(c.numero, 'OC ' || c.referencia) as compra, c.proveedor, m.material_id,
                 mt.descripcion as material, um.codigo as unidad, m.cantidad::numeric as cantidad, m.documento_referencia,
                 dv.devuelto, m.orden_compra_detalle_id as detalle
            from public.movimientos_materiales m
            join public.orden_compra_material_detalles od on od.id = m.orden_compra_detalle_id
            join public.ordenes_compra_materiales c on c.id = od.orden_compra_id
            join public.materiales mt on mt.id = m.material_id
            left join public.unidades_medida um on um.id = mt.unidad_medida_id
           cross join lateral (
             select coalesce(sum(d.cantidad::numeric), 0) as devuelto
               from public.movimientos_materiales d where d.devuelve_ingreso = m.id) dv
           -- Primero lo que todavía se puede devolver, y de eso los 300 más recientes.
           where m.tipo = 'INGRESO' and m.origen = 'COMPRA' and m.requerimiento_detalle_id is null
             and m.cantidad::numeric - dv.devuelto > 0 and public.saldo_material_interno(m.material_id) > 0
             and public.en_mano_de_la_linea_de_compra(m.orden_compra_detalle_id) > 0
           order by m.registrado_en desc
           limit 300) x
   order by x.registrado_en desc;
end;
$$;
revoke all on function public.ingresos_para_devolver() from public, anon;
grant execute on function public.ingresos_para_devolver() to authenticated;

-- Las devoluciones que esperan su reposición.
create or replace function public.devoluciones_por_reponer()
returns table (devolucion_id uuid, fecha timestamptz, compra text, orden_compra_id uuid, proveedor text, material text,
               unidad text, devuelto numeric, repuesto numeric, documento text, motivo text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('almacen.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las devoluciones al proveedor.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select x.id, x.registrado_en, x.compra, x.oc, x.proveedor, x.material, x.unidad, x.cantidad, x.repuesto,
         x.documento_referencia, x.motivo_devolucion
    from (select m.id, m.registrado_en, coalesce(c.numero, 'OC ' || c.referencia) as compra, c.id as oc, c.proveedor,
                 mt.descripcion as material, um.codigo as unidad, m.cantidad::numeric as cantidad,
                 m.documento_referencia, m.motivo_devolucion,
                 coalesce((select sum(r.cantidad::numeric) from public.movimientos_materiales r
                            where r.repone_devolucion = m.id), 0) as repuesto
            from public.movimientos_materiales m
            join public.orden_compra_material_detalles od on od.id = m.orden_compra_detalle_id
            join public.ordenes_compra_materiales c on c.id = od.orden_compra_id
            join public.materiales mt on mt.id = m.material_id
            left join public.unidades_medida um on um.id = mt.unidad_medida_id
           where m.tipo = 'DEVOLUCION_PROVEEDOR' and m.se_repone) x
   where x.repuesto < x.cantidad
   order by x.registrado_en;
end;
$$;
revoke all on function public.devoluciones_por_reponer() from public, anon;
grant execute on function public.devoluciones_por_reponer() to authenticated;

-- 10. El avance del RQ: lo que espera reposición no se pinta como si hubiera llegado --------------------
-- Copia de la versión de la 20261015162000. Cambia solo el paso nuevo, `POR_REPONER`: la OC ya se
-- validó, el proveedor repone lo devuelto y a este insumo todavía le falta. Sin él, el RQ decía
-- «Ingresó al kardex» y «La OC compró menos: pide el resto en un RQ nuevo», y empujaba a comprar dos veces.
CREATE OR REPLACE FUNCTION public.avance_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(requerimiento_id uuid, porcentaje integer, etapa text, lineas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el avance de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with etapas (codigo, pct, orden) as (
    values ('POR_REVISAR', 10, 1), ('POR_COMPRAR', 20, 2), ('OC_POR_APROBAR', 30, 3),
           ('PENDIENTE_RECOJO', 45, 4), ('EN_RECOJO', 60, 5), ('RECOGIDO', 70, 6),
           ('OBSERVADO', 80, 7), ('POR_VALIDAR', 80, 8), ('POR_REPONER', 80, 8), ('EN_KARDEX', 85, 9), ('EN_STOCK', 85, 9),
           ('LISTO_EN_ALMACEN', 90, 10), ('ENTREGADO', 100, 11)
  ),
  validacion as (
    select i.orden_compra_id as compra,
           case when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                else 'VALIDADO' end as estado
      from public.ingresos_pendientes_almacen i
     where i.orden_compra_id in (select rl.orden_compra_id from public.requerimiento_lineas rl
                                  where rl.requerimiento_id = any(p_ids) and rl.orden_compra_id is not null)
     group by i.orden_compra_id
  ),
  llegado as (
    select e.requerimiento_id, e.item, e.llegado from public.entregado_de_requerimientos(p_ids) e
  ),
  por_linea as (
    select r.id as rq, l.item as item,
           coalesce(c.numero, c.referencia) as compra,
           coalesce(c.aprobacion in ('RECHAZADA', 'ANULADA'), false) as rechazada,
           coalesce(c.aprobacion = 'ANULADA', false) as anulada,
           l.cantidad_en_stock as en_stock,
           case when l.cantidad_en_stock is not null then greatest(l.cantidad - l.cantidad_en_stock, 0) end as por_comprar,
           case
             when r.estado = 'ENTREGADO' then 'ENTREGADO'
             when r.estado = 'LISTO_EN_ALMACEN' then 'LISTO_EN_ALMACEN'
             when r.estado = 'POR_ATENDER' then 'POR_REVISAR'
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then 'EN_STOCK'
             when c.id is null or c.aprobacion in ('RECHAZADA', 'ANULADA') then 'POR_COMPRAR'
             when c.aprobacion = 'POR_APROBAR' then 'OC_POR_APROBAR'
             -- Almacén devolvió parte y el proveedor la repone: al insumo todavía le falta (migración 20261022185000).
             when (c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null)) and v.estado = 'VALIDADO'
                  and l.orden_compra_detalle_id is not null
                  and (select k.por_reponer from public.cuenta_de_la_linea_de_compra(l.orden_compra_detalle_id) k) > 0
                  and coalesce(ll.llegado, 0) < coalesce(greatest(l.cantidad - l.cantidad_en_stock, 0), l.cantidad) then 'POR_REPONER'
             when c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null) then
               case v.estado when 'VALIDADO' then 'EN_KARDEX' when 'OBSERVADO' then 'OBSERVADO' else 'POR_VALIDAR' end
             when c.recojo = 'RECOGIDO' then 'RECOGIDO'
             when c.recojo = 'EN_RECOJO' then 'EN_RECOJO'
             else 'PENDIENTE_RECOJO'
           end as paso,
           case
             when r.estado in ('ENTREGADO', 'LISTO_EN_ALMACEN', 'POR_ATENDER') or c.aprobacion in ('RECHAZADA', 'ANULADA') then null
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then l.stock_revisado_en
             when c.recojo = 'DEJADO' then c.dejado_en
             when c.recojo = 'RECOGIDO' then c.recogido_en
             when c.recojo = 'EN_RECOJO' then c.en_recojo_en
             when c.recojo = 'POR_RECOGER' then c.recojo_pedido_en
           end as desde
      from public.requerimientos r
      join public.requerimiento_lineas l on l.requerimiento_id = r.id
      left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      left join validacion v on v.compra = c.id
      left join llegado ll on ll.requerimiento_id = r.id and ll.item = l.item
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  )
  select p.rq,
         round(avg(e.pct))::integer,
         (array_agg(p.paso order by e.orden, p.item))[1],
         jsonb_agg(jsonb_build_object('item', p.item, 'orden_compra', p.compra, 'rechazada', p.rechazada, 'anulada', p.anulada,
                                      'etapa', p.paso, 'porcentaje', e.pct, 'desde', p.desde,
                                      'en_stock', p.en_stock, 'por_comprar', p.por_comprar) order by p.item)
    from por_linea p
    join etapas e on e.codigo = p.paso
   group by p.rq;
end;
$function$;
