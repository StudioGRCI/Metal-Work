-- =============================================================================
-- EL CLIENTE DE LA OT Y DE SU COTIZACIÓN, Y LAS UNIDADES QUE YA PASARON, NO
-- CAMBIAN POR FUERA
-- -----------------------------------------------------------------------------
-- Los auditores del PR 289 (la OT que pasa a otro comprador toma la unidad
-- libre) encontraron tres puertas que ya estaban abiertas antes, y StudioGRCI
-- aprobó cerrarlas en un PR aparte (2026-11-27):
--
--   1. El cliente de una OT cambiaba con un UPDATE directo por la API, con
--      cualquiera de los permisos que dejan editar la OT (también Gerencia, por
--      `ordenes.anular`): la OT quedaba de otro cliente sin venta anterior, sin
--      historial y con la cotización y la unidad del cliente de antes. Desde
--      aquí, con sesión, el cliente de una OT cambia solo por sus dos caminos:
--      «Poner cliente» a la OT que abrió el taller sin cliente
--      (`poner_cliente_a_orden`) y «Editar OT / cambiar cliente», que la pasa a
--      la cotización del otro comprador (`editar_ot_con_historial_base`). Los
--      dos anotan el cambio en la bitácora de la OT. Lo que corre sin sesión
--      (una migración) sigue como estaba.
--
--   2. Ventas podía corregir una cotización de varias unidades y bajarle la
--      cantidad por debajo de una unidad cuya OT pasó a otro comprador. La
--      cuenta (`fn_cotizacion_pdf_unidades_alcanzan`) miraba solo las OT
--      vigentes de la cotización: la unidad que salió quedaba fuera de rango y
--      la que seguía decía «Falta su OT» sin poder cargarse. Ahora cuenta
--      también las que salieron, con la unidad que dejó cada una
--      (`unidad_que_dejo_la_ot`, de la 20261127003000).
--
--   3. Una corrección de Ventas podía cambiar el cliente de una cotización que
--      ya tiene OT (o la tuvo y pasó a otro comprador): la OT seguía con el
--      cliente de antes y la venta decía otro. La venta que cambia de cliente
--      se hace con su propia cotización, y Administración le pasa la OT con
--      «Editar OT / cambiar cliente». Disparador propio de la cotización, sin
--      redefinir su revisión (`fn_cotizacion_pdf_revision`). La cotización sin
--      OT, o cuya única OT se anuló, se sigue corrigiendo como siempre.
--
-- En producción, el 2026-11-27: 21 OT, ninguna sin cliente, ninguna con un
-- cliente distinto del de su cotización y ninguna venta anterior. Nada que
-- arreglar en los datos.
--
-- `poner_cliente_a_orden` es la de la 20260101000100 y
-- `fn_cotizacion_pdf_unidades_alcanzan`, la de la 20261126760000; las dos se
-- compararon con producción el 2026-11-27 y se reemplazan solo si siguen siendo
-- esas (o ya son las de esta migración). `create or replace` conserva sus
-- permisos.
--
-- Nada se borra. Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      ('public.poner_cliente_a_orden(uuid,uuid)',
       array['c68837ab86745b134b1ff6bd0e690e9e', '1b356406a1b688cb1be5e2fd1cbdcad0']),
      ('public.fn_cotizacion_pdf_unidades_alcanzan()',
       array['5af5470104d409b4b5998d6e2a88060f', '2b5e3fc708f40a65ffd167625353e775'])
    ) as t(firma, conocidas)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into huella from pg_proc p where p.oid = to_regprocedure(f.firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', f.firma;
    end if;
    if not (huella = any (f.conocidas)) then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', f.firma;
    end if;
  end loop;
  -- Esta migración usa los ayudantes de la 20261127003000.
  if to_regprocedure('public.unidad_que_dejo_la_ot(uuid,uuid)') is null
     or to_regprocedure('public.salidas_de_la_cotizacion(uuid,uuid)') is null then
    raise exception 'Faltan las migraciones 20261126988000 y 20261127003000: aplícalas antes que esta.';
  end if;
end $$;

-- 1. El cliente de una OT cambia solo por sus dos caminos --------------------------
-- «Editar OT» ya marca su traspaso en `metalwork.traspaso_de_ot` mientras mueve
-- la OT (20261127003000), y solo cambia el cliente cuando la pasa a otra
-- cotización. «Poner cliente» marca el suyo en `metalwork.cliente_de_ot`.
-- Disparador propio de la OT (la regla del blindaje: no se redefine
-- `fn_ot_antes_update`), sin lista de columnas: un BEFORE que cambiara el
-- cliente no aparece en el SET.
create or replace function public.fn_ot_cliente_cambia_solo_por_su_camino()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if coalesce(current_setting('metalwork.traspaso_de_ot', true), '') = new.id::text
     or coalesce(current_setting('metalwork.cliente_de_ot', true), '') = new.id::text then
    return new;
  end if;
  if public.usuario_actual() is null then
    return new;  -- una migración o la conexión directa, como hasta aquí
  end if;
  if old.cliente_id is null then
    raise exception 'A la OT % se le pone el cliente con «Poner cliente», en su resumen: así queda en su historial y su unidad queda del mismo cliente.', old.numero
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'El cliente de la OT % cambia solo con «Editar OT / cambiar cliente», pasándola a la cotización aprobada del otro cliente: así queda anotada su venta anterior, con su historial.', old.numero
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.fn_ot_cliente_cambia_solo_por_su_camino() from public, anon, authenticated;

create or replace trigger trg_ot_cliente_cambia_solo_por_su_camino
  before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_cliente_cambia_solo_por_su_camino();

-- «Poner cliente»: la misma función de la 20260101000100, que ahora marca su
-- cambio solo mientras pone el cliente a la OT.
create or replace function public.poner_cliente_a_orden(p_orden uuid, p_cliente uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden   record;
  v_unidad  record;
  v_misma   uuid;
  v_nombre  text;
begin
  perform public.exigir_permiso('ordenes.editar');

  select o.id, o.numero, o.cliente_id, o.unidad_id, o.estado into v_orden
    from public.ordenes_trabajo o where o.id = p_orden
     for update;
  if v_orden.id is null then
    raise exception 'No se encontró la orden.' using errcode = 'foreign_key_violation';
  end if;
  if v_orden.cliente_id is not null then
    raise exception 'La orden % ya tiene cliente.', v_orden.numero using errcode = 'check_violation';
  end if;
  if v_orden.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then
    raise exception 'La orden % ya está cerrada.', v_orden.numero using errcode = 'check_violation';
  end if;

  select c.razon_social into v_nombre from public.clientes c where c.id = p_cliente and c.activo;
  if v_nombre is null then
    raise exception 'Elige el cliente de la lista.' using errcode = 'foreign_key_violation';
  end if;

  if v_orden.unidad_id is not null then
    select u.id, u.cliente_id, u.placa into v_unidad
      from public.unidades u where u.id = v_orden.unidad_id
       for update;

    if v_unidad.cliente_id is not null and v_unidad.cliente_id <> p_cliente then
      raise exception 'La unidad % es de otro cliente: la orden no puede ser de %.', v_unidad.placa, v_nombre
        using errcode = 'check_violation';
    end if;

    if v_unidad.cliente_id is null then
      select u.id into v_misma
        from public.unidades u
       where u.cliente_id = p_cliente
         and v_unidad.placa is not null
         and upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(v_unidad.placa, '[^A-Za-z0-9]', '', 'g'))
       limit 1;

      if v_misma is not null then
        update public.ordenes_trabajo set unidad_id = v_misma where id = p_orden;
        update public.unidades set activo = false where id = v_unidad.id;
      else
        update public.unidades set cliente_id = p_cliente where id = v_unidad.id;
      end if;
    end if;
  end if;

  -- El disparador del cliente de la OT reconoce este camino por la marca (20261127160000).
  perform set_config('metalwork.cliente_de_ot', p_orden::text, true);
  update public.ordenes_trabajo set cliente_id = p_cliente where id = p_orden;
  perform set_config('metalwork.cliente_de_ot', '', true);

  perform public.ot_registrar_evento(
    p_orden, 'COMENTARIO', format('Se le puso el cliente: %s.', v_nombre),
    jsonb_build_object('cliente_id', p_cliente));
end;
$$;

revoke all on function public.poner_cliente_a_orden(uuid, uuid) from public, anon;
grant execute on function public.poner_cliente_a_orden(uuid, uuid) to authenticated;

-- 2. La cantidad de unidades no baja de las que ya pasaron a otro comprador -------
-- La de la 20261126760000, que contaba solo las OT vigentes. Ahora cuenta
-- también cada unidad cuya OT pasó a otro comprador, con la unidad que dejó
-- (la de su venta anterior). El número de la OT que pasó, solo a quien lee o
-- carga las órdenes, como en la tarjeta (`unidades_que_salieron_de_la_cotizacion`).
create or replace function public.fn_cotizacion_pdf_unidades_alcanzan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vigentes integer;
  v_salieron integer;
  v_mayor    integer;
  v_ot       text;
  v_salio    boolean;
begin
  if new.cantidad_unidades is not distinct from old.cantidad_unidades then
    return new;
  end if;
  select count(*) into v_vigentes
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA';
  select count(*) into v_salieron from public.salidas_de_la_cotizacion(new.id, null);

  if new.cantidad_unidades < v_vigentes + v_salieron then
    if v_salieron = 0 then
      raise exception 'La cotización % ya tiene % OT: no puede quedar con % %. Si sobra una unidad, Administración anula primero su OT.',
        old.numero, v_vigentes, new.cantidad_unidades,
        case when new.cantidad_unidades = 1 then 'unidad' else 'unidades' end
        using errcode = 'check_violation';
    end if;
    raise exception 'La cotización % tiene % % con OT y % que pasó a otro comprador: no puede quedar con % %.',
      old.numero, v_vigentes, case when v_vigentes = 1 then 'unidad' else 'unidades' end, v_salieron,
      new.cantidad_unidades, case when new.cantidad_unidades = 1 then 'unidad' else 'unidades' end
      using errcode = 'check_violation';
  end if;

  -- Con la 2 anulada y la 3 vigente (o pasada a otro comprador), quedar en 2
  -- dejaría a la 3 fuera de la cuenta.
  select x.unidad, x.numero, x.salio into v_mayor, v_ot, v_salio
    from (select coalesce(o.numero_de_unidad, 1)::integer as unidad, o.numero, false as salio
            from public.ordenes_trabajo o
           where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA'
          union all
          select public.unidad_que_dejo_la_ot(s.orden_id, new.id), o.numero, true
            from public.salidas_de_la_cotizacion(new.id, null) s
            join public.ordenes_trabajo o on o.id = s.orden_id) x
   order by x.unidad desc
   limit 1;
  if new.cantidad_unidades < v_mayor then
    if v_salio then
      raise exception 'La unidad % de la cotización % pasó a otro comprador%: no puede quedar con % %.',
        v_mayor, old.numero,
        case when public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear')
             then format(' con la OT %s', v_ot) else '' end,
        new.cantidad_unidades, case when new.cantidad_unidades = 1 then 'unidad' else 'unidades' end
        using errcode = 'check_violation';
    end if;
    raise exception 'La OT % es la unidad % de la cotización %: no puede quedar con % unidades.',
      v_ot, v_mayor, old.numero, new.cantidad_unidades using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_unidades_alcanzan() from public, anon, authenticated;

-- 3. La cotización que ya tiene OT no cambia de cliente -------------------------
-- Ventas corrige la cotización con un archivo nuevo, y la corrección admitía
-- otro cliente aunque la venta ya tuviera su OT. Lee las OT por encima del
-- RLS: Ventas no lee todas las OT y la regla vale igual. Con sesión o sin ella:
-- ninguna función cambia el cliente de una cotización (2026-11-27).
create or replace function public.fn_cotizacion_con_ot_conserva_su_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if exists (select 1 from public.ordenes_trabajo o
              where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA') then
    raise exception 'La cotización % ya tiene su OT: una corrección no le cambia el cliente. Si la venta es de otro cliente, regístrala con su propia cotización y Administración le pasa la OT con «Editar OT / cambiar cliente».', old.numero
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.salidas_de_la_cotizacion(old.id, null)) then
    raise exception 'La OT de la cotización % pasó a otro comprador: la venta quedó anotada con este cliente y una corrección no se lo cambia.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_cotizacion_con_ot_conserva_su_cliente() from public, anon, authenticated;

create or replace trigger trg_cotizacion_pdf_con_ot_conserva_su_cliente
  before update on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_con_ot_conserva_su_cliente();
