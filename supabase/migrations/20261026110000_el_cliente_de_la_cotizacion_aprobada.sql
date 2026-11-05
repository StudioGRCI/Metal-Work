-- =============================================================================
-- EL CLIENTE DE LA COTIZACIÓN APROBADA, TAMBIÉN EN LA PANTALLA DE COTIZACIÓN
-- -----------------------------------------------------------------------------
-- DKS (26/10): en Cotización, Tesorería ve «Cliente reservado», pero en Cuentas
-- por cobrar sí ve el cliente de cada factura y de cada cotización aprobada.
-- «Tiene que verlo en ambas.»
--
-- Cuentas por cobrar lo lee de `cotizaciones_para_facturar()`, que da el nombre
-- del cliente de cada cotización aprobada a Contabilidad, Gerencia, Tesorería y
-- Administración. La pantalla de Cotización lo lee de `v_cotizaciones_pdf`, que
-- cruza `clientes` con el permiso de quien mira (`clientes.ver`), y ni Tesorería
-- ni Contabilidad lo tienen.
--
-- No se les da `clientes.ver`: abriría el padrón entero, con sus contactos y sus
-- unidades. Esta función da solo lo que Cuentas por cobrar ya les muestra, el
-- nombre del cliente de las cotizaciones aprobadas, con el mismo permiso, y el
-- de las que Gerencia le liberó a Tesorería, cuyo PDF ya ve.
--
-- Idempotente. Sin `drop`.
-- =============================================================================

create or replace function public.clientes_de_cotizaciones(p_ids uuid[])
returns table (cotizacion_id uuid, cliente text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')
          or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, cl.razon_social
      from public.cotizaciones_pdf c
      join public.clientes cl on cl.id = c.cliente_id
     where c.id = any(p_ids) and c.estado::text <> 'ANULADA'
       and ((public.cotizacion_fue_aprobada(c.id)
             and (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')))
            -- La que Gerencia le liberó a Tesorería antes de aprobarla: ya ve su PDF, con el cliente adentro.
            or (public.tiene_permiso('tesoreria.ver_documentos')
                and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = c.id)));
end;
$$;
comment on function public.clientes_de_cotizaciones(uuid[]) is
  'El nombre del cliente de cada cotización aprobada, para quien ve las cotizaciones aprobadas sin ver el padrón de clientes (el mismo permiso que cotizaciones_para_facturar), y de las liberadas a Tesorería.';
revoke all on function public.clientes_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.clientes_de_cotizaciones(uuid[]) to authenticated;
