-- =============================================================================
-- LOS BOTONES QUE DECÍAN QUE SÍ Y NO HACÍAN NADA
-- -----------------------------------------------------------------------------
-- Buscando por qué Gerencia no podía aprobar una cotización apareció un patrón,
-- y no era un caso suelto: la aplicación deja pasar a alguien por un permiso que
-- la política de la tabla no reconoce. El UPDATE o el DELETE afecta cero filas;
-- una fila que el RLS esconde no es un error para Postgres, así que la acción
-- responde «ok», la pantalla dice «Partida eliminada» y la partida sigue ahí.
--
-- Es el peor tipo de fallo que puede tener este sistema: no se cae, miente. El
-- vendedor cree que quitó la partida y manda la cotización con ella dentro.
--
-- Tres botones del día a día caían acá, todos por lo mismo: el generador de
-- políticas (migración 007) dio el borrado solo al ADMIN, con la regla «el resto
-- anula, no elimina». La regla es buena para los documentos —una cotización, una
-- orden, un movimiento llevan correlativo y son historia— pero estas tres tablas
-- no son documentos: son las líneas de un documento que todavía se está
-- escribiendo. Quitar una línea de un borrador es redactar, no destruir.
--
-- Lo que sí es historia lo siguen defendiendo las guardas que ya existen, que
-- cubren el borrado y no se tocan acá:
--   · fn_partida_bloquear_cerrada   — nada se toca en una cotización aprobada.
--   · fn_movimiento_detalle_editable — nada se toca en un movimiento confirmado.
--   · fn_parte_detalle_guardia       — nada se toca en un parte cerrado.
-- =============================================================================

-- ------------------------------------- la partida de una cotización abierta
-- El tacho de la tabla de partidas. Lo pulsa el vendedor, que tiene
-- cotizaciones.editar; la política solo aceptaba es_admin().
drop policy if exists borrar_cotizacion_partidas on public.cotizacion_partidas;
create policy borrar_cotizacion_partidas on public.cotizacion_partidas
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.editar'));

-- ---------------------------------- la línea de un movimiento sin confirmar
-- La quita el almacenero mientras arma el ingreso o la salida.
drop policy if exists borrar_movimiento_detalle on public.movimiento_detalle;
create policy borrar_movimiento_detalle on public.movimiento_detalle
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('almacen.movimientos'));

-- --------------------------------------- las horas mal imputadas del parte
-- El supervisor corrige el parte del día antes de cerrarlo: si escribió las
-- horas en la OT equivocada, tiene que poder quitarlas.
drop policy if exists borrar_parte_detalle on public.parte_detalle;
create policy borrar_parte_detalle on public.parte_detalle
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.registrar'));

-- =============================================================================
-- Y TRES QUE NI SIQUIERA MENTÍAN: FALLABAN
-- -----------------------------------------------------------------------------
-- El mismo check que probaba los botones tropezó con esto al intentar crear un
-- parte diario como jefe de taller: «permission denied for function
-- produccion_siguiente_numero».
--
-- La migración 033 puso en `security definer` las siete funciones de numeración
-- que se conocían, porque `siguiente_correlativo` está cerrada a los usuarios a
-- propósito. Se le escaparon estas tres, que numeran llamando a
-- `produccion_siguiente_numero`, también cerrada. Sin esto, con la aplicación
-- desplegada y un usuario de verdad:
--
--   · el supervisor no puede cargar el parte diario del taller,
--   · calidad no puede registrar una inspección,
--   · y nadie puede registrar el acta de entrega —el documento que cierra la
--     orden, pasa la unidad a ENTREGADA y arranca el cómputo de la garantía—.
--
-- Numerar es cosa del sistema, no de quien escribe: las tres pasan a correr con
-- los permisos de la función, como sus siete hermanas.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_parte_antes_insert',
                         'fn_inspeccion_antes_insert',
                         'fn_entrega_antes_insert')
  loop
    execute format('alter function %s security definer', r.firma);
    execute format('alter function %s set search_path to ''public''', r.firma);
    -- Las llama el sistema al insertar, nunca una persona.
    execute format('revoke all on function %s from public, anon, authenticated', r.firma);
  end loop;
end $$;
