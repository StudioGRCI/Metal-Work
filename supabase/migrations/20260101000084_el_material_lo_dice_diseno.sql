-- =============================================================================
-- EL MATERIAL LO DICE DISEÑO, Y DE AHÍ SALE EL REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- «La OT no presupuesta materiales. Quien ve cuánto material y qué cosas se van
-- a utilizar es Diseño al realizar el diseño del vehículo: es ahí donde se ve
-- todo.» Con eso el sistema tenía un hueco, y grande: los planos y las piezas
-- que Diseño entrega (migración 070) no llevan material, y el único sitio donde
-- existía «material + cantidad» para una orden era `ot_presupuesto`, que nace de
-- la cotización y es un papel de costos, no la lista de lo que hay que pedir.
-- Resultado: Diseño sabía qué lleva la unidad y no tenía dónde escribirlo, así
-- que se lo dictaba a Producción para que lo pidiera por él.
--
-- Acá se cierra ese hueco con tres piezas:
--
--   1. `ot_materiales` — la lista de la orden, escrita por Diseño: qué material,
--      cuánto, de qué plano sale y a qué etapa va. Sin un solo importe: el costo
--      es asunto de `ot_presupuesto` y de quien tiene `costos.ver`.
--   2. `requerimiento_detalle.ot_material_id` — de qué línea de esa lista salió
--      cada pedido. Sin esto no se puede saber qué falta por pedir, y el segundo
--      requerimiento repetiría el primero.
--   3. `mandar_material_a_requerimiento(...)` — el pase: se manda una parte o
--      todo, y la base no deja pedir más de lo que la lista dice. Un porcentaje
--      y una cantidad son lo mismo acá: la pantalla convierte y manda cantidad.
--
-- Por qué el saldo se calcula y no se guarda: una cantidad pedida guardada en
-- la fila se desincroniza en cuanto alguien anula un requerimiento, y nadie se
-- entera. La vista lo suma de los pedidos vivos, que es la única fuente que no
-- puede mentir.
-- =============================================================================

-- =============================================================================
-- 1. LA LISTA DE MATERIALES DE LA ORDEN
-- =============================================================================
create table if not exists public.ot_materiales (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- De qué plano sale el material. Opcional a propósito: hay material de la
  -- unidad entera —pintura, pernería— que no cuelga de ningún plano.
  plano_id        uuid,
  -- A qué etapa, y por ella a qué área, va destinado. También opcional: al
  -- empezar el diseño la orden puede no tener etapas todavía.
  etapa_id        uuid,
  material_id     uuid not null references public.materiales(id) on delete restrict,
  -- Tres decimales porque el taller pide en kilos y en metros, y una plancha
  -- cortada no da número redondo.
  cantidad        numeric(12,3) not null check (cantidad > 0),
  observacion     text,
  creado_por      uuid references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- La pareja, no la columna suelta: con la clave suelta se podía colgar la
  -- línea de un plano o de una etapa de OTRA orden. Es la misma lección que
  -- pagó el presupuesto por etapa.
  constraint fk_ot_material_plano foreign key (plano_id, orden_id)
    references public.ot_planos(id, orden_id) on delete set null,
  constraint fk_ot_material_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete set null,

  -- El mismo material, en el mismo plano, dos veces, es una equivocación de
  -- tecleo: se corrige la cantidad. `nulls not distinct` para que el material
  -- suelto —sin plano— tampoco se pueda repetir.
  constraint uq_ot_material unique nulls not distinct (orden_id, plano_id, material_id)
);

comment on table public.ot_materiales is
  'Lo que Diseño dice que lleva la unidad: material, cantidad, de qué plano sale y a qué etapa va. De acá salen los requerimientos al almacén. No lleva costos a propósito.';
comment on column public.ot_materiales.plano_id is
  'El plano del que sale el material. Vacío para lo que es de la unidad entera: pintura, pernería, consumibles.';
comment on column public.ot_materiales.etapa_id is
  'La etapa que lo va a consumir, y por ella el área. Vacío mientras la orden no tenga etapas instanciadas.';

-- (b) de la regla de índices: la pantalla siempre lee esta tabla por orden, y
-- ordena por plano. Sin este índice cada apertura de la pestaña es un recorrido
-- de toda la tabla.
create index if not exists idx_ot_materiales_orden on public.ot_materiales(orden_id, plano_id);

-- =============================================================================
-- 2. DE QUÉ LÍNEA SALIÓ CADA PEDIDO
-- =============================================================================
alter table public.requerimiento_detalle
  add column if not exists ot_material_id uuid references public.ot_materiales(id) on delete set null;

comment on column public.requerimiento_detalle.ot_material_id is
  'La línea de la lista de Diseño que originó este pedido. Vacío en los requerimientos que se arman a mano, que siguen valiendo.';

-- (b): la vista del saldo agrupa por esta columna en cada apertura de la
-- pestaña de materiales.
create index if not exists idx_requerimiento_detalle_ot_material
  on public.requerimiento_detalle(ot_material_id)
  where ot_material_id is not null;

-- =============================================================================
-- 3. SEGURIDAD
-- =============================================================================
alter table public.ot_materiales enable row level security;

-- La lee quien puede ver la orden: Producción necesita saber qué material está
-- pedido, y Almacén qué le van a pedir.
drop policy if exists ver_ot_materiales on public.ot_materiales;
create policy ver_ot_materiales on public.ot_materiales
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

-- La escribe Diseño y nadie más: es su hoja. Gerencia entra por es_admin() o
-- por `diseno.planos`, que ya tiene.
drop policy if exists crear_ot_materiales on public.ot_materiales;
create policy crear_ot_materiales on public.ot_materiales
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists editar_ot_materiales on public.ot_materiales;
create policy editar_ot_materiales on public.ot_materiales
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'))
  with check (public.es_admin() or public.tiene_permiso('diseno.planos'));

drop policy if exists borrar_ot_materiales on public.ot_materiales;
create policy borrar_ot_materiales on public.ot_materiales
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('diseno.planos'));

grant select, insert, update, delete on public.ot_materiales to authenticated;

select public.activar_timestamps('ot_materiales');
select public.activar_auditoria('ot_materiales');

-- =============================================================================
-- 4. LA LISTA CON SU SALDO
-- -----------------------------------------------------------------------------
-- Lo pedido sale de los requerimientos vivos. Un requerimiento RECHAZADO o
-- ANULADO no descuenta: ese material hay que volver a pedirlo.
-- =============================================================================
create or replace view public.v_ot_materiales as
select
  m.id,
  m.orden_id,
  m.plano_id,
  p.numero_plano,
  p.nombre                        as plano_nombre,
  m.etapa_id,
  ec.nombre                       as etapa,
  a.nombre                        as area,
  m.material_id,
  mat.codigo                      as material_codigo,
  mat.descripcion                 as material,
  mat.especificacion_tecnica,
  um.codigo                       as unidad,
  m.cantidad,
  coalesce(pedido.cantidad, 0)                        as cantidad_pedida,
  greatest(m.cantidad - coalesce(pedido.cantidad, 0), 0) as cantidad_pendiente,
  coalesce(pedido.cantidad, 0) >= m.cantidad          as completo,
  m.observacion,
  m.creado_por,
  m.creado_en
from public.ot_materiales m
join public.materiales mat        on mat.id = m.material_id
left join public.unidades_medida um on um.id = mat.unidad_medida_id
left join public.ot_planos p      on p.id = m.plano_id
left join public.ot_etapas e      on e.id = m.etapa_id
left join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
left join public.areas a          on a.id = ec.area_id
left join lateral (
  select sum(rd.cantidad_solicitada) as cantidad
    from public.requerimiento_detalle rd
    join public.requerimientos r on r.id = rd.requerimiento_id
   where rd.ot_material_id = m.id
     and r.estado not in ('RECHAZADO', 'ANULADO')
) pedido on true;

comment on view public.v_ot_materiales is
  'La lista de materiales de Diseño con lo que ya se mandó al almacén y lo que queda por pedir. Lo pedido se suma de los requerimientos vivos: un rechazado o anulado no descuenta.';

alter view public.v_ot_materiales set (security_invoker = on);
grant select on public.v_ot_materiales to authenticated;

-- =============================================================================
-- 5. EL PASE AL REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- Recibe las líneas como [{"material": "<id de ot_materiales>", "cantidad": n}].
-- Corre como quien la llama —no `security definer`— para que el RLS de cada
-- tabla siga mandando: si quien la llama no puede crear requerimientos, la
-- política lo para igual que pararía a un insert directo.
-- =============================================================================
create or replace function public.mandar_material_a_requerimiento(
  p_orden           uuid,
  p_lineas          jsonb,
  p_almacen         uuid    default null,
  p_prioridad       text    default 'NORMAL',
  p_fecha_requerida date    default null,
  p_observaciones   text    default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_sede          uuid;
  v_requerimiento uuid;
  v_linea         jsonb;
  v_material      uuid;
  v_cantidad      numeric;
  v_pendiente     numeric;
  v_nombre        text;
  v_cuantas       int := 0;
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.crear')) then
    raise exception 'No tiene permiso para solicitar material'
      using errcode = 'insufficient_privilege';
  end if;

  select o.sede_id into v_sede from public.ordenes_trabajo o where o.id = p_orden;
  if v_sede is null then
    raise exception 'La orden de trabajo no existe o no la puede ver';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Hay que marcar al menos un material para pedir'
      using errcode = 'check_violation';
  end if;

  -- Primero se valida todo y recién después se crea el requerimiento: así una
  -- cantidad de más no deja un requerimiento vacío y numerado dando vueltas.
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_material := (v_linea->>'material')::uuid;
    v_cantidad := (v_linea->>'cantidad')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      continue;
    end if;

    select v.cantidad_pendiente, v.material
      into v_pendiente, v_nombre
      from public.v_ot_materiales v
     where v.id = v_material and v.orden_id = p_orden;

    if v_pendiente is null then
      raise exception 'Ese material no está en la lista de esta orden'
        using errcode = 'check_violation';
    end if;

    if v_cantidad > v_pendiente then
      raise exception 'De % ya solo quedan % por pedir, y se están pidiendo %',
        v_nombre, v_pendiente, v_cantidad
        using errcode = 'check_violation';
    end if;

    v_cuantas := v_cuantas + 1;
  end loop;

  if v_cuantas = 0 then
    raise exception 'Ninguna de las líneas tiene cantidad que pedir'
      using errcode = 'check_violation';
  end if;

  insert into public.requerimientos
    (orden_id, sede_id, almacen_id, prioridad, fecha_requerida, observaciones, solicitante_id)
  values
    (p_orden, v_sede, p_almacen, p_prioridad::public.prioridad_ot, p_fecha_requerida,
     p_observaciones, public.usuario_actual())
  returning id into v_requerimiento;

  insert into public.requerimiento_detalle
    (requerimiento_id, material_id, cantidad_solicitada, ot_material_id, especificacion)
  select
    v_requerimiento,
    m.material_id,
    (l->>'cantidad')::numeric,
    m.id,
    m.observacion
  from jsonb_array_elements(p_lineas) as l
  join public.ot_materiales m on m.id = (l->>'material')::uuid
  where (l->>'cantidad')::numeric > 0;

  return v_requerimiento;
end;
$$;

comment on function public.mandar_material_a_requerimiento(uuid, jsonb, uuid, text, date, text) is
  'Arma un requerimiento con líneas de la lista de materiales de la orden. No deja pedir más de lo que queda pendiente de cada una.';

revoke all on function public.mandar_material_a_requerimiento(uuid, jsonb, uuid, text, date, text) from public, anon;
grant execute on function public.mandar_material_a_requerimiento(uuid, jsonb, uuid, text, date, text) to authenticated;
