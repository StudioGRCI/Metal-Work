-- Cuánto tiempo para la unidad en cada área.
--
-- La cotización de trabajo decía qué se va a gastar y qué se va a fabricar, pero
-- no cuánto va a tardar. El plazo de entrega se escribía a mano en Ventas —«45
-- días»— sin que nadie hubiera sumado el paso por diseño, por logística, por
-- pintura. Cuando la orden se abría, las catorce etapas nacían sin fecha
-- programada: el taller no sabía en qué semana le tocaba, y el semáforo de
-- atraso no tenía contra qué medir.
--
-- Acá se decide, al costear, cuántos días de taller para la unidad en cada área.
-- La suma es el plazo de fabricación, y cuando la cotización aprobada se
-- convierte en orden, esos días se convierten en el programa: cada etapa nace
-- con su fecha de inicio y de fin, contadas con el calendario laboral —sin
-- domingos ni feriados—.
--
-- Los días de arranque son los del catálogo de etapas, que salieron del OneDrive
-- de la empresa. Son un punto de partida, no una ley: una tolva de 8 m³ no tarda
-- lo mismo que una plataforma de 12 m, y por eso se editan cotización por
-- cotización.

-- =============================================================================
-- EL PROGRAMA DE UNA COTIZACIÓN
-- =============================================================================

create table if not exists public.cotizacion_etapas (
  id                uuid primary key default gen_random_uuid(),
  cotizacion_id     uuid not null references public.cotizaciones(id) on delete cascade,
  etapa_catalogo_id uuid not null references public.etapas_catalogo(id) on delete restrict,
  -- Copiado del catálogo al sembrar. Se guarda acá para que reordenar el
  -- catálogo mañana no reordene el programa de una cotización ya costeada.
  orden_secuencia   int not null check (orden_secuencia > 0),
  -- Días de taller, no corridos. Cero significa que la unidad no pasa por esa
  -- área: no es lo mismo que «no lo sé», y el programa la saltea.
  dias              int not null default 0 check (dias >= 0 and dias <= 365),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint uq_cotizacion_etapa unique (cotizacion_id, etapa_catalogo_id)
);

comment on table public.cotizacion_etapas is
  'Cuántos días de taller para la unidad en cada área. Se decide al costear y se convierte en el programa de la orden de trabajo.';
comment on column public.cotizacion_etapas.dias is
  'Días laborables en esa área. Cero = no pasa por ahí.';

create index if not exists idx_cotizacion_etapas_cotizacion
  on public.cotizacion_etapas(cotizacion_id, orden_secuencia);
create index if not exists idx_cotizacion_etapas_catalogo
  on public.cotizacion_etapas(etapa_catalogo_id);

-- El total, en la cabecera, para no sumar catorce filas en cada listado ni en el
-- tablero.
alter table public.cotizaciones
  add column if not exists dias_programados int not null default 0
    check (dias_programados >= 0);

comment on column public.cotizaciones.dias_programados is
  'Suma de los días de cada área. Lo mantiene el disparador de cotizacion_etapas; no se escribe a mano.';

-- =============================================================================
-- SEMBRAR Y TOTALIZAR
-- =============================================================================

-- Deja en la cotización las catorce etapas activas con sus días del catálogo.
-- Idempotente: volver a llamarla solo agrega las que falten, y nunca pisa un día
-- que alguien ya corrigió.
create or replace function public.cotizacion_sembrar_etapas(p_cotizacion_id uuid)
returns integer
language plpgsql
volatile
-- La siembra ocurre cuando Ventas pasa la cotización a costeo, y Ventas no tiene
-- —ni debe tener— permiso para escribir el programa del taller.
security definer
set search_path = public
as $$
declare
  v_creadas integer;
begin
  if not exists (select 1 from public.cotizaciones where id = p_cotizacion_id) then
    raise exception 'No existe la cotización %', p_cotizacion_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.cotizacion_etapas (
    cotizacion_id, etapa_catalogo_id, orden_secuencia, dias)
  select p_cotizacion_id, ec.id, ec.orden_secuencia, coalesce(ec.dias_estandar, 0)
    from public.etapas_catalogo ec
   where ec.activo
   order by ec.orden_secuencia
  on conflict (cotizacion_id, etapa_catalogo_id) do nothing;

  get diagnostics v_creadas = row_count;
  return v_creadas;
end;
$$;

comment on function public.cotizacion_sembrar_etapas is
  'Siembra en la cotización las etapas activas del catálogo con sus días estándar. Idempotente: no pisa lo ya corregido.';

revoke all on function public.cotizacion_sembrar_etapas(uuid) from public, anon;
grant execute on function public.cotizacion_sembrar_etapas(uuid) to authenticated;

-- El total vive en la cabecera y lo mantiene la base. Si lo calculara la
-- pantalla, una fila editada por otro camino dejaría el total mintiendo.
create or replace function public.fn_cotizacion_etapa_totalizar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cotizacion uuid := coalesce(new.cotizacion_id, old.cotizacion_id);
  v_dias       int;
begin
  select coalesce(sum(dias), 0) into v_dias
    from public.cotizacion_etapas where cotizacion_id = v_cotizacion;

  update public.cotizaciones
     set dias_programados = v_dias
   where id = v_cotizacion
     and dias_programados is distinct from v_dias;

  return null;
end;
$$;

drop trigger if exists trg_cotizacion_etapa_totalizar on public.cotizacion_etapas;
create trigger trg_cotizacion_etapa_totalizar
  after insert or update or delete on public.cotizacion_etapas
  for each row execute function public.fn_cotizacion_etapa_totalizar();

-- La misma reja que las partidas: una cotización que Gerencia ya miró no cambia
-- de programa por detrás. Para tocarlo hay que devolverla a costeo.
create or replace function public.fn_cotizacion_etapa_bloquear_cerrada()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_estado public.estado_cotizacion;
  v_numero text;
begin
  select c.estado, c.numero into v_estado, v_numero
    from public.cotizaciones c
   where c.id = coalesce(new.cotizacion_id, old.cotizacion_id);

  if v_estado in ('REVISADA', 'ENVIADA', 'APROBADA', 'ANULADA') then
    raise exception
      'La cotización % está en estado % y su programa de taller ya no puede modificarse. Devuélvela a costeo.',
      v_numero, v_estado
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_cotizacion_etapa_bloquear_cerrada on public.cotizacion_etapas;
create trigger trg_cotizacion_etapa_bloquear_cerrada
  before insert or update or delete on public.cotizacion_etapas
  for each row execute function public.fn_cotizacion_etapa_bloquear_cerrada();

drop trigger if exists trg_cotizacion_etapa_fecha on public.cotizacion_etapas;
create trigger trg_cotizacion_etapa_fecha
  before update on public.cotizacion_etapas
  for each row execute function public.fn_set_actualizado_en();

-- Quién cambió un plazo y cuándo. Un día de más en pintura mueve la fecha de
-- entrega de todo el lote: tiene que quedar de quién fue.
select public.activar_auditoria('cotizacion_etapas');

-- Cuando Ventas la manda a costear, el programa aparece solo con los días del
-- catálogo. Que Administración lo encuentre escrito y lo corrija es más barato
-- que hacerle llenar catorce casillas en blanco cada vez.
create or replace function public.fn_cotizacion_sembrar_programa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'EN_COSTEO' and old.estado is distinct from new.estado then
    perform public.cotizacion_sembrar_etapas(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cotizacion_sembrar_programa on public.cotizaciones;
create trigger trg_cotizacion_sembrar_programa
  after update of estado on public.cotizaciones
  for each row execute function public.fn_cotizacion_sembrar_programa();

-- =============================================================================
-- LAS REJAS
-- -----------------------------------------------------------------------------
-- El programa es cotización de trabajo: lo escribe quien costea. Si la política
-- aceptara `cotizaciones.editar`, el UPDATE de Administración afectaría cero
-- filas, Postgres no daría error y la pantalla diría «guardado» sin guardar. Ese
-- es el fallo mudo de las migraciones 036 y 037; el permiso que exige la acción
-- —`cotizaciones.costear`— es exactamente el que acepta esta política.
-- =============================================================================

alter table public.cotizacion_etapas enable row level security;

drop policy if exists ver_cotizacion_etapas on public.cotizacion_etapas;
create policy ver_cotizacion_etapas on public.cotizacion_etapas
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.ver'));

drop policy if exists crear_cotizacion_etapas on public.cotizacion_etapas;
create policy crear_cotizacion_etapas on public.cotizacion_etapas
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('cotizaciones.costear'));

drop policy if exists editar_cotizacion_etapas on public.cotizacion_etapas;
create policy editar_cotizacion_etapas on public.cotizacion_etapas
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.costear'))
  with check (public.es_admin() or public.tiene_permiso('cotizaciones.costear'));

drop policy if exists borrar_cotizacion_etapas on public.cotizacion_etapas;
create policy borrar_cotizacion_etapas on public.cotizacion_etapas
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.costear'));

grant select, insert, update, delete on public.cotizacion_etapas to authenticated;

-- =============================================================================
-- DE LA COTIZACIÓN AL TALLER
-- =============================================================================

-- Convierte los días de cada área en fechas programadas dentro de la OT.
--
-- Las etapas van una detrás de otra: la que sigue arranca el día de taller
-- siguiente al fin de la anterior. Un área con cero días no se programa —la
-- unidad no pasa por ahí— y no consume calendario.
create or replace function public.programar_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cotizacion uuid;
  v_cursor     date;
  v_inicio     date;
  v_fin        date;
  v_programadas int := 0;
  r            record;
begin
  select o.cotizacion_id, coalesce(o.fecha_inicio_programada, current_date)
    into v_cotizacion, v_cursor
    from public.ordenes_trabajo o
   where o.id = p_orden_id;

  -- Una OT abierta a mano, sin cotización detrás, no tiene programa que bajar.
  if v_cotizacion is null then return 0; end if;

  for r in
    select e.id, ce.dias
      from public.ot_etapas e
      join public.cotizacion_etapas ce
        on ce.etapa_catalogo_id = e.etapa_catalogo_id
       and ce.cotizacion_id = v_cotizacion
     where e.orden_id = p_orden_id
       and ce.dias > 0
       -- No se repisa un programa que el taller ya movió a mano.
       and e.fecha_inicio_programada is null
     order by e.orden_secuencia
  loop
    v_inicio := public.sumar_dias_habiles(v_cursor, 0);
    -- El primer día ya cuenta: un área de un día empieza y termina el mismo día.
    v_fin    := public.sumar_dias_habiles(v_inicio, r.dias - 1);

    update public.ot_etapas
       set fecha_inicio_programada = v_inicio,
           fecha_fin_programada    = v_fin
     where id = r.id;

    v_cursor := v_fin + 1;
    v_programadas := v_programadas + 1;
  end loop;

  return v_programadas;
end;
$$;

comment on function public.programar_etapas_ot is
  'Convierte los días por área de la cotización en fechas programadas de cada etapa de la OT, encadenadas con el calendario laboral.';

revoke all on function public.programar_etapas_ot(uuid) from public, anon, authenticated;

-- Las etapas de una OT se instancian al aprobarla. Justo ahí, y no después, es
-- cuando tiene que bajar el programa: si se dejara a una acción de la pantalla,
-- una OT aprobada desde otro camino nacería sin fechas y nadie lo notaría.
create or replace function public.crear_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_creadas integer;
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'No existe la orden de trabajo %', p_orden_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ot_etapas (
    orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion)
  select p_orden_id, ec.id, ec.orden_secuencia, ec.horas_estandar, ec.requiere_inspeccion
    from public.etapas_catalogo ec
   where ec.activo
   order by ec.orden_secuencia
  on conflict (orden_id, etapa_catalogo_id) do nothing;

  get diagnostics v_creadas = row_count;

  if v_creadas > 0 then
    perform public.ot_registrar_evento(
      p_orden_id, 'CREACION',
      format('Se generaron %s etapas de producción para la OT', v_creadas),
      jsonb_build_object('etapas_creadas', v_creadas));
  end if;

  -- El programa que se costeó: cuántos días para en cada área.
  perform public.programar_etapas_ot(p_orden_id);

  return v_creadas;
end;
$$;

comment on function public.crear_etapas_ot is
  'Crea las etapas de una OT a partir del catálogo activo y les baja el programa de la cotización. Se dispara sola al aprobar la OT.';

revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;

-- Las cotizaciones que ya están en costeo se quedaron sin programa porque nacieron
-- antes de esta migración. Se les siembra ahora, con los días del catálogo.
do $$
declare
  c record;
begin
  for c in
    select id from public.cotizaciones
     where estado in ('EN_COSTEO', 'OBSERVADA')
  loop
    perform public.cotizacion_sembrar_etapas(c.id);
  end loop;
end $$;
