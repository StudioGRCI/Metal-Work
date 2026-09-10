-- =============================================================================
-- LAS UNIDADES QUE LLEGAN SIN ORDEN
-- -----------------------------------------------------------------------------
-- «En Avance de taller y en los supervisores permite, por área o en El día en
-- el taller, registrar flotas sin OT en el sistema: que puedan registrar qué
-- han hecho, tomen foto y reporten más o menos lo que ven.»
--
-- Al taller entran unidades de flota de los clientes —una compuerta que se
-- cambia, un piso que se repara, una tolva que vuelve a pintura— que no tienen
-- orden de trabajo en el sistema. Hoy el supervisor no puede dejar escrito nada
-- sobre ellas: el avance con fotos cuelga de la orden, y sin orden no hay
-- dónde. Y el jefe de producción, que cierra el día con «¿qué se tocó y quién
-- no reportó?», no las ve.
--
-- Esto les da su registro propio, con la misma mecánica del avance de las
-- órdenes —qué se hizo, foto, quién— y tres decisiones que salieron de mirar
-- cómo se mueve una unidad por el taller:
--
--   1. **El área va en el reporte, no en la unidad.** La misma compuerta pasa
--      por Maestranza, Producción y Acabados, y si el área fuera de la unidad el
--      supervisor de Acabados no podría reportar sobre lo que registró
--      Producción. Cada reporte dice de qué área es, con la misma regla de la
--      hoja de actividades: cada uno escribe en la suya (`puede_hoja_de_area`).
--   2. **Los estados son «en taller», «lista» y «salió».** No «entregada»: en
--      este sistema entregar es el acta de conformidad y la garantía corriendo,
--      y nada de eso pasa cuando el supervisor la marca desde el celular. Y
--      «lista» existe porque entre «terminé el jueves» y «el chofer la recogió
--      el lunes» la unidad no debe contar como «sin noticias».
--   3. **Registrar la unidad es armar; reportar es reportar.** Dar de alta la
--      unidad y darla por lista o salida es de los supervisores y jefes
--      (`produccion.actividades`); escribir el reporte del día es de quien
--      registra producción (`produccion.registrar`), igual que en la hoja.
--
-- El cliente es texto libre a propósito: el taller no tiene `clientes.ver`, y
-- un join a esa tabla le esconde la fila entera. Quien registra en la puerta
-- escribe el nombre como lo dice el chofer, y ese texto lo ve quien ve la flota.
-- =============================================================================

-- =============================================================================
-- 1. EL ESTADO
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'estado_flota' and n.nspname = 'public'
  ) then
    create type public.estado_flota as enum ('EN_TALLER', 'LISTA', 'SALIO');
  end if;
end $$;

comment on type public.estado_flota is
  'Dónde está una unidad sin orden: trabajándose, lista esperando al cliente, o ya salió del taller.';

-- =============================================================================
-- 2. LA UNIDAD
-- =============================================================================
create table if not exists public.flota_unidades (
  id              uuid primary key default gen_random_uuid(),
  -- Como la llama todo el mundo. No usa el dominio `placa` porque el taller la
  -- escribe como la ve en el parabrisas —con guion, sin guion, con espacio— y
  -- porque hay unidades sin placa: una tolva desmontada, una planta, un
  -- contenedor. Para comparar está `placa_clave`.
  placa           text check (placa is null or length(btrim(placa)) >= 3),
  -- La placa sin guiones ni espacios y en mayúsculas: «abc 123», «ABC-123» y
  -- «ABC123» son la misma unidad. Es lo que impide registrarla dos veces.
  placa_clave     text generated always as
                    (nullif(regexp_replace(upper(coalesce(placa, '')), '[^A-Z0-9]', '', 'g'), '')) stored,
  -- «Volquete Volvo FMX 8x4, tolva de 20 m³». Obligatoria si no hay placa.
  descripcion     text,
  -- De quién es, como lo dice el chofer. Texto: ver la cabecera.
  cliente         text,
  -- Quién la trajo: nombre y celular. Es a quien se llama cuando falta una
  -- decisión.
  trajo           text,
  -- A qué entró: «cambio de compuerta posterior y fisura en el lateral».
  trabajo         text not null check (length(btrim(trabajo)) >= 5),
  estado          public.estado_flota not null default 'EN_TALLER',
  -- Fecha y hora: la fecha sola no distingue dos ingresos el mismo día ni sirve
  -- para «cuánto lleva» en un trabajo de horas.
  ingreso         timestamptz not null default now(),
  lista_en        timestamptz,
  salio_en        timestamptz,
  salio_por       uuid references public.usuarios(id) on delete set null,
  -- Quién la retiró: nombre y documento, como lo apunta el vigilante.
  retiro          text,
  sede_id         uuid references public.sedes(id) on delete set null,
  registrado_por  uuid references public.usuarios(id) on delete set null
                  default public.usuario_actual(),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- Algo tiene que nombrarla.
  constraint ck_flota_como_se_llama
    check (placa is not null or (descripcion is not null and length(btrim(descripcion)) >= 3)),
  -- Una unidad no puede haber entrado mañana.
  constraint ck_flota_ingreso_fecha check (ingreso <= now() + interval '1 day'),
  -- El estado y sus fechas van de la mano: es lo que impide un «salió» sin
  -- fecha o una fecha de salida en una unidad que sigue adentro.
  constraint ck_flota_salio_con_fecha check ((estado = 'SALIO') = (salio_en is not null)),
  constraint ck_flota_lista_con_fecha check (estado <> 'LISTA' or lista_en is not null),
  constraint ck_flota_en_taller_sin_fechas
    check (estado <> 'EN_TALLER' or (lista_en is null and salio_en is null)),
  constraint ck_flota_salida_despues_del_ingreso check (salio_en is null or salio_en >= ingreso)
);

comment on table public.flota_unidades is
  'Unidades de flota que pasan por el taller sin orden de trabajo en el sistema. Una fila por estancia: entra, se trabaja, queda lista, sale.';
comment on column public.flota_unidades.placa is
  'Como la llama todo el mundo. Texto libre, no el dominio placa: el taller la escribe como la ve y hay unidades sin placa.';
comment on column public.flota_unidades.placa_clave is
  'La placa sin guiones ni espacios y en mayúsculas, para comparar y buscar. La calcula la base.';
comment on column public.flota_unidades.cliente is
  'De quién es, como lo dice el chofer. Texto porque el taller no tiene clientes.ver y un join le escondería la fila entera.';
comment on column public.flota_unidades.trabajo is
  'A qué entró. Es lo que después se compara con lo que se reportó.';
comment on column public.flota_unidades.retiro is
  'Quién la retiró: nombre y documento.';

-- La misma placa no está dos veces en el taller a la vez; cuando sale, puede
-- volver a entrar y queda la estancia anterior como historial.
create unique index if not exists uq_flota_placa_en_taller
  on public.flota_unidades (placa_clave)
  where placa_clave is not null and estado <> 'SALIO';

comment on index public.uq_flota_placa_en_taller is
  'Una placa no entra dos veces mientras sigue adentro. Cuando sale, puede volver.';

-- Sin índice en sede_id, registrado_por ni salio_por a propósito: son «quién
-- firmó» o catálogos acotados por los que la aplicación no filtra, y el padre
-- no se borra en ningún flujo (regla de la skill datos).

-- ---------------------------------------------------- el estado se sella
-- «Lista» y «salió» llevan su fecha y su firma, y de «salió» no se vuelve: si
-- la unidad regresa al taller es otra estancia. Lo sella la base para que no
-- dependa de la pantalla.
create or replace function public.fn_flota_cambia_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.estado = 'SALIO' then
    raise exception 'La unidad % salió del taller el %: si volvió, regístrala de nuevo.',
      coalesce(old.placa, old.descripcion), to_char(old.salio_en, 'DD/MM/YYYY');
  end if;

  -- Lo que no cambia por pantalla se copia de lo que había.
  new.ingreso        := old.ingreso;
  new.registrado_por := old.registrado_por;

  if new.estado = old.estado then
    new.lista_en := old.lista_en;
    new.salio_en := old.salio_en;
    new.salio_por := old.salio_por;
    return new;
  end if;

  if new.estado = 'LISTA' then
    new.lista_en := coalesce(new.lista_en, now());
    new.salio_en := null;
    new.salio_por := null;
  elsif new.estado = 'SALIO' then
    new.lista_en := old.lista_en;
    new.salio_en := coalesce(new.salio_en, now());
    new.salio_por := public.usuario_actual();
  else
    -- Vuelve a trabajo: se le quita el «lista».
    new.lista_en := null;
    new.salio_en := null;
    new.salio_por := null;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_flota_cambia_estado() from public, anon, authenticated;

drop trigger if exists trg_flota_cambia_estado on public.flota_unidades;
create trigger trg_flota_cambia_estado
  before update on public.flota_unidades
  for each row execute function public.fn_flota_cambia_estado();

-- =============================================================================
-- 3. EL REPORTE DEL DÍA
-- =============================================================================
create table if not exists public.flota_avances (
  id                uuid primary key default gen_random_uuid(),
  flota_id          uuid not null references public.flota_unidades(id) on delete cascade,
  -- De qué área es lo que se hizo. Decisión 1 de la cabecera.
  area_id           uuid not null references public.areas(id) on delete restrict,
  fecha             date not null default current_date,
  descripcion       text not null check (length(btrim(descripcion)) >= 5),
  -- «Más o menos lo que ven»: del 0 al 100, a ojo, sin peso ni acumulado.
  avance_porcentaje public.porcentaje,
  impedimento       text,
  registrado_por    uuid references public.usuarios(id) on delete set null
                    default public.usuario_actual(),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint ck_flota_avance_fecha check (fecha <= current_date + 1),
  -- Para que una foto no pueda colgarse de un reporte de otra unidad.
  constraint uq_flota_avance_unidad unique (id, flota_id)
);

comment on table public.flota_avances is
  'Lo que se le hizo ese día a una unidad sin orden, por área, con su foto. El porcentaje es a ojo.';
comment on column public.flota_avances.area_id is
  'El área que hizo el trabajo. La unidad pasa por varias; cada reporte dice cuál.';
comment on column public.flota_avances.avance_porcentaje is
  'Cuánto va, a ojo, del 0 al 100. No se suma ni se pondera: es la impresión de quien mira.';

-- (b): el detalle de la unidad filtra por flota_id y ordena por fecha.
create index if not exists idx_flota_avances_unidad
  on public.flota_avances (flota_id, fecha desc, creado_en desc);
-- (b): «El día en el taller» filtra por fecha.
create index if not exists idx_flota_avances_fecha
  on public.flota_avances (fecha desc);
-- Sin índice en area_id ni registrado_por: catálogo acotado y «quién firmó»,
-- la aplicación no filtra por ellos y el padre no se borra.

-- =============================================================================
-- 4. LAS FOTOS
-- -----------------------------------------------------------------------------
-- Mismo bucket que las fotos de avance de las órdenes (`fotos-avance`), con la
-- ruta flota/{unidad}/…: como no empieza por ot/, las políticas de Storage la
-- leen con `produccion.ver` y la suben con `produccion.registrar`, sin tocar
-- nada. La ruta se ata a la unidad en la tabla, para que una foto no aparezca
-- en el registro de otra.
-- =============================================================================
create table if not exists public.flota_avance_fotos (
  id             uuid primary key default gen_random_uuid(),
  avance_id      uuid not null,
  flota_id       uuid not null,
  bucket         text not null default 'fotos-avance' check (bucket = 'fotos-avance'),
  ruta_storage   text not null unique,
  nombre_archivo text not null,
  mime_type      text check (mime_type is null or mime_type like 'image/%'),
  tamano_bytes   bigint check (tamano_bytes is null or tamano_bytes > 0),
  pie            text,
  orden_visual   smallint not null default 1,
  creado_en      timestamptz not null default now(),

  constraint fk_flota_foto_de_su_reporte
    foreign key (avance_id, flota_id) references public.flota_avances(id, flota_id) on delete cascade,
  constraint ck_flota_foto_ruta check (ruta_storage like 'flota/' || flota_id::text || '/%')
);

comment on table public.flota_avance_fotos is
  'Fotos de un reporte de unidad sin orden. Viven en el bucket fotos-avance con la ruta flota/{unidad}/…, y la ruta tiene que ser de esa unidad.';

-- (b): la pantalla trae las fotos de un puñado de reportes por avance_id.
create index if not exists idx_flota_avance_fotos_avance
  on public.flota_avance_fotos (avance_id, orden_visual);

-- =============================================================================
-- 5. SOBRE QUÉ UNIDAD SE PUEDE REPORTAR
-- -----------------------------------------------------------------------------
-- Sobre la que sigue adentro. El área la decide `puede_hoja_de_area`, que ya
-- existe; esta solo dice si la unidad admite reportes. Sin security definer: la
-- lectura de flota_unidades ya la deja pasar produccion.ver, que tiene todo el
-- que puede reportar.
-- =============================================================================
create or replace function public.flota_sigue_en_taller(p_flota uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.flota_unidades f
     where f.id = p_flota and f.estado <> 'SALIO'
  );
$$;

comment on function public.flota_sigue_en_taller(uuid) is
  'Si una unidad sin orden sigue en el taller y admite reportes. Sobre la que ya salió no se escribe.';

revoke all on function public.flota_sigue_en_taller(uuid) from public, anon;
grant execute on function public.flota_sigue_en_taller(uuid) to authenticated;

-- =============================================================================
-- 6. PERMISOS Y POLÍTICAS
-- -----------------------------------------------------------------------------
-- Ningún permiso nuevo: se usan los del módulo de producción, y la acción de
-- la pantalla exige exactamente el mismo que acepta cada política:
--   · ver:             produccion.ver
--   · registrar/lista/salió la unidad: produccion.actividades  (armar)
--   · reportar el día y sus fotos:     produccion.registrar + el área propia
--   · corregir un reporte:  el propio de hoy o ayer, o produccion.cualquier_area
-- =============================================================================
alter table public.flota_unidades      enable row level security;
alter table public.flota_avances       enable row level security;
alter table public.flota_avance_fotos  enable row level security;

drop policy if exists ver_flota_unidades on public.flota_unidades;
create policy ver_flota_unidades on public.flota_unidades
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.ver'));

drop policy if exists crear_flota_unidades on public.flota_unidades;
create policy crear_flota_unidades on public.flota_unidades
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.actividades'))
    and registrado_por = public.usuario_actual()
  );

drop policy if exists editar_flota_unidades on public.flota_unidades;
create policy editar_flota_unidades on public.flota_unidades
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.actividades'))
  with check (public.es_admin() or public.tiene_permiso('produccion.actividades'));

drop policy if exists borrar_flota_unidades on public.flota_unidades;
create policy borrar_flota_unidades on public.flota_unidades
  for delete to authenticated
  using (public.es_admin());

drop policy if exists ver_flota_avances on public.flota_avances;
create policy ver_flota_avances on public.flota_avances
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.ver'));

drop policy if exists crear_flota_avances on public.flota_avances;
create policy crear_flota_avances on public.flota_avances
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and public.puede_hoja_de_area(area_id)
    and public.flota_sigue_en_taller(flota_id)
    and registrado_por = public.usuario_actual()
  );

-- Corregir lo que uno mismo escribió hoy o ayer; lo de antes ya se leyó en la
-- reunión de la mañana. El jefe corrige cualquiera, en cualquier área.
drop policy if exists editar_flota_avances on public.flota_avances;
create policy editar_flota_avances on public.flota_avances
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('produccion.cualquier_area')
    or (registrado_por = public.usuario_actual()
        and fecha >= current_date - 1
        and public.puede_hoja_de_area(area_id))
  )
  with check (
    public.es_admin()
    or public.tiene_permiso('produccion.cualquier_area')
    or (registrado_por = public.usuario_actual() and public.puede_hoja_de_area(area_id))
  );

drop policy if exists borrar_flota_avances on public.flota_avances;
create policy borrar_flota_avances on public.flota_avances
  for delete to authenticated
  using (public.es_admin());

drop policy if exists ver_flota_avance_fotos on public.flota_avance_fotos;
create policy ver_flota_avance_fotos on public.flota_avance_fotos
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.ver'));

drop policy if exists crear_flota_avance_fotos on public.flota_avance_fotos;
create policy crear_flota_avance_fotos on public.flota_avance_fotos
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and exists (
      select 1 from public.flota_avances a
       where a.id = avance_id
         and a.flota_id = flota_id
         and public.puede_hoja_de_area(a.area_id)
    )
  );

drop policy if exists editar_flota_avance_fotos on public.flota_avance_fotos;
create policy editar_flota_avance_fotos on public.flota_avance_fotos
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.cualquier_area'))
  with check (public.es_admin() or public.tiene_permiso('produccion.cualquier_area'));

drop policy if exists borrar_flota_avance_fotos on public.flota_avance_fotos;
create policy borrar_flota_avance_fotos on public.flota_avance_fotos
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.cualquier_area'));

grant select, insert, update, delete on public.flota_unidades     to authenticated;
grant select, insert, update, delete on public.flota_avances      to authenticated;
grant select, insert, update, delete on public.flota_avance_fotos to authenticated;

select public.activar_timestamps('flota_unidades');
select public.activar_timestamps('flota_avances');
select public.activar_auditoria('flota_unidades');
select public.activar_auditoria('flota_avances');

-- =============================================================================
-- 7. LO QUE VE EL TALLER
-- -----------------------------------------------------------------------------
-- Las dos vistas traen todas las unidades con su estado; la pantalla filtra
-- «en taller» en su select explícito. Sin clientes ni unidades: ver cabecera.
-- =============================================================================
create or replace view public.v_flota_unidades as
select
  f.id,
  f.placa,
  f.placa_clave,
  f.descripcion,
  f.cliente,
  f.trajo,
  f.trabajo,
  f.estado::text                    as estado,
  f.ingreso,
  -- El día de ingreso en la fecha del taller, para compararlo con las fechas
  -- planas del diario sin que la pantalla tenga que convertir zonas horarias.
  (f.ingreso at time zone 'America/Lima')::date as ingreso_fecha,
  f.lista_en,
  f.salio_en,
  f.retiro,
  f.sede_id,
  f.registrado_por,
  nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
                                    as registrado_por_nombre,
  ultimo.fecha                      as ultimo_avance_fecha,
  ultimo.descripcion                as ultimo_avance,
  ultimo.area_id                    as area_actual_id,
  ultimo.area                       as area_actual,
  ultimo.avance_porcentaje,
  -- Desde el último reporte o, si nunca hubo, desde que entró: una unidad que
  -- lleva tres días adentro y nadie escribió nada es justo la que hay que ver.
  (current_date - coalesce(ultimo.fecha, (f.ingreso at time zone 'America/Lima')::date))
                                    as dias_sin_avance,
  (current_date - (f.ingreso at time zone 'America/Lima')::date)
                                    as dias_en_taller,
  trabado.impedimento,
  coalesce(fotos.total, 0)          as fotos,
  coalesce(reportes.total, 0)       as reportes
from public.flota_unidades f
left join public.usuarios u on u.id = f.registrado_por
left join lateral (
  select a.fecha, a.descripcion, a.avance_porcentaje, a.area_id, ar.nombre as area
    from public.flota_avances a
    join public.areas ar on ar.id = a.area_id
   where a.flota_id = f.id
   order by a.fecha desc, a.creado_en desc
   limit 1
) ultimo on true
left join lateral (
  select a.impedimento
    from public.flota_avances a
   where a.flota_id = f.id and a.impedimento is not null
   order by a.fecha desc, a.creado_en desc
   limit 1
) trabado on true
left join lateral (
  select count(*)::int as total
    from public.flota_avances a
    join public.flota_avance_fotos ff on ff.avance_id = a.id
   where a.flota_id = f.id
) fotos on true
left join lateral (
  select count(*)::int as total from public.flota_avances a where a.flota_id = f.id
) reportes on true;

comment on view public.v_flota_unidades is
  'Una fila por unidad sin orden, con su estado, su área actual (la del último reporte), cuánto lleva adentro y qué la traba. Trae todas; la pantalla filtra.';

alter view public.v_flota_unidades set (security_invoker = on);
grant select on public.v_flota_unidades to authenticated;

create or replace view public.v_flota_avance_diario as
select
  a.id,
  a.flota_id,
  a.fecha,
  a.descripcion,
  a.avance_porcentaje,
  a.impedimento,
  a.creado_en,
  a.area_id,
  ar.codigo                         as area_codigo,
  ar.nombre                         as area,
  f.placa,
  f.descripcion                     as unidad,
  f.cliente,
  f.trabajo,
  f.estado::text                    as estado,
  a.registrado_por,
  nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
                                    as registrado_por_nombre,
  coalesce(fotos.total, 0)          as fotos
from public.flota_avances a
join public.flota_unidades f on f.id = a.flota_id
join public.areas ar         on ar.id = a.area_id
left join public.usuarios u  on u.id = a.registrado_por
left join lateral (
  select count(*)::int as total from public.flota_avance_fotos ff where ff.avance_id = a.id
) fotos on true;

comment on view public.v_flota_avance_diario is
  'Cada reporte de una unidad sin orden con su área, su unidad, quién lo escribió y cuántas fotos trae. Es lo que lee «El día en el taller».';

alter view public.v_flota_avance_diario set (security_invoker = on);
grant select on public.v_flota_avance_diario to authenticated;

-- =============================================================================
-- 8. COMPROBACIONES
-- =============================================================================

-- Una vista sin security_invoker corre como su dueño y se salta el RLS.
do $$
declare v_abiertas text;
begin
  select string_agg(c.relname, ', ') into v_abiertas
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and c.relname in ('v_flota_unidades', 'v_flota_avance_diario')
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%';

  if v_abiertas is not null then
    raise exception 'Estas vistas corren como su dueño y se saltan el RLS: %', v_abiertas;
  end if;
end $$;

-- Los permisos que exigen las políticas existen y alguien los tiene: sin eso la
-- puerta queda tapiada y solo el administrador pasa.
do $$
declare v_huerfanos text;
begin
  select string_agg(p.codigo, ', ') into v_huerfanos
    from (values ('produccion.ver'), ('produccion.actividades'),
                 ('produccion.registrar'), ('produccion.cualquier_area')) as p(codigo)
   where not exists (select 1 from public.roles_permisos rp where rp.permiso_codigo = p.codigo);

  if v_huerfanos is not null then
    raise exception 'Las políticas de la flota exigen permisos que nadie tiene: %', v_huerfanos;
  end if;
end $$;
