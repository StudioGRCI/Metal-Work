-- =============================================================================
-- LA UNIDAD NO SALE: NI CON DEUDA, NI SIN CHECK LIST
-- -----------------------------------------------------------------------------
-- Las dos reglas que el flujograma de la empresa tiene escritas y que el
-- sistema recordaba pero no imponía:
--
--   1. La unidad no sale si el cliente tiene deuda. TESORERÍA confirma que el
--      cliente está al día; recién entonces Requerimientos coordina la salida.
--   2. Portería no deja salir sin CHECK LIST DE SALIDA firmado.
--
-- La primera se vuelve una liberación registrada: una fila que dice quién de
-- tesorería confirmó y cuándo, sin la cual el acta de entrega no se puede
-- registrar. La segunda se apoya en el mecanismo que ya existía: el check list
-- entra al catálogo como documento obligatorio para el cierre y con firma,
-- así que la base no deja entregar sin él —igual que con el acta y el plano—.
-- La confirmación a portería queda sellada en la propia entrega.
-- =============================================================================

-- ---------------------------------------------------------------- el permiso
insert into public.permisos (codigo, modulo, descripcion) values
  ('tesoreria.liberar', 'tesoreria', 'Confirmar que el cliente está al día y liberar la salida de su unidad')
on conflict (codigo) do nothing;

-- Tesorería vive dentro del perfil de costos; gerencia también puede liberar.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'tesoreria.liberar'
  from public.roles r
 where r.codigo in ('GERENTE', 'COSTOS')
on conflict do nothing;

-- ------------------------------------------------------------ la liberación
create table if not exists public.liberaciones_tesoreria (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null unique references public.ordenes_trabajo(id) on delete cascade,
  liberado_por   uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  liberado_en    timestamptz not null default now(),
  observacion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.liberaciones_tesoreria is
  'La confirmación de tesorería de que el cliente está al día. Sin esta fila, el acta de entrega de su orden no se puede registrar.';

create index if not exists idx_liberaciones_liberado_por on public.liberaciones_tesoreria(liberado_por);

alter table public.liberaciones_tesoreria enable row level security;

drop policy if exists ver_liberaciones on public.liberaciones_tesoreria;
create policy ver_liberaciones on public.liberaciones_tesoreria
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_liberaciones on public.liberaciones_tesoreria;
create policy crear_liberaciones on public.liberaciones_tesoreria
  for insert to authenticated
  with check (
    (public.es_admin() or public.tiene_permiso('tesoreria.liberar'))
    and liberado_por = public.usuario_actual());

-- Revocar una liberación es quitar la fila: cosa de gerencia.
drop policy if exists borrar_liberaciones on public.liberaciones_tesoreria;
create policy borrar_liberaciones on public.liberaciones_tesoreria
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('tesoreria.liberar'));

grant select, insert, delete on public.liberaciones_tesoreria to authenticated;
select public.activar_timestamps('liberaciones_tesoreria');
select public.activar_auditoria('liberaciones_tesoreria');

-- ------------------------------------------- la entrega exige la liberación
create or replace function public.fn_entrega_exige_liberacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.liberaciones_tesoreria l where l.orden_id = new.orden_id
  ) then
    raise exception
      'La unidad no puede salir: tesorería todavía no confirma que el cliente esté al día. Pide la liberación de la orden.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.fn_entrega_exige_liberacion is
  'La regla escrita del flujo: la unidad no sale si el cliente tiene deuda. Tesorería libera; recién entonces se entrega.';

drop trigger if exists trg_entrega_exige_liberacion on public.ot_entregas;
create trigger trg_entrega_exige_liberacion
  before insert on public.ot_entregas
  for each row execute function public.fn_entrega_exige_liberacion();

revoke all on function public.fn_entrega_exige_liberacion() from public, anon, authenticated;

-- ------------------------------------------------- el check list de salida
-- Entra al catálogo como obligatorio y con firma: la base ya sabe qué hacer
-- con eso —sin documento vigente y firmado de este tipo, la OT no se entrega—.
insert into public.tipos_documento
  (codigo, nombre, descripcion, categoria, entidad_tabla,
   requiere_aprobacion, obligatorio_para_cierre, orden_visualizacion)
values
  ('CHECKLIST_SALIDA', 'Check list de salida',
   'El formato con el que Requerimientos revisa la unidad antes de que cruce portería. Sin él, portería no deja salir.',
   'LOGISTICO', 'ordenes_trabajo', true, true, 95)
on conflict (codigo) do update
  set requiere_aprobacion = excluded.requiere_aprobacion,
      obligatorio_para_cierre = excluded.obligatorio_para_cierre;

-- --------------------------------------------- la confirmación a portería
alter table public.ot_entregas
  add column if not exists salida_confirmada_por uuid references public.usuarios(id) on delete set null,
  add column if not exists salida_confirmada_en  timestamptz;

comment on column public.ot_entregas.salida_confirmada_por is
  'Quien avisó a portería que la unidad puede cruzar. Es el último sello del flujo.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_entrega_salida_completa') then
    alter table public.ot_entregas
      add constraint ck_entrega_salida_completa check (
        (salida_confirmada_por is null) = (salida_confirmada_en is null));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- La revisión encontró dos cosas en la confirmación a portería: quien solo
-- tiene requerimientos.crear pasaba el chequeo de la aplicación pero la
-- política de la tabla lo dejaba en cero filas —éxito aparente sin efecto—,
-- y una confirmación ya sellada podía resellarse encima. La función cierra
-- las dos: exige el permiso del flujo, escribe como dueña solo estas dos
-- columnas, y a la segunda confirmación responde con un error honesto.
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_salida_porteria(p_entrega uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden uuid;
  v_confirmada timestamptz;
begin
  if not (public.es_admin()
          or public.tiene_permiso('ordenes.entregar')
          or public.tiene_permiso('requerimientos.crear')) then
    raise exception 'Confirmar la salida es de quien coordina la entrega'
      using errcode = 'insufficient_privilege';
  end if;

  select orden_id, salida_confirmada_en into v_orden, v_confirmada
    from public.ot_entregas where id = p_entrega;

  if v_orden is null then
    raise exception 'El acta de entrega no existe';
  end if;
  if not public.puede_ver_orden(v_orden) then
    raise exception 'La orden no le corresponde' using errcode = 'insufficient_privilege';
  end if;
  if v_confirmada is not null then
    raise exception 'La salida ya estaba confirmada; no se confirma dos veces';
  end if;

  update public.ot_entregas
     set salida_confirmada_por = public.usuario_actual(),
         salida_confirmada_en  = now()
   where id = p_entrega;
end;
$$;

comment on function public.confirmar_salida_porteria(uuid) is
  'El aviso final a portería: una sola vez, con quién y cuándo, por quien coordina la entrega.';

revoke all on function public.confirmar_salida_porteria(uuid) from public, anon;
grant execute on function public.confirmar_salida_porteria(uuid) to authenticated;
