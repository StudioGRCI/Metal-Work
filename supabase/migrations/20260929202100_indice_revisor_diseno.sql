-- Evita recorrer todas las versiones al modificar o retirar un usuario revisor.
create index if not exists ix_versiones_revision_diseno_por
  on public.ot_plano_versiones (revision_diseno_por)
  where revision_diseno_por is not null;
