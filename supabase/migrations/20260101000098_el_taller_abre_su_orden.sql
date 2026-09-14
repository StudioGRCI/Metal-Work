-- =============================================================================
-- EL TALLER ABRE SU ORDEN, Y EL JEFE DE PRODUCCIÓN LA REVISA
-- -----------------------------------------------------------------------------
-- «Que los supervisores puedan crear su OT a revisar, cargarla… o que el jefe
-- pueda hacer eso también.» Hasta hoy una orden nacía solo en la oficina —de la
-- cotización o a mano— y la aprobaba Gerencia. Lo que llega al taller sin
-- papeles quedaba como «trabajo sin orden», sin etapas ni plazos.
--
-- Ahora el supervisor, el jefe de producción o el de taller abren la orden desde
-- el taller: el cliente, la unidad y qué hay que hacer. Nace en borrador,
-- marcada como abierta en el taller, y queda «por revisar»: la aprueba o la
-- rechaza el jefe de producción, no Gerencia. Mientras espera ya se le arma la
-- lista de actividades y se reporta, porque el trabajo no para por el papel.
-- Aprobada, sigue el camino de cualquier orden: nacen sus etapas y sus plazos.
--
-- Lo de la oficina no cambia: una orden de cotización o hecha a mano la sigue
-- aprobando Gerencia, y el jefe de producción no puede aprobarla.
-- =============================================================================

-- =============================================================================
-- 1. LOS PERMISOS
-- =============================================================================
insert into public.permisos (codigo, modulo, descripcion) values
  ('ordenes.abrir_taller', 'Órdenes de trabajo',
   'Abrir desde el taller una orden de trabajo, que queda por revisar'),
  ('ordenes.revisar_taller', 'Órdenes de trabajo',
   'Aprobar o rechazar las órdenes que abrió el taller')
on conflict (codigo) do update set descripcion = excluded.descripcion, modulo = excluded.modulo;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join (values ('SUPERVISOR', 'ordenes.abrir_taller'),
               ('JEFE_PRODUCCION', 'ordenes.abrir_taller'),
               ('JEFE_TALLER', 'ordenes.abrir_taller'),
               ('JEFE_PRODUCCION', 'ordenes.revisar_taller'),
               ('JEFE_TALLER', 'ordenes.revisar_taller')) as p(rol, codigo)
    on p.rol = r.codigo
on conflict do nothing;

-- =============================================================================
-- 2. LA MARCA DE LA ORDEN
-- -----------------------------------------------------------------------------
-- De ella depende quién la aprueba, así que la pone la base y no se cambia:
-- si se pudiera marcar después, una orden de la oficina se volvería aprobable
-- por el jefe con solo tocar una casilla.
-- =============================================================================
alter table public.ordenes_trabajo
  add column if not exists abierta_en_taller boolean not null default false;

comment on column public.ordenes_trabajo.abierta_en_taller is
  'La abrió el taller (ordenes.abrir_taller) y no la oficina. Mientras está en borrador queda por revisar, y la aprueba o la rechaza quien tiene ordenes.revisar_taller. No cambia después de creada.';

create or replace function public.fn_ot_del_taller()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    if new.abierta_en_taller is distinct from old.abierta_en_taller then
      raise exception 'Que la orden % la abrió el taller no se cambia después.', old.numero
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.abierta_en_taller then
    -- Sin sesión (migraciones, clave de servicio) manda el acceso a la base,
    -- igual que en exigir_permiso.
    if public.usuario_actual() is not null
       and not (public.es_admin() or public.tiene_permiso('ordenes.abrir_taller')) then
      raise exception 'Las órdenes del taller las abre el supervisor o el jefe de producción.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.estado <> 'BORRADOR' or new.cotizacion_id is not null then
      raise exception 'Una orden del taller nace por revisar y sin cotización.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_del_taller() from public, anon, authenticated;

drop trigger if exists trg_ot_del_taller on public.ordenes_trabajo;
create trigger trg_ot_del_taller before insert or update on public.ordenes_trabajo
  for each row execute function public.fn_ot_del_taller();

-- =============================================================================
-- 3. QUIÉN LA APRUEBA Y QUIÉN LA RECHAZA
-- -----------------------------------------------------------------------------
-- Se reescribe desde el texto vivo de producción y solo se le suma el atajo:
-- una orden del taller que sigue por revisar la aprueba o la rechaza quien
-- tiene ordenes.revisar_taller. Todo lo demás, igual que antes.
-- =============================================================================
create or replace function public.fn_ot_permiso_por_estado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado then
    if old.abierta_en_taller
       and old.estado = 'BORRADOR'
       and new.estado in ('APROBADA', 'ANULADA')
       and public.tiene_permiso('ordenes.revisar_taller') then
      return new;
    end if;

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

-- La política de UPDATE suma el permiso con que se revisa. El jefe de
-- producción ya pasa por ordenes.cambiar_estado; esto es para que el permiso
-- que exige la acción y el que acepta la política sean el mismo.
drop policy if exists editar_ordenes_trabajo on public.ordenes_trabajo;
create policy editar_ordenes_trabajo on public.ordenes_trabajo
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('ordenes.editar')
         or public.tiene_permiso('ordenes.cambiar_estado')
         or public.tiene_permiso('ordenes.aprobar')
         or public.tiene_permiso('ordenes.anular')
         or public.tiene_permiso('ordenes.entregar')
         or public.tiene_permiso('ordenes.revisar_taller'))
  with check (public.es_admin()
              or public.tiene_permiso('ordenes.editar')
              or public.tiene_permiso('ordenes.cambiar_estado')
              or public.tiene_permiso('ordenes.aprobar')
              or public.tiene_permiso('ordenes.anular')
              or public.tiene_permiso('ordenes.entregar')
              or public.tiene_permiso('ordenes.revisar_taller'));

-- Cuando el jefe la aprueba o la rechaza, le llega a quien la abrió. Disparador
-- propio, sin tocar fn_ot_despues_update (la regla del blindaje).
create or replace function public.fn_ot_del_taller_revisada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not old.abierta_en_taller or old.estado <> 'BORRADOR'
     or new.estado not in ('APROBADA', 'ANULADA') then
    return null;
  end if;

  perform public.notificar_a_usuario(
    new.creado_por,
    case when new.estado = 'APROBADA' then 'El jefe aprobó tu orden'
         else 'El jefe rechazó tu orden' end,
    case when new.estado = 'APROBADA'
         then format('La %s ya tiene sus etapas y sus plazos.', new.numero)
         else format('La %s quedó anulada: %s', new.numero, coalesce(new.motivo_anulacion, 'sin motivo')) end,
    '/ordenes/' || new.id,
    'ordenes_trabajo',
    new.id,
    public.usuario_actual());
  return null;
end;
$$;

revoke all on function public.fn_ot_del_taller_revisada() from public, anon, authenticated;

drop trigger if exists trg_ot_del_taller_revisada on public.ordenes_trabajo;
create trigger trg_ot_del_taller_revisada after update of estado on public.ordenes_trabajo
  for each row execute function public.fn_ot_del_taller_revisada();

-- =============================================================================
-- 4. ABRIR LA ORDEN
-- -----------------------------------------------------------------------------
-- Una función y no un INSERT desde la pantalla: la unidad se busca por su
-- placa entre las del cliente, y si no está se registra, y el taller no escribe
-- en unidades (clientes.editar). Todo junto o nada: no queda una unidad suelta
-- si la orden no entra.
-- =============================================================================
create or replace function public.abrir_orden_del_taller(
  p_cliente       uuid,
  p_placa         text,
  p_tipo_vehiculo public.tipo_vehiculo,
  p_marca         text,
  p_modelo        text,
  p_trabajo       text,
  p_tipo_trabajo  public.tipo_trabajo_ot default 'REPARACION',
  p_prioridad     public.prioridad_ot default 'NORMAL')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_clave  constant text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa  text;
  v_unidad uuid;
  v_nombre text;
  v_abierta text;
  v_sede   uuid;
  v_orden  uuid;
  v_numero text;
  v_quien  text;
begin
  if public.usuario_actual() is null then
    raise exception 'Hace falta entrar con tu cuenta para abrir una orden.'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.exigir_permiso('ordenes.abrir_taller');

  if not exists (select 1 from public.clientes c where c.id = p_cliente and c.activo) then
    raise exception 'Elige el cliente de la lista.' using errcode = 'foreign_key_violation';
  end if;
  if length(btrim(coalesce(p_trabajo, ''))) < 5 then
    raise exception 'Cuenta qué se va a hacer.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe la placa, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  -- «abc123» y «ABC-123» son la misma placa: se busca sin guiones ni espacios,
  -- y la que se registra queda con el guion de siempre.
  if v_clave <> '' then
    v_placa := case when length(v_clave) = 6 and position('-' in p_placa) = 0
                    then left(v_clave, 3) || '-' || right(v_clave, 3)
                    else upper(btrim(p_placa)) end;

    select u.id into v_unidad
      from public.unidades u
     where u.cliente_id = p_cliente
       and upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     limit 1;
  end if;

  -- Una orden abierta por unidad: si ya está en el taller, se trabaja en esa.
  if v_unidad is not null then
    select o.numero into v_abierta
      from public.ordenes_trabajo o
     where o.unidad_id = v_unidad
       and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
     order by o.creado_en desc
     limit 1;
    if v_abierta is not null then
      raise exception 'La unidad % ya tiene la orden % abierta: repórtala ahí.', v_placa, v_abierta
        using errcode = 'unique_violation';
    end if;
  else
    insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
    values (p_cliente, v_placa, coalesce(p_tipo_vehiculo, 'OTRO'),
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion,
    estado, abierta_en_taller)
  values (
    p_cliente, v_unidad, v_sede, coalesce(p_tipo_trabajo, 'REPARACION'), coalesce(p_prioridad, 'NORMAL'),
    btrim(p_trabajo), 'BORRADOR', true)
  returning id, numero into v_orden, v_numero;

  select nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
    into v_quien
    from public.usuarios u where u.id = public.usuario_actual();

  v_nombre := coalesce(v_placa, nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  perform public.notificar_a_permiso(
    'ordenes.revisar_taller',
    'Orden por revisar',
    format('%s abrió la %s (%s): %s', coalesce(v_quien, 'El taller'), v_numero,
           coalesce(v_nombre, 'sin placa'), left(btrim(p_trabajo), 140)),
    '/ordenes/' || v_orden,
    'ordenes_trabajo',
    v_orden,
    public.usuario_actual());

  return v_orden;
end;
$$;

revoke all on function public.abrir_orden_del_taller(uuid, text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)
  from public, anon;
grant execute on function public.abrir_orden_del_taller(uuid, text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)
  to authenticated;

-- Los clientes para elegir al abrirla: solo el nombre. El taller sigue sin
-- clientes.ver —a él le llegan los avances, no los datos del cliente—, pero
-- para abrir una orden tiene que decir de quién es.
create or replace function public.clientes_para_el_taller()
returns table (id uuid, razon_social text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.razon_social
    from public.clientes c
   where c.activo
     and (public.es_admin() or public.tiene_permiso('ordenes.abrir_taller'))
   order by c.razon_social
   limit 500;
$$;

revoke all on function public.clientes_para_el_taller() from public, anon;
grant execute on function public.clientes_para_el_taller() to authenticated;

-- =============================================================================
-- 5. LA UNIDAD, A LA VISTA DEL TALLER
-- -----------------------------------------------------------------------------
-- El taller no veía las unidades —la política pedía clientes.ver— y cada
-- tarjeta de una orden le salía sin placa: trabajaba en unidades sin nombre.
-- Una unidad es la placa, la marca y el chasis; de quién es sigue escondido.
-- =============================================================================
drop policy if exists ver_unidades on public.unidades;
create policy ver_unidades on public.unidades
  for select to authenticated
  using (public.es_admin()
         or public.tiene_permiso('clientes.ver')
         or public.tiene_permiso('produccion.ver'));

-- =============================================================================
-- 6. EN EL TABLERO MIENTRAS ESPERA, Y LA MARCA EN LAS VISTAS
-- -----------------------------------------------------------------------------
-- La del taller entra al tablero desde que se abre: se trabaja mientras la
-- revisan. Las de la oficina, como antes, desde que se aprueban. Las dos
-- vistas suman la marca al final.
-- =============================================================================
create or replace view public.unidad_tablero as
select o.id as orden_id,
       o.numero as orden_numero,
       o.estado as orden_estado,
       o.prioridad,
       o.sede_id,
       o.unidad_id,
       u.placa,
       u.tipo_vehiculo,
       u.marca,
       u.modelo,
       c.id as cliente_id,
       c.razon_social as cliente,
       tc.nombre as tipo_carroceria,
       o.descripcion,
       o.avance_porcentaje,
       o.fecha_entrega_comprometida,
       public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida) as dias_habiles_restantes,
       (r.nombres || ' '::text) || r.apellidos as responsable,
       actual.etapa as etapa_actual,
       actual.estado_etapa,
       actual.avance_etapa,
       ultimo.fecha as ultimo_avance_fecha,
       ultimo.descripcion as ultimo_avance,
       current_date - ultimo.fecha as dias_sin_avance,
       ultimo.impedimento,
       coalesce(fotos.total, 0) as fotos,
       o.abierta_en_taller
  from public.ordenes_trabajo o
  left join public.clientes c on c.id = o.cliente_id
  left join public.unidades u on u.id = o.unidad_id
  left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
  left join public.usuarios r on r.id = o.responsable_id
  left join lateral (
    select ec.nombre as etapa, oe.estado as estado_etapa, oe.avance_porcentaje as avance_etapa
      from public.ot_etapas oe
      join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
     where oe.orden_id = o.id and oe.estado = any (array['EN_PROCESO'::public.estado_etapa_ot, 'PENDIENTE'::public.estado_etapa_ot])
     order by (oe.estado = 'EN_PROCESO'::public.estado_etapa_ot) desc, oe.orden_secuencia
     limit 1
  ) actual on true
  left join lateral (
    select a.fecha, a.descripcion, a.impedimento
      from public.ot_avances a
     where a.orden_id = o.id
     order by a.fecha desc, a.creado_en desc
     limit 1
  ) ultimo on true
  left join lateral (
    select count(*)::integer as total
      from public.ot_avances a
      join public.ot_avance_fotos f on f.avance_id = a.id
     where a.orden_id = o.id
  ) fotos on true
 where o.estado = any (array['APROBADA'::public.estado_ot, 'PROGRAMADA'::public.estado_ot, 'EN_PROCESO'::public.estado_ot,
                             'PAUSADA'::public.estado_ot, 'CONTROL_CALIDAD'::public.estado_ot, 'TERMINADA'::public.estado_ot])
    or (o.estado = 'BORRADOR'::public.estado_ot and o.abierta_en_taller);

alter view public.unidad_tablero set (security_invoker = on);
grant select on public.unidad_tablero to authenticated;

create or replace view public.ot_resumen as
select o.id,
       o.numero,
       o.estado,
       o.prioridad,
       o.tipo_trabajo,
       o.sede_id,
       s.nombre as sede,
       o.cliente_id,
       c.razon_social as cliente,
       c.numero_documento as cliente_documento,
       o.unidad_id,
       u.placa,
       tc.nombre as tipo_carroceria,
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
       o.horas_reales::numeric - o.horas_estimadas::numeric as desviacion_horas,
       o.moneda,
       o.monto_presupuestado,
       o.responsable_id,
       (r.nombres || ' '::text) || r.apellidos as responsable,
       count(e.id) as etapas_total,
       count(e.id) filter (where e.estado = 'TERMINADA'::public.estado_etapa_ot) as etapas_terminadas,
       count(e.id) filter (where e.estado = 'EN_PROCESO'::public.estado_etapa_ot) as etapas_en_proceso,
       case
         when o.estado = any (array['ENTREGADA'::public.estado_ot, 'FACTURADA'::public.estado_ot, 'ANULADA'::public.estado_ot]) then 0
         when o.fecha_entrega_comprometida is null then 0
         else greatest(current_date - o.fecha_entrega_comprometida, 0)
       end as dias_atraso,
       case
         when o.estado = any (array['ENTREGADA'::public.estado_ot, 'FACTURADA'::public.estado_ot, 'ANULADA'::public.estado_ot]) then null::integer
         when o.fecha_entrega_comprometida is null then null::integer
         else public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida)
       end as dias_habiles_restantes,
       u.codigo_interno,
       u.numero_chasis,
       u.marca,
       u.modelo,
       o.abierta_en_taller
  from public.ordenes_trabajo o
  left join public.clientes c on c.id = o.cliente_id
  left join public.sedes s on s.id = o.sede_id
  left join public.unidades u on u.id = o.unidad_id
  left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
  left join public.usuarios r on r.id = o.responsable_id
  left join public.ot_etapas e on e.orden_id = o.id
 group by o.id, c.id, s.id, u.id, tc.id, r.id;

alter view public.ot_resumen set (security_invoker = on);
grant select on public.ot_resumen to authenticated;

-- =============================================================================
-- 7. COMPROBACIONES
-- =============================================================================
do $$
declare v_falta text;
begin
  select string_agg(p.rol || ' sin ' || p.codigo, ', ') into v_falta
    from (values ('SUPERVISOR', 'ordenes.abrir_taller'),
                 ('JEFE_PRODUCCION', 'ordenes.abrir_taller'),
                 ('JEFE_PRODUCCION', 'ordenes.revisar_taller')) as p(rol, codigo)
   where not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                      where r.codigo = p.rol and rp.permiso_codigo = p.codigo);
  if v_falta is not null then
    raise exception 'Quedaron puertas tapiadas: %', v_falta;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_ot_del_taller'
                  and tgrelid = 'public.ordenes_trabajo'::regclass) then
    raise exception 'Falta el disparador que cuida la marca de la orden del taller';
  end if;

  select string_agg(c.relname, ', ') into v_falta
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and c.relname in ('unidad_tablero', 'ot_resumen')
     and coalesce(array_to_string(c.reloptions, ','), '') not similar to '%security_invoker=(on|true)%';
  if v_falta is not null then
    raise exception 'Estas vistas corren como su dueño y se saltan el RLS: %', v_falta;
  end if;

  if has_function_privilege('anon', 'public.abrir_orden_del_taller(uuid, text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)', 'execute')
     or has_function_privilege('anon', 'public.clientes_para_el_taller()', 'execute') then
    raise exception 'Una función del taller quedó abierta al rol anónimo';
  end if;
end $$;
