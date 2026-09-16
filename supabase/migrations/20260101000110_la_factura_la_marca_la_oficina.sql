-- =============================================================================
-- FACTURADA LA MARCA LA OFICINA
-- -----------------------------------------------------------------------------
-- «Marcar facturada» exigía `ordenes.cambiar_estado`, que es el permiso del
-- taller: lo tenían el supervisor, el jefe de producción y el jefe de taller, y
-- no lo tenía Administración, que es quien factura. La revisión de uso del
-- 2026-09-15 lo encontró: el botón le salía a quien no factura y le faltaba a
-- quien sí.
--
-- Desde aquí FACTURADA acepta `ordenes.editar` —la oficina— además de
-- `ordenes.cambiar_estado`, para no quitarle nada a quien ya podía. El resto del
-- mapa no cambia. Definición viva al 2026-09-16.
-- =============================================================================
create or replace function public.fn_ot_permiso_por_estado()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.estado is distinct from old.estado then
    if old.abierta_en_taller
       and old.estado = 'BORRADOR'
       and new.estado in ('APROBADA', 'ANULADA')
       and public.tiene_permiso('ordenes.revisar_taller') then
      return new;
    end if;

    case new.estado
      when 'APROBADA'  then perform public.exigir_permiso('ordenes.aprobar');
      when 'ANULADA'   then perform public.exigir_permiso('ordenes.anular');
      when 'ENTREGADA' then perform public.exigir_permiso('ordenes.entregar');
      when 'FACTURADA' then
        -- Sin sesión (una migración, la clave de servicio) el control lo da el
        -- acceso a la base, igual que en exigir_permiso.
        if public.usuario_actual() is not null
           and not (public.es_admin()
                    or public.tiene_permiso('ordenes.editar')
                    or public.tiene_permiso('ordenes.cambiar_estado')) then
          raise exception 'Marcar la orden como facturada es de la oficina.'
            using errcode = 'insufficient_privilege';
        end if;
      else                  perform public.exigir_permiso('ordenes.cambiar_estado');
    end case;
  end if;
  return new;
end;
$function$;
