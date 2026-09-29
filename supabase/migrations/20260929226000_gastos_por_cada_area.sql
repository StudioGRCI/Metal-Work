-- Las cuentas con área propia registran sus gastos en la misma OT.
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'costos.registrar_gasto' from public.roles
where codigo in ('DISENO','ALMACENERO','COMPRADOR','ADMINISTRACION')
on conflict do nothing;

drop policy if exists crear_ot_gastos_areas on public.ot_gastos_areas;
create policy crear_ot_gastos_areas on public.ot_gastos_areas for insert to authenticated
  with check (public.tiene_permiso('costos.registrar_gasto')
    and public.puede_ver_orden(orden_id)
    and registrado_por = public.usuario_actual()
    and estado = 'PENDIENTE'
    and exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
       where u.id = public.usuario_actual() and u.activo and u.area_id = ot_gastos_areas.area_id
         and a.codigo in ('PRD','MTZ','ACB','DIS','ALM','LOG','ADM')));
