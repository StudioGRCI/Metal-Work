-- =============================================================================
-- ADMINISTRACIÓN PAUSA Y REANUDA LA OT
-- -----------------------------------------------------------------------------
-- Pausar una OT, con su motivo, y reanudarla pedía `ordenes.cambiar_estado`.
-- Ese permiso lo tenían solo el jefe de producción y el jefe de taller, y esas
-- cuentas ya no se pueden crear: las jefaturas de taller se reemplazaron por
-- Supervisión (migración 20260929110100). Así, solo el administrador podía
-- pausar o reanudar, y «Sin reporte de hoy» le seguía pidiendo el reporte a un
-- código que nadie trabajaba (lo encontró la auditoría del Plan 1, 2026-11-26).
--
-- DKS eligió el 2026-11-26 que lo haga Administración, que ya sube y corrige la
-- OT y suele enterarse primero de por qué se para (pago, cliente, repuestos).
-- Con un permiso propio, `ordenes.pausar`, que abre solo esos dos pasos:
-- EN_PROCESO → PAUSADA, con su motivo, y PAUSADA → EN_PROCESO. No abre iniciar,
-- programar, terminar ni reabrir, que siguen con `ordenes.cambiar_estado`.
--
--   1. El permiso nuevo, asignado a Administración en esta misma migración (un
--      permiso sin rol es una puerta tapiada).
--   2. `fn_ot_permiso_por_estado` lo acepta en esos dos pasos. Antes de
--      reemplazarla se mira que sea una de las versiones que conoce el
--      repositorio: la de la 110 con sus comentarios, la de producción sin
--      ellos, o la que deja esta migración.
--   3. La política de UPDATE de `ordenes_trabajo` lo acepta también: el permiso
--      que exige la acción y el que acepta la política tienen que ser el mismo,
--      o el UPDATE afecta cero filas sin error.
--
-- Sin DROP. Idempotente: `on conflict`, `create or replace` y `alter policy`.
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion)
values ('ordenes.pausar', 'Órdenes de trabajo', 'Pausar una orden en proceso, con su motivo, y reanudarla')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

update public.permisos
   set descripcion = 'Iniciar, programar, pausar, reanudar, terminar o reabrir una orden'
 where codigo = 'ordenes.cambiar_estado'
   and descripcion is distinct from 'Iniciar, programar, pausar, reanudar, terminar o reabrir una orden';

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'ordenes.pausar' from public.roles r where r.codigo = 'ADMINISTRACION'
on conflict do nothing;

do $$
declare
  -- 8ae4…: la de la migración 110, con sus comentarios.
  -- 188f…: la misma sin los comentarios, como está en producción.
  -- ebe3…: la que deja esta migración.
  conocidas constant text[] := array['8ae42c8678a85ed980a06d764daf7270', '188f2fa327e6b65af69b42659e9210e2',
                                     'ebe3cbb87feeb0a4c4bf137e582c62a3'];
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.fn_ot_permiso_por_estado()');
  if huella is null then
    raise exception 'Falta la función fn_ot_permiso_por_estado: esta base no tiene las migraciones anteriores.';
  end if;
  if not huella = any (conocidas) then
    raise exception 'La función fn_ot_permiso_por_estado no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

create or replace function public.fn_ot_permiso_por_estado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado then
    if old.abierta_en_taller
       and old.estado = 'BORRADOR'
       and new.estado in ('APROBADA', 'ANULADA')
       and public.tiene_permiso('ordenes.revisar_taller') then
      return new;
    end if;

    -- Pausar la orden en proceso y reanudarla: Administración, con
    -- `ordenes.pausar` (DKS, 2026-11-26), o quien cambia estados.
    if (old.estado = 'EN_PROCESO' and new.estado = 'PAUSADA')
       or (old.estado = 'PAUSADA' and new.estado = 'EN_PROCESO') then
      if not public.tiene_permiso('ordenes.pausar') then
        perform public.exigir_permiso('ordenes.cambiar_estado');
      end if;
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
          raise exception 'No tienes permiso para marcar la orden como facturada.'
            using errcode = 'insufficient_privilege';
        end if;
      else                  perform public.exigir_permiso('ordenes.cambiar_estado');
    end case;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_permiso_por_estado() from public, anon, authenticated;

alter policy editar_ordenes_trabajo on public.ordenes_trabajo
  using (public.es_admin() or public.tiene_permiso('ordenes.editar') or public.tiene_permiso('ordenes.cambiar_estado')
         or public.tiene_permiso('ordenes.pausar')
         or public.tiene_permiso('ordenes.aprobar') or public.tiene_permiso('ordenes.anular')
         or public.tiene_permiso('ordenes.entregar') or public.tiene_permiso('ordenes.revisar_taller'))
  with check (public.es_admin() or public.tiene_permiso('ordenes.editar') or public.tiene_permiso('ordenes.cambiar_estado')
              or public.tiene_permiso('ordenes.pausar')
              or public.tiene_permiso('ordenes.aprobar') or public.tiene_permiso('ordenes.anular')
              or public.tiene_permiso('ordenes.entregar') or public.tiene_permiso('ordenes.revisar_taller'));
