-- =============================================================================
-- LA OT LLEVA SU TIPO Y EL NÚMERO FMI
-- -----------------------------------------------------------------------------
-- «En la definición de OT debe ir lo de tipo semirremolque o montada nada más,
-- y en placa, número FMI.»
--
-- Lo que la casa fabrica es un semirremolque o una carrocería que se monta
-- sobre un camión: es la misma división que ya tienen el catálogo de
-- carrocerías y las cotizaciones (`tipo_unidad_carroceria`), y la que su propia
-- OT escribe en el código interno (COM_CM_N2…, CM de carrocería montada). La
-- lista de vehículos del cliente —volquete, tracto, remolque…— no le decía
-- nada a la orden, así que al emitirla se elige una de las dos y nada más.
--
-- Y la unidad que se fabrica no tiene placa todavía: se la reconoce por su
-- número FMI. Al emitir la OT se pide ese número en lugar de la placa, se
-- guarda tal cual —sin la forma ABC-123 que se le da a una placa, que a un
-- «123456» lo volvería «123-456»— y es con lo que el taller reconoce la unidad
-- en el tablero, los plazos y el avance mientras no tenga placa.
-- =============================================================================

-- =============================================================================
-- 1. EL NÚMERO FMI DE LA UNIDAD
-- =============================================================================
alter table public.unidades add column if not exists numero_fmi text;

comment on column public.unidades.numero_fmi is
  'El número FMI con que se reconoce la unidad que se fabrica mientras no tiene placa (migración 104). Se guarda tal cual se escribe.';

-- Un FMI es una unidad. Se compara sin espacios ni guiones, como la placa.
create unique index if not exists uq_unidades_numero_fmi
  on public.unidades (upper(regexp_replace(numero_fmi, '[^A-Za-z0-9]', '', 'g')))
  where numero_fmi is not null;

-- =============================================================================
-- 2. EL TIPO DE LA ORDEN
-- =============================================================================
alter table public.ordenes_trabajo add column if not exists tipo_unidad public.tipo_unidad_carroceria;

comment on column public.ordenes_trabajo.tipo_unidad is
  'Semirremolque o carrocería montada: lo que se fabrica. Se elige al emitir la OT (migración 104); las anteriores quedan sin él.';

-- =============================================================================
-- 3. EMITIR LA ORDEN: TIPO Y NÚMERO FMI
-- -----------------------------------------------------------------------------
-- La firma cambia (número FMI y tipo en vez de placa y tipo de vehículo), así
-- que la anterior se retira: dos funciones con el mismo nombre invitan a llamar
-- a la vieja. La unidad guarda un tipo de vehículo, que es obligatorio: el
-- semirremolque es un semirremolque, y la carrocería montada va sobre un camión.
-- =============================================================================
drop function if exists public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_vehiculo, text, text, date, text, text, bigint);

create or replace function public.emitir_orden_de_cotizacion(
  p_cotizacion    uuid,
  p_orden         uuid,
  p_numero_fmi    text,
  p_tipo_unidad   public.tipo_unidad_carroceria,
  p_marca         text,
  p_modelo        text,
  p_fecha_entrega date,
  p_ruta_pdf      text,
  p_nombre_pdf    text,
  p_tamano_pdf    bigint default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot     record;
  v_fmi     constant text := nullif(upper(btrim(coalesce(p_numero_fmi, ''))), '');
  v_clave   constant text := upper(regexp_replace(coalesce(p_numero_fmi, ''), '[^A-Za-z0-9]', '', 'g'));
  v_unidad  uuid;
  v_ajena   text;
  v_sede    uuid;
  v_nombre  text;
  v_numero  text;
  v_tipo    constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
begin
  perform public.exigir_permiso('ordenes.crear');

  select c.*, tc.nombre as carroceria into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
   where c.id = p_cotizacion
     for update of c;

  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % todavía no está aprobada por Gerencia.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo o
              where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA') then
    raise exception 'La cotización % ya tiene su orden de trabajo.', v_cot.numero
      using errcode = 'unique_violation';
  end if;
  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3) then
    raise exception 'El PDF de la orden no llegó en su sitio.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe el número FMI, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  -- La unidad: la de ese FMI si ya está, o se registra.
  if v_clave <> '' then
    select u.id into v_unidad
      from public.unidades u
     where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
     order by (u.cliente_id is not null) desc, u.creado_en desc
     limit 1;

    if v_unidad is null then
      select coalesce(cl.razon_social, 'otro cliente') into v_ajena
        from public.unidades u
        left join public.clientes cl on cl.id = u.cliente_id
       where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       limit 1;
      if v_ajena is not null then
        raise exception 'El número FMI % ya es de una unidad de %: revisa el número.', v_fmi, v_ajena
          using errcode = 'unique_violation';
      end if;
    else
      update public.unidades set cliente_id = v_cot.cliente_id
       where id = v_unidad and cliente_id is null;
    end if;
  end if;

  if v_unidad is null then
    insert into public.unidades (cliente_id, numero_fmi, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_fmi,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    id, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
    descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad)
  values (
    p_orden, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION', 'NORMAL',
    format('%s · %s · cotización %s', v_cot.carroceria, v_tipo, v_cot.numero),
    p_fecha_entrega, 'APROBADA', p_cotizacion, p_tipo_unidad)
  returning numero into v_numero;

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf,
          'application/pdf', p_tamano_pdf, public.usuario_actual());

  v_nombre := coalesce('FMI ' || v_fmi,
                       nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Orden nueva en el taller',
    format('%s: %s, %s (%s). Armen la lista de su área.', v_numero, v_cot.carroceria, lower(v_tipo), coalesce(v_nombre, 'sin FMI')),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  perform public.notificar_a_permiso(
    'diseno.planos',
    'Orden nueva para desglosar',
    format('%s: %s, %s. Falta el desglose de Diseño.', v_numero, v_cot.carroceria, lower(v_tipo)),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  return p_orden;
end;
$$;

revoke all on function public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  from public, anon;
grant execute on function public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  to authenticated;

-- =============================================================================
-- 4. EL TALLER RECONOCE LA UNIDAD POR SU FMI
-- -----------------------------------------------------------------------------
-- Las cinco vistas del taller que muestran la placa de la unidad la muestran
-- ahora «o su FMI»: sin placa, sale «FMI 12345» donde antes salía un vacío. La
-- columna sigue llamándose `placa` para que ninguna pantalla cambie. Se reescribe
-- solo esa línea de cada vista, leyendo la definición que está viva, y se
-- comprueba que estaba exactamente una vez.
--
-- No alcanza con «create or replace»: la columna era del dominio `placa`, que
-- exige la forma ABC-123, y un «FMI 12345» no cabe en él (lo dijo la primera
-- aplicación: «cannot change data type of view column»). Cada vista se borra y
-- se vuelve a crear con la columna en texto, en la misma transacción, y se le
-- devuelve lo que tenía —comprobado el 2026-09-14 en las cinco: ninguna vista
-- depende de ellas, security_invoker, todo para authenticated y service_role,
-- nada para anon—. Lo de anon se revoca a mano porque el esquema public reparte
-- permisos por defecto a lo que se crea en él.
-- =============================================================================
do $$
declare
  v_vista      text;
  v_def        text;
  v_opciones   text[];
  v_comentario text;
  v_veces      int;
begin
  foreach v_vista in array array['ot_resumen', 'ot_avance_resumen', 'ot_tablero_etapas', 'unidad_tablero', 'v_plazos_por_area'] loop
    select pg_get_viewdef(c.oid), c.reloptions, obj_description(c.oid, 'pg_class')
      into v_def, v_opciones, v_comentario
      from pg_class c where c.oid = ('public.' || v_vista)::regclass;

    -- Ya reescrita en una aplicación anterior: no se toca dos veces.
    continue when v_def like '%numero_fmi%';

    v_veces := (length(v_def) - length(replace(v_def, 'u.placa,', ''))) / length('u.placa,');
    if v_veces <> 1 then
      raise exception 'La vista % tiene la placa % veces: revisarla a mano', v_vista, v_veces;
    end if;
    if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
                where d.refobjid = ('public.' || v_vista)::regclass and r.ev_class <> ('public.' || v_vista)::regclass) then
      raise exception 'Otra vista depende de %: borrarla la arrastraría', v_vista;
    end if;

    execute format('drop view public.%I', v_vista);
    execute format('create view public.%I with (%s) as %s',
                   v_vista,
                   coalesce(array_to_string(v_opciones, ', '), 'security_invoker = on'),
                   replace(v_def, 'u.placa,', $r$COALESCE(u.placa::text, ('FMI '::text || u.numero_fmi)) AS placa,$r$));
    execute format('revoke all on public.%I from public, anon', v_vista);
    execute format('grant all on public.%I to authenticated, service_role', v_vista);
    if v_comentario is not null then
      execute format('comment on view public.%I is %L', v_vista, v_comentario);
    end if;
  end loop;
end $$;

-- Cuando el taller abre una orden escribiendo el número de la unidad, la busca
-- también por FMI: si no, a una unidad que la oficina registró por su FMI el
-- taller le crearía una gemela.
do $$
declare
  v_def     text;
  v_buscado constant text := $b$where upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave$b$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'abrir_orden_del_taller';

  if v_def like '%numero_fmi%' then
    return;
  end if;
  if position(v_buscado in v_def) = 0 then
    raise exception 'abrir_orden_del_taller no busca la unidad como se esperaba: revisarla a mano';
  end if;

  execute replace(v_def, v_buscado,
    $n$where (upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
             or upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave)$n$);
end $$;

-- =============================================================================
-- 5. COMPROBACIONES
-- =============================================================================
do $$
declare
  v_vista text;
begin
  if has_function_privilege('anon', 'public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)', 'execute') then
    raise exception 'emitir_orden_de_cotizacion quedó abierta al rol anónimo';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'emitir_orden_de_cotizacion'
                and pg_get_function_identity_arguments(p.oid) like '%tipo_vehiculo%') then
    raise exception 'quedó la emisión vieja, con placa y tipo de vehículo';
  end if;
  foreach v_vista in array array['ot_resumen', 'ot_avance_resumen', 'ot_tablero_etapas', 'unidad_tablero', 'v_plazos_por_area'] loop
    if pg_get_viewdef(('public.' || v_vista)::regclass) not like '%numero_fmi%' then
      raise exception 'la vista % no muestra el FMI', v_vista;
    end if;
    -- Las cinco eran security_invoker antes de esta migración (comprobado el
    -- 2026-09-14): reescribirlas no puede dejar que corran como su dueño.
    if coalesce((select array_to_string(reloptions, ',') from pg_class where oid = ('public.' || v_vista)::regclass), '')
         not similar to '%security_invoker=(on|true)%' then
      raise exception 'la vista % perdió security_invoker al reescribirla', v_vista;
    end if;
    if has_table_privilege('anon', 'public.' || v_vista, 'select') then
      raise exception 'la vista % quedó abierta al rol anónimo', v_vista;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_vista, 'select') then
      raise exception 'la vista % quedó cerrada para quien tiene sesión', v_vista;
    end if;
  end loop;
end $$;
