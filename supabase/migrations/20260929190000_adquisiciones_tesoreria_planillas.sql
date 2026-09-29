-- Circuito financiero: comprobantes, cobros/pagos y distribución de tres planillas.
-- Los importes y porcentajes los registra cada área; aquí no se infieren tributos.
insert into public.permisos (codigo, modulo, descripcion) values
  ('adquisiciones.ver', 'Adquisiciones', 'Consultar comprobantes de compras y servicios'),
  ('adquisiciones.registrar', 'Adquisiciones', 'Registrar y corregir borradores de comprobantes'),
  ('tesoreria.registrar_cobros', 'Tesorería', 'Registrar cuentas y cobros de OT'),
  ('tesoreria.registrar_pagos', 'Tesorería', 'Registrar pagos de comprobantes'),
  ('rrhh.ver_planillas', 'Recursos Humanos', 'Consultar planillas y distribuciones'),
  ('rrhh.gestionar_planillas', 'Recursos Humanos', 'Crear, distribuir y cerrar planillas')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('CONTABILIDAD', 'Contabilidad y Adquisiciones', 'Registra comprobantes de compras, servicios y vehículos; consulta sus cuentas', 45, true),
  ('RECURSOS_HUMANOS', 'Recursos Humanos', 'Gestiona planillas y sus porcentajes por unidad', 45, true)
on conflict (codigo) do update set nombre=excluded.nombre, descripcion=excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
where (r.codigo='CONTABILIDAD' and p.codigo in ('adquisiciones.ver','adquisiciones.registrar','ordenes.listar','ordenes.ver','compras.ver','requerimientos.ver'))
   or (r.codigo='RECURSOS_HUMANOS' and p.codigo in ('rrhh.ver_planillas','rrhh.gestionar_planillas','ordenes.listar','ordenes.ver'))
   or (r.codigo='TESORERIA' and p.codigo in ('adquisiciones.ver','tesoreria.registrar_cobros','tesoreria.registrar_pagos','compras.ver','requerimientos.ver'))
   or (r.codigo='COMPRADOR' and p.codigo='compras.crear')
on conflict do nothing;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('comprobantes-financieros','comprobantes-financieros',false,10485760,array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists comprobantes_financieros_subir on storage.objects;
create policy comprobantes_financieros_subir on storage.objects for insert to authenticated
  with check (bucket_id='comprobantes-financieros' and public.tiene_permiso('adquisiciones.registrar')
    and name like 'adquisiciones/%');
drop policy if exists comprobantes_financieros_leer on storage.objects;
create policy comprobantes_financieros_leer on storage.objects for select to authenticated
  using (bucket_id='comprobantes-financieros' and public.tiene_permiso('adquisiciones.ver'));

alter table public.ordenes_compra_materiales
  add column if not exists condicion_pago text not null default 'CONTADO'
    check (condicion_pago in ('CONTADO','CREDITO'));
alter table public.ordenes_compra_materiales
  add column if not exists dias_credito integer not null default 0
    check (dias_credito between 0 and 365);
alter table public.ordenes_compra_materiales
  add column if not exists moneda text not null default 'PEN'
    check (moneda in ('PEN','USD'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname='ck_compra_material_credito'
      and conrelid='public.ordenes_compra_materiales'::regclass) then
    alter table public.ordenes_compra_materiales
      add constraint ck_compra_material_credito
      check ((condicion_pago='CONTADO' and dias_credito=0) or
             (condicion_pago='CREDITO' and dias_credito>0));
  end if;
end $$;

create table if not exists public.adquisiciones (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.ordenes_trabajo(id) on delete restrict,
  orden_compra_id uuid references public.ordenes_compra_materiales(id) on delete restrict,
  documento_compra_id uuid references public.documentos_compra_material(id) on delete restrict,
  unidad_id uuid references public.unidades(id) on delete restrict,
  ruta_storage text,
  tipo text not null check (tipo in ('FACTURA_COMPRA','RECIBO_HONORARIOS','FACTURA_VEHICULO','FACTURA_TESORERIA','OTRO')),
  proveedor text not null check (length(btrim(proveedor)) between 2 and 160),
  numero_documento text not null check (length(btrim(numero_documento)) between 3 and 80),
  fecha_emision date not null,
  fecha_vencimiento date not null,
  moneda text not null check (moneda in ('PEN','USD')),
  total numeric(14,2) not null check (total > 0),
  condicion_pago text not null check (condicion_pago in ('CONTADO','CREDITO')),
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','REGISTRADA')),
  observacion text not null default '' check (length(observacion)<=1000),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (proveedor, numero_documento),
  check (fecha_vencimiento>=fecha_emision),
  check (condicion_pago='CREDITO' or fecha_vencimiento=fecha_emision),
  check (estado <> 'REGISTRADA' or ruta_storage is not null or documento_compra_id is not null)
);
create index if not exists idx_adquisiciones_orden on public.adquisiciones(orden_id) where orden_id is not null;
create index if not exists idx_adquisiciones_compra on public.adquisiciones(orden_compra_id) where orden_compra_id is not null;
create index if not exists idx_adquisiciones_documento on public.adquisiciones(documento_compra_id) where documento_compra_id is not null;
create index if not exists idx_adquisiciones_unidad on public.adquisiciones(unidad_id) where unidad_id is not null;
create index if not exists idx_adquisiciones_autor on public.adquisiciones(registrado_por);
create index if not exists idx_adquisiciones_vencimiento on public.adquisiciones(fecha_vencimiento) where estado='REGISTRADA' and condicion_pago='CREDITO';
alter table public.adquisiciones enable row level security;
revoke all on public.adquisiciones from public, anon, authenticated;
grant select, insert, update on public.adquisiciones to authenticated;
drop policy if exists adquisiciones_lectura on public.adquisiciones;
create policy adquisiciones_lectura on public.adquisiciones for select to authenticated
  using (public.tiene_permiso('adquisiciones.ver'));
drop policy if exists adquisiciones_alta on public.adquisiciones;
create policy adquisiciones_alta on public.adquisiciones for insert to authenticated
  with check (public.tiene_permiso('adquisiciones.registrar') and registrado_por=public.usuario_actual() and estado='BORRADOR');
drop policy if exists adquisiciones_edicion on public.adquisiciones;
create policy adquisiciones_edicion on public.adquisiciones for update to authenticated
  using (public.tiene_permiso('adquisiciones.registrar') and estado='BORRADOR')
  with check (public.tiene_permiso('adquisiciones.registrar') and registrado_por=public.usuario_actual());

create or replace function public.fn_proteger_adquisicion() returns trigger
language plpgsql set search_path='public' as $$
declare v_orden uuid; v_condicion text;
begin
  if tg_op='UPDATE' then
    if old.estado<>'BORRADOR' then raise exception 'El comprobante registrado no se edita; registra una corrección.'; end if;
    new.id:=old.id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
  end if;
  if new.orden_compra_id is not null then
    select r.orden_id, c.condicion_pago into v_orden,v_condicion
      from public.ordenes_compra_materiales c
      join public.requerimientos_materiales r on r.id=c.requerimiento_id
     where c.id=new.orden_compra_id;
    if v_orden is null or (new.orden_id is not null and new.orden_id<>v_orden) then
      raise exception 'El comprobante debe pertenecer a la misma OT que la compra.';
    end if;
    if v_condicion<>new.condicion_pago then
      raise exception 'La condición de pago debe coincidir con la registrada por Logística.';
    end if;
    new.orden_id:=v_orden;
  end if;
  if new.documento_compra_id is not null and not exists (
    select 1 from public.documentos_compra_material d
     where d.id=new.documento_compra_id and d.orden_compra_id=new.orden_compra_id
       and d.tipo='FACTURA'
  ) then
    raise exception 'La factura adjunta debe pertenecer a esta compra.';
  end if;
  if new.orden_id is not null and new.unidad_id is not null and not exists (
    select 1 from public.ordenes_trabajo o where o.id=new.orden_id and o.unidad_id=new.unidad_id
  ) then
    raise exception 'La unidad del comprobante debe ser la de la OT.';
  end if;
  if new.estado='REGISTRADA' and new.ruta_storage is not null and not exists (
    select 1 from storage.objects s where s.bucket_id='comprobantes-financieros' and s.name=new.ruta_storage
      and s.name like 'adquisiciones/'||new.id::text||'/%' and s.metadata->>'mimetype'='application/pdf'
  ) then
    raise exception 'Adjunta primero el PDF del comprobante.';
  end if;
  return new;
end $$;
revoke all on function public.fn_proteger_adquisicion() from public, anon, authenticated;
drop trigger if exists proteger_adquisicion on public.adquisiciones;
create trigger proteger_adquisicion before insert or update on public.adquisiciones
for each row execute function public.fn_proteger_adquisicion();
select public.activar_timestamps('adquisiciones');
select public.activar_auditoria('adquisiciones');

-- Se define aquí porque ya existe la tabla que usa en su validación.
create or replace function public.fijar_condicion_pago_compra(
  p_compra uuid, p_condicion text, p_dias integer, p_moneda text
) returns uuid language plpgsql security definer set search_path='public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('compras.crear');
  if p_moneda not in ('PEN','USD') or not ((p_condicion='CONTADO' and p_dias=0) or
          (p_condicion='CREDITO' and p_dias between 1 and 365)) then
    raise exception 'Indica contado o crédito con plazo de 1 a 365 días.';
  end if;
  update public.ordenes_compra_materiales set condicion_pago=p_condicion,dias_credito=p_dias,moneda=p_moneda
   where id=p_compra and entregado_almacen_en is null
     and not exists (select 1 from public.adquisiciones a where a.orden_compra_id=p_compra)
   returning id into v_id;
  if v_id is null then raise exception 'La compra no existe o ya tiene entrega o comprobante.'; end if;
  return v_id;
end $$;
revoke all on function public.fijar_condicion_pago_compra(uuid,text,integer,text) from public, anon;
grant execute on function public.fijar_condicion_pago_compra(uuid,text,integer,text) to authenticated;

create table if not exists public.pagos_adquisicion (
  id uuid primary key default gen_random_uuid(),
  adquisicion_id uuid not null references public.adquisiciones(id) on delete restrict,
  fecha date not null,
  monto numeric(14,2) not null check (monto>0),
  referencia text not null check (length(btrim(referencia)) between 3 and 120),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique(adquisicion_id,referencia)
);
create index if not exists idx_pagos_adquisicion_autor on public.pagos_adquisicion(registrado_por);
alter table public.pagos_adquisicion enable row level security;
revoke all on public.pagos_adquisicion from public, anon, authenticated;
grant select, insert on public.pagos_adquisicion to authenticated;
drop policy if exists pagos_adquisicion_lectura on public.pagos_adquisicion;
create policy pagos_adquisicion_lectura on public.pagos_adquisicion for select to authenticated
  using (public.tiene_permiso('adquisiciones.ver'));
drop policy if exists pagos_adquisicion_alta on public.pagos_adquisicion;
create policy pagos_adquisicion_alta on public.pagos_adquisicion for insert to authenticated
  with check (public.tiene_permiso('tesoreria.registrar_pagos') and registrado_por=public.usuario_actual());

create or replace function public.fn_validar_pago_adquisicion() returns trigger
language plpgsql security definer set search_path='public' as $$
declare v_total numeric; v_estado text; v_pagado numeric;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  select total,estado into v_total,v_estado from public.adquisiciones where id=new.adquisicion_id for update;
  if v_estado<>'REGISTRADA' then raise exception 'El comprobante debe estar registrado antes del pago.'; end if;
  select coalesce(sum(monto),0) into v_pagado from public.pagos_adquisicion where adquisicion_id=new.adquisicion_id;
  if v_pagado+new.monto>v_total then raise exception 'El pago supera el saldo del comprobante.'; end if;
  return new;
end $$;
revoke all on function public.fn_validar_pago_adquisicion() from public, anon, authenticated;
drop trigger if exists validar_pago_adquisicion on public.pagos_adquisicion;
create trigger validar_pago_adquisicion before insert on public.pagos_adquisicion
for each row execute function public.fn_validar_pago_adquisicion();
select public.activar_auditoria('pagos_adquisicion');

create table if not exists public.cuentas_cobrar_ot (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  numero_documento text not null check (length(btrim(numero_documento)) between 3 and 80),
  fecha_emision date not null,
  fecha_vencimiento date not null,
  moneda text not null check (moneda in ('PEN','USD')),
  total numeric(14,2) not null check (total>0),
  observacion text not null default '' check (length(observacion)<=1000),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique(orden_id,numero_documento),
  check(fecha_vencimiento>=fecha_emision)
);
create index if not exists idx_cuentas_cobrar_ot_autor on public.cuentas_cobrar_ot(registrado_por);
create index if not exists idx_cuentas_cobrar_ot_vencimiento on public.cuentas_cobrar_ot(fecha_vencimiento);
alter table public.cuentas_cobrar_ot enable row level security;
revoke all on public.cuentas_cobrar_ot from public, anon, authenticated;
grant select, insert on public.cuentas_cobrar_ot to authenticated;
drop policy if exists cuentas_cobrar_lectura on public.cuentas_cobrar_ot;
create policy cuentas_cobrar_lectura on public.cuentas_cobrar_ot for select to authenticated
  using (public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'));
drop policy if exists cuentas_cobrar_alta on public.cuentas_cobrar_ot;
create policy cuentas_cobrar_alta on public.cuentas_cobrar_ot for insert to authenticated
  with check (public.tiene_permiso('tesoreria.registrar_cobros') and registrado_por=public.usuario_actual());
select public.activar_auditoria('cuentas_cobrar_ot');

create table if not exists public.cobros_ot (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas_cobrar_ot(id) on delete restrict,
  fecha date not null,
  monto numeric(14,2) not null check(monto>0),
  referencia text not null check(length(btrim(referencia)) between 3 and 120),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique(cuenta_id,referencia)
);
create index if not exists idx_cobros_ot_autor on public.cobros_ot(registrado_por);
alter table public.cobros_ot enable row level security;
revoke all on public.cobros_ot from public, anon, authenticated;
grant select, insert on public.cobros_ot to authenticated;
drop policy if exists cobros_ot_lectura on public.cobros_ot;
create policy cobros_ot_lectura on public.cobros_ot for select to authenticated
  using (public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'));
drop policy if exists cobros_ot_alta on public.cobros_ot;
create policy cobros_ot_alta on public.cobros_ot for insert to authenticated
  with check (public.tiene_permiso('tesoreria.registrar_cobros') and registrado_por=public.usuario_actual());

create or replace function public.fn_validar_cobro_ot() returns trigger
language plpgsql security definer set search_path='public' as $$
declare v_total numeric; v_cobrado numeric;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  select total into v_total from public.cuentas_cobrar_ot where id=new.cuenta_id for update;
  if v_total is null then raise exception 'La cuenta por cobrar no existe.'; end if;
  select coalesce(sum(monto),0) into v_cobrado from public.cobros_ot where cuenta_id=new.cuenta_id;
  if v_cobrado+new.monto>v_total then raise exception 'El cobro supera el saldo de la OT.'; end if;
  return new;
end $$;
revoke all on function public.fn_validar_cobro_ot() from public, anon, authenticated;
drop trigger if exists validar_cobro_ot on public.cobros_ot;
create trigger validar_cobro_ot before insert on public.cobros_ot
for each row execute function public.fn_validar_cobro_ot();
select public.activar_auditoria('cobros_ot');

create or replace view public.v_cuentas_pagar with (security_invoker=true) as
select a.id,a.orden_id,o.numero as numero_ot,a.proveedor,a.numero_documento,
       a.fecha_emision,a.fecha_vencimiento,a.moneda,a.total,
       coalesce(sum(p.monto),0)::numeric(14,2) as pagado,
       (a.total-coalesce(sum(p.monto),0))::numeric(14,2) as saldo
from public.adquisiciones a
left join public.ordenes_trabajo o on o.id=a.orden_id
left join public.pagos_adquisicion p on p.adquisicion_id=a.id
where a.estado='REGISTRADA' and a.condicion_pago='CREDITO'
group by a.id,o.numero;
revoke all on public.v_cuentas_pagar from public, anon;
grant select on public.v_cuentas_pagar to authenticated;

create or replace view public.v_cuentas_cobrar_ot with (security_invoker=true) as
select c.id,c.orden_id,o.numero as numero_ot,c.numero_documento,
       c.fecha_emision,c.fecha_vencimiento,c.moneda,c.total,
       coalesce(sum(b.monto),0)::numeric(14,2) as cobrado,
       (c.total-coalesce(sum(b.monto),0))::numeric(14,2) as saldo
from public.cuentas_cobrar_ot c
join public.ordenes_trabajo o on o.id=c.orden_id
left join public.cobros_ot b on b.cuenta_id=c.id
group by c.id,o.numero;
revoke all on public.v_cuentas_cobrar_ot from public, anon;
grant select on public.v_cuentas_cobrar_ot to authenticated;

create or replace view public.v_compras_credito_sin_comprobante with (security_invoker=true) as
select c.id as orden_compra_id,r.orden_id,o.numero as numero_ot,
       c.proveedor,c.referencia,c.creado_en::date as fecha_compra,
       (c.creado_en::date+c.dias_credito) as fecha_vencimiento,
       case when bool_or(d.precio_unitario is null) then null
            else round(sum(d.cantidad*d.precio_unitario),2)::numeric(14,2) end as total_estimado,
       c.moneda
from public.ordenes_compra_materiales c
join public.requerimientos_materiales r on r.id=c.requerimiento_id
join public.ordenes_trabajo o on o.id=r.orden_id
join public.orden_compra_material_detalles d on d.orden_compra_id=c.id
where c.condicion_pago='CREDITO'
  and not exists(select 1 from public.adquisiciones a
    where a.orden_compra_id=c.id and a.estado='REGISTRADA')
group by c.id,r.orden_id,o.numero;
revoke all on public.v_compras_credito_sin_comprobante from public, anon;
grant select on public.v_compras_credito_sin_comprobante to authenticated;

create table if not exists public.planillas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check(tipo in ('TALLER','ADMINISTRATIVA','SUBCONTRATOS')),
  periodo date not null check (extract(day from periodo)=1),
  moneda text not null default 'PEN' check(moneda in ('PEN','USD')),
  estado text not null default 'BORRADOR' check(estado in ('BORRADOR','CERRADA')),
  observacion text not null default '' check(length(observacion)<=1000),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  cerrado_por uuid references public.usuarios(id) on delete restrict,
  cerrado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique(tipo,periodo),
  check((estado='BORRADOR' and cerrado_por is null and cerrado_en is null) or
        (estado='CERRADA' and cerrado_por is not null and cerrado_en is not null))
);
create index if not exists idx_planillas_autor on public.planillas(registrado_por);
create index if not exists idx_planillas_cerrador on public.planillas(cerrado_por) where cerrado_por is not null;
alter table public.planillas enable row level security;
revoke all on public.planillas from public, anon, authenticated;
grant select, insert on public.planillas to authenticated;
drop policy if exists planillas_lectura on public.planillas;
create policy planillas_lectura on public.planillas for select to authenticated
  using (public.tiene_permiso('rrhh.ver_planillas'));
drop policy if exists planillas_alta on public.planillas;
create policy planillas_alta on public.planillas for insert to authenticated
  with check(public.tiene_permiso('rrhh.gestionar_planillas') and registrado_por=public.usuario_actual() and estado='BORRADOR');
select public.activar_auditoria('planillas');

create table if not exists public.planilla_personas (
  id uuid primary key default gen_random_uuid(),
  planilla_id uuid not null references public.planillas(id) on delete restrict,
  nombre text not null check(length(btrim(nombre)) between 3 and 160),
  documento text check(documento is null or length(btrim(documento)) between 5 and 20),
  monto numeric(14,2) not null check(monto>=0),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique(planilla_id,documento)
);
create index if not exists idx_planilla_personas_autor on public.planilla_personas(registrado_por);
alter table public.planilla_personas enable row level security;
revoke all on public.planilla_personas from public, anon, authenticated;
grant select, insert, update, delete on public.planilla_personas to authenticated;
drop policy if exists planilla_personas_lectura on public.planilla_personas;
create policy planilla_personas_lectura on public.planilla_personas for select to authenticated
  using(public.tiene_permiso('rrhh.ver_planillas'));
drop policy if exists planilla_personas_alta on public.planilla_personas;
create policy planilla_personas_alta on public.planilla_personas for insert to authenticated
  with check(public.tiene_permiso('rrhh.gestionar_planillas') and registrado_por=public.usuario_actual());
drop policy if exists planilla_personas_cambio on public.planilla_personas;
create policy planilla_personas_cambio on public.planilla_personas for update to authenticated
  using(public.tiene_permiso('rrhh.gestionar_planillas'))
  with check(public.tiene_permiso('rrhh.gestionar_planillas'));
drop policy if exists planilla_personas_baja on public.planilla_personas;
create policy planilla_personas_baja on public.planilla_personas for delete to authenticated
  using(public.tiene_permiso('rrhh.gestionar_planillas'));
select public.activar_auditoria('planilla_personas');

create table if not exists public.planilla_distribuciones (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.planilla_personas(id) on delete restrict,
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  porcentaje numeric(5,2) not null check(porcentaje>0 and porcentaje<=100),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique(persona_id,orden_id)
);
create index if not exists idx_planilla_distribuciones_orden on public.planilla_distribuciones(orden_id);
create index if not exists idx_planilla_distribuciones_autor on public.planilla_distribuciones(registrado_por);
alter table public.planilla_distribuciones enable row level security;
revoke all on public.planilla_distribuciones from public, anon, authenticated;
grant select, insert, update, delete on public.planilla_distribuciones to authenticated;
drop policy if exists planilla_distribuciones_lectura on public.planilla_distribuciones;
create policy planilla_distribuciones_lectura on public.planilla_distribuciones for select to authenticated
  using(public.tiene_permiso('rrhh.ver_planillas'));
drop policy if exists planilla_distribuciones_alta on public.planilla_distribuciones;
create policy planilla_distribuciones_alta on public.planilla_distribuciones for insert to authenticated
  with check(public.tiene_permiso('rrhh.gestionar_planillas') and registrado_por=public.usuario_actual());
drop policy if exists planilla_distribuciones_cambio on public.planilla_distribuciones;
create policy planilla_distribuciones_cambio on public.planilla_distribuciones for update to authenticated
  using(public.tiene_permiso('rrhh.gestionar_planillas'))
  with check(public.tiene_permiso('rrhh.gestionar_planillas'));
drop policy if exists planilla_distribuciones_baja on public.planilla_distribuciones;
create policy planilla_distribuciones_baja on public.planilla_distribuciones for delete to authenticated
  using(public.tiene_permiso('rrhh.gestionar_planillas'));
select public.activar_auditoria('planilla_distribuciones');

create or replace function public.fn_planilla_abierta() returns trigger
language plpgsql security definer set search_path='public' as $$
declare v_estado text;
begin
  perform public.exigir_permiso('rrhh.gestionar_planillas');
  if tg_table_name='planilla_personas' then
    select estado into v_estado from public.planillas where id=coalesce(new.planilla_id,old.planilla_id) for share;
  else
    select p.estado into v_estado from public.planillas p
      join public.planilla_personas x on x.planilla_id=p.id
     where x.id=coalesce(new.persona_id,old.persona_id) for share of p;
  end if;
  if v_estado is distinct from 'BORRADOR' then raise exception 'Solo se puede cambiar una planilla en borrador.'; end if;
  if tg_op='UPDATE' then
    new.id:=old.id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
    if tg_table_name='planilla_personas' then new.planilla_id:=old.planilla_id;
    else new.persona_id:=old.persona_id; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.fn_planilla_abierta() from public, anon, authenticated;
drop trigger if exists planilla_persona_abierta on public.planilla_personas;
create trigger planilla_persona_abierta before insert or update or delete on public.planilla_personas
for each row execute function public.fn_planilla_abierta();
drop trigger if exists planilla_distribucion_abierta on public.planilla_distribuciones;
create trigger planilla_distribucion_abierta before insert or update or delete on public.planilla_distribuciones
for each row execute function public.fn_planilla_abierta();

create or replace function public.cerrar_planilla(p_planilla uuid) returns uuid
language plpgsql security definer set search_path='public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('rrhh.gestionar_planillas');
  perform 1 from public.planillas where id=p_planilla and estado='BORRADOR' for update;
  if not found then raise exception 'La planilla no existe o ya está cerrada.'; end if;
  if not exists(select 1 from public.planilla_personas where planilla_id=p_planilla) then
    raise exception 'Agrega al menos una persona o subcontrato.';
  end if;
  if exists(
    select 1 from public.planilla_personas x
    left join public.planilla_distribuciones d on d.persona_id=x.id
    where x.planilla_id=p_planilla
    group by x.id having coalesce(sum(d.porcentaje),0)<>100
  ) then raise exception 'Cada persona o subcontrato debe distribuir exactamente 100 %% entre las OT.';
  end if;
  update public.planillas set estado='CERRADA',cerrado_por=public.usuario_actual(),cerrado_en=now()
   where id=p_planilla returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cerrar_planilla(uuid) from public, anon;
grant execute on function public.cerrar_planilla(uuid) to authenticated;

create or replace function public.resumen_planilla_por_ot()
returns table(orden_id uuid,numero_ot text,tipo text,periodo date,moneda text,monto numeric)
language plpgsql stable security definer set search_path='public' as $$
begin
  if not (public.tiene_permiso('rrhh.ver_planillas') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'No tienes permiso para ver el reparto de planillas.' using errcode='insufficient_privilege';
  end if;
  return query
  select d.orden_id,o.numero,p.tipo,p.periodo,p.moneda,
         round(sum(x.monto*d.porcentaje/100),2)::numeric(14,2)
    from public.planillas p join public.planilla_personas x on x.planilla_id=p.id
    join public.planilla_distribuciones d on d.persona_id=x.id
    join public.ordenes_trabajo o on o.id=d.orden_id
   where p.estado='CERRADA'
   group by d.orden_id,o.numero,p.tipo,p.periodo,p.moneda;
end $$;
revoke all on function public.resumen_planilla_por_ot() from public, anon;
grant execute on function public.resumen_planilla_por_ot() to authenticated;
