-- =============================================================================
-- LA COTIZACIÓN SE GUARDA COMO PLANTILLA, Y SE CIERRAN LAS PUERTAS QUE QUEDARON
-- -----------------------------------------------------------------------------
-- Veinte carrocerías del catálogo no tienen ficha porque no hay ninguna OT de
-- 2024 a 2026 que las traiga. Hasta hoy la única manera de darles una era
-- escribir una migración: es decir, que lo haga el programador. Eso no es una
-- base de datos que se corrige sola.
--
-- Con esto, la primera vez que Diseño escribe la ficha de una bombona o de una
-- cisterna de GNV, la guarda «como plantilla de esta carrocería» desde la misma
-- pantalla, y la siguiente cotización de esa carrocería ya nace con ella.
--
-- La segunda mitad es la revisión de seguridad: lo que la auditoría de
-- funciones, vistas y políticas encontró abierto de más se cierra acá, con
-- el porqué de cada cierre.
-- =============================================================================

-- =============================================================================
-- 1. GUARDAR LA FICHA DE UNA COTIZACIÓN COMO PLANTILLA DE SU CARROCERÍA
-- -----------------------------------------------------------------------------
-- Copia las líneas y los accesorios de la cotización a una plantilla de su
-- tipo de carrocería. Si ya existe una con ese nombre, la reemplaza (es la
-- misma regla de `sembrar_plantilla_ficha`: volver a guardar deja lo mismo).
-- Lo exige `cotizaciones.costear`, que es la mano que arma la ficha.
-- =============================================================================
create or replace function public.guardar_cotizacion_como_plantilla(
  p_cotizacion     uuid,
  p_nombre         text,
  p_predeterminada boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot       public.cotizaciones%rowtype;
  v_plantilla uuid;
  v_lineas    int;
  v_nombre    text := btrim(coalesce(p_nombre, ''));
begin
  perform public.exigir_permiso('cotizaciones.costear');

  select * into v_cot from public.cotizaciones where id = p_cotizacion;
  if not found then
    raise exception 'No existe esa cotización';
  end if;
  if v_cot.tipo_carroceria_id is null then
    raise exception 'La cotización % no tiene carrocería elegida: la plantilla se guarda bajo una carrocería del catálogo.', v_cot.numero;
  end if;
  if length(v_nombre) < 3 then
    raise exception 'Ponle un nombre a la plantilla, corto y reconocible (por ejemplo «Bombona 20 m³ · 3 ejes»).';
  end if;

  select count(*) into v_lineas from public.cotizacion_especificaciones where cotizacion_id = p_cotizacion;
  if v_lineas = 0 then
    raise exception 'La cotización % no tiene ficha técnica escrita: no hay nada que guardar como plantilla.', v_cot.numero;
  end if;

  insert into public.plantillas_ficha
    (tipo_carroceria_id, nombre, descripcion, activa, tipo_unidad, capacidad_habitual, fuentes, predeterminada)
  values
    (v_cot.tipo_carroceria_id, v_nombre,
     format('Guardada desde la cotización %s el %s.', v_cot.numero, to_char(current_date, 'DD/MM/YYYY')),
     true, v_cot.tipo_unidad, v_cot.capacidad, array['COT ' || v_cot.numero], false)
  on conflict (tipo_carroceria_id, nombre) do update
    set descripcion        = excluded.descripcion,
        activa             = true,
        tipo_unidad        = excluded.tipo_unidad,
        capacidad_habitual = excluded.capacidad_habitual,
        fuentes            = excluded.fuentes
  returning id into v_plantilla;

  if p_predeterminada then
    update public.plantillas_ficha set predeterminada = false
     where tipo_carroceria_id = v_cot.tipo_carroceria_id and id <> v_plantilla and predeterminada;
    update public.plantillas_ficha set predeterminada = true where id = v_plantilla;
  end if;

  delete from public.plantilla_ficha_lineas     where plantilla_id = v_plantilla;
  delete from public.plantilla_ficha_accesorios where plantilla_id = v_plantilla;

  insert into public.plantilla_ficha_lineas
    (plantilla_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  select v_plantilla, e.seccion, e.orden_seccion, e.orden_linea, e.etiqueta, e.detalle
    from public.cotizacion_especificaciones e
   where e.cotizacion_id = p_cotizacion;

  insert into public.plantilla_ficha_accesorios
    (plantilla_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
  select v_plantilla, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
    from public.cotizacion_accesorios a
   where a.cotizacion_id = p_cotizacion;

  return v_plantilla;
end;
$$;

comment on function public.guardar_cotizacion_como_plantilla is
  'La ficha y los accesorios de una cotización pasan a ser plantilla de su carrocería. Reemplaza si el nombre ya existía.';

revoke all on function public.guardar_cotizacion_como_plantilla(uuid, text, boolean) from public, anon;
grant execute on function public.guardar_cotizacion_como_plantilla(uuid, text, boolean) to authenticated;

-- =============================================================================
-- 2. LAS PUERTAS QUE LA AUDITORÍA ENCONTRÓ ABIERTAS
-- -----------------------------------------------------------------------------
-- Se revisaron las funciones, las vistas y las políticas de la base viva con
-- el linter de Supabase y con consultas propias. Nada de esto estaba roto a la
-- vista, pero cada punto era una puerta que alguien con una cuenta cualquiera
-- —o sin cuenta— podía empujar. Se cierran con el porqué de cada una.
-- =============================================================================

-- 2.1 Las funciones de disparador las llama el sistema, no la gente.
-- Nueve de ellas se podían ejecutar por PostgREST desde cualquier sesión, y
-- dos incluso sin sesión. No hacen nada útil llamadas a mano, pero tampoco
-- tienen por qué estar al alcance. Se cierran todas las que devuelven trigger,
-- las de hoy y las que se creen después (por eso el bucle y no una lista).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype = 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;

-- 2.2 Las que solo llaman otras funciones de la base. `notificar_a_*` eran
-- las graves: security definer y ejecutables por `anon`, cualquiera sin cuenta
-- podía crear notificaciones a todos los usuarios. Las sembradoras
-- (`sembrar_verificacion`) y las que arma un disparador
-- (`cotizacion_sembrar_etapas`, `generar_presupuesto_desde_cotizacion`) no
-- exigen permiso por dentro porque las llama otra función que ya lo exigió:
-- abiertas a `authenticated`, cualquiera con cuenta reescribía la lista de
-- verificación o el presupuesto de una orden ajena.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'notificar_a_permiso', 'notificar_a_usuario',
         'plantilla_de_la_carroceria', 'tipo_cambio_exigido',
         'sembrar_verificacion', 'cotizacion_sembrar_etapas',
         'generar_presupuesto_desde_cotizacion'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;

-- 2.3 Las que la aplicación sí llama con sesión, pero nadie sin ella:
-- se cierran a `anon` y a `public`, se dejan a `authenticated`.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'datos_de_empresa', 'estado_del_plazo',
         'dias_habiles_entre', 'es_laborable', 'sumar_dias_habiles', 'restar_dias_habiles'
       )
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
  end loop;
end $$;

-- `estado_del_plazo` es sql puro y no tenía el esquema fijado: con un
-- search_path ajeno alguien podía colarle otro `estado_plazo`.
alter function public.estado_del_plazo(date, timestamptz) set search_path = public;

-- 2.4 `armar_ficha_ot` la llama la pantalla y también el disparador de
-- aprobación. No exigía nada: cualquiera con cuenta podía sembrar accesorios y
-- pasos en una orden que ni siquiera ve. Ahora, si hay sesión, exige poder ver
-- la orden y tener una mano sobre ella; sin sesión (el disparador, una
-- migración) sigue igual, que es como funcionaba.
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
            or public.tiene_permiso('produccion.registrar')
            or public.tiene_permiso('calidad.inspeccionar'))) then
    raise exception 'No puede armar la ficha de una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  select cotizacion_id, tipo_carroceria_id into v_cotizacion, v_tipo
    from public.ordenes_trabajo where id = p_orden;

  -- Los accesorios prometidos en la cotización son los que hay que montar.
  if v_cotizacion is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.cotizacion_accesorios a
     where a.cotizacion_id = v_cotizacion;
  end if;

  -- Y los pasos de verificación de su carrocería. Si esa carrocería no tiene
  -- lista propia se usa la genérica: es preferible a dejar la sección vacía.
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

-- 2.5 `ot_resumen` corría como su dueño y se saltaba el RLS de las órdenes:
-- la lista de OT la veía entera cualquiera con cuenta, fuera de su sede o no.
-- Ahora corre como quien la consulta. Los dos JOIN a clientes y sedes pasan a
-- LEFT JOIN para que un usuario sin `clientes.ver` no pierda la orden entera
-- por no poder ver el nombre del cliente: ve la orden y el cliente en blanco,
-- que es exactamente lo que su permiso dice.
create or replace view public.ot_resumen
with (security_invoker = true) as
 SELECT o.id,
    o.numero,
    o.estado,
    o.prioridad,
    o.tipo_trabajo,
    o.sede_id,
    s.nombre AS sede,
    o.cliente_id,
    c.razon_social AS cliente,
    c.numero_documento AS cliente_documento,
    o.unidad_id,
    u.placa,
    tc.nombre AS tipo_carroceria,
    o.descripcion,
    o.fecha_registro,
    o.fecha_inicio_programada,
    o.fecha_fin_programada,
    o.fecha_entrega_comprometida,
    o.fecha_inicio_real,
    o.fecha_fin_real,
    o.avance_porcentaje,
    o.horas_estimadas,
    o.horas_reales,
    o.horas_reales::numeric - o.horas_estimadas::numeric AS desviacion_horas,
    o.moneda,
    o.monto_presupuestado,
    o.responsable_id,
    (r.nombres || ' '::text) || r.apellidos AS responsable,
    count(e.id) AS etapas_total,
    count(e.id) FILTER (WHERE e.estado = 'TERMINADA'::estado_etapa_ot) AS etapas_terminadas,
    count(e.id) FILTER (WHERE e.estado = 'EN_PROCESO'::estado_etapa_ot) AS etapas_en_proceso,
        CASE
            WHEN o.estado = ANY (ARRAY['ENTREGADA'::estado_ot, 'FACTURADA'::estado_ot, 'ANULADA'::estado_ot]) THEN 0
            WHEN o.fecha_entrega_comprometida IS NULL THEN 0
            ELSE GREATEST(CURRENT_DATE - o.fecha_entrega_comprometida, 0)
        END AS dias_atraso,
        CASE
            WHEN o.estado = ANY (ARRAY['ENTREGADA'::estado_ot, 'FACTURADA'::estado_ot, 'ANULADA'::estado_ot]) THEN NULL::integer
            WHEN o.fecha_entrega_comprometida IS NULL THEN NULL::integer
            ELSE dias_habiles_entre(CURRENT_DATE, o.fecha_entrega_comprometida)
        END AS dias_habiles_restantes,
    u.codigo_interno,
    u.numero_chasis,
    u.marca,
    u.modelo
   FROM ordenes_trabajo o
     LEFT JOIN clientes c ON c.id = o.cliente_id
     LEFT JOIN sedes s ON s.id = o.sede_id
     LEFT JOIN unidades u ON u.id = o.unidad_id
     LEFT JOIN tipos_carroceria tc ON tc.id = o.tipo_carroceria_id
     LEFT JOIN usuarios r ON r.id = o.responsable_id
     LEFT JOIN ot_etapas e ON e.orden_id = o.id
  GROUP BY o.id, c.id, s.id, u.id, tc.id, r.id;

-- 2.6 Siete catálogos tenían una política «para todo» (que incluye leer)
-- conviviendo con la de lectura: Postgres evaluaba las dos en cada consulta.
-- La de escritura pasa a ser tres políticas —insertar, corregir, borrar— con
-- la misma condición, y leer queda en la suya.
do $$
declare p record;
begin
  for p in
    select tablename, policyname, qual
      from pg_policies
     where schemaname = 'public' and cmd = 'ALL'
       and tablename in ('codificacion_familias', 'codificacion_materiales', 'codificacion_subfamilias',
                         'codificacion_tipos', 'permisos', 'roles', 'roles_permisos')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   p.policyname || '_insertar', p.tablename, p.qual);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   p.policyname || '_corregir', p.tablename, p.qual, p.qual);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                   p.policyname || '_borrar', p.tablename, p.qual);
  end loop;
end $$;
