-- =============================================================================
-- DOS REQUERIMIENTOS: EL DE OPERACIÓN Y EL DE ADMINISTRACIÓN, Y ALMACÉN
-- ATIENDE CADA INSUMO
-- -----------------------------------------------------------------------------
-- Gerencia (2026-10-14) ordenó quién pide qué y cómo se atiende:
--
--   * El requerimiento de OPERACIÓN (RQ-0001-2026…) lo piden solo cuatro áreas:
--     Maestranza, Producción, Acabados y Almacén. Lo registra Requerimientos y
--     su orden de compra la hace Logística, como hasta ahora.
--   * El requerimiento de ADMINISTRACIÓN (RQA-0001-2026…) es lo de la oficina:
--     Recursos Humanos, Logística, Diseño, Ingeniería, Gerencia, Servicios de
--     apoyo, Ventas (Gerencia Comercial) y las oficinas de Administración,
--     Contabilidad y Tesorería. Lo registra la administradora y su orden de
--     compra la hace ella. Pasa primero por Almacén, igual que el de operación
--     (tarjeta del 2026-10-14 23:09 UTC).
--   * Almacén ya no dice «hay» o «no hay» del RQ entero: revisa CADA INSUMO y
--     anota cuánto tiene. Lo que tiene completo no se compra; de lo demás se
--     compra solo lo que falta. Si tiene todo, el RQ queda listo en almacén.
--
-- Qué área pide qué está en la tabla de áreas (`areas.requerimiento`), no en el
-- código: mover un área de un requerimiento al otro es cambiar una fila.
--
-- Para que la administradora haga su orden de compra le toca lo mismo que a
-- quien compra: `compras.crear` (el formulario de la OC, el padrón de
-- proveedores y su comprobante) y `compras.ver` (el PDF de la OC). Lo que no le
-- toca es el RQ de operación: la base no le deja generarle la OC, y a Logística
-- no le deja generársela al de Administración.
--
-- Las funciones de antes siguen respondiendo igual para la pantalla que está
-- en uso: «sin stock» y «listo» del RQ entero se anotan como cero o todo en
-- cada insumo, y emitir sin tipo es emitir uno de operación.
--
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso de la administradora ------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('requerimientos.administracion', 'Requerimientos',
   'Registrar el requerimiento de Administración (lo de la oficina) y hacer la orden de compra de lo que Almacén no tenga')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  cross join (values ('requerimientos.administracion'), ('compras.crear'), ('compras.ver'), ('proveedores.ver')) as p(codigo)
 where r.codigo = 'ADMINISTRACION'
on conflict do nothing;

-- 2. Qué área pide qué requerimiento ---------------------------------------------------
insert into public.areas (codigo, nombre, orden_secuencia)
select 'SAP', 'Servicios de apoyo', (select max(orden_secuencia) + 1 from public.areas)
 where not exists (select 1 from public.areas where codigo = 'SAP');

alter table public.areas add column if not exists requerimiento text;
comment on column public.areas.requerimiento is
  'Qué requerimiento puede pedir el área: OPERACION (lo registra Requerimientos), ADMINISTRACION (lo registra la administradora) o ninguno.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_areas_requerimiento') then
    alter table public.areas add constraint ck_areas_requerimiento
      check (requerimiento is null or requerimiento in ('OPERACION', 'ADMINISTRACION'));
  end if;
end $$;

update public.areas set requerimiento = 'OPERACION'
 where codigo in ('MTZ', 'PRD', 'ACB', 'ALM') and requerimiento is distinct from 'OPERACION';
update public.areas set requerimiento = 'ADMINISTRACION'
 where codigo in ('RRH', 'LOG', 'DIS', 'ING', 'GGE', 'GOP', 'GCO', 'SAP', 'ADM', 'CON', 'TES')
   and requerimiento is distinct from 'ADMINISTRACION';

-- 3. El tipo del requerimiento y su serie ------------------------------------------------
alter table public.requerimientos add column if not exists tipo text not null default 'OPERACION';
comment on column public.requerimientos.tipo is
  'OPERACION (RQ-…, lo registra Requerimientos y lo compra Logística) o ADMINISTRACION (RQA-…, lo registra y lo compra la administradora).';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_rq_tipo') then
    alter table public.requerimientos add constraint ck_rq_tipo check (tipo in ('OPERACION', 'ADMINISTRACION'));
  end if;
end $$;

insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'REQUERIMIENTO', '002', 'RQA', 0, 4, 'RQA-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'REQUERIMIENTO' and serie = '002');

-- El tipo no cambia después de emitido, como el área y el código.
create or replace function public.fn_rq_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un requerimiento no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if row(new.numero, new.tipo, new.area_id, new.codigo_interno, new.justificacion, new.fecha_requerida, new.creado_por, new.creado_en)
     is distinct from row(old.numero, old.tipo, old.area_id, old.codigo_interno, old.justificacion, old.fecha_requerida, old.creado_por, old.creado_en) then
    raise exception 'El requerimiento % ya se registró: si cambió, anúlalo y registra otro.', old.numero
      using errcode = 'check_violation';
  end if;
  if old.estado in ('ENTREGADO', 'ANULADO') and new.estado is distinct from old.estado then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', old.numero,
      case old.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 4. Cuánto tiene Almacén de cada insumo -------------------------------------------------
-- Vacío mientras Almacén no lo revisa. Lo que falta (cantidad − en stock) es lo
-- único que se compra.
alter table public.requerimiento_lineas
  add column if not exists cantidad_en_stock  numeric(14, 3),
  add column if not exists stock_revisado_en  timestamptz,
  -- Sin índice: nadie busca por quién revisó y la cuenta no se borra (se desactiva).
  add column if not exists stock_revisado_por uuid references public.usuarios(id) on delete restrict;
comment on column public.requerimiento_lineas.cantidad_en_stock is
  'Cuánto de este insumo tenía Almacén al revisarlo (de 0 a la cantidad pedida). Lo que falta es lo único que se compra. Vacío: Almacén todavía no lo revisó.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_rq_linea_stock') then
    alter table public.requerimiento_lineas add constraint ck_rq_linea_stock check (
      (cantidad_en_stock is null) = (stock_revisado_en is null)
      and (stock_revisado_en is null) = (stock_revisado_por is null)
      and (cantidad_en_stock is null or (cantidad_en_stock >= 0 and cantidad_en_stock <= cantidad)));
  end if;
end $$;

-- Lo que Almacén anotó de un insumo queda: es lo que dice por qué se compró o no.
create or replace function public.fn_rq_linea_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un insumo del requerimiento no se borra: se anula el requerimiento.' using errcode = 'check_violation';
  end if;
  if row(new.requerimiento_id, new.item, new.descripcion, new.cantidad, new.unidad_medida_id, new.categoria_id)
     is distinct from row(old.requerimiento_id, old.item, old.descripcion, old.cantidad, old.unidad_medida_id, old.categoria_id) then
    raise exception 'Lo que se pidió en el requerimiento no cambia: si cambió, anúlalo y registra otro.'
      using errcode = 'check_violation';
  end if;
  if old.stock_revisado_en is not null
     and row(new.cantidad_en_stock, new.stock_revisado_en, new.stock_revisado_por)
         is distinct from row(old.cantidad_en_stock, old.stock_revisado_en, old.stock_revisado_por) then
    raise exception 'Almacén ya revisó el stock de este insumo: lo que anotó queda.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_linea_guardia() from public, anon, authenticated;

-- 5. Quién lo ve y a quién le llega la compra ------------------------------------------------
create or replace function public.puede_ver_requerimientos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('requerimientos.emitir')
      or public.tiene_permiso('requerimientos.administracion')
      or public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('compras.crear')
      or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('almacen.despachar');
$$;
revoke all on function public.puede_ver_requerimientos() from public, anon;
grant execute on function public.puede_ver_requerimientos() to authenticated;

-- 'LOGISTICA' es quien compra: Logística en el de operación, la administradora en
-- el de Administración. Las demás llamadas siguen igual.
create or replace function public.fn_rq_avisar(p_rq public.requerimientos, p_titulo text, p_cuerpo text, p_a text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo,
         case when p_a in ('LOGISTICA', 'ALMACEN') then '/requerimientos/atencion' else '/requerimientos' end,
         'requerimientos', p_rq.id
    from public.usuarios u
    left join public.areas a on a.id = u.area_id
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and case p_a
           when 'LOGISTICA' then
             case when p_rq.tipo = 'ADMINISTRACION'
                  then exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'requerimientos.administracion')
                  else a.codigo = 'LOG' and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.crear')
             end
           when 'ALMACEN'   then exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'almacen.recibir')
           when 'AREA'      then u.area_id = p_rq.area_id and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'produccion.actividades')
           when 'EMISOR'    then u.id = p_rq.creado_por
           else false
         end;
end;
$$;
revoke all on function public.fn_rq_avisar(public.requerimientos, text, text, text) from public, anon, authenticated;

-- Quién registra, anula y compra cada requerimiento.
create or replace function public.rq_exigir(p_tipo text, p_paso text)
returns void language plpgsql stable set search_path to 'public' as $$
begin
  if public.es_admin() then
    return;
  end if;
  if p_paso = 'COMPRAR' then
    if p_tipo = 'ADMINISTRACION' and not public.tiene_permiso('requerimientos.administracion') then
      raise exception 'No tienes permiso: este es un requerimiento de Administración y su orden de compra la hace la administradora.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_tipo <> 'ADMINISTRACION'
       and (not public.tiene_permiso('compras.crear') or public.tiene_permiso('requerimientos.administracion')) then
      raise exception 'No tienes permiso: este es un requerimiento de operación y su orden de compra la hace Logística.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_tipo = 'ADMINISTRACION' then
    if not public.tiene_permiso('requerimientos.administracion') then
      raise exception 'No tienes permiso: el requerimiento de Administración lo registra y lo anula la administradora.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not public.tiene_permiso('requerimientos.emitir') then
    raise exception 'No tienes permiso: el requerimiento de operación lo registra y lo anula el área de Requerimientos.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.rq_exigir(text, text) from public, anon, authenticated;

-- 6. Registrar: cada requerimiento con sus áreas -------------------------------------------
-- p_tipo: OPERACION o ADMINISTRACION. p_lineas: [{descripcion, cantidad, unidad_medida_id, categoria_id}, …]
create or replace function public.emitir_requerimiento(
  p_id uuid, p_tipo text, p_area_id uuid, p_codigo_interno text, p_justificacion text, p_fecha_requerida date, p_lineas jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_actual   public.requerimientos%rowtype;
  v_numero   text;
  v_area     public.areas%rowtype;
  v_areas    text;
  v_linea    jsonb;
  v_item     int := 0;
  v_desc     text;
  v_cant     numeric;
  v_unidad   uuid;
  v_cat      uuid;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
begin
  if p_tipo is null or p_tipo not in ('OPERACION', 'ADMINISTRACION') then
    raise exception 'Vuelve a abrir el formulario del requerimiento.' using errcode = 'check_violation';
  end if;
  perform public.rq_exigir(p_tipo, 'REGISTRAR');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del requerimiento.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_justificacion, ''))) not between 10 and 1000 then
    raise exception 'Explica para qué se necesita, en al menos 10 caracteres: Almacén y quien compra lo leen para priorizar.'
      using errcode = 'check_violation';
  end if;
  if p_fecha_requerida is not null and p_fecha_requerida < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;
  select * into v_area from public.areas where id = p_area_id and activo;
  if not found then
    raise exception 'Elige el área que necesita los insumos.' using errcode = 'check_violation';
  end if;
  if v_area.requerimiento is distinct from p_tipo then
    select string_agg(nombre, ', ' order by orden_secuencia) into v_areas
      from public.areas where activo and requerimiento = p_tipo;
    raise exception '%', case p_tipo
      when 'OPERACION' then format('%s no pide por el requerimiento de operación: ese lo piden %s. Lo de la oficina va por el requerimiento de Administración.',
                                   v_area.nombre, coalesce(v_areas, 'las áreas de planta'))
      else format('%s no pide por el requerimiento de Administración: ese es de %s. Lo de planta va por el requerimiento de operación.',
                  v_area.nombre, coalesce(v_areas, 'las áreas de oficina'))
      end using errcode = 'check_violation';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo al requerimiento.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lineas) > 100 then
    raise exception 'Un requerimiento lleva hasta 100 insumos. Divídelo en dos.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.requerimientos where id = p_id;
  if found then
    -- Un reintento del mismo formulario no duplica el requerimiento.
    if v_actual.creado_por = public.usuario_actual() and v_actual.tipo = p_tipo and v_actual.area_id = p_area_id
       and v_actual.codigo_interno = btrim(p_codigo_interno) and v_actual.justificacion = btrim(p_justificacion) then
      return p_id;
    end if;
    raise exception 'Este requerimiento ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;

  v_numero := public.siguiente_correlativo('REQUERIMIENTO', case p_tipo when 'ADMINISTRACION' then '002' else '001' end, null);
  insert into public.requerimientos (id, numero, tipo, area_id, codigo_interno, justificacion, fecha_requerida, creado_por)
  values (p_id, v_numero, p_tipo, p_area_id, btrim(p_codigo_interno), btrim(p_justificacion), p_fecha_requerida,
          public.usuario_actual());

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_item := v_item + 1;
    v_desc := btrim(coalesce(v_linea->>'descripcion', ''));
    if char_length(v_desc) not between 3 and 300 then
      raise exception 'Describe el insumo % en 3 a 300 caracteres.', v_item using errcode = 'check_violation';
    end if;
    begin
      v_cant := (v_linea->>'cantidad')::numeric;
      v_unidad := (v_linea->>'unidad_medida_id')::uuid;
      v_cat := (v_linea->>'categoria_id')::uuid;
    exception when others then
      raise exception 'Revisa la cantidad, la unidad y la categoría del insumo %.', v_item using errcode = 'check_violation';
    end;
    if v_cant is null or v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_item
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.unidades_medida where id = v_unidad and activo) then
      raise exception 'Elige la unidad del insumo %.', v_item using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.categorias_material
                    where id = v_cat and activo and codigo <> 'ALM_POR_CLASIFICAR') then
      raise exception 'Elige la categoría del insumo %.', v_item using errcode = 'check_violation';
    end if;
    insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id)
    values (p_id, v_item, v_desc, v_cant, v_unidad, v_cat);
  end loop;

  -- Los dos pasan primero por Almacén, que revisa el stock de cada insumo.
  select * into v_actual from public.requerimientos where id = p_id;
  perform public.fn_rq_avisar(v_actual, 'Requerimiento por revisar: ' || v_numero,
    v_area.nombre || ' · ' || btrim(p_codigo_interno) || ' · ' || v_item || case when v_item = 1 then ' insumo' else ' insumos' end
      || '. Revisa cuánto hay de cada uno.', 'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.emitir_requerimiento(uuid, text, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.emitir_requerimiento(uuid, text, uuid, text, text, date, jsonb) to authenticated;

-- La de antes, sin tipo, registra uno de operación: la pantalla en uso sigue andando.
create or replace function public.emitir_requerimiento(
  p_id uuid, p_area_id uuid, p_codigo_interno text, p_justificacion text, p_fecha_requerida date, p_lineas jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  return public.emitir_requerimiento(p_id, 'OPERACION', p_area_id, p_codigo_interno, p_justificacion, p_fecha_requerida, p_lineas);
end;
$$;
revoke all on function public.emitir_requerimiento(uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.emitir_requerimiento(uuid, uuid, text, text, date, jsonb) to authenticated;

-- 7. Anular: lo anula quien lo registra -----------------------------------------------------
create or replace function public.anular_requerimiento(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir') or public.tiene_permiso('requerimientos.administracion')) then
    raise exception 'No tienes permiso: los requerimientos los anula quien los registra.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'ANULAR');
  if v_rq.estado = 'ANULADO' then return p_id; end if;
  if v_rq.estado not in ('POR_ATENDER', 'SIN_STOCK') then
    raise exception 'El requerimiento % ya está %: ya no se anula.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'ANULADO', anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'Requerimiento anulado: ' || v_rq.numero, btrim(p_motivo), 'LOGISTICA');
  perform public.fn_rq_avisar(v_rq, 'Requerimiento anulado: ' || v_rq.numero, btrim(p_motivo), 'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.anular_requerimiento(uuid, text) from public, anon;
grant execute on function public.anular_requerimiento(uuid, text) to authenticated;

-- 8. Almacén revisa cada insumo -----------------------------------------------------------
-- p_lineas: [{item, en_stock}, …], uno por cada insumo del RQ, con cuánto tiene
-- Almacén (de 0 a lo pedido). Si tiene todo de todos, el RQ queda listo en
-- almacén; si falta algo, pasa a quien compra con solo lo que falta.
create or replace function public.rq_revisar_stock(p_id uuid, p_lineas jsonb, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq       public.requerimientos%rowtype;
  v_yo       uuid := public.usuario_actual();
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
  v_total    int;
  v_faltan   int;
  v_detalle  text;
  v_area     text;
  v_malo     int;
begin
  perform public.exigir_permiso('almacen.recibir');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Anota cuánto hay de cada insumo.' using errcode = 'check_violation';
  end if;

  select count(*) into v_total from public.requerimiento_lineas where requerimiento_id = p_id;
  -- Cada insumo una vez, todos los del RQ, con una cantidad de 0 a lo pedido.
  select count(*) into v_malo
    from (select (x->>'item') as item, (x->>'en_stock') as en_stock from jsonb_array_elements(p_lineas) x) e
    left join public.requerimiento_lineas l
      on l.requerimiento_id = p_id and l.item = case when e.item ~ '^[0-9]{1,3}$' then e.item::int end
   where l.id is null
      or case when e.en_stock ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then e.en_stock::numeric > l.cantidad else true end;
  if v_malo > 0 then
    raise exception 'Revisa lo que anotaste: cada insumo va de 0 a la cantidad pedida, con hasta tres decimales.'
      using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lineas) <> v_total
     or (select count(distinct x->>'item') from jsonb_array_elements(p_lineas) x) <> v_total then
    raise exception 'Anota cuánto hay de cada insumo del requerimiento %, una vez cada uno.', v_rq.numero
      using errcode = 'check_violation';
  end if;

  if v_rq.estado <> 'POR_ATENDER' then
    -- Un reintento con lo mismo que ya se anotó devuelve el mismo RQ.
    if not exists (
         select 1 from public.requerimiento_lineas l
          join jsonb_array_elements(p_lineas) x on (x->>'item')::int = l.item
         where l.requerimiento_id = p_id and l.cantidad_en_stock is distinct from (x->>'en_stock')::numeric) then
      return p_id;
    end if;
    raise exception 'El requerimiento % ya pasó la revisión de stock.', v_rq.numero using errcode = 'check_violation';
  end if;

  update public.requerimiento_lineas l
     set cantidad_en_stock = (x->>'en_stock')::numeric, stock_revisado_en = now(), stock_revisado_por = v_yo
    from jsonb_array_elements(p_lineas) x
   where l.requerimiento_id = p_id and l.item = (x->>'item')::int;

  select count(*) filter (where l.cantidad_en_stock < l.cantidad),
         string_agg(case when l.cantidad_en_stock < l.cantidad then
                      rtrim(to_char(l.cantidad - l.cantidad_en_stock, 'FM999999990.999'), '.') || ' ' || coalesce(um.codigo, '') || ' ' || l.descripcion
                    end, '; ' order by l.item)
    into v_faltan, v_detalle
    from public.requerimiento_lineas l
    left join public.unidades_medida um on um.id = l.unidad_medida_id
   where l.requerimiento_id = p_id;

  if v_faltan = 0 then
    update public.requerimientos
       set estado = 'LISTO_EN_ALMACEN', revision_stock_en = now(), revision_stock_por = v_yo,
           listo_en_almacen_en = now(), listo_en_almacen_por = v_yo, nota_almacen = v_nota
     where id = p_id;
    select nombre into v_area from public.areas where id = v_rq.area_id;
    perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
      coalesce(v_area, 'El área') || ' puede recogerlo · ' || v_rq.codigo_interno, 'AREA');
    perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
      coalesce(v_area, 'El área') || ' ya puede recogerlo.', 'EMISOR');
  else
    update public.requerimientos
       set estado = 'SIN_STOCK', revision_stock_en = now(), revision_stock_por = v_yo, nota_almacen = v_nota
     where id = p_id;
    perform public.fn_rq_avisar(v_rq, 'Requerimiento por comprar: ' || v_rq.numero,
      left(case when v_faltan = v_total then 'Almacén no tiene nada. ' else 'Almacén tiene parte. ' end
           || 'Hay que comprar ' || v_faltan || ' de ' || v_total || case when v_total = 1 then ' insumo' else ' insumos' end
           || ' · ' || v_rq.codigo_interno || ': ' || v_detalle || coalesce(' · ' || v_nota, ''), 500),
      'LOGISTICA');
  end if;
  return p_id;
end;
$$;
revoke all on function public.rq_revisar_stock(uuid, jsonb, text) from public, anon;
grant execute on function public.rq_revisar_stock(uuid, jsonb, text) to authenticated;

-- «Sin stock» del RQ entero, como lo marca la pantalla en uso: cero de cada insumo.
create or replace function public.rq_marcar_sin_stock(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('almacen.recibir');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'SIN_STOCK' then return p_id; end if;
  if v_rq.estado <> 'POR_ATENDER' then
    raise exception 'El requerimiento % ya pasó la revisión de stock.', v_rq.numero using errcode = 'check_violation';
  end if;
  return public.rq_revisar_stock(p_id,
    (select jsonb_agg(jsonb_build_object('item', l.item, 'en_stock', 0) order by l.item)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id),
    p_nota);
end;
$$;
revoke all on function public.rq_marcar_sin_stock(uuid, text) from public, anon;
grant execute on function public.rq_marcar_sin_stock(uuid, text) to authenticated;

-- «Listo» antes de revisar es «hay todo de cada insumo»; después, es que llegó lo comprado.
create or replace function public.rq_marcar_listo_en_almacen(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype; v_area text;
begin
  perform public.exigir_permiso('almacen.recibir');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'LISTO_EN_ALMACEN' then return p_id; end if;
  if v_rq.estado = 'POR_ATENDER' then
    return public.rq_revisar_stock(p_id,
      (select jsonb_agg(jsonb_build_object('item', l.item, 'en_stock', l.cantidad) order by l.item)
         from public.requerimiento_lineas l where l.requerimiento_id = p_id),
      p_nota);
  end if;
  if v_rq.estado not in ('SIN_STOCK', 'EN_ATENCION') then
    raise exception 'El requerimiento % ya está %.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'LISTO_EN_ALMACEN',
         revision_stock_en = coalesce(revision_stock_en, now()),
         revision_stock_por = coalesce(revision_stock_por, public.usuario_actual()),
         listo_en_almacen_en = now(), listo_en_almacen_por = public.usuario_actual(),
         nota_almacen = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_almacen)
   where id = p_id;
  select nombre into v_area from public.areas where id = v_rq.area_id;
  perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
    coalesce(v_area, 'El área') || ' puede recogerlo · ' || v_rq.codigo_interno, 'AREA');
  perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
    coalesce(v_area, 'El área') || ' ya puede recogerlo.', 'EMISOR');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_listo_en_almacen(uuid, text) from public, anon;
grant execute on function public.rq_marcar_listo_en_almacen(uuid, text) to authenticated;

-- 9. Quien compra marca que lo está comprando -------------------------------------------------
create or replace function public.rq_marcar_en_atencion(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  if not (public.es_admin() or public.tiene_permiso('compras.crear')) then
    raise exception 'No tiene el permiso compras.crear para realizar esta operación' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'COMPRAR');
  if v_rq.estado = 'EN_ATENCION' then return p_id; end if;
  if v_rq.estado = 'POR_ATENDER' then
    raise exception 'Almacén todavía no revisó el stock del requerimiento %.', v_rq.numero using errcode = 'check_violation';
  end if;
  if v_rq.estado <> 'SIN_STOCK' then
    raise exception 'El requerimiento % ya está %.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'EN_ATENCION', en_atencion_en = now(), en_atencion_por = public.usuario_actual(),
         nota_logistica = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'En compra: ' || v_rq.numero,
    'Cuando el conductor lo deje, recepciónalo y márcalo listo en almacén.', 'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_en_atencion(uuid, text) from public, anon;
grant execute on function public.rq_marcar_en_atencion(uuid, text) to authenticated;

-- 10. La OC del requerimiento: solo lo que falta, y la hace quien le toca -----------------------
create or replace function public.emitir_compra_del_requerimiento(
  p_id uuid, p_requerimiento_id uuid, p_items smallint[],
  p_proveedor_id uuid, p_referencia text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_area    text;
  v_numero  text;
  v_ocupada text;
  v_lleno   text;
  v_n       integer;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_rq from public.requerimientos where id = p_requerimiento_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'COMPRAR');
  if v_rq.estado = 'POR_ATENDER' then
    raise exception 'Almacén todavía no revisó el stock del requerimiento %: la orden se genera con lo que falte.', v_rq.numero
      using errcode = 'check_violation';
  end if;
  if v_rq.estado not in ('SIN_STOCK', 'EN_ATENCION') then
    raise exception 'El requerimiento % ya está %: no se le generan más compras.', v_rq.numero,
      lower(replace(v_rq.estado, '_', ' ')) using errcode = 'check_violation';
  end if;
  if p_items is not null and exists (
       select 1 from unnest(p_items) i where not exists (
         select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_requerimiento_id and l.item = i)) then
    raise exception 'Alguno de los insumos marcados no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  -- Lo que Almacén tiene completo no se compra.
  if p_items is not null then
    select string_agg(l.item::text, ', ' order by l.item) into v_lleno
      from public.requerimiento_lineas l
     where l.requerimiento_id = p_requerimiento_id and l.item = any (p_items)
       and l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad;
    if v_lleno is not null then
      raise exception '%', case when position(',' in v_lleno) = 0
        then format('Almacén ya tiene completo el insumo %s: no se compra. Desmárcalo.', v_lleno)
        else format('Almacén ya tiene completos los insumos %s: no se compran. Desmárcalos.', v_lleno) end
        using errcode = 'check_violation';
    end if;
  end if;
  -- Un insumo que ya tiene su compra viva no se pisa; si esa compra se rechazó,
  -- queda libre. Sin lista, se toman los libres y los ocupados se dejan en paz.
  if p_items is not null then
    select string_agg(l.item::text, ', ' order by l.item) into v_ocupada
      from public.requerimiento_lineas l
      join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
     where l.requerimiento_id = p_requerimiento_id and c.aprobacion <> 'RECHAZADA' and c.id <> p_id
       and l.item = any (p_items);
    if v_ocupada is not null then
      raise exception 'Los insumos % ya tienen su orden de compra: desmárcalos o espera a que Gerencia la rechace.', v_ocupada
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (
       select 1 from public.requerimiento_lineas l
       left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      where l.requerimiento_id = p_requerimiento_id
        and (p_items is null or l.item = any (p_items))
        and coalesce(l.cantidad_en_stock, 0) < l.cantidad
        and (c.id is null or c.id = p_id or c.aprobacion = 'RECHAZADA')) then
    raise exception 'Lo que falta del requerimiento % ya tiene su orden de compra.', v_rq.numero using errcode = 'check_violation';
  end if;
  -- La OC es una directa más: Gerencia la aprueba y el conductor la recoge. El
  -- motivo y el código interno salen del RQ. Un reintento devuelve la misma OC.
  select nombre into v_area from public.areas where id = v_rq.area_id;
  perform public.emitir_compra_directa(
    p_id, p_proveedor_id, p_referencia,
    left('Atiende el requerimiento ' || v_rq.numero || ' de ' || coalesce(v_area, 'el área') || ': ' || v_rq.justificacion, 500),
    p_detalles, p_fecha, p_condicion, p_dias, p_moneda, p_con_factura, v_rq.codigo_interno);
  select numero into v_numero from public.ordenes_compra_materiales where id = p_id;
  update public.requerimiento_lineas l
     set orden_compra_id = p_id, atendida_en = now(), atendida_por = public.usuario_actual()
   where l.requerimiento_id = p_requerimiento_id
     and (p_items is null or l.item = any (p_items))
     and coalesce(l.cantidad_en_stock, 0) < l.cantidad
     and (l.orden_compra_id is null
          or exists (select 1 from public.ordenes_compra_materiales c where c.id = l.orden_compra_id and c.aprobacion = 'RECHAZADA'));
  get diagnostics v_n = row_count;
  -- El RQ pasa a EN ATENCIÓN con la función del circuito (avisa a Almacén).
  if v_rq.estado = 'SIN_STOCK' then
    perform public.rq_marcar_en_atencion(p_requerimiento_id, 'Orden ' || coalesce(v_numero, ''));
  end if;
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_del_requerimiento(uuid, uuid, smallint[], uuid, text, jsonb, date, text, integer, text, boolean) from public, anon;
grant execute on function public.emitir_compra_del_requerimiento(uuid, uuid, smallint[], uuid, text, jsonb, date, text, integer, text, boolean) to authenticated;

-- 11. El avance: lo que Almacén tiene completo ya está en almacén -----------------------------
create or replace function public.avance_de_requerimientos(p_ids uuid[])
returns table (requerimiento_id uuid, porcentaje integer, etapa text, lineas jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
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
           ('OBSERVADO', 80, 7), ('POR_VALIDAR', 80, 8), ('EN_KARDEX', 85, 9), ('EN_STOCK', 85, 9),
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
  por_linea as (
    select r.id as rq, l.item as item,
           coalesce(c.numero, c.referencia) as compra,
           coalesce(c.aprobacion = 'RECHAZADA', false) as rechazada,
           l.cantidad_en_stock as en_stock,
           case when l.cantidad_en_stock is not null then greatest(l.cantidad - l.cantidad_en_stock, 0) end as por_comprar,
           case
             when r.estado = 'ENTREGADO' then 'ENTREGADO'
             when r.estado = 'LISTO_EN_ALMACEN' then 'LISTO_EN_ALMACEN'
             when r.estado = 'POR_ATENDER' then 'POR_REVISAR'
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then 'EN_STOCK'
             when c.id is null or c.aprobacion = 'RECHAZADA' then 'POR_COMPRAR'
             when c.aprobacion = 'POR_APROBAR' then 'OC_POR_APROBAR'
             when c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null) then
               case v.estado when 'VALIDADO' then 'EN_KARDEX' when 'OBSERVADO' then 'OBSERVADO' else 'POR_VALIDAR' end
             when c.recojo = 'RECOGIDO' then 'RECOGIDO'
             when c.recojo = 'EN_RECOJO' then 'EN_RECOJO'
             else 'PENDIENTE_RECOJO'
           end as paso,
           case
             when r.estado in ('ENTREGADO', 'LISTO_EN_ALMACEN', 'POR_ATENDER') or c.aprobacion = 'RECHAZADA' then null
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
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  )
  select p.rq,
         round(avg(e.pct))::integer,
         (array_agg(p.paso order by e.orden, p.item))[1],
         jsonb_agg(jsonb_build_object('item', p.item, 'orden_compra', p.compra, 'rechazada', p.rechazada,
                                      'etapa', p.paso, 'porcentaje', e.pct, 'desde', p.desde,
                                      'en_stock', p.en_stock, 'por_comprar', p.por_comprar) order by p.item)
    from por_linea p
    join etapas e on e.codigo = p.paso
   group by p.rq;
end;
$$;
revoke all on function public.avance_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.avance_de_requerimientos(uuid[]) to authenticated;
