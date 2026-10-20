-- Gerencia consulta y aprueba; registrar es de cada puesto.
--
-- Revisando producción con la cuenta de Gerencia aparecieron botones para
-- escribir fuera de su menú: el ingreso, la salida y los conteos del kardex, la
-- OC directa, corregir una compra y mandarla a recojo, el material nuevo del
-- catálogo y el trabajo sin orden. Venían de permisos que se le dieron cuando
-- Gerencia todavía hacía de todo (migraciones 20260101000070 y
-- 20260923223903) y que su lista de permisos ya no reconoce. StudioGRCI decidió
-- el 2026-10-20: «Quitar, menos anular». Gerencia sigue anulando una OT
-- (`ordenes.anular`), y conserva lo que consulta: el kardex y las compras por
-- `almacen.ver` y `compras.ver`, los planos aprobados por
-- `produccion.cualquier_area`, y aprueba los trabajos sin orden con
-- `produccion.aprobar_sin_orden`.
--
-- Lo que deja de ver, porque es trabajo interno de otro puesto: los planos que
-- Diseño todavía no aprueba, el informe semanal de Diseño, las plantillas de la
-- ficha técnica y la gestión de recojos de Logística. Y deja de recibir los
-- avisos que van a quien carga actividades, a Diseño, al almacén y a Logística.

-- Gerencia sube el PDF de la OT cuando aprueba la cotización con su código y
-- su OT (migración 20261016900000): el navegador lo deja en `adjuntos-ot` antes
-- de que la orden exista. La política de subida lo aceptaba por
-- `produccion.actividades`, que se le quita aquí; desde ahora lo acepta por
-- `cotizaciones.revisar`, el permiso con que aprueba. El resto de la política
-- queda igual.
drop policy if exists mw_subir_adjuntos_ot on storage.objects;
create policy mw_subir_adjuntos_ot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos-ot'
              and public.orden_de_ruta(name) is not null
              and public.puede_ver_orden(public.orden_de_ruta(name))
              and (public.es_admin()
                   or public.tiene_permiso('produccion.actividades')
                   or public.tiene_permiso('ordenes.editar')
                   or public.tiene_permiso('ordenes.crear')
                   or public.tiene_permiso('ordenes.abrir_taller')
                   or public.tiene_permiso('cotizaciones.revisar')));

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo = 'GERENTE'
   and rp.permiso_codigo in (
     'almacen.recibir',
     'almacen.despachar',
     'compras.crear',
     'diseno.planos',
     'produccion.actividades'
   );

do $$
begin
  if exists (
    select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
     where r.codigo = 'GERENTE'
       and rp.permiso_codigo in ('almacen.recibir', 'almacen.despachar', 'compras.crear',
                                 'diseno.planos', 'produccion.actividades')
  ) then
    raise exception 'Gerencia quedó con un permiso de registrar que se le quitó.';
  end if;
  if exists (select 1 from public.roles where codigo = 'GERENTE')
     and not exists (
       select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
        where r.codigo = 'GERENTE' and rp.permiso_codigo = 'ordenes.anular'
     ) then
    raise exception 'Gerencia tenía que seguir anulando una OT.';
  end if;
end $$;
