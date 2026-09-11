-- =============================================================================
-- LA COTIZACIÓN EN PDF, Y LA ORDEN QUE SALE DE ELLA
-- -----------------------------------------------------------------------------
-- «Que la cotización y demás no se cree en el sistema: el vendedor sube la
-- cotización en PDF, lo único que detalla es cliente y tipo de vehículo;
-- Gerencia valida, aprueba o rechaza; una vez aprueba, Administración realiza
-- la OT y agrega el PDF de la OT, y entonces se habilita todo lo demás.»
--
-- La cotización de la casa se arma en Excel y se manda en PDF: rehacerla dentro
-- del sistema era escribir dos veces lo mismo. Lo que el sistema necesita de
-- ella es poco —de quién es, qué se fabrica, su número y el papel— y lo que sí
-- aporta es la trazabilidad: quién la subió, quién la aprobó y cuándo, y qué
-- orden salió de ella.
--
-- El circuito queda así:
--   1. Vendedor         sube el PDF: cliente, carrocería y el número del papel.
--   2. Gerencia         la aprueba o la rechaza con motivo.
--   3. Administración   emite la OT: placa, fecha de entrega y el PDF de la OT.
--      La orden nace aprobada —Gerencia ya dijo que sí— con sus etapas y sus
--      plazos, y con su PDF pegado: ahí se habilita todo lo demás.
--
-- El módulo de cotizaciones que ya existía se queda como está: nadie lo borra,
-- y quien quiera seguir usándolo puede. Esta es la vía corta.
-- =============================================================================

-- =============================================================================
-- 1. LA COTIZACIÓN QUE VIVE EN UN PDF
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type
                  where typname = 'estado_cotizacion_pdf' and typnamespace = 'public'::regnamespace) then
    create type public.estado_cotizacion_pdf as enum ('POR_REVISAR', 'APROBADA', 'RECHAZADA');
  end if;
end $$;

comment on type public.estado_cotizacion_pdf is
  'En qué va la cotización en PDF con Gerencia: por revisar, aprobada (ya se le puede emitir la OT) o rechazada, con su motivo.';

create table if not exists public.cotizaciones_pdf (
  id                 uuid primary key default gen_random_uuid(),
  numero             text not null,
  cliente_id         uuid not null references public.clientes(id) on delete restrict,
  tipo_carroceria_id uuid not null references public.tipos_carroceria(id) on delete restrict,
  estado             public.estado_cotizacion_pdf not null default 'POR_REVISAR',
  observacion        text,
  revisado_por       uuid references public.usuarios(id),
  revisado_en        timestamptz,
  nombre_archivo     text not null,
  ruta_storage       text not null,
  mime_type          text,
  tamano_bytes       bigint,
  registrado_por     uuid references public.usuarios(id) on delete set null default public.usuario_actual(),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint ck_cotizacion_pdf_numero check (length(btrim(numero)) >= 3),
  constraint ck_cotizacion_pdf_ruta check (ruta_storage like 'cot/' || id::text || '/%'),
  constraint ck_cotizacion_pdf_rechazo check (estado <> 'RECHAZADA' or length(btrim(coalesce(observacion, ''))) >= 3),
  constraint uq_cotizacion_pdf_ruta unique (ruta_storage)
);

comment on table public.cotizaciones_pdf is
  'La cotización que la casa arma en Excel y manda en PDF. El sistema guarda lo poco que necesita —cliente, carrocería, número y el archivo— y la traza: quién la subió, quién la aprobó y qué orden salió de ella.';
comment on column public.cotizaciones_pdf.numero is
  'El número que ya trae el documento (3643-2026): el sistema no le pone otro, para que el papel y la pantalla hablen del mismo.';

-- El mismo número no se sube dos veces: la segunda es una corrección del mismo
-- documento, y se corrige el que está.
create unique index if not exists uq_cotizacion_pdf_numero
  on public.cotizaciones_pdf (upper(btrim(numero)));

alter table public.cotizaciones_pdf enable row level security;

drop policy if exists ver_cotizaciones_pdf on public.cotizaciones_pdf;
create policy ver_cotizaciones_pdf on public.cotizaciones_pdf
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.ver'));

drop policy if exists crear_cotizaciones_pdf on public.cotizaciones_pdf;
create policy crear_cotizaciones_pdf on public.cotizaciones_pdf
  for insert to authenticated
  with check ((public.es_admin() or public.tiene_permiso('cotizaciones.crear'))
              and registrado_por = public.usuario_actual());

-- Corregirla mientras Gerencia no la vio, o revisarla: quien la subió y quien
-- revisa. Qué se puede tocar en cada caso lo dice el disparador.
drop policy if exists editar_cotizaciones_pdf on public.cotizaciones_pdf;
create policy editar_cotizaciones_pdf on public.cotizaciones_pdf
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('cotizaciones.revisar')
         or (registrado_por = public.usuario_actual() and estado = 'POR_REVISAR'))
  with check (public.es_admin()
              or public.tiene_permiso('cotizaciones.revisar')
              or registrado_por = public.usuario_actual());

drop policy if exists borrar_cotizaciones_pdf on public.cotizaciones_pdf;
create policy borrar_cotizaciones_pdf on public.cotizaciones_pdf
  for delete to authenticated
  using (public.es_admin()
         or (registrado_por = public.usuario_actual() and estado = 'POR_REVISAR'));

revoke all on public.cotizaciones_pdf from anon, public;
grant select, insert, update, delete on public.cotizaciones_pdf to authenticated;

select public.activar_timestamps('cotizaciones_pdf');
select public.activar_auditoria('cotizaciones_pdf');

-- =============================================================================
-- 2. QUIÉN LA APRUEBA, Y QUÉ SE PUEDE TOCAR DESPUÉS
-- =============================================================================
create or replace function public.fn_cotizacion_pdf_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_revisa  constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
  v_ignorar constant text[] := array['estado', 'observacion', 'revisado_por', 'revisado_en', 'actualizado_en'];
  v_cambia  boolean;
begin
  if tg_op = 'INSERT' then
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    return new;
  end if;

  if new.estado is distinct from old.estado or new.observacion is distinct from old.observacion then
    if not v_revisa then
      raise exception 'La cotización la aprueba o la rechaza Gerencia.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from public.ordenes_trabajo o
                where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA') then
      raise exception 'La cotización % ya tiene su orden de trabajo: queda como está.', old.numero
        using errcode = 'check_violation';
    end if;
    if new.estado = 'POR_REVISAR' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  v_cambia := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);
  if v_cambia and old.estado <> 'POR_REVISAR' then
    raise exception 'La cotización % ya la revisó Gerencia: para cambiarla, sube una nueva.', old.numero
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_revision() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pdf_revision on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_revision before insert or update on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_revision();

-- Los avisos: a Gerencia cuando llega una, y al vendedor cuando la revisan.
-- Aprobada, también a quien emite las órdenes, que es el siguiente paso.
create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cliente text;
  v_quien   text;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;

  if tg_op = 'INSERT' then
    select nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
      into v_quien from public.usuarios u where u.id = new.registrado_por;
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s.', coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente')),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    return null;
  end if;

  if new.estado is not distinct from old.estado then
    return null;
  end if;

  perform public.notificar_a_usuario(
    new.registrado_por,
    case when new.estado = 'APROBADA' then 'Gerencia aprobó tu cotización' else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA'
         then format('La %s de %s: Administración ya puede emitir la orden.', new.numero, coalesce(v_cliente, 'un cliente'))
         else format('La %s: %s', new.numero, coalesce(new.observacion, 'sin motivo')) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());

  if new.estado = 'APROBADA' then
    perform public.notificar_a_permiso(
      'ordenes.crear',
      'Cotización aprobada: falta la OT',
      format('La %s de %s ya está aprobada: emite la orden de trabajo.', new.numero, coalesce(v_cliente, 'un cliente')),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
  end if;

  return null;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pdf_avisa_insert on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_avisa_insert after insert on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_avisa();

drop trigger if exists trg_cotizacion_pdf_avisa_update on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_avisa_update after update of estado on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_avisa();

-- =============================================================================
-- 3. LA ORDEN QUE SALE DE ESA COTIZACIÓN
-- =============================================================================
alter table public.ordenes_trabajo
  add column if not exists cotizacion_pdf_id uuid references public.cotizaciones_pdf(id) on delete set null;

comment on column public.ordenes_trabajo.cotizacion_pdf_id is
  'La cotización en PDF que la originó (migración 101). Con ella, la orden no se queda sin su propio PDF.';

-- Una orden viva por cotización: si se anuló, se puede volver a emitir.
create unique index if not exists uq_orden_por_cotizacion_pdf
  on public.ordenes_trabajo (cotizacion_pdf_id)
  where cotizacion_pdf_id is not null and estado <> 'ANULADA';

/**
 * Emitir la orden desde una cotización aprobada. La hace Administración
 * (`ordenes.crear`) con lo poco que falta: la unidad, la fecha prometida y el
 * PDF de la orden, que ya viajó a Storage con el identificador que se le va a
 * dar a la orden. Todo en una: la orden nace aprobada —con sus etapas y sus
 * plazos— y con su PDF pegado. Si algo falla, no queda ni orden ni papel.
 */
create or replace function public.emitir_orden_de_cotizacion(
  p_cotizacion    uuid,
  p_orden         uuid,
  p_placa         text,
  p_tipo_vehiculo public.tipo_vehiculo,
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
  v_clave   constant text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa   text;
  v_unidad  uuid;
  v_sede    uuid;
  v_nombre  text;
  v_numero  text;
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
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3) then
    raise exception 'El PDF de la orden no llegó en su sitio.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe la placa, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  -- La unidad del cliente: la de esa placa si ya está, o se registra.
  if v_clave <> '' then
    v_placa := case when length(v_clave) = 6 and position('-' in p_placa) = 0
                    then left(v_clave, 3) || '-' || right(v_clave, 3)
                    else upper(btrim(p_placa)) end;

    select u.id into v_unidad
      from public.unidades u
     where upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
     order by (u.cliente_id is not null) desc, u.creado_en desc
     limit 1;

    -- Una unidad que el taller registró sin dueño pasa a ser del cliente.
    if v_unidad is not null then
      update public.unidades set cliente_id = v_cot.cliente_id
       where id = v_unidad and cliente_id is null;
    end if;
  end if;

  if v_unidad is null then
    insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_placa, coalesce(p_tipo_vehiculo, 'OTRO'),
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    id, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
    descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id)
  values (
    p_orden, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION', 'NORMAL',
    format('%s · cotización %s', v_cot.carroceria, v_cot.numero), p_fecha_entrega, 'APROBADA', p_cotizacion)
  returning numero into v_numero;

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf,
          'application/pdf', p_tamano_pdf, public.usuario_actual());

  v_nombre := coalesce(v_placa, nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Orden nueva en el taller',
    format('%s: %s (%s). Armen la lista de su área.', v_numero, v_cot.carroceria, coalesce(v_nombre, 'sin placa')),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  perform public.notificar_a_permiso(
    'diseno.planos',
    'Orden nueva para desglosar',
    format('%s: %s. Falta el desglose de Diseño.', v_numero, v_cot.carroceria),
    '/ordenes/' || p_orden, 'ordenes_trabajo', p_orden, public.usuario_actual());

  return p_orden;
end;
$$;

revoke all on function public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_vehiculo, text, text, date, text, text, bigint)
  from public, anon;
grant execute on function public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_vehiculo, text, text, date, text, text, bigint)
  to authenticated;

-- =============================================================================
-- 4. LA ORDEN NO SE QUEDA SIN SU PDF
-- -----------------------------------------------------------------------------
-- Trazabilidad documentaria: la orden que salió de una cotización nació con su
-- PDF, y ese PDF no se quita. Otro archivo cualquiera sí.
-- =============================================================================
create or replace function public.fn_el_pdf_de_la_orden_se_queda()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_numero text;
begin
  if old.tipo <> 'ORDEN' then
    return old;
  end if;

  select o.numero into v_numero
    from public.ordenes_trabajo o
   where o.id = old.orden_id and o.cotizacion_pdf_id is not null;

  if v_numero is not null
     and not exists (select 1 from public.ot_adjuntos a
                      where a.orden_id = old.orden_id and a.tipo = 'ORDEN' and a.id <> old.id) then
    raise exception 'La orden % no se queda sin su PDF: sube el nuevo antes de quitar este.', v_numero
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

revoke all on function public.fn_el_pdf_de_la_orden_se_queda() from public, anon, authenticated;

drop trigger if exists trg_el_pdf_de_la_orden_se_queda on public.ot_adjuntos;
create trigger trg_el_pdf_de_la_orden_se_queda before delete on public.ot_adjuntos
  for each row execute function public.fn_el_pdf_de_la_orden_se_queda();

-- =============================================================================
-- 5. DÓNDE VIVE EL PDF DE LA COTIZACIÓN
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cotizaciones-pdf', 'cotizaciones-pdf', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mw_leer_cotizaciones_pdf on storage.objects;
create policy mw_leer_cotizaciones_pdf on storage.objects
  for select to authenticated
  using (bucket_id = 'cotizaciones-pdf'
         and (public.es_admin() or public.tiene_permiso('cotizaciones.ver')));

drop policy if exists mw_subir_cotizaciones_pdf on storage.objects;
create policy mw_subir_cotizaciones_pdf on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cotizaciones-pdf'
              and name like 'cot/%'
              and (public.es_admin() or public.tiene_permiso('cotizaciones.crear')));

drop policy if exists mw_borrar_cotizaciones_pdf on storage.objects;
create policy mw_borrar_cotizaciones_pdf on storage.objects
  for delete to authenticated
  using (bucket_id = 'cotizaciones-pdf'
         and (public.es_admin() or owner_id = (auth.uid())::text));

-- =============================================================================
-- 6. LA LISTA, COMO SE LEE
-- =============================================================================
create or replace view public.v_cotizaciones_pdf as
select c.id,
       c.numero,
       c.estado::text as estado,
       c.observacion,
       c.cliente_id,
       cl.razon_social as cliente,
       c.tipo_carroceria_id,
       tc.nombre as carroceria,
       c.nombre_archivo,
       c.ruta_storage,
       c.tamano_bytes,
       c.creado_en,
       c.registrado_por,
       nullif(btrim(coalesce(v.nombres, '') || ' ' || coalesce(v.apellidos, '')), '') as registrado_por_nombre,
       c.revisado_en,
       nullif(btrim(coalesce(g.nombres, '') || ' ' || coalesce(g.apellidos, '')), '') as revisado_por_nombre,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado
  from public.cotizaciones_pdf c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
  left join public.usuarios v on v.id = c.registrado_por
  left join public.usuarios g on g.id = c.revisado_por
  left join lateral (
    select o.id, o.numero, o.estado
      from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
     limit 1
  ) o on true;

alter view public.v_cotizaciones_pdf set (security_invoker = on);
grant select on public.v_cotizaciones_pdf to authenticated;

-- =============================================================================
-- 7. COMPROBACIONES
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.cotizaciones_pdf'::regclass and relrowsecurity) then
    raise exception 'cotizaciones_pdf quedó sin seguridad por fila';
  end if;
  if coalesce((select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_cotizaciones_pdf'::regclass), '')
       not similar to '%security_invoker=(on|true)%' then
    raise exception 'v_cotizaciones_pdf corre como su dueño y se salta el RLS';
  end if;
  if has_function_privilege('anon', 'public.emitir_orden_de_cotizacion(uuid, uuid, text, public.tipo_vehiculo, text, text, date, text, text, bigint)', 'execute') then
    raise exception 'emitir_orden_de_cotizacion quedó abierta al rol anónimo';
  end if;
  if not exists (select 1 from storage.buckets where id = 'cotizaciones-pdf' and not public) then
    raise exception 'Falta el bucket privado cotizaciones-pdf';
  end if;
end $$;
