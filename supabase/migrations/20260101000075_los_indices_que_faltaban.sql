-- =============================================================================
-- LOS ÍNDICES QUE FALTABAN
-- -----------------------------------------------------------------------------
-- El linter de rendimiento de Supabase encontró 28 llaves foráneas sin índice
-- que las cubra. Hoy la base es chica y no se nota; con un año de órdenes,
-- cada borrado de un usuario o de una orden obliga a recorrer entera la tabla
-- que apunta a ella, y cada «¿qué reportes tiene esta etapa?» también.
--
-- Siete son la misma llave compuesta (etapa_id, orden_id) → ot_etapas en las
-- tablas que cuelgan de una etapa: el índice va sobre las dos columnas y en
-- ese orden, que es como la llave las nombra; un índice solo por orden_id no
-- la cubre.
-- =============================================================================

-- Quién hizo qué en la cotización (tres columnas de usuario).
create index if not exists idx_cotizaciones_costeo_pedido_por on public.cotizaciones(costeo_pedido_por);
create index if not exists idx_cotizaciones_costeo_listo_por  on public.cotizaciones(costeo_listo_por);
create index if not exists idx_cotizaciones_revisada_por      on public.cotizaciones(revisada_por);
create index if not exists idx_cotizaciones_unidad_cliente    on public.cotizaciones(unidad_id, cliente_id);

-- La codificación de almacén.
create index if not exists idx_materiales_cod_familia      on public.materiales(cod_familia);
create index if not exists idx_materiales_cod_material     on public.materiales(cod_material);
create index if not exists idx_materiales_subfamilia       on public.materiales(cod_familia, cod_subfamilia);
create index if not exists idx_materiales_tipo             on public.materiales(cod_subfamilia, cod_tipo);

-- Lo que cuelga de una etapa de la orden.
create index if not exists idx_kardex_etapa_orden              on public.kardex(etapa_id, orden_id);
create index if not exists idx_mov_etapa_orden                 on public.movimientos_almacen(etapa_id, orden_id);
create index if not exists idx_ot_avances_etapa_orden          on public.ot_avances(etapa_id, orden_id);
create index if not exists idx_ot_etapa_reportes_etapa_orden   on public.ot_etapa_reportes(etapa_id, orden_id);
create index if not exists idx_ot_presupuesto_etapa_orden      on public.ot_presupuesto(etapa_id, orden_id);
create index if not exists idx_requerimientos_etapa_orden      on public.requerimientos(etapa_id, orden_id);
create index if not exists idx_ot_piezas_plano_orden           on public.ot_piezas(plano_id, orden_id);

-- Quién firmó, verificó o se hizo cargo.
create index if not exists idx_ot_encargado_produccion         on public.ordenes_trabajo(encargado_produccion_id);
create index if not exists idx_ot_accesorios_verificado_por    on public.ot_accesorios(verificado_por);
create index if not exists idx_ot_entregas_salida_confirmada   on public.ot_entregas(salida_confirmada_por);
create index if not exists idx_ot_etapa_reportes_creado_por    on public.ot_etapa_reportes(creado_por);
create index if not exists idx_ot_etapa_reportes_verificado    on public.ot_etapa_reportes(verificado_por);
create index if not exists idx_ot_planos_creado_por            on public.ot_planos(creado_por);
create index if not exists idx_ot_verificaciones_responsable   on public.ot_verificaciones(responsable_id);
create index if not exists idx_servicios_aprobado_por          on public.servicios_terceros(aprobado_por);
create index if not exists idx_servicios_conformidad_por       on public.servicios_terceros(conformidad_por);

-- Catálogos chicos, pero la llave está y el índice cuesta nada.
create index if not exists idx_roles_permisos_permiso          on public.roles_permisos(permiso_codigo);
create index if not exists idx_series_documentarias_sede       on public.series_documentarias(sede_id);
create index if not exists idx_tipos_documento_area            on public.tipos_documento(area_codigo);
create index if not exists idx_tipos_documento_tipo_sig        on public.tipos_documento(tipo_sig);
