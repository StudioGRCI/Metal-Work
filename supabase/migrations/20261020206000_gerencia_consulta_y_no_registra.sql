-- Gerencia consulta y aprueba; registrar es de cada puesto.
--
-- Revisando producción con la cuenta de Gerencia aparecieron botones para
-- escribir fuera de su menú: el ingreso, la salida y los conteos del kardex, la
-- OC directa, corregir una compra y mandarla a recojo, el material nuevo del
-- catálogo y el trabajo sin orden. Venían de permisos que se le dieron cuando
-- Gerencia todavía hacía de todo (migraciones 20260101000070, 20260101000090 y
-- 20260923223903) y que su lista de permisos ya no reconoce. Va también
-- `requerimientos.crear`, de la misma asignación: hoy no le servía (la base
-- pide un área del taller), pero era el último permiso de registrar en compras. StudioGRCI decidió
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

-- Gerencia conserva `produccion.cualquier_area` porque con él ve las hojas, los
-- planos aprobados y los materiales de las tres áreas. Pero ese permiso también
-- dejaba escribir sin cargar actividades: confirmar la recepción de un plano,
-- quitar archivos de una OT y corregir o quitar las fotos de un reporte. Desde
-- aquí esas escrituras piden además `produccion.actividades`. El jefe de
-- producción y el de taller tienen los dos, así que para ellos nada cambia.
alter policy editar_flota_avance_fotos on public.flota_avance_fotos
  using (public.es_admin()
         or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades')))
  with check (public.es_admin()
              or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades')));

alter policy borrar_flota_avance_fotos on public.flota_avance_fotos
  using (public.es_admin()
         or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades')));

alter policy borrar_ot_adjuntos on public.ot_adjuntos
  using (public.es_admin()
         or subido_por = public.usuario_actual()
         or public.tiene_permiso('ordenes.editar')
         or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades')));

alter policy mw_borrar_adjuntos_ot on storage.objects
  using (bucket_id = 'adjuntos-ot'
         and (public.es_admin()
              or owner_id = (auth.uid())::text
              or public.tiene_permiso('ordenes.editar')
              or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades')))
         and not public.archivo_ot_vinculado(name));

alter policy mw_borrar_fotos_avance on storage.objects
  using (bucket_id = 'fotos-avance'
         and (public.es_admin()
              or (public.tiene_permiso('produccion.cualquier_area') and public.tiene_permiso('produccion.actividades'))
              or owner_id = (auth.uid())::text)
         and not exists (select 1 from public.ot_avance_fotos f where f.ruta_storage = objects.name)
         and not exists (select 1 from public.flota_avance_fotos f where f.ruta_storage = objects.name)
         and not exists (select 1 from public.ot_actividad_avances a where a.foto_ruta = objects.name));

-- La recepción de un plano la confirma el responsable del área que carga sus
-- actividades; `cualquier_area` solo ya no basta. Se reescribe desde su
-- definición vigente, cambiando solo esa condición.
do $$
declare
  v_def text := pg_get_functiondef('public.recibir_version_plano(uuid)'::regprocedure);
  v_viejo constant text := 'or not (public.tiene_permiso(''produccion.actividades'') or public.tiene_permiso(''produccion.cualquier_area'')) then';
  v_nuevo constant text := 'or not public.tiene_permiso(''produccion.actividades'') then';
begin
  if position(v_viejo in v_def) > 0 then
    execute replace(v_def, v_viejo, v_nuevo);
  elsif position(v_nuevo in v_def) = 0 then
    raise exception 'recibir_version_plano cambió: revisar a mano quién confirma la recepción.';
  end if;
end $$;

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo = 'GERENTE'
   and rp.permiso_codigo in (
     'almacen.recibir',
     'almacen.despachar',
     'compras.crear',
     'diseno.planos',
     'produccion.actividades',
     'requerimientos.crear'
   );

-- Los avisos que Gerencia todavía no leyó y que llevan a una pantalla que ya no
-- le abre (la gestión de recojos, el catálogo de materiales…) quedan leídos:
-- abrirlos ahora la mandaría a «sin permiso». No se borra ninguno.
update public.notificaciones n
   set leida_en = now()
  from public.usuarios u join public.roles r on r.id = u.rol_id
 where u.id = n.usuario_id
   and r.codigo = 'GERENTE'
   and n.leida_en is null
   and (n.ruta like '/compras/gestion%' or n.ruta like '/materiales%' or n.ruta like '/recojos%'
        or n.ruta like '/diseno/informe-semanal%' or n.ruta like '/avance/trabajos/nueva%'
        or n.ruta like '/carrocerias%');

do $$
begin
  if not exists (select 1 from public.roles where codigo = 'GERENTE') then
    raise exception 'No existe el puesto GERENTE: no hay a quién quitarle los permisos.';
  end if;
  if exists (
    select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
     where r.codigo = 'GERENTE'
       and rp.permiso_codigo in ('almacen.recibir', 'almacen.despachar', 'compras.crear',
                                 'diseno.planos', 'produccion.actividades', 'requerimientos.crear')
  ) then
    raise exception 'Gerencia quedó con un permiso de registrar que se le quitó.';
  end if;
  if not exists (
       select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
        where r.codigo = 'GERENTE' and rp.permiso_codigo = 'ordenes.anular'
     ) then
    raise exception 'Gerencia tenía que seguir anulando una OT.';
  end if;
end $$;
