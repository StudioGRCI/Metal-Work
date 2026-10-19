-- =============================================================================
-- LA ORDEN SIN COTIZACIÓN TAMBIÉN VA CON SU PDF
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-19: «en la orden debe siempre ir el PDF que cargan
-- ellos, así que en orden sin cotización igual debería dejar cargar el PDF».
--
-- La OT que sale de una cotización ya nace con su PDF: Gerencia lo sube al
-- aprobarla (migración 20261016900000). La orden sin cotización —una reparación,
-- una garantía, un trabajo que no se cotizó— la registra Administración en
-- «Órdenes de trabajo › Orden sin cotización», y se registraba sin papel: el
-- formulario no lo pedía y la pestaña de la orden solo dejaba subirlo a
-- Supervisión.
--
-- Desde aquí:
--
--   · `registrar_orden_sin_cotizacion` registra la orden y su PDF juntos, o
--     ninguno. El PDF es obligatorio y tiene que estar ya en la carpeta de la
--     orden, subido por quien la registra. Pide `ordenes.crear`, como antes, y
--     la orden nace en borrador para que Gerencia la apruebe.
--   · La orden ya no se inserta directo en `ordenes_trabajo`: esa puerta dejaba
--     registrarla sin PDF por la API. Queda solo para el administrador del
--     sistema; las demás entradas (esta función, la de Gerencia al aprobar la
--     cotización y la del taller) son funciones que validan lo suyo.
--   · Quien sube el PDF de una orden lo ve. Hasta aquí el PDF de la OT solo lo
--     veían Diseño y Supervisión de Producción, Maestranza y Acabados
--     (`puede_ver_pdf_ot`, migración 20260929221000): Administración subía la
--     orden y la pantalla le decía que no tenía PDF. Los demás puestos siguen
--     sin verlo.
--
-- El número de la orden sin cotización lo sigue poniendo el sistema, como hasta
-- hoy (migración 108).
-- =============================================================================

create or replace function public.registrar_orden_sin_cotizacion(
  p_orden            uuid,
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
begin
  perform public.exigir_permiso('ordenes.crear');

  if p_orden is null then
    raise exception 'Vuelve a abrir el formulario de la orden.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo where id = p_orden) then
    raise exception 'Esta orden ya quedó registrada: búscala en Órdenes de trabajo.' using errcode = 'check_violation';
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

  insert into public.ordenes_trabajo (id, cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad,
                                      descripcion, especificaciones_tecnicas, fecha_inicio_programada,
                                      fecha_fin_programada, fecha_entrega_comprometida, responsable_id, observaciones)
  values (p_orden, p_cliente, p_unidad, p_sede, p_tipo_carroceria, coalesce(p_tipo_trabajo, 'FABRICACION'),
          coalesce(p_prioridad, 'NORMAL'), btrim(p_descripcion), nullif(btrim(coalesce(p_especificaciones, '')), ''),
          p_inicio, p_fin, p_entrega, p_responsable, nullif(btrim(coalesce(p_observaciones, '')), ''));

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(left(nullif(btrim(coalesce(p_nombre_pdf, '')), ''), 200), 'orden.pdf'),
          p_ruta_pdf, 'application/pdf', p_tamano_pdf, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.registrar_orden_sin_cotizacion(uuid, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) is
  'Administración registra la orden sin cotización con su PDF ya subido, juntos o nada; nace en borrador y la aprueba Gerencia (migración 20261017402000).';

revoke all on function public.registrar_orden_sin_cotizacion(uuid, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) from public, anon;
grant execute on function public.registrar_orden_sin_cotizacion(uuid, uuid, uuid, uuid, uuid, public.tipo_trabajo_ot,
  public.prioridad_ot, text, text, date, date, date, uuid, text, text, text, bigint) to authenticated;

-- La orden sin PDF ya no entra por la API: solo el administrador del sistema
-- inserta directo. Se cambia con `alter policy` porque el conector de
-- producción no deja pasar un `drop`.
alter policy crear_ordenes_trabajo on public.ordenes_trabajo
  with check (public.es_admin());

-- Quien sube el PDF de una orden lo ve; el resto, como hasta aquí.
alter policy ver_ot_adjuntos on public.ot_adjuntos
  using (public.puede_ver_orden(orden_id)
         and (tipo <> 'ORDEN'
              or (select public.puede_ver_pdf_ot())
              or subido_por = (select public.usuario_actual())));
