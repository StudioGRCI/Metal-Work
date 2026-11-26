-- Almacén confirmó el catálogo que quedó por revisar de su INVENTARIO 2026
-- (respuesta del encargado de Almacén, 26/11/2026): los parecidos son el mismo
-- material, los códigos provisionales -AL- y sus unidades quedan como están y lo
-- que no es del almacén queda fuera. Solo faltaba una unidad: el barniz BARZIN
-- 7000 ULTRA se maneja por «latón» («LATON DE BARNIZ»), que no era una unidad
-- del sistema, y por eso quedó en UND con la unidad pendiente.
-- Idempotente: la unidad entra una vez y el material cambia solo mientras su
-- unidad siga pendiente.

insert into public.unidades_medida (codigo, nombre, magnitud, decimales, factor_conversion, activo)
values ('LATON', 'Latón', 'UNIDAD', 0, 1, true)
on conflict (codigo) do nothing;

update public.materiales m set
  unidad_medida_id = u.id,
  unidad_pendiente = false
from public.unidades_medida u
where u.codigo = 'LATON'
  and m.codigo = 'PQ-AL-00003'
  and m.unidad_pendiente;
