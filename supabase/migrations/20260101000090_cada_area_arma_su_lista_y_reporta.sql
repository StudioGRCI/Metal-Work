-- =============================================================================
-- CADA ÁREA ARMA SU LISTA Y REPORTA SU AVANCE
-- -----------------------------------------------------------------------------
-- «El jefe de producción, para que vaya reportando algo, hay que hacerle su
-- reporte de avances diario: que pueda crear el vehículo, sus actividades y
-- registrar sus avances con porcentaje de consideración. Para Maestranza lo
-- mismo, pero no por carrocería sino por piezas solicitadas, que es lo que él
-- habilita para Producción. Mientras mejoramos Diseño.»
--
-- Hoy la única lista de trabajo con peso es la hoja de Diseño (MW-FOR-ING-8,
-- migración 070): planos con su porcentaje y piezas con los vistos de
-- Maestranza y Producción. Funciona, pero **el taller no puede empezar a
-- reportar hasta que Diseño la cargue**, y ese es justamente el cuello que hay
-- que destrabar mientras Diseño se mejora.
--
-- Acá cada área arma la suya:
--
--   · Producción escribe las actividades de la carrocería —armado de la
--     estructura, montaje de compuerta, acabados— con lo que pesa cada una.
--   · Maestranza escribe las suyas por pieza solicitada, que es como trabaja:
--     lo que habilita para que Producción arme.
--
-- Tres decisiones que vienen del cliente y no del sistema:
--
--   1. **Cada área tiene su propio 100 %.** Maestranza va al 60 % de lo suyo y
--      Producción al 30 % de lo suyo, y la orden muestra las dos cosas. Repartir
--      un único 100 % entre áreas obligaría a ponerse de acuerdo en cuánto vale
--      cada una, y eso hoy no está acordado.
--   2. **El reporte diario es lo del día**: «hoy avancé 15 %», no «hoy quedó en
--      40 %». Es la foto de la jornada, que es lo que el jefe quiere dejar
--      escrito, y el acumulado lo suma el sistema.
--   3. **Los subcontratos no se duplican.** El jefe los ve en su pantalla
--      leídos de `servicios_terceros`, que ya existe con su estado y su costo.
-- =============================================================================

-- =============================================================================
-- 1. LAS ACTIVIDADES DE CADA ÁREA
-- =============================================================================
create table if not exists public.ot_actividades (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- De qué área es la lista. Es lo que separa la hoja de Producción de la de
  -- Maestranza sin tener dos tablas iguales.
  area_id         uuid not null references public.areas(id) on delete restrict,
  orden_secuencia smallint not null default 1 check (orden_secuencia > 0),
  nombre          text not null check (length(btrim(nombre)) > 0),
  detalle         text,
  -- Para Maestranza, la pieza solicitada («PZ-14», «lateral izquierdo»); para
  -- Producción, la parte de la carrocería. Texto porque el taller la nombra a
  -- su manera y no hay catálogo que lo cubra.
  referencia      text,
  -- El «porcentaje de consideración»: cuánto pesa esta actividad dentro del
  -- 100 % de SU área.
  peso_pct        numeric(5,2) not null default 0 check (peso_pct >= 0 and peso_pct <= 100),
  creado_por      uuid references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint uq_ot_actividad unique (orden_id, area_id, nombre),
  -- Para que un avance no pueda colgarse de una actividad de otra orden.
  constraint uq_ot_actividad_orden unique (id, orden_id)
);

comment on table public.ot_actividades is
  'La lista de trabajo que cada área arma para una orden: Producción por carrocería, Maestranza por pieza solicitada. Cada actividad pesa dentro del 100 % de su área.';
comment on column public.ot_actividades.peso_pct is
  'El porcentaje de consideración: cuánto pesa esta actividad en el avance de su área. Entre todas las del área no pueden pasar de 100.';
comment on column public.ot_actividades.referencia is
  'La pieza solicitada, para Maestranza; la parte de la carrocería, para Producción.';

create index if not exists idx_ot_actividades_orden
  on public.ot_actividades(orden_id, area_id, orden_secuencia);

-- Entre todas las de un área no pasan de 100, igual que los planos de Diseño.
create or replace function public.fn_actividades_pesan_cien()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_area  text;
  v_orden text;
begin
  select sum(a.peso_pct), max(ar.nombre), max(o.numero)
    into v_total, v_area, v_orden
    from public.ot_actividades a
    join public.areas ar on ar.id = a.area_id
    join public.ordenes_trabajo o on o.id = a.orden_id
   where a.orden_id = new.orden_id
     and a.area_id  = new.area_id;

  if v_total > 100 then
    raise exception 'Las actividades de % en la orden % suman % %%: entre todas no pueden pasar de 100.',
      v_area, v_orden, v_total;
  end if;
  return null;
end;
$$;

revoke all on function public.fn_actividades_pesan_cien() from public, anon, authenticated;

drop trigger if exists trg_actividades_pesan_cien on public.ot_actividades;
create trigger trg_actividades_pesan_cien
  after insert or update of peso_pct, area_id on public.ot_actividades
  for each row execute function public.fn_actividades_pesan_cien();

-- =============================================================================
-- 2. EL REPORTE DIARIO
-- -----------------------------------------------------------------------------
-- Lo del día, no el acumulado. Uno por actividad y día: si el jefe reporta dos
-- veces la misma jornada, corrige el de hoy en vez de sumar dos veces.
-- =============================================================================
create table if not exists public.ot_actividad_avances (
  id              uuid primary key default gen_random_uuid(),
  actividad_id    uuid not null,
  orden_id        uuid not null,
  fecha           date not null default current_date,
  -- Lo que se avanzó ESE día, sobre el 100 % de la actividad.
  avance_pct      numeric(5,2) not null check (avance_pct > 0 and avance_pct <= 100),
  nota            text,
  reportado_por   uuid references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint fk_avance_actividad foreign key (actividad_id, orden_id)
    references public.ot_actividades(id, orden_id) on delete cascade,
  constraint uq_avance_del_dia unique (actividad_id, fecha)
);

comment on table public.ot_actividad_avances is
  'El reporte diario del área: cuánto avanzó cada actividad ese día. Es incremental —«hoy avancé 15 %»— y el acumulado lo suma el sistema.';

create index if not exists idx_actividad_avances_orden
  on public.ot_actividad_avances(orden_id, fecha);

-- Una actividad no pasa del 100 % por mucho que se reporte.
create or replace function public.fn_avance_no_pasa_de_cien()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total  numeric;
  v_nombre text;
begin
  select sum(av.avance_pct), max(a.nombre)
    into v_total, v_nombre
    from public.ot_actividad_avances av
    join public.ot_actividades a on a.id = av.actividad_id
   where av.actividad_id = new.actividad_id;

  if v_total > 100 then
    raise exception '«%» ya estaría al % %%: lo reportado no puede pasar del 100 %% de la actividad.',
      v_nombre, v_total
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke all on function public.fn_avance_no_pasa_de_cien() from public, anon, authenticated;

drop trigger if exists trg_avance_no_pasa_de_cien on public.ot_actividad_avances;
create trigger trg_avance_no_pasa_de_cien
  after insert or update of avance_pct on public.ot_actividad_avances
  for each row execute function public.fn_avance_no_pasa_de_cien();

-- =============================================================================
-- 3. PERMISOS
-- -----------------------------------------------------------------------------
-- Armar la lista es de los jefes: el de maestranza y el supervisor de
-- producción. Reportar el avance del día es de quien registra producción, que
-- es el permiso que ya usan el parte diario y la hoja de cumplimiento.
-- =============================================================================
insert into public.permisos (codigo, modulo, descripcion) values
  ('produccion.actividades', 'Producción',
   'Armar la lista de actividades de su área en una orden y ponerles su peso')
on conflict (codigo) do update set descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'produccion.actividades'
  from public.roles r
 where r.codigo in ('JEFE_TALLER', 'SUPERVISOR', 'GERENTE')
on conflict do nothing;

alter table public.ot_actividades      enable row level security;
alter table public.ot_actividad_avances enable row level security;

drop policy if exists ver_ot_actividades on public.ot_actividades;
create policy ver_ot_actividades on public.ot_actividades
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_ot_actividades on public.ot_actividades;
create policy crear_ot_actividades on public.ot_actividades
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('produccion.actividades'));

drop policy if exists editar_ot_actividades on public.ot_actividades;
create policy editar_ot_actividades on public.ot_actividades
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.actividades'))
  with check (public.es_admin() or public.tiene_permiso('produccion.actividades'));

drop policy if exists borrar_ot_actividades on public.ot_actividades;
create policy borrar_ot_actividades on public.ot_actividades
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.actividades'));

drop policy if exists ver_ot_actividad_avances on public.ot_actividad_avances;
create policy ver_ot_actividad_avances on public.ot_actividad_avances
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_ot_actividad_avances on public.ot_actividad_avances;
create policy crear_ot_actividad_avances on public.ot_actividad_avances
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('produccion.registrar'));

drop policy if exists editar_ot_actividad_avances on public.ot_actividad_avances;
create policy editar_ot_actividad_avances on public.ot_actividad_avances
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.registrar'))
  with check (public.es_admin() or public.tiene_permiso('produccion.registrar'));

-- Un avance reportado se corrige, no se borra: es la bitácora del día. Solo el
-- administrador, y queda en audit_log.
drop policy if exists borrar_ot_actividad_avances on public.ot_actividad_avances;
create policy borrar_ot_actividad_avances on public.ot_actividad_avances
  for delete to authenticated
  using (public.es_admin());

grant select, insert, update, delete on public.ot_actividades to authenticated;
grant select, insert, update, delete on public.ot_actividad_avances to authenticated;

select public.activar_timestamps('ot_actividades');
select public.activar_timestamps('ot_actividad_avances');
select public.activar_auditoria('ot_actividades');
select public.activar_auditoria('ot_actividad_avances');

-- =============================================================================
-- 4. LO QUE VE EL JEFE
-- =============================================================================
create or replace view public.v_ot_actividades as
select
  a.id,
  a.orden_id,
  a.area_id,
  ar.codigo                       as area_codigo,
  ar.nombre                       as area,
  a.orden_secuencia,
  a.nombre,
  a.detalle,
  a.referencia,
  a.peso_pct,
  coalesce(av.avanzado, 0)        as avance_pct,
  coalesce(av.avanzado, 0) >= 100 as terminada,
  av.ultimo                       as ultimo_reporte,
  av.reportes,
  a.creado_por,
  a.creado_en
from public.ot_actividades a
join public.areas ar on ar.id = a.area_id
left join lateral (
  select sum(x.avance_pct) as avanzado, max(x.fecha) as ultimo, count(*) as reportes
    from public.ot_actividad_avances x
   where x.actividad_id = a.id
) av on true;

comment on view public.v_ot_actividades is
  'Las actividades de cada área con su avance acumulado, que sale de sumar los reportes diarios.';

alter view public.v_ot_actividades set (security_invoker = on);
grant select on public.v_ot_actividades to authenticated;

-- El avance de cada área: la suma de peso × avance, sobre el peso repartido.
create or replace view public.v_ot_avance_areas as
select
  v.orden_id,
  v.area_id,
  v.area_codigo,
  v.area,
  count(*)                                   as actividades,
  count(*) filter (where v.terminada)        as terminadas,
  sum(v.peso_pct)                            as peso_repartido,
  case
    when sum(v.peso_pct) = 0 then 0
    else round(sum(v.peso_pct * v.avance_pct) / sum(v.peso_pct), 1)
  end                                        as avance_pct,
  max(v.ultimo_reporte)                       as ultimo_reporte
from public.v_ot_actividades v
group by v.orden_id, v.area_id, v.area_codigo, v.area;

comment on view public.v_ot_avance_areas is
  'Cuánto lleva cada área de lo suyo en una orden. Cada área tiene su propio 100 %: no se suman entre ellas.';

alter view public.v_ot_avance_areas set (security_invoker = on);
grant select on public.v_ot_avance_areas to authenticated;
