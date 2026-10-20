-- =============================================================================
-- LA COTIZACIÓN RECHAZADA QUEDA COMO EVIDENCIA
-- -----------------------------------------------------------------------------
-- DKS decidió (2026-10-20) que una cotización rechazada no se quita: Ventas la
-- corrige, la versión corregida la reemplaza y la rechazada queda en la
-- trazabilidad. Es lo que ya hace la corrección (`cotizaciones_pdf_versiones`
-- guarda el archivo rechazado con su observación, migración 102); lo que
-- faltaba era cerrar la otra salida, el «Quitar», que borraba la cotización
-- con su número y todas sus versiones.
--
-- Desde hoy solo se quita la que nunca pasó por Gerencia: por revisar y en su
-- primera versión, que es la subida por error. Una corregida (versión 2 o
-- más) ya tiene un rechazo en su historia, y tampoco se quita.
--
-- Va en el disparador, que no se salta ni el administrador, y en la política
-- de borrado, para que la pantalla y la base digan lo mismo.
-- =============================================================================

create or replace function public.fn_documento_numerado_no_se_borra()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if tg_table_name = 'ordenes_trabajo' then
    raise exception 'La OT % no se borra: se anula, con su motivo, y queda como evidencia.', old.numero
      using errcode = 'check_violation';
  elsif tg_table_name = 'ot_entregas' then
    raise exception 'El acta de conformidad no se borra: queda como evidencia de la entrega.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'liberaciones_tesoreria' then
    raise exception 'La liberación de Tesorería no se borra: es la constancia de que la unidad podía salir.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'cotizaciones_pdf' then
    if old.estado in ('APROBADA', 'ANULADA', 'RECHAZADA') then
      raise exception 'La cotización % no se quita: está %, y queda como evidencia.', old.numero, lower(old.estado::text)
        using errcode = 'check_violation';
    end if;
    if old.version > 1 then
      raise exception 'La cotización % no se quita: ya pasó por Gerencia y su historia queda como evidencia.', old.numero
        using errcode = 'check_violation';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function public.fn_documento_numerado_no_se_borra() from public, anon, authenticated;

alter policy borrar_cotizaciones_pdf on public.cotizaciones_pdf using (
  public.es_admin() or (
    (registrado_por = public.usuario_actual() or public.tiene_permiso('cotizaciones.revisar'))
    and estado = 'POR_REVISAR' and version = 1
  )
);
