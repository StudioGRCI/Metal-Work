-- =============================================================================
-- LA APROBACIÓN DE COMPRAS
-- -----------------------------------------------------------------------------
-- En agosto, la mitad de los reclamos de «no llega el material» terminaron en
-- «faltó aprobación»: Logística manda el PDF de la orden por WhatsApp, Gerencia
-- no la ve o no contesta, y nadie puede probar después qué se pidió ni cuándo.
-- El procedimiento escrito pide la firma de Gerencia en cada orden de compra,
-- sin monto, para unas 160 órdenes al mes.
--
-- Desde aquí la aprobación vive en el sistema y la regla la fija la empresa:
--
--   · Quién aprueba: un puesto (Gerencia, por omisión), no una persona, para
--     que la regla no se rompa cuando cambia quien ocupa el cargo.
--   · Desde qué monto: en soles, sin IGV. Una compra en dólares se convierte
--     con el tipo de cambio de venta del día que Tesorería registra.
--   · Si está encendida o no. **Nace apagada**: la empresa no ha confirmado el
--     monto, y encenderla cambia el trabajo diario de Logística. La enciende
--     Gerencia desde Compras → Aprobación cuando lo decida.
--
-- Con la regla encendida, la compra que llega al monto queda «por aprobar».
-- Mientras tanto Logística no puede entregarla a Almacén y Almacén no puede
-- recibirla. Quien aprueba la ve con su monto, sus OT y sus líneas, y la aprueba
-- o la rechaza con un motivo. Una compra rechazada no se borra: queda con su
-- referencia, quién la rechazó, cuándo, por qué y una copia de sus líneas, y
-- esas líneas vuelven a quedar pendientes de compra para que Logística emita
-- otra orden.
--
-- Las compras registradas antes de esta migración quedan como «no requería
-- aprobación»: la regla no se aplica hacia atrás.
-- =============================================================================

-- 1. Quién configura la regla -----------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.configurar_aprobacion', 'Logística', 'Fijar quién aprueba las compras y desde qué monto')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.configurar_aprobacion' from public.roles r where r.codigo = 'GERENTE'
on conflict do nothing;

-- 2. La regla: una sola fila ----------------------------------------------------
create table if not exists public.regla_aprobacion_compras (
  id               uuid primary key default gen_random_uuid(),
  unica            boolean not null default true,
  activa           boolean not null default false,
  monto_desde      numeric(14, 2) not null default 5000,
  rol_aprobador_id uuid not null references public.roles(id) on delete restrict,
  actualizado_por  uuid references public.usuarios(id) on delete set null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  -- Una sola regla para toda la empresa. El id es uuid porque la auditoría lo
  -- exige; `unica` es lo que impide una segunda fila.
  constraint uq_regla_aprobacion_unica unique (unica),
  constraint ck_regla_aprobacion_unica check (unica),
  constraint ck_regla_aprobacion_monto check (monto_desde >= 0 and monto_desde <= 999999999)
);
comment on table public.regla_aprobacion_compras is
  'Quién aprueba las órdenes de compra y desde qué monto en soles sin IGV. Una sola fila; nace apagada.';

insert into public.regla_aprobacion_compras (activa, monto_desde, rol_aprobador_id)
select false, 5000, r.id from public.roles r where r.codigo = 'GERENTE'
on conflict (unica) do nothing;

select public.activar_timestamps('regla_aprobacion_compras');
select public.activar_auditoria('regla_aprobacion_compras');
select public.activar_registro_de_prueba('regla_aprobacion_compras');

-- ¿La persona en sesión es quien aprueba? ADMIN siempre puede.
create or replace function public.es_aprobador_compras()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or exists (
    select 1
      from public.usuarios u
      join public.regla_aprobacion_compras g on g.rol_aprobador_id = u.rol_id
     where u.id = public.usuario_actual() and u.activo
  );
$$;
revoke all on function public.es_aprobador_compras() from public, anon;
grant execute on function public.es_aprobador_compras() to authenticated;

alter table public.regla_aprobacion_compras enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'regla_aprobacion_compras'
                   and policyname = 'ver_regla_aprobacion_compras') then
    create policy ver_regla_aprobacion_compras on public.regla_aprobacion_compras for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('compras.ver'))
      or (select public.tiene_permiso('compras.configurar_aprobacion'))
      or (select public.es_aprobador_compras())
    );
  end if;
end $$;
-- Se cambia solo con `fijar_regla_aprobacion_compras`, que exige el permiso.
revoke all on public.regla_aprobacion_compras from public, anon, authenticated;
grant select on public.regla_aprobacion_compras to authenticated;

create or replace function public.fijar_regla_aprobacion_compras(
  p_activa boolean, p_monto_desde numeric, p_rol_aprobador uuid
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rol text; v_id uuid;
begin
  perform public.exigir_permiso('compras.configurar_aprobacion');
  if p_activa is null or p_monto_desde is null or p_monto_desde < 0 or p_monto_desde > 999999999
     or p_monto_desde <> round(p_monto_desde, 2) then
    raise exception 'Indica un monto en soles válido, de 0 en adelante.' using errcode = 'check_violation';
  end if;
  select codigo into v_rol from public.roles where id = p_rol_aprobador;
  if not found or v_rol in ('CONSULTA', 'OPERARIO') then
    raise exception 'Elige el puesto que aprobará las compras.' using errcode = 'check_violation';
  end if;
  if p_activa and not exists (select 1 from public.usuarios where rol_id = p_rol_aprobador and activo) then
    raise exception 'Nadie activo ocupa ese puesto: las compras se quedarían esperando. Elige otro puesto o da de alta su cuenta.'
      using errcode = 'check_violation';
  end if;
  update public.regla_aprobacion_compras
     set activa = p_activa, monto_desde = p_monto_desde, rol_aprobador_id = p_rol_aprobador,
         actualizado_por = public.usuario_actual()
   where unica
  returning id into v_id;
  if v_id is null then
    raise exception 'Falta la regla de aprobación de compras. Aplica la migración que la crea.';
  end if;
  return v_id;
end;
$$;
revoke all on function public.fijar_regla_aprobacion_compras(boolean, numeric, uuid) from public, anon;
grant execute on function public.fijar_regla_aprobacion_compras(boolean, numeric, uuid) to authenticated;

-- 3. El estado de la compra ------------------------------------------------------
alter table public.ordenes_compra_materiales
  add column if not exists aprobacion text not null default 'NO_REQUERIDA',
  add column if not exists monto_pen numeric(14, 2),
  add column if not exists aprobacion_pedida_en timestamptz,
  add column if not exists aprobado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists aprobado_en timestamptz,
  add column if not exists monto_aprobado_pen numeric(14, 2),
  add column if not exists rechazado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists rechazado_en timestamptz,
  add column if not exists motivo_rechazo text,
  add column if not exists lineas_rechazadas jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordenes_compra_materiales'::regclass
                   and conname = 'ck_compra_aprobacion') then
    alter table public.ordenes_compra_materiales add constraint ck_compra_aprobacion check (
      aprobacion in ('NO_REQUERIDA', 'POR_APROBAR', 'APROBADA', 'RECHAZADA')
      and (aprobacion <> 'APROBADA' or (aprobado_por is not null and aprobado_en is not null))
      and (aprobacion <> 'RECHAZADA' or (rechazado_por is not null and rechazado_en is not null
                                         and char_length(btrim(coalesce(motivo_rechazo, ''))) between 10 and 500))
    );
  end if;
end $$;

comment on column public.ordenes_compra_materiales.aprobacion is
  'NO_REQUERIDA (no llegó al monto o la regla estaba apagada), POR_APROBAR, APROBADA o RECHAZADA. La pone la base, nunca la aplicación.';
comment on column public.ordenes_compra_materiales.monto_pen is
  'Total sin IGV en soles con el que se evaluó la aprobación. Las compras en dólares usan el tipo de cambio de venta del día.';
comment on column public.ordenes_compra_materiales.lineas_rechazadas is
  'Copia de las líneas de una compra rechazada: las líneas vuelven a quedar pendientes de compra, la evidencia queda aquí.';

-- El listado de quien aprueba filtra por estado.
create index if not exists ix_compras_por_aprobar on public.ordenes_compra_materiales (aprobacion_pedida_en)
  where aprobacion = 'POR_APROBAR';

-- 4. El tipo de cambio para comparar ---------------------------------------------
create or replace function public.tipo_cambio_venta(p_fecha date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select venta from public.tipos_de_cambio where fecha <= p_fecha order by fecha desc limit 1;
$$;
revoke all on function public.tipo_cambio_venta(date) from public, anon;
grant execute on function public.tipo_cambio_venta(date) to authenticated;

-- 5. Evaluar la compra cuando ya tiene todas sus líneas --------------------------
-- La compra se crea en dos pasos (cabecera y líneas) y el precio de una línea se
-- puede completar después. Por eso se evalúa con un disparador diferido: corre
-- al confirmar la transacción, cuando las líneas ya están todas.
create or replace function public.evaluar_aprobacion_compra(p_compra uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_regla  public.regla_aprobacion_compras%rowtype;
  v_total  numeric;
  v_tc     numeric;
  v_pen    numeric;
  v_rol    text;
begin
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found or v_compra.aprobacion = 'RECHAZADA' then
    return v_compra.aprobacion;
  end if;
  select * into v_regla from public.regla_aprobacion_compras where unica;

  select coalesce(sum(cantidad * coalesce(precio_unitario, 0)), 0) into v_total
    from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  if v_compra.moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(v_total * v_tc, 2) end;
  else
    v_pen := round(v_total, 2);
  end if;

  update public.ordenes_compra_materiales set monto_pen = v_pen where id = p_compra;

  if not coalesce(v_regla.activa, false) then
    return v_compra.aprobacion;
  end if;
  -- Ya aprobada y el monto no creció: sigue aprobada. Una compra en dólares sin
  -- tipo de cambio registrado no se puede comparar y pasa a quien aprueba.
  if v_compra.aprobacion = 'APROBADA' and v_pen is not null and v_pen <= v_compra.monto_aprobado_pen then
    return 'APROBADA';
  end if;
  if v_compra.aprobacion = 'NO_REQUERIDA' and v_compra.entregado_almacen_en is not null then
    return 'NO_REQUERIDA';
  end if;
  if v_pen is not null and v_pen < v_regla.monto_desde then
    return v_compra.aprobacion;
  end if;
  if v_compra.aprobacion = 'POR_APROBAR' then
    return 'POR_APROBAR';
  end if;

  update public.ordenes_compra_materiales
     set aprobacion = 'POR_APROBAR', aprobacion_pedida_en = now(),
         aprobado_por = null, aprobado_en = null
   where id = p_compra;

  select nombre into v_rol from public.roles where id = v_regla.rol_aprobador_id;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         'Compra por aprobar: ' || v_compra.referencia,
         v_compra.proveedor || ' · ' || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), v_compra.moneda || ' sin tipo de cambio'),
         '/compras/aprobacion', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id
     and u.id is distinct from v_compra.creado_por;
  return 'POR_APROBAR';
end;
$$;
revoke all on function public.evaluar_aprobacion_compra(uuid) from public, anon, authenticated;

create or replace function public.fn_compra_evaluar_aprobacion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.evaluar_aprobacion_compra(new.orden_compra_id);
  return null;
end;
$$;
revoke all on function public.fn_compra_evaluar_aprobacion() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_compra_evaluar_aprobacion'
                   and tgrelid = 'public.orden_compra_material_detalles'::regclass) then
    create constraint trigger trg_compra_evaluar_aprobacion
      after insert or update of cantidad, precio_unitario on public.orden_compra_material_detalles
      deferrable initially deferred
      for each row execute function public.fn_compra_evaluar_aprobacion();
  end if;
end $$;

-- 6. Lo que espera aprobación no avanza ------------------------------------------
create or replace function public.mensaje_compra_sin_aprobar(p_compra public.ordenes_compra_materiales)
returns text language sql stable security definer set search_path to 'public' as $$
  select case p_compra.aprobacion
    when 'POR_APROBAR' then 'La compra ' || p_compra.referencia || ' espera la aprobación de '
         || coalesce((select r.nombre from public.regla_aprobacion_compras g join public.roles r on r.id = g.rol_aprobador_id where g.unica), 'Gerencia')
         || '. Se entrega y se recibe cuando esté aprobada.'
    when 'RECHAZADA' then 'La compra ' || p_compra.referencia || ' fue rechazada: ' || coalesce(p_compra.motivo_rechazo, '')
         || '. Emite una nueva orden con las líneas pendientes.'
  end;
$$;
revoke all on function public.mensaje_compra_sin_aprobar(public.ordenes_compra_materiales) from public, anon, authenticated;

create or replace function public.fn_compra_entrega_exige_aprobacion()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
  end if;
  if new.aprobacion is distinct from old.aprobacion and old.aprobacion = 'RECHAZADA' then
    raise exception 'Una compra rechazada no vuelve atrás. Emite una nueva orden.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_entrega_exige_aprobacion() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_compra_entrega_exige_aprobacion'
                   and tgrelid = 'public.ordenes_compra_materiales'::regclass) then
    create trigger trg_compra_entrega_exige_aprobacion
      before update on public.ordenes_compra_materiales
      for each row execute function public.fn_compra_entrega_exige_aprobacion();
  end if;
end $$;

create or replace function public.fn_recepcion_exige_aprobacion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  if new.orden_compra_detalle_id is null then
    return new;
  end if;
  select c.* into v_compra
    from public.orden_compra_material_detalles d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.id = new.orden_compra_detalle_id;
  if found and v_compra.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(v_compra) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_recepcion_exige_aprobacion() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_recepcion_exige_aprobacion'
                   and tgrelid = 'public.movimientos_materiales'::regclass) then
    create trigger trg_recepcion_exige_aprobacion
      before insert on public.movimientos_materiales
      for each row execute function public.fn_recepcion_exige_aprobacion();
  end if;
end $$;

-- 7. Aprobar y rechazar ----------------------------------------------------------
create or replace function public.aprobar_compra(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede aprobarlas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion = 'APROBADA' then
    return p_compra;
  end if;
  if v_compra.aprobacion <> 'POR_APROBAR' then
    raise exception 'La compra % no está esperando aprobación.', v_compra.referencia using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set aprobacion = 'APROBADA', aprobado_por = public.usuario_actual(), aprobado_en = now(),
         monto_aprobado_pen = monto_pen
   where id = p_compra;
  perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || v_compra.referencia,
    v_compra.proveedor || '. Ya puedes enviarla al proveedor y entregarla a Almacén cuando llegue.',
    '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return p_compra;
end;
$$;
revoke all on function public.aprobar_compra(uuid) from public, anon;
grant execute on function public.aprobar_compra(uuid) to authenticated;

create or replace function public.rechazar_compra(p_compra uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_lineas jsonb;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede rechazarlas.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Escribe el motivo del rechazo (de 10 a 500 caracteres): Logística lo necesita para corregir la compra.'
      using errcode = 'check_violation';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion = 'RECHAZADA' then
    return p_compra;
  end if;
  if v_compra.aprobacion <> 'POR_APROBAR' then
    raise exception 'La compra % no está esperando aprobación.', v_compra.referencia using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'requerimiento_detalle_id', d.requerimiento_detalle_id,
           'orden', o.numero, 'area', r.area_destino,
           'material_codigo', m.codigo, 'material', m.descripcion,
           'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero, m.codigo), '[]'::jsonb)
    into v_lineas
    from public.orden_compra_material_detalles d
    join public.requerimientos_materiales r on r.id = d.requerimiento_id
    join public.ordenes_trabajo o on o.id = r.orden_id
    join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    join public.ot_materiales om on om.id = rd.ot_material_id
    join public.materiales m on m.id = om.material_id
   where d.orden_compra_id = p_compra;

  -- Las líneas se liberan para que Logística las vuelva a comprar; la copia
  -- queda en la cabecera, que no se borra.
  delete from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  update public.ordenes_compra_materiales
     set aprobacion = 'RECHAZADA', rechazado_por = public.usuario_actual(), rechazado_en = now(),
         motivo_rechazo = btrim(p_motivo), lineas_rechazadas = v_lineas
   where id = p_compra;
  perform public.notificar_a_usuario(v_compra.creado_por, 'Compra rechazada: ' || v_compra.referencia,
    btrim(p_motivo) || ' Sus líneas volvieron a quedar pendientes de compra.',
    '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return p_compra;
end;
$$;
revoke all on function public.rechazar_compra(uuid, text) from public, anon;
grant execute on function public.rechazar_compra(uuid, text) to authenticated;

-- 8. Lo que ve quien aprueba ----------------------------------------------------
-- Quien aprueba no necesita ver solicitudes, almacén ni planos: necesita la
-- compra, su monto, de qué OT es y qué lleva. Una sola función con una sola
-- puerta, en vez de abrirle cinco tablas.
create or replace function public.compras_para_aprobar()
returns table (
  id uuid, referencia text, proveedor text, proveedor_documento text, moneda text,
  monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer,
  fecha_estimada date, aprobacion text, pedida_en timestamptz, creado_en timestamptz,
  emitida_por text, decidida_por text, decidida_en timestamptz, motivo_rechazo text,
  ordenes text[], lineas jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_aprobador_compras() or public.tiene_permiso('compras.ver')
          or public.tiene_permiso('compras.configurar_aprobacion')) then
    raise exception 'No tienes permiso para ver las compras por aprobar.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.referencia, c.proveedor, p.numero_documento, c.moneda,
         coalesce(l.total, (select sum((x->>'cantidad')::numeric * coalesce((x->>'precio_unitario')::numeric, 0))
                              from jsonb_array_elements(c.lineas_rechazadas) x)),
         c.monto_pen, c.condicion_pago, c.dias_credito, c.fecha_estimada, c.aprobacion,
         c.aprobacion_pedida_en, c.creado_en,
         public.puesto(uc),
         public.puesto(coalesce(ua, ur)),
         coalesce(c.aprobado_en, c.rechazado_en),
         c.motivo_rechazo,
         coalesce(l.ordenes, array(select distinct x->>'orden' from jsonb_array_elements(c.lineas_rechazadas) x order by 1)),
         coalesce(l.lineas, c.lineas_rechazadas, '[]'::jsonb)
    from public.ordenes_compra_materiales c
    left join public.proveedores p on p.id = c.proveedor_id
    left join public.usuarios uc on uc.id = c.creado_por
    left join public.usuarios ua on ua.id = c.aprobado_por
    left join public.usuarios ur on ur.id = c.rechazado_por
    left join lateral (
      select sum(d.cantidad * coalesce(d.precio_unitario, 0)) as total,
             array_agg(distinct o.numero order by o.numero) as ordenes,
             jsonb_agg(jsonb_build_object(
               'orden', o.numero, 'area', r.area_destino,
               'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
               'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero, m.codigo) as lineas
        from public.orden_compra_material_detalles d
        join public.requerimientos_materiales r on r.id = d.requerimiento_id
        join public.ordenes_trabajo o on o.id = r.orden_id
        join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
        join public.ot_materiales om on om.id = rd.ot_material_id
        join public.materiales m on m.id = om.material_id
        left join public.unidades_medida um on um.id = m.unidad_medida_id
       where d.orden_compra_id = c.id
    ) l on true
   where c.aprobacion = 'POR_APROBAR'
      or (c.aprobacion in ('APROBADA', 'RECHAZADA') and coalesce(c.aprobado_en, c.rechazado_en) > now() - interval '30 days')
   order by (c.aprobacion = 'POR_APROBAR') desc, coalesce(c.aprobacion_pedida_en, c.creado_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_para_aprobar() from public, anon;
grant execute on function public.compras_para_aprobar() to authenticated;
