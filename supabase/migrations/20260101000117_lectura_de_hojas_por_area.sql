-- La hoja de otra área no debe aparecer por conocer el identificador de OT.
-- Diseño prepara todas las hojas; las jefaturas coordinan todas; el taller
-- consulta la suya. La escritura conserva sus reglas anteriores.
create or replace function public.puede_ver_hoja_de_area(p_area uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.planos')
    or public.tiene_permiso('produccion.cualquier_area')
    or (public.tiene_permiso('produccion.ver') and public.puede_hoja_de_area(p_area));
$$;
revoke all on function public.puede_ver_hoja_de_area(uuid) from public,anon;
grant execute on function public.puede_ver_hoja_de_area(uuid) to authenticated;
drop policy if exists alcance_lectura_hojas on public.ot_actividades;
create policy alcance_lectura_hojas on public.ot_actividades as restrictive for select to authenticated
  using(public.puede_ver_hoja_de_area(area_id));
drop policy if exists alcance_lectura_reportes on public.ot_actividad_avances;
create policy alcance_lectura_reportes on public.ot_actividad_avances as restrictive for select to authenticated
  using(exists(select 1 from public.ot_actividades a where a.id=actividad_id));
drop policy if exists alcance_materiales_tecnicos on public.ot_materiales;
create policy alcance_materiales_tecnicos on public.ot_materiales as restrictive for select to authenticated
  using(public.es_admin() or public.tiene_permiso('diseno.planos')
    or public.tiene_permiso('produccion.cualquier_area')
    or (plano_id is not null and public.puede_ver_plano_tecnico(plano_id)));
