-- El costo de una carrocería lo arman varias manos, como en la hoja RESUMEN de
-- los costeos de la empresa (docs/ANALISIS-ONEDRIVE.md §12). Quién pone qué lo
-- dijo la empresa el 2026-10-01:
--
--   Logística      el precio de los materiales del almacén (valorización)
--   RR. HH.        la planilla de taller, la administrativa (personal que no es
--                  del taller) y los subcontratos: ya existían y ya se reparten
--                  por OT (migración 20260929190000)
--   Administración los servicios del local (luz, agua, celulares, internet,
--                  seguros, seguridad) y los gastos de operación (trámites de
--                  placas y documentación, comisión de venta, depreciación)
--   Diseño         el porcentaje de merma de cada OT
--   Almacén        las salidas por unidad, que ahora se cargan a la OT abierta
--                  de esa unidad
--
-- Los gastos del mes se reparten entre las OT que RR. HH. repartió en la
-- planilla de ese mes —«las OT trabajadas»—, con la tasa de la hoja de la
-- empresa (electricidad 8 %, agua 10 %…) o en partes iguales, como elija
-- Administración en cada gasto.

-- Las políticas se crean solo si no existen, sin DROP: el servidor de Supabase
-- pide confirmar cualquier DROP y esa confirmación no llega a la sesión que
-- aplica la migración, que se queda colgada (2026-10-01). Si una política nueva
-- necesita cambiar, se cambia con ALTER POLICY.

-- 1. Permiso de Administración para los gastos del mes ----------------------
insert into public.permisos(codigo, modulo, descripcion) values
  ('costos.gastos_generales', 'Costos', 'Registrar los gastos del local y de operación que se reparten entre las OT')
on conflict (codigo) do nothing;
insert into public.roles_permisos(rol_id, permiso_codigo)
select r.id, 'costos.gastos_generales' from public.roles r where r.codigo = 'ADMINISTRACION'
on conflict do nothing;

-- 2. Valorización del almacén (Logística) ------------------------------------
-- Una fila por precio fijado: no se corrige encima, se fija uno nuevo. Así el
-- costo de una salida de agosto no cambia porque en octubre subió el precio.
create table if not exists public.valorizaciones_material (
  id uuid primary key,
  material_id uuid not null references public.materiales(id) on delete restrict,
  precio numeric(14,4) not null check (precio >= 0),
  moneda text not null check (moneda in ('PEN','USD')),
  observacion text not null default '' check (length(observacion) <= 300),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  vigente_desde timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- (b) el costeo y la pantalla buscan el precio vigente de cada material.
create index if not exists idx_valorizaciones_material on public.valorizaciones_material(material_id, vigente_desde desc);
alter table public.valorizaciones_material enable row level security;
revoke all on public.valorizaciones_material from public, anon, authenticated;
grant select on public.valorizaciones_material to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'valorizaciones_material' and policyname = 'ver_valorizaciones_material') then
    create policy ver_valorizaciones_material on public.valorizaciones_material for select to authenticated using (
      public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver'));
  end if;
end $$;
select public.activar_timestamps('valorizaciones_material');
select public.activar_auditoria('valorizaciones_material');
select public.activar_registro_de_prueba('valorizaciones_material');

create or replace function public.valorizar_material(p_id uuid, p_material uuid, p_precio numeric, p_moneda text, p_observacion text default '')
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.valorizaciones_material%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or p_material is null or p_precio is null or p_precio < 0 or p_precio <> round(p_precio, 4)
     or p_moneda is null or p_moneda not in ('PEN','USD') or length(coalesce(p_observacion, '')) > 300 then
    raise exception 'Indica el material, su precio unitario y la moneda.';
  end if;
  select * into v from public.valorizaciones_material where id = p_id;
  if found then
    if v.material_id = p_material and v.precio = p_precio and v.moneda = p_moneda and v.registrado_por = public.usuario_actual() then
      return p_id;
    end if;
    raise exception 'Ese precio ya se registró con otros datos. Recarga la pantalla.';
  end if;
  perform 1 from public.materiales where id = p_material and activo;
  if not found then raise exception 'El material no está activo.'; end if;
  insert into public.valorizaciones_material(id, material_id, precio, moneda, observacion)
  values (p_id, p_material, p_precio, p_moneda, btrim(coalesce(p_observacion, '')));
  return p_id;
end $$;
revoke all on function public.valorizar_material(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.valorizar_material(uuid, uuid, numeric, text, text) to authenticated;

-- Lo que hay en almacén, con su último precio de compra y su precio vigente.
-- Logística no lee los movimientos de Almacén: recibe solo esto.
create or replace function public.materiales_para_valorizar()
returns table (material_id uuid, codigo text, descripcion text, unidad text, existencia numeric,
               ultima_compra numeric, moneda_compra text, precio numeric, moneda text, valorizado_en timestamptz)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tienes permiso para ver la valorización del almacén.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.existencia::numeric,
         c.precio_unitario::numeric, c.moneda, v.precio, v.moneda, v.vigente_desde
    from public.v_existencias_materiales e
    left join lateral (
      select cd.precio_unitario, oc.moneda
        from public.orden_compra_material_detalles cd
        join public.ordenes_compra_materiales oc on oc.id = cd.orden_compra_id
        join public.requerimiento_material_detalles rd on rd.id = cd.requerimiento_detalle_id
        join public.ot_materiales om on om.id = rd.ot_material_id
       where om.material_id = e.material_id and cd.precio_unitario is not null
       order by oc.creado_en desc limit 1) c on true
    left join lateral (
      select x.precio, x.moneda, x.vigente_desde from public.valorizaciones_material x
       where x.material_id = e.material_id order by x.vigente_desde desc, x.id desc limit 1) v on true
   order by e.descripcion;
end $$;
revoke all on function public.materiales_para_valorizar() from public, anon;
grant execute on function public.materiales_para_valorizar() to authenticated;

-- 3. La salida por unidad se carga a la OT abierta de esa unidad ------------
-- Misma función de la migración 20261001100000, más el vínculo a la OT: si la
-- unidad tiene una sola OT abierta, la salida es costo de esa OT. Con dos o
-- más no se adivina: queda en el kardex con su unidad y sin OT.
create or replace function public.fn_destino_movimiento_almacen()
returns trigger language plpgsql set search_path = 'public' as $$
declare
  v_orden uuid;
  v_unidad uuid;
  v_numero text;
  v_abiertas uuid[];
  v_original public.movimientos_materiales%rowtype;
begin
  if new.tipo = 'DESPACHO' then
    select r.orden_id, ot.unidad_id, ot.numero into v_orden, v_unidad, v_numero
      from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ordenes_trabajo ot on ot.id = r.orden_id
     where d.id = new.requerimiento_detalle_id;
    new.orden_id := v_orden;
    new.unidad_id := coalesce(new.unidad_id, v_unidad);
  elsif new.tipo = 'INGRESO' then
    if new.devolucion_de is not null then
      select * into v_original from public.movimientos_materiales where id = new.devolucion_de;
      new.orden_id := v_original.orden_id;
      new.unidad_id := v_original.unidad_id;
      new.codigo_unidad := v_original.codigo_unidad;
    end if;
    return new;
  elsif new.tipo = 'SALIDA' and new.unidad_id is not null and new.orden_id is null then
    select array_agg(ot.id) into v_abiertas from public.ordenes_trabajo ot
     where ot.unidad_id = new.unidad_id and ot.estado::text not in ('ANULADA', 'ENTREGADA', 'FACTURADA');
    if cardinality(v_abiertas) = 1 then new.orden_id := v_abiertas[1]; end if;
  end if;

  if new.unidad_id is not null then
    select public.nombre_unidad_almacen(u) into new.codigo_unidad
      from public.unidades u where u.id = new.unidad_id;
  end if;
  new.codigo_unidad := nullif(btrim(new.codigo_unidad), '');

  if new.codigo_unidad is null then
    if new.tipo = 'DESPACHO' then
      raise exception 'La OT % no tiene vehículo ni código de unidad. Pide a Administración que registre la unidad en la OT antes de despachar.', coalesce(v_numero, '');
    end if;
    raise exception 'Indica el vehículo o el código de la unidad que recibe el material.';
  end if;
  return new;
end $$;
revoke all on function public.fn_destino_movimiento_almacen() from public, anon, authenticated;

-- 4. Gastos del mes (Administración) ----------------------------------------
create table if not exists public.conceptos_gasto_general (
  codigo text primary key,
  nombre text not null,
  grupo text not null check (grupo in ('LOCAL','OPERACION')),
  tasa_sugerida numeric(6,3) check (tasa_sugerida is null or (tasa_sugerida > 0 and tasa_sugerida <= 100)),
  orden integer not null unique,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);
-- Las tasas son las de la hoja RESUMEN de la empresa.
insert into public.conceptos_gasto_general(codigo, nombre, grupo, tasa_sugerida, orden) values
  ('ELECTRICIDAD', 'Electricidad', 'LOCAL', 8, 1),
  ('AGUA', 'Agua', 'LOCAL', 10, 2),
  ('CELULARES', 'Celulares', 'LOCAL', 10, 3),
  ('INTERNET', 'Correos e internet', 'LOCAL', 10, 4),
  ('SEGUROS', 'Seguros', 'LOCAL', 5, 5),
  ('SEGURIDAD', 'Sistema de seguridad', 'LOCAL', 5, 6),
  ('DEPRECIACION_MAQUINARIA', 'Depreciación de maquinaria', 'OPERACION', 2, 7),
  ('DEPRECIACION_COMPUTO', 'Depreciación de equipos de cómputo y otros', 'OPERACION', 0.2, 8),
  ('OTRO_LOCAL', 'Otro gasto del local', 'LOCAL', null, 9),
  ('OTRO_OPERACION', 'Otro gasto de operación', 'OPERACION', null, 10)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo,
  tasa_sugerida = excluded.tasa_sugerida, orden = excluded.orden;
alter table public.conceptos_gasto_general enable row level security;
revoke all on public.conceptos_gasto_general from public, anon, authenticated;
grant select on public.conceptos_gasto_general to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conceptos_gasto_general' and policyname = 'ver_conceptos_gasto_general') then
    create policy ver_conceptos_gasto_general on public.conceptos_gasto_general for select to authenticated using (public.es_usuario_activo());
  end if;
end $$;
select public.activar_timestamps('conceptos_gasto_general');

create table if not exists public.gastos_generales_mes (
  id uuid primary key,
  periodo date not null check (extract(day from periodo) = 1),
  concepto text not null references public.conceptos_gasto_general(codigo) on delete restrict,
  descripcion text not null check (length(btrim(descripcion)) between 3 and 300),
  monto numeric(14,2) not null check (monto > 0),
  moneda text not null check (moneda in ('PEN','USD')),
  reparto text not null check (reparto in ('TASA','PARTES_IGUALES')),
  tasa numeric(6,3),
  estado text not null default 'ACTIVO' check (estado in ('ACTIVO','ANULADO')),
  motivo_anulacion text,
  anulado_por uuid references public.usuarios(id) on delete restrict,
  anulado_en timestamptz,
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check ((reparto = 'TASA' and tasa > 0 and tasa <= 100) or (reparto = 'PARTES_IGUALES' and tasa is null)),
  check ((estado = 'ACTIVO' and motivo_anulacion is null and anulado_por is null and anulado_en is null)
      or (estado = 'ANULADO' and length(btrim(coalesce(motivo_anulacion, ''))) >= 5 and anulado_por is not null and anulado_en is not null))
);
-- (b) el costeo busca los gastos de cada mes trabajado por la OT.
create index if not exists idx_gastos_generales_periodo on public.gastos_generales_mes(periodo) where estado = 'ACTIVO';
alter table public.gastos_generales_mes enable row level security;
revoke all on public.gastos_generales_mes from public, anon, authenticated;
grant select on public.gastos_generales_mes to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gastos_generales_mes' and policyname = 'ver_gastos_generales_mes') then
    create policy ver_gastos_generales_mes on public.gastos_generales_mes for select to authenticated using (
      public.es_admin() or public.tiene_permiso('costos.gastos_generales') or public.tiene_permiso('costos.ver'));
  end if;
end $$;
select public.activar_timestamps('gastos_generales_mes');
select public.activar_auditoria('gastos_generales_mes');
select public.activar_registro_de_prueba('gastos_generales_mes');

create or replace function public.registrar_gasto_general(p_id uuid, p_periodo date, p_concepto text, p_descripcion text,
  p_monto numeric, p_moneda text, p_reparto text, p_tasa numeric)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.gastos_generales_mes%rowtype; v_periodo date := date_trunc('month', p_periodo)::date;
begin
  perform public.exigir_permiso('costos.gastos_generales');
  if p_id is null or p_periodo is null or length(btrim(coalesce(p_descripcion, ''))) not between 3 and 300
     or p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) or p_moneda is null or p_moneda not in ('PEN','USD')
     or p_reparto is null or p_reparto not in ('TASA','PARTES_IGUALES')
     or (p_reparto = 'TASA' and (p_tasa is null or p_tasa <= 0 or p_tasa > 100 or p_tasa <> round(p_tasa, 3)))
     or (p_reparto = 'PARTES_IGUALES' and p_tasa is not null) then
    raise exception 'Indica mes, concepto, detalle, importe, moneda y cómo se reparte (tasa de 0 a 100 %%, o partes iguales).';
  end if;
  perform 1 from public.conceptos_gasto_general where codigo = p_concepto and activo;
  if not found then raise exception 'Elige un concepto de gasto válido.'; end if;
  select * into v from public.gastos_generales_mes where id = p_id;
  if found then
    if v.periodo = v_periodo and v.concepto = p_concepto and v.monto = p_monto and v.moneda = p_moneda
       and v.reparto = p_reparto and v.tasa is not distinct from p_tasa and v.registrado_por = public.usuario_actual() then
      return p_id;
    end if;
    raise exception 'Ese gasto ya se registró con otros datos. Recarga la pantalla.';
  end if;
  insert into public.gastos_generales_mes(id, periodo, concepto, descripcion, monto, moneda, reparto, tasa)
  values (p_id, v_periodo, p_concepto, btrim(p_descripcion), p_monto, p_moneda, p_reparto, p_tasa);
  return p_id;
end $$;
revoke all on function public.registrar_gasto_general(uuid, date, text, text, numeric, text, text, numeric) from public, anon;
grant execute on function public.registrar_gasto_general(uuid, date, text, text, numeric, text, text, numeric) to authenticated;

create or replace function public.anular_gasto_general(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('costos.gastos_generales');
  if length(btrim(coalesce(p_motivo, ''))) not between 5 and 300 then
    raise exception 'Escribe el motivo de la anulación (de 5 a 300 caracteres).';
  end if;
  update public.gastos_generales_mes
     set estado = 'ANULADO', motivo_anulacion = btrim(p_motivo), anulado_por = public.usuario_actual(), anulado_en = now()
   where id = p_id and estado = 'ACTIVO';
  if not found then raise exception 'El gasto no existe o ya está anulado.'; end if;
  return p_id;
end $$;
revoke all on function public.anular_gasto_general(uuid, text) from public, anon;
grant execute on function public.anular_gasto_general(uuid, text) to authenticated;

-- 5. Trámites y comisión de venta: gastos de una OT que pone Administración --
alter table public.ot_gastos_areas drop constraint if exists ot_gastos_areas_tipo_check;
alter table public.ot_gastos_areas add constraint ot_gastos_areas_tipo_check
  check (tipo in ('SERVICIO','TRANSPORTE','VIATICO','SUBCONTRATO','OTRO','TRAMITE','COMISION'));

create or replace function public.fn_gasto_de_administracion()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.tipo in ('TRAMITE','COMISION')
     and not exists (select 1 from public.areas a where a.id = new.area_id and a.codigo = 'ADM') then
    raise exception 'Los trámites de placas y las comisiones de venta los registra Administración.';
  end if;
  return new;
end $$;
revoke all on function public.fn_gasto_de_administracion() from public, anon, authenticated;
create or replace trigger trg_gasto_de_administracion before insert on public.ot_gastos_areas
  for each row execute function public.fn_gasto_de_administracion();

-- 6. Merma de la OT (Diseño e Ingeniería) -------------------------------------
create table if not exists public.ot_mermas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null unique references public.ordenes_trabajo(id) on delete restrict,
  porcentaje numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  motivo text not null check (length(btrim(motivo)) between 5 and 300),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  registrado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.ot_mermas enable row level security;
revoke all on public.ot_mermas from public, anon, authenticated;
grant select on public.ot_mermas to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ot_mermas' and policyname = 'ver_ot_mermas') then
    create policy ver_ot_mermas on public.ot_mermas for select to authenticated using (
      public.puede_ver_orden(orden_id) and (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('costos.ver')));
  end if;
end $$;
select public.activar_timestamps('ot_mermas');
select public.activar_auditoria('ot_mermas');
select public.activar_registro_de_prueba('ot_mermas');

create or replace function public.fijar_merma_ot(p_orden uuid, p_porcentaje numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('diseno.planos');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 or p_porcentaje <> round(p_porcentaje, 2)
     or length(btrim(coalesce(p_motivo, ''))) not between 5 and 300 then
    raise exception 'Indica un porcentaje de 0 a 100 y cómo se evaluó (de 5 a 300 caracteres).';
  end if;
  perform 1 from public.ordenes_trabajo where id = p_orden and estado::text not in ('ANULADA','ENTREGADA','FACTURADA');
  if not found then raise exception 'La OT está cerrada; su merma ya no cambia.'; end if;
  insert into public.ot_mermas(orden_id, porcentaje, motivo)
  values (p_orden, p_porcentaje, btrim(p_motivo))
  on conflict (orden_id) do update set porcentaje = excluded.porcentaje, motivo = excluded.motivo,
    registrado_por = public.usuario_actual(), registrado_en = now();
  return p_orden;
end $$;
revoke all on function public.fijar_merma_ot(uuid, numeric, text) from public, anon;
grant execute on function public.fijar_merma_ot(uuid, numeric, text) to authenticated;

-- 7. El costeo, con todas las manos ------------------------------------------
-- El detalle tiene una línea por cosa; el resumen es la suma del detalle, así
-- los dos no pueden decir cosas distintas.
--   MATERIALES / MATERIALES_SIN_PRECIO  despachos de la OT y salidas por unidad
--   MERMA                               % de Diseño sobre el material valorizado
--   PLANILLA                            taller, administrativa y subcontratos
--   GASTOS_AREA                         servicios, transporte, viáticos…
--   INDIRECTOS                          servicios del local del mes
--   GASTOS_OPERACION                    trámites, comisión y depreciación
create or replace function public.detalle_costeo_ot(p_orden uuid)
returns table (fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               precio_unitario numeric, moneda text, monto numeric, referencia text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with entregas as (
    select m.id, m.registrado_en, m.precio_unitario as precio_registrado, m.moneda as moneda_registrada,
           m.documento_referencia, d.id as detalle_id, om.material_id,
           case r.area_destino when 'MTZ' then 'Maestranza' when 'PRD' then 'Producción'
                               when 'ACB' then 'Acabados' else r.area_destino end as destino,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id = m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ot_materiales om on om.id = d.ot_material_id
     where r.orden_id = p_orden and m.tipo = 'DESPACHO'
    union all
    select m.id, m.registrado_en, m.precio_unitario, m.moneda, m.documento_referencia, null::uuid, m.material_id,
           'Salida a ' || coalesce(m.codigo_unidad, 'la unidad'),
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric
      from public.movimientos_materiales m
     where m.orden_id = p_orden and m.tipo = 'SALIDA'
  ), valorizados as (
    -- Precio congelado; si no hay, la última compra anterior; si tampoco, el
    -- precio que fijó Logística (el vigente en esa fecha, o el primero después).
    select e.*,
           coalesce(e.precio_registrado, compra.precio_unitario, val.precio)::numeric as precio,
           case when e.precio_registrado is not null then coalesce(e.moneda_registrada, compra.moneda, val.moneda)
                when compra.precio_unitario is not null then compra.moneda
                else val.moneda end as moneda_val
      from entregas e
      left join lateral (
        select cd.precio_unitario, oc.moneda
          from public.orden_compra_material_detalles cd
          join public.ordenes_compra_materiales oc on oc.id = cd.orden_compra_id
          join public.requerimiento_material_detalles rd on rd.id = cd.requerimiento_detalle_id
          join public.ot_materiales om on om.id = rd.ot_material_id
         where om.material_id = e.material_id and cd.precio_unitario >= 0
           and oc.moneda in ('PEN', 'USD') and oc.creado_en <= e.registrado_en
         order by case when cd.requerimiento_detalle_id = e.detalle_id then 0 else 1 end, oc.creado_en desc, cd.id
         limit 1) compra on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = e.material_id
         order by (v.vigente_desde > e.registrado_en),
                  case when v.vigente_desde <= e.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where e.cantidad > 0
  ), materiales as (
    select case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end as fuente,
           (v.registrado_en at time zone 'America/Lima')::date as fecha,
           mat.descripcion::text as concepto, v.destino::text as detalle, v.cantidad, um.codigo::text as unidad,
           v.precio, v.moneda_val::text as moneda,
           case when v.precio is null then null else round(v.cantidad * v.precio, 2) end as monto,
           v.documento_referencia::text as referencia
      from valorizados v
      join public.materiales mat on mat.id = v.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
  ), merma as (
    select 'MERMA'::text, (mm.registrado_en at time zone 'America/Lima')::date,
           ('Merma de material ' || trim(to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
           mm.motivo::text, null::numeric, null::text, null::numeric,
           l.moneda, round(sum(l.monto) * mm.porcentaje / 100, 2), null::text
      from materiales l
      join public.ot_mermas mm on mm.orden_id = p_orden
     where l.fuente = 'MATERIALES' and mm.porcentaje > 0
     group by l.moneda, mm.porcentaje, mm.motivo, mm.registrado_en
  ), meses as (
    select distinct p.periodo
      from public.planilla_distribuciones d
      join public.planilla_personas pp on pp.id = d.persona_id
      join public.planillas p on p.id = pp.planilla_id
     where d.orden_id = p_orden and p.estado = 'CERRADA'
  ), trabajadas as (
    select p.periodo, count(distinct d.orden_id) as n
      from public.planillas p
      join public.planilla_personas pp on pp.planilla_id = p.id
      join public.planilla_distribuciones d on d.persona_id = pp.id
     where p.estado = 'CERRADA' and p.periodo in (select periodo from meses)
     group by p.periodo
  )
  select * from materiales
  union all
  select * from merma
  union all
  select 'PLANILLA',
         p.periodo,
         'Planilla ' || case p.tipo when 'TALLER' then 'de taller' when 'ADMINISTRATIVA' then 'administrativa'
                                    when 'SUBCONTRATOS' then 'de subcontratos' else lower(p.tipo) end
           || ' ' || to_char(p.periodo, 'MM/YYYY'),
         count(*)::text || case when count(*) = 1 then ' persona' else ' personas' end,
         null::numeric, null::text, null::numeric,
         p.moneda,
         sum(round(pp.monto * d.porcentaje / 100, 2)),
         null::text
    from public.planilla_distribuciones d
    join public.planilla_personas pp on pp.id = d.persona_id
    join public.planillas p on p.id = pp.planilla_id
   where d.orden_id = p_orden and p.estado = 'CERRADA'
   group by p.id, p.periodo, p.tipo, p.moneda
  union all
  select case when g.tipo in ('TRAMITE', 'COMISION') then 'GASTOS_OPERACION' else 'GASTOS_AREA' end,
         g.fecha,
         g.descripcion,
         case g.tipo when 'SERVICIO' then 'Servicio' when 'TRANSPORTE' then 'Transporte'
                     when 'VIATICO' then 'Viático' when 'SUBCONTRATO' then 'Subcontrato'
                     when 'TRAMITE' then 'Trámites de placas y documentación'
                     when 'COMISION' then 'Comisión de venta' else 'Otro' end
           || coalesce(' · ' || a.nombre, ''),
         null::numeric, null::text, null::numeric,
         g.moneda,
         g.monto,
         g.comprobante_nombre
    from public.ot_gastos_areas g
    left join public.areas a on a.id = g.area_id
   where g.orden_id = p_orden and g.estado = 'APROBADO'
  union all
  select case c.grupo when 'LOCAL' then 'INDIRECTOS' else 'GASTOS_OPERACION' end,
         g.periodo,
         c.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'),
         case g.reparto when 'TASA' then trim(to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
                        else 'Partes iguales entre ' || t.n || ' OT · ' || g.descripcion end,
         null::numeric, null::text, null::numeric,
         g.moneda,
         case g.reparto when 'TASA' then round(g.monto * g.tasa / 100, 2) else round(g.monto / t.n, 2) end,
         null::text
    from public.gastos_generales_mes g
    join public.conceptos_gasto_general c on c.codigo = g.concepto
    join trabajadas t on t.periodo = g.periodo
   where g.estado = 'ACTIVO'
   order by 1, 2, 3;
end
$function$;
comment on function public.detalle_costeo_ot(uuid) is
  'Las líneas del costeo de una OT: material (despachos y salidas por unidad), merma, planilla, gastos de área, indirectos del local y gastos de operación. Exige costos.ver y poder ver la orden.';
revoke all on function public.detalle_costeo_ot(uuid) from public, anon;
grant execute on function public.detalle_costeo_ot(uuid) to authenticated;

create or replace function public.resumen_costeo_ot(p_orden uuid)
returns table (fuente text, moneda text, monto numeric, pendientes bigint)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select d.fuente,
         case when d.fuente = 'MATERIALES_SIN_PRECIO' then null else d.moneda end,
         coalesce(sum(d.monto), 0)::numeric,
         (count(*) filter (where d.fuente = 'MATERIALES_SIN_PRECIO'))::bigint
    from public.detalle_costeo_ot(p_orden) d
   group by 1, 2
   order by 1, 2;
end
$function$;
revoke all on function public.resumen_costeo_ot(uuid) from public, anon;
grant execute on function public.resumen_costeo_ot(uuid) to authenticated;
