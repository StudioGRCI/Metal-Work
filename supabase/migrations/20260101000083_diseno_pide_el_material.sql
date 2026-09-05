-- =============================================================================
-- DISEÑO PIDE EL MATERIAL
-- -----------------------------------------------------------------------------
-- Quien dice qué lleva la unidad es quien la dibuja, y por eso Diseño ya reparte
-- el trabajo del taller: arma la lista de planos con su peso y sus piezas, y
-- Maestranza y Producción reportan contra esa lista (`diseno.planos`, desde la
-- 067). Lo que faltaba era la otra mitad de lo mismo: que Diseño mande también
-- el material al requerimiento, en vez de dictárselo a Producción para que lo
-- pida por él.
--
-- Son tres permisos y no uno, y el tercero es el que evita una pantalla vacía:
--
--   · `requerimientos.crear` — lo que se pidió: armar el requerimiento. Es el
--     mismo permiso que exigen `crearRequerimiento` y las políticas de
--     `requerimientos` y `requerimiento_detalle`, ya cruzado.
--   · `requerimientos.ver`   — sin él, la pantalla del requerimiento que acaba
--     de crear le sale vacía y la lista no la puede abrir.
--   · `almacen.ver`          — `materiales`, `almacenes` y `almacen_stock` lo
--     exigen para leerse. Sin él el formulario de requerimiento carga, no da
--     ningún error y no ofrece ni un material que elegir ni un almacén de
--     dónde sacarlo. Es la falla más cara de este proyecto —la pantalla que no
--     se cae, solo miente— y aquí estaba servida.
--
-- Es lectura de almacén, no escritura: mover, confirmar o inventariar siguen
-- siendo de Almacén (`almacen.movimientos`, `almacen.confirmar`,
-- `almacen.inventario`, `almacen.maestros`), y Diseño no los recibe. Ver el
-- stock antes de pedir es justamente lo que hace que el pedido salga bien.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.permiso
  from public.roles r
  cross join (values
    ('almacen.ver'),
    ('requerimientos.crear'),
    ('requerimientos.ver')
  ) as p(permiso)
 where r.codigo = 'DISENO'
on conflict do nothing;
