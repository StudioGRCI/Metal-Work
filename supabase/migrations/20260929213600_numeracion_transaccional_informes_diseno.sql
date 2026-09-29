-- METAL WORK (usnbwnemfqyjjkzdizgv): la secuencia identity deja huecos en rollback.
-- Serializar la numeración dentro de la transacción evita saltos en informes confirmados.
alter table public.diseno_informes alter column numero drop identity if exists;

create or replace function public.numerar_informe_diseno()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(38747, 1001);
  select coalesce(max(i.numero), 0) + 1 into new.numero
    from public.diseno_informes i;
  return new;
end;
$$;
revoke all on function public.numerar_informe_diseno() from public, anon, authenticated;
drop trigger if exists trg_numerar_informe_diseno on public.diseno_informes;
create trigger trg_numerar_informe_diseno before insert on public.diseno_informes
  for each row execute function public.numerar_informe_diseno();

create or replace function public.proteger_informe_diseno()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.numero is distinct from old.numero
     or new.semana_inicio is distinct from old.semana_inicio
     or new.creado_por is distinct from old.creado_por or new.creado_en is distinct from old.creado_en then
    raise exception 'No puedes cambiar el número, la semana ni el autor del informe.' using errcode = 'check_violation';
  end if;
  new.actualizado_por := public.usuario_actual();
  return new;
end;
$$;
revoke all on function public.proteger_informe_diseno() from public, anon, authenticated;
