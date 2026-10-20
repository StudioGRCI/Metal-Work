-- =============================================================================
-- EL ÍNDICE DE LOS PAGOS DE OFICINA
-- -----------------------------------------------------------------------------
-- La llave de `oficina_pagos` hacia `trabajadores` (migración 20261020120000)
-- solo estaba cubierta por un índice parcial (`ix_oficina_pagos_persona`, con
-- `trabajador_id` y `desde`), que la integridad referencial no usa: borrar o
-- cambiar un trabajador recorría la tabla entera. Lo pide el check 190, que
-- fallaba en main.
-- =============================================================================

create index if not exists ix_oficina_pagos_trabajador on public.oficina_pagos (trabajador_id);
