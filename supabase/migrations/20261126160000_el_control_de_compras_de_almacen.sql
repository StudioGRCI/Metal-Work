-- =============================================================================
-- EL CONTROL DE COMPRAS DE ALMACÉN
-- -----------------------------------------------------------------------------
-- Almacén lleva en Excel el «CONTROL DE FACTURAS 2026», una hoja por moneda y un
-- bloque por día: cada OC y OS que salió ese día, qué se compró, el proveedor,
-- a qué unidad o código va (o si es para stock), el comprobante con su número,
-- el monto, y dos casillas: «Recepción de Almacén» (llegó el material y Almacén
-- recibió la factura y la guía) y «Recepción de Tesorería». El encargado de
-- Almacén lo llama «el más importante» y pide que salga solo de la orden de
-- compra, con lo que se compró, el destino, el precio, el proveedor y el peso, y
-- que él solo marque lo que recibe (25/11/2026).
--
-- Casi todo eso ya está en el sistema: la OC y la OS con su proveedor, su total
-- y su código; el peso que programa Logística; lo que entró al kardex por cada
-- línea de la OC; el comprobante que registra Contabilidad. Lo que no estaba es
-- lo que solo Almacén sabe: que la factura y la guía del proveedor le llegaron,
-- con qué número, y la nota de la fila («FALTA GUÍA», «N/C …»).
--
--   · `recepcion_documentos_compra`: una fila por OC u OS con la factura y la
--     guía que recibió Almacén, quién y cuándo, y su observación. Se escribe
--     solo por `anotar_documentos_recibidos`, que exige `almacen.recibir`, el
--     mismo permiso con que Almacén verifica lo que llega. No es un documento
--     numerado: es una marca, y se corrige; la auditoría guarda cada cambio.
--     La pantalla manda cuándo cambió la fila que mostró: si otra pantalla la
--     cambió después, no se pisa lo que anotó la otra.
--   · `control_de_compras_almacen(desde, hasta)`: cada OC y OS no rechazada ni
--     anulada, del día en que se emitió, con lo de arriba. El material se cuenta
--     por línea con `cuenta_de_la_linea_de_compra`, la misma cuenta de todo el
--     sistema: entra lo que llegó por el ingreso que verifica Almacén y por la
--     recepción directa, y resta lo devuelto al proveedor. La ven Almacén
--     (`almacen.ver`), Contabilidad (`adquisiciones.ver`) y Tesorería
--     (`tesoreria.ver_documentos`). Sin fechas, todas.
--
-- El estado del pago no sale aquí: lo decide `trazabilidad_de_compras`, que es
-- de Adquisiciones, y una cuenta propia podría contradecirla. Lo que sí sale es
-- el comprobante registrado (`facturas_de_la_compra`, la misma de
-- Adquisiciones), que es lo que en el Excel marca «Recepción de Tesorería».
--
-- Idempotente. Sin `drop` de nada que tenga datos: las dos funciones se sueltan
-- antes de crearse porque cambiaron de firma mientras se probaban.
-- =============================================================================

create table if not exists public.recepcion_documentos_compra (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid unique references public.ordenes_compra_materiales(id),
  orden_servicio_id uuid unique references public.ordenes_servicio(id),
  factura_numero text,
  factura_recibida_en timestamptz,
  factura_recibida_por uuid references public.usuarios(id),
  guia_numero text,
  guia_recibida_en timestamptz,
  guia_recibida_por uuid references public.usuarios(id),
  observacion text,
  actualizado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint recepcion_documentos_compra_una_orden
    check ((orden_compra_id is null) <> (orden_servicio_id is null)),
  constraint recepcion_documentos_compra_factura
    check ((factura_numero is null) = (factura_recibida_en is null)
           and (factura_numero is null or char_length(factura_numero) between 3 and 40)),
  constraint recepcion_documentos_compra_guia
    check ((guia_numero is null) = (guia_recibida_en is null)
           and (guia_numero is null or char_length(guia_numero) between 3 and 40)),
  constraint recepcion_documentos_compra_observacion
    check (observacion is null or char_length(observacion) between 1 and 500)
);

comment on table public.recepcion_documentos_compra is
  'Lo que Almacén recibió de cada OC u OS: la factura y la guía del proveedor, con su número, y la nota de la fila del CONTROL DE FACTURAS. Se escribe solo con anotar_documentos_recibidos (almacen.recibir).';

-- Las llaves a usuarios no llevan índice: ninguna pantalla filtra por ellas y
-- una cuenta no se borra. Las de la orden ya lo tienen por su `unique`.

select public.activar_timestamps('recepcion_documentos_compra');
select public.activar_auditoria('recepcion_documentos_compra');
select public.activar_registro_de_prueba('recepcion_documentos_compra');

alter table public.recepcion_documentos_compra enable row level security;

drop policy if exists ver_recepcion_documentos_compra on public.recepcion_documentos_compra;
create policy ver_recepcion_documentos_compra on public.recepcion_documentos_compra
  for select to authenticated using (
    (select public.es_admin()) or (select public.tiene_permiso('almacen.ver'))
    or (select public.tiene_permiso('adquisiciones.ver')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
  );

-- Nadie escribe directo, y por eso no hay políticas de escritura: sin `grant`
-- de insert ni update, la única puerta es la función, que valida la orden, el
-- número y la persona.
revoke all on public.recepcion_documentos_compra from public, anon, authenticated;
grant select on public.recepcion_documentos_compra to authenticated;

-- -----------------------------------------------------------------------------
-- Anotar lo que llegó. Con la factura o la guía vacías se quita esa marca (se
-- marcó en la fila que no era). `p_mostrado` es cuándo cambió por última vez la
-- fila que la pantalla mostró (vacío si no había ninguna): si cambió después,
-- otra pantalla anotó algo que esta no vio, y guardar lo pisaría. Devuelve el
-- id de la fila: la acción comprueba que lo recibió, para no decir «listo» si
-- no se guardó nada.
-- -----------------------------------------------------------------------------
drop function if exists public.anotar_documentos_recibidos(uuid, uuid, text, text, text);
drop function if exists public.anotar_documentos_recibidos(uuid, uuid, text, text, text, timestamptz);
create function public.anotar_documentos_recibidos(
  p_orden_compra uuid,
  p_orden_servicio uuid,
  p_factura text,
  p_guia text,
  p_observacion text,
  p_mostrado timestamptz
)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo constant uuid := public.usuario_actual();
  v_factura text := nullif(upper(regexp_replace(btrim(coalesce(p_factura, '')), '\s+', '', 'g')), '');
  v_guia text := nullif(upper(regexp_replace(btrim(coalesce(p_guia, '')), '\s+', ' ', 'g')), '');
  v_observacion text := nullif(btrim(regexp_replace(coalesce(p_observacion, ''), '\s+', ' ', 'g')), '');
  v_nombre text;
  v_fila public.recepcion_documentos_compra;
begin
  perform public.exigir_permiso('almacen.recibir');

  if (p_orden_compra is null) = (p_orden_servicio is null) then
    raise exception 'Elige una orden de compra o una orden de servicio.' using errcode = 'check_violation';
  end if;

  if p_orden_compra is not null then
    select public.nombre_de_oc(c.numero, c.referencia) into v_nombre
      from public.ordenes_compra_materiales c
     where c.id = p_orden_compra and c.anulada_en is null and c.aprobacion not in ('RECHAZADA', 'ANULADA');
    if not found then
      raise exception 'Esa orden de compra no existe, o está anulada o rechazada.' using errcode = 'check_violation';
    end if;
  else
    select coalesce(s.numero, 'La OS') into v_nombre
      from public.ordenes_servicio s
     where s.id = p_orden_servicio and s.anulado_en is null and s.estado <> 'ANULADA' and s.aprobacion <> 'RECHAZADA';
    if not found then
      raise exception 'Esa orden de servicio no existe, o está anulada o rechazada.' using errcode = 'check_violation';
    end if;
  end if;

  -- La factura como la trae el proveedor (F001-123, E001-45, B002-9): la serie de
  -- cuatro y el número. La guía puede venir de varias formas (T001-…, EG07-…).
  -- El comprobante en papel lleva la serie en números (0001-123): también vale,
  -- con el número sin los ceros de adelante, como el electrónico.
  if v_factura is not null then
    if public.normalizar_numero_factura(v_factura) is not null then
      v_factura := public.normalizar_numero_factura(v_factura);
    elsif v_factura ~ '^[0-9]{4}-[0-9]{1,10}$' then
      v_factura := split_part(v_factura, '-', 1) || '-' || coalesce(nullif(ltrim(split_part(v_factura, '-', 2), '0'), ''), '0');
    else
      raise exception 'Escribe el comprobante como lo trae el proveedor: la serie de 4 y el número, por ejemplo F001-0123, o 0001-123 si es en papel.'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_guia is not null and char_length(v_guia) not between 3 and 40 then
    raise exception 'La guía va con su serie y su número, de 3 a 40 caracteres, por ejemplo T001-0456.'
      using errcode = 'check_violation';
  end if;
  if v_observacion is not null and char_length(v_observacion) > 500 then
    raise exception 'La observación de % pasa de 500 caracteres.', v_nombre using errcode = 'check_violation';
  end if;

  select * into v_fila from public.recepcion_documentos_compra r
   where r.orden_compra_id is not distinct from p_orden_compra
     and r.orden_servicio_id is not distinct from p_orden_servicio
   for update;

  if found then
    -- Lo mismo otra vez (la respuesta se perdió, o dos toques): ya está.
    if (v_fila.factura_numero, v_fila.guia_numero, v_fila.observacion) is not distinct from (v_factura, v_guia, v_observacion) then
      return v_fila.id;
    end if;
    if p_mostrado is distinct from v_fila.actualizado_en then
      raise exception 'Lo recibido de % cambió después de que lo abriste: ahora dice factura % y guía %. Mira lo de ahora y vuelve a anotarlo.',
        v_nombre, coalesce(v_fila.factura_numero, 'sin anotar'), coalesce(v_fila.guia_numero, 'sin anotar')
        using errcode = 'check_violation';
    end if;
  else
    if p_mostrado is not null then
      raise exception 'Lo recibido de % cambió después de que lo abriste. Mira lo de ahora y vuelve a anotarlo.', v_nombre
        using errcode = 'check_violation';
    end if;
    insert into public.recepcion_documentos_compra
      (orden_compra_id, orden_servicio_id, factura_numero, factura_recibida_en, factura_recibida_por,
       guia_numero, guia_recibida_en, guia_recibida_por, observacion, actualizado_por)
    values (p_orden_compra, p_orden_servicio,
            v_factura, case when v_factura is not null then now() end, case when v_factura is not null then v_yo end,
            v_guia, case when v_guia is not null then now() end, case when v_guia is not null then v_yo end,
            v_observacion, v_yo)
    on conflict do nothing
    returning * into v_fila;
    if v_fila.id is not null then
      return v_fila.id;
    end if;
    -- Otra pantalla la creó en el mismo instante: si es lo mismo, ya está; si no, se dice.
    select * into v_fila from public.recepcion_documentos_compra r
     where r.orden_compra_id is not distinct from p_orden_compra
       and r.orden_servicio_id is not distinct from p_orden_servicio;
    if (v_fila.factura_numero, v_fila.guia_numero, v_fila.observacion) is not distinct from (v_factura, v_guia, v_observacion) then
      return v_fila.id;
    end if;
    raise exception 'Lo recibido de % cambió después de que lo abriste: ahora dice factura % y guía %. Mira lo de ahora y vuelve a anotarlo.',
      v_nombre, coalesce(v_fila.factura_numero, 'sin anotar'), coalesce(v_fila.guia_numero, 'sin anotar')
      using errcode = 'check_violation';
  end if;

  -- La fecha y quién recibió cambian solo si cambió el número: corregir la nota
  -- no mueve cuándo llegó la factura.
  update public.recepcion_documentos_compra r set
    factura_numero = v_factura,
    factura_recibida_en = case when v_factura is null then null
                               when v_factura is distinct from v_fila.factura_numero then now()
                               else r.factura_recibida_en end,
    factura_recibida_por = case when v_factura is null then null
                                when v_factura is distinct from v_fila.factura_numero then v_yo
                                else r.factura_recibida_por end,
    guia_numero = v_guia,
    guia_recibida_en = case when v_guia is null then null
                            when v_guia is distinct from v_fila.guia_numero then now()
                            else r.guia_recibida_en end,
    guia_recibida_por = case when v_guia is null then null
                             when v_guia is distinct from v_fila.guia_numero then v_yo
                             else r.guia_recibida_por end,
    observacion = v_observacion,
    actualizado_por = v_yo
   where r.id = v_fila.id;

  return v_fila.id;
end;
$$;

revoke all on function public.anotar_documentos_recibidos(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.anotar_documentos_recibidos(uuid, uuid, text, text, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- El control, una fila por OC u OS. El día es el de su emisión, en Lima.
--
-- material: POR_APROBAR (Gerencia todavía no la aprueba: no salió al proveedor),
-- EN_CAMINO, POR_VALIDAR (la dejaron en el almacén y falta verificarla),
-- OBSERVADO (Almacén la observó y no entró nada), PARCIAL (entró una parte),
-- LLEGO (entró todo lo pedido en cada línea, descontado lo devuelto) y
-- NO_APLICA (la OS).
-- -----------------------------------------------------------------------------
drop function if exists public.control_de_compras_almacen(date, date);
create function public.control_de_compras_almacen(p_desde date, p_hasta date)
returns table (
  tipo text,
  id uuid,
  numero text,
  referencia text,
  fecha date,
  descripcion text,
  proveedor text,
  destino text,
  moneda text,
  total numeric,
  peso_kg numeric,
  aprobacion text,
  material text,
  material_en timestamptz,
  factura_numero text,
  factura_recibida_en timestamptz,
  guia_numero text,
  guia_recibida_en timestamptz,
  observacion text,
  recibio text,
  recepcion_actualizada_en timestamptz,
  comprobante_registrado text
)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  -- Sin sesión es una conexión directa a la base (una migración, una consulta
  -- de mantenimiento), como en `exigir_permiso`; `anon` no la ejecuta.
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('almacen.ver') or public.tiene_permiso('adquisiciones.ver')
              or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'No tienes permiso para ver el control de compras de Almacén.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select 'OC'::text, c.id, c.numero, c.referencia,
         (c.creado_en at time zone 'America/Lima')::date,
         d.descripcion,
         c.proveedor,
         coalesce(nullif(c.codigo_interno, ''), rq.codigos, rv.ordenes, 'STOCK'),
         c.moneda,
         public.total_orden_compra(c.id),
         pr.peso_kg,
         c.aprobacion,
         case when c.aprobacion = 'POR_APROBAR' then 'POR_APROBAR'
              when ln.lineas > 0 and ln.completas = ln.lineas then 'LLEGO'
              when ln.alguna then 'PARCIAL'
              when ig.pendiente then 'POR_VALIDAR'
              -- Observar no borra que se dejó: lo observado va antes que «dejada».
              when ig.observado then 'OBSERVADO'
              when c.entregado_almacen_en is not null then 'POR_VALIDAR'
              else 'EN_CAMINO' end,
         case when ln.lineas > 0 and ln.completas = ln.lineas then ln.ultimo end,
         r.factura_numero, r.factura_recibida_en, r.guia_numero, r.guia_recibida_en, r.observacion,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         r.actualizado_en,
         cp.numeros
    from public.ordenes_compra_materiales c
    left join public.recepcion_documentos_compra r on r.orden_compra_id = c.id
    left join public.usuarios u on u.id = coalesce(r.factura_recibida_por, r.guia_recibida_por, r.actualizado_por)
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join lateral (
      -- Una descripción por línea de la OC, aunque la línea atienda varios RQ.
      select left(string_agg(coalesce(m.descripcion, l.descripcion, 'Material sin nombre'), ' · '
                             order by coalesce(m.descripcion, l.descripcion)), 400) as descripcion
        from public.orden_compra_material_detalles x
        left join public.materiales m on m.id = x.material_id
        left join lateral (
          select rl.descripcion from public.requerimiento_lineas rl
           where rl.orden_compra_detalle_id = x.id and rl.descripcion is not null
           order by rl.descripcion limit 1
        ) l on true
       where x.orden_compra_id = c.id
    ) d on true
    -- Cada línea, con lo que entró por ella (ingreso verificado o recepción
    -- directa) menos lo devuelto al proveedor.
    left join lateral (
      select count(*) as lineas,
             -- Lo devuelto sin reposición (con nota de crédito) ya no va a llegar:
             -- cuenta como cerrado, como en la validación del ingreso.
             count(*) filter (where k.neto + k.sin_reponer >= x.cantidad) as completas,
             coalesce(bool_or(k.neto > 0), false) as alguna,
             (select max(m.registrado_en) from public.movimientos_materiales m
               join public.orden_compra_material_detalles y on y.id = m.orden_compra_detalle_id
              where y.orden_compra_id = c.id and m.tipo = 'INGRESO') as ultimo
        from public.orden_compra_material_detalles x
        cross join lateral public.cuenta_de_la_linea_de_compra(x.id) k
       where x.orden_compra_id = c.id
    ) ln on true
    -- El código interno de los RQ que atiende (PLANTA es el suyo: va a planta).
    left join lateral (
      select string_agg(distinct q.codigo_interno, ', ') as codigos
        from public.requerimiento_lineas l
        join public.requerimientos q on q.id = l.requerimiento_id
       where l.orden_compra_id = c.id and nullif(q.codigo_interno, '') is not null
    ) rq on true
    -- El RQ de antes iba por OT.
    left join lateral (
      select string_agg(distinct o.numero, ', ') as ordenes
        from public.requerimientos_materiales rm
        join public.ordenes_trabajo o on o.id = rm.orden_id
       where rm.id = c.requerimiento_id
          or rm.id in (select x.requerimiento_id from public.orden_compra_material_detalles x where x.orden_compra_id = c.id)
    ) rv on true
    left join lateral (
      select coalesce(bool_or(i.estado = 'PENDIENTE'), false) as pendiente,
             coalesce(bool_or(i.estado = 'OBSERVADO'), false) as observado
        from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id
    ) ig on true
    -- El comprobante registrado de la OC: ligado, anexado o el suyo propio,
    -- como lo cuenta Adquisiciones.
    left join lateral (
      select string_agg(distinct a.numero_documento, ', ') as numeros
        from public.facturas_de_la_compra(c.id) f
        join public.adquisiciones a on a.id = f.adquisicion_id
    ) cp on true
   where c.anulada_en is null
     and c.aprobacion not in ('RECHAZADA', 'ANULADA')
     and (p_desde is null or (c.creado_en at time zone 'America/Lima')::date >= p_desde)
     and (p_hasta is null or (c.creado_en at time zone 'America/Lima')::date <= p_hasta)

  union all

  select 'OS'::text, s.id, s.numero, s.referencia,
         (s.creado_en at time zone 'America/Lima')::date,
         left(s.descripcion, 400),
         s.proveedor,
         coalesce(nullif(s.codigo_interno, ''), o.numero, ar.nombre, 'PLANTA'),
         s.moneda,
         round(s.monto * 1.18, 2),
         null::numeric,
         s.aprobacion,
         case when s.aprobacion = 'POR_APROBAR' then 'POR_APROBAR' else 'NO_APLICA' end,
         null::timestamptz,
         r.factura_numero, r.factura_recibida_en, r.guia_numero, r.guia_recibida_en, r.observacion,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         r.actualizado_en,
         cp.numeros
    from public.ordenes_servicio s
    left join public.recepcion_documentos_compra r on r.orden_servicio_id = s.id
    left join public.usuarios u on u.id = coalesce(r.factura_recibida_por, r.guia_recibida_por, r.actualizado_por)
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.areas ar on ar.id = s.area_id
    -- El comprobante que se adjuntó a la OS (Logística o Tesorería).
    left join lateral (
      select string_agg(distinct x.numero, ', ') as numeros
        from public.documentos_orden_servicio x
       where x.orden_servicio_id = s.id and x.anulado_en is null and x.tipo in ('FACTURA', 'BOLETA', 'RECIBO')
    ) cp on true
   where s.anulado_en is null
     and s.estado <> 'ANULADA'
     and s.aprobacion <> 'RECHAZADA'
     and (p_desde is null or (s.creado_en at time zone 'America/Lima')::date >= p_desde)
     and (p_hasta is null or (s.creado_en at time zone 'America/Lima')::date <= p_hasta);
end;
$$;

comment on function public.control_de_compras_almacen(date, date) is
  'El CONTROL DE FACTURAS de Almacén: cada OC y OS no rechazada ni anulada, del día de su emisión (Lima), con lo que Almacén recibió. numero y referencia van aparte: la pantalla nombra la OC con nombreDeOc. material: POR_APROBAR, EN_CAMINO, POR_VALIDAR, OBSERVADO, PARCIAL, LLEGO o NO_APLICA (la OS). recepcion_actualizada_en es lo que la pantalla devuelve a anotar_documentos_recibidos. Sin el estado del pago, que es de trazabilidad_de_compras.';

revoke all on function public.control_de_compras_almacen(date, date) from public, anon;
grant execute on function public.control_de_compras_almacen(date, date) to authenticated;
