-- Administración atiende el personal y la configuración del sistema.
-- Tesorería necesita un puesto propio para ver los documentos liberados y
-- confirmar que una unidad puede salir, sin usar credenciales de otro puesto.
do $$
begin
  if (select count(*) from public.roles where codigo in ('GERENTE', 'ADMINISTRACION')) <> 2 then
    raise exception 'No se encontraron los roles de Gerencia y Administración';
  end if;

  if (select count(*) from public.permisos where codigo in
      ('usuarios.gestionar', 'configuracion.ver', 'configuracion.editar')) <> 3 then
    raise exception 'Faltan permisos de administración del sistema';
  end if;

  if (select count(*) from public.permisos where codigo in
      ('tesoreria.ver_documentos', 'tesoreria.liberar', 'ordenes.listar', 'ordenes.ver')) <> 4 then
    raise exception 'Faltan permisos de Tesorería';
  end if;
end $$;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
from public.roles r
cross join public.permisos p
where r.codigo = 'ADMINISTRACION'
  and p.codigo in ('usuarios.gestionar', 'configuracion.ver', 'configuracion.editar')
on conflict do nothing;

delete from public.roles_permisos rp
using public.roles r
where rp.rol_id = r.id
  and r.codigo = 'GERENTE'
  and rp.permiso_codigo in ('usuarios.gestionar', 'configuracion.ver', 'configuracion.editar');

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values ('TESORERIA', 'Tesorería', 'Revisa documentos financieros y libera la salida de las unidades', 50, true)
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
from public.roles r
cross join public.permisos p
where r.codigo = 'TESORERIA'
  and p.codigo in ('tesoreria.ver_documentos', 'tesoreria.liberar', 'ordenes.listar', 'ordenes.ver')
on conflict do nothing;
