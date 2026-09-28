-- El índice histórico uq_ot_etapa_orden ya cubre (id, orden_id).
-- Las FK nuevas eligieron ese índice; la copia creada en 330 sobra.
drop index if exists public.uq_ot_etapas_id_orden;

-- Índices de las FK nuevas y de la búsqueda de tareas/planos por etapa.
create index if not exists idx_ot_etapas_area_ponderada
  on public.ot_etapas(area_id) where area_id is not null;
create index if not exists idx_ot_actividades_etapa_orden
  on public.ot_actividades(etapa_id, orden_id) where etapa_id is not null;
create index if not exists idx_ot_planos_etapa_orden
  on public.ot_planos(etapa_id, orden_id) where etapa_id is not null;
drop index if exists public.idx_ot_actividades_etapa;
