-- Las nuevas firmas de revisión y recepción tienen FKs sin índice de primera columna.
-- Cubre ambas relaciones (criterio a); no se atribuye una mejora de rendimiento:
-- EXPLAIN pasó de Seq Scan a Index Scan (0.023 vs 0.028 ms en una tabla pequeña).
create index if not exists ix_diseno_informes_revisor on public.diseno_informes(revisado_por);
create index if not exists ix_diseno_informes_receptor on public.diseno_informes(recibido_por);
