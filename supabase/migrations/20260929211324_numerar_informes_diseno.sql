-- METAL WORK (usnbwnemfqyjjkzdizgv): numeración visible del informe semanal.
alter table public.diseno_informes
  add column if not exists numero integer generated always as identity;
create unique index if not exists ux_diseno_informes_numero
  on public.diseno_informes(numero);
