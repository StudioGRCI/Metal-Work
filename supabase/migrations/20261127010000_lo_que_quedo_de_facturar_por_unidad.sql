-- =============================================================================
-- Lo que quedó de «Facturar por unidad cotizada» (entrega 3)
-- =============================================================================
-- DKS aprobó el plan de la entrega 3 el 27/11, por tarjeta («Sí, con este plan»).
-- Sigue a la 20261126998000 (la factura dice de qué unidad es) y a la
-- 20261126998900 (el recorrido, unidad por unidad).
--
-- 1. Administración elige la unidad al cargar la OT. Hasta ahora la OT tomaba la
--    primera unidad libre: la que reemplazaba a una OT anulada de la unidad 3 no
--    podía ir a la 3 mientras la 2 estuviera libre, y la pantalla le pedía cargar
--    primero «la que reemplaza a la anulada». Sin elegir, sigue la primera libre.
-- 2. El recorrido dice la verdad en dos casos que ya pasaban con una unidad:
--    · la OT cuya unidad se quedó sin código interno ya no sale «Con código
--      interno y OT»: espera a Administración, que se lo vuelve a dar, y la
--      factura espera con ella (sin código no se factura);
--    · la OT que llegó de otra venta con «Editar OT» cuenta desde que llegó, y por
--      quien la pasó, no desde que se creó allá.
--    Y deja de mandar el detalle «lleva/de» de la cotización de varias unidades,
--    que desde la 20261126998900 ya no se leía.
-- 3. La factura de la unidad que pasó a otro comprador dice eso, en vez de
--    «todavía no tiene su OT … la carga Administración», que nadie iba a cargar.
-- 4. La cotización no se anula con facturas vigentes (la pantalla no lo ofrecía,
--    la API sí dejaba), y si tiene varias OT activas las nombra todas.
--
-- Solo si las funciones que reemplaza siguen siendo las que conoce el
-- repositorio (la guarda de la huella). La carga de la OT cambia de firma: se
-- suelta la de antes y se crea la nueva, con sus permisos, en la misma
-- transacción.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  r record;
  hay boolean;
begin
  for f in
    select * from (values
      -- La de la 20261126988000, y la de esta migración (con su firma nueva).
      ('cargar_codigo_y_ot_de_cotizacion', array['ead3df8364d77d7bbb1b4b2bc68c16de', 'd3e5e1b6fdcd9bc4a32fdbe20c4f1299']),
      -- La de la 20261126998900, y la de esta.
      ('recorrido_de_cotizaciones', array['e5a553a26cd019f52826f33ac472c0fa', 'ade95929f25ab67cfd6d0482c3b57462']),
      -- La de la 20261126998000, y la de esta.
      ('registrar_factura_venta_de_unidad', array['7c0672cb2a79fd67a0bd774c4d0eb2aa', '99576605a8eb809a3e579dda2db0575a']),
      -- La de la 20261126988000, y la de esta.
      ('fn_cotizacion_pdf_anular', array['f4b882cbd42c112831e248a41e5ae2cd', '8a5ce7f184bc1932cd67c908c93467bd']),
      -- Las de la 20261126998800 (el costeo) y la 20261126760000, y las de esta.
      ('margen_ot', array['088e295d4723fba20ca7236eb322de0d', '073c23ee30f1e1cbf6d0b16ac8474b91']),
      ('codigos_internos_costo_calculado', array['a55f8e1dd0f91f18a64a65bde5104c56', '4b840334dad6a827d75d4e17eb7369fe']),
      ('ordenes_de_cotizacion', array['e4acea0d52c7122a10ac633c3d25fb96', '25bc7b3a1be2905a2ce341056e00a76b'])
    ) as t(nombre, conocidas)
  loop
    hay := false;
    for r in
      select p.oid::regprocedure::text as firma, md5(replace(p.prosrc, E'\r', '')) as huella
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.nombre
    loop
      hay := true;
      if not (r.huella = any (f.conocidas)) then
        raise exception 'La función % no es la que conoce el repositorio (huella %): no se reemplaza. Avisa antes de seguir.', r.firma, r.huella;
      end if;
    end loop;
    if not hay then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', f.nombre;
    end if;
  end loop;
  if to_regprocedure('public.unidades_que_salieron_de_la_cotizacion(uuid)') is null then
    raise exception 'Falta unidades_que_salieron_de_la_cotizacion: aplica antes la migración 20261126988000.';
  end if;
end $$;

-- 0b. Desde cuándo la OT está sin código interno -------------------------------
-- Lo último entre que la OT llegó a esta venta (se creó aquí, o pasó desde otra
-- con «Editar OT») y que su unidad perdió el código (la bitácora). Por OT, o la
-- OT vigente de la cotización de una unidad. Ayudante interno del recorrido.
create or replace function public.ot_sin_codigo_desde(p_cotizacion uuid, p_orden uuid)
returns timestamptz
language sql
stable
security invoker
set search_path to 'public'
as $$
  select greatest(coalesce((select max(v.creado_en) from public.ot_ventas_anteriores v where v.orden_id = o.id), o.creado_en),
                  coalesce((select max(b.creado_en) from public.audit_log b
                             where b.tabla = 'unidades' and b.registro_id = o.unidad_id
                               and public.normalizar_codigo_interno(b.datos_antes ->> 'codigo_interno') is not null
                               and public.normalizar_codigo_interno(b.datos_despues ->> 'codigo_interno') is null),
                           o.creado_en))
    from public.ordenes_trabajo o
   where o.estado <> 'ANULADA'
     and (o.id = p_orden or (p_orden is null and o.cotizacion_pdf_id = p_cotizacion))
   order by o.creado_en desc
   limit 1;
$$;

comment on function public.ot_sin_codigo_desde(uuid, uuid) is
  'Desde cuándo una OT vigente espera que Administración le vuelva a dar el código interno a su unidad. Ayudante interno del recorrido (20261127010000).';

revoke all on function public.ot_sin_codigo_desde(uuid, uuid) from public, anon, authenticated;

-- 1. Administración elige la unidad al cargar la OT -----------------------------
-- La firma cambia (p_unidad al final, con null por omisión): se suelta la de antes.
drop function if exists public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text);

create or replace function public.cargar_codigo_y_ot_de_cotizacion(
  p_cotizacion     uuid,
  p_orden          uuid,
  p_codigo_interno text,
  p_numero_ot      text,
  p_tipo_unidad    public.tipo_unidad_carroceria,
  p_fecha_entrega  date,
  p_ruta_pdf       text,
  p_nombre_pdf     text,
  p_tamano_pdf     bigint,
  p_marca          text default null,
  p_modelo         text default null,
  p_unidad         integer default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot      record;
  v_codigo   constant text := public.normalizar_codigo_interno(p_codigo_interno);
  v_clave    constant text := upper(regexp_replace(coalesce(p_codigo_interno, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo    constant text := btrim(coalesce(p_numero_ot, ''));
  v_cifras   text;
  v_anio     text;
  v_numero   text;
  v_otra     text;
  v_vigentes integer;
  v_salieron text[];
  v_unidad   uuid;
  v_ajena    text;
  v_sede     uuid;
  v_tipo     constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                 when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
  v_enlace   text;
  v_cual     text;
  v_n        integer;
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'No tienes permiso para dar el código interno ni subir la OT de la cotización.'
      using errcode = 'insufficient_privilege';
  end if;

  select c.*, tc.nombre as carroceria, cl.razon_social as cliente
    into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
    left join public.clientes cl on cl.id = c.cliente_id
   where c.id = p_cotizacion
     for update of c;
  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado = 'POR_REVISAR' then
    raise exception 'La cotización % todavía no está aprobada: su código y su OT se cargan cuando se apruebe.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado = 'RECHAZADA' then
    raise exception 'La cotización % está rechazada: Ventas sube la corrección y vuelve a aprobarse.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % está anulada: no lleva OT.', v_cot.numero using errcode = 'check_violation';
  end if;

  -- La misma carga otra vez (la respuesta se perdió y la pantalla pregunta de
  -- nuevo con la misma OT): con una unidad la frenaba «ya tiene su OT»; con
  -- varias, la carga siguiente cabe y la frenaría su propio código. Se dice
  -- como duplicado, y la acción reconoce que es la suya por el id, que nace en
  -- ese envío, y por quién la creó.
  if exists (select 1 from public.ordenes_trabajo where id = p_orden) then
    raise exception 'Esa OT ya quedó registrada la primera vez que la enviaste.' using errcode = 'unique_violation';
  end if;

  select count(*), min(o.numero) into v_vigentes, v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA';
  if v_vigentes >= v_cot.cantidad_unidades then
    if v_cot.cantidad_unidades = 1 then
      raise exception 'La cotización % ya tiene su OT %.', v_cot.numero, v_otra
        using errcode = 'unique_violation';
    end if;
    raise exception 'La cotización % es de % unidades y ya tiene sus % OT.', v_cot.numero, v_cot.cantidad_unidades, v_vigentes
      using errcode = 'unique_violation';
  end if;
  -- La venta que pasó a otro comprador ya no lleva otra OT (DKS, 2026-11-26):
  -- su unidad cuenta como cargada.
  v_salieron := public.ordenes_que_salieron_de_la_cotizacion(p_cotizacion, null);
  if v_vigentes + cardinality(v_salieron) >= v_cot.cantidad_unidades then
    raise exception '%', public.venta_que_paso_a_otro_comprador(v_cot.numero, v_cot.cantidad_unidades, v_vigentes, v_salieron)
      using errcode = 'check_violation';
  end if;

  -- El código interno: obligatorio, y el de una unidad, no PLANTA.
  if v_codigo is null then
    raise exception 'Escribe el código interno que tendrá la unidad.' using errcode = 'check_violation';
  end if;
  if v_clave = '' then
    raise exception 'El código interno debe tener letras o números.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) > 40 then
    raise exception 'El código interno no pasa de 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_clave = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: escribe el código interno de la unidad que se fabrica.'
      using errcode = 'check_violation';
  end if;
  -- Cada unidad de la cotización, su propio código.
  select o.numero into v_otra
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
     and upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
   limit 1;
  if found then
    raise exception 'El código % ya es de la OT % de esta cotización: cada unidad lleva su propio código.', v_codigo, v_otra
      using errcode = 'check_violation';
  end if;

  -- El número de la OT es el que trae su papel: 2922, o 2922-2026.
  if v_crudo ~ '^\d{1,6}$' then
    v_cifras := v_crudo;
    v_anio := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_cifras := split_part(v_crudo, '-', 1);
    v_anio := split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_cifras := ltrim(v_cifras, '0');
  if v_cifras = '' then
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_numero := (case when char_length(v_cifras) < 4 then lpad(v_cifras, 4, '0') else v_cifras end) || '-' || v_anio;
  if exists (select 1 from public.ordenes_trabajo where numero = v_numero) then
    raise exception 'Ya hay una OT %: revisa el número de su papel.', v_numero using errcode = 'unique_violation';
  end if;

  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  -- Sin fecha de entrega la OT se carga igual (migración 20261126330000): queda
  -- en «Por completar», arriba de la lista de OT, hasta que se la ponga.
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3)
     or split_part(p_ruta_pdf, '/', 3) = '' then
    raise exception 'El PDF de la OT no llegó en su sitio: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  -- La unidad: la que ya lleva ese código y es de este cliente (o de nadie), o
  -- una nueva. Un código de otro cliente no se toma.
  select u.id into v_unidad
    from public.unidades u
   where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
   order by (u.cliente_id is not null) desc, u.creado_en desc
   limit 1;
  if v_unidad is null then
    select coalesce(cl.razon_social, 'otro cliente') into v_ajena
      from public.unidades u
      left join public.clientes cl on cl.id = u.cliente_id
     where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     limit 1;
    if v_ajena is not null then
      raise exception 'El código interno % ya es de una unidad de %: elige otro.', v_codigo, v_ajena
        using errcode = 'unique_violation';
    end if;
    insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_codigo,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  else
    update public.unidades set cliente_id = v_cot.cliente_id where id = v_unidad and cliente_id is null;
  end if;

  -- Qué unidad de la cotización es. Administración la elige (DKS, 27/11: la OT
  -- que reemplaza a una anulada va a la unidad de ese vehículo, sin cargar antes
  -- las otras); sin elegir, la primera que no tiene OT vigente (si se anuló la de
  -- la 2, esta es la 2) ni pasó a otro comprador (la OT conserva su número de
  -- unidad al pasar: 20261126988000).
  if p_unidad is not null then
    if p_unidad < 1 or p_unidad > v_cot.cantidad_unidades then
      if v_cot.cantidad_unidades = 1 then
        raise exception 'La cotización % es de una sola unidad.', v_cot.numero using errcode = 'check_violation';
      end if;
      raise exception 'La cotización % es de % unidades: elige una de la 1 a la %.',
        v_cot.numero, v_cot.cantidad_unidades, v_cot.cantidad_unidades using errcode = 'check_violation';
    end if;
    select o.numero into v_otra
      from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
       and coalesce(o.numero_de_unidad, 1) = p_unidad
     limit 1;
    if found then
      raise exception 'La unidad % de la cotización % ya tiene su OT %: elige otra.', p_unidad, v_cot.numero, v_otra
        using errcode = 'unique_violation';
    end if;
    if exists (select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
                where (e->>'unidad')::integer = p_unidad) then
      raise exception 'La unidad % de la cotización % pasó a otro comprador: ya no lleva otra OT.', p_unidad, v_cot.numero
        using errcode = 'check_violation';
    end if;
    v_n := p_unidad;
  else
    select min(k) into v_n
      from generate_series(1, v_cot.cantidad_unidades) k
     where not exists (select 1 from public.ordenes_trabajo o
                        where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
                          and coalesce(o.numero_de_unidad, 1) = k)
       and not exists (select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
                        where (e->>'unidad')::integer = k);
    -- Una OT cargada antes de 20261126988000 pudo tomar el número de la que
    -- pasó: entonces, la primera sin OT vigente, como antes.
    if v_n is null then
      select min(k) into v_n
        from generate_series(1, v_cot.cantidad_unidades) k
       where not exists (select 1 from public.ordenes_trabajo o
                          where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
                            and coalesce(o.numero_de_unidad, 1) = k);
    end if;
  end if;
  v_cual := case when v_cot.cantidad_unidades > 1
                 then format('unidad %s de %s', v_n, v_cot.cantidad_unidades) end;

  -- La OT nace aprobada, con su PDF: Gerencia ya aprobó su cotización.
  v_sede := coalesce(public.mi_sede(), (select id from public.sedes where activo order by nombre limit 1));
  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo,
                                      prioridad, descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad,
                                      numero_de_unidad)
  values (p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION',
          'NORMAL', concat_ws(' · ', v_cot.carroceria, v_tipo, 'cotización ' || v_cot.numero, v_cual), p_fecha_entrega,
          'APROBADA', p_cotizacion, p_tipo_unidad, v_n);
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_cifras::bigint)
   where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = v_sede) and correlativo_actual < v_cifras::bigint;
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf, 'application/pdf',
          p_tamano_pdf, public.usuario_actual());

  -- Los avisos: Diseño y el taller como cuando aprobaba Gerencia, y Ventas, que
  -- desde aquí recibe el código aparte de la aprobación.
  v_enlace := '/diseno/codigo?codigo='
    || replace(replace(replace(replace(replace(replace(v_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  perform public.notificar_a_permiso(
    'diseno.codigos',
    'Código nuevo con su OT',
    format('%s: OT %s, %s (%s) de %s Entrega prometida: %s. Carga sus planos, materiales y etapas.',
           v_codigo, v_numero, v_cot.carroceria, lower(v_tipo), public.con_punto_final(coalesce(v_cot.cliente, 'un cliente')),
           coalesce(to_char(p_fecha_entrega, 'DD/MM/YYYY'), 'por definir')),
    v_enlace, 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Código nuevo en el taller',
    format('%s: %s, %s. Diseño cargará sus planos y etapas.', v_codigo, v_cot.carroceria, lower(v_tipo)),
    '/planos', 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_usuario(
    v_cot.registrado_por,
    'Tu cotización ya tiene su código',
    case when v_cual is null
         then format('La %s de %s quedó con el código interno %s y la OT %s.',
                     v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_codigo, v_numero)
         else format('La %s de %s: la %s quedó con el código interno %s y la OT %s.%s',
                     v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_cual, v_codigo, v_numero,
                     case when v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1 = 0 then ' Ya están todas.'
                          when v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1 = 1 then ' Falta 1.'
                          else format(' Faltan %s.', v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1) end) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text, integer) is
  'Administración (ordenes.crear) da el código interno de una unidad y sube el PDF de su OT, de una cotización ya aprobada, todo junto o nada; Administración elige la unidad (p_unidad) o va la primera libre (20261127010000); una OT por unidad hasta cantidad_unidades (migraciones 20261027200000 y 20261126760000); la unidad cuya OT pasó a otro comprador cuenta como cargada (20261126988000).';

revoke all on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text, integer)
  from public, anon;
grant execute on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text, integer)
  to authenticated;


-- 2. El recorrido: la OT sin código y la OT que llegó de otra venta ---------------
create or replace function public.recorrido_de_cotizaciones(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text,
  unidad    integer,
  unidades  integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin     constant boolean := public.es_admin();
  v_comercial constant boolean := public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  v_aprobadas constant boolean := public.tiene_permiso('cotizaciones.ver_aprobadas');
  v_tesoreria constant boolean := public.tiene_permiso('tesoreria.ver_documentos');
  -- El número de la OT lo lee quien lee las órdenes (`puede_ver_orden`); los demás ven el paso sin número.
  v_ordenes   constant boolean := public.es_admin() or public.tiene_permiso('ordenes.ver');
  -- El cobro lo ve quien lee los cobros: la política `ver_cobros_factura_venta`, tal cual.
  v_cobros    constant boolean := v_admin or public.tiene_permiso('contabilidad.facturar') or v_aprobadas or v_tesoreria;
begin
  if not (v_admin or v_comercial or v_aprobadas or v_tesoreria) then
    raise exception 'No tienes permiso para ver las cotizaciones.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with cot as (
    select c.id, c.estado::text as estado, c.registrado_por, c.creado_en, c.revisado_por, c.revisado_en,
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en, c.moneda::text as moneda,
           coalesce(c.cantidad_unidades, 1) as unidades,
           -- Las OT que fueron su venta y pasaron a otro comprador: su unidad ya no
           -- lleva OT (20261126988000). Sin ninguna vigente y todas así, la venta se cerró.
           cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) as salieron,
           (cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) >= coalesce(c.cantidad_unidades, 1)
            and not exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')) as cerrada,
           -- La de varias unidades se sigue unidad por unidad desde que Gerencia la
           -- aprueba, o antes si ya tiene una OT, una factura o una unidad que pasó
           -- a otro comprador. Mientras nadie hizo nada de eso, lo que falta se dice
           -- una vez, como en la de una unidad.
           (coalesce(c.cantidad_unidades, 1) > 1
            and (c.estado::text in ('APROBADA', 'ANULADA')
                 or exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')
                 or exists (select 1 from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null)
                 or cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) > 0)) as por_unidad,
           -- El total con IGV, como lo cuenta Facturación (`totalConIgv`): sin IGV, se le suma el 18 %.
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.id = any(p_ids)
       -- La política `ver_cotizaciones_pdf`, tal cual.
       and (v_admin or v_comercial
            or (v_tesoreria and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
                                         where l.cotizacion_pdf_id = c.id))
            or (v_aprobadas and public.cotizacion_fue_aprobada(c.id)))
  ),
  -- Cada versión que se archivó al corregir, con cuándo se subió la siguiente.
  versiones as (
    select v.cotizacion_id as cot, v.version, v.rechazado_por, v.rechazado_en, v.estado_al_archivar,
           coalesce(lead(v.subido_en) over (partition by v.cotizacion_id order by v.version), c.archivo_subido_en) as corregida_en
      from public.cotizaciones_pdf_versiones v
      join cot c on c.id = v.cotizacion_id
  ),
  -- La primera OT vigente que salió de ella, desde cuándo tiene código interno,
  -- y cuántas vigentes tiene: con varias unidades, el paso queda hecho cuando
  -- están todas (migración 20261126760000).
  -- La OT que llegó de otra venta con «Editar OT» cuenta desde que llegó, y
  -- por quien la pasó, no desde que se creó allá (entrega 3, 20261127010000).
  -- `sin_codigo`: su unidad se quedó sin código interno; sin código no se factura.
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.por as creado_por, o.en as creado_en,
           public.codigo_interno_de_cotizacion_desde(o.cotizacion_pdf_id) as con_codigo_en,
           (count(*) over (partition by o.cotizacion_pdf_id))::integer as vigentes,
           max(o.en) over (partition by o.cotizacion_pdf_id) as ultima_en,
           o.sin_codigo
      from (select o.cotizacion_pdf_id, o.numero,
                   coalesce(l.creado_por, o.creado_por) as por, coalesce(l.creado_en, o.creado_en) as en,
                   public.normalizar_codigo_interno(u.codigo_interno) is null as sin_codigo
              from public.ordenes_trabajo o
              left join public.unidades u on u.id = o.unidad_id
              left join lateral (select v.creado_por, v.creado_en from public.ot_ventas_anteriores v
                                  where v.orden_id = o.id order by v.creado_en desc limit 1) l on true
             where o.estado <> 'ANULADA') o
      join cot c on c.id = o.cotizacion_pdf_id
     order by o.cotizacion_pdf_id, o.en
  ),
  -- Su primera factura vigente: solo quién y cuándo, sin número ni monto.
  factura as (
    select distinct on (f.cotizacion_pdf_id) f.cotizacion_pdf_id as cot, f.registrado_por, f.creado_en
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
     where f.anulada_en is null
     order by f.cotizacion_pdf_id, f.creado_en
  ),
  -- Cada factura vigente con su cobro, como lo cuenta `v_facturas_venta`:
  -- cobrada si un cobro vigente la cancela o si lo cobrado alcanza su total.
  facturas as (
    select f.cotizacion_pdf_id as cot, f.id, f.moneda::text as moneda, f.total, f.creado_en, f.registrado_por,
           coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false)
             or coalesce(sum(b.monto) filter (where b.anulado_en is null), 0) >= f.total as cobrada,
           count(b.id) filter (where b.anulado_en is null) as cobros
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
      left join public.cobros_factura_venta b on b.factura_id = f.id
     where f.anulada_en is null
     group by f.id
  ),
  -- Lo facturado de cada cotización en su moneda, y si alguna factura va en otra.
  facturado as (
    select c.id as cot,
           coalesce(sum(x.total) filter (where x.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(x.moneda <> c.moneda) as en_otra_moneda
      from cot c join facturas x on x.cot = c.id
     group by c.id
  ),
  -- Facturada en parte: le falta facturar lo que no cubren sus facturas, esté
  -- aprobada o en corrección. Con una factura en otra moneda no se compara, como
  -- en Facturación.
  falta_resto as (
    select c.id as cot
      from cot c
      join facturado x on x.cot = c.id
     where c.estado <> 'ANULADA' and c.total is not null
       -- La venta cerrada no se factura más: lo cobrado de su factura la deja cobrada (20261126988000).
       and not c.cerrada
       and not x.en_otra_moneda and x.en_su_moneda < c.total - 0.005
  ),
  -- El último cobro vigente, el que la dejó cobrada: quién y cuándo, sin monto.
  ultimo_cobro as (
    select distinct on (x.cot) x.cot, b.registrado_por, b.creado_en
      from facturas x
      join public.cobros_factura_venta b on b.factura_id = x.id and b.anulado_en is null
     order by x.cot, b.fecha desc, b.creado_en desc
  ),
  -- Los pasos de la cotización contada como una sola cosa: los de siempre. Es
  -- el cuerpo de la 20261126988000 sin tocar, para que la de una unidad salga
  -- idéntica. De la que se sigue por unidad solo quedan, más abajo, los pasos de
  -- toda la cotización: lo que aquí se arma con varias unidades para la OT, la
  -- factura y el cobro (el detalle «lleva/de», «N OT») ya no llega a nadie.
  pasos_de_toda as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT, la factura y el cobro.
    -- Ventas la subió
    select c.id as cot, 10 as canon, 'SUBIDA' as paso, 'HECHO' as situacion, c.registrado_por as quien, null::text as puesto_fijo,
           c.creado_en as en, null::text as espera, null::text as detalle
      from cot c
    union all
    -- La revisión de cada versión anterior
    select v.cot, v.version * 10 + 20, 'REVISION', 'HECHO', v.rechazado_por, null, v.rechazado_en, null, v.estado_al_archivar
      from versiones v where v.rechazado_en is not null
    union all
    -- La corrección que la reemplazó
    select v.cot, v.version * 10 + 25, 'CORRECCION', 'HECHO', c.registrado_por, null, v.corregida_en, null, 'versión ' || (v.version + 1)
      from versiones v join cot c on c.id = v.cot
    union all
    -- La revisión de la versión vigente. La anulada conserva quién la revisó y
    -- cuándo; cómo terminó esa revisión (aprobada o rechazada) ya no está en
    -- ninguna columna y sale de la bitácora, del estado que tenía al anularse.
    select c.id, c.version * 10 + 20, 'REVISION', 'HECHO', c.revisado_por, null, c.revisado_en, null,
           case when c.estado = 'ANULADA' then
                  (select b.datos_antes ->> 'estado' from public.audit_log b
                    where b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id and b.accion = 'UPDATE'
                      and b.datos_despues ->> 'estado' = 'ANULADA'
                    order by b.creado_en desc limit 1)
                else c.estado end
      from cot c where c.estado in ('APROBADA', 'RECHAZADA', 'ANULADA') and c.revisado_en is not null
    union all
    select c.id, c.version * 10 + 20, 'REVISION', 'AHORA', null, 'Gerencia', c.archivo_subido_en, 'REVISION', null
      from cot c where c.estado = 'POR_REVISAR'
    union all
    -- Rechazada: vuelve a quien la subió, y después Gerencia revisa la corrección
    select c.id, c.version * 10 + 25, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(c.registrado_por), 'Ventas'), c.revisado_en, 'CORRECCION', null
      from cot c where c.estado = 'RECHAZADA'
    union all
    select c.id, c.version * 10 + 30, 'REVISION', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado = 'RECHAZADA'
    union all
    -- Administración le dio el código interno y subió la OT. Con varias
    -- unidades, cuando cargó la de la última: hasta entonces la sigue teniendo.
    -- Con una sola OT, su número; con varias, cuántas.
    select o.cot, 100000, 'CODIGO_Y_OT', 'HECHO', o.creado_por, null, o.ultima_en, null,
           case when c.unidades > 1 then o.vigentes || ' OT' when v_ordenes then 'OT ' || o.numero end
      from ot o join cot c on c.id = o.cot
     where (o.vigentes + c.salieron >= c.unidades or c.estado = 'ANULADA')
       and not (c.estado = 'APROBADA' and c.unidades = 1 and o.sin_codigo)
    union all
    -- Su OT se quedó sin código interno: Administración se lo vuelve a dar, desde
    -- que lo perdió (la bitácora de la unidad) o desde la OT.
    select o.cot, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', public.ot_sin_codigo_desde(c.id, null), 'SIN_CODIGO',
           case when v_ordenes then 'OT ' || o.numero end
      from ot o join cot c on c.id = o.cot
     where c.estado = 'APROBADA' and c.unidades = 1 and o.sin_codigo
    union all
    -- Su OT pasó a otro comprador con «Editar OT» (20261126988000): esa unidad ya
    -- no lleva OT. El número, solo a quien lee las órdenes.
    select c.id, 99990, 'OTRO_COMPRADOR', 'HECHO', va.creado_por, null, va.creado_en, null,
           case when v_ordenes then array_to_string(public.ordenes_que_salieron_de_la_cotizacion(c.id, null), ', ') end
      from cot c
      cross join lateral (
        select v.creado_por, v.creado_en from public.ot_ventas_anteriores v
          join public.ordenes_trabajo t on t.id = v.orden_id
         where v.cotizacion_pdf_id = c.id and t.cotizacion_pdf_id is distinct from c.id
         order by v.creado_en desc limit 1
      ) va
     where c.salieron > 0
    union all
    -- Espera desde la aprobación, tenga ya algunas o ninguna. El detalle dice
    -- cuántas lleva de cuántas («1/3») cuando la cotización es de varias.
    select c.id, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', c.revisado_en, 'CODIGO_Y_OT',
           null
      from cot c left join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from cot c left join ot o on o.cot = c.id
     where c.estado in ('POR_REVISAR', 'RECHAZADA') and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    -- Contabilidad la facturó. A quien lee las facturas le dice si fue solo una parte.
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from falta_resto r where r.cot = f.cot) then 'EN_PARTE' end
      from factura f
    union all
    -- Espera su factura desde que la OT tiene código interno (DKS, Plan 10). Con
    -- varias unidades, cuando están todas sus OT, desde la última.
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad',
           case when c.unidades > 1 then o.ultima_en else coalesce(o.con_codigo_en, o.creado_en) end, 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and o.vigentes + c.salieron >= c.unidades and not o.sin_codigo
       and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id and o.vigentes + c.salieron >= c.unidades and not o.sin_codigo))
    union all
    -- Facturada en parte: espera la factura de lo que falta, desde la misma hora.
    -- Cuánto se facturó solo lo ve quien lee las facturas: Ventas no.
    select r.cot, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from falta_resto r
      join cot c on c.id = r.cot
      join ot o on o.cot = r.cot
     where v_cobros and c.estado = 'APROBADA' and not o.sin_codigo
    union all
    select r.cot, 100015, 'FACTURA_RESTO', 'PENDIENTE', null, null, null, null, null
      from falta_resto r
      join cot c on c.id = r.cot
      join ot o on o.cot = r.cot
     where v_cobros and c.estado = 'APROBADA' and o.sin_codigo
    union all
    -- Tesorería la cobró: todas sus facturas vigentes quedaron cobradas y no falta
    -- facturar nada. Cobrado el adelanto, el cobro del resto sigue pendiente.
    select u.cot, 100018, 'COBRO', 'HECHO', u.registrado_por, null, u.creado_en, null, null
      from ultimo_cobro u
     where v_cobros and not exists (select 1 from facturas x where x.cot = u.cot and not x.cobrada)
       and not exists (select 1 from falta_resto r where r.cot = u.cot)
    union all
    select r.cot, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from falta_resto r
     where v_cobros and not exists (select 1 from facturas x where x.cot = r.cot and not x.cobrada)
    union all
    -- Alguna factura vigente espera su cobro: desde la más vieja de las que faltan.
    select x.cot, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from facturas x
     where v_cobros and not x.cobrada
     group by x.cot
    union all
    select c.id, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from cot c
     where v_cobros and c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from facturas x where x.cot = c.id)
    union all
    -- Anulada
    select c.id, 100020, 'ANULACION', 'HECHO', c.anulado_por, null, c.anulado_en, null, null
      from cot c where c.estado = 'ANULADA' and c.anulado_en is not null
  ),
  -- Desde aquí, lo de la cotización que se sigue unidad por unidad -------------
  -- Cada unidad, con lo que le toca del total (`parte_de_unidad`, como Facturación).
  uni as (
    select c.id as cot, k.unidad, c.unidades, c.estado, c.revisado_en, c.moneda,
           public.parte_de_unidad(c.total, c.unidades::integer, k.unidad) as parte
      from cot c
      cross join lateral generate_series(1, c.unidades::integer) as k(unidad)
     where c.por_unidad
  ),
  -- La OT vigente de cada unidad y desde cuándo tiene su código interno.
  u_ot as (
    select distinct on (o.cotizacion_pdf_id, coalesce(o.numero_de_unidad, 1))
           o.cotizacion_pdf_id as cot, coalesce(o.numero_de_unidad, 1)::integer as unidad, o.id,
           o.numero, coalesce(l.creado_por, o.creado_por) as creado_por, coalesce(l.creado_en, o.creado_en) as creado_en,
           public.codigo_interno_de_ot_desde(o.id) as con_codigo_en,
           public.normalizar_codigo_interno(un.codigo_interno) is null as sin_codigo
      from public.ordenes_trabajo o
      join cot c on c.id = o.cotizacion_pdf_id
      left join public.unidades un on un.id = o.unidad_id
      -- La OT que llegó de otra venta: desde que llegó, y por quien la pasó.
      left join lateral (select v.creado_por, v.creado_en from public.ot_ventas_anteriores v
                          where v.orden_id = o.id order by v.creado_en desc limit 1) l on true
     where c.por_unidad and o.estado <> 'ANULADA'
     order by o.cotizacion_pdf_id, coalesce(o.numero_de_unidad, 1), o.creado_en desc
  ),
  -- La unidad cuya OT pasó a otro comprador: la que dejó en esta venta
  -- (`unidad_que_dejo_la_ot`). Quién la pasó y cuándo salió de esta venta.
  u_salio as (
    select distinct on (c.id, k.unidad)
           c.id as cot, k.unidad, t.numero, s.salio_en as en,
           (select va.creado_por from public.ot_ventas_anteriores va
             where va.orden_id = s.orden_id and va.cotizacion_pdf_id = c.id
             order by va.creado_en desc limit 1) as por
      from cot c
      cross join lateral public.salidas_de_la_cotizacion(c.id, null) s
      join public.ordenes_trabajo t on t.id = s.orden_id
      cross join lateral (select public.unidad_que_dejo_la_ot(t.id, c.id) as unidad) k
     where c.por_unidad and c.salieron > 0
       and not exists (select 1 from u_ot o where o.cot = c.id and o.unidad = k.unidad)
     order by c.id, k.unidad, s.salio_en desc
  ),
  -- Cuándo perdió la unidad su última OT: la anulación de una OT suya, aquí o
  -- allá donde había pasado. La OT anulada no acepta más cambios, así que su
  -- `actualizado_en` es la hora en que se anuló (como en
  -- `ot_anulada_que_reabre_la_venta`).
  u_anulaciones as (
    select x.cot, x.unidad, x.en
      from (
        select o.cotizacion_pdf_id as cot, coalesce(o.numero_de_unidad, 1)::integer as unidad, o.actualizado_en as en
          from public.ordenes_trabajo o
          join cot c on c.id = o.cotizacion_pdf_id
         where c.por_unidad and o.estado = 'ANULADA'
        union all
        select c.id, public.unidad_que_dejo_la_ot(t.id, c.id), t.actualizado_en
          from cot c
          cross join lateral public.camino_de_las_salidas(c.id, null) s
          join public.ordenes_trabajo t on t.id = s.orden_id
         where c.por_unidad and s.anulada
           and exists (select 1 from public.ot_ventas_anteriores va where va.cotizacion_pdf_id = c.id)
      ) x
  ),
  u_sin_ot_desde as (
    select a.cot, a.unidad, max(a.en) as en from u_anulaciones a group by a.cot, a.unidad
  ),
  -- Cada factura vigente en la unidad que cubre, con su parte. La factura por
  -- toda la cotización sale una vez por unidad.
  u_facturas as (
    select x.cot, p.numero_de_unidad::integer as unidad, x.id, x.moneda, p.monto, x.creado_en, x.registrado_por, x.cobrada, x.cobros
      from facturas x
      join cot c on c.id = x.cot
      join public.facturas_venta_unidades p on p.factura_id = x.id
     where c.por_unidad
  ),
  -- Lo facturado de cada unidad en la moneda de la cotización, y si algo va en otra.
  u_facturado as (
    select f.cot, f.unidad,
           coalesce(sum(f.monto) filter (where f.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(f.moneda <> c.moneda) as en_otra_moneda
      from u_facturas f join cot c on c.id = f.cot
     group by f.cot, f.unidad
  ),
  -- La unidad facturada en parte: le falta lo que sus facturas no cubren de lo
  -- suyo. La que pasó a otro comprador no se factura más.
  u_falta_resto as (
    select u.cot, u.unidad
      from uni u
      join u_facturado x on x.cot = u.cot and x.unidad = u.unidad
     where u.estado <> 'ANULADA' and u.parte is not null
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not x.en_otra_moneda and x.en_su_moneda < u.parte - 0.005
  ),
  -- El último cobro vigente de las facturas de la unidad: quién y cuándo, sin monto.
  u_ultimo_cobro as (
    select distinct on (f.cot, f.unidad) f.cot, f.unidad, b.registrado_por, b.creado_en
      from u_facturas f
      join public.cobros_factura_venta b on b.factura_id = f.id and b.anulado_en is null
     order by f.cot, f.unidad, b.fecha desc, b.creado_en desc
  ),
  pasos_de_unidad as (
    -- Administración le dio su código interno y subió su OT.
    select o.cot, o.unidad, 100000 as canon, 'CODIGO_Y_OT' as paso, 'HECHO' as situacion, o.creado_por as quien, null::text as puesto_fijo,
           o.creado_en as en, null::text as espera, case when v_ordenes then 'OT ' || o.numero end as detalle
      from u_ot o join uni u on u.cot = o.cot and u.unidad = o.unidad
     where not (u.estado = 'APROBADA' and o.sin_codigo)
    union all
    -- Su OT se quedó sin código interno: Administración se lo vuelve a dar.
    select o.cot, o.unidad, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', public.ot_sin_codigo_desde(null, o.id),
           'SIN_CODIGO', case when v_ordenes then 'OT ' || o.numero end
      from u_ot o join uni u on u.cot = o.cot and u.unidad = o.unidad
     where u.estado = 'APROBADA' and o.sin_codigo
    union all
    -- Su OT pasó a otro comprador: esta unidad ya no lleva OT.
    select s.cot, s.unidad, 99990, 'OTRO_COMPRADOR', 'HECHO', s.por, null, s.en, null, case when v_ordenes then s.numero end
      from u_salio s join uni u on u.cot = s.cot and u.unidad = s.unidad
    union all
    -- Espera su OT desde la aprobación; si ya tuvo una y se anuló, desde entonces.
    select u.cot, u.unidad, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración',
           greatest(u.revisado_en, (select d.en from u_sin_ot_desde d where d.cot = u.cot and d.unidad = u.unidad)),
           'CODIGO_Y_OT', null
      from uni u
     where u.estado = 'APROBADA'
       and not exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad)
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
    union all
    select u.cot, u.unidad, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from uni u
     where u.estado in ('POR_REVISAR', 'RECHAZADA')
       and not exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad)
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
    union all
    -- Contabilidad la facturó: su primera factura, de la unidad o de toda la
    -- cotización. A quien lee las facturas le dice si cubre solo una parte de lo suyo.
    select f.cot, f.unidad, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from u_falta_resto r where r.cot = f.cot and r.unidad = f.unidad) then 'EN_PARTE' end
      from (select distinct on (x.cot, x.unidad) x.cot, x.unidad, x.registrado_por, x.creado_en
              from u_facturas x order by x.cot, x.unidad, x.creado_en) f
      join uni u on u.cot = f.cot and u.unidad = f.unidad
    union all
    -- Espera su factura desde que su OT tiene código interno, sin esperar a las
    -- demás unidades (DKS, 2026-11-26).
    select u.cot, u.unidad, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA', null
      from uni u join u_ot o on o.cot = u.cot and o.unidad = u.unidad
     where u.estado = 'APROBADA' and not o.sin_codigo
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
    union all
    select u.cot, u.unidad, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from uni u
     where u.estado <> 'ANULADA'
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
       and not (u.estado = 'APROBADA' and exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad and not o.sin_codigo))
    union all
    -- Facturada en parte: espera la factura de lo que le falta a la unidad.
    select r.cot, r.unidad, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from u_falta_resto r
      join uni u on u.cot = r.cot and u.unidad = r.unidad
      join u_ot o on o.cot = r.cot and o.unidad = r.unidad
     where v_cobros and u.estado = 'APROBADA' and not o.sin_codigo
    union all
    -- Facturada en parte y todavía sin su OT (la factura por toda la cotización
    -- llegó antes): lo que le falta facturar no se pierde de vista, queda pendiente.
    select r.cot, r.unidad, 100015, 'FACTURA_RESTO', 'PENDIENTE', null, null, null, null, null
      from u_falta_resto r
      join uni u on u.cot = r.cot and u.unidad = r.unidad
     where v_cobros
       and not (u.estado = 'APROBADA' and exists (select 1 from u_ot o where o.cot = r.cot and o.unidad = r.unidad and not o.sin_codigo))
    union all
    -- Tesorería la cobró: las facturas de la unidad quedaron cobradas y no le
    -- falta facturar nada.
    select b.cot, b.unidad, 100018, 'COBRO', 'HECHO', b.registrado_por, null, b.creado_en, null, null
      from u_ultimo_cobro b join uni u on u.cot = b.cot and u.unidad = b.unidad
     where v_cobros and not exists (select 1 from u_facturas x where x.cot = b.cot and x.unidad = b.unidad and not x.cobrada)
       and not exists (select 1 from u_falta_resto r where r.cot = b.cot and r.unidad = b.unidad)
    union all
    select r.cot, r.unidad, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from u_falta_resto r
     where v_cobros and not exists (select 1 from u_facturas x where x.cot = r.cot and x.unidad = r.unidad and not x.cobrada)
    union all
    -- Alguna factura de la unidad espera su cobro: desde la más vieja de las que faltan.
    select x.cot, x.unidad, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from u_facturas x join uni u on u.cot = x.cot and u.unidad = x.unidad
     where v_cobros and not x.cobrada
     group by x.cot, x.unidad
    union all
    select u.cot, u.unidad, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from uni u
     where v_cobros and u.estado <> 'ANULADA'
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
  ),
  -- Todo junto. `bloque` ordena la de varias unidades: primero lo de toda la
  -- cotización, después cada unidad con lo suyo y al final la anulación. En la
  -- de una unidad todo va en el mismo bloque, como siempre.
  pasos as (
    select p.cot, null::integer as unidad, null::integer as unidades,
           case when c.por_unidad and p.paso = 'ANULACION' then 2 else 0 end as bloque,
           p.canon, p.paso, p.situacion, p.quien, p.puesto_fijo, p.en, p.espera, p.detalle
      from pasos_de_toda p
      join cot c on c.id = p.cot
     where not (c.por_unidad and p.paso in ('CODIGO_Y_OT', 'OTRO_COMPRADOR', 'FACTURA', 'FACTURA_RESTO', 'COBRO'))
    union all
    select p.cot, p.unidad, u.unidades::integer, 1, p.canon, p.paso, p.situacion, p.quien, p.puesto_fijo, p.en, p.espera, p.detalle
      from pasos_de_unidad p
      join uni u on u.cot = p.cot and u.unidad = p.unidad
  )
  -- Los días de cada paso hecho: cuántas fechas de Lima pasaron desde el paso
  -- hecho anterior (la subida no tiene anterior). Así el vendedor ve cuánto
  -- tardó Gerencia en responder y cuánto tardó la OT, sin hacer la cuenta. En
  -- cada unidad, desde su paso anterior; el primero, desde la aprobación o desde
  -- la anulación de la OT que tenía antes. La
  -- anulación de la que va por unidad, desde lo último que se hizo en cualquiera.
  select x.cot, x.n, x.paso, x.situacion, x.puesto, x.en,
         case when x.situacion = 'AHORA' then public.dias_en_espera(x.en)
              when x.situacion = 'HECHO' and x.en is not null and x.previo is not null
              then greatest((x.en at time zone 'America/Lima')::date - (x.previo at time zone 'America/Lima')::date, 0)
         end,
         x.espera, x.detalle, x.unidad, x.unidades
    from (
      select p.cot,
             (row_number() over (
                partition by p.cot
                order by p.bloque, coalesce(p.unidad, 0),
                         case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                         case when p.situacion = 'HECHO' then p.en end, p.canon))::integer as n,
             p.paso, p.situacion,
             case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end as puesto,
             p.en,
             -- El paso hecho justo antes, en el mismo orden en que se muestran.
             case when p.bloque = 2
                  then (select max(q.en) from pasos q
                         where q.cot = p.cot and q.bloque < 2 and q.situacion = 'HECHO' and q.en <= p.en)
                  else coalesce(lag(p.en) over (partition by p.cot, p.unidad, p.situacion = 'HECHO' order by p.en, p.canon),
                                -- El primero de la unidad, desde la aprobación; si antes perdió una
                                -- OT, desde esa anulación (la OT que se volvió a cargar).
                                case when p.unidad is not null then
                                  greatest((select c.revisado_en from cot c where c.id = p.cot),
                                           (select max(a.en) from u_anulaciones a
                                             where a.cot = p.cot and a.unidad = p.unidad and a.en <= p.en))
                                end)
             end as previo,
             p.espera, p.detalle, p.unidad, p.unidades
        from pasos p
        left join public.usuarios u on u.id = p.quien
       -- La anulada no espera a nadie: queda lo hecho, como evidencia.
       where p.situacion = 'HECHO'
          or (select c.estado from cot c where c.id = p.cot) <> 'ANULADA'
    ) x;
end;
$$;

comment on function public.recorrido_de_cotizaciones(uuid[]) is
  'El recorrido de cada cotización que quien llama ya puede ver: lo hecho con el puesto de quien lo hizo y su hora, quién la tiene ahora y hace cuántos días, y lo que falta. La de varias unidades da, además, la OT, la factura y el cobro de cada unidad (unidad, unidades); en la de una, esas dos columnas van vacías. Migraciones 20261125130000 y 20261126998900.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;

-- 3. La factura de la unidad que pasó a otro comprador dice por qué no ----------
create or replace function public.registrar_factura_venta_de_unidad(
  p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date, p_moneda text,
  p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text, p_unidad integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_cot      public.cotizaciones_pdf%rowtype;
  v_unidades integer;
  v_unidad   integer := p_unidad;
  v_codigo   text;
  v_codigos  text[];
  v_con_ot   integer;
  v_numero   text := public.normalizar_numero_factura(p_numero);
  v_obj      storage.objects%rowtype;
  v_cli      text;
  v_otra     text;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la factura.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.facturas_venta where id = p_id) then
    if exists (select 1 from public.facturas_venta
               where id = p_id and ruta_storage = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta factura ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.' using errcode = 'check_violation';
  end if;
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion for share;
  if not found then raise exception 'Esa cotización no existe.' using errcode = 'check_violation'; end if;
  if v_cot.estado::text = 'ANULADA' or not public.cotizacion_fue_aprobada(p_cotizacion) then
    raise exception 'La cotización % no está aprobada por Gerencia: no se factura.', v_cot.numero using errcode = 'check_violation';
  end if;

  -- De qué unidad es. Con una sola unidad no hay nada que elegir.
  v_unidades := v_cot.cantidad_unidades;
  if v_unidades = 1 and coalesce(v_unidad, 0) = 0 then v_unidad := 1; end if;
  if v_unidad is null then
    raise exception 'La cotización % es de % unidades: elige de cuál es la factura, o toda la cotización.', v_cot.numero, v_unidades
      using errcode = 'check_violation';
  end if;
  if v_unidad < 0 or v_unidad > v_unidades then
    raise exception 'La cotización % tiene %: la unidad % no existe.', v_cot.numero,
      case when v_unidades = 1 then 'una sola unidad' else v_unidades || ' unidades' end, v_unidad
      using errcode = 'check_violation';
  end if;
  -- El código de cada unidad: el de su OT vigente.
  select array_agg(x.codigo order by k.unidad), count(x.codigo)::integer
    into v_codigos, v_con_ot
    from generate_series(1, v_unidades) as k(unidad)
    left join lateral (
      select public.normalizar_codigo_interno(u.codigo_interno) as codigo
        from public.ordenes_trabajo o
        join public.unidades u on u.id = o.unidad_id
       where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
         and coalesce(o.numero_de_unidad, 1) = k.unidad
         and public.normalizar_codigo_interno(u.codigo_interno) is not null
       order by o.creado_en desc
       limit 1) x on true;
  if v_unidad >= 1 then
    v_codigo := v_codigos[v_unidad];
    -- La unidad cuya OT pasó a otro comprador ya no se factura aquí: decía «todavía
    -- no tiene su OT … la carga Administración», y nadie la iba a cargar.
    if v_codigo is null and exists (
         select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
          where (e->>'unidad')::integer = v_unidad) then
      raise exception 'La unidad % de la cotización % pasó a otro comprador con su OT: ya no se factura en esta cotización.', v_unidad, v_cot.numero
        using errcode = 'check_violation';
    end if;
    if v_codigo is null and v_unidades = 1 then
      raise exception 'La cotización % todavía no tiene código interno: lo pone Administración al cargar la OT.', v_cot.numero
        using errcode = 'check_violation';
    end if;
    if v_codigo is null then
      raise exception 'La unidad % de la cotización % todavía no tiene su OT con código interno: la carga Administración.', v_unidad, v_cot.numero
        using errcode = 'check_violation';
    end if;
  else
    -- Toda la cotización: se reparte entre todas, así que todas tienen que tener su código.
    if v_con_ot < v_unidades and jsonb_array_length(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) > 0 then
      raise exception 'Una unidad de la cotización % pasó a otro comprador: factura cada unidad que sigue en la venta por separado.', v_cot.numero
        using errcode = 'check_violation';
    end if;
    if v_con_ot < v_unidades then
      raise exception 'La cotización % tiene % de sus % OT: la factura de toda la cotización se registra cuando estén todas. Mientras tanto se factura la unidad que ya tiene su OT.',
        v_cot.numero, v_con_ot, v_unidades using errcode = 'check_violation';
    end if;
    v_codigo := v_codigos[1];
  end if;

  if v_numero is null then
    raise exception 'Escribe el número de la factura como sale en SUNAT: la serie, un guion y el número (E001-626).' using errcode = 'check_violation';
  end if;
  select case when (select count(*) from public.facturas_venta_unidades x where x.factura_id = fv.id) > 1
              then 'la cotización ' || fv.cotizacion_numero || ', por todas sus unidades'
              else 'el código ' || coalesce(
                     public.codigo_de_la_unidad_de_cotizacion(fv.cotizacion_pdf_id,
                       (select x.numero_de_unidad::integer from public.facturas_venta_unidades x where x.factura_id = fv.id limit 1)),
                     fv.codigo_interno) end
    into v_otra from public.facturas_venta fv where fv.numero = v_numero and fv.anulada_en is null;
  if found then
    raise exception 'La factura % ya está registrada en %.', v_numero, v_otra using errcode = 'unique_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 730 then
    raise exception 'Elige la fecha de emisión de la factura: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_fecha_vencimiento is null or p_fecha_vencimiento < p_fecha_emision or p_fecha_vencimiento > p_fecha_emision + 730 then
    raise exception 'El vencimiento va desde la fecha de emisión hasta dos años después.' using errcode = 'check_violation';
  end if;
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la factura: soles o dólares.' using errcode = 'check_violation';
  end if;
  if p_total is null or p_total <= 0 or p_total > 999999999 or p_total <> round(p_total, 2) then
    raise exception 'Escribe el total de la factura, con IGV, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_unidad = 0 and p_total < v_unidades * 0.01 then
    raise exception 'El total no alcanza para repartirlo entre las % unidades de la cotización.', v_unidades using errcode = 'check_violation';
  end if;
  if v_concepto is not null and char_length(v_concepto) not between 2 and 200 then
    raise exception 'El concepto va de 2 a 200 caracteres (por ejemplo, «Inicial 50 %%»).' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('facturas-venta', p_ruta, p_id, array['application/pdf']);

  select razon_social into v_cli from public.clientes where id = v_cot.cliente_id;
  -- Esta factura trae dicho su reparto: el disparador no le pone la parte por omisión.
  perform set_config('metalwork.factura_con_su_reparto', p_id::text, true);
  insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero,
                                     fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage,
                                     nombre_archivo, tamano_bytes, registrado_por)
  values (p_id, v_codigo, p_cotizacion, v_cot.numero, v_cot.cliente_id, coalesce(v_cli, 'Cliente sin registrar'), v_numero,
          p_fecha_emision, p_fecha_vencimiento, p_moneda, p_total, v_concepto, p_ruta,
          left(coalesce(nullif(btrim(p_nombre_archivo), ''), v_numero || '.pdf'), 200),
          (v_obj.metadata->>'size')::integer, v_yo);

  -- El reparto se anota aquí y no se recalcula después.
  if v_unidad >= 1 then
    insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
    values (p_id, v_unidad, v_unidades, v_codigo, p_total);
  else
    insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
    select p_id, k, v_unidades, v_codigos[k], public.parte_de_unidad(p_total, v_unidades, k)
      from generate_series(1, v_unidades) k;
  end if;

  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura por cobrar: ' || v_numero,
    coalesce(v_cli, 'Cliente sin registrar') || ' · '
      || case when v_unidad = 0 then 'toda la cotización ' || v_cot.numero || ', ' || v_unidades || ' unidades'
              when v_unidades > 1 then 'código ' || v_codigo || ', unidad ' || v_unidad || ' de ' || v_unidades
              else 'código ' || v_codigo end
      || ' · ' || case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_total, 'FM999G999G990D00'),
    '/tesoreria/por-cobrar#' || p_id, 'facturas_venta', p_id, v_yo);
  return p_id;
end;
$$;

comment on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) is
  'Contabilidad registra la factura de venta de una unidad de la cotización (p_unidad = 1, 2, 3…) o de toda la cotización (p_unidad = 0), que se reparte en partes iguales entre sus unidades. Pide contabilidad.facturar. Migración 20261126998000.';

revoke all on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) from public, anon;
grant execute on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) to authenticated;

-- 4. La cotización no se anula con OT o facturas vigentes, y las nombra todas ----
create or replace function public.fn_cotizacion_pdf_anular()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_orden text; v_factura text;
begin
  if old.estado = 'ANULADA' then
    raise exception 'La cotización % está anulada y se conserva como evidencia; crea una nueva.', old.numero;
  end if;

  if new.estado = 'ANULADA' then
    -- Anular es de Gerencia, salvo la venta que se reabrió: esa la cancela
    -- quien la registró (20261126988000).
    if not public.puede_cancelar_la_venta(old.id) then
      perform public.exigir_permiso('cotizaciones.revisar');
    elsif not (public.es_admin() or public.tiene_permiso('cotizaciones.revisar'))
          and length(btrim(coalesce(new.observacion, ''))) < 10 then
      -- La misma regla que `cancelar_venta_reabierta`, también por UPDATE directo.
      raise exception 'Cuenta por qué se cancela la venta, en al menos 10 caracteres.' using errcode = 'check_violation';
    end if;
    if nullif(btrim(new.observacion), '') is null then
      raise exception 'Indica el motivo de anulación de la cotización %.', old.numero;
    end if;
    -- Todas sus OT activas, no solo una: con varias unidades decía una y, anulada
    -- esa, volvía a frenar con la siguiente.
    select string_agg(o.numero, ', ' order by coalesce(o.numero_de_unidad, 1)), count(*)::text
      into v_orden, v_factura
      from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA';
    if v_orden is not null then
      if v_factura = '1' then
        raise exception 'La cotización % tiene la OT % activa; anula primero esa OT.', old.numero, v_orden;
      end if;
      raise exception 'La cotización % tiene las OT % activas; anula primero esas OT.', old.numero, v_orden;
    end if;
    -- Ni con una factura vigente: la venta facturada no se anula por debajo de
    -- Contabilidad (la pantalla no lo ofrecía, pero la API sí dejaba).
    select string_agg(f.numero, ', ' order by f.creado_en) into v_factura
      from public.facturas_venta f
     where f.cotizacion_pdf_id = old.id and f.anulada_en is null;
    if v_factura is not null then
      raise exception 'La cotización % tiene facturas vigentes (%): Contabilidad las anula primero.', old.numero, v_factura
        using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.observacion);
    new.anulado_por := public.usuario_actual();
    new.anulado_en := now();
    -- La aprobación o el rechazo anteriores siguen atribuidos a quien los hizo.
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  else
    new.motivo_anulacion := old.motivo_anulacion;
    new.anulado_por := old.anulado_por;
    new.anulado_en := old.anulado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cotizacion_pdf_anular() from public, anon, authenticated;

-- 5. El precio de cada unidad en el costeo ---------------------------------------
-- Dos menores del PR #245: el reparto redondeaba cada parte (100 entre 3 daba
-- 33.33 tres veces y se perdía un céntimo), y mientras una corrección esperaba a
-- Gerencia el costeo ya dividía por la cantidad nueva. Ahora cada unidad recibe
-- su `parte_de_unidad` (las partes suman el total, como las facturas, 20261126998000)
-- de la cantidad que Gerencia aprobó por última vez.
create or replace function public.unidades_aprobadas(p_cotizacion uuid)
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $$
  select greatest(1, case
    when c.estado = 'APROBADA' then coalesce(c.cantidad_unidades, 1)
    else coalesce((select coalesce((b.datos_despues ->> 'cantidad_unidades')::integer, 1)
                     from public.audit_log b
                    where b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id
                      and b.datos_despues ->> 'estado' = 'APROBADA'
                    order by b.id desc
                    limit 1),
                  coalesce(c.cantidad_unidades, 1))
  end)
    from public.cotizaciones_pdf c
   where c.id = p_cotizacion;
$$;

comment on function public.unidades_aprobadas(uuid) is
  'Cuántas unidades tenía la cotización la última vez que Gerencia la aprobó (la de hoy si está aprobada). Ayudante interno del costeo (20261127010000).';

revoke all on function public.unidades_aprobadas(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.margen_ot(p_orden uuid)
 RETURNS TABLE(moneda_venta text, precio_venta numeric, incluye_igv boolean, precio_neto numeric, cambio_venta numeric, precio_neto_pen numeric, costo_pen numeric, margen_pen numeric, margen_pct numeric, despachos_sin_precio integer, lineas_sin_cambio integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- La tasa del IGV en el Perú desde 2011.
  c_igv constant numeric := 0.18;
  v_moneda text;
  v_precio numeric;
  v_igv boolean;
  v_fecha date;
  v_neto numeric;
  v_cambio numeric;
  v_neto_pen numeric;
  v_costo numeric;
  v_cerrado numeric;
  v_sin_precio integer;
  v_sin_cambio integer;
begin
  perform public.exigir_permiso('costos.ver');
  if not (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')) then
    raise exception 'El margen se calcula con el precio de venta, que tu puesto no ve.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;

  -- El precio de esta unidad: el total de la cotización entre sus unidades.
  select c.moneda::text, public.parte_de_unidad(c.monto_venta, public.unidades_aprobadas(c.id), coalesce(o.numero_de_unidad, 1)),
         case when i.version = c.version then i.incluye_igv end,
         o.fecha_registro::date
    into v_moneda, v_precio, v_igv, v_fecha
    from public.ordenes_trabajo o
    left join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id and c.estado <> 'ANULADA'
    left join public.cotizaciones_pdf_igv i on i.cotizacion_id = c.id
   where o.id = p_orden;

  select coalesce(sum(s.monto_pen), 0),
         count(*) filter (where s.fuente = 'MATERIALES_SIN_PRECIO'),
         count(*) filter (where s.moneda = 'USD' and s.monto_pen is null)
    into v_costo, v_sin_precio, v_sin_cambio
    from public.costeo_ot_en_soles(p_orden) s;

  -- Con el costo cerrado, el margen es el de ese costo.
  select c.costo_pen into v_cerrado from public.ot_cierres_costo c where c.orden_id = p_orden;
  if found then
    v_costo := v_cerrado;
    v_sin_precio := 0;
    v_sin_cambio := 0;
  end if;

  v_neto := case when v_igv then round(v_precio / (1 + c_igv), 2)
                 when v_igv = false then v_precio end;
  -- Un precio en dólares se pasa con el cambio de COMPRA del día en que se
  -- registró la OT: es cuando la venta quedó comprometida.
  v_cambio := case when v_moneda = 'USD' then public.cambio_del_dia(v_fecha, 'COMPRA') end;
  v_neto_pen := case when v_moneda = 'PEN' then v_neto
                     when v_moneda = 'USD' then round(v_neto * v_cambio, 2) end;

  return query select
    v_moneda, v_precio, v_igv, v_neto, v_cambio, v_neto_pen, v_costo,
    case when v_neto_pen is not null then v_neto_pen - v_costo end,
    case when v_neto_pen > 0 then round((v_neto_pen - v_costo) / v_neto_pen * 100, 1) end,
    v_sin_precio, v_sin_cambio;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigos_internos_costo_calculado(p_codigo text)
 RETURNS TABLE(codigo text, mano_obra numeric, recargo_extras numeric, gastos_mes_pen numeric, gastos_mes_usd numeric, caja_pen numeric, caja_usd numeric, egresos_caja integer, gastos_ot_pen numeric, gastos_ot_usd numeric, merma_pen numeric, merma_usd numeric, costo_pen numeric, usd_sin_cambio numeric, lineas_sin_cambio integer, usd_al_cambio numeric, usd_en_soles numeric, materiales_sin_precio integer, horas_sin_costo numeric, cotizaciones integer, moneda_venta text, precio_venta_pen numeric, precio_venta_usd numeric, venta_sin_igv_confirmado integer, venta_sin_cambio integer, precio_neto_pen numeric, margen_pen numeric, margen_pct numeric, presupuesto_pen numeric, presupuesto_fijado boolean, consumido_pct numeric, semaforo text, entregada_el date, cierre_id uuid, cerrado_en timestamp with time zone, cerrado_por text, costo_cerrado_pen numeric, margen_cerrado_pen numeric, margen_cerrado_pct numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  -- La tasa del IGV en el Perú desde 2011, y la utilidad estándar de la hoja RESUMEN.
  c_igv constant numeric := 0.18;
  c_utilidad constant numeric := 0.15;
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with linea as (
    select k.*,
           k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA') as suma,
           -- Lo que la línea en dólares pesa en soles; vacío si todavía no se puede pasar. La orden de
           -- servicio pesa el monto en soles que guarda; lo demás, el cambio del día de su fecha
           -- (20261126998800).
           case when k.moneda = 'USD' then public.soles_de_la_linea_del_costeo(k.fuente, k.referencia_id, k.fecha, k.monto) end as en_soles
      from public.codigo_interno_lineas(v_codigo, true) k
     where k.codigo is not null
  ), costo as (
    select l.codigo,
           coalesce(sum(l.monto) filter (where l.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(l.monto) filter (where l.fuente = 'RECARGO_EXTRAS'), 0)::numeric as recargo,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'PEN'), 0)::numeric as gastos_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'USD'), 0)::numeric as gastos_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'PEN'), 0)::numeric as caja_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'USD'), 0)::numeric as caja_usd,
           count(*) filter (where l.fuente = 'CAJA')::integer as egresos_caja,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'PEN'), 0)::numeric as gastos_ot_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'USD'), 0)::numeric as gastos_ot_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'PEN'), 0)::numeric as merma_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'USD'), 0)::numeric as merma_usd,
           coalesce(sum(case when l.moneda = 'PEN' then l.monto else l.en_soles end)
                      filter (where l.suma and (l.moneda = 'PEN' or l.en_soles is not null)), 0)::numeric as costo_pen,
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.en_soles is null), 0)::numeric as usd_sin_cambio,
           count(*) filter (where l.suma and l.moneda = 'USD' and l.en_soles is null)::integer as sin_cambio,
           -- Los dólares que sí pasan a soles, y en cuánto: con eso las partes cuadran con el total.
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.en_soles is not null), 0)::numeric as usd_al_cambio,
           coalesce(sum(l.en_soles) filter (where l.suma and l.moneda = 'USD' and l.en_soles is not null), 0)::numeric as usd_en_soles,
           count(*) filter (where l.fuente = 'MATERIALES_SIN_PRECIO')::integer as sin_precio,
           coalesce(sum(l.horas) filter (where l.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo
      from linea l
     group by l.codigo
  ), cotizacion as (
    -- La cotización aprobada (o aprobada antes de una corrección) de las OT del
    -- código: a cada código vigente de la cotización, su parte del total.
    select x.codigo, c.moneda::text as moneda,
           public.parte_de_unidad(c.monto_venta::numeric, public.unidades_aprobadas(c.id), x.unidad) as monto,
           ig.incluye_igv, (coalesce(c.revisado_en, c.creado_en) at time zone 'America/Lima')::date as fecha
      from public.cotizaciones_pdf c
      -- El IGV confirmado para esta versión: una corrección sin confirmar no tiene precio.
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id and ig.version = c.version
      cross join lateral (
        select distinct on (e ->> 'codigo_interno') e ->> 'codigo_interno' as codigo, (e ->> 'unidad')::integer as unidad
          from jsonb_array_elements(public.ordenes_de_cotizacion(c.id)) e
         where e ->> 'codigo_interno' is not null
         order by e ->> 'codigo_interno', (e ->> 'unidad')::integer
      ) x
     where c.estado::text <> 'ANULADA' and c.monto_venta is not null and public.cotizacion_fue_aprobada(c.id)
  ), venta_linea as (
    select v.*,
           case when v.incluye_igv then round(v.monto / (1 + c_igv), 2) when v.incluye_igv = false then v.monto end as neto,
           case when v.moneda = 'USD' then public.cambio_del_dia(v.fecha, 'COMPRA') end as cambio
      from cotizacion v
     where v.codigo is not null and (v_codigo is null or v.codigo = v_codigo)
  ), venta as (
    select v.codigo, count(*)::integer as cotizaciones,
           string_agg(distinct v.moneda, '+' order by v.moneda) as moneda,
           coalesce(sum(v.monto) filter (where v.moneda = 'PEN'), 0)::numeric as pen,
           coalesce(sum(v.monto) filter (where v.moneda = 'USD'), 0)::numeric as usd,
           count(*) filter (where v.incluye_igv is null)::integer as sin_igv,
           count(*) filter (where v.moneda = 'USD' and v.cambio is null)::integer as sin_cambio,
           -- Si falta saber el IGV o el cambio de alguna, el precio no se adivina.
           case when bool_and(v.neto is not null and (v.moneda = 'PEN' or v.cambio is not null))
                then sum(case when v.moneda = 'PEN' then v.neto else round(v.neto * v.cambio, 2) end) end as neto_pen
      from venta_linea v
     group by v.codigo
  ), fijado as (
    -- El presupuesto que Gerencia o Administración fijó a mano en la OT de la
    -- unidad manda sobre el de la hoja; con varias OT (una garantía), la suma.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, sum(p.monto_pen)::numeric as monto
      from public.ot_presupuestos p
      join public.ordenes_trabajo o on o.id = p.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p.monto_pen is not null and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), entrega as (
    -- El acta de entrega más reciente de las OT del código (la registra el taller).
    -- La garantía y el mantenimiento de la unidad van por el número de su propia
    -- OT (20261120500000): su acta es la de ese trabajo, no la de la unidad.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, max(e.fecha_entrega) as fecha
      from public.ot_entregas e
      join public.ordenes_trabajo o on o.id = e.orden_id
      join public.unidades u on u.id = o.unidad_id
     where o.estado::text <> 'ANULADA' and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and o.tipo_trabajo not in ('GARANTIA', 'MANTENIMIENTO')
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), cierre as (
    select z.* from public.codigo_interno_cierres z
     where z.reabierto_en is null and (v_codigo is null or z.codigo = v_codigo)
  ), codigos as (
    select k.codigo from costo k union select v.codigo from venta v union select z.codigo from cierre z
  )
  select c.codigo,
         coalesce(k.mano_obra, 0), coalesce(k.recargo, 0),
         coalesce(k.gastos_pen, 0), coalesce(k.gastos_usd, 0),
         coalesce(k.caja_pen, 0), coalesce(k.caja_usd, 0), coalesce(k.egresos_caja, 0),
         coalesce(k.gastos_ot_pen, 0), coalesce(k.gastos_ot_usd, 0), coalesce(k.merma_pen, 0), coalesce(k.merma_usd, 0),
         coalesce(k.costo_pen, 0), coalesce(k.usd_sin_cambio, 0), coalesce(k.sin_cambio, 0),
         coalesce(k.usd_al_cambio, 0), coalesce(k.usd_en_soles, 0),
         coalesce(k.sin_precio, 0), coalesce(k.horas_sin_costo, 0),
         coalesce(v.cotizaciones, 0), v.moneda, v.pen, v.usd,
         coalesce(v.sin_igv, 0), coalesce(v.sin_cambio, 0), v.neto_pen,
         -- Sin costo todavía el margen saldría 100 %: no hay margen hasta que algo cueste.
         case when v.neto_pen is not null and k.costo_pen > 0 then v.neto_pen - k.costo_pen end,
         case when v.neto_pen > 0 and k.costo_pen > 0 then round((v.neto_pen - k.costo_pen) / v.neto_pen * 100, 1) end,
         p.presupuesto, f.monto is not null,
         case when p.presupuesto > 0 then round(coalesce(k.costo_pen, 0) / p.presupuesto * 100, 1) end,
         -- Pasado el presupuesto, excedido; del 90 % en adelante, ajustado.
         case when p.presupuesto is null then null
              when coalesce(k.costo_pen, 0) > p.presupuesto then 'EXCEDIDO'
              when coalesce(k.costo_pen, 0) >= p.presupuesto * 0.9 then 'AJUSTADO'
              else 'EN_RANGO' end,
         en.fecha,
         z.id, z.cerrado_en, public.puesto_de(z.cerrado_por), z.costo_pen, z.margen_pen, z.margen_pct
    from codigos c
    left join costo k on k.codigo = c.codigo
    left join venta v on v.codigo = c.codigo
    left join cierre z on z.codigo = c.codigo
    left join fijado f on f.codigo = c.codigo
    left join entrega en on en.codigo = c.codigo
    cross join lateral (select coalesce(f.monto, round(v.neto_pen / (1 + c_utilidad), 2)) as presupuesto) p
   where c.codigo is not null
   order by 1;
end;
$function$;

-- 6. Los códigos de la cotización, solo a quien la puede ver ----------------------
-- Menor del PR #245: `ordenes_de_cotizacion` daba los códigos internos a quien
-- tuviera el id de la cotización. Ahora, a quien lee las órdenes, a quien ve el
-- costeo y a quien ve esa cotización (la misma regla que su política de lectura).
create or replace function public.ordenes_de_cotizacion(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', case when v.ve then o.id end,
           'numero', case when v.ve then o.numero end,
           'estado', case when v.ve then o.estado::text end,
           'codigo_interno', case when v.ve_codigo then public.normalizar_codigo_interno(u.codigo_interno) end,
           'unidad', coalesce(o.numero_de_unidad, 1))
         order by coalesce(o.numero_de_unidad, 1), o.creado_en), '[]'::jsonb)
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
    cross join (
      select public.es_admin() or public.tiene_permiso('ordenes.ver') as ve,
             public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('costos.ver')
             or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
             or (public.tiene_permiso('tesoreria.ver_documentos')
                 and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = p_cotizacion))
             or (public.tiene_permiso('cotizaciones.ver_aprobadas') and public.cotizacion_fue_aprobada(p_cotizacion)) as ve_codigo
    ) v
   where o.cotizacion_pdf_id = p_cotizacion
     and o.estado <> 'ANULADA';
$$;

comment on function public.ordenes_de_cotizacion(uuid) is
  'Las OT vigentes de la cotización, por su número de unidad; el id, el número y el estado solo para quien ve las órdenes, y el código interno para quien ve las órdenes, el costeo o esa cotización (migraciones 20261126760000 y 20261127010000).';

notify pgrst, 'reload schema';
