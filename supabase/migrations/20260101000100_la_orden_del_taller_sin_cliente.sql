-- =============================================================================
-- LA ORDEN DEL TALLER NO PIDE CLIENTE
-- -----------------------------------------------------------------------------
-- «Que no pida datos de cliente, pues eso no ven: solo ven la flota y lo que
-- les designa Diseño.» La 098 le pedía al supervisor elegir de quién era la
-- unidad, y el taller no maneja clientes: conoce la unidad por su placa y el
-- trabajo por lo que le toca hacer.
--
-- Ahora la orden que abre el taller nace sin cliente si la unidad no lo tiene.
-- La unidad se busca por su placa entre todas; si ya está registrada, la orden
-- toma su cliente. Si no está, se registra sin dueño. El cliente lo pone
-- después la oficina, desde la orden (poner_cliente_a_orden), cuando haga
-- falta: para cobrar, entregar o cotizar. El jefe de producción la aprueba sin
-- él, porque tampoco lo ve.
--
-- Una orden de la oficina sigue naciendo con cliente: solo la del taller
-- puede no tenerlo.
-- =============================================================================

-- =============================================================================
-- 1. SIN CLIENTE, SOLO LO DEL TALLER
-- =============================================================================
alter table public.ordenes_trabajo alter column cliente_id drop not null;

alter table public.ordenes_trabajo drop constraint if exists ck_ot_cliente_o_del_taller;
alter table public.ordenes_trabajo add constraint ck_ot_cliente_o_del_taller
  check (cliente_id is not null or abierta_en_taller);

comment on column public.ordenes_trabajo.cliente_id is
  'De quién es. Obligatorio salvo en las órdenes que abre el taller: esas pueden nacer sin él y la oficina lo pone después (poner_cliente_a_orden).';

alter table public.unidades alter column cliente_id drop not null;

comment on column public.unidades.cliente_id is
  'De quién es la unidad. Vacío solo en las que registró el taller al abrir una orden; la oficina lo pone al ponerle cliente a esa orden.';

-- Una misma placa no se registra dos veces sin dueño: la segunda vez que el
-- taller la escribe, es la misma unidad. Sin guiones ni espacios, como se busca.
create unique index if not exists uq_unidades_placa_sin_cliente
  on public.unidades (upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')))
  where cliente_id is null and placa is not null;

-- =============================================================================
-- 2. ABRIR LA ORDEN, SIN CLIENTE
-- -----------------------------------------------------------------------------
-- Sale la versión de la 098, que pedía el cliente; la pantalla nueva ya no lo
-- manda. Y sale la lista de clientes para el taller, que ya no hace falta.
-- =============================================================================
drop function if exists public.abrir_orden_del_taller(uuid, text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot);
drop function if exists public.clientes_para_el_taller();

create or replace function public.abrir_orden_del_taller(
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
  v_clave   constant text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa   text;
  v_unidad  uuid;
  v_cliente uuid;
  v_nombre  text;
  v_abierta text;
  v_sede    uuid;
  v_orden   uuid;
  v_numero  text;
  v_quien   text;
begin
  if public.usuario_actual() is null then
    raise exception 'Hace falta entrar con tu cuenta para abrir una orden.'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.exigir_permiso('ordenes.abrir_taller');

  if length(btrim(coalesce(p_trabajo, ''))) < 5 then
    raise exception 'Cuenta qué se va a hacer.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe la placa, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  -- «abc123» y «ABC-123» son la misma placa: se busca sin guiones ni espacios
  -- entre todas las unidades, y la que se registra queda con el guion de siempre.
  if v_clave <> '' then
    v_placa := case when length(v_clave) = 6 and position('-' in p_placa) = 0
                    then left(v_clave, 3) || '-' || right(v_clave, 3)
                    else upper(btrim(p_placa)) end;

    select u.id, u.cliente_id into v_unidad, v_cliente
      from public.unidades u
     where upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     order by u.activo desc, u.creado_en desc
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
    values (null, v_placa, coalesce(p_tipo_vehiculo, 'OTRO'),
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion,
    estado, abierta_en_taller)
  values (
    v_cliente, v_unidad, v_sede, coalesce(p_tipo_trabajo, 'REPARACION'), coalesce(p_prioridad, 'NORMAL'),
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

revoke all on function public.abrir_orden_del_taller(text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)
  from public, anon;
grant execute on function public.abrir_orden_del_taller(text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)
  to authenticated;

-- =============================================================================
-- 3. LA OFICINA LE PONE EL CLIENTE
-- -----------------------------------------------------------------------------
-- Con ordenes.editar, que es quien hace las órdenes en la oficina. Pone el
-- cliente a la orden y, si la unidad no tenía dueño, a la unidad. Si ese
-- cliente ya tenía registrada la misma placa, la orden pasa a esa unidad y la
-- registrada por el taller queda inactiva: es la misma unidad, dos veces.
-- Una unidad que ya es de otro cliente no cambia de dueño por esta vía.
-- =============================================================================
create or replace function public.poner_cliente_a_orden(p_orden uuid, p_cliente uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden   record;
  v_unidad  record;
  v_misma   uuid;
  v_nombre  text;
begin
  perform public.exigir_permiso('ordenes.editar');

  select o.id, o.numero, o.cliente_id, o.unidad_id, o.estado into v_orden
    from public.ordenes_trabajo o where o.id = p_orden
     for update;
  if v_orden.id is null then
    raise exception 'No se encontró la orden.' using errcode = 'foreign_key_violation';
  end if;
  if v_orden.cliente_id is not null then
    raise exception 'La orden % ya tiene cliente.', v_orden.numero using errcode = 'check_violation';
  end if;
  if v_orden.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then
    raise exception 'La orden % ya está cerrada.', v_orden.numero using errcode = 'check_violation';
  end if;

  select c.razon_social into v_nombre from public.clientes c where c.id = p_cliente and c.activo;
  if v_nombre is null then
    raise exception 'Elige el cliente de la lista.' using errcode = 'foreign_key_violation';
  end if;

  if v_orden.unidad_id is not null then
    select u.id, u.cliente_id, u.placa into v_unidad
      from public.unidades u where u.id = v_orden.unidad_id
       for update;

    if v_unidad.cliente_id is not null and v_unidad.cliente_id <> p_cliente then
      raise exception 'La unidad % es de otro cliente: la orden no puede ser de %.', v_unidad.placa, v_nombre
        using errcode = 'check_violation';
    end if;

    if v_unidad.cliente_id is null then
      select u.id into v_misma
        from public.unidades u
       where u.cliente_id = p_cliente
         and v_unidad.placa is not null
         and upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(v_unidad.placa, '[^A-Za-z0-9]', '', 'g'))
       limit 1;

      if v_misma is not null then
        update public.ordenes_trabajo set unidad_id = v_misma where id = p_orden;
        update public.unidades set activo = false where id = v_unidad.id;
      else
        update public.unidades set cliente_id = p_cliente where id = v_unidad.id;
      end if;
    end if;
  end if;

  update public.ordenes_trabajo set cliente_id = p_cliente where id = p_orden;

  perform public.ot_registrar_evento(
    p_orden, 'COMENTARIO', format('Se le puso el cliente: %s.', v_nombre),
    jsonb_build_object('cliente_id', p_cliente));
end;
$$;

revoke all on function public.poner_cliente_a_orden(uuid, uuid) from public, anon;
grant execute on function public.poner_cliente_a_orden(uuid, uuid) to authenticated;

-- =============================================================================
-- 4. COMPROBACIONES
-- =============================================================================
do $$
begin
  if exists (select 1 from public.ordenes_trabajo where cliente_id is null and not abierta_en_taller) then
    raise exception 'Hay órdenes de la oficina sin cliente';
  end if;
  if has_function_privilege('anon', 'public.abrir_orden_del_taller(text, public.tipo_vehiculo, text, text, text, public.tipo_trabajo_ot, public.prioridad_ot)', 'execute')
     or has_function_privilege('anon', 'public.poner_cliente_a_orden(uuid, uuid)', 'execute') then
    raise exception 'Una función quedó abierta al rol anónimo';
  end if;
  if to_regprocedure('public.clientes_para_el_taller()') is not null then
    raise exception 'Quedó la lista de clientes para el taller';
  end if;
end $$;
