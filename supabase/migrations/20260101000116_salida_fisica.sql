-- Avisar a portería autoriza; no demuestra que el vehículo haya salido.
-- Se conserva una constancia inmutable, sin cambiar el estado administrativo.
create table if not exists public.ot_salidas (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null unique references public.ot_entregas(id),
  registrado_por uuid not null references public.usuarios(id),
  constancia text not null check(length(btrim(constancia)) between 10 and 500),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.ot_salidas enable row level security;
revoke all on public.ot_salidas from public,anon,authenticated;
grant select on public.ot_salidas to authenticated;
drop policy if exists ver_salidas on public.ot_salidas;
create policy ver_salidas on public.ot_salidas for select to authenticated using (
  exists(select 1 from public.ot_entregas e where e.id=entrega_id and public.puede_ver_orden(e.orden_id))
);
select public.activar_timestamps('ot_salidas');
select public.activar_auditoria('ot_salidas');
select public.activar_registro_de_prueba('ot_salidas');

create or replace function public.registrar_salida_fisica(p_entrega uuid,p_constancia text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare
  v_entrega public.ot_entregas%rowtype;
  v_id uuid;
begin
  perform public.exigir_permiso('ordenes.entregar');
  if p_constancia is null or length(btrim(p_constancia)) not between 10 and 500 then
    raise exception 'Describe la salida observada en entre 10 y 500 caracteres.' using errcode='check_violation';
  end if;
  select * into v_entrega from public.ot_entregas where id=p_entrega for update;
  if not found or not public.puede_ver_orden(v_entrega.orden_id) then
    raise exception 'No existe un acta de entrega accesible.' using errcode='insufficient_privilege';
  end if;
  select id into v_id from public.ot_salidas where entrega_id=p_entrega;
  if v_id is not null then return v_id; end if;
  if v_entrega.salida_confirmada_en is null or not exists (
    select 1 from public.liberaciones_tesoreria where orden_id=v_entrega.orden_id
  ) or not v_entrega.conforme then
    raise exception 'Se necesita acta conforme, liberación de tesorería y aviso a portería antes de registrar la salida física.' using errcode='check_violation';
  end if;
  if not exists(select 1 from public.ordenes_trabajo where id=v_entrega.orden_id and estado in ('ENTREGADA','FACTURADA')) then
    raise exception 'La orden no está entregada.' using errcode='check_violation';
  end if;
  insert into public.ot_salidas(entrega_id,registrado_por,constancia)
  values(p_entrega,public.usuario_actual(),btrim(p_constancia)) returning id into v_id;
  perform public.ot_registrar_evento_interna(v_entrega.orden_id,'ENTREGA','Salida física del vehículo registrada',
    jsonb_build_object('salida_id',v_id,'constancia',btrim(p_constancia)),null,public.usuario_actual());
  return v_id;
end;
$$;
revoke all on function public.registrar_salida_fisica(uuid,text) from public,anon;
grant execute on function public.registrar_salida_fisica(uuid,text) to authenticated;
