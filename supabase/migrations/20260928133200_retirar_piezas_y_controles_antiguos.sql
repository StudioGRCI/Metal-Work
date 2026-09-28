-- Aplicar después del despliegue que retira los formularios anteriores.
-- La firma anterior permitía crear etapas sin área ni peso.
revoke all on function public.definir_etapas_diseno(uuid,uuid[]) from public, anon, authenticated;

-- Las piezas de planos quedan como historial de solo lectura. El detalle
-- físico y su cantidad se gestionan en Materiales, vinculado al plano.
create or replace function public.bloquear_edicion_piezas_planos()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  raise exception 'Las piezas se consultan en Planos; los materiales se registran en Materiales.';
end;
$$;
revoke all on function public.bloquear_edicion_piezas_planos() from public, anon, authenticated;
drop trigger if exists trg_bloquear_edicion_piezas_planos on public.ot_piezas;
create trigger trg_bloquear_edicion_piezas_planos before insert or update or delete
on public.ot_piezas for each row execute function public.bloquear_edicion_piezas_planos();
revoke insert, update, delete on public.ot_piezas from public, anon, authenticated;
