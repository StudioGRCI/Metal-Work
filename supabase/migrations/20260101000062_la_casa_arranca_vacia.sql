-- La casa arranca vacía.
--
-- Todo lo que había era demostración: siete unidades inventadas, cinco órdenes
-- de trabajo con sus horas y sus costos, un almacén con stock que nunca entró y
-- un catálogo de materiales genérico. Sirvió para probar las pantallas; a partir
-- de acá estorba, porque quien entre no sabe distinguir un dato de prueba de uno
-- real y termina cotizando sobre una placa que no existe.
--
-- Se queda:
--   · Clientes y sus contactos —los pidió la empresa: es su padrón—.
--   · Los usuarios, los roles y sus permisos.
--   · Toda la configuración: catálogo de carrocerías, tipos de documento,
--     unidades de medida, familias de codificación, feriados, plantillas de
--     ficha y de verificación, series, sede, almacén, empresa y tipo de cambio.
--   · Las 14 etapas de fabricación con sus días, que salieron del OneDrive.
--   · El `audit_log`: es la evidencia de lo que se hizo, incluido este borrado.
--
-- Se va: todo lo operativo. Y las nueve etapas viejas (orden 101+) que quedaron
-- de un diseño anterior y ya no las usa nadie.
--
-- Idempotente: correrla dos veces borra lo mismo —nada la segunda vez—.

do $$
declare
  guardas text[][] := array[
    ['kardex', 'trg_kardex_inmutable'],
    ['ot_bitacora', 'trg_bitacora_inmutable'],
    ['movimiento_detalle', 'trg_mov_detalle_editable'],
    ['parte_detalle', 'trg_parte_detalle_guardia'],
    ['requerimiento_detalle', 'trg_req_detalle_editable']
  ];
  g text[];
begin
  -- Las guardas de inmutabilidad existen para que nadie borre un kardex ni una
  -- bitácora en producción, y está bien que existan. Acá se apagan lo justo y se
  -- vuelven a encender antes de terminar: si algo falla en medio, la transacción
  -- se deshace entera y quedan encendidas igual.
  foreach g slice 1 in array guardas loop
    if exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = g[1] and t.tgname = g[2]
    ) then
      execute format('alter table public.%I disable trigger %I', g[1], g[2]);
    end if;
  end loop;

  -- El taller: primero los hijos, para que los recálculos encuentren su padre.
  delete from public.parte_detalle;
  delete from public.partes_diarios;

  delete from public.requerimiento_detalle;
  delete from public.requerimientos;

  delete from public.kardex;
  delete from public.movimiento_detalle;
  delete from public.movimientos_almacen;
  delete from public.almacen_stock;
  delete from public.lotes_material;

  delete from public.documento_versiones;
  delete from public.documentos;

  delete from public.liberaciones_tesoreria;
  delete from public.aprobaciones;

  delete from public.ot_inspeccion_items;
  delete from public.ot_inspecciones;
  delete from public.ot_verificaciones;
  delete from public.ot_personal;
  delete from public.ot_entregas;
  delete from public.ot_avances;
  delete from public.ot_tareas;
  delete from public.ot_repuestos;
  delete from public.ot_accesorios;
  delete from public.ot_costos_adicionales;
  delete from public.ot_presupuesto;
  delete from public.ot_etapas;
  delete from public.ot_bitacora;
  delete from public.ordenes_trabajo;

  delete from public.garantia_reclamos;
  delete from public.servicios_terceros;
  delete from public.gastos_indirectos;

  -- El maestro de materiales era genérico —«Plancha LAC», «Alambre MIG»— y sin
  -- codificar. Lo va a escribir la empresa con su propia familia y subfamilia.
  delete from public.materiales;

  -- Las unidades entran con la cotización que las necesita.
  delete from public.unidades;

  -- Etapas de un diseño anterior: nombres sueltos sin días, que competían con
  -- las 14 reales en el mismo desplegable.
  delete from public.etapas_catalogo where orden_secuencia > 100;

  foreach g slice 1 in array guardas loop
    if exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = g[1] and t.tgname = g[2]
    ) then
      execute format('alter table public.%I enable trigger %I', g[1], g[2]);
    end if;
  end loop;
end $$;

-- Los correlativos que gastó la demostración vuelven a cero. ORDEN_COMPRA no:
-- va en 5580 porque es el número real con el que la empresa viene numerando.
update public.series_documentarias
   set correlativo_actual = 0
 where tipo in (
   'INGRESO_ALMACEN', 'SALIDA_ALMACEN', 'PARTE_DIARIO', 'REQUERIMIENTO',
   'ACTA_CONFORMIDAD', 'INSPECCION_CALIDAD', 'DEVOLUCION_ALMACEN',
   'TRANSFERENCIA_ALMACEN', 'AJUSTE_INVENTARIO', 'RECEPCION_COMPRA'
 )
   and correlativo_actual <> 0;
