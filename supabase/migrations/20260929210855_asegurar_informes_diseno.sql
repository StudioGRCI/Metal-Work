-- METAL WORK (usnbwnemfqyjjkzdizgv): índice de FK y autoría inmutable.
create index if not exists ix_diseno_tareas_integrante_orden
  on public.diseno_tareas(integrante_id, orden_id);

create or replace function public.proteger_informe_diseno()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.semana_inicio is distinct from old.semana_inicio
       or new.creado_por is distinct from old.creado_por or new.creado_en is distinct from old.creado_en then
      raise exception 'No puedes cambiar la semana ni el autor del informe.' using errcode = 'check_violation';
    end if;
    new.actualizado_por := public.usuario_actual();
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_informe_diseno() from public, anon, authenticated;
drop trigger if exists trg_proteger_informe_diseno on public.diseno_informes;
create trigger trg_proteger_informe_diseno before update on public.diseno_informes
  for each row execute function public.proteger_informe_diseno();
