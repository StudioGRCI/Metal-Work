-- =============================================================================
-- SIN EL RÓTULO DE «CATÁLOGO ANTERIOR»
-- -----------------------------------------------------------------------------
-- Al cargar las treinta subfamilias de la casa (migración 046) se les puso
-- «(catálogo anterior)» a los cuatro tipos genéricos que ya estaban en uso, para
-- que no se confundieran con los nuevos. La empresa lo ve en el desplegable de
-- la cotización y no lo quiere: es una explicación interna colada en un campo
-- que el vendedor lee delante del cliente.
--
-- Se les quita el rótulo. Tres de los cuatro siguen referenciados por órdenes de
-- trabajo, así que no se pueden borrar sin dejar mudas esas órdenes:
--
--   BARANDA         → «Carrocería con barandas»   2 órdenes
--   FURGON          → «Furgón»                    1 orden
--   TOLVA_VOLQUETE  → «Tolva para volquete»       1 orden
--
-- PLATAFORMA es el caso aparte: sin el rótulo se llama exactamente igual que
-- PLA, «Plataforma», del catálogo nuevo, y dos opciones idénticas en el mismo
-- desplegable no las distingue nadie. No lo usa ninguna unidad ni ninguna orden,
-- así que se le quita el rótulo igual —por si alguna vez aparece en un
-- histórico— y se saca de la lista de elegibles.
-- =============================================================================

update public.tipos_carroceria
   set nombre = btrim(replace(nombre, '(catálogo anterior)', ''))
 where nombre like '%(catálogo anterior)%';

-- El duplicado exacto no se ofrece: el vendedor elige entre el nombre del
-- catálogo de la casa, no entre dos «Plataforma» iguales.
update public.tipos_carroceria
   set activo = false
 where codigo = 'PLATAFORMA'
   and not exists (select 1 from public.unidades u where u.tipo_carroceria_id = tipos_carroceria.id)
   and not exists (select 1 from public.ordenes_trabajo o where o.tipo_carroceria_id = tipos_carroceria.id);
