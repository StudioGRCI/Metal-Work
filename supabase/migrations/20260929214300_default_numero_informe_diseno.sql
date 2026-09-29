-- METAL WORK (usnbwnemfqyjjkzdizgv): PostgREST puede omitir el número;
-- el trigger transaccional reemplaza siempre este valor antes del INSERT.
alter table public.diseno_informes alter column numero set default 0;
