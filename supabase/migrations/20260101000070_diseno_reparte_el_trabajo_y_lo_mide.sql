-- =============================================================================
-- DISEÑO REPARTE EL TRABAJO, MAESTRANZA Y PRODUCCIÓN REPORTAN, Y EL % SALE SOLO
-- -----------------------------------------------------------------------------
-- Es la traducción del formato MW-FOR-ING-8 «CUMPLIMIENTO DE TIEMPOS – ÁREAS»
-- (`CUMPLIMIENTO DE AREAS - 2026.xlsx`), la hoja que Diseño arma por cada OT:
--
--   %  | FECHA | # PLANO | # PIEZAS | NOMBRE | CANTIDAD | OBSERVACIÓN
--   MAESTRANZA:  FECHA INICIO · HABILITADO ✓ · FECHA CULMINACIÓN · ENTREGADO ✓
--   PRODUCCIÓN:  FECHA RECEPCIÓN · RECIBIDO ✓ · FECHA INICIO · ARMADO ✓
--
-- Cada plano es un grupo de piezas con un peso en el total de la unidad. Diseño
-- escribe la lista y la fecha en que entrega el plano; Maestranza dice cuándo
-- empezó a habilitar y cuándo entregó; Producción cuándo recibió y cuándo armó.
-- El porcentaje de la OT es la suma de los pesos por lo que cada plano lleva.
--
-- Tres decisiones que vienen de la empresa y no del sistema:
--
--   1. Las partidas pasan a Diseño. Administración no crea partidas —lo dijo
--      Gerencia— y el que sabe qué lleva la unidad es quien la dibuja. Se crea el
--      rol DISEÑO con el permiso de costear; Administración lo conserva porque
--      sigue emitiendo la orden.
--   2. Diseño tiene que entregar el plano. Maestranza no puede reportar que
--      empezó a habilitar una pieza cuyo plano no tiene fecha de entrega: la
--      hoja se llenaba igual y nadie veía que el plano nunca llegó.
--   3. Cada bloque lo escribe su área. Las columnas de Diseño las toca quien
--      tiene `diseno.planos`; las de Maestranza y Producción, quien registra
--      producción. La política acepta a las dos manos y un disparador mira qué
--      columnas cambiaron: así el permiso que exige la acción sigue siendo el
--      que acepta la base, sin que una mano pueda escribir en la hoja de la otra.
--
-- De paso, la orden se ve como cronograma: la vista `v_cronograma_ot` da por
-- etapa el área, las fechas programadas y reales y el semáforo de la casa, que
-- es lo que un Gantt necesita y lo que Administración pidió ver.
-- =============================================================================

-- =============================================================================
-- 1. DISEÑO: EL ROL Y SU PERMISO
-- =============================================================================
insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values ('DISENO', 'Diseño e ingeniería',
        'Dibuja la unidad: arma las partidas y la ficha de la cotización de trabajo, y reparte los planos al taller.',
        48, true)
on conflict (codigo) do update
  set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.permisos (codigo, modulo, descripcion) values
  ('diseno.planos', 'Producción',
   'Armar la lista de planos y piezas de una orden y dar por entregado cada plano')
on conflict (codigo) do nothing;

-- Un permiso sin rol es una puerta tapiada: se reparte acá mismo. Diseño
-- costea (partidas, ficha, tiempo por área) y reparte planos; Gerencia también
-- puede tocar los planos, como ya puede tocar el costeo cuando devuelve una
-- cotización; Administración conserva el costeo porque emite la orden.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join (values
    ('DISENO', 'cotizaciones.ver'),
    ('DISENO', 'cotizaciones.costear'),
    ('DISENO', 'clientes.ver'),
    ('DISENO', 'ordenes.ver'),
    ('DISENO', 'produccion.ver'),
    ('DISENO', 'configuracion.ver'),
    ('DISENO', 'diseno.planos'),
    ('GERENTE', 'diseno.planos')
  ) as x(rol, codigo) on x.rol = r.codigo
  join public.permisos p on p.codigo = x.codigo
on conflict do nothing;

-- =============================================================================
-- 2. LOS PLANOS: LO QUE DISEÑO ENTREGA
-- =============================================================================
create table if not exists public.ot_planos (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete cascade,
  orden_secuencia smallint not null default 1 check (orden_secuencia > 0),
  -- «# PLANO» de la hoja. Texto porque escriben «1», «2A», «ENS».
  numero_plano    text not null check (length(btrim(numero_plano)) > 0),
  -- «NOMBRE» de la fila de cabecera: HABILITADO, ESTRUCTURA CAJÓN, COMPUERTA…
  nombre          text not null check (length(btrim(nombre)) > 0),
  -- La columna «%»: cuánto pesa este plano en la unidad entera.
  peso_pct        numeric(5,2) not null default 0 check (peso_pct >= 0 and peso_pct <= 100),
  -- La columna «FECHA»: el día que Diseño entregó el plano al taller. Sin esta
  -- fecha Maestranza no puede empezar, y esa es la regla que faltaba.
  fecha_entrega   date,
  observacion     text,
  creado_por      uuid references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint uq_ot_plano unique (orden_id, numero_plano),
  -- Para que una pieza no pueda apuntar a un plano de otra orden.
  constraint uq_ot_plano_orden unique (id, orden_id)
);

comment on table public.ot_planos is
  'MW-FOR-ING-8: cada plano que Diseño entrega para una orden, con su peso en el total y la fecha en que lo entregó.';
comment on column public.ot_planos.peso_pct is
  'La columna «%» de la hoja: lo que este plano pesa en el avance de la unidad. Entre todos deberían sumar 100.';
comment on column public.ot_planos.fecha_entrega is
  'Cuándo Diseño entregó el plano. Mientras esté vacía, Maestranza no puede reportar que empezó a habilitar.';

create index if not exists idx_ot_planos_orden on public.ot_planos(orden_id, orden_secuencia);

-- =============================================================================
-- 3. LAS PIEZAS: LO QUE CADA ÁREA REPORTA
-- =============================================================================
create table if not exists public.ot_piezas (
  id              uuid primary key default gen_random_uuid(),
  plano_id        uuid not null,
  orden_id        uuid not null,
  orden_secuencia smallint not null default 1 check (orden_secuencia > 0),
  -- «# PIEZAS»: «1», «2-5», «ENS». Texto por la misma razón que el plano.
  numero_pieza    text not null check (length(btrim(numero_pieza)) > 0),
  nombre          text not null check (length(btrim(nombre)) > 0),
  cantidad        numeric(8,2) not null default 1 check (cantidad > 0),
  -- Las filas ENSAMBLE de la hoja: no pasan por Maestranza, las arma Producción
  -- con las piezas ya habilitadas.
  es_ensamble     boolean not null default false,
  observacion     text,

  -- Bloque MAESTRANZA.
  mtz_inicio        date,
  mtz_habilitado    boolean not null default false,
  mtz_culminacion   date,
  mtz_entregado     boolean not null default false,
  mtz_observacion   text,

  -- Bloque PRODUCCIÓN.
  prd_recepcion     date,
  prd_recibido      boolean not null default false,
  prd_inicio        date,
  prd_armado        boolean not null default false,
  prd_observacion   text,

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint fk_pieza_plano foreign key (plano_id, orden_id)
    references public.ot_planos(id, orden_id) on delete cascade,

  -- Un visto sin fecha, o un paso sin el anterior, es una hoja llenada a medias.
  constraint ck_pieza_mtz_habilitado check (not mtz_habilitado or mtz_inicio is not null),
  constraint ck_pieza_mtz_entregado  check (not mtz_entregado or (mtz_habilitado and mtz_culminacion is not null)),
  constraint ck_pieza_prd_recibido   check (not prd_recibido or (prd_recepcion is not null and mtz_entregado)),
  constraint ck_pieza_prd_armado     check (not prd_armado or (prd_inicio is not null and (es_ensamble or prd_recibido))),
  -- El ensamble no se habilita ni se entrega: se arma.
  constraint ck_pieza_ensamble       check (not es_ensamble or (not mtz_habilitado and not mtz_entregado and not prd_recibido)),
  -- Las fechas de cada bloque en su orden.
  constraint ck_pieza_fechas_mtz     check (mtz_culminacion is null or mtz_inicio is null or mtz_culminacion >= mtz_inicio),
  constraint ck_pieza_fechas_prd     check (prd_inicio is null or prd_recepcion is null or prd_inicio >= prd_recepcion)
);

comment on table public.ot_piezas is
  'MW-FOR-ING-8: cada pieza de un plano con lo que Maestranza y Producción reportan de ella: fechas y vistos.';
comment on column public.ot_piezas.es_ensamble is
  'Las filas ENSAMBLE de la hoja: no pasan por Maestranza; Producción las arma con las piezas ya entregadas.';

create index if not exists idx_ot_piezas_plano on public.ot_piezas(plano_id, orden_secuencia);
create index if not exists idx_ot_piezas_orden on public.ot_piezas(orden_id);

-- ------------------------------------------------------------ mantenimiento
drop trigger if exists trg_timestamps on public.ot_planos;
create trigger trg_timestamps before update on public.ot_planos
  for each row execute function public.fn_set_actualizado_en();

drop trigger if exists trg_timestamps on public.ot_piezas;
create trigger trg_timestamps before update on public.ot_piezas
  for each row execute function public.fn_set_actualizado_en();

-- Quién armó el plano se sella con la sesión, no viaja desde la pantalla.
drop trigger if exists trg_plano_sellar_autor on public.ot_planos;
create trigger trg_plano_sellar_autor before insert on public.ot_planos
  for each row execute function public.fn_reporte_sellar_autor();

select public.activar_auditoria('ot_planos');
select public.activar_auditoria('ot_piezas');

-- =============================================================================
-- 4. LAS REGLAS
-- =============================================================================

-- ---------------------------------------------- la orden tiene que estar viva
-- Un plano se entrega para una orden aprobada. En borrador todavía puede
-- cambiar de carrocería; entregada o anulada, ya no hay nada que habilitar.
create or replace function public.fn_plano_orden_viva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado public.estado_ot;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.ordenes_trabajo where id = new.orden_id;

  if v_estado is null then
    raise exception 'No existe esa orden de trabajo';
  end if;
  if v_estado in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA') then
    raise exception 'La orden % está en estado % y no admite planos: se reparten planos a una orden aprobada y en curso.',
      v_numero, v_estado;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plano_orden_viva on public.ot_planos;
create trigger trg_plano_orden_viva before insert on public.ot_planos
  for each row execute function public.fn_plano_orden_viva();

-- ------------------------------------------ los pesos no pasan de cien
-- Es un disparador AFTER: corre cuando la sentencia ya escribió todas sus
-- filas, así que reescribir los pesos de varios planos a la vez se juzga por
-- el resultado final y no choca a mitad de camino.
create or replace function public.fn_planos_pesan_cien()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total  numeric;
  v_numero text;
begin
  select sum(p.peso_pct), max(o.numero) into v_total, v_numero
    from public.ot_planos p
    join public.ordenes_trabajo o on o.id = p.orden_id
   where p.orden_id = new.orden_id;

  if v_total > 100 then
    raise exception 'Los planos de la orden % suman % %%: entre todos no pueden pasar de 100.',
      v_numero, v_total;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_planos_pesan_cien on public.ot_planos;
create trigger trg_planos_pesan_cien
  after insert or update of peso_pct on public.ot_planos
  for each row execute function public.fn_planos_pesan_cien();

-- ------------------------------------------- cada área escribe su bloque
-- La política de UPDATE acepta a Diseño y al taller; acá se mira qué columnas
-- cambiaron y se exige el permiso de esa mano. Así el permiso que exige la
-- acción de pantalla es exactamente el que la base va a pedir, y Maestranza no
-- puede corregir la cantidad de una pieza ni Diseño marcar un habilitado.
create or replace function public.fn_pieza_quien_toca_que()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plano public.ot_planos%rowtype;
begin
  -- Lo que dibuja Diseño.
  if (new.plano_id, new.orden_secuencia, new.numero_pieza, new.nombre, new.cantidad, new.es_ensamble, new.observacion)
     is distinct from
     (old.plano_id, old.orden_secuencia, old.numero_pieza, old.nombre, old.cantidad, old.es_ensamble, old.observacion) then
    perform public.exigir_permiso('diseno.planos');
  end if;

  -- Lo que reporta el taller: Maestranza y Producción.
  if (new.mtz_inicio, new.mtz_habilitado, new.mtz_culminacion, new.mtz_entregado, new.mtz_observacion,
      new.prd_recepcion, new.prd_recibido, new.prd_inicio, new.prd_armado, new.prd_observacion)
     is distinct from
     (old.mtz_inicio, old.mtz_habilitado, old.mtz_culminacion, old.mtz_entregado, old.mtz_observacion,
      old.prd_recepcion, old.prd_recibido, old.prd_inicio, old.prd_armado, old.prd_observacion) then
    perform public.exigir_permiso('produccion.registrar');
  end if;

  -- Maestranza no empieza sin plano: es la regla que la hoja no podía hacer cumplir.
  if new.mtz_inicio is not null and (old.mtz_inicio is null or new.mtz_inicio <> old.mtz_inicio) then
    select * into v_plano from public.ot_planos where id = new.plano_id;
    if v_plano.fecha_entrega is null then
      raise exception 'El plano % («%») todavía no tiene fecha de entrega de Diseño: no se puede reportar el habilitado de «%».',
        v_plano.numero_plano, v_plano.nombre, new.nombre;
    end if;
    if new.mtz_inicio < v_plano.fecha_entrega then
      raise exception 'Maestranza no pudo empezar «%» el %: Diseño entregó el plano % recién el %.',
        new.nombre, to_char(new.mtz_inicio, 'DD/MM/YYYY'), v_plano.numero_plano, to_char(v_plano.fecha_entrega, 'DD/MM/YYYY');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pieza_quien_toca_que on public.ot_piezas;
create trigger trg_pieza_quien_toca_que before update on public.ot_piezas
  for each row execute function public.fn_pieza_quien_toca_que();

-- Y al quitar un plano entregado que ya tiene trabajo reportado se perdería lo
-- que el taller escribió. Se anula la orden, no se borra la hoja.
create or replace function public.fn_plano_no_se_borra_con_trabajo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.ot_piezas p
     where p.plano_id = old.id
       and (p.mtz_inicio is not null or p.prd_recepcion is not null or p.prd_inicio is not null)
  ) then
    raise exception 'El plano % («%») ya tiene trabajo reportado por el taller y no se puede quitar.',
      old.numero_plano, old.nombre;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_plano_no_se_borra_con_trabajo on public.ot_planos;
create trigger trg_plano_no_se_borra_con_trabajo before delete on public.ot_planos
  for each row execute function public.fn_plano_no_se_borra_con_trabajo();

-- =============================================================================
-- 5. LAS REJAS
-- -----------------------------------------------------------------------------
-- Se lee con la orden. Escribe Diseño con `diseno.planos`; sobre las piezas
-- también el taller con `produccion.registrar`, y el disparador de arriba
-- decide qué columnas puede tocar cada mano.
-- =============================================================================
alter table public.ot_planos enable row level security;
alter table public.ot_piezas enable row level security;

drop policy if exists ver_ot_planos on public.ot_planos;
create policy ver_ot_planos on public.ot_planos
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_ot_planos on public.ot_planos;
create policy crear_ot_planos on public.ot_planos
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists editar_ot_planos on public.ot_planos;
create policy editar_ot_planos on public.ot_planos
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'))
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists borrar_ot_planos on public.ot_planos;
create policy borrar_ot_planos on public.ot_planos
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists ver_ot_piezas on public.ot_piezas;
create policy ver_ot_piezas on public.ot_piezas
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_ot_piezas on public.ot_piezas;
create policy crear_ot_piezas on public.ot_piezas
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists editar_ot_piezas on public.ot_piezas;
create policy editar_ot_piezas on public.ot_piezas
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('produccion.registrar'))
  with check (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('produccion.registrar'));

drop policy if exists borrar_ot_piezas on public.ot_piezas;
create policy borrar_ot_piezas on public.ot_piezas
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'));

grant select, insert, update, delete on public.ot_planos to authenticated;
grant select, insert, update, delete on public.ot_piezas to authenticated;

revoke all on function public.fn_plano_orden_viva() from public, anon, authenticated;
revoke all on function public.fn_planos_pesan_cien() from public, anon, authenticated;
revoke all on function public.fn_pieza_quien_toca_que() from public, anon, authenticated;
revoke all on function public.fn_plano_no_se_borra_con_trabajo() from public, anon, authenticated;

-- =============================================================================
-- 6. EL PORCENTAJE SALE SOLO
-- -----------------------------------------------------------------------------
-- Una pieza avanza por vistos: habilitada 25, entregada 50, recibida 75,
-- armada 100. El ensamble no pasa por Maestranza: empezado 50, armado 100.
-- El plano pondera sus piezas por cantidad; la orden pondera sus planos por
-- el peso que Diseño les puso.
-- =============================================================================
drop view if exists public.v_cumplimiento_ot;
drop view if exists public.v_cumplimiento_planos;
drop view if exists public.v_cumplimiento_piezas;

create view public.v_cumplimiento_piezas
with (security_invoker = true) as
select
  p.*,
  case
    when p.es_ensamble then
      case when p.prd_armado then 100 when p.prd_inicio is not null then 50 else 0 end
    else
      case
        when p.prd_armado then 100
        when p.prd_recibido then 75
        when p.mtz_entregado then 50
        when p.mtz_habilitado then 25
        else 0
      end
  end::numeric(5,2) as avance_pct
from public.ot_piezas p;

comment on view public.v_cumplimiento_piezas is
  'Cada pieza con su avance por vistos: habilitada 25, entregada 50, recibida 75, armada 100 (el ensamble: empezado 50, armado 100).';

create view public.v_cumplimiento_planos
with (security_invoker = true) as
select
  pl.id                                   as plano_id,
  pl.orden_id,
  pl.orden_secuencia,
  pl.numero_plano,
  pl.nombre,
  pl.peso_pct,
  pl.fecha_entrega,
  pl.observacion,
  count(pz.id)                            as piezas,
  count(pz.id) filter (where pz.mtz_entregado) as piezas_entregadas,
  count(pz.id) filter (where pz.prd_armado)    as piezas_armadas,
  coalesce(round(sum(pz.avance_pct * pz.cantidad) / nullif(sum(pz.cantidad), 0), 2), 0)::numeric(5,2) as avance_pct,
  min(pz.mtz_inicio)                      as mtz_desde,
  max(pz.mtz_culminacion)                 as mtz_hasta,
  min(pz.prd_recepcion)                   as prd_desde,
  max(pz.prd_inicio)                      as prd_hasta
from public.ot_planos pl
left join public.v_cumplimiento_piezas pz on pz.plano_id = pl.id
group by pl.id;

comment on view public.v_cumplimiento_planos is
  'Cada plano con cuántas piezas tiene, cuántas van entregadas y armadas, y su avance ponderado por cantidad.';

create view public.v_cumplimiento_ot
with (security_invoker = true) as
select
  o.id                                    as orden_id,
  o.numero,
  count(pl.plano_id)                      as planos,
  count(pl.plano_id) filter (where pl.fecha_entrega is not null) as planos_entregados,
  coalesce(sum(pl.piezas), 0)             as piezas,
  coalesce(sum(pl.piezas_entregadas), 0)  as piezas_entregadas,
  coalesce(sum(pl.piezas_armadas), 0)     as piezas_armadas,
  coalesce(sum(pl.peso_pct), 0)::numeric(5,2) as peso_total,
  -- Ponderado por el peso que Diseño puso. Si los pesos no suman 100 se
  -- normaliza igual, y `peso_total` deja ver que la hoja está a medio pesar.
  coalesce(round(sum(pl.avance_pct * pl.peso_pct) / nullif(sum(pl.peso_pct), 0), 2), 0)::numeric(5,2) as avance_pct,
  min(pl.fecha_entrega)                   as primer_plano,
  max(pl.fecha_entrega)                   as ultimo_plano
from public.ordenes_trabajo o
left join public.v_cumplimiento_planos pl on pl.orden_id = o.id
group by o.id;

comment on view public.v_cumplimiento_ot is
  'El % de cumplimiento de la unidad, como en la cabecera de MW-FOR-ING-8: los planos ponderados por su peso.';

grant select on public.v_cumplimiento_piezas to authenticated;
grant select on public.v_cumplimiento_planos to authenticated;
grant select on public.v_cumplimiento_ot to authenticated;

-- =============================================================================
-- 7. LA ORDEN COMO CRONOGRAMA
-- -----------------------------------------------------------------------------
-- Una fila por etapa con lo que un Gantt necesita: el área, lo programado, lo
-- real y el semáforo de la casa. Se lee con el permiso de la orden, así que la
-- vista no abre nada que la tabla no abra.
-- =============================================================================
drop view if exists public.v_cronograma_ot;
create view public.v_cronograma_ot
with (security_invoker = true) as
select
  oe.id                       as etapa_id,
  oe.orden_id,
  ec.codigo                   as etapa_codigo,
  ec.nombre                   as etapa,
  ec.color,
  oe.orden_secuencia,
  a.codigo                    as area_codigo,
  a.nombre                    as area_nombre,
  oe.estado,
  oe.avance_porcentaje,
  oe.fecha_inicio_programada,
  oe.fecha_fin_programada,
  oe.fecha_inicio_real,
  oe.fecha_fin_real,
  (oe.fecha_fin_programada - current_date) as dias,
  public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
  r.texto                     as ultimo_reporte,
  r.creado_en                 as ultimo_reporte_en
from public.ot_etapas oe
join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = ec.area_id
left join lateral (
  select texto, creado_en
    from public.ot_etapa_reportes rr
   where rr.etapa_id = oe.id
   order by rr.creado_en desc
   limit 1
) r on true
where oe.estado <> 'OMITIDA';

comment on view public.v_cronograma_ot is
  'La orden como diagrama de Gantt: por etapa, el área, lo programado, lo real y el semáforo.';

grant select on public.v_cronograma_ot to authenticated;
