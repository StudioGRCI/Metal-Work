-- Una OT anulada es evidencia: no se retoca ni un campo.
--
-- La regla del taller es que un documento numerado no se borra nunca: se anula,
-- con motivo, quién y cuándo, y queda congelado (migración 20260101000034). La
-- cotización ya lo hacía (`fn_cotizacion_anular`, migración 20260101000035).
-- La OT no: la política `editar_ordenes_trabajo` acepta `ordenes.editar` y
-- `ordenes.cambiar_estado` sin mirar el estado, así que Administración o Gerencia
-- podían cambiarle la descripción, o el motivo de la anulación, a una OT ya
-- anulada. Reabrirla ya lo rechazaba `ot_transicion_valida`; borrarla, el
-- permiso y `fn_documento_numerado_no_se_borra`. Lo encontró el auditor de
-- funcionamiento el 2026-10-20.
--
-- Se compara la fila entera salvo `actualizado_en`, que pone otro disparador.
-- Un UPDATE que no cambia nada (un recálculo de avance que da lo mismo) pasa.

create or replace function public.fn_ot_anulada_es_evidencia()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.estado = 'ANULADA'
     and (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'La OT % está anulada y se conserva como evidencia: ya no se cambia.', old.numero
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_anulada_es_evidencia() from public, anon, authenticated;

drop trigger if exists trg_ot_anulada_es_evidencia on public.ordenes_trabajo;
create trigger trg_ot_anulada_es_evidencia
  before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_anulada_es_evidencia();
