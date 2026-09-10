-- =============================================================================
-- LOS ÍNDICES QUE SOBRABAN
-- -----------------------------------------------------------------------------
-- La migración 075 creó 28 índices porque el tablero de Supabase marcaba 28
-- llaves foráneas «sin índice». Se hizo sin leer lo que el proyecto ya había
-- medido el 2026-08-28 (skill `datos`, «Lo que ya se midió»): ese aviso es una
-- regla de linter, no un hecho de rendimiento —exige que la llave sea prefijo
-- exacto de algún índice—, y ninguna de esas llaves lo necesita: siete ya
-- tienen índice por su primera columna (etapa_id), y el resto son catálogos
-- acotados o columnas de «quién firmó» por las que la aplicación nunca filtra
-- y cuyo padre no se borra en ningún flujo. Cada índice de más cuesta en cada
-- escritura y suma un aviso de «índice sin usar» a los que ya arrastra el
-- proyecto.
--
-- Se retiran los 28. Volver a correr esto deja lo mismo. La regla queda escrita
-- donde hace falta (CLAUDE.md y la skill `datos`): antes de crear un índice por
-- un aviso del tablero, leer la medición.
-- =============================================================================

drop index if exists public.idx_cotizaciones_costeo_pedido_por;
drop index if exists public.idx_cotizaciones_costeo_listo_por;
drop index if exists public.idx_cotizaciones_revisada_por;
drop index if exists public.idx_cotizaciones_unidad_cliente;

drop index if exists public.idx_materiales_cod_familia;
drop index if exists public.idx_materiales_cod_material;
drop index if exists public.idx_materiales_subfamilia;
drop index if exists public.idx_materiales_tipo;

drop index if exists public.idx_kardex_etapa_orden;
drop index if exists public.idx_mov_etapa_orden;
drop index if exists public.idx_ot_avances_etapa_orden;
drop index if exists public.idx_ot_etapa_reportes_etapa_orden;
drop index if exists public.idx_ot_presupuesto_etapa_orden;
drop index if exists public.idx_requerimientos_etapa_orden;
drop index if exists public.idx_ot_piezas_plano_orden;

drop index if exists public.idx_ot_encargado_produccion;
drop index if exists public.idx_ot_accesorios_verificado_por;
drop index if exists public.idx_ot_entregas_salida_confirmada;
drop index if exists public.idx_ot_etapa_reportes_creado_por;
drop index if exists public.idx_ot_etapa_reportes_verificado;
drop index if exists public.idx_ot_planos_creado_por;
drop index if exists public.idx_ot_verificaciones_responsable;
drop index if exists public.idx_servicios_aprobado_por;
drop index if exists public.idx_servicios_conformidad_por;

drop index if exists public.idx_roles_permisos_permiso;
drop index if exists public.idx_series_documentarias_sede;
drop index if exists public.idx_tipos_documento_area;
drop index if exists public.idx_tipos_documento_tipo_sig;
