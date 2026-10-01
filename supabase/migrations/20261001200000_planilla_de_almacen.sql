-- Cuando en el almacén no hay internet, el trabajo no se detiene: la almacenera
-- anota los ingresos y las salidas en la planilla de Excel que descarga del
-- kardex y, al volver la señal, la carga. Pidió la empresa el 2026-10-01.
--
-- Cada movimiento de la planilla entra con la fecha en que ocurrió, no con la
-- de la carga: el kardex es una ficha en orden de fecha y el saldo de cada
-- línea depende de ese orden. Se guarda también cuándo se cargó y que vino de
-- una planilla, para que nadie confunda una carga tardía con un registro al
-- momento.
--
-- Límites, todos en la base:
--   · No se carga nada con fecha futura ni de hace más de 31 días.
--   · Nada anterior al último conteo físico del material: ese conteo fijó el
--     saldo de ese día, y un movimiento de antes lo dejaría mal hecho.
--   · Las salidas siguen exigiendo unidad, quien recibe y la foto: la foto se
--     toma sin internet y se adjunta al cargar.
--   · Las devoluciones y los conteos se registran en el kardex, no por planilla.
--
-- Sin DROP: el servidor de Supabase pide confirmarlo y la sesión que aplica la
-- migración se queda colgada (ver la skill `datos`).

-- 1. De dónde vino cada movimiento y cuándo se cargó --------------------------
alter table public.movimientos_materiales add column if not exists desde_planilla boolean not null default false;
alter table public.movimientos_materiales add column if not exists cargado_en timestamptz;
update public.movimientos_materiales set cargado_en = registrado_en where cargado_en is null;
alter table public.movimientos_materiales alter column cargado_en set default now();
alter table public.movimientos_materiales alter column cargado_en set not null;
comment on column public.movimientos_materiales.registrado_en is
  'Cuándo ocurrió el movimiento. En los cargados por planilla, la fecha anotada en ella.';
comment on column public.movimientos_materiales.cargado_en is
  'Cuándo entró al sistema. Igual a registrado_en salvo en los cargados por planilla.';

-- 2. La fecha que trae la planilla --------------------------------------------
create or replace function public.validar_fecha_planilla_almacen(p_material uuid, p_fecha timestamptz)
returns void language plpgsql stable set search_path = 'public' as $$
declare v_conteo timestamptz;
begin
  if p_fecha is null or p_fecha > now() + interval '5 minutes' then
    raise exception 'La fecha del movimiento no puede ser posterior a hoy.';
  end if;
  if p_fecha < now() - interval '31 days' then
    raise exception 'La planilla carga movimientos de los últimos 31 días. Lo anterior regularízalo con un conteo físico.';
  end if;
  select max(c.registrado_en) into v_conteo from public.conteos_inventario c where c.material_id = p_material;
  if v_conteo is not null and p_fecha < v_conteo then
    raise exception 'Este material se contó el %: un movimiento de antes del conteo ya está dentro de ese saldo. Si falta, corrígelo con un nuevo conteo.',
      to_char(v_conteo at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI');
  end if;
end $$;
revoke all on function public.validar_fecha_planilla_almacen(uuid, timestamptz) from public, anon, authenticated;

-- 3. Ingreso desde la planilla -------------------------------------------------
-- Pasa por registrar_ingreso_almacen (permiso, material activo, cantidad,
-- documento, el mismo identificador devuelve lo mismo) y después le pone su fecha.
create or replace function public.registrar_ingreso_planilla(p_id uuid, p_material uuid, p_cantidad numeric, p_origen text,
  p_documento text, p_precio numeric, p_moneda text, p_fecha timestamptz)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_existente public.movimientos_materiales%rowtype; v_id uuid;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_origen is null or p_origen not in ('INGRESO_GENERAL', 'SALDO_INICIAL') then
    raise exception 'La planilla carga ingresos generales y saldos iniciales. Las devoluciones se registran en el kardex.';
  end if;
  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    -- Volver a cargar la misma planilla no duplica: la misma fila devuelve lo mismo.
    v_id := public.registrar_ingreso_almacen(p_id, p_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, null);
    if not v_existente.desde_planilla or v_existente.registrado_en <> p_fecha then
      raise exception 'Ese ingreso ya se cargó con otra fecha. Revisa la planilla.';
    end if;
    return v_id;
  end if;
  perform public.validar_fecha_planilla_almacen(p_material, p_fecha);
  v_id := public.registrar_ingreso_almacen(p_id, p_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, null);
  update public.movimientos_materiales set registrado_en = p_fecha, desde_planilla = true where id = v_id;
  return v_id;
end $$;
revoke all on function public.registrar_ingreso_planilla(uuid, uuid, numeric, text, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.registrar_ingreso_planilla(uuid, uuid, numeric, text, text, numeric, text, timestamptz) to authenticated;

-- 4. Salida desde la planilla --------------------------------------------------
-- Pasa por registrar_salida_almacen: unidad o código, quien recibe, la foto
-- ya subida y el saldo libre de hoy. Después le pone su fecha.
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
  v_id := public.registrar_salida_almacen(p_id, p_material, p_cantidad, null, p_codigo, p_motivo, p_recibe, p_foto);
  update public.movimientos_materiales set registrado_en = p_fecha, desde_planilla = true where id = v_id;
  return v_id;
end $$;
revoke all on function public.registrar_salida_planilla(uuid, uuid, numeric, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.registrar_salida_planilla(uuid, uuid, numeric, text, text, text, text, timestamptz) to authenticated;

-- 5. El kardex dice qué vino de una planilla y cuándo se cargó ---------------
-- Mismas columnas que antes y dos más al final.
create or replace view public.v_kardex_almacen with (security_invoker = true) as
 WITH eventos AS (
         SELECT m.id,
            m.registrado_en AS fecha,
            m.material_id,
            m.tipo AS movimiento,
            m.origen,
                CASE
                    WHEN m.tipo = 'INGRESO'::text THEN m.cantidad::numeric
                    ELSE 0::numeric
                END AS entrada,
                CASE
                    WHEN m.tipo <> 'INGRESO'::text THEN m.cantidad::numeric
                    ELSE 0::numeric
                END AS salida,
            m.documento_referencia AS documento,
            m.unidad_id,
            m.codigo_unidad,
            m.orden_id,
            m.recibido_por_nombre,
            m.registrado_por,
            m.precio_unitario,
            m.moneda,
            m.foto_ruta IS NOT NULL AS con_foto,
            m.devolucion_de,
            m.desde_planilla,
            m.cargado_en
           FROM movimientos_materiales m
        UNION ALL
         SELECT c.id,
            c.registrado_en,
            c.material_id,
            'AJUSTE'::text,
            'CONTEO'::text,
            GREATEST(c.ajuste, 0::numeric) AS "greatest",
            GREATEST(- c.ajuste, 0::numeric) AS "greatest",
            c.motivo,
            NULL::uuid,
            NULL::text,
            NULL::uuid,
            NULL::text,
            c.registrado_por,
            NULL::numeric,
            NULL::text,
            false,
            NULL::uuid,
            false,
            c.registrado_en
           FROM conteos_inventario c
        ), con_saldo AS (
         SELECT e.id,
            e.fecha,
            e.material_id,
            e.movimiento,
            e.origen,
            e.entrada,
            e.salida,
            e.documento,
            e.unidad_id,
            e.codigo_unidad,
            e.orden_id,
            e.recibido_por_nombre,
            e.registrado_por,
            e.precio_unitario,
            e.moneda,
            e.con_foto,
            e.devolucion_de,
            e.desde_planilla,
            e.cargado_en,
            sum(e.entrada - e.salida) OVER (PARTITION BY e.material_id ORDER BY e.fecha, e.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo
           FROM eventos e
        )
 SELECT k.id,
    k.fecha,
    k.material_id,
    mat.codigo AS material_codigo,
    mat.descripcion AS material,
    um.codigo AS unidad_medida,
    k.movimiento,
    k.origen,
    k.entrada,
    k.salida,
    k.saldo,
    k.documento,
    k.unidad_id,
    k.codigo_unidad,
    k.orden_id,
    ot.numero AS orden_numero,
    k.recibido_por_nombre,
    k.registrado_por,
    NULLIF(btrim(concat_ws(' '::text, us.nombres, us.apellidos)), ''::text) AS registrado_por_nombre,
    k.precio_unitario,
    k.moneda,
    k.con_foto,
    k.devolucion_de,
    k.desde_planilla,
    k.cargado_en
   FROM con_saldo k
     LEFT JOIN materiales mat ON mat.id = k.material_id
     LEFT JOIN unidades_medida um ON um.id = mat.unidad_medida_id
     LEFT JOIN ordenes_trabajo ot ON ot.id = k.orden_id
     LEFT JOIN usuarios us ON us.id = k.registrado_por;
