-- Cada área responde por su plazo, y su jefe tiene nombre.
--
-- Del `CONTROL DE PLAZOS - MWP - 2026.xlsx` de la empresa —siete hojas, una por
-- área, editado el 2026-08-29—. Cada fila es una unidad con su fecha de inicio,
-- su fecha de culminación, los días que faltan y una observación donde el área
-- escribe qué la trabó. Al 11 de agosto tenían 17 de 18 unidades vencidas en
-- Requerimientos y 15 de 15 en Maestranza: el control las mide y nadie las ve a
-- tiempo.
--
-- Acá se trae eso, con tres decisiones que dijo la empresa:
--
--   · Un área es siempre un equipo, así que **responde el jefe de área**, no la
--     persona que hizo el trabajo.
--   · La observación **la escribe el área** —es quien sabe qué falta— y
--     **Administración la verifica**. Hasta ahora la recopilaba una sola persona
--     a mano en el Excel.
--   · El semáforo es suyo y es derivado: no se guarda, se calcula contra hoy.
--
-- Lo que ya estaba y no hacía falta inventar: `ot_etapas` guarda fecha
-- programada de inicio y fin, estado, responsable y observaciones, y desde la
-- migración 63 las fechas bajan solas del tiempo por área de la cotización.

-- =============================================================================
-- EL SEMÁFORO, CON SU REGLA
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_plazo') then
    create type public.estado_plazo as enum (
      'VIGENTE', 'POR_VENCER', 'VENCIDO', 'CUMPLIDO', 'CUMPLIDO_TARDE');
  end if;
end $$;

comment on type public.estado_plazo is
  'Semáforo de plazo de una etapa. Los tres primeros son la fórmula del CONTROL DE PLAZOS de la empresa; los dos últimos, cómo terminó.';

-- La fórmula es literalmente la suya:
--   =SI(DIAS>=7;"Vigente"; SI(Y(DIAS>=1;DIAS<=6);"Por Vencer";"Vencido"))
-- con DIAS = fecha de culminación − HOY.
--
-- Se le agregan los dos estados de cierre porque su hoja no los tiene y los
-- necesita: una etapa terminada seguía saliendo «Vencida» para siempre, y una
-- terminada a tiempo se veía igual que una terminada con veinte días de atraso.
create or replace function public.estado_del_plazo(
  p_fin_programada date,
  p_fin_real       timestamptz default null
)
returns public.estado_plazo
language sql
stable
as $$
  select case
    when p_fin_real is not null and p_fin_programada is not null then
      case
        when p_fin_real::date <= p_fin_programada then 'CUMPLIDO'::public.estado_plazo
        else 'CUMPLIDO_TARDE'::public.estado_plazo
      end
    when p_fin_real is not null then null
    -- Sin fecha comprometida no hay nada que medir, y no se inventa.
    when p_fin_programada is null then null
    when p_fin_programada - current_date >= 7 then 'VIGENTE'::public.estado_plazo
    when p_fin_programada - current_date >= 1 then 'POR_VENCER'::public.estado_plazo
    else 'VENCIDO'::public.estado_plazo
  end;
$$;

comment on function public.estado_del_plazo is
  'Semáforo de una etapa contra la fecha de hoy: la fórmula del CONTROL DE PLAZOS de la empresa, con umbral de siete días.';

-- =============================================================================
-- EL JEFE DE ÁREA
-- -----------------------------------------------------------------------------
-- `areas.encargado` ya traía el nombre del organigrama —Frank en Diseño, Edson
-- en Maestranza, Santiago en Producción—, pero es texto: no se le puede pedir
-- que entre a escribir su observación ni decir «esta etapa es de él».
--
-- Se agrega la cuenta al lado del nombre, no en su lugar. El nombre del
-- organigrama vale aunque esa persona todavía no tenga usuario, y el día que la
-- cuenta se dé de baja el área no se queda sin encargado en el papel. Es la
-- misma lección de quién firma las cotizaciones.
-- =============================================================================

alter table public.areas
  add column if not exists jefe_id uuid references public.usuarios(id) on delete set null;

comment on column public.areas.jefe_id is
  'La cuenta del jefe de área. Un área es un equipo: responde el jefe, no quien hizo el trabajo.';

create index if not exists idx_areas_jefe on public.areas(jefe_id);

-- =============================================================================
-- QUÉ ÁREA ES DUEÑA DE CADA ETAPA
-- =============================================================================

alter table public.etapas_catalogo
  add column if not exists area_id uuid references public.areas(id) on delete restrict;

comment on column public.etapas_catalogo.area_id is
  'El área que responde por esta etapa. De acá sale el responsable de cada etapa de la OT.';

create index if not exists idx_etapas_catalogo_area on public.etapas_catalogo(area_id);

-- El reparto sale de sus propias hojas del CONTROL DE PLAZOS —Diseño,
-- Maestranza, Requerimientos, Logística, Producción, Acabados y Trámites— más
-- las áreas que ese archivo no cubre pero el circuito sí.
update public.etapas_catalogo e
   set area_id = a.id
  from (values
    ('OT_EMISION',       'ADM'),
    ('DISENO',           'DIS'),
    ('REQ_MAESTRANZA',   'REQ'),
    ('REQ_PRODUCCION',   'REQ'),
    ('LOGISTICA',        'LOG'),
    ('APROB_COTIZACION', 'ADM'),
    ('ALMACEN',          'ALM'),
    ('HABILITADO_MP',    'MTZ'),
    ('PRODUCCION',       'PRD'),
    ('ARENADO',          'ACB'),
    ('PINTURA',          'ACB'),
    ('ELECTRICO_NEUM',   'PRD'),
    ('CALIDAD',          'CAL'),
    ('ENTREGA',          'ADM')
  ) as m(etapa, area)
  join public.areas a on a.codigo = m.area
 where e.codigo = m.etapa
   and e.area_id is distinct from a.id;

-- =============================================================================
-- EL RESPONSABLE DE CADA ETAPA DE LA OT
-- -----------------------------------------------------------------------------
-- `ot_etapas.responsable_id` existía desde el primer día y nunca lo llenó nadie.
-- Ahora lo pone la base al instanciar las etapas: el jefe del área dueña de esa
-- etapa. Si el área no tiene jefe con cuenta, queda en nulo y la pantalla lo
-- dice —que es mejor que asignárselo a cualquiera—.
-- =============================================================================

create or replace function public.asignar_responsables_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_puestos integer;
begin
  update public.ot_etapas oe
     set responsable_id = a.jefe_id
    from public.etapas_catalogo ec
    join public.areas a on a.id = ec.area_id
   where oe.etapa_catalogo_id = ec.id
     and oe.orden_id = p_orden_id
     -- No se pisa un responsable puesto a mano: el jefe puede delegar una etapa.
     and oe.responsable_id is null
     and a.jefe_id is not null;

  get diagnostics v_puestos = row_count;
  return v_puestos;
end;
$$;

comment on function public.asignar_responsables_ot is
  'Pone en cada etapa de la OT al jefe del área que la tiene. No pisa un responsable ya asignado a mano.';

revoke all on function public.asignar_responsables_ot(uuid) from public, anon, authenticated;

-- =============================================================================
-- LO QUE EL ÁREA REPORTA, Y LO QUE ADMINISTRACIÓN VERIFICA
-- -----------------------------------------------------------------------------
-- En su Excel la observación es una celda que se pisa: se pierde lo que se dijo
-- la semana pasada y no queda quién lo dijo. Acá es una bitácora, porque el
-- valor está justo en la secuencia —«falta camión» la semana pasada, «llegó el
-- camión, falta plano» esta— y en poder decir quién reportó qué.
--
-- Verificar no es aprobar el trabajo: es que Administración diga «leí esto y es
-- lo que pasa». Sin ese paso, el informe semanal vuelve a ser una persona
-- recopilando a mano, que es de lo que se quiere salir.
-- =============================================================================

create table if not exists public.ot_etapa_reportes (
  id             uuid primary key default gen_random_uuid(),
  etapa_id       uuid not null,
  orden_id       uuid not null,
  texto          text not null check (length(btrim(texto)) >= 3),
  -- Quién lo escribió y cuándo. Es del área.
  creado_por     uuid references public.usuarios(id) on delete set null,
  creado_en      timestamptz not null default now(),
  -- Quién lo verificó y cuándo. Es de Administración.
  verificado_por uuid references public.usuarios(id) on delete set null,
  verificado_en  timestamptz,

  -- La pareja garantiza que la etapa pertenece a esa orden; es la clave alterna
  -- que 0003 dejó puesta para esto.
  constraint fk_reporte_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete cascade,
  constraint ck_reporte_verificacion check (
    (verificado_por is null and verificado_en is null)
    or (verificado_por is not null and verificado_en is not null))
);

comment on table public.ot_etapa_reportes is
  'Lo que el área reporta de una etapa —qué falta y quién la trabó— y la verificación de Administración. Es bitácora: no se pisa.';

create index if not exists idx_reporte_etapa on public.ot_etapa_reportes(etapa_id, creado_en desc);
create index if not exists idx_reporte_orden on public.ot_etapa_reportes(orden_id, creado_en desc);
create index if not exists idx_reporte_sin_verificar
  on public.ot_etapa_reportes(creado_en desc) where verificado_en is null;

-- El texto no se corrige después: es lo que se dijo el día que se dijo. Lo único
-- que cambia de un reporte es que alguien lo verifique, y una sola vez.
create or replace function public.fn_reporte_inmutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte de avance no se borra: es la evidencia de lo que se informó.'
      using errcode = 'restrict_violation';
  end if;

  if new.texto is distinct from old.texto
     or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en then
    raise exception 'Un reporte ya escrito no se corrige. Escribe uno nuevo.'
      using errcode = 'restrict_violation';
  end if;

  if old.verificado_en is not null and new.verificado_en is distinct from old.verificado_en then
    raise exception 'Este reporte ya fue verificado y la verificación no se deshace.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reporte_inmutable on public.ot_etapa_reportes;
create trigger trg_reporte_inmutable
  before update or delete on public.ot_etapa_reportes
  for each row execute function public.fn_reporte_inmutable();

-- Quién escribe se sella acá y no viaja desde la pantalla: mandarlo en el
-- formulario deja que cualquiera reporte en nombre de otro.
create or replace function public.fn_reporte_sellar_autor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.creado_por := coalesce(public.usuario_actual(), new.creado_por);
  return new;
end;
$$;

drop trigger if exists trg_reporte_sellar_autor on public.ot_etapa_reportes;
create trigger trg_reporte_sellar_autor
  before insert on public.ot_etapa_reportes
  for each row execute function public.fn_reporte_sellar_autor();

select public.activar_auditoria('ot_etapa_reportes');

-- =============================================================================
-- LAS REJAS
-- -----------------------------------------------------------------------------
-- Escribe el área: `produccion.registrar`, el mismo permiso con el que se carga
-- un parte diario. Verifica Administración: `ordenes.editar`, que es quien
-- maneja la orden. Los dos son exactamente los permisos que van a exigir las
-- acciones; si no coincidieran, el UPDATE afectaría cero filas, Postgres no
-- daría error y la pantalla diría «verificado» sin haber verificado nada.
-- =============================================================================

alter table public.ot_etapa_reportes enable row level security;

drop policy if exists ver_ot_etapa_reportes on public.ot_etapa_reportes;
create policy ver_ot_etapa_reportes on public.ot_etapa_reportes
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('ordenes.ver')
         or public.tiene_permiso('produccion.ver'));

drop policy if exists crear_ot_etapa_reportes on public.ot_etapa_reportes;
create policy crear_ot_etapa_reportes on public.ot_etapa_reportes
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('produccion.registrar'));

drop policy if exists verificar_ot_etapa_reportes on public.ot_etapa_reportes;
create policy verificar_ot_etapa_reportes on public.ot_etapa_reportes
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('ordenes.editar'))
  with check (public.es_admin() or public.tiene_permiso('ordenes.editar'));

grant select, insert, update on public.ot_etapa_reportes to authenticated;

-- =============================================================================
-- LA VISTA QUE ES SU HOJA
-- -----------------------------------------------------------------------------
-- Una fila por etapa en curso, con lo que su Excel tiene en cada hoja: la
-- unidad, el código interno, las fechas, los días que faltan, el semáforo y el
-- último reporte. Filtrando por área, es exactamente una de sus siete hojas.
-- =============================================================================

drop view if exists public.v_plazos_por_area;

create view public.v_plazos_por_area
with (security_invoker = true) as
select
  oe.id                       as etapa_id,
  oe.orden_id,
  o.numero                    as orden_numero,
  a.id                        as area_id,
  a.codigo                    as area_codigo,
  a.nombre                    as area_nombre,
  a.encargado                 as area_encargado,
  ec.nombre                   as etapa_nombre,
  ec.orden_secuencia,
  coalesce(o.descripcion, ec.nombre) as unidad,
  c.razon_social              as cliente,
  u.codigo_interno,
  u.placa,
  oe.fecha_inicio_programada,
  oe.fecha_fin_programada,
  oe.fecha_fin_real,
  oe.estado,
  oe.avance_porcentaje,
  oe.responsable_id,
  -- Los días que faltan, como en su columna DIAS: negativo es que ya se pasó.
  (oe.fecha_fin_programada - current_date) as dias,
  public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
  r.id                        as ultimo_reporte_id,
  r.texto                     as ultimo_reporte,
  r.creado_en                 as ultimo_reporte_en,
  r.verificado_en             as ultimo_reporte_verificado_en
from public.ot_etapas oe
join public.ordenes_trabajo o on o.id = oe.orden_id
join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = ec.area_id
left join public.clientes c on c.id = o.cliente_id
left join public.unidades u on u.id = o.unidad_id
left join lateral (
  select id, texto, creado_en, verificado_en
    from public.ot_etapa_reportes rr
   where rr.etapa_id = oe.id
   order by rr.creado_en desc
   limit 1
) r on true
-- Solo lo que está vivo en el taller. Una orden entregada o facturada ya no se
-- controla, y una en borrador todavía no empezó: llenarían la hoja de filas que
-- nadie puede mover.
where o.estado not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')
  and oe.estado <> 'OMITIDA';

comment on view public.v_plazos_por_area is
  'El CONTROL DE PLAZOS de la empresa: una fila por etapa en curso con sus fechas, los días que faltan, el semáforo y el último reporte del área.';

grant select on public.v_plazos_por_area to authenticated;

-- =============================================================================
-- Y SE ENGANCHA DONDE NACEN LAS ETAPAS
-- -----------------------------------------------------------------------------
-- Mismo sitio que el programa de fechas: al instanciar las etapas de la OT. Si
-- se dejara a una acción de la pantalla, una OT aprobada por otro camino nacería
-- sin responsables y nadie se enteraría.
--
-- Hoy no asigna a nadie y está bien: los encargados que la empresa tiene en su
-- organigrama —Frank en Diseño, Edson en Maestranza, Santiago en Producción y
-- Acabados, Fernando en Requerimientos, Viviana en Logística, Jesús en Almacén—
-- todavía no tienen cuenta. En cuanto la tengan y se les ponga como jefe de su
-- área, las OT nuevas nacen con responsable sin tocar código.
-- =============================================================================

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
  -- Y quién responde por cada una: el jefe del área que la tiene.
  perform public.asignar_responsables_ot(p_orden_id);

  return v_creadas;
end;
$$;

comment on function public.crear_etapas_ot is
  'Crea las etapas de una OT desde el catálogo activo, les baja el programa de la cotización y les pone el jefe de área como responsable.';

revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;
