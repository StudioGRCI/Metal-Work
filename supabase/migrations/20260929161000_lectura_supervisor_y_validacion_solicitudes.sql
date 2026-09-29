-- Lectura transversal para la supervisión general, sin permisos de escritura.
insert into public.permisos (codigo, modulo, descripcion)
values ('supervision.general', 'Supervisión', 'Consultar planos y actividades de todas las áreas sin modificarlas')
on conflict (codigo) do nothing;
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'supervision.general' from public.roles where codigo = 'SUPERVISOR_GENERAL'
on conflict do nothing;

create or replace function public.puede_ver_hoja_de_area(p_area uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.planos')
    or public.tiene_permiso('produccion.cualquier_area')
    or public.tiene_permiso('supervision.general')
    or (public.tiene_permiso('produccion.ver') and public.puede_hoja_de_area(p_area));
$$;

create or replace function public.puede_ver_plano_tecnico(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_planos p
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where p.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or public.tiene_permiso('supervision.general')
        or exists (select 1 from public.ot_plano_versiones v where v.plano_id = p.id
          and public.puede_hoja_de_area(v.area_id)
          and (v.estado in ('APROBADO', 'RECIBIDO')
            or public.tiene_permiso('produccion.actividades'))))
  );
$$;

create or replace function public.puede_ver_version_plano(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_plano_versiones v
    join public.ot_planos p on p.id = v.plano_id
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where v.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or public.tiene_permiso('supervision.general')
        or public.tiene_permiso('diseno.subir_pdf')
        or (public.tiene_permiso('produccion.actividades')
          and public.puede_hoja_de_area(v.area_id))
        or (v.estado in ('APROBADO', 'RECIBIDO')
          and public.puede_hoja_de_area(v.area_id)))
  );
$$;

-- La comparación con NULL no debe permitir un pago sin importe.
alter table public.ot_solicitudes_tesoreria drop constraint ck_solicitud_monto;
alter table public.ot_solicitudes_tesoreria add constraint ck_solicitud_monto check (
  (tipo = 'MATERIALES' and monto is not null and monto > 0 and moneda is not null)
  or (tipo = 'SALIDA_OT' and monto is null and moneda is null));
