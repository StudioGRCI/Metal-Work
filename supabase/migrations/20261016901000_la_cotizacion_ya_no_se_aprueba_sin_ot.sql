-- =============================================================================
-- LA COTIZACIÓN YA NO SE APRUEBA SIN SU OT
-- -----------------------------------------------------------------------------
-- Segunda mitad de `20261016900000` (la cotización se aprueba con su código
-- interno y su OT). Aquella sumó la aprobación en una sola ventana; esta cierra
-- el camino de antes, y por eso se aplica cuando la pantalla nueva ya está
-- desplegada: antes, Gerencia aprobaría con un toque y la base se lo negaría.
--
--   · Una cotización sin OT no pasa a «aprobada» sin su código y su OT.
--   · Administración ya no emite la OT de la cotización.
--   · El aviso a Ventas trae el código; el de «falta la OT» a Administración
--     ya no hace falta.
--
-- Lo que ya existe —cotizaciones, OT y códigos— queda como está: nada se borra.
-- =============================================================================

-- 1. Administración ya no emite la OT de la cotización ---------------------------
-- La función se conserva para no perder su historia, pero ninguna cuenta la
-- llama: la OT llega con la aprobación.
revoke execute on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  from authenticated;

-- 2. Una cotización sin OT no se aprueba sola ------------------------------------
-- La misma revisión de siempre, con una regla más: pasar de «por revisar» a
-- «aprobada» exige que la OT ya exista (la crea `aprobar_cotizacion_con_ot`
-- un instante antes, en la misma transacción). La corrección de una cotización
-- que ya tiene OT se aprueba como antes. ADMIN, que no tiene cuentas en
-- producción, arma con esto los datos de las pruebas.
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
      raise exception 'La cotización la aprueba o la rechaza Gerencia.' using errcode = 'insufficient_privilege';
    end if;
    if new.estado in ('APROBADA','RECHAZADA') and old.estado <> 'POR_REVISAR' then
      raise exception 'Gerencia solo revisa una versión pendiente; Ventas debe subir una corrección primero.';
    end if;
    if new.estado = 'APROBADA' and not public.es_admin()
       and not exists (select 1 from public.ordenes_trabajo o
                        where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA') then
      raise exception 'La cotización % se aprueba con su código interno y su OT: escríbelos y sube la OT en «Aprobar».', old.numero
        using errcode = 'check_violation';
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

-- 3. Los avisos de la aprobación -------------------------------------------------
-- A Ventas, con el código que ya tiene su cotización. El aviso a Administración
-- de «falta la OT» ya no hace falta: la OT llega con la aprobación.
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
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := public.puesto_de(new.registrado_por);

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s.', coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente')),
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
  end if;

  perform public.notificar_a_usuario(
    new.registrado_por,
    case when new.estado = 'APROBADA' then 'Gerencia aprobó tu cotización' else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA'
         then format('La %s de %s%s.', new.numero, coalesce(v_cliente, 'un cliente'),
                     case when v_codigo is not null then ', con el código interno ' || v_codigo else '' end)
         else format('La %s: %s. Corrígela y sube la corrección.', new.numero, coalesce(new.observacion, 'sin motivo')) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());

  return null;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;
