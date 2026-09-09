-- =============================================================================
-- LO QUE NO ES DEL CIRCUITO SE VA
-- -----------------------------------------------------------------------------
-- «Quiero que elimines todo lo que no tenga que ver con el proceso que ya hemos
-- presentado: cotización de venta, cotización de trabajo, aprobación de
-- Gerencia y creación de Diseño para el desglose de actividades y materiales,
-- más lo de ahora. Lo demás hay que eliminarlo: el OneDrive es apoyo nada más
-- para algunos formatos; hemos creado cosas que no van a tener uso o no son
-- fáciles de entender, por ejemplo gestión de almacén, servicios, producción.»
--
-- Se van de la base, con sus tablas, vistas, funciones, permisos y políticas:
--
--   · Almacén: stock, kardex, movimientos, requerimientos, compras,
--     recepciones, proveedores y la codificación de cinco segmentos.
--   · Servicios a terceros.
--   · Producción como partes diarios y horas: partes, tareas, cuadrilla.
--   · Costos: presupuesto, gastos indirectos, tarifas, centros de costo.
--   · Calidad: inspecciones.
--   · Documentos: el repositorio versionado y su bucket.
--   · Garantías: reclamos.
--   · Informes.
--
-- Se queda el catálogo de materiales (`materiales`, `categorias_material`,
-- `unidades_medida`) porque el desglose de Diseño elige de ahí, pero sin las
-- columnas de stock, costo y codificación que eran del almacén.
--
-- Lo delicado no es borrar sino **lo que se queda y colgaba de lo que se va**:
-- eso se reescribe PRIMERO, en la sección 1, con el texto vivo de producción
-- —no el de los archivos, que ya llevaban dos reescrituras—. Y como Postgres no
-- registra que una función plpgsql lee una tabla, el orden lo pone esta
-- migración, no `pg_depend`.
--
-- Dos decisiones que van por escrito:
--
--   1. **El operario ve las órdenes como todos.** Su alcance se decidía por la
--      cuadrilla (`ot_personal`) y por sus horas (`parte_detalle`), que se van.
--      Desde aquí, `puede_ver_orden` es `ordenes.ver`, que el operario tiene.
--   2. **Los documentos numerados que se van no son de la empresa.** Las tablas
--      con correlativo (requerimientos, órdenes de compra, órdenes de servicio,
--      partes, inspecciones, reclamos) están vacías o con pruebas anuladas del
--      5 de septiembre; la serie de órdenes de compra estaba en 5580 porque ese
--      era el último número real de la empresa, y queda dicho aquí para que no
--      se pierda.
-- =============================================================================

-- =============================================================================
-- 0. CERROJO: NADA DE LO QUE SE QUEDA PUEDE APUNTAR A LO QUE SE VA
-- -----------------------------------------------------------------------------
-- Un `drop table … cascade` se lleva en silencio la clave foránea de una tabla
-- que se queda. Antes de tocar nada se comprueba que no exista ninguna; si la
-- hay, la migración se detiene y lo dice.
-- =============================================================================
do $$
declare
  v_se_van text[] := array[
    'servicios_terceros', 'garantia_reclamos', 'ot_inspeccion_items', 'ot_inspecciones',
    'documento_accesos', 'documento_versiones', 'documentos', 'tipos_documento', 'tipos_documento_sig',
    'notas', 'parte_detalle', 'partes_diarios', 'ot_tareas', 'ot_personal',
    'ot_presupuesto', 'gastos_indirectos', 'prorrateo_indirectos', 'ot_costos_adicionales',
    'tarifas_mano_obra', 'centros_costo',
    'recepcion_detalle', 'recepciones', 'orden_compra_detalle', 'ordenes_compra',
    'proveedor_materiales', 'proveedores', 'requerimiento_detalle', 'requerimientos',
    'movimiento_detalle', 'movimientos_almacen', 'kardex', 'lotes_material', 'almacen_stock', 'almacenes',
    'codificacion_tipos', 'codificacion_subfamilias', 'codificacion_materiales', 'codificacion_familias'
  ];
  v_ajenas text;
begin
  select string_agg(format('%s.%s → %s', c.relname, con.conname, cf.relname), ', ')
    into v_ajenas
    from pg_constraint con
    join pg_class c  on c.oid = con.conrelid
    join pg_class cf on cf.oid = con.confrelid
   where con.contype = 'f'
     and c.relnamespace = 'public'::regnamespace
     and cf.relname = any (v_se_van)
     and not (c.relname = any (v_se_van))
     -- La única esperada: materiales apunta a la codificación, y esas columnas
     -- se sueltan más abajo antes de borrar las tablas.
     and c.relname <> 'materiales';

  if v_ajenas is not null then
    raise exception 'Hay tablas que se quedan apuntando a tablas que se van: %. Resolverlo antes de borrar.', v_ajenas;
  end if;
end $$;

-- =============================================================================
-- 1. LO QUE SE QUEDA, REESCRITO SIN LO QUE SE VA
-- =============================================================================

-- ---------------------------------------------------- 1.1 quién ve una orden
-- Decisión 1 de la cabecera. `p_orden_id` se conserva en la firma porque lo
-- pasan 24 políticas.
create or replace function public.puede_ver_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.es_admin() or public.tiene_permiso('ordenes.ver');
$$;

comment on function public.puede_ver_orden(uuid) is
  'Decide si el usuario actual puede ver una OT: quien tiene ordenes.ver las ve todas. El alcance por cuadrilla se fue con los partes diarios.';

-- ------------------------------------- 1.2 cerrar una etapa ya no pide calidad
create or replace function public.fn_ot_etapa_antes_update()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_estado_ot public.estado_ot;
  v_numero    text;
begin
  select o.estado, o.numero into v_estado_ot, v_numero
    from public.ordenes_trabajo o where o.id = new.orden_id;

  if v_estado_ot = 'ANULADA' then
    raise exception 'La OT % está anulada: sus etapas ya no se pueden modificar', v_numero
      using errcode = 'check_violation';
  end if;

  if new.estado is distinct from old.estado then
    -- Una etapa terminada solo se reabre para retrabajo; una omitida vuelve a pendiente.
    if old.estado = 'TERMINADA' and new.estado not in ('EN_PROCESO', 'REQUIERE_REVISION') then
      raise exception 'La etapa terminada de la OT % solo puede reabrirse como EN_PROCESO o devolverse como REQUIERE_REVISION', v_numero
        using errcode = 'check_violation';
    end if;
    if old.estado = 'OMITIDA' and new.estado <> 'PENDIENTE' then
      raise exception 'La etapa omitida de la OT % solo puede volver a PENDIENTE', v_numero
        using errcode = 'check_violation';
    end if;

    if new.estado = 'EN_PROCESO' and new.fecha_inicio_real is null then
      new.fecha_inicio_real := now();
    end if;

    if new.estado = 'TERMINADA' then
      new.avance_porcentaje := 100;
      if new.fecha_fin_real is null then
        new.fecha_fin_real := now();
      end if;
    end if;

    if new.estado = 'OMITIDA' then
      new.avance_porcentaje := 0;
    end if;
  end if;

  return new;
end;
$$;

-- ------------------------------- 1.3 las etapas nacen sin repartir presupuesto
create or replace function public.crear_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_creadas integer;
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'No existe la orden de trabajo %', p_orden_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ot_etapas (
    orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion)
  select p_orden_id, ec.id, ec.orden_secuencia, ec.horas_estandar, ec.requiere_inspeccion
    from public.etapas_catalogo ec
   where ec.activo
   order by ec.orden_secuencia
  on conflict (orden_id, etapa_catalogo_id) do nothing;

  get diagnostics v_creadas = row_count;

  if v_creadas > 0 then
    perform public.ot_registrar_evento(
      p_orden_id, 'CREACION',
      format('Se generaron %s etapas de producción para la OT', v_creadas),
      jsonb_build_object('etapas_creadas', v_creadas));
  end if;

  perform public.programar_etapas_ot(p_orden_id);
  perform public.asignar_responsables_ot(p_orden_id);

  return v_creadas;
end;
$$;

revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;

-- ------------------------------------ 1.4 portería la confirma el taller
-- `requerimientos.crear` era la llave alternativa y era de Almacén. Ahora:
-- quien entrega (`ordenes.entregar`) o quien arma el trabajo del taller
-- (`produccion.actividades`: supervisores y jefes). La acción de la pantalla
-- exige exactamente lo mismo.
create or replace function public.confirmar_salida_porteria(p_entrega uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden uuid;
  v_confirmada timestamptz;
begin
  if not (public.es_admin()
          or public.tiene_permiso('ordenes.entregar')
          or public.tiene_permiso('produccion.actividades')) then
    raise exception 'Confirmar la salida es de quien coordina la entrega'
      using errcode = 'insufficient_privilege';
  end if;

  select orden_id, salida_confirmada_en into v_orden, v_confirmada
    from public.ot_entregas where id = p_entrega;

  if v_orden is null then
    raise exception 'El acta de entrega no existe';
  end if;
  if not public.puede_ver_orden(v_orden) then
    raise exception 'La orden no le corresponde' using errcode = 'insufficient_privilege';
  end if;
  if v_confirmada is not null then
    raise exception 'La salida ya estaba confirmada; no se confirma dos veces';
  end if;

  update public.ot_entregas
     set salida_confirmada_por = public.usuario_actual(),
         salida_confirmada_en  = now()
   where id = p_entrega;
end;
$$;

-- --------------------------------- 1.5 la ficha de taller, sin calidad
create or replace function public.armar_ficha_ot(p_orden uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_tipo       uuid;
  v_fuente     uuid;
begin
  if public.usuario_actual() is not null and not (
       public.puede_ver_orden(p_orden)
       and (public.es_admin()
            or public.tiene_permiso('ordenes.editar')
            or public.tiene_permiso('ordenes.aprobar')
            or public.tiene_permiso('ordenes.cambiar_estado')
            or public.tiene_permiso('produccion.registrar'))) then
    raise exception 'No puede armar la ficha de una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  select cotizacion_id, tipo_carroceria_id into v_cotizacion, v_tipo
    from public.ordenes_trabajo where id = p_orden;

  if v_cotizacion is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.cotizacion_accesorios a
     where a.cotizacion_id = v_cotizacion;
  end if;

  if not exists (select 1 from public.ot_verificaciones where orden_id = p_orden) then
    if v_tipo is not null
       and exists (select 1 from public.plantillas_verificacion where tipo_carroceria_id = v_tipo) then
      v_fuente := v_tipo;
    end if;

    insert into public.ot_verificaciones (orden_id, numero, descripcion)
    select p_orden, v.numero, v.descripcion
      from public.plantillas_verificacion v
     where v.tipo_carroceria_id is not distinct from v_fuente;
  end if;
end;
$$;

-- ------------------------------ 1.6 la trazabilidad, solo bitácora y auditoría
create or replace view public.v_ot_timeline as
select b.orden_id,
       b.creado_en                               as ocurrido_en,
       'BITACORA'::text                          as categoria,
       replace(b.tipo_evento::text, '_', ' ')    as titulo,
       b.descripcion                             as detalle,
       b.usuario_id,
       'ot_bitacora'::text                       as referencia_tabla,
       b.id                                      as referencia_id,
       b.id::text                                as referencia_clave,
       b.datos
  from public.ot_bitacora b
union all
select l.registro_id                             as orden_id,
       l.creado_en                               as ocurrido_en,
       'AUDITORIA'::text                         as categoria,
       case l.accion
         when 'INSERT'::public.accion_auditoria then 'Orden registrada'
         when 'UPDATE'::public.accion_auditoria then 'Modificación de la orden'
         else 'Orden eliminada'
       end                                       as titulo,
       case when l.campos_modificados is not null
            then 'Campos: ' || array_to_string(l.campos_modificados, ', ')
            else null end                        as detalle,
       l.usuario_id,
       'audit_log'::text                         as referencia_tabla,
       null::uuid                                as referencia_id,
       l.id::text                                as referencia_clave,
       jsonb_strip_nulls(jsonb_build_object('accion', l.accion, 'campos', to_jsonb(l.campos_modificados))) as datos
  from public.audit_log l
 where l.tabla = 'ordenes_trabajo' and l.registro_id is not null;

comment on view public.v_ot_timeline is
  'La línea de tiempo de una orden: su bitácora y los cambios auditados sobre la orden misma.';

alter view public.v_ot_timeline set (security_invoker = on);
grant select on public.v_ot_timeline to authenticated;

-- ----------------------- 1.7 el tablero de etapas sin inspección ni cuadrilla
-- `create or replace` no quita columnas: se recrea.
drop view if exists public.ot_tablero_etapas;
create view public.ot_tablero_etapas as
select e.id                        as etapa_id,
       e.orden_id,
       o.numero                    as ot_numero,
       o.estado                    as ot_estado,
       o.prioridad,
       o.sede_id,
       c.razon_social              as cliente,
       u.placa,
       ec.codigo                   as etapa_codigo,
       ec.nombre                   as etapa,
       ec.permite_paralelo,
       e.orden_secuencia,
       e.estado,
       e.avance_porcentaje,
       e.horas_estimadas,
       e.fecha_inicio_programada,
       e.fecha_fin_programada,
       e.fecha_inicio_real,
       e.fecha_fin_real,
       e.responsable_id
  from public.ot_etapas e
  join public.ordenes_trabajo o  on o.id = e.orden_id
  join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
  left join public.clientes c    on c.id = o.cliente_id
  left join public.unidades u    on u.id = o.unidad_id
 where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA');

comment on view public.ot_tablero_etapas is
  'Las etapas de las órdenes vivas, una fila por etapa, para el tablero y la pestaña Etapas.';

alter view public.ot_tablero_etapas set (security_invoker = on);
grant select on public.ot_tablero_etapas to authenticated;

-- ----------------------------- 1.8 las fechas clave sin órdenes de servicio
-- Se conserva la columna `primera_os` en su sitio, en nulo, porque `create or
-- replace` no puede quitarla y nada la lee ya.
create or replace view public.ot_fechas_clave as
select o.id                                                          as orden_id,
       o.numero,
       o.fecha_registro,
       public.sumar_dias_habiles(o.fecha_registro, 3)                 as limite_os_produccion,
       public.sumar_dias_habiles(o.fecha_registro, 4)                 as limite_diseno,
       (select public.restar_dias_habiles(e.fecha_inicio_programada, 1)
          from public.ot_etapas e
          join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
         where e.orden_id = o.id and ec.codigo = 'ARENADO'
         limit 1)                                                    as limite_os_acabados,
       public.sumar_dias_habiles(coalesce(o.fecha_fin_real::date, o.fecha_fin_programada), 2)  as limite_certificados,
       public.sumar_dias_habiles(coalesce(o.fecha_fin_real::date, o.fecha_fin_programada), 15) as limite_tarjeta_placas,
       null::date                                                    as primera_os,
       (select min(e.fecha_entrega) from public.ot_entregas e where e.orden_id = o.id) as fecha_entrega
  from public.ordenes_trabajo o
 where o.estado <> 'ANULADA';

alter view public.ot_fechas_clave set (security_invoker = on);
grant select on public.ot_fechas_clave to authenticated;

-- ------------------------------- 1.9 los plazos por área sin presupuesto
-- `v_plazos_resumen` cuelga de esta vista, así que no se recrea: las dos
-- columnas del presupuesto quedan en cero hasta que se pueda quitarlas.
create or replace view public.v_plazos_por_area as
select oe.id                                          as etapa_id,
       oe.orden_id,
       o.numero                                       as orden_numero,
       a.id                                           as area_id,
       a.codigo                                       as area_codigo,
       a.nombre                                       as area_nombre,
       a.encargado                                    as area_encargado,
       ec.nombre                                      as etapa_nombre,
       ec.orden_secuencia,
       coalesce(o.descripcion, ec.nombre)             as unidad,
       c.razon_social                                 as cliente,
       u.codigo_interno,
       u.placa,
       oe.fecha_inicio_programada,
       oe.fecha_fin_programada,
       oe.fecha_fin_real,
       oe.estado,
       oe.avance_porcentaje,
       oe.responsable_id,
       oe.fecha_fin_programada - current_date         as dias,
       public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
       0::bigint                                      as material_lineas,
       0::numeric                                     as material_monto,
       r.id                                           as ultimo_reporte_id,
       r.texto                                        as ultimo_reporte,
       r.creado_en                                    as ultimo_reporte_en,
       r.verificado_en                                as ultimo_reporte_verificado_en
  from public.ot_etapas oe
  join public.ordenes_trabajo o  on o.id = oe.orden_id
  join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
  left join public.areas a       on a.id = ec.area_id
  left join public.clientes c    on c.id = o.cliente_id
  left join public.unidades u    on u.id = o.unidad_id
  left join lateral (
    select rr.id, rr.texto, rr.creado_en, rr.verificado_en
      from public.ot_etapa_reportes rr
     where rr.etapa_id = oe.id
     order by rr.creado_en desc
     limit 1
  ) r on true
 where o.estado not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')
   and oe.estado <> 'OMITIDA';

alter view public.v_plazos_por_area set (security_invoker = on);
grant select on public.v_plazos_por_area to authenticated;

-- ------------------------------------- 1.10 la lista de Diseño sin pedidos
drop view if exists public.v_ot_materiales;
create view public.v_ot_materiales as
select m.id,
       m.orden_id,
       m.plano_id,
       p.numero_plano,
       p.nombre                  as plano_nombre,
       m.etapa_id,
       ec.nombre                 as etapa,
       a.nombre                  as area,
       m.material_id,
       mat.codigo                as material_codigo,
       mat.descripcion           as material,
       mat.especificacion_tecnica,
       um.codigo                 as unidad,
       m.cantidad,
       m.observacion,
       m.creado_por,
       m.creado_en
  from public.ot_materiales m
  join public.materiales mat          on mat.id = m.material_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  left join public.ot_planos p        on p.id = m.plano_id
  left join public.ot_etapas e        on e.id = m.etapa_id
  left join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
  left join public.areas a            on a.id = ec.area_id;

comment on view public.v_ot_materiales is
  'La lista de materiales que Diseño escribió para la orden, con su plano, su etapa y su unidad. Sin pedidos ni stock: el almacén se fue.';

alter view public.v_ot_materiales set (security_invoker = on);
grant select on public.v_ot_materiales to authenticated;

-- ---------------------------- 1.11 el catálogo de materiales es de Diseño
-- Leerlo puede cualquiera con sesión, como los demás catálogos; escribirlo,
-- Diseño (`diseno.planos`), que es exactamente lo que exige la pantalla.
drop policy if exists ver_materiales    on public.materiales;
drop policy if exists crear_materiales  on public.materiales;
drop policy if exists editar_materiales on public.materiales;
drop policy if exists borrar_materiales on public.materiales;

create policy ver_materiales on public.materiales
  for select to authenticated
  using (public.es_usuario_activo());

create policy crear_materiales on public.materiales
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

create policy editar_materiales on public.materiales
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'))
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

create policy borrar_materiales on public.materiales
  for delete to authenticated
  using (public.es_admin());

comment on table public.materiales is
  'El catálogo chico de Diseño: lo que se elige al desglosar qué lleva una unidad. Nombre, unidad y especificación; sin stock ni costo.';

-- ------------------------------ 1.11b la ficha de taller, sin la mano de calidad
-- Las tres políticas de «corregir» aceptaban `calidad.inspeccionar`. Con el
-- permiso retirado, `tiene_permiso` devolvería falso sin error y la política
-- quedaría mintiendo; se reescriben con exactamente lo que exige la pantalla:
-- `ordenes.editar` o `produccion.registrar`, sobre una orden que se ve.
drop policy if exists editar_ot_accesorios on public.ot_accesorios;
create policy editar_ot_accesorios on public.ot_accesorios
  for update to authenticated
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar') or public.tiene_permiso('produccion.registrar'))
         and public.puede_ver_orden(orden_id))
  with check (public.puede_ver_orden(orden_id));

drop policy if exists editar_ot_repuestos on public.ot_repuestos;
create policy editar_ot_repuestos on public.ot_repuestos
  for update to authenticated
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar') or public.tiene_permiso('produccion.registrar'))
         and public.puede_ver_orden(orden_id))
  with check (public.puede_ver_orden(orden_id));

drop policy if exists editar_ot_verificaciones on public.ot_verificaciones;
create policy editar_ot_verificaciones on public.ot_verificaciones
  for update to authenticated
  using ((public.es_admin() or public.tiene_permiso('ordenes.editar') or public.tiene_permiso('produccion.registrar'))
         and public.puede_ver_orden(orden_id))
  with check (public.puede_ver_orden(orden_id));

-- ------------------------------- 1.12 Storage: queda el bucket de fotos
-- Las políticas cubrían dos buckets con permisos de documentos; ahora solo
-- fotos-avance, con los permisos de producción que exige la pantalla.
do $$
declare v_dueno text;
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects no existe: se omiten las políticas de Storage';
    return;
  end if;

  -- Supabase guarda quién subió el archivo en `owner_id` (texto); la copia
  -- local del esquema solo tiene `owner` (uuid). Se usa la que haya.
  select case
           when exists (select 1 from information_schema.columns
                         where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id')
           then 'owner_id = auth.uid()::text'
           else 'owner = auth.uid()'
         end
    into v_dueno;

  execute 'drop policy if exists mw_leer_documentos on storage.objects';
  execute 'drop policy if exists mw_subir_documentos on storage.objects';
  execute 'drop policy if exists mw_borrar_documentos on storage.objects';
  execute 'drop policy if exists mw_leer_fotos_avance on storage.objects';
  execute 'drop policy if exists mw_subir_fotos_avance on storage.objects';
  execute 'drop policy if exists mw_borrar_fotos_avance on storage.objects';

  execute $pol$
    create policy mw_leer_fotos_avance on storage.objects
      for select to authenticated
      using (
        bucket_id = 'fotos-avance'
        and (public.es_admin() or public.tiene_permiso('produccion.ver'))
        and (public.orden_de_ruta(name) is null or public.puede_ver_orden(public.orden_de_ruta(name)))
      );
  $pol$;

  execute $pol$
    create policy mw_subir_fotos_avance on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'fotos-avance'
        and (public.es_admin() or public.tiene_permiso('produccion.registrar'))
      );
  $pol$;

  -- Quitar una foto: el jefe (cualquier área) o quien la acaba de subir, que
  -- es lo que hace el «Quitar» del selector antes de registrar el reporte.
  execute format($pol$
    create policy mw_borrar_fotos_avance on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'fotos-avance'
        and (public.es_admin() or public.tiene_permiso('produccion.cualquier_area') or %s)
      );
  $pol$, v_dueno);

  -- El repositorio documental se va. Su bucket no se puede borrar por SQL:
  -- Supabase protege storage.objects y storage.buckets con un trigger
  -- (protect_delete) que solo deja borrar por la API de Storage. Se queda sin
  -- políticas —nadie lee ni escribe en él— y se retira desde el panel.
  -- Se comprobó vacío el 2026-09-09; si alguien lo llenó desde entonces, se dice.
  if exists (select 1 from storage.objects where bucket_id = 'documentos') then
    raise warning 'El bucket documentos tiene archivos: revisarlos antes de retirarlo desde el panel de Storage';
  elsif exists (select 1 from storage.buckets where id = 'documentos') then
    raise notice 'El bucket documentos queda vacío y sin políticas: retirarlo desde el panel de Storage';
  end if;
end $$;

-- =============================================================================
-- 2. LOS DISPARADORES QUE LO QUE SE VA HABÍA COLGADO DE LO QUE SE QUEDA
-- =============================================================================
drop trigger if exists trg_ot_exigir_documentos on public.ordenes_trabajo;
drop function if exists public.fn_ot_exigir_documentos();

drop trigger if exists trg_entrega_garantia_cotizada on public.ot_entregas;
drop function if exists public.fn_entrega_garantia_cotizada();

drop trigger if exists trg_materiales_codigo_protegido on public.materiales;
drop function if exists public.fn_materiales_codigo_protegido();

-- =============================================================================
-- 3. LAS VISTAS QUE SE VAN
-- -----------------------------------------------------------------------------
-- Con las de la sección 1 ya reescritas, ninguna vista que se queda cuelga de
-- estas: el cascade solo alcanza a las de la misma lista.
-- =============================================================================
do $$
declare v text;
begin
  foreach v in array array[
    'v_ot_margen', 'v_ot_costo_por_tipo', 'v_ot_costo_total', 'v_ot_costo_servicios',
    'v_ot_costo_indirecto', 'v_ot_costo_adicional', 'v_ot_costo_mano_obra',
    'v_ot_mano_obra_especialidad', 'v_ot_mano_obra_detalle', 'v_ot_costo_materiales',
    'v_material_por_area', 'ot_horas_aprobadas', 'os_resumen', 'garantias_resumen',
    'v_documentos_vigentes', 'v_ot_documentos_faltantes', 'v_stock_actual',
    'v_materiales_por_ot', 'v_trazabilidad_lotes', 'v_ordenes_compra_pendientes'
  ] loop
    execute format('drop view if exists public.%I cascade', v);
  end loop;
end $$;

-- =============================================================================
-- 4. LAS FUNCIONES QUE DEVUELVEN FILAS DE TABLAS QUE SE VAN
-- -----------------------------------------------------------------------------
-- Van antes que sus tablas: `drop table` sin cascade se niega mientras existan.
-- =============================================================================
drop function if exists public.tarifa_vigente(public.rol_operario, date);
drop function if exists public.prorratear_indirectos(date);

-- =============================================================================
-- 5. LAS COLUMNAS DE ALMACÉN DEL CATÁLOGO DE MATERIALES
-- El código de almacén es una columna generada a partir de los cinco segmentos:
-- se suelta primero, sola, porque Postgres se niega a quitar un segmento
-- mientras ella exista. Sus índices y checks caen con cada columna.
-- =============================================================================
alter table public.materiales drop column if exists codigo_almacen;

alter table public.materiales
  drop column if exists cod_familia,
  drop column if exists cod_subfamilia,
  drop column if exists cod_material,
  drop column if exists cod_tipo,
  drop column if exists cod_correlativo,
  drop column if exists criticidad,
  drop column if exists ubicacion,
  drop column if exists costo_reposicion,
  drop column if exists controla_serie,
  drop column if exists controla_caducidad,
  drop column if exists costo_promedio,
  drop column if exists ultimo_costo,
  drop column if exists fecha_ultimo_costo,
  drop column if exists stock_minimo,
  drop column if exists stock_maximo,
  drop column if exists punto_reposicion,
  drop column if exists es_critico,
  drop column if exists controla_lote,
  drop column if exists es_inventariable,
  drop column if exists codigo_barras;

-- =============================================================================
-- 6. LAS TABLAS QUE SE VAN
-- -----------------------------------------------------------------------------
-- En orden de hijos a padres. El cascade se lleva políticas, índices,
-- disparadores y claves entre ellas; el cerrojo de la sección 0 garantiza que
-- no alcanza a nada que se queda.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'servicios_terceros',
    'garantia_reclamos',
    'ot_inspeccion_items', 'ot_inspecciones',
    'documento_accesos', 'documento_versiones', 'documentos', 'tipos_documento', 'tipos_documento_sig',
    'notas',
    'parte_detalle', 'partes_diarios', 'ot_tareas', 'ot_personal',
    'ot_presupuesto', 'gastos_indirectos', 'prorrateo_indirectos', 'ot_costos_adicionales',
    'tarifas_mano_obra', 'centros_costo',
    'recepcion_detalle', 'recepciones', 'orden_compra_detalle', 'ordenes_compra',
    'proveedor_materiales', 'proveedores',
    'requerimiento_detalle', 'requerimientos',
    'movimiento_detalle', 'movimientos_almacen', 'kardex', 'lotes_material', 'almacen_stock', 'almacenes',
    'codificacion_tipos', 'codificacion_subfamilias', 'codificacion_materiales', 'codificacion_familias'
  ] loop
    execute format('drop table if exists public.%I cascade', t);
  end loop;
end $$;

-- =============================================================================
-- 7. LAS FUNCIONES QUE SE VAN
-- -----------------------------------------------------------------------------
-- Por nombre, con todas sus sobrecargas: un `drop function if exists f(args)`
-- con los argumentos mal escritos «salta» sin avisar y deja la función viva.
-- =============================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'informe_produccion', 'informe_cumplimiento', 'informe_rentabilidad', 'informe_comercial',
         'informe_consumo_materiales', 'informe_subcontratos', 'informe_resumen',
         'generar_presupuesto_desde_cotizacion', 'repartir_presupuesto_a_areas',
         'tipo_cambio_costo', 'costos_validar_orden',
         'fn_presupuesto_antes', 'fn_servicio_tercero_antes', 'fn_costo_adicional_antes', 'fn_gasto_indirecto_antes',
         'dar_conformidad_servicio', 'fn_os_numero', 'fn_os_transicion', 'fn_os_entrega',
         'documentos_obligatorios_faltantes', 'registrar_acceso_documento', 'registrar_acceso_documento_interna',
         'fn_documento_antes', 'fn_tipo_documento_normalizar', 'fn_version_antes_insert',
         'fn_version_despues_insert', 'fn_version_inmutable', 'fn_entidad_polimorfica', 'fn_nota_antes',
         'fn_reclamo_antes_insert', 'fn_reclamo_antes_update',
         'fn_inspeccion_antes_insert', 'fn_inspeccion_despues_insert',
         'fn_parte_antes_insert', 'fn_parte_antes_update', 'fn_parte_aplicar_horas', 'fn_parte_detalle_guardia',
         'parte_recalcular_totales', 'fn_parte_detalle_totales', 'fn_parte_permiso_por_estado',
         'mandar_material_a_requerimiento',
         'confirmar_movimiento_almacen', 'confirmar_movimiento_almacen_interna',
         'anular_movimiento_almacen', 'anular_movimiento_almacen_interna',
         'aprobar_requerimiento', 'aprobar_requerimiento_interna',
         'confirmar_recepcion', 'confirmar_recepcion_interna',
         'kardex_registrar', 'actualizar_estado_requerimiento', 'asignar_codigo_almacen', 'resumen_almacen',
         'fn_movimiento_numerar', 'fn_requerimiento_numerar', 'fn_orden_compra_numerar', 'fn_recepcion_numerar',
         'fn_kardex_inmutable', 'fn_kardex_no_truncate', 'fn_movimiento_detalle_editable', 'fn_movimiento_transicion',
         'fn_requerimiento_detalle_editable', 'fn_requerimiento_transicion', 'fn_requerimiento_liberar_reserva',
         'fn_oc_totales', 'fn_oc_recalcular', 'fn_oc_detalle_editable', 'fn_oc_transicion',
         'fn_recepcion_detalle_editable', 'fn_recepcion_transicion', 'fn_recepcion_valida_oc'
       )
  loop
    execute format('drop function if exists %s cascade', f.firma);
  end loop;
end $$;

-- Una columna de costeo sobre una tabla que se queda, sin ningún lector, y la
-- extensión que solo sostenía el «sin solape» de las tarifas.
alter table public.empresa drop column if exists costo_indirecto_hora;

do $$
begin
  drop extension if exists btree_gist;
exception when others then
  raise notice 'btree_gist se queda: todavía la usa algo (%)', sqlerrm;
end $$;

-- =============================================================================
-- 8. LOS TIPOS QUE SE VAN
-- -----------------------------------------------------------------------------
-- Sin cascade a propósito: si alguno siguiera en uso por algo que se queda,
-- Postgres se niega y la migración se detiene, que es lo que se quiere.
-- Los valores sueltos de `tipo_correlativo` (REQUERIMIENTO, ORDEN_COMPRA,
-- PARTE_DIARIO…) se quedan: Postgres no quita valores de un enum.
-- =============================================================================
do $$
declare e text;
begin
  foreach e in array array[
    'tipo_costo', 'tipo_centro_costo', 'categoria_gasto_indirecto', 'origen_presupuesto',
    'tipo_servicio_tercero', 'estado_servicio_tercero', 'resultado_inspeccion',
    'categoria_documento', 'estado_documento', 'tipo_acceso_documento',
    'estado_parte_diario', 'estado_tarea_ot', 'rol_operario',
    'tipo_almacen', 'tipo_movimiento_kardex', 'tipo_movimiento_almacen', 'estado_movimiento_almacen',
    'estado_requerimiento', 'estado_orden_compra', 'condicion_pago'
  ] loop
    execute format('drop type if exists public.%I', e);
  end loop;
end $$;

-- =============================================================================
-- 9. LAS SERIES DE LOS DOCUMENTOS QUE YA NO SE EMITEN
-- -----------------------------------------------------------------------------
-- Ninguna con documentos vivos detrás. La de órdenes de compra estaba en 5580,
-- el último número real de la empresa: queda escrito aquí.
-- =============================================================================
delete from public.series_documentarias
 where tipo in ('REQUERIMIENTO', 'ORDEN_COMPRA', 'INGRESO_ALMACEN', 'SALIDA_ALMACEN',
                'DEVOLUCION_ALMACEN', 'AJUSTE_INVENTARIO', 'TRANSFERENCIA_ALMACEN',
                'RECEPCION_COMPRA', 'ORDEN_SERVICIO', 'INSPECCION_CALIDAD', 'PARTE_DIARIO');

-- =============================================================================
-- 10. LOS PERMISOS QUE YA NO EXIGE NADIE
-- -----------------------------------------------------------------------------
-- Primero sus filas en roles_permisos, por si la clave foránea no fuera en
-- cascada; después el catálogo. Los roles se quedan todos: es decisión del
-- cliente, y las cuentas de almacén, compras, calidad y costos están inactivas.
-- =============================================================================
delete from public.roles_permisos
 where permiso_codigo in (
   'almacen.ver', 'almacen.movimientos', 'almacen.confirmar', 'almacen.inventario', 'almacen.maestros',
   'requerimientos.ver', 'requerimientos.crear', 'requerimientos.aprobar',
   'compras.ver', 'compras.crear', 'compras.aprobar', 'compras.recibir',
   'costos.ver', 'costos.editar', 'costos.cerrar',
   'calidad.ver', 'calidad.inspeccionar',
   'documentos.ver', 'documentos.subir', 'documentos.eliminar',
   'garantias.ver', 'garantias.gestionar',
   'reportes.ver', 'produccion.aprobar_parte');

delete from public.permisos
 where codigo in (
   'almacen.ver', 'almacen.movimientos', 'almacen.confirmar', 'almacen.inventario', 'almacen.maestros',
   'requerimientos.ver', 'requerimientos.crear', 'requerimientos.aprobar',
   'compras.ver', 'compras.crear', 'compras.aprobar', 'compras.recibir',
   'costos.ver', 'costos.editar', 'costos.cerrar',
   'calidad.ver', 'calidad.inspeccionar',
   'documentos.ver', 'documentos.subir', 'documentos.eliminar',
   'garantias.ver', 'garantias.gestionar',
   'reportes.ver', 'produccion.aprobar_parte');

-- Los que se quedan ya no hablan de partes ni de horas.
update public.permisos set descripcion = 'Programar las fechas de las etapas de una orden'
 where codigo = 'produccion.planificar';
update public.permisos set descripcion = 'Reportar el avance del día: etapas, actividades, unidades sin orden y sus fotos'
 where codigo = 'produccion.registrar';
update public.permisos set descripcion = 'Ver etapas, avances y el día en el taller'
 where codigo = 'produccion.ver';

comment on column public.usuarios.es_operario is
  'Si la persona trabaja en el taller con las manos. Ya no acota qué órdenes ve: eso lo decide ordenes.ver.';
comment on column public.usuarios.costo_hora is
  'Costo por hora de la persona. Sin lector en la base desde que se fue el costeo; se conserva como dato de personal.';

-- =============================================================================
-- 11. COMPROBACIONES
-- =============================================================================

-- Nada de lo borrado sigue existiendo.
do $$
declare v_vivas text;
begin
  select string_agg(t, ', ') into v_vivas
    from unnest(array['partes_diarios', 'parte_detalle', 'ot_personal', 'kardex', 'movimientos_almacen',
                      'requerimientos', 'ordenes_compra', 'proveedores', 'servicios_terceros',
                      'ot_inspecciones', 'documentos', 'garantia_reclamos', 'ot_presupuesto',
                      'gastos_indirectos', 'tarifas_mano_obra', 'centros_costo', 'almacenes',
                      'codificacion_familias', 'notas']) as t
   where to_regclass('public.' || t) is not null;

  if v_vivas is not null then
    raise exception 'Estas tablas debían irse y siguen: %', v_vivas;
  end if;
end $$;

-- Lo que se queda sigue en pie, y las vistas siguen corriendo como quien las mira.
do $$
declare v_faltan text; v_abiertas text;
begin
  select string_agg(v, ', ') into v_faltan
    from unnest(array['v_ot_timeline', 'ot_tablero_etapas', 'ot_fechas_clave', 'v_plazos_por_area',
                      'v_plazos_resumen', 'v_ot_materiales', 'ot_resumen', 'unidad_tablero', 'ot_avance_resumen',
                      'v_cronograma_ot', 'v_ot_actividades', 'v_ot_avance_areas', 'v_ot_avance_diario',
                      'v_flota_unidades', 'v_flota_avance_diario', 'v_pagos_cotizacion',
                      'v_cumplimiento_ot', 'v_cumplimiento_planos', 'v_cumplimiento_piezas']) as v
   where to_regclass('public.' || v) is null;

  if v_faltan is not null then
    raise exception 'El recorte se llevó vistas que se quedan: %', v_faltan;
  end if;

  select string_agg(c.relname, ', ') into v_abiertas
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and c.relname in ('v_ot_timeline', 'ot_tablero_etapas', 'ot_fechas_clave', 'v_plazos_por_area', 'v_ot_materiales')
     and coalesce(array_to_string(c.reloptions, ','), '') not similar to '%security_invoker=(on|true)%';

  if v_abiertas is not null then
    raise exception 'Estas vistas corren como su dueño y se saltan el RLS: %', v_abiertas;
  end if;
end $$;

-- Ningún permiso exigido por una política o una función que ningún rol tenga
-- (la comprobación de la 079), y nadie edita lo que no puede ver.
do $$
declare v_huerfanos text; v_cojos text;
begin
  select string_agg(p.codigo, ', ' order by p.codigo) into v_huerfanos
    from public.permisos p
   where not exists (select 1 from public.roles_permisos rp where rp.permiso_codigo = p.codigo)
     and p.codigo <> 'usuarios.ver'
     and (exists (select 1 from pg_policies pol
                   where pol.schemaname = 'public'
                     and (coalesce(pol.qual, '') || coalesce(pol.with_check, ''))
                         like '%''' || p.codigo || '''%')
       or exists (select 1 from pg_proc pr
                   where pr.pronamespace = 'public'::regnamespace
                     and position('''' || p.codigo || '''' in pr.prosrc) > 0));

  if v_huerfanos is not null then
    raise exception 'Quedan puertas tapiadas: % los exige la base y no los tiene ningún rol', v_huerfanos;
  end if;

  select string_agg(format('%s sin %s', r.codigo, replace(rp.permiso_codigo, '.editar', '.ver')), ', ')
    into v_cojos
    from public.roles_permisos rp
    join public.roles r on r.id = rp.rol_id
   where rp.permiso_codigo like '%.editar'
     and exists (select 1 from public.permisos v where v.codigo = replace(rp.permiso_codigo, '.editar', '.ver'))
     and not exists (select 1 from public.roles_permisos q
                      where q.rol_id = rp.rol_id
                        and q.permiso_codigo = replace(rp.permiso_codigo, '.editar', '.ver'));

  if v_cojos is not null then
    raise exception 'Hay roles que editan lo que no pueden ver: %', v_cojos;
  end if;
end $$;

-- Ninguna política ni función viva cita un permiso retirado: si alguna lo
-- hiciera, `tiene_permiso` devolvería falso sin error y la política mentiría.
do $$
declare v_citados text;
begin
  select string_agg(distinct m[1], ', ') into v_citados
    from (
      select regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '''([a-z_]+\.[a-z_]+)''', 'g') as m
        from pg_policies p
       where p.schemaname in ('public', 'storage')
      union all
      select regexp_matches(pr.prosrc, '''([a-z_]+\.[a-z_]+)''', 'g')
        from pg_proc pr
       where pr.pronamespace = 'public'::regnamespace
    ) s
   where m[1] ~ '^(almacen|requerimientos|compras|costos|calidad|documentos|garantias|reportes)\.'
      or m[1] = 'produccion.aprobar_parte';

  if v_citados is not null then
    raise exception 'Siguen citados en políticas o funciones permisos que ya no existen: %', v_citados;
  end if;
end $$;

-- Y en voz alta, sin detener nada: funciones que quedaron nombrando tablas que
-- ya no existen. Postgres no lo avisa porque el cuerpo de una función plpgsql
-- no crea dependencia; esta lista es para leerla después de aplicar.
do $$
declare v_sospechosas text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_sospechosas
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '(partes_diarios|parte_detalle|ot_personal|kardex|movimientos_almacen|requerimiento|ordenes_compra|proveedores|servicios_terceros|ot_inspecciones|documento_versiones|garantia_reclamos|ot_presupuesto|gastos_indirectos|tarifas_mano_obra|centros_costo|almacen_stock)';

  if v_sospechosas is not null then
    raise warning 'Funciones que todavía nombran tablas retiradas (revisar): %', v_sospechosas;
  end if;
end $$;
