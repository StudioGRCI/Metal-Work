-- La vista de compras al crédito sin comprobante vuelve a mirar con los ojos de
-- quien consulta.
--
-- La 20261016602000 la redefinió con `create or replace view` sin repetir
-- `with (security_invoker = true)`, y Postgres reemplaza las opciones de la
-- vista por las que trae la sentencia: la vista quedó corriendo como su dueño,
-- por encima del RLS de las OC (lo avisó `get_advisors` como «Security Definer
-- View» apenas se aplicó). Se le devuelve la opción; no cambia su consulta.
alter view public.v_compras_credito_sin_comprobante set (security_invoker = true);
