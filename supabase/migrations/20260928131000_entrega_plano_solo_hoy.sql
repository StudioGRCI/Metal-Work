-- La fecha de entrega del plano acredita el día real en que Diseño lo entrega.
-- No se puede anticipar, retroceder ni reescribir después de registrada.
create or replace function public.validar_fecha_entrega_plano()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if tg_op = 'UPDATE' and old.fecha_entrega is not null
     and new.fecha_entrega is distinct from old.fecha_entrega then
    raise exception 'La fecha de entrega del plano ya está registrada y no se puede cambiar.'
      using errcode = 'check_violation';
  end if;

  if new.fecha_entrega is not null
     and (tg_op = 'INSERT' or new.fecha_entrega is distinct from old.fecha_entrega)
     and new.fecha_entrega <> (now() at time zone 'America/Lima')::date then
    raise exception 'El plano solo se puede marcar como entregado hoy.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.validar_fecha_entrega_plano() from public, anon, authenticated;
drop trigger if exists trg_validar_fecha_entrega_plano on public.ot_planos;
create trigger trg_validar_fecha_entrega_plano
  before insert or update of fecha_entrega on public.ot_planos
  for each row execute function public.validar_fecha_entrega_plano();
