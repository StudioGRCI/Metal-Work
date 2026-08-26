-- =============================================================================
-- 013 · Blindaje: se cierran los agujeros que encontró la auditoría
-- =============================================================================
-- Todo lo de esta migración son defectos, no cambios de alcance. La revisión
-- del sistema encontró que:
--
--   · un operario podía volverse lector de todas las órdenes con un UPDATE
--     sobre su propio perfil, y por otra vía insertando una línea de horas
--   · seis funciones privilegiadas estaban abiertas a cualquier usuario con
--     sesión, sin comprobar un solo permiso: aprobar requerimientos y mover
--     stock a nombre de otro
--   · una OT se podía insertar directamente como ENTREGADA, saltándose las
--     tres puertas de cierre
--   · las etapas de una orden ya entregada o facturada se podían reabrir, y
--     eso movía su costo después de facturado
--   · un documento obligatorio que exige firmas contaba como presente aunque
--     no tuviera ninguna
--   · el número de documento se truncaba al pasar de cuatro cifras
--
-- Ninguno era explotable todavía porque el sistema no tiene aún ni una cuenta
-- creada. Dejan de no serlo el día que se dé de alta al personal.
-- =============================================================================


-- =============================================================================
-- GUARDA DE PERMISO REUTILIZABLE
-- =============================================================================

create or replace function public.exigir_permiso(p_permiso text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Sin sesión de usuario no hay a quién preguntarle permisos: es una conexión
  -- administrativa directa, la clave de servicio o una migración. Ahí el control
  -- lo da el acceso a la base, igual que la seguridad por fila, que el dueño de
  -- la tabla también se salta. El rol anónimo no entra por acá: ya no tiene
  -- permiso de ejecutar ninguna de estas funciones.
  if public.usuario_actual() is null then
    return;
  end if;

  if not (public.es_admin() or public.tiene_permiso(p_permiso)) then
    raise exception 'No tiene el permiso % para realizar esta operación', p_permiso
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function public.exigir_permiso(text) is
  'Detiene la operación si el usuario actual no tiene el permiso indicado. Es la guarda que llevan las funciones privilegiadas al inicio. Sin sesión de usuario no bloquea: ahí el control es el acceso a la base.';


-- =============================================================================
-- FUNCIONES PRIVILEGIADAS · se envuelven en lugar de reescribirse
-- =============================================================================
-- Estas funciones son SECURITY DEFINER, es decir que corren con los privilegios
-- del dueño y se saltan la seguridad por fila. Estaban otorgadas a todo usuario
-- con sesión sin comprobar un solo permiso.
--
-- Se les cambia el nombre y se crea en su lugar una función del nombre original
-- que primero exige el permiso y después llama a la interna. Así la guarda queda
-- a la vista y la lógica -que son miles de líneas- no se duplica ni se toca.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- función,                       firma completa,        tipos,          argumentos a pasar,        retorno,               permiso exigido
      ('confirmar_movimiento_almacen', 'p_movimiento uuid',    'uuid',         'p_movimiento',            'movimientos_almacen', 'almacen.confirmar'),
      ('anular_movimiento_almacen',    'p_movimiento uuid, p_motivo text',
                                                              'uuid, text',   'p_movimiento, p_motivo',  'movimientos_almacen', 'almacen.confirmar'),
      ('confirmar_recepcion',          'p_recepcion uuid',     'uuid',         'p_recepcion',             'recepciones',         'compras.recibir'),
      ('aprobar_requerimiento',        'p_requerimiento uuid, p_aprobador uuid',
                                                              'uuid, uuid',   'p_requerimiento, p_aprobador',
                                                                                                         'requerimientos',      'requerimientos.aprobar')
    ) as t(fn, firma, tipos, params, ret, permiso)
  loop
    -- Si la interna ya existe, la migración ya corrió: no hay nada que envolver.
    if to_regprocedure(format('public.%s_interna(%s)', r.fn, r.tipos)) is not null then
      continue;
    end if;

    execute format('alter function public.%I(%s) rename to %I',
                   r.fn, r.firma, r.fn || '_interna');

    execute format($f$
      create or replace function public.%I(%s)
      returns public.%I
      language plpgsql
      security definer
      set search_path = public
      as $cuerpo$
      begin
        perform public.exigir_permiso(%L);
        return public.%I(%s);
      end;
      $cuerpo$;
    $f$, r.fn, r.firma, r.ret, r.permiso, r.fn || '_interna', r.params);

    -- La interna deja de ser alcanzable: si quedara abierta, la guarda se
    -- podría rodear llamándola directamente por su nuevo nombre.
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated',
                   r.fn || '_interna', r.firma);

    execute format('grant execute on function public.%I(%s) to authenticated, service_role',
                   r.fn, r.firma);
  end loop;
end;
$$;


-- =============================================================================
-- FUNCIONES DE USO INTERNO · dejan de estar al alcance del usuario
-- =============================================================================
-- Estas las llaman los disparadores, que corren con los privilegios del dueño y
-- no necesitan el permiso del usuario. Que estuvieran otorgadas a cualquiera
-- con sesión permitía, por ejemplo, quemar correlativos sin grabar nada.

revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;
revoke all on function public.registrar_evento_ot(uuid, public.tipo_evento_ot, text, jsonb)
  from public, anon, authenticated;


-- =============================================================================
-- BITÁCORA Y ACCESOS · siguen siendo llamables, pero con guarda
-- =============================================================================
-- La aplicación sí las usa: la primera para anotar en la bitácora de la orden,
-- la segunda para dejar constancia de quién descargó un documento.

alter function public.ot_registrar_evento(uuid, public.tipo_evento_ot, text, jsonb, uuid, uuid)
  rename to ot_registrar_evento_interna;

create or replace function public.ot_registrar_evento(
  p_orden_id    uuid,
  p_tipo        public.tipo_evento_ot,
  p_descripcion text default null,
  p_datos       jsonb default null,
  p_etapa_id    uuid default null,
  p_usuario_id  uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nadie anota en la bitácora de una orden que no puede ver. Sin esto, un
  -- operario podía escribir en el historial de cualquier OT del taller.
  if not public.puede_ver_orden(p_orden_id) then
    raise exception 'No puede registrar eventos en una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;
  return public.ot_registrar_evento_interna(
    p_orden_id, p_tipo, p_descripcion, p_datos, p_etapa_id, p_usuario_id);
end;
$$;

-- Las funciones del propio esquema -disparadores y ayudantes como
-- crear_etapas_ot- pasan a llamar a la interna. No es un rodeo de la guarda: ya
-- corren dentro de una operación que la seguridad por fila autorizó, y volver a
-- preguntar ahí rompería la creación de órdenes desde un guion de administración
-- o desde la carga inicial de datos, donde no hay sesión de usuario.
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname not in ('ot_registrar_evento', 'ot_registrar_evento_interna')
       and pg_get_functiondef(p.oid) ~ 'public\.ot_registrar_evento[[:space:]]*\('
  loop
    v_def := pg_get_functiondef(f.oid);
    v_def := regexp_replace(v_def, 'public\.ot_registrar_evento[[:space:]]*\(',
                            'public.ot_registrar_evento_interna(', 'g');

    -- La interna ya no está al alcance del usuario, así que quien la llame tiene
    -- que correr con los privilegios del dueño. Es lo que hacía la función
    -- original antes de envolverla: escribir el historial no es algo que el
    -- usuario haga, es algo que el sistema hace por él.
    if v_def !~* 'SECURITY DEFINER' then
      v_def := regexp_replace(v_def, '(LANGUAGE plpgsql)',
                              E'\\1\n SECURITY DEFINER\n SET search_path TO ''public''', 'i');
    end if;

    execute v_def;
  end loop;
end;
$$;

revoke all on function public.ot_registrar_evento_interna(uuid, public.tipo_evento_ot, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ot_registrar_evento(uuid, public.tipo_evento_ot, text, jsonb, uuid, uuid)
  to authenticated, service_role;

alter function public.registrar_acceso_documento(uuid, public.tipo_acceso_documento, uuid, inet, text)
  rename to registrar_acceso_documento_interna;

create or replace function public.registrar_acceso_documento(
  p_documento_id uuid,
  p_tipo_acceso  public.tipo_acceso_documento,
  p_version_id   uuid default null,
  p_ip           inet default null,
  p_user_agent   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.exigir_permiso('documentos.ver');
  return public.registrar_acceso_documento_interna(
    p_documento_id, p_tipo_acceso, p_version_id, p_ip, p_user_agent);
end;
$$;

revoke all on function public.registrar_acceso_documento_interna(uuid, public.tipo_acceso_documento, uuid, inet, text)
  from public, anon, authenticated;
grant execute on function public.registrar_acceso_documento(uuid, public.tipo_acceso_documento, uuid, inet, text)
  to authenticated, service_role;


-- =============================================================================
-- PUERTA A · el usuario ya no puede tocar su propio alcance
-- =============================================================================
-- La versión anterior enumeraba lo prohibido -rol, sede, costo, estado- y todo
-- lo demás pasaba. Como OPERARIO ya trae permiso de ver órdenes, bastaba con
-- poner es_operario en false desde la consola del navegador para dejar de ser
-- operario a efectos de alcance y ver las órdenes de todo el taller.
--
-- Ahora se enumera lo permitido. La diferencia importa hacia adelante: la
-- próxima columna que agregue una migración nace protegida en vez de nacer
-- abierta.

create or replace function public.fn_usuario_proteger_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_admin() or public.tiene_permiso('usuarios.gestionar') then
    return new;
  end if;

  -- Sin permiso de gestión, uno solo edita sus propios datos de contacto.
  if new.id is distinct from old.id
     or new.codigo        is distinct from old.codigo
     or new.correo        is distinct from old.correo
     or new.documento     is distinct from old.documento
     or new.rol_id        is distinct from old.rol_id
     or new.sede_id       is distinct from old.sede_id
     or new.area_id       is distinct from old.area_id
     or new.es_operario   is distinct from old.es_operario
     or new.costo_hora    is distinct from old.costo_hora
     or new.activo        is distinct from old.activo
     or new.fecha_ingreso is distinct from old.fecha_ingreso then
    raise exception 'Solo un administrador puede cambiar el rol, el área, la sede, el costo por hora, el alcance o el estado de un usuario'
      using errcode = 'insufficient_privilege',
            hint = 'Puede editar sus nombres, apellidos, teléfono, cargo y foto.';
  end if;

  return new;
end;
$$;

comment on function public.fn_usuario_proteger_rol() is
  'Deja que un usuario edite solo sus datos de contacto. Enumera lo permitido y no lo prohibido, para que una columna nueva nazca protegida.';


-- =============================================================================
-- PUERTA B · las horas ya no amplían lo que uno puede ver
-- =============================================================================
-- puede_ver_orden() considera suya toda OT en la que el usuario haya registrado
-- horas. La política de inserción de líneas de parte solo exigía el permiso, sin
-- mirar la orden ni de quién eran las horas: bastaba insertar una línea con el
-- propio usuario_id sobre una orden ajena para que esa orden pasara a ser
-- visible. El insert no se escapaba de la política de lectura, la reescribía.

drop policy if exists crear_parte_detalle on public.parte_detalle;
create policy crear_parte_detalle on public.parte_detalle
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id)
    and (usuario_id = public.usuario_actual()
         or public.es_admin()
         or public.tiene_permiso('produccion.planificar'))
  );

drop policy if exists editar_parte_detalle on public.parte_detalle;
create policy editar_parte_detalle on public.parte_detalle
  for update to authenticated
  using (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id)
  )
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id)
    and (usuario_id = public.usuario_actual()
         or public.es_admin()
         or public.tiene_permiso('produccion.planificar'))
  );


-- =============================================================================
-- LA ORDEN NO NACE ENTREGADA
-- =============================================================================
-- Las tres puertas de cierre -etapas terminadas, acta de conformidad y
-- documentación obligatoria- viven en el disparador de actualización. Insertar
-- la fila directamente en ENTREGADA o FACTURADA las saltaba todas.

create or replace function public.fn_ot_estado_inicial()
returns trigger
language plpgsql
as $$
begin
  if new.estado not in ('BORRADOR', 'APROBADA') then
    raise exception 'Una orden nace en BORRADOR o APROBADA, no en %', new.estado
      using errcode = 'check_violation',
            hint = 'El resto de estados se alcanzan avanzando la orden, no creándola ya avanzada.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ot_estado_inicial on public.ordenes_trabajo;
create trigger trg_ot_estado_inicial
  before insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_estado_inicial();


-- =============================================================================
-- UNA ORDEN ENTREGADA YA NO SE MUEVE
-- =============================================================================
-- Se podían reabrir las etapas de una orden entregada o facturada, y con eso
-- imputarle horas. El costo real de la unidad cambiaba después de emitida la
-- factura, que es exactamente lo que la contabilidad no puede permitir.

create or replace function public.fn_ot_etapa_orden_cerrada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado public.estado_ot;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.ordenes_trabajo where id = new.orden_id;

  if v_estado in ('ENTREGADA', 'FACTURADA')
     and (new.estado is distinct from old.estado
          or new.avance_porcentaje is distinct from old.avance_porcentaje
          or new.horas_reales is distinct from old.horas_reales) then
    raise exception 'La OT % ya fue entregada: sus etapas no se pueden reabrir ni reimputar', v_numero
      using errcode = 'check_violation',
            hint = 'Un trabajo posterior a la entrega se registra como garantía, no modificando la orden original.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ot_etapa_orden_cerrada on public.ot_etapas;
create trigger trg_ot_etapa_orden_cerrada
  before update on public.ot_etapas
  for each row execute function public.fn_ot_etapa_orden_cerrada();


-- =============================================================================
-- CALIDAD PUEDE DEVOLVER UNA ETAPA YA CERRADA
-- =============================================================================
-- Es el caso que motivó el estado REQUIERE_REVISION y el disparador lo impedía:
-- solo dejaba reabrir una etapa terminada como EN_PROCESO. Si calidad encuentra
-- un defecto después de que el área la dio por cerrada, tiene que poder
-- devolverla.
--
-- La condición vive dentro de fn_ot_etapa_antes_update, que son varios cientos
-- de líneas. En vez de copiarla entera -y arriesgarse a que la copia se
-- desactualice- se reemplaza esa única condición sobre la definición viva. Si el
-- texto esperado no aparece, la migración se detiene en lugar de seguir de largo
-- creyendo que hizo algo.

do $$
declare
  v_def    text;
  v_viejo  text := 'if old.estado = ''TERMINADA'' and new.estado <> ''EN_PROCESO'' then';
  v_nuevo  text := 'if old.estado = ''TERMINADA'' and new.estado not in (''EN_PROCESO'', ''REQUIERE_REVISION'') then';
  v_msg_v  text := 'solo puede reabrirse como EN_PROCESO';
  v_msg_n  text := 'solo puede reabrirse como EN_PROCESO o devolverse como REQUIERE_REVISION';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_ot_etapa_antes_update';

  if v_def is null then
    raise exception 'No existe public.fn_ot_etapa_antes_update()';
  end if;

  -- Ya aplicada: nada que hacer.
  if position(v_nuevo in v_def) > 0 then
    return;
  end if;

  if position(v_viejo in v_def) = 0 then
    raise exception 'fn_ot_etapa_antes_update no contiene la condición esperada; revisar a mano antes de continuar';
  end if;

  v_def := replace(v_def, v_viejo, v_nuevo);
  v_def := replace(v_def, v_msg_v, v_msg_n);
  execute v_def;
end;
$$;


-- =============================================================================
-- UN DOCUMENTO OBLIGATORIO SIN FIRMAR NO CUENTA COMO PRESENTE
-- =============================================================================
-- documentos_obligatorios_faltantes() daba por cumplido un tipo de documento
-- con solo existir una versión vigente. Si además exige aprobación, existir no
-- alcanza: la orden se entregaba con el plano sin aprobar.

create or replace function public.documentos_obligatorios_faltantes(p_orden_id uuid)
returns table (tipo_documento_id uuid, codigo text, nombre text)
language sql
stable
as $$
  select t.id, t.codigo, t.nombre
    from public.tipos_documento t
   where t.activo
     and t.obligatorio_para_cierre
     and not exists (
       select 1
         from public.documentos d
        where d.tipo_documento_id = t.id
          and d.orden_id = p_orden_id
          and d.estado = 'VIGENTE'
          and d.version_actual > 0
          -- Aquí estaba el defecto. estado_aprobacion queda en nulo mientras el
          -- documento no tenga ninguna firma, y el "is null" lo daba por bueno:
          -- un tipo que exige aprobación pasaba justamente por no tener ninguna.
          -- Ahora el nulo solo vale para los tipos que no exigen firmas.
          and (case when t.requiere_aprobacion
                    then d.estado_aprobacion = 'APROBADO'
                    else d.estado_aprobacion is null or d.estado_aprobacion = 'APROBADO'
               end)
     )
   order by t.orden_visualizacion, t.codigo;
$$;

comment on function public.documentos_obligatorios_faltantes is
  'Documentación pendiente de una OT. Devuelve vacío cuando la orden está en condiciones de entregarse. Un tipo que exige firmas solo cuenta cuando las tiene todas.';


-- =============================================================================
-- EL NÚMERO DE DOCUMENTO YA NO SE TRUNCA
-- =============================================================================
-- lpad() recorta cuando el texto es más largo que el ancho pedido. Con longitud
-- 4, la orden de compra 10000 salía como "1000" -el número de una que ya existe.
-- Faltaban 4.420 órdenes para llegar, pero el correlativo dejaría de ser único
-- justo cuando más documentos hubiera.

create or replace function public.siguiente_correlativo(
  p_tipo  public.tipo_correlativo,
  p_serie text default null,
  p_sede  uuid default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serie_id  uuid;
  v_serie     text;
  v_prefijo   text;
  v_longitud  int;
  v_formato   text;
  v_numero    bigint;
  v_texto     text;
  v_resultado text;
begin
  if p_sede is not null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo and (p_serie is null or serie = p_serie)
       and activo and sede_id = p_sede
     order by serie limit 1 for update;
  end if;

  if v_serie_id is null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo and (p_serie is null or serie = p_serie)
       and activo and sede_id is null
     order by serie limit 1 for update;
  end if;

  if v_serie_id is null then
    raise exception 'No existe una serie documentaria activa para el tipo % (serie %, sede %)',
      p_tipo, coalesce(p_serie, '<cualquiera>'), coalesce(p_sede::text, '<global>')
      using errcode = 'no_data_found';
  end if;

  update public.series_documentarias
     set correlativo_actual = correlativo_actual + 1,
         actualizado_en = now()
   where id = v_serie_id
  returning serie, prefijo, longitud, correlativo_actual, formato
    into v_serie, v_prefijo, v_longitud, v_numero, v_formato;

  -- El relleno con ceros nunca recorta: si el número ya superó el ancho de la
  -- serie, se emite completo. Un número largo es feo; uno truncado es un
  -- duplicado.
  v_texto := v_numero::text;
  if length(v_texto) < v_longitud then
    v_texto := lpad(v_texto, v_longitud, '0');
  end if;

  v_resultado := replace(v_formato,    '{numero}',  v_texto);
  v_resultado := replace(v_resultado,  '{serie}',   v_serie);
  v_resultado := replace(v_resultado,  '{anio}',    to_char(now(), 'YYYY'));
  v_resultado := replace(v_resultado,  '{prefijo}', coalesce(nullif(v_prefijo, ''), ''));

  v_resultado := btrim(v_resultado, '-');
  return regexp_replace(v_resultado, '-{2,}', '-', 'g');
end;
$$;

revoke all on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid)
  from public, anon, authenticated;
grant execute on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid)
  to service_role;


-- =============================================================================
-- PERMISOS DE TABLA DE LOS CATÁLOGOS NUEVOS
-- =============================================================================
-- Las tablas creadas en la 012 tenían políticas pero nunca recibieron el
-- permiso de tabla, así que nadie podía leerlas.

grant select on public.areas, public.tipos_documento_sig to authenticated;
grant insert, update, delete on public.areas, public.tipos_documento_sig to authenticated;
revoke all on public.areas, public.tipos_documento_sig from anon;


-- =============================================================================
-- SE REHACE EL ENDURECIMIENTO
-- =============================================================================
-- Crear o reemplazar una función vuelve a otorgar EXECUTE a PUBLIC, y anon
-- hereda de ahí. La migración 010 ya había cerrado esto, pero cada función que
-- se toca lo reabre. Por eso se rehace al final de toda migración que redefina
-- funciones, en vez de darlo por hecho.
--
-- No se otorga en bloque a authenticated: las internas y las de uso de los
-- disparadores tienen que seguir fuera de su alcance.

do $$
declare
  f record;
  v_internas text[] := array[
    'crear_etapas_ot', 'registrar_evento_ot', 'siguiente_correlativo',
    'activar_auditoria', 'activar_timestamps'
  ];
begin
  for f in
    select p.oid,
           p.proname,
           t.typname = 'trigger' as es_disparador,
           format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public'
       and p.prokind = 'f'
       -- Las funciones que trae una extensión no son nuestras: Postgres las
       -- gestiona con la extensión y revocarlas rompería el complemento.
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
       )
  loop
    execute format('revoke all on function %s from public, anon', f.firma);

    -- Postgres no comprueba EXECUTE para invocar una función de disparador: la
    -- ejecuta el propio motor. Así que se les quita a todos y no se otorga a
    -- nadie, y los disparadores siguen funcionando igual.
    if f.es_disparador then
      execute format('revoke all on function %s from authenticated', f.firma);
    elsif f.proname = any(v_internas) or f.proname like '%\_interna' then
      execute format('revoke all on function %s from authenticated', f.firma);
      execute format('grant execute on function %s to service_role', f.firma);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.firma);
    end if;
  end loop;
end;
$$;

alter default privileges in schema public revoke execute on functions from public;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

do $$
declare
  v_abiertas int;
  v_anon     int;
begin
  -- Ninguna función privilegiada que mute estado puede quedar sin guarda.
  select count(*) into v_abiertas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
   where n.nspname = 'public'
     and p.prosecdef
     and t.typname <> 'trigger'
     and has_function_privilege('authenticated', p.oid, 'execute')
     and pg_get_functiondef(p.oid) ~* '(insert into|update |delete from)'
     and pg_get_functiondef(p.oid) !~* '(tiene_permiso|es_admin|exigir_permiso|puede_ver_orden)'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
     );
  if v_abiertas > 0 then
    raise exception 'Quedaron % funciones privilegiadas que mutan estado sin comprobar permisos', v_abiertas;
  end if;

  -- Y el rol anónimo no ejecuta nada del esquema.
  select count(*) into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     -- Las de extensiones quedan fuera: son del complemento, no del esquema, y
     -- Supabase instala varias en public que no nos toca gestionar.
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
     );
  if v_anon > 0 then
    raise exception 'El rol anon todavía puede ejecutar % funciones', v_anon;
  end if;
end;
$$;
