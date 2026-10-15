-- =============================================================================
-- LO ANULADO DEJA LIBRE SU NÚMERO
-- -----------------------------------------------------------------------------
-- Dos restricciones de antes prohibían repetir un número aunque el documento
-- que lo usaba ya estuviera anulado:
--
--   · La cuenta por cobrar (20261015120000): si Contabilidad anula una factura
--     ya enviada a Tesorería porque el monto o la fecha estaban mal escritos,
--     tiene que poder enviarla bien escrita con el mismo número. La regla la
--     lleva ahora el índice `uq_cuenta_cobrar_numero_vigente`, que mira solo las
--     cuentas vigentes.
--   · El pago de una factura de compra (20261015122000): si Tesorería anula un
--     pago mal registrado, la misma operación del banco tiene que poder entrar
--     bien registrada. La regla la lleva `uq_pago_adquisicion_referencia_vigente`.
--
-- Al soltar la primera, la llave de la cuenta hacia su OT se queda solo con un
-- índice parcial, que la integridad no puede usar (check 190): se le da uno
-- entero. Cumple (a) y (b): no queda otro que empiece por `orden_id`, y las
-- cuentas se leen por OT (la pestaña de la OT y lo cobrado de cada una).
--
-- Va aparte porque el conector de producción no deja pasar un DROP: esta se
-- pega en el SQL Editor de Supabase. Mientras no esté, volver a usar un número
-- anulado avisa con un mensaje claro en vez de caerse.
-- =============================================================================

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'cuentas_cobrar_ot_orden_id_numero_documento_key'
               and conrelid = 'public.cuentas_cobrar_ot'::regclass) then
    alter table public.cuentas_cobrar_ot drop constraint cuentas_cobrar_ot_orden_id_numero_documento_key;
  end if;
  if exists (select 1 from pg_constraint where conname = 'pagos_adquisicion_adquisicion_id_referencia_key'
               and conrelid = 'public.pagos_adquisicion'::regclass) then
    alter table public.pagos_adquisicion drop constraint pagos_adquisicion_adquisicion_id_referencia_key;
  end if;
end $$;

create index if not exists idx_cuentas_cobrar_ot_orden on public.cuentas_cobrar_ot (orden_id);
