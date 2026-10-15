-- =============================================================================
-- EL PAGO ANULADO DEJA LIBRE SU OPERACIÓN
-- -----------------------------------------------------------------------------
-- Una restricción de antes prohibía repetir la operación del banco en el pago
-- de una factura de compra aunque el pago que la usaba ya estuviera anulado. Si
-- Tesorería anula un pago mal registrado, la misma operación tiene que poder
-- entrar bien registrada. La regla la lleva ahora
-- `uq_pago_adquisicion_referencia_vigente` (20261015122000), que mira solo los
-- pagos vigentes.
--
-- Va aparte porque el conector de producción no deja pasar un DROP: esta se
-- pega en el SQL Editor de Supabase. Mientras no esté, repetir la operación de
-- un pago anulado avisa con un mensaje claro en vez de caerse.
-- =============================================================================

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'pagos_adquisicion_adquisicion_id_referencia_key'
               and conrelid = 'public.pagos_adquisicion'::regclass) then
    alter table public.pagos_adquisicion drop constraint pagos_adquisicion_adquisicion_id_referencia_key;
  end if;
end $$;
