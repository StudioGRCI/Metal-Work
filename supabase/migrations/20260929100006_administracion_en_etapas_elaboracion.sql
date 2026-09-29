-- El disparador anterior seguía excluyendo ADM aunque el catálogo y la pantalla lo ofrecieran.
create or replace function public.validar_area_etapa_elaboracion()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.etapa_catalogo_id is null and not exists (
    select 1 from public.areas a
    where a.id = new.area_id and a.activo
      and a.codigo in ('ADM','DIS','PRD','MTZ','ACB')
  ) then
    raise exception 'Elige Administración, Diseño, Producción, Maestranza o Acabados para esta etapa.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_area_etapa_elaboracion() from public, anon, authenticated;
