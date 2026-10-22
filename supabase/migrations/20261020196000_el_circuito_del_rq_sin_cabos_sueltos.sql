-- El circuito del RQ sin cabos sueltos (2026-10-20).
--
-- Al construir «Stock en almacén» (migración 20261020195000) los auditores
-- encontraron cinco cosas del circuito del requerimiento que no cuadraban con
-- lo que el sistema dice que hay en el almacén. DKS pidió que no queden cabos
-- sueltos. Aquí van las de la base:
--
-- 1. Corregir un RQ «Listo en almacén» subiendo la cantidad inflaba lo
--    separado: el stock da por separado todo lo pedido de un RQ listo, y lo de
--    más no lo separó nadie. Ahora, en un RQ listo, la cantidad solo baja; para
--    pedir más se registra otro RQ, y lo que ya está listo se entrega sin
--    esperar. Y el código interno ya no pasa a otro distinto del de lo que
--    salió del kardex con el RQ y no volvió: lo que salió se cargó a ese código,
--    y cambiarlo separaba el RQ de su salida (venía de la 20261016602000; con la
--    salida obligatoria antes de entregar, iba a pasar más).
-- 2. «Entregado» se marcaba con una nota, sin que nada saliera del kardex: el
--    stock seguía contando ese material en el almacén y su costo no llegaba al
--    código interno. Ahora no pasa mientras falte registrar la salida de algún
--    insumo, y dice cuál. Lo que ya no va a salir (el área no necesita el
--    resto, devolvieron lo que sobró, se compró en otra unidad) se cierra con
--    «Entregar con faltante»: Almacén escribe por qué, queda en el RQ (y en
--    cada insumo, cuánto no salió) y le llega a quien lo pidió. Sin eso, un RQ
--    así quedaba listo para siempre: ya no se anula ni se corrige lo que salió.
--    Cómo se entregó queda como evidencia: ni el dueño de las tablas lo
--    reescribe.
-- 3. Revisar el stock de un RQ que se anuló mientras la pantalla estaba abierta
--    respondía «ya pasó la revisión de stock». Ahora dice que se anuló; lo
--    mismo «Entregado».
-- 4. «Registrar salida» proponía el material pedido aunque lo que llegó de la
--    compra fuera otro (otra marca). La vista de las líneas por entregar dice
--    ahora el material que entró de su compra, y la pantalla lo propone.
-- 5. La salida del kardex:
--    · el código interno del RQ se guardaba sin juntar los espacios
--      («MW  0123» y «MW 0123» eran dos códigos para el costo y para el candado
--      de los accesorios);
--    · el candado de los accesorios no veía lo devuelto: la devolución no lleva
--      código, y el accesorio devuelto de una unidad quedaba libre para
--      cualquiera, mientras «Stock en almacén» lo sigue dando de esa unidad;
--    · dos salidas a la vez para el mismo insumo leían el mismo «pendiente» y
--      podían entregar de más: ahora la segunda espera a la primera. Se toma
--      primero el RQ (compartido: dos salidas del mismo RQ no se estorban),
--      después el material y después el insumo. La revisión del stock, la
--      corrección y la anulación toman el RQ primero; si la salida tomaba antes
--      el material, una revisión que asocia ese material al insumo y la salida
--      se quedaban esperando una a la otra;
--    · el reintento de una salida que ya entró (la respuesta no llegó) la
--      devuelve, aunque mientras tanto el RQ se haya entregado, y también si
--      los dos envíos llegan a la vez; con otro destino dice que ya existe con
--      otros datos;
--    · lo que entró como «PLANTA» ya no queda apartado para ninguna unidad:
--      «PLANTA» no es una unidad, y «Stock en almacén» ya lo cuenta libre;
--    · un ítem de RQ que no existe lo dice, aparte del que ya se entregó o se
--      anuló;
--    · un RQ con código interno de dos letras no dejaba registrar su salida
--      (el RQ acepta de 2 a 60; la salida pedía de 3 a 60);
--    · lo que llegó de la compra de un insumo sale para él aunque Logística lo
--      haya comprado de otra categoría de almacén. Otro material del mismo
--      almacén también puede salir para el insumo (Almacén entrega otra marca
--      que tiene): la salida lleva su material y su costo, y lo separado del
--      pedido se suelta (migración 20261020195000);
--    · un accesorio salía a PLANTA, OFICINA o TODOS LOS ACTIVOS como si fueran
--      una unidad: el candado solo miraba que hubiera algún código. Un
--      accesorio es de una unidad, y ninguno de esos tres lo es. Desde que la
--      salida sin RQ elige el código de la lista (migración 20261021131000),
--      PLANTA sale primera en ella. Ahora sale a uno de esos tres solo si lo
--      pide así su RQ (un RQA de OFICINA o de todos los activos, un RQ de
--      PLANTA): Almacén no lo decide por su cuenta, y lo que alguien pidió para
--      la planta o la oficina no se queda sin poder salir;
--    · el código escrito de una unidad registrada con dos espacios
--      («MW  0123») no la encontraba: se comparaba con los espacios del padrón,
--      y la salida quedaba sin vincular a su unidad. Y un tabulador, un
--      espacio duro o uno de ancho cero (pegados desde Excel) hacían de
--      «OFICINA» otro código para el candado: el candado mira solo las letras
--      y los números. El código se sigue escribiendo como lo junta
--      `normalizar_codigo_interno`, igual que la lista, la unidad y el costeo:
--      con otra cuenta de un lado, la unidad no se encontraba;
--    · lo escrito como código se busca así: el código de una unidad; si no, su
--      placa tal cual y, si ningún vehículo la tiene así, por sus letras y
--      números (sin guion, la placa de un vehículo sin código pasaba como
--      código nuevo y el accesorio salía hacia ella), y la salida queda en ese
--      vehículo, que la lleva al costeo de su OT. Sale con el código del RQ,
--      si viene de él; con el escrito, si es un código de la lista y el
--      vehículo no tiene código (así lo usa Requerimientos); si no, con el del
--      vehículo, aunque su placa siga en la lista de cuando no lo tenía. La
--      placa escrita de dos vehículos se rechaza; con el código del RQ o de la
--      lista, la salida no queda en ninguno.
-- 6. Un RQ por atender o sin stock del que ya salió algo del kardex se anulaba,
--    y esa salida quedaba colgada de un RQ anulado. Ahora no se anula: si lo
--    demás ya no hace falta, Almacén lo deja listo y lo entrega con faltante.
-- 7. El RQ entregado con faltante salía «Entregado» a secas en los documentos
--    del código interno y en lo pedido para él. Ahora sale como es.
-- 8. Lo que sale con un RQ de PLANTA hacia una unidad se descontaba dos veces
--    en «Stock en almacén»: al RQ, por su línea, y a lo que entró para la
--    unidad, por el código de la salida. Con 2 separados para el RQ y 3 que
--    entraron para la unidad, sacar 2 dejaba «1 de la unidad y 2 libres»: lo
--    libre subía con una salida. Ahora una salida así se lleva primero lo que
--    separó su RQ, después lo que entró para la unidad y al final lo libre, y
--    anota al registrarse cuánto le tocó a la unidad (de_la_unidad, en
--    movimientos_materiales): calculado después, con lo que el RQ es hoy,
--    cambiaba al marcarlo listo, al corregir su código o con una devolución. El
--    candado de los accesorios cuenta igual. Y la función dice, de cada código,
--    lo que entró para su unidad y lo que separó cada línea de sus RQ: la
--    salida del kardex da con eso la cifra exacta de cada uno. Las salidas
--    así de antes de esta migración se anotan en 0 al aplicarla, lo del RQ
--    primero: es lo que habría anotado la función si la unidad no tenía
--    accesorios propios de ese material, que es lo normal; si los tenía, la
--    unidad puede figurar con más (ver la sección 8). Contadas de otra manera
--    al leerlas, lo libre subía o el RQ seguía con lo que ya había salido. Lo
--    que anotó de más una versión anterior de esta migración se suelta al
--    volver a aplicarla.
--
-- Lo de «Entregado» cambia la rutina de Almacén: antes bastaba la nota de quién
-- lo recogió; ahora cada insumo sale primero del kardex, con su foto, y después
-- se marca. Si lo comprado llegó y no se ingresó al kardex, no hay saldo para
-- la salida: primero va su ingreso, y los dos mensajes lo dicen.
--
-- El error de hidratación al abrir el kardex desde un RQ era de la pantalla
-- (src/components/ui/ventana.tsx), no de la base.
--
-- Check 416_el_circuito_del_rq_sin_cabos_sueltos.sql.

-- 1. Corregir un RQ listo en almacén: la cantidad solo baja ---------------------------------
-- Igual que en la 20261016602000, con una regla más dentro del recorrido de los insumos.
create or replace function public.corregir_requerimiento(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq       public.requerimientos%rowtype;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_antes    jsonb;
  v_despues  jsonb;
  v_x        jsonb;
  v_linea    public.requerimiento_lineas%rowtype;
  v_material public.materiales%rowtype;
  v_cant     numeric;
  v_mat      uuid;
  v_codigo   text;
  v_just     text;
  v_fecha    date;
  v_oc       text;
  v_cargado  text;
begin
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'CORREGIR');
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;  -- un reintento de la misma corrección
  end if;
  if v_rq.estado in ('ENTREGADO', 'ANULADO') then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', v_rq.numero,
      case v_rq.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));

  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_rq.codigo_interno);
  v_just := coalesce(btrim(p_cambios->>'justificacion'), v_rq.justificacion);
  begin
    v_fecha := case when p_cambios ? 'fecha_requerida' then nullif(p_cambios->>'fecha_requerida', '')::date else v_rq.fecha_requerida end;
  exception when others then
    raise exception 'Revisa la fecha en que se necesita.' using errcode = 'check_violation';
  end;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA u OFICINA.'
      using errcode = 'check_violation';
  end if;
  -- Lo que salió del kardex con el RQ y no volvió quedó cargado al código de su
  -- salida: pasar el RQ a otro código dejaba el costo de lo que salió en uno y
  -- lo que falta en otro. Juntar espacios o pasar a mayúsculas sí se puede: es
  -- el mismo código. Lo que volvió entero ya no está cargado a nadie (como al
  -- anular), y un RQ de PLANTA cuya salida fue a una unidad sí puede pasar al
  -- código de esa unidad: es donde quedó el costo.
  if public.normalizar_codigo_interno(v_codigo) is distinct from public.normalizar_codigo_interno(v_rq.codigo_interno) then
    select min(m.codigo_interno) into v_cargado
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
     where l.requerimiento_id = p_id and m.tipo = 'SALIDA' and m.codigo_interno is not null
       and public.normalizar_codigo_interno(m.codigo_interno) is distinct from public.normalizar_codigo_interno(v_codigo)
       and m.cantidad > coalesce((select sum(d.cantidad) from public.movimientos_materiales d
                                   where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0);
    if v_cargado is not null then
      raise exception 'Del requerimiento % ya salió material del kardex para %: el código interno ya no cambia. Si lo que falta es para otra unidad, registra otro requerimiento.',
        v_rq.numero, v_cargado using errcode = 'check_violation';
    end if;
  end if;
  if char_length(v_just) not between 10 and 1000 then
    raise exception 'La justificación va de 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if v_fecha is distinct from v_rq.fecha_requerida and v_fecha < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;

  perform set_config('metalwork.corrigiendo', 'requerimiento', true);
  update public.requerimientos set codigo_interno = v_codigo, justificacion = v_just, fecha_requerida = v_fecha
   where id = p_id
     and row(codigo_interno, justificacion, fecha_requerida) is distinct from row(v_codigo, v_just, v_fecha);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_linea from public.requerimiento_lineas
       where requerimiento_id = p_id and item = (v_x->>'item')::int for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_mat := nullif(v_x->>'material_id', '')::uuid;
    exception when others then
      raise exception 'Revisa los insumos que corriges.' using errcode = 'check_violation';
    end;
    if v_linea.id is null then
      raise exception 'Ese insumo no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if v_linea.orden_compra_id is not null then
      select coalesce(c.numero, c.referencia) into v_oc from public.ordenes_compra_materiales c
       where c.id = v_linea.orden_compra_id and c.aprobacion <> 'RECHAZADA';
      if v_oc is not null then
        raise exception 'El insumo % ya va en la %: corrige la orden de compra.', v_linea.item, v_oc using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.movimientos_materiales m where m.requerimiento_linea_id = v_linea.id) then
      raise exception 'Del insumo % ya salió material del almacén: lo que salió queda en el kardex.', v_linea.item
        using errcode = 'check_violation';
    end if;
    if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_linea.item
        using errcode = 'check_violation';
    end if;
    -- Un RQ listo en almacén tiene separado todo lo pedido: lo de más no lo
    -- separó nadie. Se pide en otro RQ, y lo listo se entrega sin esperar.
    if v_cant is not null and v_cant > v_linea.cantidad and v_rq.estado = 'LISTO_EN_ALMACEN' then
      raise exception 'El requerimiento % ya está listo en almacén con lo pedido del insumo %: la cantidad solo puede bajar. Para pedir más, registra otro requerimiento.',
        v_rq.numero, v_linea.item using errcode = 'check_violation';
    end if;
    if v_mat is not null and v_mat is distinct from v_linea.material_id then
      if v_rq.estado <> 'POR_ATENDER' then
        raise exception 'Almacén ya revisó el stock del requerimiento %: el material del insumo % ya no cambia. Corrige la cantidad, o anúlalo y registra otro.',
          v_rq.numero, v_linea.item using errcode = 'check_violation';
      end if;
      select * into v_material from public.materiales where id = v_mat and activo;
      if not found then
        raise exception 'El material del insumo % ya no está en el catálogo de Almacén. Elige otro.', v_linea.item using errcode = 'check_violation';
      end if;
      update public.requerimiento_lineas
         set material_id = v_material.id, descripcion = left(btrim(v_material.descripcion), 300),
             categoria_id = v_material.categoria_id,
             unidad_medida_id = case when v_material.unidad_pendiente then unidad_medida_id else v_material.unidad_medida_id end
       where id = v_linea.id;
    end if;
    if v_cant is not null and v_cant <> v_linea.cantidad then
      -- Lo que Almacén anotó que tenía no puede pasar de lo pedido.
      update public.requerimiento_lineas
         set cantidad = v_cant,
             cantidad_en_stock = case when cantidad_en_stock is null then null else least(cantidad_en_stock, v_cant) end
       where id = v_linea.id;
    end if;
    v_linea := null;
    v_oc := null;
  end loop;
  perform set_config('metalwork.corrigiendo', '', true);

  if exists (select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_id and l.material_id is not null
              group by l.material_id having count(*) > 1) then
    raise exception 'Un material quedaría dos veces en el requerimiento %: suma las cantidades en un solo insumo.', v_rq.numero
      using errcode = 'check_violation';
  end if;

  select * into v_rq from public.requerimientos where id = p_id;
  v_despues := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                  'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));
  perform public.registrar_correccion(p_correccion, 'REQUERIMIENTO', p_id, v_rq.numero, p_motivo, p_justificante, p_nombre,
                                      v_antes, v_despues);
  -- A Almacén y a quien compra les llega que cambió, con el motivo.
  perform public.fn_rq_avisar(v_rq, 'Requerimiento corregido: ' || v_rq.numero, left(btrim(p_motivo), 200),
                              case when v_rq.estado = 'POR_ATENDER' then 'ALMACEN' else 'LOGISTICA' end);
  return p_id;
end $$;
revoke all on function public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 3. Revisar el stock de un RQ anulado ----------------------------------------------------------
-- Igual que en la 20261016600000, con el anulado antes que todo lo demás.
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
  if v_rq.estado = 'ANULADO' then
    raise exception 'El requerimiento % se anuló: ya no se revisa.', v_rq.numero using errcode = 'check_violation';
  end if;
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

-- 2. «Entregado», con todo fuera del kardex ---------------------------------------------------
-- Lo que falta de cada insumo es lo de la vista de abajo: lo pedido menos cada
-- salida con ese insumo, menos lo que de ella volvió. La función es dueña de las
-- tablas, así que la vista mira todas las salidas aunque quien marca no las vea.
--
-- Lo que ya no va a salir (el área no necesita el resto, devolvieron lo que
-- sobró, se compró en otra unidad, salió por la planilla sin el RQ) no deja el
-- RQ abierto para siempre: Almacén lo entrega con faltante y escribe por qué.
-- Queda en el RQ —qué no salió y el motivo—, en cada insumo cuánto no salió, y
-- le llega a quien lo pidió. Sin motivo, «Entregado» no pasa mientras falte algo.
-- El detalle no tiene tope: lo arma la base con los insumos del RQ (hasta 100),
-- y cortado dejaba fuera justo los últimos.
alter table public.requerimientos
  add column if not exists faltante_al_entregar text,
  add column if not exists motivo_del_faltante  text check (char_length(motivo_del_faltante) <= 500);
-- Una versión anterior de esta migración, aplicada en bases de prueba, le ponía
-- tope de 1000; volver a aplicarla ahora lo quita.
alter table public.requerimientos drop constraint if exists requerimientos_faltante_al_entregar_check;
comment on column public.requerimientos.faltante_al_entregar is
  'Lo que no salió del kardex cuando Almacén lo entregó con faltante (cantidad, unidad e insumo). Vacío si salió todo.';
comment on column public.requerimientos.motivo_del_faltante is
  'Por qué lo que falta ya no sale del kardex, según Almacén al entregarlo.';
alter table public.requerimiento_lineas
  add column if not exists sin_salida_al_entregar numeric check (sin_salida_al_entregar > 0);
comment on column public.requerimiento_lineas.sin_salida_al_entregar is
  'Lo de este insumo que no salió del kardex cuando Almacén entregó el RQ con faltante. Vacío si salió todo.';

create or replace function public.rq_entregar_con_faltante(p_id uuid, p_nota text, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_detalle text;
  v_aviso   text;
  v_faltan  jsonb;
  -- Sin motivo es el «Entregado» de siempre. Con motivo, aunque llegue en
  -- blanco, quien llama eligió entregar con faltante.
  v_con_faltante boolean := p_motivo is not null;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public.exigir_permiso('almacen.despachar');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'ENTREGADO' then return p_id; end if;
  if v_rq.estado = 'ANULADO' then
    raise exception 'El requerimiento % se anuló: ya no se entrega.', v_rq.numero using errcode = 'check_violation';
  end if;
  if v_rq.estado <> 'LISTO_EN_ALMACEN' then
    raise exception 'El requerimiento % todavía no está listo en almacén.', v_rq.numero using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_nota, ''))) not between 3 and 500 then
    raise exception 'Anota quién del área lo recogió.' using errcode = 'check_violation';
  end if;
  -- Las salidas de sus insumos esperan a que esto termine, y esto a ellas.
  perform 1 from public.requerimiento_lineas l where l.requerimiento_id = p_id for update;
  -- Lo que falta, en una sola lectura: el detalle del RQ y lo de cada insumo
  -- salen de la misma foto, aunque mientras tanto entre una devolución.
  select string_agg(rtrim(to_char(v.pendiente, 'FM999999990.999'), '.') || ' ' || v.unidad || ' de «' || v.descripcion || '»',
                    '; ' order by v.item),
         jsonb_agg(jsonb_build_object('linea', v.linea_id, 'pendiente', v.pendiente))
    into v_detalle, v_faltan
    from public.v_rq_lineas_para_salida v
   where v.requerimiento_id = p_id and v.pendiente > 0;
  -- El motivo se mira solo si falta algo: si mientras tanto salió todo, se
  -- entrega sin faltante y el motivo sobra, venga como venga.
  if v_detalle is not null then
    if not v_con_faltante then
      raise exception 'Del requerimiento % falta registrar en el kardex la salida de %. Regístrala con «Registrar la salida en el kardex» (si lo comprado llegó y no está en el kardex, registra antes su ingreso) y después márcalo entregado. Si eso ya no va a salir, entrégalo con faltante y escribe por qué.',
        v_rq.numero, left(v_detalle, 300) using errcode = 'check_violation';
    end if;
    if v_motivo is null or char_length(v_motivo) not between 10 and 500 then
      raise exception 'Escribe por qué lo que falta ya no sale del kardex, de 10 a 500 caracteres.' using errcode = 'check_violation';
    end if;
    -- Cuánto no salió de cada insumo: lo lee quien pidió el RQ, al lado del
    -- insumo. Solo esta función lo escribe (la marca la mira su disparador).
    perform set_config('metalwork.entregando', p_id::text, true);
    update public.requerimiento_lineas l
       set sin_salida_al_entregar = f.pendiente
      from jsonb_to_recordset(v_faltan) as f(linea uuid, pendiente numeric)
     where l.id = f.linea and l.requerimiento_id = p_id;
    perform set_config('metalwork.entregando', '', true);
  end if;
  update public.requerimientos
     set estado = 'ENTREGADO', entregado_en = now(), entregado_por = public.usuario_actual(),
         nota_entrega = btrim(p_nota),
         faltante_al_entregar = v_detalle,
         motivo_del_faltante = case when v_detalle is not null then v_motivo end
   where id = p_id;
  if v_detalle is null then
    perform public.fn_rq_avisar(v_rq, 'Entregado: ' || v_rq.numero, 'Almacén lo entregó: ' || btrim(p_nota), 'EMISOR');
  else
    -- Primero el motivo, que nunca se corta (hasta 500), después quién lo
    -- recogió (hasta 150) y al final qué no salió, que es lo único que se
    -- corta: está entero en el RQ. Un RQ de muchos insumos, o una nota larga,
    -- se llevaban el motivo o quién lo recogió al cortar el aviso.
    v_aviso := 'Motivo: ' || v_motivo || '. Lo recogió: '
               || case when char_length(btrim(p_nota)) > 150 then left(btrim(p_nota), 149) || '…' else btrim(p_nota) end
               || '. No salió: ' || v_detalle;
    perform public.fn_rq_avisar(v_rq, 'Entregado con faltante: ' || v_rq.numero,
      case when char_length(v_aviso) > 1000 then left(v_aviso, 999) || '…' else v_aviso end, 'EMISOR');
  end if;
  return p_id;
end;
$$;
revoke all on function public.rq_entregar_con_faltante(uuid, text, text) from public, anon;
grant execute on function public.rq_entregar_con_faltante(uuid, text, text) to authenticated;

-- Cómo se entregó queda como evidencia, como el número y quién lo pidió
-- (`fn_rq_guardia`): ni el dueño de las tablas reescribe la nota, el faltante o
-- el motivo de un RQ entregado, ni lo que no salió de un insumo. Disparadores
-- propios, para no redefinir las guardias de siempre.
create or replace function public.fn_rq_entrega_queda_como_evidencia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if old.estado = 'ENTREGADO'
     and row(new.nota_entrega, new.entregado_en, new.entregado_por, new.faltante_al_entregar, new.motivo_del_faltante)
         is distinct from row(old.nota_entrega, old.entregado_en, old.entregado_por, old.faltante_al_entregar, old.motivo_del_faltante) then
    raise exception 'El requerimiento % ya se entregó: cómo se entregó queda como evidencia.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_entrega_queda_como_evidencia() from public, anon, authenticated;
create or replace trigger trg_rq_entrega_queda_como_evidencia
  before update on public.requerimientos
  for each row execute function public.fn_rq_entrega_queda_como_evidencia();

-- Lo que no salió de un insumo lo escribe solo «Entregar con faltante», en el
-- momento de entregar (con su marca); antes o después, nadie lo pone ni lo cambia.
create or replace function public.fn_rq_linea_sin_salida_queda()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.sin_salida_al_entregar is not null then
      raise exception 'Lo que no salió del kardex lo anota Almacén al entregar el requerimiento.' using errcode = 'check_violation';
    end if;
  elsif new.sin_salida_al_entregar is distinct from old.sin_salida_al_entregar then
    if old.sin_salida_al_entregar is not null then
      raise exception 'Lo que no salió del kardex al entregar el requerimiento queda como evidencia.' using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('metalwork.entregando', true), '') <> new.requerimiento_id::text then
      raise exception 'Lo que no salió del kardex lo anota Almacén al entregar el requerimiento.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_linea_sin_salida_queda() from public, anon, authenticated;
create or replace trigger trg_rq_linea_sin_salida_queda
  before insert or update on public.requerimiento_lineas
  for each row execute function public.fn_rq_linea_sin_salida_queda();

-- «Entregado» de siempre: sin motivo, no pasa mientras falte algo.
create or replace function public.rq_marcar_entregado(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  return public.rq_entregar_con_faltante(p_id, p_nota, null);
end;
$$;
revoke all on function public.rq_marcar_entregado(uuid, text) from public, anon;
grant execute on function public.rq_marcar_entregado(uuid, text) to authenticated;

-- 4. El material que entró de la compra de cada insumo ----------------------------------------
-- Mismas columnas y en el mismo orden que en la 20261020195000, y una más al
-- final (create or replace view solo agrega al final): el material del último
-- ingreso de su línea de OC, que puede ser otra marca que el pedido. Se lee del
-- kardex y no de la OC: es lo que de verdad está en el almacén, y la OC no la
-- lee todo el que despacha.
create or replace view public.v_rq_lineas_para_salida with (security_invoker = true) as
select l.id as linea_id, r.id as requerimiento_id, r.numero, r.codigo_interno, a.nombre as area, r.estado,
       r.fecha_requerida, l.item, l.descripcion, l.cantidad::numeric as cantidad, um.codigo as unidad,
       c.nombre as categoria, c.almacen,
       coalesce(s.entregado, 0)::numeric as entregado,
       greatest(l.cantidad - coalesce(s.entregado, 0), 0)::numeric as pendiente,
       l.material_id,
       ic.material_id as material_comprado
  from public.requerimiento_lineas l
  join public.requerimientos r on r.id = l.requerimiento_id
  join public.areas a on a.id = r.area_id
  join public.unidades_medida um on um.id = l.unidad_medida_id
  join public.categorias_material c on c.id = l.categoria_id
  left join lateral (
    select sum(m.cantidad - coalesce((select sum(d.cantidad) from public.movimientos_materiales d
                                       where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0)) as entregado
      from public.movimientos_materiales m
     where m.requerimiento_linea_id = l.id and m.tipo = 'SALIDA') s on true
  left join lateral (
    select i.material_id
      from public.movimientos_materiales i
     where i.orden_compra_detalle_id = l.orden_compra_detalle_id and i.tipo = 'INGRESO'
     order by i.registrado_en desc, i.id
     limit 1) ic on l.orden_compra_detalle_id is not null
 where r.estado not in ('ANULADO', 'ENTREGADO');
revoke all on public.v_rq_lineas_para_salida from public, anon;
grant select on public.v_rq_lineas_para_salida to authenticated;

-- 5. La salida del kardex -----------------------------------------------------------------------
-- Igual que en la 20261013140000, con el RQ, el material y el insumo trabados
-- mientras se entrega (en ese orden), el reintento mirado antes de leer lo que
-- falta y comparando también a dónde va, el código con los espacios juntados y de 2 a 60 caracteres, lo comprado para el
-- insumo aunque sea de otro almacén, el candado de los accesorios que ve lo
-- devuelto y no aparta «PLANTA», el ítem que no existe dicho aparte, y lo que
-- de una salida con un RQ de otro código le toca a la unidad (sección 8).
create or replace function public.registrar_salida_material(
  p_id uuid, p_material uuid, p_cantidad numeric, p_unidad uuid, p_codigo text,
  p_motivo text, p_recibe text, p_foto text, p_requerimiento_linea uuid)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  -- Como lo junta el costeo, la lista y la unidad: con otra cuenta de un lado,
  -- la unidad del padrón no se encontraba.
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_unidad uuid := p_unidad;
  v_coincide uuid[];
  v_existente public.movimientos_materiales%rowtype;
  v_objeto storage.objects%rowtype;
  v_reserva numeric;
  v_libre numeric;
  v_almacen text;
  v_codigo_interno text;
  v_linea public.v_rq_lineas_para_salida%rowtype;
  v_rq_codigo text;
  v_llave text;
  v_reservado_otros numeric;
  v_de_la_unidad numeric;
  v_separado numeric;
  v_cubierto numeric;
  v_cargo_unidad numeric;
  v_codigo_del_rq boolean := false;
  -- El código del RQ, o el de la lista escrito como la placa de un vehículo sin
  -- código: la salida queda en el vehículo y sale con ese código.
  v_codigo_aparte boolean := false;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_material is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3)
     or length(btrim(coalesce(p_motivo, ''))) not between 3 and 200
     or length(btrim(coalesce(p_recibe, ''))) not between 3 and 160
     or p_foto is null
     or p_foto not in (auth.uid()::text || '/' || p_id::text || '.jpg',
                       auth.uid()::text || '/' || p_id::text || '.png',
                       auth.uid()::text || '/' || p_id::text || '.webp') then
    raise exception 'Indica material, cantidad, motivo, quién recibe y la foto de la salida.';
  end if;

  -- Primero el RQ, compartido: la revisión del stock, la corrección y la
  -- anulación lo toman antes que nada, y la revisión toma después el material
  -- (al asociarlo a un insumo). Si la salida tomaba primero el material, las dos
  -- se quedaban esperando una a la otra. Dos salidas del mismo RQ no se estorban.
  if p_requerimiento_linea is not null then
    select r.codigo_interno into v_rq_codigo
      from public.requerimientos r
      join public.requerimiento_lineas l on l.requerimiento_id = r.id
     where l.id = p_requerimiento_linea
       for share of r;
    if not found then
      raise exception 'Ese ítem de requerimiento no existe: recarga el kardex.';
    end if;
    -- Si no se dijo a qué unidad va, va a la del requerimiento.
    if v_unidad is null and v_codigo is null and public.normalizar_codigo_interno(v_rq_codigo) <> 'PLANTA' then
      v_codigo := public.normalizar_codigo_interno(v_rq_codigo);
      v_codigo_del_rq := true;
    end if;
  end if;

  -- Después el material, y al final el insumo.
  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;

  if (v_unidad is null) = (v_codigo is null) then
    raise exception 'Vincula la salida a un vehículo registrado o escribe el código de la unidad, uno de los dos.';
  end if;

  if v_unidad is not null then
    perform 1 from public.unidades where id = v_unidad and activo;
    if not found then raise exception 'La unidad elegida no existe o está desactivada.'; end if;
  else
    -- De 2 a 60, como el código interno de un RQ: uno de dos letras no dejaba
    -- registrar su salida.
    if length(v_codigo) not between 2 and 60 then
      raise exception 'El código de la unidad debe tener de 2 a 60 caracteres.';
    end if;
    -- Si el código escrito es el de una unidad registrada, la salida se vincula
    -- a ella: así el mismo vehículo no aparece con dos nombres en el kardex.
    -- Con los espacios juntados de los dos lados, como lo muestra la lista.
    select array_agg(u.id) into v_coincide from public.unidades u
     where u.activo and public.normalizar_codigo_interno(u.codigo_interno) = v_codigo;
    -- Si no, la placa: primero como se escribió y, si ningún vehículo la tiene
    -- así, solo por sus letras y números («W22MQ0» o «W22 MQ0» es la W22-MQ0;
    -- escrita así, un accesorio salía hacia un vehículo sin código interno como
    -- si fuera un código nuevo). La salida queda en ese vehículo: así entra
    -- también al costeo de su OT. Con qué código sale:
    -- * El del RQ, si viene de él: es el código del pedido. Lo mismo hacía la
    --   salida de antes (20261013140000) con la placa tal cual.
    -- * El escrito, si es un código de la lista y ningún vehículo de esa placa
    --   tiene código interno: Requerimientos usa la placa como código del
    --   vehículo que todavía no lo tiene, y sin él la salida perdía ese costo.
    --   La lista se arma solo en ese caso: con muchos movimientos tarda segundos.
    -- * Si no, el del vehículo: la placa del que ya tiene código va a su código,
    --   aunque siga en la lista de cuando no lo tenía; si no, el costo del mismo
    --   vehículo se partía según se escribiera la placa.
    -- Dos vehículos con la misma placa (de dos clientes, o una con guion y otra
    -- sin él) no se adivinan: con el código del RQ o de la lista, la salida no
    -- queda en ninguno; escrita, se rechaza (como código nuevo, el costo
    -- quedaba en un código de nadie).
    if v_coincide is null then
      select array_agg(u.id) into v_coincide from public.unidades u
       where u.activo and public.normalizar_codigo_interno(u.placa) = v_codigo;
      if v_coincide is null and regexp_replace(upper(v_codigo), '[^A-Z0-9]', '', 'g') <> '' then
        select array_agg(u.id) into v_coincide from public.unidades u
         where u.activo and regexp_replace(upper(coalesce(u.placa, '')), '[^A-Z0-9]', '', 'g')
                            = regexp_replace(upper(v_codigo), '[^A-Z0-9]', '', 'g');
      end if;
      if v_codigo_del_rq then
        v_codigo_aparte := true;
      elsif v_coincide is not null
         and not exists (select 1 from public.unidades u
                          where u.id = any(v_coincide) and public.normalizar_codigo_interno(u.codigo_interno) is not null) then
        v_codigo_aparte := exists (select 1 from public.codigos_internos_para_elegir() c where c.codigo = v_codigo);
      end if;
      if cardinality(v_coincide) > 1 then
        if not v_codigo_aparte then
          raise exception 'La placa % es de más de un vehículo registrado: elige el vehículo en «Vehículo registrado».', v_codigo;
        end if;
        v_coincide := null;
      end if;
    end if;
    if cardinality(v_coincide) = 1 then
      v_unidad := v_coincide[1];
      if not v_codigo_aparte then v_codigo := null; end if;
    end if;
  end if;

  -- Un reintento del mismo envío (la respuesta no llegó) devuelve la salida que
  -- ya entró, aunque mientras tanto su RQ se haya entregado. Se mira con el
  -- material trabado: si los dos envíos llegan a la vez, el segundo espera al
  -- primero y lo encuentra aquí, en vez de chocar al guardar. Con otro destino
  -- no es un reintento. A una unidad registrada, el código lo pone su
  -- disparador (`fn_destino_movimiento_almacen`): basta con que sea la misma.
  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    if v_existente.tipo = 'SALIDA' and v_existente.registrado_por = public.usuario_actual()
       and v_existente.material_id = p_material and v_existente.cantidad = p_cantidad
       and v_existente.foto_ruta = p_foto and v_existente.recibido_por_nombre = btrim(p_recibe)
       and v_existente.documento_referencia = btrim(p_motivo)
       and v_existente.requerimiento_linea_id is not distinct from p_requerimiento_linea
       and v_existente.unidad_id is not distinct from v_unidad
       and (v_unidad is not null or v_existente.codigo_unidad is not distinct from v_codigo) then
      return p_id;
    end if;
    raise exception 'Esa salida ya existe con otros datos. Recarga el kardex.';
  end if;

  -- La línea del requerimiento: viva, con saldo por entregar, y del mismo almacén.
  if p_requerimiento_linea is not null then
    -- Dos salidas a la vez para el mismo insumo: la segunda espera y lee lo
    -- que dejó la primera.
    perform 1 from public.requerimiento_lineas where id = p_requerimiento_linea for update;
    select * into v_linea from public.v_rq_lineas_para_salida where linea_id = p_requerimiento_linea;
    if not found then
      raise exception 'Ese requerimiento ya se entregó o se anuló: recarga el kardex.';
    end if;
    if v_linea.pendiente < p_cantidad then
      raise exception 'El requerimiento % pide % % de «%» y ya se entregó %: quedan % por entregar.',
        v_linea.numero, trim_scale(v_linea.cantidad), v_linea.unidad, v_linea.descripcion, trim_scale(v_linea.entregado), trim_scale(v_linea.pendiente);
    end if;
  end if;

  v_almacen := public.almacen_de_material(p_material);
  -- Lo que llegó de la compra del insumo sale para él aunque Logística lo haya
  -- comprado de otra categoría: es justo lo que se compró para ese pedido.
  if v_linea.almacen is not null and v_almacen is not null and v_linea.almacen <> v_almacen
     and p_material is distinct from v_linea.material_comprado then
    raise exception 'El requerimiento % pide «%» (%), y este material es de %: elige un material de ese almacén.',
      v_linea.numero, v_linea.descripcion, v_linea.categoria, lower(replace(v_almacen, '_', ' '));
  end if;

  -- El código interno para el que sale: el del RQ, el escrito, o el de la unidad.
  -- Con los espacios juntados, como en «Stock en almacén» y en el costeo.
  v_codigo_interno := coalesce(
    nullif(public.normalizar_codigo_interno(v_linea.codigo_interno), 'PLANTA'),
    v_codigo,
    (select public.normalizar_codigo_interno(u.codigo_interno) from public.unidades u where u.id = v_unidad));
  -- PLANTA, OFICINA y TODOS LOS ACTIVOS son códigos, pero no de una unidad: un
  -- accesorio sale a uno de ellos solo si su RQ lo pide así. Sin RQ, o hacia
  -- otro de los tres, Almacén no lo decide por su cuenta. Se comparan solo las
  -- letras y los números: un tabulador, un espacio duro o uno de ancho cero
  -- pegados desde Excel no hacen de «OFICINA» otro código.
  v_llave := regexp_replace(upper(coalesce(v_codigo_interno, '')), '[^A-Z0-9]', '', 'g');
  -- El vehículo elegido (o cuya placa se escribió) sin código interno: el
  -- mensaje de abajo le pedía elegir la unidad, que ya estaba elegida.
  if v_almacen = 'ACCESORIOS' and v_codigo_interno is null and v_unidad is not null then
    raise exception 'La unidad elegida no tiene código interno, y un accesorio sale solo para una unidad con código.';
  end if;
  if v_almacen = 'ACCESORIOS' and (v_codigo_interno is null
     or (v_llave in ('PLANTA', 'OFICINA', 'TODOSLOSACTIVOS')
         and v_llave <> regexp_replace(upper(coalesce(v_rq_codigo, '')), '[^A-Z0-9]', '', 'g'))) then
    raise exception 'Un accesorio sale solo para una unidad con código interno: a PLANTA, OFICINA o todos los activos sale solo si lo pide así su requerimiento. Elige el código de la unidad o el requerimiento que lo pide.';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'evidencias-almacen' and name = p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text
     or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Carga una foto válida antes de confirmar la salida.';
  end if;

  -- Lo reservado para solicitudes de OT no se entrega por salida general.
  select coalesce(sum(greatest(coalesce(d.cantidad_stock, case when d.decision_almacen = 'STOCK' then d.cantidad_solicitada else 0 end)
                               + coalesce(s.ingresado, 0) - coalesce(s.cantidad, 0), 0)), 0)
    into v_reserva
    from public.requerimiento_material_detalles d
    join public.ot_materiales om on om.id = d.ot_material_id
    join public.ordenes_trabajo ot on ot.id = om.orden_id
    left join lateral (
      select sum(x.cantidad) filter (where x.tipo = 'DESPACHO') cantidad,
             sum(x.cantidad) filter (where x.tipo = 'INGRESO' and x.origen = 'COMPRA') ingresado
        from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id) s on true
   where om.material_id = p_material and d.decision_almacen in ('STOCK', 'COMPRA') and ot.estado::text <> 'ANULADA';
  v_libre := greatest(public.saldo_registrado_material(p_material) - v_reserva, 0);
  if p_cantidad > v_libre then
    raise exception 'Solo hay % libre de este material; lo demás está reservado para solicitudes de OT o no está en almacén.%', trim_scale(v_libre),
      case when p_requerimiento_linea is not null
           then ' Si llegó de la compra del requerimiento y no está en el kardex, registra antes su ingreso.' else '' end;
  end if;

  -- Un accesorio que entró para una unidad no sale para otra. La misma cuenta
  -- que «Stock en almacén» (accesorios_de_cada_unidad, sección 8).
  if v_almacen = 'ACCESORIOS' then
    select coalesce(sum(greatest(a.saldo, 0)) filter (where a.codigo <> v_codigo_interno), 0),
           coalesce(sum(greatest(a.saldo, 0)) filter (where a.codigo = v_codigo_interno), 0)
      into v_reservado_otros, v_de_la_unidad
      from public.accesorios_de_cada_unidad(array[p_material]) a;
    if p_cantidad > v_libre - v_reservado_otros then
      raise exception 'De este accesorio hay % libre para la unidad %: % entró para otras unidades y sale solo para ellas.',
        trim_scale(greatest(v_libre - v_reservado_otros, 0)), v_codigo_interno, trim_scale(v_reservado_otros);
    end if;
    -- Con un RQ de otro código (uno de PLANTA hacia esta unidad), la salida se
    -- lleva primero lo que separó su línea, si de verdad está fuera de lo que
    -- entró para las unidades; después, lo que entró para esta unidad, y lo
    -- demás, de lo libre. Lo de la unidad queda anotado en la salida (sección 8).
    if p_requerimiento_linea is not null
       and v_codigo_interno is distinct from public.normalizar_codigo_interno(v_rq_codigo) then
      select coalesce(sum(s.cantidad), 0) into v_separado
        from public.separado_de_cada_linea(array[p_material]) s
       where s.linea = p_requerimiento_linea;
      v_cubierto := least(p_cantidad, v_separado, greatest(v_libre - v_reservado_otros - v_de_la_unidad, 0));
      v_cargo_unidad := least(p_cantidad - v_cubierto, v_de_la_unidad);
    end if;
  end if;

  insert into public.movimientos_materiales(id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
    cantidad_de_stock, foto_ruta, recibido_por_nombre, unidad_id, codigo_unidad, codigo_interno, requerimiento_linea_id, de_la_unidad)
  values (p_id, 'SALIDA', p_material, p_cantidad, 'SALIDA_GENERAL', btrim(p_motivo), public.usuario_actual(),
    p_cantidad, p_foto, btrim(p_recibe), v_unidad, v_codigo, v_codigo_interno, p_requerimiento_linea, v_cargo_unidad);
  return p_id;
end $$;
revoke all on function public.registrar_salida_material(uuid, uuid, numeric, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_salida_material(uuid, uuid, numeric, uuid, text, text, text, text, uuid) to authenticated;

-- 6. Un RQ del que ya salió algo no se anula ----------------------------------------------------
-- Igual que en la 20261015162000, con una regla más: lo que salió del kardex
-- con el RQ es de su código interno, y anularlo dejaba esa salida colgada de un
-- RQ anulado. La salida toma el RQ antes que nada, así que la anulación la
-- espera y la ve.
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
  -- Lo que salió y volvió entero no cuenta: es lo entregado de la vista.
  if exists (select 1 from public.v_rq_lineas_para_salida v where v.requerimiento_id = p_id and v.entregado > 0) then
    raise exception 'Del requerimiento % ya salió material del kardex: ya no se anula. Si lo demás ya no hace falta, pídele a Almacén que lo deje listo y lo entregue con faltante.',
      v_rq.numero using errcode = 'check_violation';
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

-- 7. «Entregado con faltante» también donde se mira el código interno -----------------------------
-- Iguales que en la 20261015141000 y la 20261015200000, con un estado más para
-- mostrar: el RQ entregado con faltante sale así, no «Entregado» a secas, en
-- los documentos del código y en lo pedido para él. No es un estado del RQ (el
-- RQ sigue ENTREGADO); lo es solo de lo que estas dos funciones devuelven, y
-- el resumen de Gerencia, que cuenta lo que no está anulado, lo sigue contando.
create or replace function public.codigo_interno_documentos(p_codigo text default null)
returns table (codigo text, tipo text, id uuid, numero text, fecha date, estado text, detalle text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, u.*
      from public.unidades u
     where u.codigo_interno is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
  ), orden as (
    select u.codigo, o.* from public.ordenes_trabajo o join unidad u on u.id = o.unidad_id
  )
  select public.normalizar_codigo_interno(r.codigo_interno), 'REQUERIMIENTO'::text, r.id, r.numero::text,
         (r.creado_en at time zone 'America/Lima')::date, case when r.estado = 'ENTREGADO' and r.faltante_al_entregar is not null then 'ENTREGADO_CON_FALTANTE' else r.estado::text end,
         (coalesce(a.nombre, 'Sin área') || ' · ' || (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id)
           || case when (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id) = 1 then ' insumo' else ' insumos' end
           || ' · ' || r.justificacion)::text
    from public.requerimientos r
    left join public.areas a on a.id = r.area_id
   where v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
  union all
  select public.normalizar_codigo_interno(v.codigo_interno), 'VEHICULO', v.id,
         coalesce(nullif(btrim(v.placa), ''), nullif(btrim(v.chasis), ''), 'Sin placa')::text,
         (v.ingreso_en at time zone 'America/Lima')::date,
         case when v.salida_en is null then 'EN_PLANTA' else 'SALIO' end,
         (v.unidad || ' · ' || v.empresa)::text
    from public.registro_vehiculos v
   where v.codigo_interno is not null and v.anulado_en is null
     and (v_codigo is null or public.normalizar_codigo_interno(v.codigo_interno) = v_codigo)
  union all
  select u.codigo, 'UNIDAD', u.id,
         coalesce(nullif(btrim(u.placa), ''), nullif(btrim(u.numero_chasis), ''), 'Sin placa')::text,
         (u.creado_en at time zone 'America/Lima')::date,
         case when u.activo then 'ACTIVA' else 'INACTIVA' end,
         nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')::text
    from unidad u
  union all
  select o.codigo, 'OT', o.id, o.numero::text, o.fecha_registro, o.estado::text, o.descripcion::text
    from orden o
  union all
  select o.codigo, 'COTIZACION', c.id, c.numero::text, (c.creado_en at time zone 'America/Lima')::date, c.estado::text,
         ('De la OT ' || o.numero)::text
    from orden o
    join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id
  union all
  select public.normalizar_codigo_interno(s.codigo_interno), 'SERVICIO', s.id, s.numero::text,
         (s.creado_en at time zone 'America/Lima')::date,
         case when s.estado = 'ANULADA' then 'ANULADA'
              when s.aprobacion = 'RECHAZADA' then 'RECHAZADA'
              when s.aprobacion = 'POR_APROBAR' then 'POR_APROBAR'
              else s.estado end,
         (s.proveedor || ' · ' || case when s.moneda = 'USD' then 'US$ ' else 'S/ ' end
           || to_char(s.monto, 'FM999G999G990D00') || ' sin IGV · ' || s.descripcion)::text
    from public.ordenes_servicio s
   where s.codigo_interno is not null
     and (v_codigo is null or public.normalizar_codigo_interno(s.codigo_interno) = v_codigo)
   order by 1, 2, 5 desc;
end;
$$;
comment on function public.codigo_interno_documentos(text) is
  'Dónde más aparece un código interno (o todos): requerimientos, ingresos de vehículos, unidades, la OT y la cotización de esas unidades, y las órdenes de servicio. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_documentos(text) from public, anon;
grant execute on function public.codigo_interno_documentos(text) to authenticated;

create or replace function public.codigo_interno_lo_pedido(p_codigo text)
returns table (requerimiento_id uuid, numero text, estado text, area text, fecha date, item smallint,
               descripcion text, cantidad numeric, unidad text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  if v_codigo is null then
    return;
  end if;
  return query
  select r.id, r.numero::text,
         case when r.estado = 'ENTREGADO' and r.faltante_al_entregar is not null then 'ENTREGADO_CON_FALTANTE' else r.estado::text end,
         a.nombre::text, (r.creado_en at time zone 'America/Lima')::date,
         l.item::smallint, l.descripcion::text, l.cantidad, um.codigo::text
    from public.requerimientos r
    join public.requerimiento_lineas l on l.requerimiento_id = r.id
    left join public.areas a on a.id = r.area_id
    left join public.unidades_medida um on um.id = l.unidad_medida_id
   where public.normalizar_codigo_interno(r.codigo_interno) = v_codigo and r.estado <> 'ANULADO'
   order by r.creado_en desc, l.item;
end;
$$;
revoke all on function public.codigo_interno_lo_pedido(text) from public, anon;
grant execute on function public.codigo_interno_lo_pedido(text) to authenticated;

-- 8. Lo que sale con un RQ de otro código, la salida lo anota al registrarse ----------------------
-- Una salida con un RQ de PLANTA hacia la unidad U se lleva primero lo que
-- separó la línea de ese RQ, y lo que pase de eso, de lo que entró para U. La
-- cuenta se hace una vez, al registrar la salida (registrar_salida_material,
-- sección 5), y la parte de U queda anotada en el movimiento (de_la_unidad).
-- Calcularla después, con lo que el RQ es hoy, fallaba de seis maneras: al
-- marcarlo «Listo», al corregir su código, con una devolución, con dos salidas
-- de la misma línea hacia dos unidades, con una salida posterior hacia PLANTA
-- y con lo que separó de más. Lo separado por cada línea se saca de
-- stock_libre_en_almacen a su propia función, para que la salida mire la misma
-- cifra que la pantalla.
alter table public.movimientos_materiales add column if not exists de_la_unidad numeric(14, 4);
comment on column public.movimientos_materiales.de_la_unidad is
  'Solo en una salida de un accesorio con un RQ de otro código (uno de PLANTA hacia una unidad): cuánto de ella se le descontó a lo que entró para la unidad de su código, anotado al registrarla. Lo demás salió de lo que separó la línea del RQ o de lo libre. Lo devuelve primero su devolución. Las de antes de la 20261020196000 con un RQ que tenía otro código al salir se anotaron en 0 al aplicarla (anotar_salidas_de_antes). Nulo en las demás.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_movimiento_de_la_unidad'
                   and conrelid = 'public.movimientos_materiales'::regclass) then
    alter table public.movimientos_materiales add constraint ck_movimiento_de_la_unidad
      check (de_la_unidad is null
             or (tipo = 'SALIDA' and requerimiento_linea_id is not null and de_la_unidad >= 0 and de_la_unidad <= cantidad));
  end if;
end $$;

-- Las salidas así de antes de esta migración no anotaron nada. Se les anota 0
-- una vez, al aplicarla: lo del RQ primero. Es lo que habría anotado la
-- función si la unidad no tenía accesorios propios de ese material, que es lo
-- normal en producción (ninguna pantalla registra un ingreso con código
-- interno), o si la salida no pasó de lo que su RQ tenía separado fuera de lo
-- que entró para las unidades. Si la unidad tenía y la salida pasó de eso (un
-- RQ «Listo» sin stock general, o una revisión que anotó más de lo libre), la
-- unidad figura con más de lo que de verdad le queda: el candado puede frenar
-- una salida hacia otra unidad y, si un RQ de esa unidad había separado lo
-- suyo, lo libre sale mayor. No hay una cuenta mejor en los dos sentidos: contadas al leerlas,
-- daban otra cifra en cada función y cambiaban con lo que entraba después o al
-- corregir el código del RQ; contadas enteras a la unidad, el RQ se quedaba
-- con lo separado que ya había salido. Anotada, cada salida cuenta igual en
-- separado_de_cada_linea y en accesorios_de_cada_unidad.
-- Es de otro código si no era el que el RQ tenía al salir, como lo mira la
-- función al registrarla: el historial de auditoría del RQ guarda el código de
-- antes de cada corrección, y sin corrección es el de hoy. Antes de esta
-- migración el código del RQ se podía corregir después de la salida: con el de
-- hoy, un RQ de PLANTA corregido al código de la unidad de su salida quedaba
-- sin anotar (se descontaba entero a la unidad y a la línea, y lo libre
-- subía), y uno de la unidad corregido a otro código quedaba anotado (la
-- unidad figuraba con lo que ya salió). Volver a aplicar la migración no
-- cambia nada.
-- Y si ya se aplicó una versión anterior de esta migración, que anotaba también
-- la de un RQ de su misma unidad corregido después a otro código, esa anotación
-- se suelta: la función nunca anota una salida con el código que su RQ tenía
-- al salir (solo la de un RQ de otro código), así que un 0 ahí lo puso la regla
-- vieja, y dejarlo hacía figurar a la unidad con lo que ya salió.
create or replace function public.anotar_salidas_de_antes()
returns integer language plpgsql set search_path to 'public' as $$
declare v_anotadas integer;
begin
  with de_otro_codigo as (
    select m.id,
           public.normalizar_codigo_interno(m.codigo_interno) is distinct from public.normalizar_codigo_interno(coalesce(
             (select a.datos_antes->>'codigo_interno' from public.audit_log a
               where a.tabla = 'requerimientos' and a.registro_id = r.id and a.accion = 'UPDATE'
                 and 'codigo_interno' = any(a.campos_modificados) and a.creado_en > m.registrado_en
               order by a.creado_en, a.id limit 1),
             r.codigo_interno)) as otro
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
     where m.tipo = 'SALIDA'
       and (m.de_la_unidad is null or m.de_la_unidad = 0)
       and public.almacen_de_material(m.material_id) = 'ACCESORIOS'
  )
  update public.movimientos_materiales m set de_la_unidad = null
    from de_otro_codigo d
   where d.id = m.id and not d.otro and m.de_la_unidad = 0;

  with de_otro_codigo as (
    select m.id,
           public.normalizar_codigo_interno(m.codigo_interno) is distinct from public.normalizar_codigo_interno(coalesce(
             (select a.datos_antes->>'codigo_interno' from public.audit_log a
               where a.tabla = 'requerimientos' and a.registro_id = r.id and a.accion = 'UPDATE'
                 and 'codigo_interno' = any(a.campos_modificados) and a.creado_en > m.registrado_en
               order by a.creado_en, a.id limit 1),
             r.codigo_interno)) as otro
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
     where m.tipo = 'SALIDA' and m.de_la_unidad is null
       and public.almacen_de_material(m.material_id) = 'ACCESORIOS'
  ),
  anotadas as (
    update public.movimientos_materiales m set de_la_unidad = 0
      from de_otro_codigo d
     where d.id = m.id and d.otro
    returning 1)
  select count(*)::integer into v_anotadas from anotadas;
  return v_anotadas;
end
$$;
revoke all on function public.anotar_salidas_de_antes() from public, anon, authenticated;
do $$ begin perform public.anotar_salidas_de_antes(); end $$;

-- Lo que tiene separado cada línea de un RQ abierto, por material: lo que
-- «Stock en almacén» da por suyo y lo que la salida se lleva primero. Es la
-- cuenta que tenía stock_libre_en_almacen (20261020195000), sin lo que una
-- salida le descontó a una unidad.
create or replace function public.separado_de_cada_linea(p_materiales uuid[])
returns table (linea uuid, material_id uuid, codigo text, numero text, cantidad numeric)
language sql stable set search_path to 'public' as $$
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
           coalesce((select sum(m.cantidad::numeric) from public.movimientos_materiales m
                      where m.orden_compra_detalle_id = d.id and m.tipo = 'INGRESO'
                        and m.devolucion_de is null), 0) as cantidad
      from public.orden_compra_material_detalles d
     where d.id in (select l.detalle from lineas l where l.detalle is not null)
  ),
  con_compra as (
    select l.*,
           greatest(l.cantidad - l.en_stock, 0) as por_comprar,
           coalesce(sum(greatest(l.cantidad - l.en_stock, 0)) over (
             partition by l.detalle order by l.creado_en, l.numero, l.item, l.id
             rows between unbounded preceding and 1 preceding), 0) as antes
      from lineas l
  ),
  con_llegado as (
    select c.*, coalesce(rc.material_id, c.material_id) as material_comprado,
           least(c.por_comprar, greatest(coalesce(rc.cantidad, 0) - c.antes, 0)) as llegado
      from con_compra c
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
$$;
-- La llaman stock_libre_en_almacen y registrar_salida_material, que ya miran
-- el permiso: sola, diría lo separado de cualquier RQ a quien no los ve.
revoke all on function public.separado_de_cada_linea(uuid[]) from public, anon, authenticated;

-- Lo que entró para cada unidad, de cada accesorio, menos lo que salió hacia
-- ella. «PLANTA» no es una unidad. La devolución no lleva el código: es el de
-- la salida que devuelve, y vuelve a ser de esa unidad. De la salida con un RQ
-- de otro código, solo lo que anotó para la unidad (de_la_unidad), y su
-- devolución le devuelve primero eso. El saldo puede ser negativo: lo que salió
-- hacia la unidad sin RQ, sin que nada hubiera entrado para ella.
create or replace function public.accesorios_de_cada_unidad(p_materiales uuid[])
returns table (material_id uuid, codigo text, saldo numeric)
language sql stable set search_path to 'public' as $$
  select u.material_id, u.codigo, sum(u.cantidad)
    from (select m.material_id,
                 public.normalizar_codigo_interno(coalesce(m.codigo_interno, o.codigo_interno)) as codigo,
                 case when m.de_la_unidad is not null
                        then -greatest(m.de_la_unidad - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                                                                   where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0)
                      when o.de_la_unidad is not null then 0
                      when m.tipo = 'INGRESO' then m.cantidad::numeric
                      else -m.cantidad::numeric end as cantidad
            from public.movimientos_materiales m
            join public.materiales mat on mat.id = m.material_id
            join public.categorias_material cat on cat.id = mat.categoria_id and cat.almacen = 'ACCESORIOS'
            left join public.movimientos_materiales o on o.id = m.devolucion_de
           where p_materiales is null or m.material_id = any(p_materiales)) u
   where u.codigo is not null and u.codigo <> 'PLANTA'
   group by u.material_id, u.codigo
$$;
revoke all on function public.accesorios_de_cada_unidad(uuid[]) from public, anon, authenticated;

create or replace function public.stock_libre_en_almacen(p_materiales uuid[] default null)
returns table (material_id uuid, codigo text, descripcion text, unidad text, almacen text, categoria text,
               existencia numeric, stock_minimo numeric, reservado_ot numeric, separado numeric, libre numeric,
               por_codigo jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_ve_rq boolean;
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.stock') or public.tiene_permiso('almacen.ver')) then
    raise exception 'No tienes permiso para ver el stock de Almacén.' using errcode = 'insufficient_privilege';
  end if;
  v_ve_rq := public.puede_ver_requerimientos();

  return query
  with existencias as (
    select e.* from public.v_existencias_materiales e
     where p_materiales is null or e.material_id = any(p_materiales)
  ),
  -- De cada código: lo que es suyo y, aparte, cuánto de eso ya separaron sus
  -- RQ abiertos. Al revisar otro RQ del mismo código solo sirve la diferencia
  -- (el accesorio que entró para la unidad y ningún RQ tomó todavía): lo
  -- separado ya es de aquel RQ, y tomarlo otra vez lo separa dos veces. Aparte,
  -- lo que entró para la unidad (el candado de la salida de un accesorio mira
  -- eso) y lo que separó cada línea: la salida de un RQ se lleva solo lo suyo.
  por_codigo as (
    select u.material_id, u.codigo,
           greatest(coalesce(max(u.del_kardex), 0), coalesce(sum(u.del_rq), 0)) as cantidad,
           coalesce(sum(u.del_rq), 0) as de_requerimientos,
           coalesce(max(u.del_kardex), 0) as del_kardex,
           array_agg(distinct u.numero order by u.numero) filter (where u.numero is not null) as requerimientos,
           jsonb_agg(jsonb_build_object('linea', u.linea, 'numero', u.numero, 'cantidad', u.del_rq)
                     order by u.numero, u.linea) filter (where u.linea is not null) as lineas
      from (select k.material_id, k.codigo, k.saldo as del_kardex, null::numeric as del_rq, null::text as numero, null::uuid as linea
              from public.accesorios_de_cada_unidad(p_materiales) k
             where k.saldo > 0
            union all
            select s.material_id, s.codigo, null, s.cantidad, s.numero, s.linea
              from public.separado_de_cada_linea(p_materiales) s
             where s.cantidad > 0) u
     where u.material_id in (select x.material_id from existencias x)
     group by u.material_id, u.codigo
  )
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.almacen, e.categoria,
         e.existencia::numeric, mat.stock_minimo::numeric, coalesce(e.reservado, 0)::numeric,
         coalesce(t.separado, 0),
         greatest(e.existencia::numeric - coalesce(e.reservado, 0) - coalesce(t.separado, 0), 0),
         coalesce(t.lista, '[]'::jsonb)
    from existencias e
    join public.materiales mat on mat.id = e.material_id
    -- Agrupado una vez y unido por material: dentro de un «lateral», Postgres
    -- rehacía todo el cálculo por cada material (60 s con 3000 materiales,
    -- 6000 líneas abiertas y 248 000 movimientos; así, 1,4 s).
    left join (
      select c.material_id, sum(c.cantidad) as separado,
             jsonb_agg(jsonb_build_object(
               'codigo', c.codigo,
               'cantidad', c.cantidad,
               'de_requerimientos', c.de_requerimientos,
               'del_kardex', c.del_kardex,
               'requerimientos', case when v_ve_rq then to_jsonb(coalesce(c.requerimientos, '{}'::text[])) else '[]'::jsonb end,
               'lineas', case when v_ve_rq then coalesce(c.lineas, '[]'::jsonb) else '[]'::jsonb end
             ) order by c.codigo) as lista
        from por_codigo c
       group by c.material_id
    ) t on t.material_id = e.material_id;
end $$;
revoke all on function public.stock_libre_en_almacen(uuid[]) from public, anon;
grant execute on function public.stock_libre_en_almacen(uuid[]) to authenticated;

comment on function public.stock_libre_en_almacen(uuid[]) is
  'El stock de cada material con kardex, sin precios: cuánto hay, cuánto ya es de cada código interno (lo separado para un RQ abierto y no entregado, y los accesorios que entraron para una unidad) y cuánto queda libre. De cada código, aparte, lo que entró para su unidad (del_kardex) y lo que separó cada línea de sus RQ (lineas). Con almacen.stock (Supervisión, Requerimientos, Administración) o almacen.ver. p_materiales filtra por material.';
