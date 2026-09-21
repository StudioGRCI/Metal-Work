-- Una OT entrega una unidad y tiene una sola acta de conformidad.
-- Dos clics o dos responsables no deben crear documentos distintos ni romper
-- el resumen de salida, que consulta el acta con maybeSingle().
-- No se corrigen ni se borran datos: si hay duplicados, la migración se detiene.
-- El índice de UNIQUE garantiza la regla también ante inserciones concurrentes;
-- además cubre la consulta real de estadoDeSalida por orden_id.
do $migracion$
begin
  if exists (select 1 from public.ot_entregas group by orden_id having count(*) > 1) then
    raise exception 'Hay órdenes con más de un acta. Revisarlas antes de aplicar esta migración.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ot_entregas'::regclass
      and conname = 'uq_ot_entregas_orden'
  ) then
    alter table public.ot_entregas
      add constraint uq_ot_entregas_orden unique (orden_id);
  end if;
end;
$migracion$;
