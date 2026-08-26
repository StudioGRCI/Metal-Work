-- =============================================================================
-- AVANCE DIARIO CON FOTOS
-- -----------------------------------------------------------------------------
-- El parte diario dice cuántas horas puso cada quien. Eso sirve para el costo,
-- pero no para saber cómo va la unidad: el cliente que llama preguntando por su
-- volquete no quiere horas, quiere ver la tolva.
--
-- Este es el otro registro, el del avance: qué se hizo hoy en esta unidad, a
-- cuánto quedó la etapa y la foto de cómo quedó. Es lo que después arma el
-- tablero por unidad y el informe que se le manda al cliente.
-- =============================================================================

create table if not exists public.ot_avances (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- La etapa es opcional: hay avances que no caen en ninguna en particular
  -- ("se recibió la unidad", "se movió al patio de pintura").
  etapa_id          uuid references public.ot_etapas(id) on delete set null,
  fecha             date not null default current_date,
  descripcion       text not null check (length(btrim(descripcion)) >= 5),
  -- A cuánto quedó la etapa después de este trabajo. Si viene, se copia a la
  -- etapa y con ella se recalcula el avance de toda la orden.
  avance_porcentaje public.porcentaje,
  -- Lo que frena el trabajo: falta material, falta el plano, el proveedor no
  -- devolvió la pieza. Es lo que la jefatura necesita ver de un vistazo.
  impedimento       text,
  registrado_por    uuid references public.usuarios(id) on delete set null
                    default public.usuario_actual(),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Un avance no puede ser de mañana.
  constraint ck_avance_fecha check (fecha <= current_date + 1),
  -- La etapa tiene que ser de esta misma orden. Declarativo, no por trigger.
  constraint fk_avance_etapa_de_la_orden
    foreign key (etapa_id, orden_id) references public.ot_etapas(id, orden_id) on delete set null
);

comment on table public.ot_avances is
  'Lo que se hizo hoy en una unidad, con su foto. Es el registro visual del trabajo, distinto del parte diario de horas.';
comment on column public.ot_avances.avance_porcentaje is
  'A cuánto quedó la etapa. Si viene, se copia a la etapa y recalcula el avance de la orden.';
comment on column public.ot_avances.impedimento is
  'Lo que impide seguir: falta material, falta plano, falta la pieza del proveedor.';

create index if not exists idx_avances_orden on public.ot_avances(orden_id, fecha desc, creado_en desc);
create index if not exists idx_avances_etapa on public.ot_avances(etapa_id);
create index if not exists idx_avances_fecha on public.ot_avances(fecha desc);
create index if not exists idx_avances_registrado_por on public.ot_avances(registrado_por);
create index if not exists idx_avances_impedimento on public.ot_avances(orden_id)
  where impedimento is not null;

-- -------------------------------------------------------------------- fotos
-- El archivo viaja del navegador a Storage sin pasar por la aplicación; acá
-- queda solo su ubicación, igual que en el repositorio documental.
create table if not exists public.ot_avance_fotos (
  id             uuid primary key default gen_random_uuid(),
  avance_id      uuid not null references public.ot_avances(id) on delete cascade,
  bucket         text not null default 'fotos-avance' check (bucket = 'fotos-avance'),
  ruta_storage   text not null unique,
  nombre_archivo text not null,
  mime_type      text check (mime_type is null or mime_type like 'image/%'),
  tamano_bytes   bigint check (tamano_bytes is null or tamano_bytes > 0),
  pie            text,
  orden_visual   smallint not null default 1,
  creado_en      timestamptz not null default now()
);

comment on table public.ot_avance_fotos is
  'Fotos de un avance. Viven en el bucket fotos-avance con la ruta ot/{orden_id}/…, que es la que leen las políticas de Storage.';

create index if not exists idx_avance_fotos_avance on public.ot_avance_fotos(avance_id, orden_visual);

-- ------------------------------------------------- el avance mueve la etapa
-- Registrar el avance y después ir a mover la barra de la etapa a mano es pedir
-- que no se haga. Si el avance trae porcentaje, la etapa se mueve sola.
create or replace function public.fn_avance_mueve_etapa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.avance_porcentaje is not null and new.etapa_id is not null then
    update public.ot_etapas
       set avance_porcentaje = new.avance_porcentaje,
           -- Un avance en una etapa que seguía pendiente la pone en marcha.
           estado = case
                      when estado = 'PENDIENTE' and new.avance_porcentaje > 0 then 'EN_PROCESO'
                      else estado
                    end,
           fecha_inicio_real = coalesce(fecha_inicio_real, now())
     where id = new.etapa_id
       and estado not in ('TERMINADA', 'OMITIDA')
       and avance_porcentaje is distinct from new.avance_porcentaje;
  end if;

  perform public.ot_registrar_evento(
    new.orden_id,
    'AVANCE',
    left(new.descripcion, 200),
    jsonb_build_object(
      'avance',      new.avance_porcentaje,
      'impedimento', new.impedimento,
      'fecha',       new.fecha),
    new.etapa_id,
    new.registrado_por);

  return new;
end;
$$;

drop trigger if exists trg_avance_mueve_etapa on public.ot_avances;
create trigger trg_avance_mueve_etapa
  after insert on public.ot_avances
  for each row execute function public.fn_avance_mueve_etapa();

-- ------------------------------------------------------------------ la vista
-- Un avance con todo lo que hace falta para mostrarlo sin más consultas.
create or replace view public.ot_avance_resumen as
select
  a.id,
  a.orden_id,
  o.numero                      as orden_numero,
  o.estado                      as orden_estado,
  c.razon_social                as cliente,
  u.placa,
  a.etapa_id,
  e.nombre                      as etapa,
  a.fecha,
  a.descripcion,
  a.avance_porcentaje,
  a.impedimento,
  a.registrado_por,
  (p.nombres || ' ' || p.apellidos) as registrado_por_nombre,
  a.creado_en,
  coalesce(f.fotos, 0)          as fotos
from public.ot_avances a
join public.ordenes_trabajo o     on o.id = a.orden_id
join public.clientes c            on c.id = o.cliente_id
left join public.unidades u       on u.id = o.unidad_id
left join public.ot_etapas oe     on oe.id = a.etapa_id
left join public.etapas_catalogo e on e.id = oe.etapa_catalogo_id
left join public.usuarios p       on p.id = a.registrado_por
left join lateral (
  select count(*)::int as fotos from public.ot_avance_fotos ff where ff.avance_id = a.id
) f on true;

comment on view public.ot_avance_resumen is
  'Cada avance con su orden, su unidad, su etapa y cuántas fotos trae.';

-- -------------------------------------------------------- tablero por unidad
-- Una fila por unidad en el taller: en qué etapa está, cuánto lleva, cuándo se
-- tocó por última vez y si hay algo trabado. Es la pizarra de la jefatura.
create or replace view public.unidad_tablero as
select
  o.id                            as orden_id,
  o.numero                        as orden_numero,
  o.estado                        as orden_estado,
  o.prioridad,
  o.sede_id,
  o.unidad_id,
  u.placa,
  u.tipo_vehiculo,
  u.marca,
  u.modelo,
  c.id                            as cliente_id,
  c.razon_social                  as cliente,
  tc.nombre                       as tipo_carroceria,
  o.descripcion,
  o.avance_porcentaje,
  o.fecha_entrega_comprometida,
  public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida) as dias_habiles_restantes,
  (r.nombres || ' ' || r.apellidos) as responsable,
  -- La etapa donde está la unidad ahora mismo: la primera en proceso, y si no
  -- hay ninguna, la primera pendiente.
  actual.etapa                    as etapa_actual,
  actual.estado_etapa,
  actual.avance_etapa,
  -- El último avance registrado: qué se hizo y cuándo. Si hace días que no se
  -- toca, acá se ve.
  ultimo.fecha                    as ultimo_avance_fecha,
  ultimo.descripcion              as ultimo_avance,
  (current_date - ultimo.fecha)   as dias_sin_avance,
  trabado.impedimento,
  coalesce(fotos.total, 0)        as fotos
from public.ordenes_trabajo o
join public.clientes c          on c.id = o.cliente_id
left join public.unidades u     on u.id = o.unidad_id
left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
left join public.usuarios r     on r.id = o.responsable_id
left join lateral (
  select ec.nombre as etapa, oe.estado as estado_etapa, oe.avance_porcentaje as avance_etapa
    from public.ot_etapas oe
    join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
   where oe.orden_id = o.id
     and oe.estado in ('EN_PROCESO', 'PENDIENTE')
   order by (oe.estado = 'EN_PROCESO') desc, oe.orden_secuencia
   limit 1
) actual on true
left join lateral (
  select a.fecha, a.descripcion
    from public.ot_avances a
   where a.orden_id = o.id
   order by a.fecha desc, a.creado_en desc
   limit 1
) ultimo on true
left join lateral (
  select a.impedimento
    from public.ot_avances a
   where a.orden_id = o.id and a.impedimento is not null
   order by a.fecha desc, a.creado_en desc
   limit 1
) trabado on true
left join lateral (
  select count(*)::int as total
    from public.ot_avances a
    join public.ot_avance_fotos f on f.avance_id = a.id
   where a.orden_id = o.id
) fotos on true
where o.estado in ('APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD', 'TERMINADA');

comment on view public.unidad_tablero is
  'Una fila por unidad viva en el taller: dónde está, cuánto lleva, hace cuánto no se toca y qué la traba.';

-- ---------------------------------------------------------------- seguridad
alter table public.ot_avances      enable row level security;
alter table public.ot_avance_fotos enable row level security;

-- El avance se ve con la orden: el operario, solo el de las suyas.
drop policy if exists ver_ot_avances    on public.ot_avances;
drop policy if exists crear_ot_avances  on public.ot_avances;
drop policy if exists editar_ot_avances on public.ot_avances;
drop policy if exists borrar_ot_avances on public.ot_avances;

create policy ver_ot_avances on public.ot_avances
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

create policy crear_ot_avances on public.ot_avances
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id)
  );

-- Corregir lo que uno mismo escribió hoy. Lo de ayer ya se leyó en la reunión
-- de la mañana: se corrige con otro avance, no reescribiendo el anterior.
create policy editar_ot_avances on public.ot_avances
  for update to authenticated
  using (
    public.es_admin()
    or (registrado_por = public.usuario_actual() and fecha >= current_date - 1)
    or public.tiene_permiso('produccion.planificar')
  )
  with check (public.puede_ver_orden(orden_id));

create policy borrar_ot_avances on public.ot_avances
  for delete to authenticated using (public.es_admin());

drop policy if exists ver_ot_avance_fotos    on public.ot_avance_fotos;
drop policy if exists crear_ot_avance_fotos  on public.ot_avance_fotos;
drop policy if exists editar_ot_avance_fotos on public.ot_avance_fotos;
drop policy if exists borrar_ot_avance_fotos on public.ot_avance_fotos;

create policy ver_ot_avance_fotos on public.ot_avance_fotos
  for select to authenticated
  using (exists (
    select 1 from public.ot_avances a
     where a.id = avance_id and public.puede_ver_orden(a.orden_id)
  ));

create policy crear_ot_avance_fotos on public.ot_avance_fotos
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('produccion.registrar'))
    and exists (
      select 1 from public.ot_avances a
       where a.id = avance_id and public.puede_ver_orden(a.orden_id)
    )
  );

create policy editar_ot_avance_fotos on public.ot_avance_fotos
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.planificar'))
  with check (true);

create policy borrar_ot_avance_fotos on public.ot_avance_fotos
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.planificar'));

grant select, insert, update on public.ot_avances      to authenticated;
grant select, insert, update on public.ot_avance_fotos to authenticated;
grant delete on public.ot_avances, public.ot_avance_fotos to authenticated;

alter view public.ot_avance_resumen set (security_invoker = on);
alter view public.unidad_tablero    set (security_invoker = on);
grant select on public.ot_avance_resumen, public.unidad_tablero to authenticated;

select public.activar_timestamps('ot_avances');
select public.activar_auditoria('ot_avances');

-- --------------------------------------------------- quién sube la foto
-- Hasta ahora subir a Storage exigía documentos.subir, que el operario no
-- tiene. Pero la foto del avance la toma justamente él, con el celular, al pie
-- de la unidad. Se abre el bucket de fotos a quien registra producción; el
-- repositorio documental sigue como estaba.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects no existe: se omite la política de fotos';
    return;
  end if;

  execute 'drop policy if exists mw_subir_documentos on storage.objects';
  execute $pol$
    create policy mw_subir_documentos on storage.objects
      for insert to authenticated
      with check (
        (
          bucket_id = 'documentos'
          and (public.es_admin() or public.tiene_permiso('documentos.subir'))
        )
        or (
          bucket_id = 'fotos-avance'
          and (
            public.es_admin()
            or public.tiene_permiso('documentos.subir')
            or public.tiene_permiso('produccion.registrar')
          )
        )
      );
  $pol$;

  -- Y verlas: el operario tiene documentos.ver, pero el bucket de fotos no
  -- debería depender de un permiso del repositorio documental.
  execute 'drop policy if exists mw_leer_documentos on storage.objects';
  execute $pol$
    create policy mw_leer_documentos on storage.objects
      for select to authenticated
      using (
        (
          (
            bucket_id = 'documentos'
            and (public.es_admin() or public.tiene_permiso('documentos.ver'))
          )
          or (
            bucket_id = 'fotos-avance'
            and (
              public.es_admin()
              or public.tiene_permiso('documentos.ver')
              or public.tiene_permiso('produccion.ver')
            )
          )
        )
        and (
          public.orden_de_ruta(name) is null
          or public.puede_ver_orden(public.orden_de_ruta(name))
        )
      );
  $pol$;
end;
$$;
