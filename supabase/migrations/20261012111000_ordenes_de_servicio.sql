-- =============================================================================
-- LA ORDEN DE SERVICIO
-- -----------------------------------------------------------------------------
-- El arenado, la pintura, el torno, el corte láser o el traslado de una unidad
-- se mandan afuera con una orden de servicio (OS-331-MW en el OneDrive de
-- Logística; la última que se ve es la 407). El procedimiento del SIG (§3.2 de
-- complemento-operaciones) dice: el área usuaria pide el servicio, Logística
-- emite la OS, Gerencia la aprueba, el proveedor lo ejecuta, Logística o el
-- área verifican la conformidad y Tesorería paga contra factura.
--
-- Hasta hoy eso vivía en Excel con fecha `=TODAY()` (cambia cada vez que se
-- abre) y sin decir a qué OT ni a qué unidad iba. Desde aquí la OS nace en el
-- sistema con su número de la casa, su proveedor del padrón, la OT y la unidad
-- para la que se pide, el monto sin IGV, el plazo y su estado a la vista:
--
--   Emitida (espera a Gerencia) → Aprobada → En ejecución → Conforme
--                         └→ Rechazada            └→ Anulada (con motivo)
--
-- La aprueba el mismo puesto que aprueba las compras, siempre, sin monto
-- mínimo: así lo pide el procedimiento. Una OS no se borra nunca: se anula con
-- motivo, quién y cuándo.
-- =============================================================================

insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'ORDEN_SERVICIO', '001', 'OS', 407, 3, 'OS-{numero}-MW'
 where not exists (select 1 from public.series_documentarias where tipo = 'ORDEN_SERVICIO' and serie = '001');

create table if not exists public.ordenes_servicio (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null,
  proveedor_id        uuid not null references public.proveedores(id) on delete restrict,
  proveedor           text not null,
  orden_id            uuid references public.ordenes_trabajo(id) on delete restrict,
  area_id             uuid references public.areas(id) on delete restrict,
  descripcion         text not null,
  referencia          text,
  fecha_inicio        date,
  fecha_fin           date,
  moneda              text not null default 'PEN',
  monto               numeric(14, 2) not null,
  monto_pen           numeric(14, 2),
  condicion_pago      text not null default 'CONTADO',
  dias_credito        integer not null default 0,
  aprobacion          text not null default 'POR_APROBAR',
  aprobado_por        uuid references public.usuarios(id) on delete restrict,
  aprobado_en         timestamptz,
  rechazado_por       uuid references public.usuarios(id) on delete restrict,
  rechazado_en        timestamptz,
  motivo_rechazo      text,
  estado              text not null default 'EMITIDA',
  iniciado_en         timestamptz,
  conformidad_por     uuid references public.usuarios(id) on delete restrict,
  conformidad_en      timestamptz,
  observacion_conformidad text,
  anulado_por         uuid references public.usuarios(id) on delete restrict,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_por          uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint uq_orden_servicio_numero unique (numero),
  constraint ck_os_textos check (
    char_length(btrim(descripcion)) between 10 and 1000
    and char_length(btrim(proveedor)) between 2 and 160
    and (referencia is null or char_length(btrim(referencia)) between 2 and 100)),
  constraint ck_os_monto check (monto >= 0 and monto <= 999999999 and moneda in ('PEN', 'USD')),
  constraint ck_os_pago check (
    (condicion_pago = 'CONTADO' and dias_credito = 0)
    or (condicion_pago = 'CREDITO' and dias_credito between 1 and 365)),
  constraint ck_os_plazo check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio),
  constraint ck_os_aprobacion check (
    aprobacion in ('POR_APROBAR', 'APROBADA', 'RECHAZADA')
    and (aprobacion <> 'APROBADA' or (aprobado_por is not null and aprobado_en is not null))
    and (aprobacion <> 'RECHAZADA' or (rechazado_por is not null and rechazado_en is not null
                                       and char_length(btrim(coalesce(motivo_rechazo, ''))) between 10 and 500))),
  constraint ck_os_estado check (
    estado in ('EMITIDA', 'EN_EJECUCION', 'CONFORME', 'ANULADA')
    and (estado not in ('EN_EJECUCION', 'CONFORME') or aprobacion = 'APROBADA')
    and (estado <> 'EN_EJECUCION' or iniciado_en is not null)
    and (estado <> 'CONFORME' or (conformidad_por is not null and conformidad_en is not null))
    and (estado <> 'ANULADA' or (anulado_por is not null and anulado_en is not null
                                 and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500)))
);
comment on table public.ordenes_servicio is
  'Órdenes de servicio a terceros (arenado, pintura, torno, traslado…). Número OS-408-MW en adelante. No se borran: se anulan.';
comment on column public.ordenes_servicio.orden_id is 'La OT para la que se pide el servicio. Vacía si es del taller en general.';
comment on column public.ordenes_servicio.area_id is 'El área que pide el servicio.';
comment on column public.ordenes_servicio.monto is 'Monto sin IGV, en la moneda de la orden.';

-- El listado de Logística va por fecha; el de Gerencia, por lo que espera.
create index if not exists ix_os_creado on public.ordenes_servicio (creado_en desc);
create index if not exists ix_os_por_aprobar on public.ordenes_servicio (creado_en) where aprobacion = 'POR_APROBAR';
-- El costo de una OT junta sus servicios.
create index if not exists ix_os_orden on public.ordenes_servicio (orden_id) where orden_id is not null;

select public.activar_timestamps('ordenes_servicio');
select public.activar_auditoria('ordenes_servicio');
select public.activar_registro_de_prueba('ordenes_servicio');

create or replace function public.fn_os_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una orden de servicio no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if new.numero is distinct from old.numero or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en then
    raise exception 'El número y el autor de la orden de servicio no cambian.' using errcode = 'check_violation';
  end if;
  if old.estado in ('CONFORME', 'ANULADA') then
    raise exception 'La orden de servicio % ya está %: queda como evidencia.', old.numero,
      case old.estado when 'CONFORME' then 'conforme' else 'anulada' end using errcode = 'check_violation';
  end if;
  if old.aprobacion = 'RECHAZADA' and new.estado <> 'ANULADA' then
    raise exception 'La orden de servicio % fue rechazada. Emite otra.', old.numero using errcode = 'check_violation';
  end if;
  -- Lo que Gerencia aprobó no se cambia por debajo.
  if old.aprobacion <> 'POR_APROBAR'
     and row(new.proveedor_id, new.orden_id, new.descripcion, new.moneda, new.monto, new.condicion_pago, new.dias_credito)
         is distinct from row(old.proveedor_id, old.orden_id, old.descripcion, old.moneda, old.monto, old.condicion_pago, old.dias_credito) then
    raise exception 'La orden de servicio % ya fue decidida por Gerencia: anúlala y emite otra si cambió.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_os_guardia() from public, anon, authenticated;

create or replace trigger trg_os_guardia
  before update or delete on public.ordenes_servicio
  for each row execute function public.fn_os_guardia();

alter table public.ordenes_servicio enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ordenes_servicio'
                   and policyname = 'ver_ordenes_servicio') then
    create policy ver_ordenes_servicio on public.ordenes_servicio for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('compras.ver'))
      or (select public.tiene_permiso('compras.crear'))
      or (select public.tiene_permiso('tesoreria.ver_documentos'))
      or (select public.tiene_permiso('costos.ver'))
      or (select public.es_aprobador_compras())
    );
  end if;
end $$;
-- Se escribe solo por las funciones de abajo.
revoke all on public.ordenes_servicio from public, anon, authenticated;
grant select on public.ordenes_servicio to authenticated;

-- Emitir -------------------------------------------------------------------------
create or replace function public.emitir_orden_servicio(
  p_id uuid, p_proveedor_id uuid, p_orden_id uuid, p_area_id uuid, p_descripcion text, p_referencia text,
  p_fecha_inicio date, p_fecha_fin date, p_moneda text, p_monto numeric, p_condicion text, p_dias integer
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_proveedor public.proveedores%rowtype;
  v_actual    public.ordenes_servicio%rowtype;
  v_regla     public.regla_aprobacion_compras%rowtype;
  v_numero    text;
  v_tc        numeric;
  v_pen       numeric;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or char_length(btrim(coalesce(p_descripcion, ''))) not between 10 and 1000 then
    raise exception 'Describe el servicio en al menos 10 caracteres: qué se hace, a qué pieza o unidad.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto < 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica el monto sin IGV y la moneda.' using errcode = 'check_violation';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias not between 1 and 365) then
    raise exception 'Indica el plazo de pago válido.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede ser anterior a la de inicio.' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_referencia), '') is not null and char_length(btrim(p_referencia)) not between 2 and 100 then
    raise exception 'La referencia del proveedor va de 2 a 100 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_servicio where id = p_id;
  if found then
    if v_actual.creado_por = public.usuario_actual() and v_actual.proveedor_id = p_proveedor_id
       and v_actual.descripcion = btrim(p_descripcion) and v_actual.monto = p_monto and v_actual.moneda = p_moneda then
      return p_id;
    end if;
    raise exception 'Esta orden de servicio ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;
  if p_orden_id is not null and not exists (
      select 1 from public.ordenes_trabajo where id = p_orden_id and estado::text not in ('ANULADA', 'BORRADOR')) then
    raise exception 'La OT elegida no está vigente. Quítala o elige otra.' using errcode = 'check_violation';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id) then
    raise exception 'El área elegida no existe.' using errcode = 'check_violation';
  end if;

  if p_moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(p_monto * v_tc, 2) end;
  else
    v_pen := p_monto;
  end if;

  v_numero := public.siguiente_correlativo('ORDEN_SERVICIO', '001', null);
  insert into public.ordenes_servicio
    (id, numero, proveedor_id, proveedor, orden_id, area_id, descripcion, referencia, fecha_inicio, fecha_fin,
     moneda, monto, monto_pen, condicion_pago, dias_credito, creado_por)
  values
    (p_id, v_numero, p_proveedor_id, v_proveedor.razon_social, p_orden_id, p_area_id, btrim(p_descripcion),
     nullif(btrim(p_referencia), ''), p_fecha_inicio, p_fecha_fin, p_moneda, p_monto, v_pen, p_condicion, p_dias,
     public.usuario_actual());

  select * into v_regla from public.regla_aprobacion_compras where unica;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Servicio por aprobar: ' || v_numero,
         v_proveedor.razon_social || ' · ' || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), p_moneda || ' sin tipo de cambio'),
         '/compras/aprobacion', 'ordenes_servicio', p_id
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id and u.id is distinct from public.usuario_actual();
  return p_id;
end;
$$;
revoke all on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, date, date, text, numeric, text, integer) from public, anon;
grant execute on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, date, date, text, numeric, text, integer) to authenticated;

-- Aprobar y rechazar: el mismo puesto que aprueba las compras ----------------------
create or replace function public.aprobar_orden_servicio(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_os public.ordenes_servicio%rowtype;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede aprobar órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_os from public.ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden de servicio no existe.'; end if;
  if v_os.aprobacion = 'APROBADA' then return p_id; end if;
  if v_os.aprobacion <> 'POR_APROBAR' or v_os.estado <> 'EMITIDA' then
    raise exception 'La orden de servicio % no está esperando aprobación.', v_os.numero using errcode = 'check_violation';
  end if;
  update public.ordenes_servicio set aprobacion = 'APROBADA', aprobado_por = public.usuario_actual(), aprobado_en = now()
   where id = p_id;
  perform public.notificar_a_usuario(v_os.creado_por, 'Servicio aprobado: ' || v_os.numero,
    v_os.proveedor || '. Ya puedes enviarle la orden.', '/compras/servicios', 'ordenes_servicio', p_id, public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.aprobar_orden_servicio(uuid) from public, anon;
grant execute on function public.aprobar_orden_servicio(uuid) to authenticated;

create or replace function public.rechazar_orden_servicio(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_os public.ordenes_servicio%rowtype;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede rechazar órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Escribe el motivo del rechazo (de 10 a 500 caracteres): Logística lo necesita para corregir el servicio.'
      using errcode = 'check_violation';
  end if;
  select * into v_os from public.ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden de servicio no existe.'; end if;
  if v_os.aprobacion = 'RECHAZADA' then return p_id; end if;
  if v_os.aprobacion <> 'POR_APROBAR' or v_os.estado <> 'EMITIDA' then
    raise exception 'La orden de servicio % no está esperando aprobación.', v_os.numero using errcode = 'check_violation';
  end if;
  update public.ordenes_servicio
     set aprobacion = 'RECHAZADA', rechazado_por = public.usuario_actual(), rechazado_en = now(), motivo_rechazo = btrim(p_motivo)
   where id = p_id;
  perform public.notificar_a_usuario(v_os.creado_por, 'Servicio rechazado: ' || v_os.numero,
    btrim(p_motivo), '/compras/servicios', 'ordenes_servicio', p_id, public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.rechazar_orden_servicio(uuid, text) from public, anon;
grant execute on function public.rechazar_orden_servicio(uuid, text) to authenticated;

-- El recorrido: en ejecución, conforme, anulada --------------------------------------
create or replace function public.avanzar_orden_servicio(p_id uuid, p_paso text, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_os public.ordenes_servicio%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_os from public.ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden de servicio no existe.'; end if;

  if p_paso = 'EN_EJECUCION' then
    if v_os.estado = 'EN_EJECUCION' then return p_id; end if;
    if v_os.aprobacion <> 'APROBADA' or v_os.estado <> 'EMITIDA' then
      raise exception 'La orden de servicio % se inicia cuando Gerencia la aprueba.', v_os.numero using errcode = 'check_violation';
    end if;
    update public.ordenes_servicio set estado = 'EN_EJECUCION', iniciado_en = now() where id = p_id;
  elsif p_paso = 'CONFORME' then
    if v_os.estado = 'CONFORME' then return p_id; end if;
    if v_os.aprobacion <> 'APROBADA' or v_os.estado not in ('EMITIDA', 'EN_EJECUCION') then
      raise exception 'La orden de servicio % no está aprobada o ya se cerró.', v_os.numero using errcode = 'check_violation';
    end if;
    if nullif(btrim(p_nota), '') is not null and char_length(btrim(p_nota)) > 500 then
      raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
    end if;
    update public.ordenes_servicio
       set estado = 'CONFORME', iniciado_en = coalesce(iniciado_en, now()), conformidad_por = public.usuario_actual(),
           conformidad_en = now(), observacion_conformidad = nullif(btrim(p_nota), '')
     where id = p_id;
  elsif p_paso = 'ANULADA' then
    if v_os.estado = 'ANULADA' then return p_id; end if;
    if v_os.estado = 'CONFORME' then
      raise exception 'La orden de servicio % ya tiene conformidad: no se anula.', v_os.numero using errcode = 'check_violation';
    end if;
    if char_length(btrim(coalesce(p_nota, ''))) not between 10 and 500 then
      raise exception 'Cuenta por qué se anula, en al menos 10 caracteres.' using errcode = 'check_violation';
    end if;
    update public.ordenes_servicio
       set estado = 'ANULADA', anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_nota)
     where id = p_id;
  else
    raise exception 'Paso desconocido.' using errcode = 'check_violation';
  end if;
  return p_id;
end;
$$;
revoke all on function public.avanzar_orden_servicio(uuid, text, text) from public, anon;
grant execute on function public.avanzar_orden_servicio(uuid, text, text) to authenticated;

-- Los listados ---------------------------------------------------------------------
create or replace function public.ordenes_servicio_listado()
returns table (
  id uuid, numero text, referencia text, proveedor text, proveedor_documento text,
  orden text, unidad text, area text, descripcion text, fecha_inicio date, fecha_fin date,
  moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer,
  aprobacion text, motivo_rechazo text, estado text, motivo_anulacion text, observacion_conformidad text,
  creado_en timestamptz, emitida_por text, atrasada boolean
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.es_aprobador_compras()) then
    raise exception 'No tienes permiso para ver las órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, s.numero, s.referencia, s.proveedor, p.numero_documento,
         o.numero, case when u.id is null then null else public.nombre_unidad_almacen(u) end, a.nombre,
         s.descripcion, s.fecha_inicio, s.fecha_fin, s.moneda, s.monto, s.monto_pen, s.condicion_pago, s.dias_credito,
         s.aprobacion, s.motivo_rechazo, s.estado, s.motivo_anulacion, s.observacion_conformidad,
         s.creado_en, public.puesto(uc),
         (s.fecha_fin is not null and s.fecha_fin < (now() at time zone 'America/Lima')::date
          and s.estado in ('EMITIDA', 'EN_EJECUCION') and s.aprobacion <> 'RECHAZADA')
    from public.ordenes_servicio s
    left join public.proveedores p on p.id = s.proveedor_id
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.unidades u on u.id = o.unidad_id
    left join public.areas a on a.id = s.area_id
    left join public.usuarios uc on uc.id = s.creado_por
   order by s.creado_en desc
   limit 300;
end;
$$;
revoke all on function public.ordenes_servicio_listado() from public, anon;
grant execute on function public.ordenes_servicio_listado() to authenticated;

-- Lo que ve quien aprueba: compras y servicios en una sola bandeja. Reemplaza
-- en pantalla a `compras_para_aprobar`, que no conoce la compra directa ni el
-- servicio.
create or replace function public.documentos_por_aprobar()
returns table (
  tipo text, id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text,
  moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer,
  fecha_estimada date, aprobacion text, pedida_en timestamptz, emitida_por text,
  decidida_por text, decidida_en timestamptz, motivo_rechazo text, motivo text,
  ordenes text[], unidades text[], lineas jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_aprobador_compras() or public.tiene_permiso('compras.ver')
          or public.tiene_permiso('compras.configurar_aprobacion')) then
    raise exception 'No tienes permiso para ver lo que espera aprobación.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select * from (
    select 'OC'::text, c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,
           c.moneda,
           coalesce(l.total, (select sum((x->>'cantidad')::numeric * coalesce((x->>'precio_unitario')::numeric, 0))
                                from jsonb_array_elements(c.lineas_rechazadas) x), 0),
           c.monto_pen, c.condicion_pago, c.dias_credito, c.fecha_estimada, c.aprobacion as x_aprobacion,
           coalesce(c.aprobacion_pedida_en, c.creado_en) as x_pedida,
           public.puesto(uc), public.puesto(coalesce(ua, ur)), coalesce(c.aprobado_en, c.rechazado_en),
           c.motivo_rechazo, c.motivo,
           coalesce(nullif(l.ordenes, array[]::text[]),
                    array(select distinct x->>'orden' from jsonb_array_elements(c.lineas_rechazadas) x
                           where x->>'orden' is not null order by 1)),
           coalesce(l.unidades, array[]::text[]),
           coalesce(l.lineas, c.lineas_rechazadas, '[]'::jsonb)
      from public.ordenes_compra_materiales c
      left join public.proveedores p on p.id = c.proveedor_id
      left join public.usuarios uc on uc.id = c.creado_por
      left join public.usuarios ua on ua.id = c.aprobado_por
      left join public.usuarios ur on ur.id = c.rechazado_por
      left join lateral (
        select sum(d.cantidad * coalesce(d.precio_unitario, 0)) as total,
               array_remove(array_agg(distinct o.numero), null) as ordenes,
               array_remove(array_agg(distinct public.nombre_unidad_almacen(u)) filter (where u.id is not null), null) as unidades,
               jsonb_agg(jsonb_build_object(
                 'orden', o.numero, 'area', r.area_destino,
                 'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
                 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero nulls first, m.codigo) as lineas
          from public.orden_compra_material_detalles d
          left join public.requerimientos_materiales r on r.id = d.requerimiento_id
          left join public.ordenes_trabajo o on o.id = r.orden_id
          left join public.unidades u on u.id = o.unidad_id
          left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
          left join public.ot_materiales om on om.id = rd.ot_material_id
          left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
          left join public.unidades_medida um on um.id = m.unidad_medida_id
         where d.orden_compra_id = c.id
      ) l on true
     where c.aprobacion = 'POR_APROBAR'
        or (c.aprobacion in ('APROBADA', 'RECHAZADA') and coalesce(c.aprobado_en, c.rechazado_en) > now() - interval '30 days')
    union all
    select 'OS'::text, s.id, s.numero, s.referencia, 'SERVICIO'::text, s.proveedor, p.numero_documento,
           s.moneda, s.monto, s.monto_pen, s.condicion_pago, s.dias_credito, s.fecha_fin, s.aprobacion,
           s.creado_en, public.puesto(uc), public.puesto(coalesce(ua, ur)), coalesce(s.aprobado_en, s.rechazado_en),
           s.motivo_rechazo, s.descripcion,
           case when o.numero is null then array[]::text[] else array[o.numero] end,
           case when u.id is null then array[]::text[] else array[public.nombre_unidad_almacen(u)] end,
           '[]'::jsonb
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
      left join public.usuarios uc on uc.id = s.creado_por
      left join public.usuarios ua on ua.id = s.aprobado_por
      left join public.usuarios ur on ur.id = s.rechazado_por
      left join public.ordenes_trabajo o on o.id = s.orden_id
      left join public.unidades u on u.id = o.unidad_id
     where (s.aprobacion = 'POR_APROBAR' and s.estado = 'EMITIDA')
        or (s.aprobacion in ('APROBADA', 'RECHAZADA') and coalesce(s.aprobado_en, s.rechazado_en) > now() - interval '30 days')
  ) t
  order by t.x_aprobacion = 'POR_APROBAR' desc, t.x_pedida desc
  limit 300;
end;
$$;
revoke all on function public.documentos_por_aprobar() from public, anon;
grant execute on function public.documentos_por_aprobar() to authenticated;
