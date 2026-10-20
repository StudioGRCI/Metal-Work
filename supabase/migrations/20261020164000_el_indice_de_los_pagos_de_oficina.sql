-- =============================================================================
-- EL ÍNDICE DE LOS PAGOS DE OFICINA
-- -----------------------------------------------------------------------------
-- La llave de `oficina_pagos` hacia `trabajadores` (migración 20261020120000)
-- solo estaba cubierta por un índice parcial, que la integridad referencial no
-- usa: borrar o cambiar un trabajador recorría la tabla entera. Criterio (a) de
-- la skill `esquema`: no hay otro índice cuya primera columna sea esta. Lo
-- pide el check 190, que fallaba en main.
-- =============================================================================

create index if not exists ix_oficina_pagos_trabajador on public.oficina_pagos (trabajador_id);
