-- =============================================================================
-- EL NÚMERO DE LA ORDEN LO TRAE SU PAPEL
-- -----------------------------------------------------------------------------
-- «Revisa la numeración, porque en cotización sí permite numeración.»
--
-- La orden de trabajo se arma fuera del sistema y llega en PDF con su número ya
-- puesto —el papel del 14/09/2026 dice OT-2922—, igual que la cotización. Pero
-- al emitirla el sistema le ponía el suyo (0001-2026, porque la serie se
-- reinició a cero el 28/08/2026), así que el papel y la pantalla hablaban de
-- órdenes distintas: nadie podía cruzar una con otra después.
--
-- Desde aquí el número lo escribe Administración al emitir, como el de la
-- cotización (migración 101), con tres resguardos:
--
--   1. **No se repite.** `ordenes_trabajo.numero` ya es único; la función lo
--      comprueba antes para dar un mensaje que se entienda en vez del error del
--      motor.
--   2. **Se escribe una sola vez.** Cambiar el número de una orden ya emitida
--      sigue prohibido (`fn_ot_antes_update`), que es lo que hace que el número
--      valga como referencia.
--   3. **La serie del sistema no se queda atrás.** Las órdenes que abre el
--      taller y las que registra la oficina siguen numerándose solas; al emitir
--      una con número de papel, la serie salta por encima de él, así la
--      siguiente automática es 2923-2026 y no vuelve a chocar.
--
-- El formato es el de la casa, `{numero}-{anio}`: se acepta «2922» —se le pone
-- el año en curso— o «2922-2026» ya escrito.
-- =============================================================================

-- La firma cambia: se va la vieja para que no queden las dos.
drop function if exists public.emitir_orden_de_cotizacion(
  uuid, uuid, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint);

create or replace function public.emitir_orden_de_cotizacion(
  p_cotizacion    uuid,
  p_orden         uuid,
  p_numero        text,
  p_numero_fmi    text,
  p_tipo_unidad   public.tipo_unidad_carroceria,
  p_marca         text,
  p_modelo        text,
  p_fecha_entrega date,
  p_ruta_pdf      text,
  p_nombre_pdf    text,
  p_tamano_pdf    bigint default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cot     record;
  v_fmi     constant text := nullif(upper(btrim(coalesce(p_numero_fmi, ''))), '');
  v_clave   constant text := upper(regexp_replace(coalesce(p_numero_fmi, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo   constant text := btrim(coalesce(p_numero, ''));
  v_numero  text;
  v_correl  bigint;
  v_unidad  uuid;
  v_ajena   text;
  v_sede    uuid;
  v_nombre  text;
  v_tipo    constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
begin
  perform public.exigir_permiso('ordenes.crear');

  -- El número del papel: «2922» toma el año en curso; «2922-2026» entra tal cual.
  if v_crudo ~ '^\d{1,6}$' then
    v_numero := lpad(v_crudo, 4, '0') || '-' ||
                to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_numero := lpad(split_part(v_crudo, '-', 1), 4, '0') || '-' || split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la orden es el que trae su papel: 2922 o 2922-2026.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.ordenes_trabajo o where o.numero = v_numero) then
    raise exception 'Ya hay una orden de trabajo %: revisa el número del papel.', v_numero
      using errcode = 'unique_violation';
  end if;

  select c.*, tc.nombre as carroceria into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
   where c.id = p_cotizacion
     for update of c;

  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % todavía no está aprobada por Gerencia.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo o
              where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA') then
    raise exception 'La cotización % ya tiene su orden de trabajo.', v_cot.numero
      using errcode = 'unique_violation';
  end if;
  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3) then
    raise exception 'El PDF de la orden no llegó en su sitio.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe el número FMI, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  if v_clave <> '' then
    select u.id into v_unidad
      from public.unidades u
     where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
     order by (u.cliente_id is not null) desc, u.creado_en desc
     limit 1;

    if v_unidad is null then
      select coalesce(cl.razon_social, 'otro cliente') into v_ajena
        from public.unidades u
        left join public.clientes cl on cl.id = u.cliente_id
       where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       limit 1;
      if v_ajena is not null then
        raise exception 'El número FMI % ya es de una unidad de %: revisa el número.', v_fmi, v_ajena
          using errcode = 'unique_violation';
      end if;
    else
      update public.unidades set cliente_id = v_cot.cliente_id
       where id = v_unidad and cliente_id is null;
    end if;
  end if;

  if v_unidad is null then
    insert into public.unidades (cliente_id, numero_fmi, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_fmi,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
    descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad)
  values (
    p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION', 'NORMAL',
    format('%s · %s · cotización %s', v_cot.carroceria, v_tipo, v_cot.numero),
    p_fecha_entrega, 'APROBADA', p_cotizacion, p_tipo_unidad);

  -- La serie automática no se queda atrás del papel: la siguiente orden que el
  -- taller abra sale después de esta y no choca con ninguna.
  v_correl := split_part(v_numero, '-', 1)::bigint;
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_correl)
   where tipo = 'ORDEN_TRABAJO'
     and (sede_id is null or sede_id = v_sede)
     and correlativo_actual < v_correl;

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf,
          'application/pdf', p_tamano_pdf, public.usuario_actual());

  v_nombre := coalesce('FMI ' || v_fmi,
                       nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Orden nueva en el taller',
    format('%s: %s, %s (%s). Armen la lista de su área.', v_numero, v_cot.carroceria, lower(v_tipo), coalesce(v_nombre, 'sin FMI')),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  perform public.notificar_a_permiso(
    'diseno.planos',
    'Orden nueva para desglosar',
    format('%s: %s, %s. Falta el desglose de Diseño.', v_numero, v_cot.carroceria, lower(v_tipo)),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  return p_orden;
end;
$function$;

comment on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint) is
  'Emite la orden desde la cotización aprobada, con el número que trae su papel. La orden nace aprobada, con sus etapas y su PDF, y la serie automática salta por encima del número usado.';

revoke all on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  from public, anon;
grant execute on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  to authenticated;
