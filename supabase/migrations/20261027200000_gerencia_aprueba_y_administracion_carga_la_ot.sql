-- =============================================================================
-- GERENCIA APRUEBA LA COTIZACIÓN; ADMINISTRACIÓN LE DA SU CÓDIGO Y SUBE LA OT
-- -----------------------------------------------------------------------------
-- Observación de Gerencia (2026-10-27, «Proceso de avance ERP – observaciones»):
-- «al aprobar, el jefe no puede poner el código, eso lo hace Administración»; y
-- la ventana le pedía además el número de la OT, su PDF, el tipo, el chasis y
-- una fecha que no entendía. Desde ahí no podían avanzar. DKS: «Gerencia al
-- aprobar una cotización le pide agregar la OT y demás, y no solo da en aprobar
-- y mandaría a Administración». Ya el 26/10 lo había dicho: Administración
-- SUBE LA OT.
--
-- Desde la 20261016900000 el camino era de una sola mano: Gerencia aprobaba en
-- una ventana con el código interno y la OT, todo junto. Desde aquí vuelven a
-- ser dos pasos, cada uno de quien lo hace:
--
--   Ventas sube la cotización → Gerencia la aprueba o la rechaza, con un toque
--   → a Administración le llega el aviso y le da el código interno a la unidad
--   y sube la OT (su PDF, su número, el tipo, el chasis y la fecha de entrega al
--   cliente). La base hace eso último junto o nada, como antes: crea o reusa la
--   unidad con ese código, crea la OT aprobada con su PDF y avisa a Diseño, al
--   taller y a Ventas. Desde ahí Diseño ve la OT dentro del código y
--   Contabilidad ya la puede facturar.
--
-- Administración lo hace con `ordenes.crear`, el permiso con que ya emitía la OT
-- de la cotización hasta el 15/10 (`emitir_orden_de_cotizacion`) y con el que
-- `mw_subir_adjuntos_ot` ya le deja subir el PDF a la carpeta de la OT.
--
-- Va en dos migraciones para que el cambio no deje a nadie a medias en
-- producción: esta suma lo nuevo (aprobar con un toque, la carga de
-- Administración y su aviso) y no quita nada que la pantalla de hoy use; la
-- `20261027201000` le cierra a Gerencia la carga de la OT y se aplica cuando la
-- pantalla nueva ya está desplegada.
--
-- Los cuerpos de `fn_cotizacion_pdf_revision` y `fn_cotizacion_pdf_avisa` que
-- se reescriben aquí se compararon con los de producción el 2026-10-27: eran
-- iguales a los de main.
--
-- Lo que ya existe —cotizaciones, OT y códigos— queda como está: nada se borra.
-- =============================================================================

-- 1. Gerencia aprueba con un toque ---------------------------------------------
-- La revisión de siempre, sin la regla que pedía la OT antes de aprobar. Lo demás
-- queda igual: solo quien revisa aprueba o rechaza, y solo una versión pendiente.
create or replace function public.fn_cotizacion_pdf_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_revisa constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
  v_autor boolean;
  v_cambia boolean;
  v_archivo_nuevo boolean;
  v_ignorar constant text[] := array['estado','observacion','revisado_por','revisado_en','actualizado_en'];
  v_campos_correccion constant text[] := array[
    'cliente_id','tipo_carroceria_id','nombre_archivo','ruta_storage','mime_type',
    'tamano_bytes','monto_venta','moneda','motivo_correccion','estado','observacion',
    'revisado_por','revisado_en','version','archivo_subido_en','actualizado_en'
  ];
begin
  if tg_op = 'INSERT' then
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    new.version := 1;
    new.archivo_subido_en := now();
    return new;
  end if;

  v_autor := public.es_admin() or old.registrado_por = public.usuario_actual();
  v_archivo_nuevo := new.ruta_storage is distinct from old.ruta_storage;
  new.numero := old.numero;
  new.registrado_por := old.registrado_por;
  new.version := old.version;
  new.archivo_subido_en := case when v_archivo_nuevo then now() else old.archivo_subido_en end;

  if v_archivo_nuevo then
    if not v_autor or not public.tiene_permiso('cotizaciones.crear') then
      raise exception 'Solo quien registró la cotización puede subir su corrección.' using errcode = 'insufficient_privilege';
    end if;
    if old.estado = 'ANULADA' then
      raise exception 'Una cotización anulada no se puede corregir.';
    end if;
    if length(btrim(coalesce(new.motivo_correccion,''))) < 5 then
      raise exception 'Indica por qué corriges la cotización.';
    end if;
    if (to_jsonb(new) - v_campos_correccion) is distinct from (to_jsonb(old) - v_campos_correccion) then
      raise exception 'La corrección solo admite datos comerciales y el archivo; no cambia la identidad de la cotización.';
    end if;
    new.version := old.version + 1;
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    return new;
  end if;

  if new.estado is distinct from old.estado or new.observacion is distinct from old.observacion then
    if not v_revisa then
      raise exception 'No tienes permiso para aprobar ni rechazar la cotización.' using errcode = 'insufficient_privilege';
    end if;
    if new.estado in ('APROBADA','RECHAZADA') and old.estado <> 'POR_REVISAR' then
      raise exception 'Gerencia solo revisa una versión pendiente; Ventas debe subir una corrección primero.';
    end if;
    if new.estado = 'POR_REVISAR' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  v_cambia := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);
  if v_cambia then
    raise exception 'Para corregir la cotización %, adjunta una nueva versión e indica el motivo.', old.numero;
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_revision() from public, anon, authenticated;

-- 2. Los avisos de la aprobación -------------------------------------------------
-- La aprobada que todavía no tiene OT le llega a quien la carga (`ordenes.crear`)
-- con el enlace a su fila. Ventas sabe que su cotización se aprobó y que el
-- código llega después; cuando llega, se lo avisa la carga misma (sección 3).
-- La corrección de una que ya tiene OT no avisa a nadie más: ya tiene su código.
create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cliente text;
  v_quien   text;
  v_codigo  text;
  v_con_ot  boolean;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := public.puesto_de(new.registrado_por);

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s', coalesce(v_quien, 'Ventas'), new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    return null;
  end if;

  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'POR_REVISAR' then
    if new.version > old.version then
      perform public.notificar_a_permiso(
        'cotizaciones.revisar',
        'Cotización corregida',
        format('%s subió la corrección de la %s de %s (versión %s). Lo que habías observado: %s',
               coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente'), new.version,
               coalesce(old.observacion, 'sin observación')),
        '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
    return null;
  end if;

  if new.estado = 'APROBADA' then
    v_codigo := public.codigo_interno_de_cotizacion(new.id);
    v_con_ot := exists (select 1 from public.ordenes_trabajo o
                         where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA');
    if not v_con_ot then
      perform public.notificar_a_permiso(
        'ordenes.crear',
        'Cotización aprobada: falta su código y su OT',
        format('Gerencia aprobó la %s de %s Dale su código interno y sube su OT.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || new.id, 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
  end if;

  perform public.notificar_a_usuario(
    new.registrado_por,
    case when new.estado = 'APROBADA' then 'Gerencia aprobó tu cotización' else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA' and v_codigo is not null
         then public.con_punto_final(format('La %s de %s, con el código interno %s', new.numero, coalesce(v_cliente, 'un cliente'), v_codigo))
         when new.estado = 'APROBADA'
         then format('La %s de %s Administración le da su código interno y sube su OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')))
         else format('La %s: %s Corrígela y sube la corrección.', new.numero, public.con_punto_final(coalesce(nullif(btrim(new.observacion), ''), 'Sin motivo'))) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());

  return null;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;

-- 3. Administración da el código interno y sube la OT ------------------------------
-- Lo mismo que hacía `aprobar_cotizacion_con_ot`, sin aprobar: la cotización ya
-- tiene que estar aprobada. Sirve también para las aprobadas de antes que
-- quedaron sin OT.
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

  select o.numero into v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
   limit 1;
  if v_otra is not null then
    raise exception 'La cotización % ya tiene su OT %.', v_cot.numero, v_otra
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

  -- La OT nace aprobada, con su PDF: Gerencia ya aprobó su cotización.
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

  -- Los avisos: Diseño y el taller como cuando aprobaba Gerencia, y Ventas, que
  -- desde aquí recibe el código aparte de la aprobación.
  v_enlace := '/diseno/codigo?codigo='
    || replace(replace(replace(replace(replace(replace(v_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  perform public.notificar_a_permiso(
    'diseno.codigos',
    'Código nuevo con su OT',
    format('%s: OT %s, %s (%s) de %s Entrega prometida: %s. Carga sus planos, materiales y etapas.',
           v_codigo, v_numero, v_cot.carroceria, lower(v_tipo), public.con_punto_final(coalesce(v_cot.cliente, 'un cliente')),
           to_char(p_fecha_entrega, 'DD/MM/YYYY')),
    v_enlace, 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Código nuevo en el taller',
    format('%s: %s, %s. Diseño cargará sus planos y etapas.', v_codigo, v_cot.carroceria, lower(v_tipo)),
    '/planos', 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_usuario(
    v_cot.registrado_por,
    'Tu cotización ya tiene su código',
    format('La %s de %s quedó con el código interno %s y la OT %s.',
           v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_codigo, v_numero),
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text) is
  'Administración (ordenes.crear) da el código interno de la unidad y sube el PDF de la OT de una cotización ya aprobada, todo junto o nada (migración 20261027200000).';

revoke all on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  to authenticated;
