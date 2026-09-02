-- =============================================================================
-- LO QUE LA AUDITORÍA ENCONTRÓ EN LA BASE
-- -----------------------------------------------------------------------------
-- Diez revisores leyeron el sistema entero —base, consultas, acciones,
-- pantallas— y otro tanto intentó tumbar cada hallazgo antes de darlo por
-- bueno. Lo que sobrevivió y vive en la base se arregla aquí, junto, porque
-- son ocho puertas de la misma casa y separarlas en ocho migraciones solo
-- haría más difícil entender el día en que se cerraron.
--
-- Ninguno de estos fallos se cae: todos mienten. Es la marca de la casa y por
-- eso duelen tanto.
-- =============================================================================

-- =============================================================================
-- 1. LA ORDEN NACÍA SIN PRESUPUESTO DESDE ESTA MAÑANA
-- -----------------------------------------------------------------------------
-- La migración 073 metió `generar_presupuesto_desde_cotizacion` en la lista de
-- «las que llama un disparador» y le quitó el permiso de ejecución. No la llama
-- ningún disparador: la llama la pantalla, al convertir una cotización aprobada
-- en orden de trabajo. Desde entonces cada conversión creaba la OT y moría al
-- arrastrar el presupuesto, con un «no tienes permisos» que el usuario no puede
-- entender, y la orden quedaba sin presupuesto: todo el gasto sale después como
-- desviación. Todavía no se ha visto porque no se ha convertido ninguna.
--
-- Se le pone la guardia que le faltaba —el mismo permiso que ya exige la acción
-- de la pantalla, que es la regla número uno de este proyecto— y se le devuelve
-- la ejecución.
-- =============================================================================
create or replace function public.generar_presupuesto_desde_cotizacion(
  p_orden_id      uuid,
  p_factor_costo  numeric default 1,
  p_reemplazar    boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_estado     public.estado_cotizacion;
  v_moneda     public.moneda;
  v_tc         numeric;
  v_unidades   numeric;
  v_filas      integer;
begin
  -- La misma mano que abre la orden es la que arrastra su presupuesto: sin
  -- esto, con la función abierta, cualquiera con cuenta presupuestaba una
  -- orden ajena. `exigir_permiso` deja pasar a las conexiones sin sesión
  -- (migraciones, clave de servicio), igual que en `armar_ficha_ot`.
  perform public.exigir_permiso('ordenes.crear');
  if public.usuario_actual() is not null and not public.puede_ver_orden(p_orden_id) then
    raise exception 'No puede presupuestar una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  if p_factor_costo <= 0 then
    raise exception 'El factor de costo debe ser mayor que cero' using errcode = 'check_violation';
  end if;

  perform public.costos_validar_orden(p_orden_id);

  select o.cotizacion_id into v_cotizacion
    from public.ordenes_trabajo o
   where o.id = p_orden_id;

  if v_cotizacion is null then
    raise exception 'La orden de trabajo % no nace de una cotización: su presupuesto se carga a mano', p_orden_id
      using errcode = 'no_data_found';
  end if;

  select c.estado, c.moneda, c.tipo_cambio, greatest(coalesce(c.concepto_cantidad, 1), 1)
    into v_estado, v_moneda, v_tc, v_unidades
    from public.cotizaciones c
   where c.id = v_cotizacion;

  -- Solo se arrastra lo que el cliente aceptó: una cotización en borrador o
  -- rechazada no es un compromiso y presupuestar sobre ella es inventar.
  if v_estado <> 'APROBADA' then
    raise exception 'La cotización de la orden % está en estado % y solo se puede presupuestar desde una cotización APROBADA', p_orden_id, v_estado
      using errcode = 'check_violation';
  end if;

  if p_reemplazar then
    delete from public.ot_presupuesto
     where orden_id = p_orden_id
       and origen = 'COTIZACION';
  end if;

  insert into public.ot_presupuesto (
    orden_id, tipo_costo, descripcion, detalle, unidad_medida, cantidad,
    monto_presupuestado, origen, cotizacion_partida_id
  )
  select
    p_orden_id,
    -- El enum de la cotización no conoce INDIRECTO; el resto mapea uno a uno.
    case cp.tipo_costo
      when 'MATERIAL'  then 'MATERIAL'::public.tipo_costo
      when 'MANO_OBRA' then 'MANO_OBRA'::public.tipo_costo
      when 'SERVICIO'  then 'SERVICIO'::public.tipo_costo
      else 'OTRO'::public.tipo_costo
    end,
    cp.descripcion,
    cp.detalle,
    cp.unidad_medida,
    -- Una orden fabrica una unidad: le toca su parte del material y de las horas.
    round(cp.cantidad::numeric / v_unidades, 4),
    -- El subtotal de la partida ES el costo esperado desde que Administración
    -- costea aparte del precio (migración 041), así que el factor por omisión
    -- es 1 y no hay margen que descontar. `p_factor_costo` queda solo para
    -- ajustar a mano un lote entero; con 0.75 se presupuesta un 25 % por
    -- debajo, que es un error caro si se usa creyendo que la partida es venta.
    round(cp.subtotal::numeric * v_tc / v_unidades * p_factor_costo, 2),
    'COTIZACION',
    cp.id
  from public.cotizacion_partidas cp
  where cp.cotizacion_id = v_cotizacion
    -- Idempotente: repetir la llamada no duplica lo ya arrastrado.
    and not exists (
      select 1 from public.ot_presupuesto op
       where op.orden_id = p_orden_id
         and op.cotizacion_partida_id = cp.id
    );

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean) from public, anon;
grant execute on function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean) to authenticated;

-- =============================================================================
-- 2. EL ESTADO LO CAMBIA QUIEN PUEDE, TAMBIÉN POR LA PUERTA DE ATRÁS
-- -----------------------------------------------------------------------------
-- La pantalla exige `produccion.aprobar_parte` para aprobar un parte diario y
-- `ordenes.aprobar` / `.anular` / `.entregar` para mover una OT. La base no
-- exigía ninguno de los dos: sus políticas aceptan `produccion.registrar` y
-- `ordenes.cambiar_estado` para cualquier columna. Como la clave anónima viaja
-- al navegador y el repositorio es público, un operario podía aprobar su propio
-- parte —y cargarle las horas al costo real de la orden— con una sola llamada,
-- y un jefe de taller aprobar o anular una orden que no le toca.
--
-- La regla de negocio vivía solo en la pantalla, que es exactamente al revés de
-- como trabaja este sistema. Se pone donde manda: en la base. Disparadores
-- propios, no reescribir los existentes (regla del blindaje).
-- =============================================================================
create or replace function public.fn_parte_permiso_por_estado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado
     and (new.estado = 'APROBADO' or old.estado = 'APROBADO') then
    perform public.exigir_permiso('produccion.aprobar_parte');

    -- La firma la pone la sesión, no lo que mande el formulario.
    if new.estado = 'APROBADO' and public.usuario_actual() is not null then
      new.aprobado_por := public.usuario_actual();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parte_permiso_por_estado on public.partes_diarios;
create trigger trg_parte_permiso_por_estado
  before update on public.partes_diarios
  for each row execute function public.fn_parte_permiso_por_estado();

create or replace function public.fn_ot_permiso_por_estado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado then
    case new.estado
      when 'APROBADA'  then perform public.exigir_permiso('ordenes.aprobar');
      when 'ANULADA'   then perform public.exigir_permiso('ordenes.anular');
      when 'ENTREGADA' then perform public.exigir_permiso('ordenes.entregar');
      else                  perform public.exigir_permiso('ordenes.cambiar_estado');
    end case;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ot_permiso_por_estado on public.ordenes_trabajo;
create trigger trg_ot_permiso_por_estado
  before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_permiso_por_estado();

revoke all on function public.fn_parte_permiso_por_estado() from public, anon, authenticated;
revoke all on function public.fn_ot_permiso_por_estado()    from public, anon, authenticated;

-- =============================================================================
-- 3. LA FICHA LA APLICA QUIEN LA ARMA
-- -----------------------------------------------------------------------------
-- `aplicar_plantilla_ficha` exige `cotizaciones.editar` desde la migración 023.
-- La 041 abrió las políticas de la ficha a `cotizaciones.costear`, que es la
-- mano que de verdad la arma —Administración y Diseño—, y esta guardia se quedó
-- atrás: los únicos roles que ven el botón «Aplicar» reciben un error cada vez
-- que lo pulsan. Las plantillas de carrocería que se sembraron ayer no las
-- podía usar nadie salvo el administrador.
-- =============================================================================
create or replace function public.aplicar_plantilla_ficha(p_cotizacion uuid, p_plantilla uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_lineas int;
begin
  if public.usuario_actual() is not null
     and not (public.es_admin()
              or public.tiene_permiso('cotizaciones.editar')
              or public.tiene_permiso('cotizaciones.costear')) then
    raise exception 'No tiene permiso para aplicar una ficha: hace falta cotizaciones.editar o cotizaciones.costear'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.cotizaciones where id = p_cotizacion) then
    raise exception 'No existe esa cotización';
  end if;
  if not exists (select 1 from public.plantillas_ficha where id = p_plantilla and activa) then
    raise exception 'No existe esa plantilla o está dada de baja';
  end if;

  delete from public.cotizacion_especificaciones where cotizacion_id = p_cotizacion;
  delete from public.cotizacion_accesorios        where cotizacion_id = p_cotizacion;

  insert into public.cotizacion_especificaciones
    (cotizacion_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  select p_cotizacion, l.seccion, l.orden_seccion, l.orden_linea, l.etiqueta, l.detalle
    from public.plantilla_ficha_lineas l
   where l.plantilla_id = p_plantilla;

  get diagnostics v_lineas = row_count;

  insert into public.cotizacion_accesorios
    (cotizacion_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
  select p_cotizacion, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
    from public.plantilla_ficha_accesorios a
   where a.plantilla_id = p_plantilla;

  return v_lineas;
end;
$$;

revoke all on function public.aplicar_plantilla_ficha(uuid, uuid) from public, anon;
grant execute on function public.aplicar_plantilla_ficha(uuid, uuid) to authenticated;

-- =============================================================================
-- 4. LAS ETAPAS NO DEPENDEN DE PODER VER AL CLIENTE
-- -----------------------------------------------------------------------------
-- Todas las vistas corren con el permiso de quien consulta (migración 007). Una
-- vista que cruza con `clientes` por dentro, entonces, le devuelve CERO FILAS a
-- quien no tiene `clientes.ver`: la fila se cae en el cruce y no hay error. Eso
-- deja el desplegable de etapas vacío justo para el operario y el supervisor,
-- que son quienes registran las horas, y la orden sin etapas para Calidad,
-- Almacén, Compras y Costos.
--
-- La 073 lo arregló en `ot_resumen`; quedaban siete vistas con el mismo cruce.
-- Se convierten en cruce por la izquierda: quien no puede ver el nombre del
-- cliente ve la fila con el cliente en blanco, que es exactamente lo que su
-- permiso dice. El bucle las arregla todas y las que se creen mañana con el
-- mismo error, y no toca las que ya están bien.
-- =============================================================================
do $$
declare
  v      record;
  v_def  text;
  v_nuevo text;
begin
  for v in
    select c.oid, c.relname, pg_get_viewdef(c.oid, true) as def
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'v'
       and pg_get_viewdef(c.oid, true) ~ '(?<!LEFT )JOIN clientes '
  loop
    v_def   := v.def;
    v_nuevo := regexp_replace(v_def, '(?<!LEFT )JOIN clientes ', 'LEFT JOIN clientes ', 'g');
    if v_nuevo is distinct from v_def then
      -- `security_invoker` se repite a propósito: reemplazar la vista sin
      -- nombrarlo la dejaría corriendo como su dueño, que es la puerta que
      -- cerró la 073.
      execute format('create or replace view public.%I with (security_invoker = true) as %s',
                     v.relname, v_nuevo);
      raise notice 'vista % : el cliente ya no esconde la fila', v.relname;
    end if;
  end loop;
end $$;

-- =============================================================================
-- 5. EL PROVEEDOR LO DA DE ALTA QUIEN LO NECESITA
-- -----------------------------------------------------------------------------
-- La acción de la pantalla acepta `almacen.maestros` y `costos.editar` —el
-- proveedor nuevo se da de alta justo cuando hace falta emitirle algo—, pero la
-- política se quedó en la lista genérica de la 007 y solo acepta `compras.crear`.
-- Almacén y Costos ven el botón «Nuevo proveedor» y reciben un error siempre.
--
-- No se envuelven en `(select …)`: son llamadas con argumento constante y
-- Postgres ya las iza solo (skill `datos`, «Lo que ya se midió»).
-- =============================================================================
drop policy if exists crear_proveedores on public.proveedores;
create policy crear_proveedores on public.proveedores
  for insert to authenticated
  with check (public.es_admin()
              or public.tiene_permiso('compras.crear')
              or public.tiene_permiso('almacen.maestros')
              or public.tiene_permiso('costos.editar'));

drop policy if exists editar_proveedores on public.proveedores;
create policy editar_proveedores on public.proveedores
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('compras.crear')
         or public.tiene_permiso('almacen.maestros')
         or public.tiene_permiso('costos.editar'))
  with check (public.es_admin()
              or public.tiene_permiso('compras.crear')
              or public.tiene_permiso('almacen.maestros')
              or public.tiene_permiso('costos.editar'));

-- =============================================================================
-- 6. LOS DÍAS HÁBILES SE CUENTAN DE UNA VEZ
-- -----------------------------------------------------------------------------
-- `dias_habiles_entre` llamaba a `es_laborable` una vez por día del rango, y
-- cada una de esas llamadas leía la empresa y los feriados: para una entrega a
-- 45 días son 90 subconsultas. La vista `ot_resumen` la evalúa para TODAS las
-- órdenes abiertas antes de ordenar y de cortar la página, así que el listado
-- paga esa cuenta entera cada vez que alguien lo abre.
--
-- Es la misma cuenta en una sola consulta: los días laborables de la empresa se
-- leen una vez y los feriados con un solo cruce. La semántica no cambia —un
-- feriado marcado laborable sigue contando— y el check del calendario lo vigila.
-- =============================================================================
-- Primero la cuenta, porque la de abajo la nombra y Postgres valida el cuerpo
-- al crearla.
create or replace function public.dias_de_taller(p_desde date, p_hasta date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select count(*)::int
      from generate_series(p_desde + 1, p_hasta, interval '1 day') d
     where extract(isodow from d)::smallint = any(
             coalesce((select dias_laborables from public.empresa limit 1), '{1,2,3,4,5,6}'::smallint[]))
       and coalesce((select f.laborable from public.feriados f where f.fecha = d::date), true)
  ), 0);
$$;

create or replace function public.dias_habiles_entre(p_desde date, p_hasta date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_desde is null or p_hasta is null then null
    when p_hasta < p_desde then -public.dias_de_taller(p_hasta, p_desde)
    else public.dias_de_taller(p_desde, p_hasta)
  end;
$$;

comment on function public.dias_de_taller is
  'Los días de trabajo entre dos fechas, sin contar la primera. La usa dias_habiles_entre; no se llama suelta.';

revoke all on function public.dias_de_taller(date, date)    from public, anon, authenticated;
revoke all on function public.dias_habiles_entre(date, date) from public, anon;
grant execute on function public.dias_habiles_entre(date, date) to authenticated;

-- =============================================================================
-- 7. EL TALLER VIVE EN LIMA, Y LA BASE TAMBIÉN
-- -----------------------------------------------------------------------------
-- La base corría en UTC. A las siete de la noche de Lima `current_date` ya era
-- el día siguiente, y a partir de esa hora: una orden comprometida para hoy
-- salía atrasada en la lista mientras su detalle decía «en plazo»; el cronograma
-- pintaba VENCIDA una etapa que vence hoy; una cotización que vence hoy quedaba
-- vencida; y el parte del turno de tarde se podía guardar con la fecha de
-- mañana, quedándose el trabajo de hoy imputado al día siguiente.
--
-- No se cambia función por función —son trece funciones, nueve vistas y
-- dieciséis valores por omisión, y bastaría olvidar uno para tener dos relojes—:
-- se le pone la hora del taller a la base entera. Rige para las sesiones nuevas,
-- así que el efecto es completo cuando el conector recicla sus conexiones.
-- =============================================================================
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Lima');
end $$;

-- Y la fecha del parte se compara contra la de Lima explícitamente, para que la
-- regla no dependa de cómo quedó configurada la sesión.
create or replace function public.fn_parte_antes_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if nullif(btrim(new.numero), '') is null then
    new.numero := public.produccion_siguiente_numero('PARTE_DIARIO', new.sede_id);
  end if;

  -- El parte registra lo que ya se trabajó, no lo que se va a trabajar.
  if new.fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'No se puede registrar un parte diario con fecha futura (%)', new.fecha
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- 8. LOS NÚMEROS DEL TABLERO SE CUENTAN EN LA BASE
-- -----------------------------------------------------------------------------
-- El tablero, los plazos, el almacén y el resumen comercial se contaban en el
-- servidor: se traían TODAS las filas y se contaban en memoria. PostgREST corta
-- la respuesta en mil filas sin devolver error, así que el día que la empresa
-- llegue a mil órdenes el tablero dirá «de 1000 registradas» y seguirá diciendo
-- eso para siempre; en Plazos, con catorce etapas por orden, el corte llega con
-- unas setenta órdenes abiertas y las etapas empiezan a desaparecer de la lista
-- sin que nadie lo note.
--
-- Contar es trabajo de la base. Todas corren con el permiso de quien pregunta
-- (`security invoker`), así que cada quien cuenta lo que puede ver.
-- =============================================================================
create or replace function public.indicadores_tablero(p_sede_id uuid default null)
returns table (
  abiertas    int,
  en_proceso  int,
  pausadas    int,
  atrasadas   int,
  urgentes    int,
  total       int,
  por_estado  jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with o as (
    select estado, prioridad, fecha_entrega_comprometida
      from public.ordenes_trabajo
     where p_sede_id is null or sede_id = p_sede_id
  ),
  abiertas as (
    select * from o
     where estado in ('APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD')
  )
  select
    (select count(*) from abiertas)::int,
    (select count(*) from abiertas where estado = 'EN_PROCESO')::int,
    (select count(*) from abiertas where estado = 'PAUSADA')::int,
    (select count(*) from abiertas where fecha_entrega_comprometida < current_date)::int,
    (select count(*) from abiertas where prioridad = 'URGENTE')::int,
    (select count(*) from o)::int,
    coalesce((select jsonb_object_agg(estado, n)
                from (select estado, count(*) n from o group by 1) e), '{}'::jsonb);
$$;

comment on function public.indicadores_tablero is
  'Los cinco números del tablero y el total por estado, contados en la base. Cada quien cuenta lo que su permiso le deja ver.';

revoke all on function public.indicadores_tablero(uuid) from public, anon;
grant execute on function public.indicadores_tablero(uuid) to authenticated;

-- Plazos: el resumen por área y semáforo, sin arrastrar los dos cruces
-- laterales que `v_plazos_por_area` necesita para la lista pero no para contar.
create or replace view public.v_plazos_resumen
with (security_invoker = true) as
  select a.codigo as area_codigo,
         a.nombre as area_nombre,
         public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
         count(*)::int as cantidad
    from public.ot_etapas oe
    join public.ordenes_trabajo o on o.id = oe.orden_id
    join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
    left join public.areas a on a.id = ec.area_id
   where o.estado <> all (array['BORRADOR'::public.estado_ot, 'ANULADA'::public.estado_ot,
                                'ENTREGADA'::public.estado_ot, 'FACTURADA'::public.estado_ot])
     and oe.estado <> 'OMITIDA'::public.estado_etapa_ot
   group by 1, 2, 3;

comment on view public.v_plazos_resumen is
  'Cuántas etapas hay en cada área y en cada estado de plazo. Para las pastillas de Plazos, que antes se contaban trayendo la lista entera.';

grant select on public.v_plazos_resumen to authenticated;

create or replace function public.resumen_almacen()
returns table (materiales int, valorizado numeric, bajo_minimo int)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select count(*)::int,
         coalesce(sum(valorizado), 0)::numeric,
         count(*) filter (where bajo_minimo)::int
    from public.v_stock_actual;
$$;

revoke all on function public.resumen_almacen() from public, anon;
grant execute on function public.resumen_almacen() to authenticated;

create or replace function public.cotizaciones_por_estado()
returns table (estado text, cantidad int)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select estado::text, count(*)::int from public.cotizaciones group by 1;
$$;

revoke all on function public.cotizaciones_por_estado() from public, anon;
grant execute on function public.cotizaciones_por_estado() to authenticated;
