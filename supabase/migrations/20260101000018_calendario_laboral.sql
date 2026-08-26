-- =============================================================================
-- CALENDARIO LABORAL
-- -----------------------------------------------------------------------------
-- Un plazo de cinco días no son cinco casillas del almanaque. El taller trabaja
-- de lunes a sábado y para los domingos y los feriados; si el sistema suma días
-- corridos, promete al cliente una fecha en la que nadie va a estar soldando.
--
-- Acá quedan las tres piezas: qué días de la semana se trabaja, qué fechas son
-- feriado, y las funciones que suman y cuentan usando ambas cosas.
-- =============================================================================

-- ------------------------------------------------------ los días de la semana
-- Se guarda en la empresa porque es una decisión de ella, no del sistema. El
-- número es el de la norma ISO: 1 lunes … 7 domingo.
alter table public.empresa
  add column if not exists dias_laborables smallint[] not null default '{1,2,3,4,5,6}';

comment on column public.empresa.dias_laborables is
  'Días de la semana en que hay taller, en numeración ISO (1 lunes … 7 domingo). Por defecto de lunes a sábado.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_empresa_dias_laborables'
  ) then
    alter table public.empresa add constraint ck_empresa_dias_laborables check (
      array_length(dias_laborables, 1) between 1 and 7
      and dias_laborables <@ array[1,2,3,4,5,6,7]::smallint[]
    );
  end if;
end $$;

-- ------------------------------------------------------------------ feriados
create table if not exists public.feriados (
  fecha       date primary key,
  nombre      text not null,
  ambito      text not null default 'NACIONAL'
              check (ambito in ('NACIONAL', 'REGIONAL', 'EMPRESA')),
  -- Un feriado que la empresa decide recuperar trabajando. Sirve también al
  -- revés: un día de cierre por aniversario o por vacaciones colectivas se
  -- carga acá con ámbito EMPRESA y sin marcar.
  laborable   boolean not null default false,
  observacion text,
  creado_en   timestamptz not null default now()
);

comment on table public.feriados is
  'Fechas en que no hay taller. Los nacionales los siembra sembrar_feriados(); los de la empresa se cargan a mano.';
comment on column public.feriados.laborable is
  'Marcado, el taller sí trabaja ese feriado. Es la excepción, para los días que se recuperan.';

create index if not exists idx_feriados_anio on public.feriados((extract(year from fecha)));

-- ------------------------------------------------------------------- la pascua
-- Jueves y Viernes Santo se mueven cada año, así que hay que calcularlos. Es el
-- algoritmo de Butcher, el mismo que usa el calendario gregoriano.
create or replace function public.pascua(p_anio int)
returns date
language plpgsql
immutable
as $$
declare
  a int; b int; c int; d int; e int; f int; g int;
  h int; i int; k int; l int; m int;
  v_mes int; v_dia int;
begin
  a := p_anio % 19;
  b := p_anio / 100;
  c := p_anio % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  v_mes := (h + l - 7 * m + 114) / 31;
  v_dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_anio, v_mes, v_dia);
end;
$$;

comment on function public.pascua(int) is
  'Domingo de Pascua del año indicado. De ahí salen el Jueves y el Viernes Santo.';

-- --------------------------------------------------------- sembrar el año
-- Los feriados nacionales del Perú según el D.L. 713 y la Ley 31459. Se puede
-- correr las veces que haga falta: no pisa lo que ya está cargado, así que
-- respeta las excepciones que la empresa haya puesto a mano.
create or replace function public.sembrar_feriados(p_anio int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pascua date := public.pascua(p_anio);
  v_nuevos int;
begin
  with nacionales(fecha, nombre) as (
    values
      (make_date(p_anio,  1,  1), 'Año Nuevo'),
      (v_pascua - 3,               'Jueves Santo'),
      (v_pascua - 2,               'Viernes Santo'),
      (make_date(p_anio,  5,  1), 'Día del Trabajo'),
      (make_date(p_anio,  6,  7), 'Batalla de Arica y Día de la Bandera'),
      (make_date(p_anio,  6, 29), 'San Pedro y San Pablo'),
      (make_date(p_anio,  7, 23), 'Día de la Fuerza Aérea del Perú'),
      (make_date(p_anio,  7, 28), 'Fiestas Patrias'),
      (make_date(p_anio,  7, 29), 'Fiestas Patrias'),
      (make_date(p_anio,  8,  6), 'Batalla de Junín'),
      (make_date(p_anio,  8, 30), 'Santa Rosa de Lima'),
      (make_date(p_anio, 10,  8), 'Combate de Angamos'),
      (make_date(p_anio, 11,  1), 'Todos los Santos'),
      (make_date(p_anio, 12,  8), 'Inmaculada Concepción'),
      (make_date(p_anio, 12,  9), 'Batalla de Ayacucho'),
      (make_date(p_anio, 12, 25), 'Navidad')
  )
  insert into public.feriados (fecha, nombre, ambito)
  select fecha, nombre, 'NACIONAL' from nacionales
  on conflict (fecha) do nothing;

  get diagnostics v_nuevos = row_count;
  return v_nuevos;
end;
$$;

comment on function public.sembrar_feriados(int) is
  'Carga los feriados nacionales del año indicado. No pisa lo ya cargado.';

-- ------------------------------------------------------ ¿hay taller ese día?
create or replace function public.es_laborable(p_fecha date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    extract(isodow from p_fecha)::smallint = any(
      coalesce((select dias_laborables from public.empresa limit 1), '{1,2,3,4,5,6}'::smallint[])
    )
    and coalesce((select laborable from public.feriados where fecha = p_fecha), true);
$$;

comment on function public.es_laborable(date) is
  'Si ese día hay taller: cae en día laborable de la semana y no es feriado.';

-- ------------------------------------------------------------- sumar plazos
-- Suma días de taller. El día de partida no cuenta: pedir algo el lunes con
-- plazo de un día es recibirlo el martes. Con plazo cero devuelve el primer día
-- laborable desde la fecha, que es lo que se espera de un "para hoy mismo".
create or replace function public.sumar_dias_habiles(p_desde date, p_dias int)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_fecha date := p_desde;
  v_faltan int := greatest(coalesce(p_dias, 0), 0);
  v_vueltas int := 0;
begin
  if p_desde is null then return null; end if;

  if v_faltan = 0 then
    while not public.es_laborable(v_fecha) loop
      v_fecha := v_fecha + 1;
      v_vueltas := v_vueltas + 1;
      exit when v_vueltas > 400;
    end loop;
    return v_fecha;
  end if;

  while v_faltan > 0 loop
    v_fecha := v_fecha + 1;
    v_vueltas := v_vueltas + 1;
    if public.es_laborable(v_fecha) then
      v_faltan := v_faltan - 1;
    end if;
    -- Si alguien deja la empresa sin días laborables, esto se colgaría.
    if v_vueltas > 4000 then
      raise exception 'No se pudo calcular el plazo: revisa los días laborables de la empresa';
    end if;
  end loop;

  return v_fecha;
end;
$$;

comment on function public.sumar_dias_habiles(date, int) is
  'Fecha resultante de sumar días de taller, saltando domingos y feriados. El día de partida no cuenta.';

-- --------------------------------------------------------- contar entre dos
create or replace function public.dias_habiles_entre(p_desde date, p_hasta date)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_desde is null or p_hasta is null then null
    when p_hasta < p_desde then
      -coalesce((select count(*)::int from generate_series(p_hasta + 1, p_desde, '1 day') d
                  where public.es_laborable(d::date)), 0)
    else
      coalesce((select count(*)::int from generate_series(p_desde + 1, p_hasta, '1 day') d
                 where public.es_laborable(d::date)), 0)
  end;
$$;

comment on function public.dias_habiles_entre(date, date) is
  'Días de taller entre dos fechas, sin contar la de partida. Negativo si la meta ya pasó.';

grant execute on function public.pascua(int)                    to authenticated;
grant execute on function public.es_laborable(date)             to authenticated;
grant execute on function public.sumar_dias_habiles(date, int)  to authenticated;
grant execute on function public.dias_habiles_entre(date, date) to authenticated;
revoke execute on function public.sembrar_feriados(int) from public, anon;
grant execute on function public.sembrar_feriados(int) to authenticated;

-- ---------------------------------------------------- el plazo de un servicio
-- La fecha de entrega deja de calcularla la aplicación: la calcula la base, que
-- es la única que conoce el calendario. Si se manda una fecha a mano, se
-- respeta; el plazo solo la propone cuando falta.
create or replace function public.fn_os_entrega()
returns trigger
language plpgsql
as $$
begin
  if new.plazo_dias is not null and (
       new.fecha_entrega is null
       or tg_op = 'INSERT'
       or new.plazo_dias is distinct from old.plazo_dias
       or new.fecha is distinct from old.fecha
     ) then
    new.fecha_entrega := public.sumar_dias_habiles(new.fecha, new.plazo_dias);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_os_entrega on public.servicios_terceros;
create trigger trg_os_entrega
  before insert or update of fecha, plazo_dias on public.servicios_terceros
  for each row execute function public.fn_os_entrega();

-- ------------------------------------------------ el plazo de la orden de trabajo
-- Cuántos días de taller quedan hasta lo prometido al cliente. Es lo que la
-- jefatura mira para decidir a qué unidad meterle gente hoy.
create or replace view public.ot_resumen as
select
  o.id,
  o.numero,
  o.estado,
  o.prioridad,
  o.tipo_trabajo,
  o.sede_id,
  s.nombre                    as sede,
  o.cliente_id,
  c.razon_social              as cliente,
  c.numero_documento          as cliente_documento,
  o.unidad_id,
  u.placa,
  tc.nombre                   as tipo_carroceria,
  o.descripcion,
  o.fecha_registro,
  o.fecha_inicio_programada,
  o.fecha_fin_programada,
  o.fecha_entrega_comprometida,
  o.fecha_inicio_real,
  o.fecha_fin_real,
  o.avance_porcentaje,
  o.horas_estimadas,
  o.horas_reales,
  (o.horas_reales - o.horas_estimadas)                        as desviacion_horas,
  o.moneda,
  o.monto_presupuestado,
  o.responsable_id,
  (r.nombres || ' ' || r.apellidos)                           as responsable,
  count(e.id)                                                 as etapas_total,
  count(e.id) filter (where e.estado = 'TERMINADA')           as etapas_terminadas,
  count(e.id) filter (where e.estado = 'EN_PROCESO')          as etapas_en_proceso,
  -- Días de atraso frente a lo prometido al cliente; 0 si aún hay plazo o si la
  -- OT ya salió del taller.
  case
    when o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then 0
    when o.fecha_entrega_comprometida is null then 0
    else greatest(current_date - o.fecha_entrega_comprometida, 0)
  end                                                         as dias_atraso,
  -- Y los días de taller que quedan: los domingos y los feriados no cuentan,
  -- porque en esos días la unidad no avanza.
  case
    when o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then null
    when o.fecha_entrega_comprometida is null then null
    else public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida)
  end                                                         as dias_habiles_restantes
from public.ordenes_trabajo o
join public.clientes c        on c.id  = o.cliente_id
join public.sedes s           on s.id  = o.sede_id
left join public.unidades u   on u.id  = o.unidad_id
left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
left join public.usuarios r   on r.id  = o.responsable_id
left join public.ot_etapas e  on e.orden_id = o.id
group by o.id, c.id, s.id, u.id, tc.id, r.id;

comment on view public.ot_resumen is
  'Una fila por OT con cliente, unidad, avance, horas, atraso y días de taller restantes. Es la fuente del tablero de órdenes.';

-- ---------------------------------------------------------------- seguridad
alter table public.feriados enable row level security;

drop policy if exists ver_feriados    on public.feriados;
drop policy if exists crear_feriados  on public.feriados;
drop policy if exists editar_feriados on public.feriados;
drop policy if exists borrar_feriados on public.feriados;

-- El calendario lo lee cualquiera que haya entrado: sin él no se entiende
-- ninguna fecha de la aplicación.
create policy ver_feriados on public.feriados
  for select to authenticated using (true);

create policy crear_feriados on public.feriados
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy editar_feriados on public.feriados
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('configuracion.editar'))
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy borrar_feriados on public.feriados
  for delete to authenticated using (public.es_admin());

grant select on public.feriados to authenticated;
grant insert, update on public.feriados to authenticated;
grant delete on public.feriados to authenticated;

alter view public.ot_resumen set (security_invoker = on);
grant select on public.ot_resumen to authenticated;

-- ------------------------------------------------------- el calendario cargado
-- Tres años por delante: el que corre y los dos siguientes, que es hasta donde
-- se compromete una entrega.
do $$
declare v_anio int := extract(year from current_date)::int;
begin
  perform public.sembrar_feriados(v_anio - 1);
  perform public.sembrar_feriados(v_anio);
  perform public.sembrar_feriados(v_anio + 1);
  perform public.sembrar_feriados(v_anio + 2);
end $$;
