-- =============================================================================
-- EL PLAZO ARRANCA UNA SOLA VEZ
-- -----------------------------------------------------------------------------
-- Corrige la 087, y el fallo salió al escribir su check antes de darla por
-- buena: `arrancar_plazo_de_cotizacion` sellaba la fecha solo si estaba vacía
-- —bien— pero después reprogramaba las etapas con la fecha RECIBIDA, no con la
-- sellada.
--
-- Con eso, el segundo pago del cliente —el parcial de un mes después— corría el
-- programa entero del taller un mes hacia adelante. Nadie habría entendido por
-- qué las catorce etapas se movieron solas, y el que lo notara habría buscado
-- el error en producción, no en tesorería.
--
-- Ahora se programa con la fecha que quedó escrita en la cotización, que es la
-- del primer pago. Llamarla de nuevo no cambia nada.
--
-- Comprobado contra la base con el rol real: con el adelanto el programa
-- arranca el día del adelanto, y tras el parcial de treinta días después sigue
-- en el mismo día.
-- =============================================================================
create or replace function public.arrancar_plazo_de_cotizacion(
  p_cotizacion uuid,
  p_fecha      date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden  uuid;
  v_fecha  date;
begin
  update public.cotizaciones
     set plazo_arranca_en = p_fecha
   where id = p_cotizacion
     and plazo_arranca_en is null;

  -- La que quedó escrita, no la que llegó: el primero que entra manda.
  select c.plazo_arranca_en into v_fecha
    from public.cotizaciones c where c.id = p_cotizacion;

  if v_fecha is null then return; end if;

  select o.id into v_orden
    from public.ordenes_trabajo o
   where o.cotizacion_id = p_cotizacion
     and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
   limit 1;

  if v_orden is null then return; end if;

  -- Un programa no se mueve debajo de un trabajo ya empezado.
  if exists (
    select 1 from public.ot_etapas e
     where e.orden_id = v_orden
       and (e.fecha_inicio_real is not null or e.estado <> 'PENDIENTE')
  ) then
    return;
  end if;

  update public.ordenes_trabajo
     set fecha_inicio_programada = v_fecha
   where id = v_orden;

  update public.ot_etapas
     set fecha_inicio_programada = null,
         fecha_fin_programada    = null
   where orden_id = v_orden;

  perform public.programar_etapas_ot(v_orden);
end;
$$;

revoke all on function public.arrancar_plazo_de_cotizacion(uuid, date) from public, anon, authenticated;
