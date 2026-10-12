-- Almacén valida lo que deja el conductor, sin volver a digitarlo.
--
-- Hasta hoy la compra llegaba a Almacén y el almacenero la registraba a mano,
-- línea por línea, escribiendo cantidad y guía. Con el conductor de Logística
-- (migración 20261012110000) la entrega ya queda anotada al marcar «dejado en
-- almacén»: cada línea de la OC espera en `ingresos_pendientes_almacen`. Aquí
-- Almacén la revisa en su kardex y con un solo toque la convierte en INGRESO;
-- si llegó menos o no llegó, la observa con su motivo y Logística se entera.
--
-- Tres cosas:
--   1. El kardex acepta el ingreso de una OC directa (sin requerimiento).
--   2. `ingresos_por_validar()` le da a Almacén la bandeja sin abrirle las
--      compras, que su RLS acota por área del requerimiento.
--   3. `validar_ingresos_compra()` valida u observa todas las líneas de una
--      entrega en una sola transacción.
-- Y una guarda: lo que el conductor dejó no se registra otra vez a mano desde
-- Atención de materiales; se valida aquí, o entraría dos veces.

-- 1. El ingreso de una OC directa ------------------------------------------------
-- La línea directa no tiene requerimiento: el ingreso de compra se reconoce por
-- su línea de OC y su material, que `identificar_material_movimiento` completa
-- desde el requerimiento cuando lo hay.
alter table public.movimientos_materiales drop constraint if exists ck_movimiento_material_origen;
alter table public.movimientos_materiales add constraint ck_movimiento_material_origen check (
  (tipo = 'INGRESO' and responsable_id is null and nullif(btrim(documento_referencia), '') is not null
    and ((orden_compra_detalle_id is not null and material_id is not null and origen = 'COMPRA')
      or (orden_compra_detalle_id is null and material_id is not null and origen in ('SALDO_INICIAL', 'INGRESO_GENERAL', 'DEVOLUCION'))))
  or (tipo = 'DESPACHO' and requerimiento_detalle_id is not null and orden_compra_detalle_id is null and responsable_id is not null)
  or (tipo = 'SALIDA' and origen = 'SALIDA_GENERAL' and requerimiento_detalle_id is null and orden_compra_detalle_id is null
    and material_id is not null and nullif(btrim(documento_referencia), '') is not null
    and nullif(btrim(recibido_por_nombre), '') is not null)
);

-- La llave compuesta (línea, requerimiento) no comprueba nada cuando el
-- requerimiento es nulo: la línea directa necesita su llave simple. Índice: (a)
-- ya existe `ix_movimientos_materiales_oc` con esa primera columna.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_mov_material_oc_linea'
                   and conrelid = 'public.movimientos_materiales'::regclass) then
    alter table public.movimientos_materiales add constraint fk_mov_material_oc_linea
      foreign key (orden_compra_detalle_id) references public.orden_compra_material_detalles(id) on delete restrict;
  end if;
end $$;

-- La recepción a mano (Atención de materiales) sigue para las compras que no
-- pasan por el conductor. Toma el material de la línea —la directa no tiene
-- requerimiento— y no deja registrar lo que el conductor ya dejó.
create or replace function public.registrar_recepcion_material(
  p_id uuid, p_orden_compra_detalle_id uuid, p_cantidad public.cantidad,
  p_documento_referencia text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
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
  select ocd.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0)
    into v_pendiente from public.orden_compra_material_detalles ocd
    left join public.movimientos_materiales m on m.orden_compra_detalle_id = ocd.id
   where ocd.id = p_orden_compra_detalle_id group by ocd.id;
  if p_cantidad > v_pendiente then
    raise exception 'La recepción supera lo pendiente de esta compra (%).', v_pendiente using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
  values (p_id, 'INGRESO', v_req, p_orden_compra_detalle_id, case when v_req is null then v_material end, p_cantidad,
          btrim(p_documento_referencia), public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) to authenticated;

-- 2. La bandeja -----------------------------------------------------------------
-- Las compras se leen por el área de su requerimiento y la OC directa no tiene
-- ninguna: con una vista security_invoker Almacén vería la línea sin saber de
-- qué OC es. La función devuelve solo lo que la bandeja necesita, a quien
-- tiene el kardex.
create or replace function public.ingresos_por_validar()
returns table (
  id uuid,
  orden_compra_id uuid,
  referencia text,
  proveedor text,
  compra_directa boolean,
  orden_id uuid,
  orden_numero text,
  material_id uuid,
  material_codigo text,
  material text,
  unidad_medida text,
  cantidad numeric,
  precio_unitario numeric,
  moneda text,
  dejado_en timestamptz,
  dejado_por_nombre text,
  recogido_en timestamptz
) language plpgsql stable security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('almacen.ver');
  return query
  select p.id, p.orden_compra_id, coalesce(c.numero, c.referencia), c.proveedor, c.requerimiento_id is null,
         p.orden_id, ot.numero::text, p.material_id, mat.codigo, mat.descripcion, um.codigo,
         p.cantidad::numeric, p.precio_unitario::numeric, p.moneda, p.dejado_en,
         nullif(btrim(concat_ws(' ', us.nombres, us.apellidos)), ''), c.recogido_en
    from public.ingresos_pendientes_almacen p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
    join public.materiales mat on mat.id = p.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    left join public.ordenes_trabajo ot on ot.id = p.orden_id
    left join public.usuarios us on us.id = p.dejado_por
   where p.estado = 'PENDIENTE'
   order by p.dejado_en, c.referencia, mat.descripcion;
end;
$$;
revoke all on function public.ingresos_por_validar() from public, anon;
grant execute on function public.ingresos_por_validar() to authenticated;

-- 3. Validar u observar ----------------------------------------------------------
-- Una entrega se valida entera: cada línea de la OC con lo que de verdad llegó.
--   · Llegó todo, sin observación     → VALIDADO e INGRESO por lo dejado.
--   · Llegó menos, o vino con un reparo → OBSERVADO con su motivo; lo que sí
--     llegó entra igual al kardex.
--   · No llegó nada                    → OBSERVADO sin ingreso.
-- p_lineas: [{ "id": <fila pendiente>, "movimiento_id": <uuid nuevo>,
--              "cantidad": <lo que llegó>, "observacion": <texto o null> }]
-- Volver a enviar lo mismo (doble toque, señal que se cae) no duplica: la fila
-- que ya salió de PENDIENTE con ese mismo movimiento se da por hecha.
create or replace function public.validar_ingresos_compra(
  p_compra uuid, p_lineas jsonb, p_documento text default null
) returns integer language plpgsql security definer set search_path = 'public' as $$
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
    select d.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0) into v_falta
      from public.orden_compra_material_detalles d
      left join public.movimientos_materiales m on m.orden_compra_detalle_id = d.id
     where d.id = v_fila.orden_compra_detalle_id
     group by d.id;
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
$$;
revoke all on function public.validar_ingresos_compra(uuid, jsonb, text) from public, anon;
grant execute on function public.validar_ingresos_compra(uuid, jsonb, text) to authenticated;
