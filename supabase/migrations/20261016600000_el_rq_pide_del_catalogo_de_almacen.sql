-- =============================================================================
-- EL REQUERIMIENTO PIDE CON LOS NOMBRES DEL CATÁLOGO DE ALMACÉN
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-15: «en el RQ debe utilizar para solicitar los materiales
-- de almacén, o sea los nombres, para que no haya problemas». Hasta hoy cada
-- insumo del RQ se escribía a mano («PINTURA GLOSS AMARILLO  MD», con dos
-- espacios): Almacén tenía que adivinar a cuál de sus materiales se refería,
-- Logística volvía a elegirlo del catálogo al hacer la OC, y el mismo material
-- quedaba con un nombre distinto en cada paso.
--
-- Desde aquí:
--   · Cada insumo se elige del catálogo de materiales de Almacén. El nombre, la
--     categoría y la unidad son los del catálogo; si la unidad del material
--     todavía es provisional, quien pide dice en qué unidad lo necesita.
--   · Lo que no está en el catálogo se pide como MATERIAL NUEVO, con su nombre,
--     unidad y categoría. Al revisar el stock, Almacén lo asocia a uno de sus
--     materiales o lo da de alta: desde ahí el insumo tiene su material y la OC
--     sale con el mismo nombre.
--   · Al revisar el stock, Almacén confirma la unidad provisional del material
--     con la del insumo, igual que cuando lo cuenta en la planilla: así
--     Logística ya lo puede comprar.
--
-- La pantalla que está en uso sigue andando: un insumo que llega escrito a mano,
-- sin material, entra como material nuevo y Almacén lo resuelve en su revisión.
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El material de cada insumo ------------------------------------------------------
-- Sin índice: nadie busca insumos por material y un material no se borra, se
-- desactiva (no cumple ninguna de las tres).
alter table public.requerimiento_lineas
  add column if not exists material_id    uuid references public.materiales(id) on delete restrict,
  add column if not exists material_nuevo boolean not null default false;
comment on column public.requerimiento_lineas.material_id is
  'El material del catálogo de Almacén que se pide. Vacío solo en un material nuevo que Almacén todavía no revisó, o en los insumos escritos a mano antes del 2026-10-16.';
comment on column public.requerimiento_lineas.material_nuevo is
  'Se pidió como material nuevo, porque no estaba en el catálogo. Almacén lo asocia a uno de sus materiales o lo da de alta al revisar el stock.';

-- Lo que se pidió no cambia; el material de un insumo nuevo lo pone Almacén una vez.
create or replace function public.fn_rq_linea_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un insumo del requerimiento no se borra: se anula el requerimiento.' using errcode = 'check_violation';
  end if;
  if row(new.requerimiento_id, new.item, new.descripcion, new.cantidad, new.unidad_medida_id, new.categoria_id, new.material_nuevo)
     is distinct from row(old.requerimiento_id, old.item, old.descripcion, old.cantidad, old.unidad_medida_id, old.categoria_id, old.material_nuevo) then
    raise exception 'Lo que se pidió en el requerimiento no cambia: si cambió, anúlalo y registra otro.'
      using errcode = 'check_violation';
  end if;
  if new.material_id is distinct from old.material_id and not (old.material_id is null and old.material_nuevo) then
    raise exception 'El material de este insumo ya quedó: si cambió, anula el requerimiento y registra otro.'
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

-- El mismo nombre escrito de dos maneras («Disco  de corte» y «DISCO DE CORTE»).
create or replace function public.nombre_de_material(p_texto text)
returns text language sql immutable set search_path to 'public' as $$
  select upper(regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g'));
$$;
revoke all on function public.nombre_de_material(text) from public, anon;
grant execute on function public.nombre_de_material(text) to authenticated;

-- 2. Registrar: cada insumo, del catálogo ------------------------------------------------
-- p_lineas, uno por insumo:
--   {material_id, cantidad, unidad_medida_id?}  un material del catálogo; la
--       unidad solo cuenta si la del material es provisional.
--   {nuevo: true, descripcion, cantidad, unidad_medida_id, categoria_id}  lo que
--       no está en el catálogo.
-- Un insumo sin material_id ni «nuevo» (la pantalla de antes) es un material nuevo.
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
  v_material public.materiales%rowtype;
  v_mat_id   uuid;
  v_nuevo    boolean;
  v_vistos   uuid[] := array[]::uuid[];
  v_nuevos   int := 0;
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
    if jsonb_typeof(v_linea) <> 'object' then
      raise exception 'Revisa el insumo %.', v_item using errcode = 'check_violation';
    end if;
    begin
      v_cant := (v_linea->>'cantidad')::numeric;
      v_unidad := nullif(v_linea->>'unidad_medida_id', '')::uuid;
      v_mat_id := nullif(v_linea->>'material_id', '')::uuid;
      v_cat := nullif(v_linea->>'categoria_id', '')::uuid;
    exception when others then
      raise exception 'Revisa el material, la cantidad y la unidad del insumo %.', v_item using errcode = 'check_violation';
    end;
    if v_cant is null or v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_item
        using errcode = 'check_violation';
    end if;

    v_nuevo := v_mat_id is null;
    if v_nuevo then
      -- Lo que no está en el catálogo: nombre, unidad y categoría de quien pide.
      v_desc := btrim(coalesce(v_linea->>'descripcion', ''));
      if char_length(v_desc) not between 3 and 300 then
        raise exception 'Escribe el nombre del material nuevo del insumo % (de 3 a 300 caracteres).', v_item
          using errcode = 'check_violation';
      end if;
      if v_unidad is null or not exists (select 1 from public.unidades_medida where id = v_unidad and activo) then
        raise exception 'Elige la unidad del insumo %.', v_item using errcode = 'check_violation';
      end if;
      if v_cat is null or not exists (select 1 from public.categorias_material
                                       where id = v_cat and activo and codigo <> 'ALM_POR_CLASIFICAR') then
        raise exception 'Elige la categoría del insumo %.', v_item using errcode = 'check_violation';
      end if;
      -- Escrito igual que uno del catálogo y en su unidad: es ese material.
      select * into v_material from public.materiales m
       where m.activo and m.unidad_medida_id = v_unidad
         and public.nombre_de_material(m.descripcion) = public.nombre_de_material(v_desc)
       order by m.unidad_pendiente, m.creado_en limit 1;
      if found then
        v_nuevo := false;
        v_mat_id := v_material.id;
        v_desc := left(btrim(v_material.descripcion), 300);
        v_cat := v_material.categoria_id;
      end if;
    else
      select * into v_material from public.materiales where id = v_mat_id;
      if not found or not v_material.activo then
        raise exception 'El material del insumo % ya no está en el catálogo de Almacén. Vuelve a elegirlo.', v_item
          using errcode = 'check_violation';
      end if;
      -- El nombre, la categoría y la unidad son los del catálogo. Si la unidad del
      -- material es provisional, vale la que dice quien pide.
      v_desc := left(btrim(v_material.descripcion), 300);
      if char_length(v_desc) < 3 then
        v_desc := left(v_material.codigo || ' · ' || v_desc, 300);
      end if;
      v_cat := v_material.categoria_id;
      if not v_material.unidad_pendiente or v_unidad is null then
        v_unidad := v_material.unidad_medida_id;
      elsif not exists (select 1 from public.unidades_medida where id = v_unidad and activo) then
        raise exception 'Elige la unidad del insumo %.', v_item using errcode = 'check_violation';
      end if;
    end if;

    if v_mat_id is not null then
      if v_mat_id = any (v_vistos) then
        raise exception '«%» está dos veces en el requerimiento: suma las cantidades en un solo insumo.', v_desc
          using errcode = 'check_violation';
      end if;
      v_vistos := v_vistos || v_mat_id;
    end if;
    if v_nuevo then
      v_nuevos := v_nuevos + 1;
    end if;

    insert into public.requerimiento_lineas
      (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id, material_id, material_nuevo)
    values (p_id, v_item, v_desc, v_cant, v_unidad, v_cat, v_mat_id, v_nuevo);
  end loop;

  -- Los dos pasan primero por Almacén, que revisa el stock de cada insumo.
  select * into v_actual from public.requerimientos where id = p_id;
  perform public.fn_rq_avisar(v_actual, 'Requerimiento por revisar: ' || v_numero,
    v_area.nombre || ' · ' || btrim(p_codigo_interno) || ' · ' || v_item || case when v_item = 1 then ' insumo' else ' insumos' end
      || case when v_nuevos = 0 then '' when v_nuevos = 1 then ', uno es un material nuevo' else ', ' || v_nuevos || ' son materiales nuevos' end
      || '. Revisa cuánto hay de cada uno.', 'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.emitir_requerimiento(uuid, text, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.emitir_requerimiento(uuid, text, uuid, text, text, date, jsonb) to authenticated;

-- 3. Almacén revisa cada insumo y resuelve los materiales nuevos ---------------------------
-- p_lineas: [{item, en_stock, material_id?}, …], uno por cada insumo del RQ.
-- material_id solo en un material nuevo: el del catálogo al que corresponde. Sin
-- él, Almacén lo da de alta con lo que pidió el área (o toma el que ya se llame
-- igual en la misma unidad). Un material con la unidad provisional queda con la
-- unidad del insumo.
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
  v_linea    record;
  v_elegido  text;
  v_material public.materiales%rowtype;
  v_unidad   text;
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
  if exists (select 1 from jsonb_array_elements(p_lineas) x
              where nullif(x->>'material_id', '') is not null
                and x->>'material_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    raise exception 'Vuelve a elegir el material de los insumos nuevos.' using errcode = 'check_violation';
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

  -- Cada insumo con su material del catálogo, antes de anotar el stock.
  for v_linea in
    select l.*, nullif(x->>'material_id', '')::uuid as elegido, um.codigo as unidad_codigo
      from public.requerimiento_lineas l
      join jsonb_array_elements(p_lineas) x on (x->>'item')::int = l.item
      left join public.unidades_medida um on um.id = l.unidad_medida_id
     where l.requerimiento_id = p_id
     order by l.item
  loop
    if v_linea.material_id is null and v_linea.material_nuevo then
      if v_linea.elegido is not null then
        select * into v_material from public.materiales where id = v_linea.elegido and activo;
        if not found then
          raise exception 'El material que elegiste para el insumo % ya no está activo. Elige otro o deja que se dé de alta.', v_linea.item
            using errcode = 'check_violation';
        end if;
        if not v_material.unidad_pendiente and v_material.unidad_medida_id <> v_linea.unidad_medida_id then
          select codigo into v_unidad from public.unidades_medida where id = v_material.unidad_medida_id;
          raise exception '«%» se cuenta en % y el insumo % se pidió en %: elige otro material o deja que se dé de alta como nuevo.',
            v_material.descripcion, coalesce(v_unidad, 'otra unidad'), v_linea.item, coalesce(v_linea.unidad_codigo, 'otra unidad')
            using errcode = 'check_violation';
        end if;
      else
        -- El mismo nombre en la misma unidad es el mismo material: no se duplica.
        select * into v_material from public.materiales m
         where m.activo and m.unidad_medida_id = v_linea.unidad_medida_id
           and public.nombre_de_material(m.descripcion) = public.nombre_de_material(v_linea.descripcion)
         order by m.unidad_pendiente, m.creado_en limit 1;
        if not found then
          v_material.id := gen_random_uuid();
          insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo,
                                         creado_por, observaciones)
          values (v_material.id, 'PROV-' || upper(left(replace(v_material.id::text, '-', ''), 10)), btrim(v_linea.descripcion),
                  v_linea.categoria_id, v_linea.unidad_medida_id, false, true, v_yo,
                  left('Dado de alta por Almacén desde el requerimiento ' || v_rq.numero || '; falta revisar su código.', 500));
          select * into v_material from public.materiales where id = v_material.id;
        end if;
      end if;
      update public.requerimiento_lineas set material_id = v_material.id where id = v_linea.id;
    elsif v_linea.elegido is not null and v_linea.elegido is distinct from v_linea.material_id then
      raise exception 'El insumo % ya tiene su material del catálogo: no se cambia en la revisión.', v_linea.item
        using errcode = 'check_violation';
    else
      select * into v_material from public.materiales where id = v_linea.material_id;
    end if;

    -- Revisarlo confirma la unidad que seguía provisional, como al contarlo.
    if v_material.id is not null and v_material.unidad_pendiente then
      if v_material.unidad_medida_id <> v_linea.unidad_medida_id
         and exists (select 1 from public.movimientos_materiales where material_id = v_material.id) then
        raise exception 'El material % ya tiene movimientos en otra unidad: corrige su unidad en el catálogo antes de revisar el insumo %.',
          v_material.codigo, v_linea.item using errcode = 'check_violation';
      end if;
      update public.materiales set unidad_medida_id = v_linea.unidad_medida_id, unidad_pendiente = false
       where id = v_material.id;
    end if;
    v_material := null;
  end loop;

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

-- 4. La salida del kardex sabe qué material es cada insumo ---------------------------------
-- La columna nueva va al final (create or replace view solo agrega al final).
create or replace view public.v_rq_lineas_para_salida with (security_invoker = true) as
select l.id as linea_id, r.id as requerimiento_id, r.numero, r.codigo_interno, a.nombre as area, r.estado,
       r.fecha_requerida, l.item, l.descripcion, l.cantidad::numeric as cantidad, um.codigo as unidad,
       c.nombre as categoria, c.almacen,
       coalesce(s.entregado, 0)::numeric as entregado,
       greatest(l.cantidad - coalesce(s.entregado, 0), 0)::numeric as pendiente,
       l.material_id
  from public.requerimiento_lineas l
  join public.requerimientos r on r.id = l.requerimiento_id
  join public.areas a on a.id = r.area_id
  join public.unidades_medida um on um.id = l.unidad_medida_id
  join public.categorias_material c on c.id = l.categoria_id
  left join lateral (
    select sum(m.cantidad) filter (where m.tipo = 'SALIDA')
         - coalesce(sum(d.cantidad), 0) as entregado
      from public.movimientos_materiales m
      left join public.movimientos_materiales d on d.devolucion_de = m.id and d.tipo = 'INGRESO'
     where m.requerimiento_linea_id = l.id) s on true
 where r.estado not in ('ANULADO', 'ENTREGADO');
revoke all on public.v_rq_lineas_para_salida from public, anon;
grant select on public.v_rq_lineas_para_salida to authenticated;
