-- =============================================================================
-- EL BANCO YA NO SE CIERRA SIN SU CAPTURA, TAMPOCO DESDE UNA PANTALLA VIEJA
-- -----------------------------------------------------------------------------
-- Plan 11, entrega 11.3, segunda mitad de la 20261126550000. Aquella dio a
-- `cerrar_dia_caja` la captura del día y dejó la de cinco parámetros como
-- estaba, porque la pantalla que estaba en producción la usaba: aplicarla antes
-- del despliegue no podía dejar a Tesorería sin cerrar sus bancos.
--
-- Esta se aplica en producción **después** de desplegar la pantalla que pide la
-- captura. La de cinco parámetros pasa a llamar a la nueva sin captura: quien
-- la llame directo por la API cierra la caja chica igual, y al cerrar un banco
-- recibe el mensaje que pide la captura. Así la regla vale por cualquier camino.
-- (La pantalla, también una pestaña abierta desde antes, ya llama a la de seis
-- por la acción de servidor nueva.)
--
-- Cuidado: con esta aplicada, una versión de la aplicación anterior al
-- despliegue no cierra ningún banco. Si se vuelve atrás el despliegue, antes se
-- devuelve la de cinco parámetros de la 20261023200000. Para comprobar que entró:
--   select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
--    where p.proname = 'cerrar_dia_caja' and p.pronargs = 5;   -- 'sql'
--
-- Idempotente: `create or replace` con la misma firma.
-- =============================================================================
-- La de cinco parámetros, de una pantalla abierta desde antes: la nueva, sin captura.
create or replace function public.cerrar_dia_caja(p_id uuid, p_caja_id uuid, p_fecha date, p_saldo_banco numeric, p_observaciones text)
returns uuid language sql set search_path to 'public' as $$
  select public.cerrar_dia_caja(p_id, p_caja_id, p_fecha, p_saldo_banco, p_observaciones, null::text);
$$;
comment on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) is
  'La versión sin captura, para una pantalla abierta antes de la migración 20261126550000: cierra la caja chica como antes, y no cierra un banco sin su captura.';
revoke all on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) to authenticated;

