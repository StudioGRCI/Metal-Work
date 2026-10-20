-- =============================================================================
-- EL VEHÍCULO ENTRA CON SU CÓDIGO INTERNO Y SU OT, Y SALE TERMINADO Y REVISADO
-- -----------------------------------------------------------------------------
-- DKS decidió el 2026-10-20:
--
--   «Para el ingreso y salida debe ser con vehículos con código interno: el
--    ingreso debe ser de un vehículo que ya tenga código interno y orden de
--    trabajo, y ahí carga todo; y la salida, de uno de los vehículos que tenga
--    el 100 % del avance y la aprobación de Tesorería, y se desbloquea el dar
--    salida del código interno.»
--
-- Hasta hoy el registro de vehículos (la hoja de portería que lleva
-- Requerimientos) aceptaba un código escrito a mano, que nadie comprobaba, y
-- la salida se marcaba cuando fuera: el pedido a Tesorería existía, pero solo
-- era un aviso. Desde esta migración, para los motivos que son trabajo del
-- taller (fabricación, mantenimiento, garantía y arenado):
--
--   * el ingreso exige el código interno de una unidad que tenga una OT que no
--     esté anulada. La empresa (el cliente) y la descripción del vehículo salen
--     de la unidad, y la placa y el chasis también si no se escriben; el
--     ingreso queda atado a la unidad y a su OT;
--   * Tesorería solo recibe el pedido de revisión de un vehículo con el 100 %
--     del avance de su código;
--   * la salida se marca solo con el 100 % del avance y la última revisión de
--     Tesorería atendida. Las dos se vuelven a mirar al marcarla.
--
-- La cochera y «otro» no son trabajo: entran con la placa o el chasis y salen
-- como antes (`vehiculo_motivo_exige_codigo`).
--
-- El avance es el mismo que ve Gerencia en el código interno
-- (`codigo_interno_avance_calculado`, migración 20261020100000), redondeado
-- igual. Requerimientos no tiene permiso para leer el avance de los códigos:
-- lo ve solo para los vehículos que tiene en la planta, por
-- `vehiculos_estado_de_salida`.
--
-- En producción no había ningún ingreso registrado al 2026-10-20, así que no
-- hay filas de antes que acomodar.
-- =============================================================================

-- ---------------------------------------------- 1. qué motivos son trabajo
create or replace function public.vehiculo_motivo_exige_codigo(p_motivo text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_motivo in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO'), false);
$$;
comment on function public.vehiculo_motivo_exige_codigo(text) is
  'Si el motivo del ingreso es trabajo del taller: entra con código interno y OT, y sale con el 100 % del avance y la revisión de Tesorería atendida. La cochera y «otro», no.';
revoke all on function public.vehiculo_motivo_exige_codigo(text) from public, anon;
grant execute on function public.vehiculo_motivo_exige_codigo(text) to authenticated;

-- -------------------------------------------- 2. el ingreso, atado a la OT
-- Sin índice para las dos llaves: no hay pantalla que filtre por ellas (se
-- lee por el registro), y una unidad o una OT no se borran (la OT se anula).
alter table public.registro_vehiculos
  add column if not exists unidad_id uuid references public.unidades(id) on delete restrict,
  add column if not exists orden_id  uuid references public.ordenes_trabajo(id) on delete restrict;
comment on column public.registro_vehiculos.unidad_id is
  'La unidad del código interno con que entró (migración 20261020166000). Vacía en la cochera y «otro».';
comment on column public.registro_vehiculos.orden_id is
  'La OT vigente de esa unidad al entrar (la más reciente que no estaba anulada).';
comment on column public.registro_vehiculos.codigo_interno is
  'Código interno de la unidad. Para el trabajo del taller es el de una unidad con OT (migración 20261020166000); en la cochera y «otro», texto libre.';

-- La guardia de 20261012141000 congela lo que se anotó al entrar; esto congela
-- también el vínculo, sin reescribir esa función.
create or replace function public.fn_vehiculo_vinculo_fijo()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if row(new.unidad_id, new.orden_id) is distinct from row(old.unidad_id, old.orden_id) then
    raise exception 'El ingreso del vehículo ya quedó atado a su código y su OT: si está mal, anúlalo y regístralo de nuevo.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_vehiculo_vinculo_fijo() from public, anon, authenticated;
create or replace trigger trg_vehiculo_vinculo_fijo
  before update on public.registro_vehiculos
  for each row execute function public.fn_vehiculo_vinculo_fijo();

-- --------------------------------- 3. los códigos que pueden entrar, con todo
-- Lo que la ventana del ingreso ofrece: cada unidad con código interno y una OT
-- que no esté anulada, con su cliente y lo que se sabe del vehículo, y si ya
-- está en la planta.
create or replace function public.vehiculos_codigos_para_ingreso()
returns table (codigo_interno text, unidad_id uuid, orden_id uuid, orden_numero text, cliente text,
               unidad text, placa text, chasis text, en_planta boolean)
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
                  where v.unidad_id = u.id and v.salida_en is null and v.anulado_en is null)
    from public.unidades u
    join lateral (select x.id, x.numero from public.ordenes_trabajo x
                   where x.unidad_id = u.id and x.estado <> 'ANULADA'
                   order by x.creado_en desc limit 1) o on true
    left join public.clientes cl on cl.id = u.cliente_id
   where u.activo and public.normalizar_codigo_interno(u.codigo_interno) is not null
   order by 1;
end;
$$;

-- Cómo se describe la unidad en el registro: la carrocería y el camión.
create or replace function public.vehiculo_descripcion_de_unidad(p_unidad uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select left(coalesce(
           nullif(concat_ws(' · ', nullif(btrim(coalesce(tc.nombre, '')), ''),
                            nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''),
           initcap(u.tipo_vehiculo::text)), 120)
    from public.unidades u
    left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
   where u.id = p_unidad;
$$;
revoke all on function public.vehiculo_descripcion_de_unidad(uuid) from public, anon, authenticated;

revoke all on function public.vehiculos_codigos_para_ingreso() from public, anon;
grant execute on function public.vehiculos_codigos_para_ingreso() to authenticated;

-- ------------------------- 4. el avance, sin el permiso de ver los códigos
-- `codigo_interno_avance_calculado` (20261020100000) no pide permiso porque la
-- llaman las funciones del avance, pero por dentro leía las etapas con
-- `codigo_interno_etapas`, que sí lo pide (ver los códigos de Diseño): llamada
-- por Requerimientos, que no lo tiene, caía con «No tienes permiso para ver los
-- planos…». La cuenta de las etapas pasa a su propia función sin permiso,
-- `codigo_interno_etapas_calculado`; la pestaña «Etapas» la sigue leyendo con
-- el permiso, y el avance la lee sin él. Las dos, sin un cambio en la cuenta.
create or replace function public.codigo_interno_etapas_calculado(p_codigo text default null)
returns table (id uuid, codigo text, orden smallint, nombre text, area_id uuid, area text, area_codigo text,
               inicio_plan date, fin_plan date, inicio_real date, fin_real date, nota text, actualizado_en timestamptz,
               reportes integer, primer_reporte date, ultimo_reporte date, avance_reportado numeric)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with etapa as (
    select e.* from public.codigo_etapas e
     where e.quitada_en is null and (v_codigo is null or e.codigo_interno = v_codigo)
  ), reporte as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, r.area_id, r.id, r.fecha, r.creado_en
      from public.reportes_diarios r
     where r.anulado_en is null and r.area_id is not null
       and (v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo)
  ), por_area as (
    select r.codigo, r.area_id, count(*)::integer as reportes, min(r.fecha) as primero, max(r.fecha) as ultimo
      from reporte r group by r.codigo, r.area_id
  )
  select e.id, e.codigo_interno, e.orden, e.nombre, e.area_id, a.nombre::text, a.codigo::text,
         e.inicio_plan, e.fin_plan, e.inicio_real, e.fin_real, e.nota, e.actualizado_en,
         coalesce(pa.reportes, 0), pa.primero, pa.ultimo, av.avance
    from etapa e
    left join public.areas a on a.id = e.area_id
    left join por_area pa on pa.codigo = e.codigo_interno and pa.area_id = e.area_id
    left join public.codigo_interno_resto_por_area_calculado(v_codigo) av on av.codigo = e.codigo_interno and av.area_id = e.area_id
   order by e.codigo_interno, e.orden;
end;
$$;
revoke all on function public.codigo_interno_etapas_calculado(text) from public, anon, authenticated;

create or replace function public.codigo_interno_etapas(p_codigo text default null)
returns table (id uuid, codigo text, orden smallint, nombre text, area_id uuid, area text, area_codigo text,
               inicio_plan date, fin_plan date, inicio_real date, fin_real date, nota text, actualizado_en timestamptz,
               reportes integer, primer_reporte date, ultimo_reporte date, avance_reportado numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_ver_codigos_de_diseno();
  return query select * from public.codigo_interno_etapas_calculado(p_codigo);
end;
$$;
revoke all on function public.codigo_interno_etapas(text) from public, anon;
grant execute on function public.codigo_interno_etapas(text) to authenticated;

create or replace function public.codigo_interno_avance_calculado(p_codigo text)
returns table (codigo text, peso numeric, de_planos numeric, resto numeric, resto_por text,
               etapas integer, etapas_terminadas integer, trabajos integer, trabajos_terminados integer, ultimo_reporte date)
language sql stable set search_path to 'public' as $$
  with actividad as (
    select a.*, exists (select 1 from public.codigo_planos p
                         where p.id = a.plano_id and p.anulado_en is null and p.peso > 0) as de_plano
      from public.codigo_interno_actividades_estado(p_codigo) a
  ), etapa as (
    select e.codigo,
           count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           avg(case when e.fin_real is not null then 100 else coalesce(e.avance_reportado, 0) end) as avance
      from public.codigo_interno_etapas_calculado(p_codigo) e
     group by e.codigo
  ), trabajo as (
    select a.codigo, count(*)::integer as trabajos, count(*) filter (where a.avance >= 100)::integer as terminados,
           avg(a.avance) filter (where not a.de_plano) as avance, max(a.ultima_fecha) as ultimo
      from actividad a group by a.codigo
  ), plano as (
    select k.codigo, sum(k.peso) as peso, sum(k.peso * k.avance / 100) as aporte
      from public.codigo_interno_avance_planos_calculado(p_codigo) k
     group by k.codigo
     having sum(k.peso) > 0
  ), codigos as (
    select e.codigo from etapa e union select t.codigo from trabajo t union select p.codigo from plano p
  )
  select c.codigo, coalesce(p.peso, 0), coalesce(p.aporte, 0), coalesce(e.avance, t.avance, 0),
         case when e.codigo is not null then 'ETAPAS' else 'ACTIVIDADES' end,
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0),
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.ultimo
    from codigos c
    left join etapa e on e.codigo = c.codigo
    left join trabajo t on t.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
$$;
comment on function public.codigo_interno_avance_calculado(text) is
  'Las dos partes del avance de cada código (o de uno): el peso repartido en planos y lo que aportan, y el avance (0 a 100) de lo que no se repartió, por etapas o por actividades. No pide permiso: la llaman las funciones del avance.';
revoke all on function public.codigo_interno_avance_calculado(text) from public, anon, authenticated;

-- --------------------------------------------------- 4b. el avance, entero
-- El mismo número que ve Gerencia en el código (`codigos_internos_avance`).
-- Un código sin nada registrado va en 0.
create or replace function public.vehiculo_avance_del_codigo(p_codigo text)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select round(k.de_planos + (100 - k.peso) / 100 * k.resto)::integer
                     from public.codigo_interno_avance_calculado(public.normalizar_codigo_interno(p_codigo)) k
                    limit 1), 0);
$$;
revoke all on function public.vehiculo_avance_del_codigo(text) from public, anon, authenticated;

-- Lo que le falta a un ingreso para salir, en las palabras del mensaje. `null`
-- si puede salir. Lo usan la salida, el pedido a Tesorería y la pantalla.
create or replace function public.vehiculo_lo_que_falta_para_salir(p_registro uuid, p_con_tesoreria boolean)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_reg     public.registro_vehiculos%rowtype;
  v_avance  integer;
  v_ultima  text;
begin
  select * into v_reg from public.registro_vehiculos where id = p_registro;
  if not found or not public.vehiculo_motivo_exige_codigo(v_reg.motivo) or v_reg.codigo_interno is null then
    return null;
  end if;
  v_avance := public.vehiculo_avance_del_codigo(v_reg.codigo_interno);
  if v_avance < 100 then
    return format('El código %s va en %s %%: la salida se habilita con el 100 %% del avance.', v_reg.codigo_interno, v_avance);
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

-- ----------------------------------------------- 5. el ingreso, con todo
-- Igual que en 20261015161000, y para el trabajo del taller: el código de una
-- unidad con OT, que trae la empresa y el vehículo.
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
    if exists (select 1 from public.registro_vehiculos
                where unidad_id = v_unidad.id and salida_en is null and anulado_en is null) then
      raise exception 'El vehículo del código % ya está en la planta: marca primero su salida.', v_codigo
        using errcode = 'unique_violation';
    end if;
    v_codigo := public.normalizar_codigo_interno(v_unidad.codigo_interno);
    v_placa := coalesce(v_placa, public.normalizar_placa(v_unidad.placa));
    v_chasis := coalesce(v_chasis, nullif(upper(btrim(coalesce(v_unidad.numero_chasis, ''))), ''));
    v_unidad_texto := public.vehiculo_descripcion_de_unidad(v_unidad.id);
    select coalesce(cl.razon_social, v_empresa) into v_empresa from public.clientes cl where cl.id = v_unidad.cliente_id;
    v_empresa := coalesce(nullif(btrim(coalesce(v_empresa, '')), ''), btrim(coalesce(p_empresa, '')));
  elsif coalesce(v_placa, v_chasis, v_codigo) is null then
    raise exception 'Anota la placa, el número de chasis o el código interno: sin eso no se sabe qué vehículo entró.'
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

-- ----------------------------------- 6. a Tesorería, solo lo que terminó
-- Igual que en 20261016110000, y para el trabajo del taller, con el 100 %.
create or replace function public.solicitar_revision_salida(p_id uuid, p_registro uuid, p_concepto text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_registro public.registro_vehiculos%rowtype;
  v_concepto text := nullif(regexp_replace(btrim(coalesce(p_concepto, '')), '\s+', ' ', 'g'), '');
  v_nombre   text;
  v_falta    text;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.registro_vehiculo_revisiones where id = p_id and registro_id = p_registro) then
    return p_id;
  end if;
  select * into v_registro from public.registro_vehiculos where id = p_registro for update;
  if not found or v_registro.anulado_en is not null then
    raise exception 'Ese ingreso de vehículo no está o está anulado.' using errcode = 'check_violation';
  end if;
  if v_registro.salida_en is not null then
    raise exception 'El vehículo ya salió de la planta: la revisión se pide antes de que salga.' using errcode = 'check_violation';
  end if;
  v_falta := public.vehiculo_lo_que_falta_para_salir(p_registro, false);
  if v_falta is not null then
    raise exception '% Tesorería revisa la salida de un vehículo terminado.', v_falta using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.registro_vehiculo_fichas f
                  where f.registro_id = p_registro and f.salida_cerrada_en is not null and f.escaneo_ruta is not null) then
    raise exception 'Cierra la salida de la ficha y adjunta su escaneo firmado antes de pedir la revisión a Tesorería.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.registro_vehiculo_revisiones where registro_id = p_registro and estado = 'PENDIENTE') then
    raise exception 'Ya hay un pedido de revisión esperando a Tesorería para este vehículo.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_concepto, '')) not between 3 and 2000 then
    raise exception 'Escribe qué tiene que revisar Tesorería (de 3 a 2000 caracteres).' using errcode = 'check_violation';
  end if;

  insert into public.registro_vehiculo_revisiones (id, registro_id, concepto) values (p_id, p_registro, v_concepto);

  -- El aviso va a Tesorería, la que cobra (no a Gerencia ni a Administración,
  -- que también pueden responder pero no llevan la cobranza).
  v_nombre := coalesce(v_registro.placa, v_registro.chasis, v_registro.codigo_interno, v_registro.unidad);
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Revisar la salida de ' || v_nombre,
         coalesce('Código ' || v_registro.codigo_interno || '. ', '') || v_concepto,
         '/tesoreria/por-cobrar', 'registro_vehiculo_revisiones', p_id
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'tesoreria.liberar'
   where u.activo and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos c where c.rol_id = u.rol_id and c.permiso_codigo = 'tesoreria.registrar_cobros');
  return p_id;
end;
$$;
comment on function public.solicitar_revision_salida(uuid, uuid, text) is
  'Requerimientos (vehiculos.registrar) le pide a Tesorería revisar la salida de un vehículo que sigue en la planta, con la ficha de salida cerrada y escaneada y, si es trabajo del taller, con el 100 % del avance de su código. Avisa a Tesorería.';
revoke all on function public.solicitar_revision_salida(uuid, uuid, text) from public, anon;
grant execute on function public.solicitar_revision_salida(uuid, uuid, text) to authenticated;

-- --------------------------------- 7. la salida, con el 100 % y Tesorería
-- Igual que en 20261015161000, y para el trabajo del taller, las dos cosas.
create or replace function public.registrar_salida_vehiculo(p_id uuid, p_salida_en timestamptz, p_observacion text, p_fotos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_reg    public.registro_vehiculos%rowtype;
  v_cuando timestamptz := coalesce(p_salida_en, now());
  v_falta  text;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  select * into v_reg from public.registro_vehiculos where id = p_id for update;
  if not found then raise exception 'El registro del vehículo no existe.'; end if;
  if v_reg.anulado_en is not null then
    raise exception 'Ese ingreso está anulado.' using errcode = 'check_violation';
  end if;
  if v_reg.salida_en is not null then return p_id; end if;
  v_falta := public.vehiculo_lo_que_falta_para_salir(p_id, true);
  if v_falta is not null then
    raise exception '%', v_falta using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de salida no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < v_reg.ingreso_en then
    raise exception 'La salida no puede ser anterior al ingreso (%).',
      to_char(v_reg.ingreso_en at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI') using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.registro_vehiculos
     set salida_en = v_cuando, salida_por = public.usuario_actual(),
         observacion_salida = nullif(btrim(coalesce(p_observacion, '')), '')
   where id = p_id;
  perform public.vehiculo_anotar_fotos(p_id, 'SALIDA', p_fotos);
  return p_id;
end;
$$;
revoke all on function public.registrar_salida_vehiculo(uuid, timestamptz, text, jsonb) from public, anon;
grant execute on function public.registrar_salida_vehiculo(uuid, timestamptz, text, jsonb) to authenticated;

-- ------------------------------------- 8. lo que la pantalla necesita saber
-- Por cada ingreso que sigue en la planta: si su salida espera el avance y a
-- Tesorería, en cuánto va, qué dijo Tesorería la última vez y qué le falta.
create or replace function public.vehiculos_estado_de_salida(p_registros uuid[])
returns table (registro_id uuid, exige boolean, avance integer, tesoreria text, falta_para_pedir text, falta_para_salir text)
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
              then public.vehiculo_avance_del_codigo(v.codigo_interno) end,
         (select r.estado from public.registro_vehiculo_revisiones r where r.registro_id = v.id order by r.creado_en desc limit 1),
         public.vehiculo_lo_que_falta_para_salir(v.id, false),
         public.vehiculo_lo_que_falta_para_salir(v.id, true)
    from public.registro_vehiculos v
   where v.id = any (p_registros) and v.salida_en is null and v.anulado_en is null;
end;
$$;
comment on function public.vehiculos_estado_de_salida(uuid[]) is
  'Para cada ingreso en la planta: si es trabajo del taller, el avance de su código, la última respuesta de Tesorería y lo que le falta para pedir la revisión y para salir (null si nada). Exige vehiculos.ver o vehiculos.registrar.';
revoke all on function public.vehiculos_estado_de_salida(uuid[]) from public, anon;
grant execute on function public.vehiculos_estado_de_salida(uuid[]) to authenticated;
