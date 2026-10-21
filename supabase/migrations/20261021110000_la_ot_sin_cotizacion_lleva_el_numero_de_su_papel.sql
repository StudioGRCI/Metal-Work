-- =============================================================================
-- LA OT SIN COTIZACIÓN LLEVA EL NÚMERO DE SU PAPEL
-- -----------------------------------------------------------------------------
-- DKS lo decidió el 2026-10-21: la OT sin cotización lleva el número escrito en
-- su papel, como la que sale de una cotización.
--
-- Hasta aquí la OT de una cotización tomaba el número de su PDF (2922-2026,
-- migración 108) y la que Administración registra sin cotización recibía el
-- siguiente de la serie del sistema, aunque su papel dijera otro. Así la misma
-- orden podía tener dos números —el del papel en la mano y el de la pantalla—,
-- o el de la serie podía caer sobre el de un papel que todavía no se había
-- registrado.
--
-- Desde aquí `registrar_orden_sin_cotizacion` pide el número del papel, con las
-- mismas reglas que la de cotización:
--
--   * «2922» toma el año en curso y «2922-2026» entra tal cual; «12345» queda
--     «12345», sin recortarse a cuatro cifras;
--   * no se repite: si ya hay una orden con ese número, lo dice;
--   * la serie automática salta por encima de él, así la siguiente orden que
--     abra el taller no choca con ninguna.
--
-- La firma cambia (un parámetro más), así que la vieja se va para que no quede
-- una puerta sin número.
-- =============================================================================

drop function if exists public.registrar_orden_sin_cotizacion(uuid, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint);

create or replace function public.registrar_orden_sin_cotizacion(
  p_orden            uuid,
  p_numero           text,
  p_cliente          uuid,
  p_unidad           uuid,
  p_sede             uuid,
  p_tipo_carroceria  uuid,
  p_tipo_trabajo     public.tipo_trabajo_ot,
  p_prioridad        public.prioridad_ot,
  p_descripcion      text,
  p_especificaciones text,
  p_inicio           date,
  p_fin              date,
  p_entrega          date,
  p_responsable      uuid,
  p_observaciones    text,
  p_ruta_pdf         text,
  p_nombre_pdf       text,
  p_tamano_pdf       bigint
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_crudo  constant text := btrim(coalesce(p_numero, ''));
  v_cifras text;
  v_anio   text;
  v_numero text;
  v_correl bigint;
begin
  perform public.exigir_permiso('ordenes.crear');

  if p_orden is null then
    raise exception 'Vuelve a abrir el formulario de la orden.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo where id = p_orden) then
    raise exception 'Esta orden ya quedó registrada: búscala en Órdenes de trabajo.' using errcode = 'check_violation';
  end if;

  -- El número del papel, como al aprobar la cotización (migración
  -- 20261016900000). Sin `lpad` a secas: recorta lo que pasa de cuatro cifras
  -- y «12345» quedaba como «1234», el número de otra orden.
  if v_crudo ~ '^\d{1,6}$' then
    v_cifras := v_crudo;
    v_anio := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_cifras := split_part(v_crudo, '-', 1);
    v_anio := split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la orden es el que trae su papel: 2922 o 2922-2026.'
      using errcode = 'check_violation';
  end if;
  v_cifras := ltrim(v_cifras, '0');
  if v_cifras = '' then
    raise exception 'El número de la orden es el que trae su papel: 2922 o 2922-2026.'
      using errcode = 'check_violation';
  end if;
  v_numero := (case when char_length(v_cifras) < 4 then lpad(v_cifras, 4, '0') else v_cifras end) || '-' || v_anio;
  if exists (select 1 from public.ordenes_trabajo o where o.numero = v_numero) then
    raise exception 'Ya hay una orden de trabajo %: revisa el número del papel.', v_numero
      using errcode = 'unique_violation';
  end if;

  if p_cliente is null then
    raise exception 'Elige el cliente de la orden.' using errcode = 'check_violation';
  end if;
  if p_sede is null then
    raise exception 'Elige el taller de la orden.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_descripcion, ''))) < 5 then
    raise exception 'Describe el trabajo a realizar.' using errcode = 'check_violation';
  end if;
  -- El PDF ya viajó a la carpeta de la orden: `ot/{orden}/{archivo}.pdf`.
  if p_ruta_pdf is null or p_ruta_pdf !~ ('^ot/' || p_orden::text || '/[^/]+\.pdf$') then
    raise exception 'Falta el PDF de la orden de trabajo: elígelo y vuelve a registrar.' using errcode = 'check_violation';
  end if;
  if p_tamano_pdf is null or p_tamano_pdf <= 0 or p_tamano_pdf > 20 * 1024 * 1024 then
    raise exception 'El PDF de la orden llegó vacío o pesa más de 20 MB.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'adjuntos-ot' and o.name = p_ruta_pdf
                    and o.owner_id = public.usuario_actual()::text
                    and o.metadata->>'mimetype' = 'application/pdf') then
    raise exception 'El PDF de la orden no llegó: vuelve a elegirlo y registra otra vez.' using errcode = 'check_violation';
  end if;

  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad,
                                      descripcion, especificaciones_tecnicas, fecha_inicio_programada,
                                      fecha_fin_programada, fecha_entrega_comprometida, responsable_id, observaciones)
  values (p_orden, v_numero, p_cliente, p_unidad, p_sede, p_tipo_carroceria, coalesce(p_tipo_trabajo, 'FABRICACION'),
          coalesce(p_prioridad, 'NORMAL'), btrim(p_descripcion), nullif(btrim(coalesce(p_especificaciones, '')), ''),
          p_inicio, p_fin, p_entrega, p_responsable, nullif(btrim(coalesce(p_observaciones, '')), ''));

  -- La serie automática no se queda atrás del papel: la siguiente orden que el
  -- taller abra sale después de esta y no choca con ninguna.
  v_correl := v_cifras::bigint;
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_correl)
   where tipo = 'ORDEN_TRABAJO'
     and (sede_id is null or sede_id = p_sede)
     and correlativo_actual < v_correl;

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(left(nullif(btrim(coalesce(p_nombre_pdf, '')), ''), 200), 'orden.pdf'),
          p_ruta_pdf, 'application/pdf', p_tamano_pdf, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.registrar_orden_sin_cotizacion(uuid, text, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) is
  'Administración registra la orden sin cotización con el número de su papel y su PDF ya subido, juntos o nada; nace en borrador y la aprueba Gerencia. La serie automática salta por encima del número (migración 20261021110000).';

revoke all on function public.registrar_orden_sin_cotizacion(uuid, text, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) from public, anon;
grant execute on function public.registrar_orden_sin_cotizacion(uuid, text, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) to authenticated;
