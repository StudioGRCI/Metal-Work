-- Los documentos numerados y la caja reconocen su mismo envío por lo que se
-- escribió, y lo distinto dice que ya quedó.
--
-- La pantalla de la OS, la OC directa, la OC de insumos de RQ, la OC de
-- atención de materiales, el RQ y el subcontrato decidía el id del envío al
-- abrir la ventana: tras «No llegó la respuesta», cancelar y volver a abrir
-- llevaba otro, y si el primero había entrado salía otro documento numerado con
-- lo mismo, que ya no se puede borrar (lo encontró la decimoquinta pasada de los
-- auditores, el 2026-10-23). Ahora el id vive fuera de la ventana y vuelve con
-- ella hasta saber cómo terminó; la caja diaria ya lo hacía así desde la
-- decimoquinta.
--
-- Eso pide que la base compare todo lo que se escribe. Cada función reconocía el
-- id repetido mirando solo una parte: el RQ no miraba la fecha ni los insumos;
-- la OC, la referencia, la entrega ni el pago; la OS, la OT, el código, las
-- fechas ni la detracción; el subcontrato, el código, el trabajo ni las fechas;
-- y la caja no miraba nada. Lo cambiado en esas partes se daba por registrado y
-- no se guardaba, y la OC con su comprobante cambiaba en silencio el comprobante
-- y el código de la orden que ya había quedado.
--
-- Ahora el mismo envío repetido devuelve el mismo documento, y otro envío de la
-- misma persona con el mismo id dice que el primero ya quedó, como el cobro y el
-- pago (20261022195000): la pantalla lo muestra sin rojo, traba la ventana y la
-- pone al día al cerrarla. El de otra persona con el mismo id sigue diciendo que
-- ya existe con otros datos.
--
-- Cada función va entera, tal como queda después de todas las migraciones
-- anteriores; cambia solo lo que reconoce el id. `create or replace` conserva
-- los permisos de cada una.
--
-- Antes de reemplazarlas se mira que cada una sea la que el repositorio conoce
-- (su texto antes o después de este cambio, sin los `\r` de un pegado desde
-- Windows). Si alguna se cambió a mano en la base, la migración se detiene en
-- vez de pisar ese cambio sin que nadie lo vea.
do $$
declare
  conocidas constant jsonb := '{
    "crear_compra_agrupada(uuid,text,text,jsonb,date,text,integer,text)": ["9819a67502398f48004ff34b7bd87116", "51fff96f8d17253a55c6eb289361a093"],
    "emitir_compra_agrupada(uuid,uuid,text,jsonb,date,text,integer,text)": ["fb4e480fb416b95ce2fac834ab178492", "5d7a06de339ec686806b3e18bcdd06f9"],
    "emitir_compra_agrupada(uuid,uuid,text,jsonb,date,text,integer,text,boolean,text)": ["a798ab67698852ecc0b350723ddb5102", "308d343f977b56a4010bf4a241f051ad"],
    "emitir_compra_directa(uuid,uuid,text,text,jsonb,date,text,integer,text)": ["f88bcabd99ff7128f515fe77f4332a43", "e1b2803ceced5d51b5863e8fb24c7d24"],
    "emitir_compra_directa(uuid,uuid,text,text,jsonb,date,text,integer,text,boolean,text)": ["82ba581f5e5df093d611f5b9d7777a9a", "681bea52f3ec29c2908808821e179257"],
    "emitir_orden_servicio(uuid,uuid,uuid,uuid,text,text,text,date,date,text,numeric,text,integer,text,text)": ["c0e2aad4cd0eeb3e7d9fbda4c18dfcff", "ad342256d0aabd9ae3a2883e234fa244"],
    "emitir_requerimiento(uuid,text,uuid,text,text,date,jsonb)": ["8bc92408ecd5674e5a9cb75d028baef9", "59cf1285147eaf00fd7dde0036dbc968"],
    "registrar_movimiento_caja(uuid,uuid,date,text,numeric,text,text,text,numeric)": ["fd09f88876ab24d07fdad35e9d622c4a", "449ad49229f4b6288bcdcbecfe3105ea"],
    "registrar_subcontrato(uuid,uuid,text,text,text,numeric,date,date,text)": ["e59d1d42acbe0d72c2642e7fdc4bdd8a", "76d54709805cb37ea31abb65a884ad2b"],
    "registrar_transferencia_caja(uuid,uuid,uuid,date,numeric,numeric,text,text)": ["3dbecb78b9ef85fba2d7036a0e3cce04", "7f68125160eefbce317a030a2eff3716"]
  }';
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

-- emitir_requerimiento: la fecha y cada insumo también cuentan
create or replace function public.emitir_requerimiento(p_id uuid, p_tipo text, p_area_id uuid, p_codigo_interno text, p_justificacion text, p_fecha_requerida date, p_lineas jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if v_actual.creado_por is distinct from public.usuario_actual() then
      raise exception 'Este requerimiento ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- Un reintento del mismo formulario no duplica el requerimiento. Con algo
    -- cambiado ya no es el mismo envío: el primero quedó y lo nuevo no se guarda.
    -- Cada insumo se mira con lo que se escribió: el del catálogo, por su
    -- material; el nuevo, por su nombre y su unidad (la base pudo reconocerlo
    -- en el catálogo al registrarlo).
    if v_actual.tipo = p_tipo and v_actual.area_id = p_area_id
       and v_actual.codigo_interno = btrim(p_codigo_interno) and v_actual.justificacion = btrim(p_justificacion)
       and v_actual.fecha_requerida is not distinct from p_fecha_requerida
       and (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = p_id) = jsonb_array_length(p_lineas)
       and not exists (
         select 1
           from jsonb_array_elements(p_lineas) with ordinality as x(linea, item)
           left join public.requerimiento_lineas l on l.requerimiento_id = p_id and l.item = x.item
          where l.id is null
             or l.cantidad is distinct from
                  case when x.linea->>'cantidad' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (x.linea->>'cantidad')::numeric end
             or case when nullif(x.linea->>'material_id', '') is not null
                     then l.material_id::text is distinct from lower(btrim(x.linea->>'material_id'))
                     else public.nombre_de_material(l.descripcion)
                            is distinct from public.nombre_de_material(btrim(coalesce(x.linea->>'descripcion', '')))
                          or l.unidad_medida_id::text is distinct from lower(nullif(btrim(x.linea->>'unidad_medida_id'), ''))
                          or (l.material_nuevo and l.categoria_id::text is distinct from lower(nullif(btrim(x.linea->>'categoria_id'), '')))
                end) then
      return p_id;
    end if;
    raise exception 'Este requerimiento ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
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
$function$;

-- emitir_compra_directa: la referencia, la entrega y el pago también cuentan
create or replace function public.emitir_compra_directa(p_id uuid, p_proveedor_id uuid, p_referencia text, p_motivo text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proveedor public.proveedores%rowtype;
  v_actual    public.ordenes_compra_materiales%rowtype;
  v_linea     record;
  v_numero    text;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or jsonb_typeof(p_detalles) is distinct from 'array' then
    raise exception 'Completa el proveedor y las líneas de la compra.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 5 and 500 then
    raise exception 'Cuenta por qué se compra sin requerimiento (de 5 a 500 caracteres): Gerencia lo lee al aprobar.'
      using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_referencia), '') is not null and char_length(btrim(p_referencia)) not between 2 and 100 then
    raise exception 'La referencia del proveedor va de 2 a 100 caracteres.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_detalles) not between 1 and 100 then
    raise exception 'La compra lleva entre una y cien líneas.' using errcode = 'check_violation';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null or p_dias not between 0 and 365
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias = 0)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica la moneda y el plazo de pago válidos.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x.material_id) from jsonb_to_recordset(p_detalles) x(material_id uuid)) <> jsonb_array_length(p_detalles) then
    raise exception 'No repitas un material en la misma compra: suma las cantidades en una línea.' using errcode = 'check_violation';
  end if;

  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_compra_materiales where id = p_id;
  if found then
    if v_actual.creado_por is distinct from public.usuario_actual() then
      raise exception 'Esta compra ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- Un reintento de la misma compra devuelve la misma compra. Con algo
    -- cambiado ya no es el mismo envío: el primero quedó y lo nuevo no se guarda.
    if v_actual.origen = 'DIRECTA'
       and v_actual.proveedor_id = p_proveedor_id and v_actual.motivo = btrim(p_motivo)
       and v_actual.referencia = coalesce(nullif(btrim(p_referencia), ''), v_actual.numero)
       and v_actual.fecha_estimada is not distinct from p_fecha and v_actual.condicion_pago = p_condicion
       and v_actual.dias_credito = p_dias and v_actual.moneda = p_moneda
       and (select jsonb_agg(jsonb_build_object('m', d.material_id, 'c', d.cantidad, 'p', d.precio_unitario) order by d.material_id)
              from public.orden_compra_material_detalles d where d.orden_compra_id = p_id)
         = (select jsonb_agg(jsonb_build_object('m', x.material_id, 'c', x.cantidad, 'p', x.precio) order by x.material_id)
              from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)) then
      return p_id;
    end if;
    raise exception 'Esta orden de compra ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;
  for v_linea in select * from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric) loop
    if v_linea.material_id is null or v_linea.cantidad is null or v_linea.cantidad <= 0 or v_linea.cantidad <> round(v_linea.cantidad, 3)
       or v_linea.precio is null or v_linea.precio < 0 or v_linea.precio <> round(v_linea.precio, 2) then
      raise exception 'Cada línea necesita material, cantidad y precio unitario válidos.' using errcode = 'check_violation';
    end if;
  end loop;

  v_numero := public.siguiente_correlativo('ORDEN_COMPRA', '001', null);
  insert into public.ordenes_compra_materiales
    (id, requerimiento_id, origen, numero, proveedor, proveedor_id, referencia, motivo,
     fecha_estimada, creado_por, condicion_pago, dias_credito, moneda)
  values
    (p_id, null, 'DIRECTA', v_numero, v_proveedor.razon_social, p_proveedor_id,
     coalesce(nullif(btrim(p_referencia), ''), v_numero), btrim(p_motivo),
     p_fecha, public.usuario_actual(), p_condicion, p_dias, p_moneda);
  insert into public.orden_compra_material_detalles (orden_compra_id, material_id, cantidad, precio_unitario)
  select p_id, x.material_id, x.cantidad, x.precio
    from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)
   order by x.material_id;
  return p_id;
end;
$function$;

-- emitir_compra_directa con su comprobante: el comprobante y el código también cuentan
create or replace function public.emitir_compra_directa(p_id uuid, p_proveedor_id uuid, p_referencia text, p_motivo text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean, p_codigo_interno text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.exigir_permiso('compras.crear');
  perform public.validar_datos_de_compra(p_con_factura, p_codigo_interno);
  -- Un reintento con el comprobante o el código cambiados ya no es el mismo
  -- envío: antes se cambiaban en la orden que ya había quedado, sin decirlo.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  if exists (select 1 from public.ordenes_compra_materiales c
              where c.id = p_id and c.creado_por = public.usuario_actual()
                and (c.con_factura is distinct from p_con_factura
                     or (c.codigo_interno is not null and c.codigo_interno is distinct from btrim(p_codigo_interno)))) then
    raise exception 'Esta orden de compra ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  perform public.emitir_compra_directa(p_id, p_proveedor_id, p_referencia, p_motivo, p_detalles,
                                       p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales
     set con_factura = p_con_factura, codigo_interno = btrim(p_codigo_interno)
   where id = p_id
     and (con_factura is distinct from p_con_factura or codigo_interno is distinct from btrim(p_codigo_interno));
  return p_id;
end;
$function$;

-- emitir_compra_agrupada con su comprobante: el comprobante y el código también cuentan
create or replace function public.emitir_compra_agrupada(p_id uuid, p_proveedor_id uuid, p_referencia text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean, p_codigo_interno text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.exigir_permiso('compras.crear');
  perform public.validar_datos_de_compra(p_con_factura, p_codigo_interno);
  -- Un reintento con el comprobante o el código cambiados ya no es el mismo
  -- envío: antes se cambiaban en la orden que ya había quedado, sin decirlo.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  if exists (select 1 from public.ordenes_compra_materiales c
              where c.id = p_id and c.creado_por = public.usuario_actual()
                and (c.con_factura is distinct from p_con_factura
                     or (c.codigo_interno is not null and c.codigo_interno is distinct from btrim(p_codigo_interno)))) then
    raise exception 'Esta orden de compra ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  perform public.emitir_compra_agrupada(p_id, p_proveedor_id, p_referencia, p_detalles,
                                        p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales
     set con_factura = p_con_factura, codigo_interno = btrim(p_codigo_interno)
   where id = p_id
     and (con_factura is distinct from p_con_factura or codigo_interno is distinct from btrim(p_codigo_interno));
  return p_id;
end;
$function$;

-- emitir_compra_agrupada: otro proveedor en el reintento de quien la emitió es que ya quedó
create or replace function public.emitir_compra_agrupada(p_id uuid, p_proveedor_id uuid, p_referencia text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_proveedor public.proveedores%rowtype; v_actual uuid;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.';
  end if;
  -- Un reintento de la misma compra no choca con su propio proveedor.
  select proveedor_id into v_actual from public.ordenes_compra_materiales where id = p_id;
  if found and v_actual is distinct from p_proveedor_id then
    if exists (select 1 from public.ordenes_compra_materiales where id = p_id and creado_por = public.usuario_actual()) then
      raise exception 'Esta orden de compra ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
    end if;
    raise exception 'Esta compra ya existe con otro proveedor. Recarga antes de intentar de nuevo.';
  end if;
  if not found and not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;

  perform public.crear_compra_agrupada(p_id, v_proveedor.razon_social, p_referencia, p_detalles,
                                       p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales set proveedor_id = p_proveedor_id
   where id = p_id and proveedor_id is null;
  return p_id;
end;
$function$;

-- crear_compra_agrupada: lo cambiado en el reintento de quien la emitió es que ya quedó
create or replace function public.crear_compra_agrupada(p_id uuid, p_proveedor text, p_referencia text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ancla uuid; v_actual public.ordenes_compra_materiales%rowtype; v_linea record; v_req uuid;
begin
 perform public.exigir_permiso('compras.crear');
 if p_id is null or length(btrim(coalesce(p_proveedor,''))) not between 2 and 160
 or length(btrim(coalesce(p_referencia,''))) not between 2 and 100
 or jsonb_typeof(p_detalles) is distinct from 'array' then raise exception 'Completa proveedor, referencia y líneas de compra.'; end if;
 if jsonb_array_length(p_detalles) not between 1 and 100 then raise exception 'Selecciona entre una y cien líneas.'; end if;
 if p_condicion is null or p_condicion not in('CONTADO','CREDITO') or p_dias is null or p_dias not between 0 and 365
 or (p_condicion='CONTADO' and p_dias<>0) or (p_condicion='CREDITO' and p_dias=0)
 or p_moneda is null or p_moneda not in('PEN','USD') then raise exception 'Indica la moneda y el plazo de pago válidos.'; end if;
 if (select count(distinct x.id) from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric))<>jsonb_array_length(p_detalles)
 then raise exception 'No repitas un material de la misma solicitud.'; end if;
 -- Serializa los reintentos antes de consultar cabecera y las líneas en orden.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_actual from public.ordenes_compra_materiales where id=p_id;
 if found then
   if v_actual.creado_por is distinct from public.usuario_actual() then
     raise exception 'Esta compra ya existe con otros datos. Recarga antes de intentar de nuevo.';
   end if;
   -- Con algo cambiado ya no es el mismo envío: el primero quedó y lo nuevo no se guarda.
   if v_actual.proveedor=btrim(p_proveedor) and v_actual.referencia=btrim(p_referencia)
   and v_actual.fecha_estimada is not distinct from p_fecha and v_actual.condicion_pago=p_condicion and v_actual.dias_credito=p_dias and v_actual.moneda=p_moneda
   and (select jsonb_agg(jsonb_build_object('id',d.requerimiento_detalle_id,'cantidad',d.cantidad,'precio',d.precio_unitario) order by d.requerimiento_detalle_id) from public.orden_compra_material_detalles d where d.orden_compra_id=p_id)
     =(select jsonb_agg(jsonb_build_object('id',x.id,'cantidad',x.cantidad,'precio',x.precio) order by x.id) from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric))
   then return p_id; end if;
   raise exception 'Esta orden de compra ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
 end if;
 for v_linea in select * from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric) order by id loop
   if v_linea.cantidad is null or v_linea.cantidad<=0 or v_linea.cantidad<>round(v_linea.cantidad,3)
   or v_linea.precio is null or v_linea.precio<0 or v_linea.precio<>round(v_linea.precio,2) then raise exception 'Cada línea necesita cantidad y precio unitario válidos.'; end if;
   select d.requerimiento_id into v_req from public.requerimiento_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id
   where d.id=v_linea.id and public.puede_ver_area_material(r.area_destino) for update of d;
   if not found then raise exception 'La solicitud no está disponible para tu perfil.'; end if;
   v_ancla:=coalesce(v_ancla,v_req);
 end loop;
 insert into public.ordenes_compra_materiales(id,requerimiento_id,proveedor,referencia,fecha_estimada,creado_por,condicion_pago,dias_credito,moneda)
 values(p_id,v_ancla,btrim(p_proveedor),btrim(p_referencia),p_fecha,public.usuario_actual(),p_condicion,p_dias,p_moneda);
 insert into public.orden_compra_material_detalles(orden_compra_id,requerimiento_id,requerimiento_detalle_id,cantidad,precio_unitario)
 select p_id,d.requerimiento_id,x.id,x.cantidad,x.precio from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric)
 join public.requerimiento_material_detalles d on d.id=x.id order by x.id;
 return p_id;
end $function$;

-- emitir_orden_servicio: la OT, el área, el código, la referencia, las fechas, el pago y la detracción también cuentan
create or replace function public.emitir_orden_servicio(p_id uuid, p_proveedor_id uuid, p_orden_id uuid, p_area_id uuid, p_codigo_interno text, p_descripcion text, p_referencia text, p_fecha_inicio date, p_fecha_fin date, p_moneda text, p_monto numeric, p_condicion text, p_dias integer, p_detraccion text, p_motivo_detraccion text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proveedor public.proveedores%rowtype;
  v_actual    public.ordenes_servicio%rowtype;
  v_regla     public.regla_aprobacion_compras%rowtype;
  v_det       record;
  v_numero    text;
  v_tc        numeric;
  v_pen       numeric;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or char_length(btrim(coalesce(p_descripcion, ''))) not between 10 and 1000 then
    raise exception 'Describe el servicio en al menos 10 caracteres: qué se hace, a qué pieza o unidad.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto < 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica el monto sin IGV y la moneda.' using errcode = 'check_violation';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias not between 1 and 365) then
    raise exception 'Indica el plazo de pago válido.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede ser anterior a la de inicio.' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_referencia), '') is not null and char_length(btrim(p_referencia)) not between 2 and 100 then
    raise exception 'La referencia del proveedor va de 2 a 100 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_det from public.detraccion_elegida(p_detraccion, p_motivo_detraccion);
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_servicio where id = p_id;
  if found then
    if v_actual.creado_por is distinct from public.usuario_actual() then
      raise exception 'Esta orden de servicio ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- Un reintento de la misma orden la devuelve. Con algo cambiado ya no es el
    -- mismo envío: el primero quedó y lo nuevo no se guarda.
    if v_actual.proveedor_id = p_proveedor_id
       and v_actual.descripcion = btrim(p_descripcion) and v_actual.monto = p_monto and v_actual.moneda = p_moneda
       and v_actual.orden_id is not distinct from p_orden_id and v_actual.area_id is not distinct from p_area_id
       and v_actual.codigo_interno = btrim(p_codigo_interno)
       and v_actual.referencia is not distinct from nullif(btrim(p_referencia), '')
       and v_actual.fecha_inicio is not distinct from p_fecha_inicio and v_actual.fecha_fin is not distinct from p_fecha_fin
       and v_actual.condicion_pago = p_condicion and v_actual.dias_credito = p_dias
       and v_actual.detraccion_afecta is not distinct from v_det.afecta
       and v_actual.detraccion_codigo is not distinct from v_det.codigo
       and v_actual.detraccion_motivo is not distinct from v_det.motivo then
      return p_id;
    end if;
    raise exception 'Esta orden de servicio ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;
  if p_orden_id is not null and not exists (
      select 1 from public.ordenes_trabajo where id = p_orden_id and estado::text not in ('ANULADA', 'BORRADOR')) then
    raise exception 'La OT elegida no está vigente. Quítala o elige otra.' using errcode = 'check_violation';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id) then
    raise exception 'El área elegida no existe.' using errcode = 'check_violation';
  end if;

  if p_moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(p_monto * v_tc, 2) end;
  else
    v_pen := p_monto;
  end if;

  v_numero := public.siguiente_correlativo('ORDEN_SERVICIO', '001', null);
  insert into public.ordenes_servicio
    (id, numero, proveedor_id, proveedor, orden_id, area_id, codigo_interno, descripcion, referencia, fecha_inicio, fecha_fin,
     moneda, monto, monto_pen, condicion_pago, dias_credito, detraccion_afecta, detraccion_codigo, detraccion_porcentaje,
     detraccion_minimo, detraccion_motivo, creado_por)
  values
    (p_id, v_numero, p_proveedor_id, v_proveedor.razon_social, p_orden_id, p_area_id, btrim(p_codigo_interno),
     btrim(p_descripcion), nullif(btrim(p_referencia), ''), p_fecha_inicio, p_fecha_fin, p_moneda, p_monto, v_pen,
     p_condicion, p_dias, v_det.afecta, v_det.codigo, v_det.porcentaje, v_det.minimo, v_det.motivo,
     public.usuario_actual());

  select * into v_regla from public.regla_aprobacion_compras where unica;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Servicio por aprobar: ' || v_numero,
         v_proveedor.razon_social || ' · ' || btrim(p_codigo_interno) || ' · '
           || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), p_moneda || ' sin tipo de cambio'),
         '/compras/aprobacion', 'ordenes_servicio', p_id
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id and u.id is distinct from public.usuario_actual();
  return p_id;
end;
$function$;

-- registrar_subcontrato: el código, el trabajo y las fechas también cuentan
create or replace function public.registrar_subcontrato(p_id uuid, p_subcontratista_id uuid, p_codigo_interno text, p_descripcion text, p_moneda text, p_monto numeric, p_fecha_inicio date, p_fecha_fin date, p_area text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sub     public.subcontratistas%rowtype;
  v_actual  public.subcontratos%rowtype;
  v_codigo  text := public.normalizar_codigo_interno(p_codigo_interno);
  v_area    uuid;
  v_numero  text;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del subcontrato.' using errcode = 'check_violation'; end if;
  perform public.subcontrato_datos_validos(p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin);
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then raise exception 'Elige la moneda de lo pactado.' using errcode = 'check_violation'; end if;
  v_area := public.subcontrato_area(p_area);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.subcontratos where id = p_id;
  if found then
    if v_actual.creado_por is distinct from public.usuario_actual() then
      raise exception 'Este subcontrato ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El reintento del mismo formulario no registra otro. Con algo cambiado ya
    -- no es el mismo envío: el primero quedó y lo nuevo no se guarda.
    if v_actual.subcontratista_id = p_subcontratista_id
       and v_actual.monto = p_monto and v_actual.moneda = p_moneda and v_actual.area_id is not distinct from v_area
       and v_actual.codigo_interno = v_codigo and v_actual.descripcion = btrim(p_descripcion)
       and v_actual.fecha_inicio is not distinct from p_fecha_inicio and v_actual.fecha_fin is not distinct from p_fecha_fin then
      return p_id;
    end if;
    raise exception 'Este subcontrato ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select * into v_sub from public.subcontratistas where id = p_subcontratista_id;
  if not found then raise exception 'Elige un subcontratista del padrón.' using errcode = 'check_violation'; end if;
  if not v_sub.activo then raise exception '% está dado de baja en el padrón: reactívalo o elige otro.', v_sub.nombre using errcode = 'check_violation'; end if;
  v_numero := public.siguiente_correlativo('SUBCONTRATO', '001', null);
  insert into public.subcontratos (id, numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, fecha_inicio, fecha_fin, area_id)
  values (p_id, v_numero, p_subcontratista_id, v_codigo, btrim(p_descripcion), p_moneda, p_monto, p_fecha_inicio, p_fecha_fin, v_area);
  perform public.avisar_area_del_subcontrato(v_area,
    'Subcontrato para tu área: ' || v_numero,
    format('%s hará «%s» en %s.', v_sub.nombre, left(btrim(p_descripcion), 140), v_codigo),
    p_id);
  return p_id;
end; $function$;

-- registrar_movimiento_caja: el id repetido se reconoce por lo que se escribió
create or replace function public.registrar_movimiento_caja(p_id uuid, p_caja_id uuid, p_fecha date, p_tipo text, p_monto numeric, p_descripcion text, p_codigo_interno text, p_operacion text, p_tipo_cambio numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caja    public.cajas%rowtype;
  v_tipo    text := upper(btrim(coalesce(p_tipo, '')));
  v_desc    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_codigo  text := public.normalizar_codigo_interno(p_codigo_interno);
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_actual  public.movimientos_caja%rowtype;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del movimiento.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta se perdió) devuelve el mismo
  -- movimiento. Con algo cambiado ya no es el mismo envío: antes se daba por
  -- registrado sin guardarse, y la pantalla conserva el id al cerrar y volver a
  -- abrir la ventana.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.movimientos_caja where id = p_id;
  if found then
    if v_actual.registrado_por is distinct from public.usuario_actual() or v_actual.origen <> 'MANUAL' then
      raise exception 'Este movimiento ya existe con otros datos. Recarga la pantalla.';
    end if;
    if v_actual.caja_id = p_caja_id and v_actual.fecha = p_fecha and v_actual.tipo = v_tipo and v_actual.monto = p_monto
       and v_actual.descripcion = v_desc and v_actual.codigo_interno is not distinct from v_codigo
       and v_actual.operacion is not distinct from v_op
       and v_actual.tipo_cambio is not distinct from round(p_tipo_cambio, 4) then
      return p_id;
    end if;
    raise exception 'Este movimiento ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if v_tipo not in ('INGRESO', 'EGRESO') then
    raise exception 'Elige si es un ingreso o un egreso.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'El monto va mayor que cero, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 3 and 300 then
    raise exception 'Describe el movimiento como en el estado de cuenta, de 3 a 300 caracteres: «ITF», «OC-0001-MW Ferretería…».'
      using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if p_tipo_cambio is not null and p_tipo_cambio not between 2 and 6 then
    raise exception 'El tipo de cambio va en soles por dólar, entre 2 y 6, como 3.750.' using errcode = 'check_violation';
  end if;
  v_caja := public.caja_dia_abierto(p_caja_id, p_fecha);
  if not v_caja.activa then
    raise exception 'La cuenta % está desactivada: actívala para registrarle movimientos.', v_caja.nombre using errcode = 'check_violation';
  end if;

  insert into public.movimientos_caja (id, caja_id, fecha, tipo, monto, descripcion, codigo_interno, operacion, tipo_cambio)
  values (p_id, p_caja_id, p_fecha, v_tipo, p_monto, v_desc, v_codigo, v_op, round(p_tipo_cambio, 4));
  return p_id;
end;
$function$;

-- registrar_transferencia_caja: el id repetido se reconoce por lo que se escribió
create or replace function public.registrar_transferencia_caja(p_id uuid, p_origen uuid, p_destino uuid, p_fecha date, p_monto numeric, p_monto_destino numeric, p_descripcion text, p_operacion text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale    public.cajas%rowtype;
  v_entra   public.cajas%rowtype;
  v_desc    text := nullif(regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g'), '');
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_destino numeric;
  v_cambio  numeric;
  v_salio   public.movimientos_caja%rowtype;
  v_entro   public.movimientos_caja%rowtype;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la transferencia.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido devuelve la misma transferencia. Con algo cambiado
  -- ya no es el mismo envío: antes se daba por registrada sin guardarse.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_salio from public.movimientos_caja
   where origen = 'TRANSFERENCIA' and origen_id = p_id and tipo = 'EGRESO';
  if found then
    select * into v_entro from public.movimientos_caja
     where origen = 'TRANSFERENCIA' and origen_id = p_id and tipo = 'INGRESO';
    if v_salio.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta transferencia ya existe con otros datos. Recarga la pantalla.';
    end if;
    -- Entre cuentas de la misma moneda, lo que entra es lo que sale.
    if v_salio.caja_id = p_origen and v_entro.caja_id = p_destino and v_salio.fecha = p_fecha
       and v_salio.monto = p_monto and (v_salio.tipo_cambio is null or v_entro.monto = p_monto_destino)
       and v_salio.descripcion = coalesce(v_desc, 'Transferencia entre cuentas')
       and v_salio.operacion is not distinct from v_op then
      return p_id;
    end if;
    raise exception 'Esta transferencia ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then
    raise exception 'Elige la cuenta de la que sale y otra a la que entra.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'El monto va mayor que cero, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if v_desc is not null and char_length(v_desc) not between 3 and 300 then
    raise exception 'La descripción va de 3 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  -- Las dos cuentas se bloquean siempre en el mismo orden.
  if p_origen < p_destino then
    v_sale := public.caja_dia_abierto(p_origen, p_fecha);
    v_entra := public.caja_dia_abierto(p_destino, p_fecha);
  else
    v_entra := public.caja_dia_abierto(p_destino, p_fecha);
    v_sale := public.caja_dia_abierto(p_origen, p_fecha);
  end if;
  if not v_sale.activa or not v_entra.activa then
    raise exception 'La cuenta % está desactivada: actívala para registrarle movimientos.',
      case when not v_sale.activa then v_sale.nombre else v_entra.nombre end using errcode = 'check_violation';
  end if;

  if v_sale.moneda = v_entra.moneda then
    v_destino := p_monto;
  else
    if p_monto_destino is null or p_monto_destino <= 0 or p_monto_destino > 999999999
       or p_monto_destino <> round(p_monto_destino, 2) then
      raise exception 'Escribe cuánto entró a %, en %, como dice el voucher.', v_entra.nombre,
        case when v_entra.moneda = 'USD' then 'dólares' else 'soles' end using errcode = 'check_violation';
    end if;
    v_destino := p_monto_destino;
    v_cambio := round(case when v_sale.moneda = 'PEN' then p_monto / p_monto_destino else p_monto_destino / p_monto end, 4);
    -- Un dólar fuera de S/ 2 a S/ 6 es un monto mal escrito, no un cambio.
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa cuánto salió y cuánto entró.', round(v_cambio, 3)
        using errcode = 'check_violation';
    end if;
  end if;
  v_desc := coalesce(v_desc, 'Transferencia entre cuentas');

  insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, operacion, tipo_cambio, origen, origen_id)
  values (p_origen, p_fecha, 'EGRESO', p_monto, v_desc, v_op, v_cambio, 'TRANSFERENCIA', p_id),
         (p_destino, p_fecha, 'INGRESO', v_destino, v_desc, v_op, v_cambio, 'TRANSFERENCIA', p_id);
  return p_id;
end;
$function$;
