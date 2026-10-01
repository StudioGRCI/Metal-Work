-- La ficha de taller —medidas, accesorios, repuestos y pasos de verificación—
-- la completa Administración, no Diseño: lo pidió el jefe de Diseño, a quien le
-- toca verla pero no llenarla. Hasta hoy todas sus escrituras pedían
-- `diseno.planos`; desde aquí piden `ordenes.editar`, que es el permiso con el
-- que Administración ya edita la OT. Diseño la sigue leyendo (`puede_ver_orden`).
--
-- Los vistos buenos de los pasos no cambian de manos: el de Producción lo da
-- Supervisión de Producción y el de Maestranza, Supervisión de Maestranza.
--
-- Las políticas conservan su nombre `ficha_diseno_*`: se cambian con ALTER
-- POLICY porque un DROP no se puede aplicar desde la consola de migraciones.

create or replace function public.guardar_ficha_diseno(p_orden uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare o public.ordenes_trabajo%rowtype; v public.ordenes_trabajo%rowtype;
begin
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  perform public.exigir_permiso('ordenes.editar');
  if not public.puede_ver_orden(p_orden) then raise exception 'No puedes llenar esta ficha.'; end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or exists(
    select 1 from jsonb_object_keys(p_datos) k where k not in
    ('largo_m','ancho_m','alto_m','capacidad_carga','ruedas','tipo_llantas','cantidad_ejes',
     'tipo_suspension','colores','caracteristicas_especiales','correo_contacto','encargado_produccion_id')
  ) then raise exception 'La ficha contiene campos no permitidos.'; end if;
  if pg_column_size(p_datos)>20000 then raise exception 'La ficha es demasiado extensa.'; end if;
  select * into o from public.ordenes_trabajo where id=p_orden for update;
  if not found or o.estado in ('ENTREGADA','FACTURADA','ANULADA') then raise exception 'La OT no existe o está cerrada.'; end if;
  v:=jsonb_populate_record(o,p_datos);
  if v.largo_m<=0 or v.ancho_m<=0 or v.alto_m<=0 or v.cantidad_ejes not between 1 and 8 then
    raise exception 'Revisa las medidas y la cantidad de ejes.'; end if;
  update public.ordenes_trabajo set largo_m=v.largo_m,ancho_m=v.ancho_m,alto_m=v.alto_m,
    capacidad_carga=v.capacidad_carga,ruedas=v.ruedas,tipo_llantas=v.tipo_llantas,cantidad_ejes=v.cantidad_ejes,
    tipo_suspension=v.tipo_suspension,colores=v.colores,caracteristicas_especiales=v.caracteristicas_especiales,
    correo_contacto=v.correo_contacto,encargado_produccion_id=v.encargado_produccion_id where id=p_orden;
  return p_orden;
end $function$;

create or replace function public.fn_guardar_marcas_verificacion()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_rol text;
begin
  select r.codigo into v_rol from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.id = public.usuario_actual() and u.activo;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.ordenes_trabajo
      where id = new.orden_id and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
      raise exception 'No se pueden agregar pasos a una OT cerrada.';
    end if;
    if not (public.es_admin() or public.tiene_permiso('ordenes.editar')) then
      raise exception 'Solo Administración puede crear pasos de verificación.';
    end if;
    if new.avance_1 or new.avance_2 then
      raise exception 'El paso debe crearse sin vistos buenos.';
    end if;
    new.avance_1_en := null; new.avance_2_en := null;
    new.avance_1_por := null; new.avance_2_por := null;
    return new;
  end if;

  if exists (select 1 from public.ordenes_trabajo
    where id = old.orden_id and estado in ('ENTREGADA','FACTURADA','ANULADA')) then
    raise exception 'No se pueden modificar pasos de una OT cerrada.';
  end if;

  if new.orden_id is distinct from old.orden_id
     or new.numero is distinct from old.numero
     or new.descripcion is distinct from old.descripcion
     or new.observaciones is distinct from old.observaciones
     or new.responsable_id is distinct from old.responsable_id then
    if (old.avance_1 or old.avance_2)
       and (new.numero is distinct from old.numero
            or new.descripcion is distinct from old.descripcion) then
      raise exception 'No se puede cambiar un paso que ya tiene un visto bueno.';
    end if;
    if not (public.es_admin() or public.tiene_permiso('ordenes.editar')) then
      raise exception 'Solo Administración puede modificar los datos del paso.';
    end if;
  end if;
  if new.avance_1_en is distinct from old.avance_1_en
     or new.avance_2_en is distinct from old.avance_2_en
     or new.avance_1_por is distinct from old.avance_1_por
     or new.avance_2_por is distinct from old.avance_2_por then
    raise exception 'Las fechas y autores de los vistos buenos los registra el sistema.';
  end if;
  if new.avance_1 is distinct from old.avance_1 then
    if old.avance_1 and old.avance_1_por is null then
      raise exception 'Este visto bueno anterior no tiene autor identificado y no se puede retirar.';
    end if;
    if v_rol is distinct from 'SUPERVISOR' or not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id where u.id = public.usuario_actual() and u.activo and a.codigo = 'PRD') then
      raise exception 'Solo Supervisión de Producción puede marcar su visto bueno.';
    end if;
    new.avance_1_en := case when new.avance_1 then now() else null end;
    new.avance_1_por := case when new.avance_1 then public.usuario_actual() else null end;
  end if;
  if new.avance_2 is distinct from old.avance_2 then
    if old.avance_2 and old.avance_2_por is null then
      raise exception 'Este visto bueno anterior no tiene autor identificado y no se puede retirar.';
    end if;
    if v_rol is distinct from 'SUPERVISOR' or not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id where u.id = public.usuario_actual() and u.activo and a.codigo = 'MTZ') then
      raise exception 'Solo Supervisión de Maestranza puede marcar su visto bueno.';
    end if;
    new.avance_2_en := case when new.avance_2 then now() else null end;
    new.avance_2_por := case when new.avance_2 then public.usuario_actual() else null end;
  end if;
  return new;
end;
$function$;

alter policy ficha_diseno_insert on public.ot_accesorios
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_accesorios.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_update on public.ot_accesorios
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_accesorios.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')))
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_accesorios.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_delete on public.ot_accesorios
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_accesorios.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));

alter policy ficha_diseno_insert on public.ot_repuestos
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_repuestos.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_update on public.ot_repuestos
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_repuestos.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')))
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_repuestos.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_delete on public.ot_repuestos
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_repuestos.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));

alter policy ficha_diseno_insert on public.ot_verificaciones
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_update on public.ot_verificaciones
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')))
  with check ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy ficha_diseno_delete on public.ot_verificaciones
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar')) and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));

-- Las tres políticas propias de los pasos de verificación también pedían a Diseño.
alter policy crear_ot_verificaciones on public.ot_verificaciones
  with check (public.tiene_permiso('ordenes.editar') and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy borrar_ot_verificaciones on public.ot_verificaciones
  using (public.tiene_permiso('ordenes.editar') and public.puede_ver_orden(orden_id)
    and not avance_1 and not avance_2
    and exists (select 1 from public.ordenes_trabajo o where o.id = ot_verificaciones.orden_id and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')));
alter policy editar_ot_verificaciones on public.ot_verificaciones
  using (public.puede_ver_orden(orden_id) and (public.tiene_permiso('ordenes.editar') or exists (
    select 1 from public.usuarios u join public.roles r on r.id = u.rol_id join public.areas a on a.id = u.area_id
     where u.id = public.usuario_actual() and u.activo and r.codigo = 'SUPERVISOR' and a.codigo in ('PRD', 'MTZ'))))
  with check (public.puede_ver_orden(orden_id));
