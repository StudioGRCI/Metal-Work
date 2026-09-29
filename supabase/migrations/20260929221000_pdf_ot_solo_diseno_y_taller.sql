-- El PDF de la OT guía la fabricación: lo consultan Diseño e Ingeniería y
-- Supervisión de Producción, Maestranza y Acabados. Los demás adjuntos siguen
-- el alcance ordinario de la OT; la cotización comercial tiene otro acceso.
create or replace function public.puede_ver_pdf_ot()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1
      from public.usuarios u
      join public.roles r on r.id = u.rol_id
      left join public.areas a on a.id = u.area_id
     where u.id = public.usuario_actual()
       and u.activo
       and (r.codigo in ('DISENO', 'DISENO_COLABORADOR')
            or (r.codigo = 'SUPERVISOR' and a.codigo in ('PRD', 'MTZ', 'ACB')))
  );
$$;
revoke all on function public.puede_ver_pdf_ot() from public, anon;
grant execute on function public.puede_ver_pdf_ot() to authenticated;

drop policy if exists ver_ot_adjuntos on public.ot_adjuntos;
create policy ver_ot_adjuntos on public.ot_adjuntos
  for select to authenticated
  using (public.puede_ver_orden(orden_id)
         and (tipo <> 'ORDEN' or (select public.puede_ver_pdf_ot())));

-- Storage no debe permitir firmar el enlace de un objeto que su fila no deja
-- leer. La comprobación por ruta usa la llave única ya existente.
drop policy if exists mw_leer_adjuntos_ot on storage.objects;
create policy mw_leer_adjuntos_ot on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos-ot'
         and exists (
           select 1 from public.ot_adjuntos a
            where a.ruta_storage = objects.name
              and a.orden_id = public.orden_de_ruta(objects.name)
         ));
