-- =============================================================================
-- EL VEHÍCULO DE GARANTÍA SALE CUANDO ADMINISTRACIÓN DA POR TERMINADA LA GARANTÍA
-- -----------------------------------------------------------------------------
-- DKS decidió el 2026-10-21 que la salida de un vehículo que vuelve por
-- garantía espere a que se termine el trabajo de garantía, y que lo dé por
-- terminado Administración cuando el taller le avisa; con eso y el visto de
-- Tesorería, el vehículo sale.
--
-- Hasta aquí (migración 20261020166000) la garantía salía como la
-- fabricación: con el 100 % del avance de su código y el visto de Tesorería.
-- Pero el código de una unidad que vuelve por garantía ya llegó al 100 % con
-- el trabajo de la primera vez, así que el vehículo podía salir el mismo día
-- en que entró, con el arreglo sin hacer. El registro de reclamos de garantía
-- ya no existe (se retiró en la migración 094); lo que sí hay es la OT sin
-- cotización de tipo «Garantía», que registra Administración y aprueba
-- Gerencia. Pasar una OT a «Terminada» quedó en manos de las jefaturas de
-- taller, que ya no tienen cuentas (migración 20260929110100): por eso la
-- garantía se da por terminada aparte, con su propia anotación, sin tocar los
-- estados de la OT ni sus etapas.
--
-- Desde aquí:
--
--   * Administración (`ordenes.editar`) da por terminada la garantía de una OT
--     de garantía aprobada, con una nota opcional (`dar_por_terminada_la_garantia`).
--     Queda anotado quién y cuándo, y no se deshace: es lo que dejó salir al
--     vehículo. Si hay un vehículo de esa OT en la planta, Requerimientos
--     recibe el aviso;
--   * el ingreso por garantía pide que la unidad tenga una OT de garantía
--     abierta (ni anulada, ni terminada) y queda atado a ella;
--   * un vehículo atado a una OT de garantía —entre por el motivo que entre—
--     sale cuando su garantía está terminada, en vez de esperar el 100 % del
--     avance del código. El visto de Tesorería sigue haciendo falta;
--   * la pantalla del registro dice si la garantía está terminada, en lugar del
--     avance del código.
--
-- En producción no había ningún ingreso ni ninguna OT de garantía al
-- 2026-10-21, así que no hay filas de antes que acomodar.
-- =============================================================================

-- ------------------------------------------ 1. la garantía, dada por terminada
create table if not exists public.ot_garantia_terminada (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null unique references public.ordenes_trabajo(id) on delete restrict,
  terminada_en   timestamptz not null default now(),
  terminada_por  uuid not null references public.usuarios(id) on delete restrict,
  nota           text check (nota is null or char_length(nota) between 1 and 500),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.ot_garantia_terminada is
  'Cuándo y quién dio por terminada la garantía de una OT de garantía (migración 20261021120000). Lo anota Administración con dar_por_terminada_la_garantia; deja salir al vehículo con el visto de Tesorería. No se edita ni se borra.';
alter table public.ot_garantia_terminada enable row level security;
drop policy if exists ver_ot_garantia_terminada on public.ot_garantia_terminada;
create policy ver_ot_garantia_terminada on public.ot_garantia_terminada
  for select to authenticated using (public.puede_ver_orden(orden_id));
-- Sin políticas de escritura: entra solo por la función.
revoke all on public.ot_garantia_terminada from public, anon, authenticated;
grant select on public.ot_garantia_terminada to authenticated;
select public.activar_timestamps('ot_garantia_terminada');
select public.activar_auditoria('ot_garantia_terminada');
select public.activar_registro_de_prueba('ot_garantia_terminada');

-- Si la garantía de la OT ya está terminada: anotada aquí, o la OT terminada
-- por su estado (lo que hicieron las jefaturas antes).
create or replace function public.orden_garantia_terminada(p_orden uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ot_garantia_terminada g where g.orden_id = p_orden)
      or exists (select 1 from public.ordenes_trabajo o
                  where o.id = p_orden and o.estado in ('TERMINADA', 'ENTREGADA', 'FACTURADA'));
$$;
revoke all on function public.orden_garantia_terminada(uuid) from public, anon, authenticated;

create or replace function public.dar_por_terminada_la_garantia(p_orden uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_nota  text := nullif(regexp_replace(btrim(coalesce(p_nota, '')), '\s+', ' ', 'g'), '');
  v_registro public.registro_vehiculos%rowtype;
begin
  perform public.exigir_permiso('ordenes.editar');
  select * into v_orden from public.ordenes_trabajo where id = p_orden for update;
  if not found then
    raise exception 'No se encontró la orden de trabajo.' using errcode = 'check_violation';
  end if;
  if v_orden.tipo_trabajo is distinct from 'GARANTIA' then
    raise exception 'La OT % no es de garantía: solo la garantía se da por terminada así.', v_orden.numero
      using errcode = 'check_violation';
  end if;
  if public.orden_garantia_terminada(p_orden) then
    return p_orden;
  end if;
  if v_orden.estado = 'ANULADA' then
    raise exception 'La OT % está anulada.', v_orden.numero using errcode = 'check_violation';
  end if;
  if v_orden.estado = 'BORRADOR' then
    raise exception 'La OT de garantía % espera la aprobación de Gerencia: se da por terminada después.', v_orden.numero
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  insert into public.ot_garantia_terminada (orden_id, terminada_por, nota)
  values (p_orden, public.usuario_actual(), v_nota);

  -- Si su vehículo está en la planta, Requerimientos ya puede pedirle la
  -- revisión a Tesorería.
  select * into v_registro from public.registro_vehiculos
   where orden_id = p_orden and salida_en is null and anulado_en is null
   order by ingreso_en desc limit 1;
  if found then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, 'La garantía de la OT ' || v_orden.numero || ' está terminada',
           'Pídele a Tesorería la revisión de la salida del vehículo '
             || coalesce(v_registro.placa, v_registro.chasis, v_registro.codigo_interno, v_registro.unidad) || '.',
           '/vehiculos/' || v_registro.id, 'registro_vehiculos', v_registro.id
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'vehiculos.registrar'
     where u.activo and u.id is distinct from public.usuario_actual();
  end if;
  return p_orden;
end;
$$;
comment on function public.dar_por_terminada_la_garantia(uuid, text) is
  'Administración (ordenes.editar) da por terminada la garantía de una OT de garantía aprobada, cuando el taller avisa. Con eso y el visto de Tesorería sale su vehículo. Repetirla no hace otra; no se deshace.';
revoke all on function public.dar_por_terminada_la_garantia(uuid, text) from public, anon;
grant execute on function public.dar_por_terminada_la_garantia(uuid, text) to authenticated;

-- La OT de garantía abierta de la unidad: la más reciente que no está anulada
-- ni terminada. `null` si no hay.
create or replace function public.vehiculo_ot_de_garantia_abierta(p_unidad uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select o.id from public.ordenes_trabajo o
   where o.unidad_id = p_unidad and o.tipo_trabajo = 'GARANTIA' and o.estado <> 'ANULADA'
     and not public.orden_garantia_terminada(o.id)
   order by o.creado_en desc limit 1;
$$;
revoke all on function public.vehiculo_ot_de_garantia_abierta(uuid) from public, anon, authenticated;

-- ------------------------------------------- 2. lo que le falta para salir
-- Igual que en 20261020166000; el ingreso atado a una OT de garantía espera
-- que su garantía esté terminada, y no el avance del código.
create or replace function public.vehiculo_lo_que_falta_para_salir(p_registro uuid, p_con_tesoreria boolean)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_reg     public.registro_vehiculos%rowtype;
  v_orden   public.ordenes_trabajo%rowtype;
  v_avance  integer;
  v_ultima  text;
begin
  select * into v_reg from public.registro_vehiculos where id = p_registro;
  if not found or not public.vehiculo_motivo_exige_codigo(v_reg.motivo) or v_reg.codigo_interno is null then
    return null;
  end if;
  select * into v_orden from public.ordenes_trabajo where id = v_reg.orden_id;
  if v_orden.tipo_trabajo = 'GARANTIA' then
    -- Anulada con el vehículo adentro: ya no hay garantía que terminar, y
    -- decir que espera a Administración la dejaría esperando para siempre.
    if v_orden.estado = 'ANULADA' then
      return format('La OT de garantía %s está anulada: anula este ingreso y regístralo con la OT que corresponda.',
                    v_orden.numero);
    elsif v_orden.estado = 'BORRADOR' then
      return format('La OT de garantía %s espera la aprobación de Gerencia; después, Administración la da por terminada cuando el taller avise.',
                    v_orden.numero);
    elsif not public.orden_garantia_terminada(v_orden.id) then
      return format('Administración todavía no da por terminada la garantía de la OT %s: la salida se habilita cuando la marque.',
                    v_orden.numero);
    end if;
  else
    v_avance := public.vehiculo_avance_del_codigo(v_reg.codigo_interno);
    if v_avance < 100 then
      return format('El código %s va en %s %%: la salida se habilita con el 100 %% del avance.', v_reg.codigo_interno, v_avance);
    end if;
  end if;
  if p_con_tesoreria then
    select r.estado into v_ultima from public.registro_vehiculo_revisiones r
     where r.registro_id = p_registro order by r.creado_en desc limit 1;
    if v_ultima is null then
      return 'Falta la aprobación de Tesorería: pídele la revisión de la salida.';
    elsif v_ultima = 'PENDIENTE' then
      return 'Falta la aprobación de Tesorería: tu pedido de revisión está esperando su respuesta.';
    elsif v_ultima = 'OBSERVADA' then
      return 'Tesorería observó la salida: atiende su observación y vuelve a pedirle la revisión.';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.vehiculo_lo_que_falta_para_salir(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------- 3. el ingreso por garantía
-- Igual que en 20261020166000; para la garantía, la OT es la de garantía.
create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text, p_fotos jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_placa   text := public.normalizar_placa(p_placa);
  v_chasis  text := nullif(upper(btrim(coalesce(p_chasis, ''))), '');
  v_codigo  text := nullif(btrim(coalesce(p_codigo_interno, '')), '');
  v_unidad_texto  text := btrim(coalesce(p_unidad, ''));
  v_empresa text := btrim(coalesce(p_empresa, ''));
  v_cuando  timestamptz := coalesce(p_ingreso_en, now());
  v_actual  public.registro_vehiculos%rowtype;
  v_clave   text;
  v_unidad  public.unidades%rowtype;
  v_orden   uuid;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del ingreso.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO', 'COCHERA', 'OTRO') then
    raise exception 'Elige el motivo del ingreso.' using errcode = 'check_violation';
  end if;

  -- Un reintento con el mismo p_id devuelve el ingreso que ya entró.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.registro_vehiculos where id = p_id;
  if found then
    if v_actual.ingreso_por = public.usuario_actual() and v_actual.motivo = p_motivo then
      return p_id;
    end if;
    raise exception 'Este ingreso ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;

  if public.vehiculo_motivo_exige_codigo(p_motivo) then
    if v_codigo is null then
      raise exception 'Elige el código interno del vehículo: para % entra solo un vehículo con código interno y OT.',
        lower(case p_motivo when 'FABRICACION' then 'fabricación' when 'GARANTIA' then 'garantía' else p_motivo end)
        using errcode = 'check_violation';
    end if;
    v_clave := upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'));
    select u.* into v_unidad from public.unidades u
     where upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and u.activo
     limit 1;
    if not found then
      raise exception 'El código interno % no es de ninguna unidad: el código nace cuando Gerencia aprueba la cotización con su OT.',
        v_codigo using errcode = 'check_violation';
    end if;
    select o.id into v_orden from public.ordenes_trabajo o
     where o.unidad_id = v_unidad.id and o.estado <> 'ANULADA'
     order by o.creado_en desc limit 1;
    if v_orden is null then
      raise exception 'El código interno % no tiene una OT vigente: sin OT el vehículo no entra a trabajo.', v_codigo
        using errcode = 'check_violation';
    end if;
    -- La garantía entra con su propia OT: la salida espera a que se termine.
    if p_motivo = 'GARANTIA' then
      v_orden := public.vehiculo_ot_de_garantia_abierta(v_unidad.id);
      if v_orden is null then
        raise exception 'El código interno % no tiene una OT de garantía abierta: Administración la registra en Órdenes de trabajo, sin cotización, de tipo Garantía y con la unidad de este código.',
          v_codigo using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.registro_vehiculos
                where unidad_id = v_unidad.id and salida_en is null and anulado_en is null) then
      raise exception 'El vehículo del código % ya está en la planta: marca primero su salida.', v_codigo
        using errcode = 'unique_violation';
    end if;
    v_codigo := public.normalizar_codigo_interno(v_unidad.codigo_interno);
    v_placa := coalesce(v_placa, public.normalizar_placa(v_unidad.placa));
    v_chasis := coalesce(v_chasis, nullif(upper(btrim(coalesce(v_unidad.numero_chasis, ''))), ''));
    v_unidad_texto := public.vehiculo_descripcion_de_unidad(v_unidad.id);
    -- El cliente de la unidad; si la unidad no lo tiene, el de su OT.
    select cl.razon_social into v_empresa
      from public.ordenes_trabajo o join public.clientes cl on cl.id = coalesce(v_unidad.cliente_id, o.cliente_id)
     where o.id = v_orden;
    v_empresa := coalesce(nullif(btrim(coalesce(v_empresa, '')), ''), btrim(coalesce(p_empresa, '')));
  elsif coalesce(v_placa, v_chasis, v_codigo) is null then
    raise exception 'Anota la placa, el número de chasis o el código interno: sin eso no se sabe qué vehículo entró.'
      using errcode = 'check_violation';
  elsif v_codigo is not null and exists (
          select 1 from public.unidades u join public.ordenes_trabajo o on o.unidad_id = u.id
           where o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA')
             and upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '[^A-Za-z0-9]', '', 'g'))
               = upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'))) then
    -- Un código con OT en el taller que entra como cochera u «otro» se saltaría
    -- la regla: no figuraría en la planta y saldría sin el 100 % ni Tesorería.
    -- El vehículo ya entregado sí vuelve a la cochera, por código o por placa.
    raise exception 'El código interno % es de un vehículo con OT en el taller: elige el motivo del trabajo (fabricación, mantenimiento, garantía o arenado).',
      v_codigo using errcode = 'check_violation';
  elsif exists (
          select 1 from public.unidades u join public.ordenes_trabajo o on o.unidad_id = u.id
           where o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA')
             and ((v_placa is not null and public.normalizar_placa(u.placa) = v_placa)
               or (v_chasis is not null and upper(btrim(coalesce(u.numero_chasis, ''))) = v_chasis))) then
    -- Lo mismo por la placa o el chasis.
    raise exception 'Ese vehículo tiene una OT en el taller: elige el motivo del trabajo y su código interno.'
      using errcode = 'check_violation';
  end if;

  if v_placa is not null and char_length(v_placa) not between 3 and 15 then
    raise exception 'La placa % no parece válida.', v_placa using errcode = 'check_violation';
  end if;
  if v_chasis is not null and char_length(v_chasis) not between 3 and 40 then
    raise exception 'El número de chasis va de 3 a 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_unidad_texto) not between 2 and 120 then
    raise exception 'Describe el vehículo: tipo, marca o carrocería.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_empresa, '')) not between 2 and 160 then
    raise exception 'Anota la empresa o el dueño del vehículo.' using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de ingreso no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < now() - interval '30 days' then
    raise exception 'Solo se registran ingresos de los últimos 30 días.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if v_placa is not null and exists (select 1 from public.registro_vehiculos
                                       where placa = v_placa and salida_en is null and anulado_en is null) then
    raise exception 'El vehículo de placa % ya está en la planta: marca primero su salida.', v_placa
      using errcode = 'unique_violation';
  end if;
  if v_chasis is not null and exists (select 1 from public.registro_vehiculos
                                        where chasis = v_chasis and salida_en is null and anulado_en is null) then
    raise exception 'El chasis % ya está en la planta: marca primero su salida.', v_chasis
      using errcode = 'unique_violation';
  end if;

  insert into public.registro_vehiculos
    (id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, ingreso_por,
     unidad_id, orden_id)
  values
    (p_id, v_placa, v_chasis, v_codigo, v_unidad_texto, v_empresa, p_motivo, v_cuando,
     nullif(btrim(coalesce(p_observacion, '')), ''), public.usuario_actual(),
     v_unidad.id, v_orden);
  perform public.vehiculo_anotar_fotos(p_id, 'INGRESO', p_fotos);
  return p_id;
end;
$$;
revoke all on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb) to authenticated;

-- ------------------------------------- 4. lo que la pantalla necesita saber
-- Igual que en 20261020166000, con la OT de garantía: su número y su estado
-- («TERMINADA» si Administración ya dio por terminada la garantía), y sin
-- avance, que para la garantía no decide nada. Cambia lo que devuelve,
-- así que se vuelve a crear.
drop function if exists public.vehiculos_estado_de_salida(uuid[]);
create function public.vehiculos_estado_de_salida(p_registros uuid[])
returns table (registro_id uuid, exige boolean, avance integer, tesoreria text, falta_para_pedir text, falta_para_salir text,
               garantia_ot text, garantia_estado text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('vehiculos.ver') or public.tiene_permiso('vehiculos.registrar')) then
    raise exception 'No tiene permiso para consultar los vehículos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_registros, 1), 0) > 500 then
    raise exception 'Se consultan hasta 500 ingresos a la vez.' using errcode = 'check_violation';
  end if;
  return query
  select v.id,
         public.vehiculo_motivo_exige_codigo(v.motivo) and v.codigo_interno is not null,
         case when public.vehiculo_motivo_exige_codigo(v.motivo) and v.codigo_interno is not null
                   and o.tipo_trabajo is distinct from 'GARANTIA'
              then public.vehiculo_avance_del_codigo(v.codigo_interno) end,
         (select r.estado from public.registro_vehiculo_revisiones r where r.registro_id = v.id order by r.creado_en desc limit 1),
         public.vehiculo_lo_que_falta_para_salir(v.id, false),
         public.vehiculo_lo_que_falta_para_salir(v.id, true),
         case when o.tipo_trabajo = 'GARANTIA' then o.numero::text end,
         case when o.tipo_trabajo = 'GARANTIA' then
           case when public.orden_garantia_terminada(o.id) then 'TERMINADA' else o.estado::text end end
    from public.registro_vehiculos v
    left join public.ordenes_trabajo o on o.id = v.orden_id
   where v.id = any (p_registros) and v.salida_en is null and v.anulado_en is null;
end;
$$;
comment on function public.vehiculos_estado_de_salida(uuid[]) is
  'Para cada ingreso en la planta: si es trabajo del taller, el avance de su código (o, si entró con una OT de garantía, el número y el estado de esa OT), la última respuesta de Tesorería y lo que le falta para pedir la revisión y para salir (null si nada). Exige vehiculos.ver o vehiculos.registrar.';
revoke all on function public.vehiculos_estado_de_salida(uuid[]) from public, anon;
grant execute on function public.vehiculos_estado_de_salida(uuid[]) to authenticated;

-- ------------------------------------- 5. la ventana del ingreso, por garantía
-- Con «Garantía» la ventana ofrecía todos los códigos con la OT de fabricación
-- al lado, y el que no tenía OT de garantía lo rechazaba la base después de
-- subir las fotos. Ahora cada código trae también su OT de garantía abierta, si
-- la tiene: la ventana ofrece solo esos y muestra esa OT. Sin cambio para los
-- demás motivos.
drop function if exists public.vehiculos_codigos_para_ingreso();
create function public.vehiculos_codigos_para_ingreso()
returns table (codigo_interno text, unidad_id uuid, orden_id uuid, orden_numero text, cliente text,
               unidad text, placa text, chasis text, en_planta boolean, garantia_numero text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('vehiculos.registrar');
  return query
  select public.normalizar_codigo_interno(u.codigo_interno), u.id, o.id, o.numero::text,
         coalesce(cl.razon_social, 'Sin cliente')::text,
         public.vehiculo_descripcion_de_unidad(u.id),
         u.placa::text, nullif(btrim(coalesce(u.numero_chasis, '')), ''),
         exists (select 1 from public.registro_vehiculos v
                  where v.unidad_id = u.id and v.salida_en is null and v.anulado_en is null),
         (select g.numero::text from public.ordenes_trabajo g where g.id = public.vehiculo_ot_de_garantia_abierta(u.id))
    from public.unidades u
    join lateral (select x.id, x.numero from public.ordenes_trabajo x
                   where x.unidad_id = u.id and x.estado <> 'ANULADA'
                   order by x.creado_en desc limit 1) o on true
    left join public.clientes cl on cl.id = u.cliente_id
   where u.activo and public.normalizar_codigo_interno(u.codigo_interno) is not null
   order by 1;
end;
$$;
revoke all on function public.vehiculos_codigos_para_ingreso() from public, anon;
grant execute on function public.vehiculos_codigos_para_ingreso() to authenticated;
