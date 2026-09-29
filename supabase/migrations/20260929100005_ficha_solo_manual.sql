-- La ficha y sus accesorios los registra el personal de forma manual.
-- Las OT existentes conservan los accesorios y verificaciones ya registrados.
drop trigger if exists trg_ot_armar_ficha_insert on public.ordenes_trabajo;
drop trigger if exists trg_ot_armar_ficha_update on public.ordenes_trabajo;
revoke all on function public.armar_ficha_ot(uuid) from public, anon, authenticated;
