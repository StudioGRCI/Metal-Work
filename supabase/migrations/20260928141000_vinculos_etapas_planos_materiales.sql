-- Diseño necesita un camino único y claro: las etapas de elaboración son de
-- Diseño, Producción, Maestranza o Acabados; un plano nuevo siempre nace en
-- una etapa de Diseño; un material asignado a etapa va al área que la ejecuta.
-- Las filas históricas sin vínculo se conservan para que Diseño las asocie.

create or replace function public.validar_area_etapa_elaboracion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.etapa_catalogo_id is null and not exists (
    select 1 from public.areas a
    where a.id = new.area_id and a.activo and a.codigo in ('DIS', 'PRD', 'MTZ', 'ACB')
  ) then
    raise exception 'Elige Diseño, Producción, Maestranza o Acabados para esta etapa.';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_area_etapa_elaboracion() from public, anon, authenticated;
drop trigger if exists trg_validar_area_etapa_elaboracion on public.ot_etapas;
create trigger trg_validar_area_etapa_elaboracion
  before insert or update of area_id, etapa_catalogo_id on public.ot_etapas
  for each row execute function public.validar_area_etapa_elaboracion();

create or replace function public.validar_vinculo_etapa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_manual boolean; v_area uuid; v_codigo text;
begin
  select plan_etapas_manual into v_manual from public.ordenes_trabajo where id = new.orden_id;
  if tg_table_name = 'ot_planos' and new.etapa_id is null then
    raise exception 'Primero crea y elige una etapa de Diseño para este plano.';
  end if;
  if tg_table_name = 'ot_actividades' and v_manual and new.etapa_id is null then
    raise exception 'Elige la etapa de esta OT antes de registrar el trabajo.';
  end if;
  if new.etapa_id is not null then
    select e.area_id, ar.codigo into v_area, v_codigo
      from public.ot_etapas e left join public.areas ar on ar.id = e.area_id
     where e.id = new.etapa_id and e.orden_id = new.orden_id;
    if not found then raise exception 'La etapa no pertenece a esta OT.'; end if;
    if tg_table_name = 'ot_actividades' then
      if v_area is distinct from new.area_id then
        raise exception 'La actividad debe corresponder al área responsable de la etapa.';
      end if;
    elsif tg_table_name = 'ot_planos' and v_codigo is distinct from 'DIS' then
      raise exception 'Un plano debe vincularse a una etapa del área Diseño.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validar_vinculo_etapa() from public, anon, authenticated;

create or replace function public.validar_area_material_etapa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.etapa_id is not null and not exists (
    select 1 from public.ot_etapas e
    join public.areas a on a.id = e.area_id
    where e.id = new.etapa_id and e.orden_id = new.orden_id
      and a.codigo = new.area_destino
  ) then
    raise exception 'La etapa del material debe pertenecer al área que lo recibirá.';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_area_material_etapa() from public, anon, authenticated;
drop trigger if exists trg_validar_area_material_etapa on public.ot_materiales;
create trigger trg_validar_area_material_etapa
  before insert or update of etapa_id, area_destino on public.ot_materiales
  for each row execute function public.validar_area_material_etapa();
