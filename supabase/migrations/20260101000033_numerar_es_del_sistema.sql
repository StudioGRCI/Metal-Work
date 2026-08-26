-- =============================================================================
-- NUMERAR DOCUMENTOS ES DEL SISTEMA, NO DEL USUARIO
-- -----------------------------------------------------------------------------
-- La migración 022 cerró siguiente_correlativo() a los usuarios —correcto:
-- nadie quema correlativos a mano—. Pero los disparadores que numeran cada
-- documento la llaman corriendo con los permisos de quien inserta, así que
-- cerrarla les cerró la puerta también a ellos: desde entonces un usuario real
-- no podía emitir una cotización, abrir una orden ni registrar un movimiento
-- —«permission denied for function siguiente_correlativo»—.
--
-- Ninguna prueba lo vio porque los checks corrían como superusuario. La
-- lección queda en un check nuevo que inserta como `authenticated`, y acá el
-- arreglo de fondo: los disparadores que numeran pasan a security definer.
-- No es abrir una puerta: el usuario sigue sin poder llamar al correlativo;
-- es el sistema el que numera cuando la política de la tabla ya dejó pasar
-- la fila. fn_os_numero ya nació así; el resto se alinea.
-- =============================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not p.prosecdef
       and p.proname in (
         'fn_cotizacion_calcular', 'fn_movimiento_numerar', 'fn_orden_compra_numerar',
         'fn_ot_antes_insert', 'fn_recepcion_numerar', 'fn_requerimiento_numerar',
         'produccion_siguiente_numero')
  loop
    execute format('alter function %s security definer', f.firma);
    execute format('alter function %s set search_path to %L', f.firma, 'public');
    -- Función de disparador o ayudante interno: nadie la llama a mano.
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end;
$$;
