-- =============================================================================
-- LA COTIZACIÓN SE APRUEBA CON SU CÓDIGO INTERNO Y SU OT
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-15: «las cotizaciones se pueden subir y
-- necesitan aprobación de Gerencia para su elaboración a OT; después que se
-- aprueba la cotización se debe dar qué código interno tendrá y a la par cargar
-- la orden de trabajo».
--
-- Hasta aquí el camino era de tres manos: Ventas sube la cotización, Gerencia
-- la aprueba y, más tarde, Administración emitía la OT, con el código interno
-- como dato opcional (bastaban la marca y el modelo). Así una cotización podía
-- quedar aprobada días sin código, y sin código Contabilidad no la factura ni
-- Diseño sabe con qué trabajar: el código interno es la referencia de todo
-- desde que se aprueba la cotización (decisión del 15/10).
--
-- Desde aquí:
--
--   Ventas sube la cotización → Gerencia la aprueba en UNA sola ventana: dice
--   qué código interno tendrá la unidad (nuevo, o uno que ya existe del mismo
--   cliente) y sube el PDF de la OT. La base hace las tres cosas juntas o
--   ninguna: crea o reusa la unidad con ese código, crea la OT con su PDF y deja
--   la cotización aprobada. Desde ese momento Diseño ve la OT dentro del código,
--   Contabilidad ya la puede facturar y Gerencia la sigue en Códigos internos.
--
-- Reglas:
--   · Una cotización sin OT no se aprueba sin su código y su OT. La que ya tiene
--     OT (una corrección de Ventas que vuelve a Gerencia) se aprueba como antes.
--   · Una aprobada de antes que quedó sin OT recibe su código y su OT en la misma
--     ventana, por Gerencia.
--   · Administración ya no emite la OT de la cotización: `emitir_orden_de_cotizacion`
--     deja de estar disponible para las cuentas.
--   · El número de la OT es el de su papel; desde la 10000 ya no se corta (la
--     emisión anterior lo rellenaba a cuatro cifras y cortaba el quinto dígito).
--
-- Va en dos migraciones para que el cambio no deje nada a medias en producción:
-- esta trae lo que se suma (la aprobación con código y OT, el código en la lista
-- y la OT dentro del código) y no cambia nada de lo que ya funciona; la
-- `20261016901000` cierra el camino de antes (aprobar sin OT y la emisión de
-- Administración) y se aplica cuando la pantalla nueva ya está desplegada.
--
-- Lo que ya existe —cotizaciones, OT y códigos— queda como está: nada se borra.
-- =============================================================================

-- 1. Aprobar con código interno y OT --------------------------------------------
create or replace function public.aprobar_cotizacion_con_ot(
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
  p_modelo         text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot     record;
  v_codigo  constant text := public.normalizar_codigo_interno(p_codigo_interno);
  v_clave   constant text := upper(regexp_replace(coalesce(p_codigo_interno, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo   constant text := btrim(coalesce(p_numero_ot, ''));
  v_cifras  text;
  v_anio    text;
  v_numero  text;
  v_otra    text;
  v_unidad  uuid;
  v_ajena   text;
  v_sede    uuid;
  v_tipo    constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
  v_enlace  text;
begin
  perform public.exigir_permiso('cotizaciones.revisar');

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
  if v_cot.estado = 'RECHAZADA' then
    raise exception 'La cotización % está rechazada: Ventas sube la corrección y vuelve a Gerencia.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado not in ('POR_REVISAR', 'APROBADA') then
    raise exception 'La cotización % está anulada: no se aprueba.', v_cot.numero using errcode = 'check_violation';
  end if;

  select o.numero into v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
   limit 1;
  if v_otra is not null then
    raise exception 'La cotización % ya tiene su OT %: apruébala sin cargar otra.', v_cot.numero, v_otra
      using errcode = 'unique_violation';
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
  if p_fecha_entrega is null then
    raise exception 'Falta la fecha de entrega que se le prometió al cliente.' using errcode = 'check_violation';
  end if;
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

  -- La OT nace aprobada, con su PDF: Gerencia es quien la aprueba.
  v_sede := coalesce(public.mi_sede(), (select id from public.sedes where activo order by nombre limit 1));
  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo,
                                      prioridad, descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad)
  values (p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION',
          'NORMAL', format('%s · %s · cotización %s', v_cot.carroceria, v_tipo, v_cot.numero), p_fecha_entrega,
          'APROBADA', p_cotizacion, p_tipo_unidad);
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_cifras::bigint)
   where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = v_sede) and correlativo_actual < v_cifras::bigint;
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf, 'application/pdf',
          p_tamano_pdf, public.usuario_actual());

  -- Y la cotización queda aprobada (la de antes ya lo estaba). El disparador
  -- anota quién y cuándo, y le avisa a Ventas con el código.
  if v_cot.estado = 'POR_REVISAR' then
    update public.cotizaciones_pdf set estado = 'APROBADA' where id = p_cotizacion;
  end if;

  v_enlace := '/diseno/codigo?codigo='
    || replace(replace(replace(replace(replace(replace(v_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  perform public.notificar_a_permiso(
    'diseno.codigos',
    'Código nuevo con su OT',
    format('%s: OT %s, %s (%s) de %s. Entrega prometida: %s. Carga sus planos, materiales y etapas.',
           v_codigo, v_numero, v_cot.carroceria, lower(v_tipo), coalesce(v_cot.cliente, 'un cliente'),
           to_char(p_fecha_entrega, 'DD/MM/YYYY')),
    v_enlace, 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Código nuevo en el taller',
    format('%s: %s, %s. Diseño cargará sus planos y etapas.', v_codigo, v_cot.carroceria, lower(v_tipo)),
    '/planos', 'ordenes_trabajo', p_orden, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.aprobar_cotizacion_con_ot(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text) is
  'Gerencia aprueba la cotización dando el código interno de la unidad y subiendo el PDF de la OT, todo junto o nada (migración 20261016900000).';

revoke all on function public.aprobar_cotizacion_con_ot(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.aprobar_cotizacion_con_ot(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  to authenticated;

-- 2. La lista de cotizaciones dice el código interno de cada una -----------------
create or replace view public.v_cotizaciones_pdf
with (security_invoker = on) as
select c.id,
       c.numero,
       c.estado::text as estado,
       c.observacion,
       c.cliente_id,
       cl.razon_social as cliente,
       c.tipo_carroceria_id,
       tc.nombre as carroceria,
       c.nombre_archivo,
       c.ruta_storage,
       c.tamano_bytes,
       c.creado_en,
       c.registrado_por,
       public.puesto_de(c.registrado_por) as registrado_por_nombre,
       c.revisado_en,
       public.puesto_de(c.revisado_por) as revisado_por_nombre,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       (exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id)) as tuvo_orden,
       c.version,
       c.mime_type,
       c.archivo_subido_en,
       c.monto_venta,
       c.moneda,
       public.codigo_interno_de_cotizacion(c.id) as codigo_interno
  from public.cotizaciones_pdf c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
  left join lateral (
    select ot.id, ot.numero, ot.estado
      from public.ordenes_trabajo ot
     where ot.cotizacion_pdf_id = c.id and ot.estado <> 'ANULADA'::public.estado_ot
     limit 1
  ) o on true;

grant select on public.v_cotizaciones_pdf to authenticated;

-- 3. La OT dentro del código, para Diseño ----------------------------------------
-- Las OT vigentes de un código interno con su PDF. Corre con los permisos de
-- quien mira: el PDF de la OT solo le llega a Diseño (`puede_ver_pdf_ot`), y el
-- número de cotización solo a quien ve cotizaciones.
create or replace function public.ordenes_de_codigo_interno(p_codigo text)
returns table (
  id               uuid,
  numero           text,
  estado           text,
  descripcion      text,
  fecha_entrega    date,
  cliente          text,
  cotizacion       text,
  pdf_ruta         text,
  pdf_nombre       text,
  creado_en        timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select o.id, o.numero, o.estado::text, o.descripcion, o.fecha_entrega_comprometida,
         cl.razon_social, c.numero, a.ruta_storage, a.nombre_archivo, o.creado_en
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
    left join public.clientes cl on cl.id = o.cliente_id
    left join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id
    left join lateral (
      select x.ruta_storage, x.nombre_archivo
        from public.ot_adjuntos x
       where x.orden_id = o.id and x.tipo = 'ORDEN'
       order by x.creado_en desc
       limit 1
    ) a on true
   -- La misma normalización que `normalizar_codigo_interno`, escrita aquí
   -- porque esa función no la ejecutan las cuentas.
   where upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '\s+', ' ', 'g'))
         = upper(regexp_replace(btrim(coalesce(p_codigo, '')), '\s+', ' ', 'g'))
     and btrim(coalesce(p_codigo, '')) <> ''
     and o.estado <> 'ANULADA'
   order by o.creado_en desc;
$$;

revoke all on function public.ordenes_de_codigo_interno(text) from public, anon;
grant execute on function public.ordenes_de_codigo_interno(text) to authenticated;
