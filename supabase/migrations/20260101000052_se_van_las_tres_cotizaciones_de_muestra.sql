-- =============================================================================
-- SE VAN LAS TRES COTIZACIONES DE MUESTRA
-- -----------------------------------------------------------------------------
-- La empresa pidió borrar las tres cotizaciones que quedaban del talonario
-- viejo: 3568, 3569 y 3570 de 2026. Son datos de muestra cargados entre el 25 y
-- el 27 de agosto, antes de que el sistema empezara a usarse de verdad, y por
-- eso no aplica la regla de la casa que dice que un documento numerado se anula
-- y no se borra: esa regla protege el archivo de la empresa, y estas no son
-- documentos de la empresa, son ejemplos.
--
-- QUÉ SE LLEVA POR DELANTE, dicho antes de hacerlo:
--
--   · 3569-2026 está en borrador y no tiene nada colgando salvo su propia ficha
--     técnica (23 líneas) y sus 7 accesorios, que se van con ella.
--   · 3570-2026 está aprobada y está vacía: sin partidas, sin ficha, sin orden.
--   · 3568-2026 está aprobada, tiene 3 partidas y —esto es lo que importa— dio
--     origen a la orden de trabajo 2921-2026, que está EN PROCESO al 27,64 %,
--     con 24 horas cargadas y S/ 13 467 de costo real.
--
-- La orden 2921 NO se borra ni se toca: la llave foránea es `on delete set
-- null`, así que conserva su número, su avance, sus horas, su costo y su
-- presupuesto de cabecera (S/ 52 500). Lo único que pierde es el enlace a la
-- cotización de la que nació, y con él el valor de venta que la vista de margen
-- usaba para esa orden. Se comprobó antes que su presupuesto no depende de la
-- cotización: no tiene ninguna línea arrastrada desde partidas (`ot_presupuesto`
-- vacío), así que no queda descuadrada.
--
-- El guardián que impide borrar documentos emitidos se aparta lo justo y vuelve
-- a su sitio en la misma transacción: si algo falla, el rollback lo deja
-- encendido. Se acota por número Y por fecha para que, si mañana existe una
-- 3568-2026 de verdad, esta migración no la toque.
-- =============================================================================

alter table public.cotizaciones disable trigger trg_cotizacion_bloquear_borrado;

delete from public.cotizaciones
 where numero in ('3568-2026', '3569-2026', '3570-2026')
   and creado_en::date between date '2026-08-25' and date '2026-08-27';

alter table public.cotizaciones enable trigger trg_cotizacion_bloquear_borrado;
