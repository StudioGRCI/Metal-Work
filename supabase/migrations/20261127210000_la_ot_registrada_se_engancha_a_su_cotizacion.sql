-- =============================================================================
-- LA OT YA REGISTRADA SE ENGANCHA A SU COTIZACIÓN
-- -----------------------------------------------------------------------------
-- A veces la OT llega antes que su cotización: el taller necesita empezar y
-- Administración registra la OT sin cotización, con el número de su papel. Días
-- después Ventas sube la cotización de ese mismo vehículo y Gerencia la aprueba.
-- La cotización queda «esperando su OT», y hasta aquí había dos salidas, las dos
-- malas: cargar otra OT para la misma unidad (dos OT del mismo trabajo, el costeo
-- partido en dos) o dejar la cotización sin OT para siempre (no se factura por
-- unidad, Facturación dice «Falta su OT»). Con sesión, la cotización de una OT
-- cambia solo con «Editar OT / cambiar cliente», y solo hacia la cotización de
-- OTRO cliente (20261127003000): no había camino para la del mismo cliente.
--
-- StudioGRCI lo pidió el 2026-11-27 («Sí, hazlo»). Quedó fuera de la entrega 3
-- de «Facturar por unidad cotizada» (#299) y de «Cerrar la venta que pasó a otro
-- comprador» (#289). Desde aquí:
--
--   · Administración (`ordenes.crear`, quien carga las OT de las cotizaciones)
--     engancha una OT ya registrada a la cotización aprobada de su mismo
--     cliente y su misma carrocería, en una de sus unidades libres, con un
--     motivo (`enganchar_ot_a_su_cotizacion`). Es lo mismo que cargar la OT de
--     esa unidad, sin crear otra: la unidad cuenta como cargada, Contabilidad la
--     factura y el costeo reparte la venta como en cualquier otra.
--   · La unidad la elige Administración, como en la carga (#299); sin elegir,
--     la primera libre. Las mismas reglas que la carga: ni una unidad con OT
--     vigente, ni una que pasó a otro comprador, ni una cotización llena.
--   · Queda dicho en la bitácora de la OT («Trazabilidad»), con la cotización,
--     la unidad, el motivo, quién y cuándo, y Ventas (quien registró la
--     cotización) recibe el aviso de que su cotización ya tiene su OT.
--   · Entra la OT que está viva, aprobada y es una venta: no la que espera el
--     visto de Gerencia o la revisión del taller (la que nace de la carga nace
--     aprobada, y la enganchada cuenta igual para la factura), ni la entregada,
--     facturada o anulada, ni la de garantía o mantenimiento, ni la que no
--     tiene unidad (la cotización se factura por unidad y a una OT no se le
--     pone una unidad después: 20261127183500), ni la de un vehículo que ya es
--     el de otra OT de la cotización.
--   · La OT de otro cliente sigue yendo por «Editar OT / cambiar cliente», que
--     anota su venta anterior. La que ya es de una cotización no se mueve aquí.
--
-- `ots_para_enganchar` le dice a la pantalla qué OT puede enganchar a cada
-- cotización, con las mismas reglas.
--
-- El disparador que toma la unidad libre al pasar la OT a otro comprador
-- (`fn_ot_a_otra_venta_toma_la_unidad_libre`, 20261127003000) es la única puerta
-- para cambiar la cotización de una OT con sesión. Se le suma un segundo camino,
-- marcado por esta función en `metalwork.enganche_de_ot`: la OT sin cotización
-- que se engancha toma la unidad que eligió Administración (`metalwork.
-- enganche_unidad`), ya comprobada aquí. Todo lo demás de ese disparador queda
-- igual; `fn_ot_cabe_en_su_cotizacion` vuelve a juzgar la unidad, la cotización
-- llena y el código repetido.
--
-- En producción, el 2026-11-27: 21 OT, todas con cotización. Nada que arreglar
-- en los datos; el camino queda listo para la próxima OT que llegue antes.
--
-- `fn_ot_a_otra_venta_toma_la_unidad_libre` es la de la 20261127003000; se
-- comparó con producción el 2026-11-27 y se reemplaza solo si sigue siendo esa
-- (o ya es la de esta migración). `create or replace` conserva sus permisos.
--
-- Nada se borra. Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.fn_ot_a_otra_venta_toma_la_unidad_libre()');
  if huella is null then
    raise exception 'Falta la función public.fn_ot_a_otra_venta_toma_la_unidad_libre(): esta base no tiene las migraciones anteriores.';
  end if;
  if not (huella = any (array['79b49f6f2c7ba6ad482f53b7c8ee5983', 'eae564bca1da5c5ea8d450f9da07b5bc'])) then
    raise exception 'La función public.fn_ot_a_otra_venta_toma_la_unidad_libre() no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

-- 1. El disparador de la cotización de la OT: el camino del enganche --------------
-- La de la 20261127003000 con un cambio: sin la marca del traspaso, la OT que no
-- tenía cotización y trae la marca del enganche toma la unidad que eligió
-- Administración y no se le toca la descripción (la escribió quien la registró).
create or replace function public.fn_ot_a_otra_venta_toma_la_unidad_libre()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cantidad integer;
  v_numero   text;
  v_de_antes text;
  v_base     text;
  v_ocupadas integer[];
  v_antes    integer;
  v_n        integer;
begin
  if new.cotizacion_pdf_id is not distinct from old.cotizacion_pdf_id then
    return new;
  end if;
  -- La marca se mira antes que todo lo demás: quitarle la cotización y ponerle
  -- otra en dos pasos, o anularla y cambiarla en el mismo, también la movían
  -- sin venta anterior (lo vieron los dos auditores en la segunda vuelta).
  if coalesce(current_setting('metalwork.traspaso_de_ot', true), '') is distinct from new.id::text then
    -- El enganche de la OT ya registrada a su cotización (20261127210000): solo
    -- la que no tenía ninguna, y con la unidad que la función ya comprobó.
    if old.cotizacion_pdf_id is null and new.cotizacion_pdf_id is not null
       and coalesce(current_setting('metalwork.enganche_de_ot', true), '') = new.id::text
       and coalesce(current_setting('metalwork.enganche_unidad', true), '') ~ '^\d{1,2}$' then
      new.numero_de_unidad := current_setting('metalwork.enganche_unidad', true)::smallint;
      return new;
    end if;
    if public.usuario_actual() is not null then
      raise exception 'La OT % cambia de cotización solo con «Editar OT / cambiar cliente»: así queda anotada su venta anterior, con su historial.', old.numero
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.cotizacion_pdf_id is null or new.estado = 'ANULADA' then
    return new;
  end if;

  select c.cantidad_unidades, c.numero into v_cantidad, v_numero
    from public.cotizaciones_pdf c
   where c.id = new.cotizacion_pdf_id
     for update;
  if not found then
    return new;  -- la llave foránea lo dice
  end if;

  -- Las unidades que tienen OT vigente y las que pasaron a otro comprador,
  -- menos esta misma OT si vuelve a una cotización de la que había salido.
  select coalesce(array_agg(x.k), '{}') into v_ocupadas
    from (select coalesce(o.numero_de_unidad, 1)::integer as k
            from public.ordenes_trabajo o
           where o.cotizacion_pdf_id = new.cotizacion_pdf_id and o.estado <> 'ANULADA' and o.id <> new.id
          union
          select public.unidad_que_dejo_la_ot(s.orden_id, new.cotizacion_pdf_id)
            from public.salidas_de_la_cotizacion(new.cotizacion_pdf_id, new.id) s) x;

  -- Vuelve a una cotización donde ya estuvo: la unidad que tenía, si sigue libre.
  if exists (select 1 from public.ot_ventas_anteriores va
              where va.orden_id = new.id and va.cotizacion_pdf_id = new.cotizacion_pdf_id) then
    v_antes := public.unidad_que_dejo_la_ot(new.id, new.cotizacion_pdf_id);
  end if;
  if v_antes between 1 and v_cantidad and not (v_antes = any (v_ocupadas)) then
    v_n := v_antes;
  else
    select k into v_n
      from generate_series(1, v_cantidad) k
     where not (k = any (v_ocupadas))
     order by exists (select 1
                        from public.facturas_venta_unidades p
                        join public.facturas_venta f on f.id = p.factura_id
                       where f.cotizacion_pdf_id = new.cotizacion_pdf_id and f.anulada_en is null
                         and p.numero_de_unidad = k
                         and (select count(*) from public.facturas_venta_unidades x where x.factura_id = f.id) = 1),
              k
     limit 1;
  end if;
  new.numero_de_unidad := v_n;

  -- La descripción que armó la carga dice de qué cotización y qué unidad era.
  -- Solo si termina como la deja la carga: «… cotización X» o «… cotización X ·
  -- unidad n de m». Lo escrito a mano que nombra la cotización en otra parte
  -- no se toca, ni lo que sigue después de la unidad.
  select c.numero into v_de_antes from public.cotizaciones_pdf c where c.id = old.cotizacion_pdf_id;
  v_base := regexp_replace(coalesce(new.descripcion, ''), ' · unidad \d+ de \d+$', '');
  if v_n is not null and v_de_antes is not null
     and right(v_base, length('cotización ' || v_de_antes)) = 'cotización ' || v_de_antes then
    new.descripcion := left(v_base, length(v_base) - length(v_de_antes)) || v_numero
                       || case when v_cantidad > 1 then format(' · unidad %s de %s', v_n, v_cantidad) else '' end;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_a_otra_venta_toma_la_unidad_libre() from public, anon, authenticated;

-- 2. Qué OT puede enganchar Administración a cada cotización -----------------------
-- Las del mismo cliente, sin cotización, vivas (no la del taller por revisar), de venta, con unidad, de la
-- misma carrocería (o sin carrocería) y sin entrega: las mismas reglas que
-- `enganchar_ot_a_su_cotizacion`. Solo a quien carga las OT; a los demás, nada.
-- `version` es la de la OT, para que el enganche no pise un cambio de en medio.
create or replace function public.ots_para_enganchar(p_cotizaciones uuid[])
returns table (
  cotizacion_id  uuid,
  orden_id       uuid,
  numero         text,
  estado         text,
  tipo_trabajo   text,
  codigo_interno text,
  placa          text,
  descripcion    text,
  version        timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
rows 5
as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    return;
  end if;
  if coalesce(cardinality(p_cotizaciones), 0) = 0 or cardinality(p_cotizaciones) > 200 then
    return;
  end if;
  return query
  select c.id, o.id, o.numero::text, o.estado::text, o.tipo_trabajo::text, u.codigo_interno::text, u.placa::text, o.descripcion::text, o.actualizado_en
    from public.cotizaciones_pdf c
    join public.ordenes_trabajo o on o.cliente_id = c.cliente_id and o.cotizacion_pdf_id is null
    join public.unidades u on u.id = o.unidad_id
   where c.id = any (p_cotizaciones)
     and c.estado = 'APROBADA'
     and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
     -- Con el visto de Gerencia: la OT que nace de la carga nace aprobada, y la
     -- que se engancha cuenta igual para la factura.
     and o.estado <> 'BORRADOR'
     and o.tipo_trabajo not in ('GARANTIA', 'MANTENIMIENTO')
     and (o.tipo_carroceria_id is null or o.tipo_carroceria_id = c.tipo_carroceria_id)
     and not exists (select 1 from public.ot_entregas e where e.orden_id = o.id)
     -- Su vehículo no es ya el de otra OT de la cotización: el enganche lo
     -- rechazaría (`fn_ot_cabe_en_su_cotizacion`, cada unidad su código).
     and not exists (select 1 from public.ordenes_trabajo x
                       join public.unidades ux on ux.id = x.unidad_id
                      where x.cotizacion_pdf_id = c.id and x.estado <> 'ANULADA'
                        and public.normalizar_codigo_interno(ux.codigo_interno) = public.normalizar_codigo_interno(u.codigo_interno))
     and public.puede_ver_orden(o.id)
   order by c.id, o.creado_en desc, o.numero;
end;
$$;

comment on function public.ots_para_enganchar(uuid[]) is
  'Las OT ya registradas sin cotización que Administración (ordenes.crear) puede enganchar a cada cotización aprobada: mismo cliente, misma carrocería o sin ella, vivas, de venta, con unidad y sin entrega (migración 20261127210000).';

revoke all on function public.ots_para_enganchar(uuid[]) from public, anon;
grant execute on function public.ots_para_enganchar(uuid[]) to authenticated;

-- 3. Enganchar la OT ya registrada a su cotización ----------------------------------
-- Bloquea primero la cotización y después la OT, como la carga: dos
-- Administraciones que enganchan a la vez a la misma cotización se ponen en fila,
-- y la segunda ve la unidad ya tomada.
create or replace function public.enganchar_ot_a_su_cotizacion(
  p_orden      uuid,
  p_cotizacion uuid,
  p_unidad     integer,
  p_version    timestamptz,
  p_motivo     text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c          record;
  o          public.ordenes_trabajo%rowtype;
  v_motivo   constant text := btrim(coalesce(p_motivo, ''));
  v_vigentes integer;
  v_otra     text;
  v_salieron text[];
  v_n        integer;
  v_cual     text;
  v_quedan   integer;
  v_antes    jsonb;
begin
  if public.usuario_actual() is null then
    raise exception 'Inicia sesión.' using errcode = 'insufficient_privilege';
  end if;
  if not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'La OT ya registrada la engancha a su cotización Administración, que carga las OT.'
      using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 5 and 500 then
    raise exception 'Explica por qué esta OT es la de esa cotización (5 a 500 caracteres).' using errcode = 'check_violation';
  end if;

  -- La cotización ----------------------------------------------------------------
  select cp.*, cl.razon_social as cliente
    into c
    from public.cotizaciones_pdf cp
    left join public.clientes cl on cl.id = cp.cliente_id
   where cp.id = p_cotizacion
     for update of cp;
  if c.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'no_data_found';
  end if;
  if c.estado = 'POR_REVISAR' then
    raise exception 'La cotización % todavía no está aprobada: su OT se engancha cuando Gerencia la apruebe.', c.numero
      using errcode = 'check_violation';
  end if;
  if c.estado = 'RECHAZADA' then
    raise exception 'La cotización % está rechazada: Ventas sube la corrección y vuelve a aprobarse.', c.numero
      using errcode = 'check_violation';
  end if;
  if c.estado <> 'APROBADA' then
    raise exception 'La cotización % está anulada: no lleva OT.', c.numero using errcode = 'check_violation';
  end if;

  -- La OT --------------------------------------------------------------------------
  select * into o from public.ordenes_trabajo where id = p_orden for update;
  if o.id is null or not public.puede_ver_orden(p_orden) then
    raise exception 'No se encontró la OT.' using errcode = 'no_data_found';
  end if;
  -- La misma OT otra vez (la respuesta se perdió y se envió de nuevo): ya es de
  -- esta cotización por un enganche de quien la envía. Si es el mismo envío
  -- (la misma unidad, o sin elegirla, y el mismo motivo) se dice como
  -- duplicado, y la acción lo da por hecho. Si cambió algo, no es el mismo
  -- envío: se dice en qué unidad quedó y que lo cambiado no se guardó. Si llegó
  -- por otro camino (la carga, otra persona), se dice tal cual.
  if o.cotizacion_pdf_id = p_cotizacion then
    select b.datos into v_antes
      from public.ot_bitacora b
     where b.orden_id = o.id and b.usuario_id = public.usuario_actual()
       and (b.datos->>'enganche_a_cotizacion') = 'true'
       and (b.datos->>'cotizacion_pdf_id') = p_cotizacion::text
     order by b.creado_en desc
     limit 1;
    if v_antes is not null then
      if (p_unidad is null or p_unidad = (v_antes->>'unidad')::integer)
         and v_motivo = (v_antes->>'motivo') then
        raise exception 'La OT % ya quedó enganchada a la cotización % la primera vez que la enviaste.', o.numero, c.numero
          using errcode = 'unique_violation';
      end if;
      raise exception '%', format('La OT %s ya había quedado enganchada a la cotización %s%s la primera vez que la enviaste: lo que cambiaste al reenviar no se guardó.',
        o.numero, c.numero,
        case when c.cantidad_unidades > 1 then format(' como la unidad %s de %s', v_antes->>'unidad', c.cantidad_unidades) else '' end)
        using errcode = 'unique_violation';
    end if;
    raise exception 'La OT % ya es de la cotización %.', o.numero, c.numero using errcode = 'unique_violation';
  end if;
  if o.actualizado_en is distinct from p_version then
    -- Sin `serialization_failure`: `mensajeDeError` lo cambiaría por «otra
    -- persona guardaba algo a la vez», y esto dice qué hacer.
    raise exception 'La OT % cambió mientras la enganchabas. Recarga y revisa antes de guardar.', o.numero
      using errcode = 'check_violation';
  end if;
  if o.cotizacion_pdf_id is not null then
    raise exception 'La OT % ya es de otra cotización: no se engancha a una segunda. Si el vehículo pasó a otro comprador, Administración la pasa con «Editar OT / cambiar cliente».', o.numero
      using errcode = 'check_violation';
  end if;
  if o.estado = 'ANULADA' then
    raise exception 'La OT % está anulada: no se engancha a una cotización.', o.numero using errcode = 'check_violation';
  end if;
  if o.estado in ('ENTREGADA', 'FACTURADA') or exists (select 1 from public.ot_entregas e where e.orden_id = o.id) then
    raise exception 'La OT % ya tiene su entrega: no se engancha a una cotización después.', o.numero using errcode = 'check_violation';
  end if;
  if o.abierta_en_taller and o.estado = 'BORRADOR' then
    raise exception 'La OT % del taller todavía espera su revisión: Administración la aprueba primero y después la engancha.', o.numero
      using errcode = 'check_violation';
  end if;
  -- La OT que nace de la carga nace aprobada, y desde el enganche esta cuenta
  -- igual: la unidad queda con su OT y Contabilidad ya la puede facturar.
  if o.estado = 'BORRADOR' then
    raise exception 'La OT % todavía espera el visto de Gerencia: se engancha a su cotización cuando Gerencia la apruebe.', o.numero
      using errcode = 'check_violation';
  end if;
  if o.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') then
    raise exception 'La OT % es de %: no es una venta y no va con una cotización.', o.numero,
      case o.tipo_trabajo when 'GARANTIA' then 'garantía' else 'mantenimiento' end
      using errcode = 'check_violation';
  end if;
  if o.cliente_id is null then
    raise exception 'La OT % todavía no tiene cliente: pónselo con «Poner cliente» y después engánchala.', o.numero
      using errcode = 'check_violation';
  end if;
  if o.cliente_id is distinct from c.cliente_id then
    raise exception 'La OT % es de otro cliente que la cotización %. Si el vehículo pasó a otro comprador, va con «Editar OT / cambiar cliente», que anota su venta anterior.', o.numero, c.numero
      using errcode = 'check_violation';
  end if;
  if o.unidad_id is null then
    raise exception 'La OT % no tiene unidad: la cotización se cobra por unidad, y a una OT no se le pone una después. Se anula y se carga desde la cotización.', o.numero
      using errcode = 'check_violation';
  end if;
  if o.tipo_carroceria_id is not null and o.tipo_carroceria_id is distinct from c.tipo_carroceria_id then
    raise exception 'La OT % es de otra carrocería que la cotización %: no es la misma venta.', o.numero, c.numero
      using errcode = 'check_violation';
  end if;

  -- Que le quede una unidad libre, con los mismos mensajes que la carga -------------
  select count(*), min(x.numero) into v_vigentes, v_otra
    from public.ordenes_trabajo x
   where x.cotizacion_pdf_id = p_cotizacion and x.estado <> 'ANULADA';
  if v_vigentes >= c.cantidad_unidades then
    if c.cantidad_unidades = 1 then
      raise exception 'La cotización % ya tiene su OT %.', c.numero, v_otra using errcode = 'unique_violation';
    end if;
    raise exception 'La cotización % es de % unidades y ya tiene sus % OT.', c.numero, c.cantidad_unidades, v_vigentes
      using errcode = 'unique_violation';
  end if;
  v_salieron := public.ordenes_que_salieron_de_la_cotizacion(p_cotizacion, null);
  if v_vigentes + cardinality(v_salieron) >= c.cantidad_unidades then
    raise exception '%', public.venta_que_paso_a_otro_comprador(c.numero, c.cantidad_unidades, v_vigentes, v_salieron)
      using errcode = 'check_violation';
  end if;

  -- Qué unidad es: la que elige Administración, o la primera libre -------------------
  if p_unidad is not null then
    if p_unidad < 1 or p_unidad > c.cantidad_unidades then
      if c.cantidad_unidades = 1 then
        raise exception 'La cotización % es de una sola unidad.', c.numero using errcode = 'check_violation';
      end if;
      raise exception 'La cotización % es de % unidades: elige una de la 1 a la %.',
        c.numero, c.cantidad_unidades, c.cantidad_unidades using errcode = 'check_violation';
    end if;
    select x.numero into v_otra
      from public.ordenes_trabajo x
     where x.cotizacion_pdf_id = p_cotizacion and x.estado <> 'ANULADA'
       and coalesce(x.numero_de_unidad, 1) = p_unidad
     limit 1;
    if found then
      raise exception 'La unidad % de la cotización % ya tiene su OT %: elige otra.', p_unidad, c.numero, v_otra
        using errcode = 'unique_violation';
    end if;
    if exists (select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
                where (e->>'unidad')::integer = p_unidad) then
      raise exception 'La unidad % de la cotización % pasó a otro comprador: ya no lleva otra OT.', p_unidad, c.numero
        using errcode = 'check_violation';
    end if;
    v_n := p_unidad;
  else
    select min(k) into v_n
      from generate_series(1, c.cantidad_unidades) k
     where not exists (select 1 from public.ordenes_trabajo x
                        where x.cotizacion_pdf_id = p_cotizacion and x.estado <> 'ANULADA'
                          and coalesce(x.numero_de_unidad, 1) = k)
       and not exists (select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
                        where (e->>'unidad')::integer = k);
    if v_n is null then
      raise exception 'A la cotización % ya no le queda ninguna unidad libre.', c.numero using errcode = 'check_violation';
    end if;
  end if;
  v_cual := case when c.cantidad_unidades > 1 then format('unidad %s de %s', v_n, c.cantidad_unidades) end;

  -- El enganche: el disparador de la cotización de la OT lo reconoce por la marca, --
  -- y `fn_ot_cabe_en_su_cotizacion` vuelve a juzgar la unidad y el código.
  perform set_config('metalwork.enganche_de_ot', o.id::text, true);
  perform set_config('metalwork.enganche_unidad', v_n::text, true);
  update public.ordenes_trabajo
     set cotizacion_pdf_id = p_cotizacion,
         tipo_carroceria_id = coalesce(tipo_carroceria_id, c.tipo_carroceria_id)
   where id = o.id;
  perform set_config('metalwork.enganche_de_ot', '', true);
  perform set_config('metalwork.enganche_unidad', '', true);

  if not exists (select 1 from public.ordenes_trabajo x
                  where x.id = o.id and x.cotizacion_pdf_id = p_cotizacion and coalesce(x.numero_de_unidad, 1) = v_n) then
    raise exception 'La OT % no quedó enganchada a la cotización %. No se guardó nada: avisa al administrador del sistema.', o.numero, c.numero;
  end if;

  -- El historial de la OT («Trazabilidad») -------------------------------------------
  perform public.ot_registrar_evento_interna(
    o.id, 'COMENTARIO',
    format('Enganchada a su cotización %s%s. Motivo: %s', c.numero, coalesce(' (' || v_cual || ')', ''), v_motivo),
    jsonb_build_object('enganche_a_cotizacion', true, 'cotizacion_pdf_id', c.id, 'cotizacion', c.numero,
                       'unidad', v_n, 'de', c.cantidad_unidades, 'motivo', v_motivo));

  -- Ventas, que registró la cotización, sabe que ya tiene su OT ----------------------
  v_quedan := c.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1;
  perform public.notificar_a_usuario(
    c.registrado_por,
    'Tu cotización ya tiene su OT',
    format('La %s de %s quedó con la OT %s, que ya estaba registrada%s.%s',
           c.numero, coalesce(c.cliente, 'un cliente'), o.numero, coalesce(', como la ' || v_cual, ''),
           case when c.cantidad_unidades = 1 then ''
                when v_quedan = 0 then ' Ya están todas.'
                when v_quedan = 1 then ' Falta 1.'
                else format(' Faltan %s.', v_quedan) end),
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return o.id;
end;
$$;

comment on function public.enganchar_ot_a_su_cotizacion(uuid, uuid, integer, timestamptz, text) is
  'Administración (ordenes.crear) engancha una OT ya registrada sin cotización a la cotización aprobada de su mismo cliente y su misma carrocería, en la unidad libre que elige (o la primera), con su motivo en la bitácora de la OT y el aviso a Ventas (migración 20261127210000).';

revoke all on function public.enganchar_ot_a_su_cotizacion(uuid, uuid, integer, timestamptz, text) from public, anon;
grant execute on function public.enganchar_ot_a_su_cotizacion(uuid, uuid, integer, timestamptz, text) to authenticated;
