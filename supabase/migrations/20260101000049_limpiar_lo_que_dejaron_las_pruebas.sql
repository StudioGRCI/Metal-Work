-- =============================================================================
-- LIMPIAR LO QUE DEJARON LAS PRUEBAS
-- -----------------------------------------------------------------------------
-- Probar el circuito con un navegador de verdad —que es la única forma de saber
-- que funciona— dejó ocho cotizaciones y tres órdenes en la base de producción,
-- y con ellas el correlativo en 8 y en 3. La primera cotización real habría
-- salido con el número 0009-2026, que es justo lo que se quiso evitar al
-- reiniciar la numeración en la migración 047.
--
-- Se van solo esas: las del 29/08/2026 con numeración nueva. Las tres viejas
-- (3568, 3569 y 3570) y las órdenes de la 2921 a la 2925 son datos anteriores y
-- no se tocan. El doble filtro —número Y fecha— es a propósito: si algún día se
-- vuelve a correr esta migración sobre una base donde ya existe una 0001-2026
-- de verdad, la fecha no coincide y no la borra.
--
-- El borrado queda en la auditoría, que registra el DELETE con quién y cuándo.
-- Ahí está la explicación que, si no, no la tendría nadie.
-- =============================================================================

-- ---------------------------------------------------------- las órdenes primero
-- Las hijas se van solas por cascada (presupuesto, etapas, bitácora, avances).
-- Si alguna tuviera movimientos de almacén, partes o requerimientos, el `on
-- delete restrict` de esas tablas hace fallar la migración entera antes que
-- dejar la base a medias: son órdenes de prueba recién abiertas y no los tienen,
-- pero si los tuvieran significaría que alguien ya trabajó sobre ellas y no hay
-- que borrarlas.
delete from public.ordenes_trabajo
 where numero in ('0001-2026', '0002-2026', '0003-2026')
   and creado_en::date = date '2026-08-29';

-- ------------------------------------------------------- después las cotizaciones
-- El guardián no deja borrar nada que haya salido de borrador, y así tiene que
-- seguir. Se aparta lo justo para esta limpieza y se vuelve a poner en la misma
-- transacción: si algo falla más abajo, el rollback lo devuelve encendido.
alter table public.cotizaciones disable trigger trg_cotizacion_bloquear_borrado;

delete from public.cotizaciones
 where numero ~ '^000[1-8]-2026$'
   and creado_en::date = date '2026-08-29';

alter table public.cotizaciones enable trigger trg_cotizacion_bloquear_borrado;

-- --------------------------------------------------- y la cuenta vuelve a cero
update public.series_documentarias
   set correlativo_actual = 0
 where tipo::text in ('COTIZACION', 'ORDEN_TRABAJO')
   and correlativo_actual > 0
   -- Solo mientras no quede ningún documento emitido con numeración nueva:
   -- volver a cero con documentos vivos repetiría números, que es peor que el
   -- hueco que se está arreglando.
   -- Los de la numeración nueva empiezan en cero (0001-2026); los del talonario
   -- viejo, en 2 y en 3 (2921-2026, 3568-2026). Por eso alcanza con el primer
   -- dígito para distinguirlos.
   and not exists (select 1 from public.cotizaciones c where c.numero like '0%')
   and not exists (select 1 from public.ordenes_trabajo o where o.numero like '0%');
