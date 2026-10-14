-- =============================================================================
-- EL NÚMERO DE UNA FACTURA ANULADA QUEDA LIBRE EN LA OT
-- -----------------------------------------------------------------------------
-- Desde la 20261015120000, la cuenta por cobrar nace de la factura que
-- Contabilidad envía a Tesorería, y si Contabilidad la anula (el monto o la
-- fecha estaban mal escritos), la cuenta queda marcada como anulada y deja de
-- salir. Para enviarla bien escrita con el mismo número hace falta que ese
-- número pueda repetirse en la OT entre las cuentas anuladas: la restricción
-- de antes lo prohibía entre todas. Desde la 20261015120000 la regla la lleva
-- un índice que solo mira las vigentes (uq_cuenta_cobrar_numero_vigente).
--
-- Va aparte porque el conector de producción no deja pasar un DROP: esta se
-- pega en el SQL Editor de Supabase. Mientras no esté, enviar otra vez un
-- número anulado en esa OT avisa con un mensaje claro en vez de caerse.
-- =============================================================================

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'cuentas_cobrar_ot_orden_id_numero_documento_key'
               and conrelid = 'public.cuentas_cobrar_ot'::regclass) then
    alter table public.cuentas_cobrar_ot drop constraint cuentas_cobrar_ot_orden_id_numero_documento_key;
  end if;
end $$;
