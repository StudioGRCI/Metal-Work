-- =============================================================================
-- GARANTÍAS: LO QUE PASA DESPUÉS DE ENTREGAR
-- -----------------------------------------------------------------------------
-- La cotización promete «GARANTIA: 01 año» y el organigrama tiene un área para
-- esto (GRT, Diego). El flujo real arranca cuando una unidad vuelve: el check
-- list de ingreso pregunta «¿garantía o mantenimiento?» y de ahí sale una
-- reparación sin costo o una cotización.
--
-- La vigencia ya existía (ot_entregas.garantia_vence, calculada); lo que no
-- existía era el reclamo: quién vino, qué reclama, si procede y con qué orden
-- se atendió. Sin eso la respuesta a «¿cuántas veces volvió esta tolva?» está
-- en la memoria de Diego, no en el sistema.
--
-- El plazo ofrecido baja de la cotización: si la entrega no dice cuántos meses,
-- se toma la garantía que se le vendió al cliente.
-- =============================================================================

-- ------------------------------------------- la garantía ofrecida se respeta
create or replace function public.fn_entrega_garantia_cotizada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.garantia_meses = 0 then
    select coalesce(c.garantia_meses, 0) into new.garantia_meses
      from public.ordenes_trabajo o
      join public.cotizaciones c on c.id = o.cotizacion_id
     where o.id = new.orden_id;
    new.garantia_meses := coalesce(new.garantia_meses, 0);
  end if;
  return new;
end;
$$;

comment on function public.fn_entrega_garantia_cotizada is
  'Si la entrega no trae meses de garantía, hereda los que la cotización le prometió al cliente.';

drop trigger if exists trg_entrega_garantia_cotizada on public.ot_entregas;
create trigger trg_entrega_garantia_cotizada
  before insert on public.ot_entregas
  for each row execute function public.fn_entrega_garantia_cotizada();

revoke all on function public.fn_entrega_garantia_cotizada() from public, anon, authenticated;

-- ------------------------------------------------------------- los reclamos
create table if not exists public.garantia_reclamos (
  id             uuid primary key default gen_random_uuid(),
  entrega_id     uuid not null references public.ot_entregas(id) on delete restrict,
  correlativo    bigint generated always as identity,
  -- lpad trunca cuando el texto excede el largo: el reclamo diez mil habría
  -- repetido el número del mil. El largo crece con el correlativo.
  numero         text generated always as
                 ('REC-' || lpad(correlativo::text, greatest(4, length(correlativo::text)), '0')) stored,
  fecha_reclamo  date not null default current_date,
  -- Quién vino a reclamar; texto libre porque suele ser el chofer.
  reportado_por  text,
  contacto       text,
  descripcion    text not null check (length(btrim(descripcion)) > 0),
  -- Se sella al registrar: si mañana cambia la fecha del sistema, el reclamo
  -- recuerda si entró dentro del plazo o no.
  dentro_de_garantia boolean not null default true,
  estado         text not null default 'RECIBIDO'
                 check (estado in ('RECIBIDO', 'EN_EVALUACION', 'PROCEDE', 'NO_PROCEDE', 'ATENDIDO')),
  evaluacion     text,
  atendido_por   uuid references public.usuarios(id) on delete set null,
  atendido_en    timestamptz,
  -- La reparación que se abrió para atenderlo, cuando procede.
  orden_reparacion_id uuid references public.ordenes_trabajo(id) on delete set null,
  creado_por     uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Un reclamo cerrado dice cómo se cerró.
  constraint ck_reclamo_cierre check (
    estado not in ('NO_PROCEDE', 'ATENDIDO') or nullif(btrim(evaluacion), '') is not null)
);

comment on table public.garantia_reclamos is
  'Reclamos de garantía sobre unidades entregadas: qué se reclama, si entró en plazo, si procede y con qué orden se atendió.';
comment on column public.garantia_reclamos.dentro_de_garantia is
  'Sellado al registrar comparando la fecha del reclamo con el vencimiento de la garantía de su entrega.';

create unique index if not exists uq_reclamos_numero on public.garantia_reclamos(numero);
create index if not exists idx_reclamos_entrega on public.garantia_reclamos(entrega_id);
create index if not exists idx_reclamos_estado on public.garantia_reclamos(estado)
  where estado not in ('NO_PROCEDE', 'ATENDIDO');
create index if not exists idx_reclamos_orden_rep on public.garantia_reclamos(orden_reparacion_id);
create index if not exists idx_reclamos_creado_por on public.garantia_reclamos(creado_por);
create index if not exists idx_reclamos_atendido_por on public.garantia_reclamos(atendido_por);

create or replace function public.fn_reclamo_antes_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vence date;
begin
  select e.garantia_vence into v_vence
    from public.ot_entregas e where e.id = new.entrega_id;

  if v_vence is null then
    raise exception 'La entrega no existe o no otorgó garantía';
  end if;

  new.dentro_de_garantia := new.fecha_reclamo <= v_vence;
  return new;
end;
$$;

comment on function public.fn_reclamo_antes_insert is
  'Sella si el reclamo entró dentro del plazo de garantía de su entrega.';

drop trigger if exists trg_reclamo_antes_insert on public.garantia_reclamos;
create trigger trg_reclamo_antes_insert
  before insert on public.garantia_reclamos
  for each row execute function public.fn_reclamo_antes_insert();

revoke all on function public.fn_reclamo_antes_insert() from public, anon, authenticated;

-- El cierre exige sello de quién y cuándo, y viceversa.
create or replace function public.fn_reclamo_antes_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estado in ('NO_PROCEDE', 'ATENDIDO') and old.estado not in ('NO_PROCEDE', 'ATENDIDO') then
    new.atendido_por := coalesce(new.atendido_por, public.usuario_actual());
    new.atendido_en  := coalesce(new.atendido_en, now());
  end if;
  -- Lo sellado al registrar no se maquilla después, y el reclamo no se muda
  -- de unidad: pertenece a la entrega contra la que se recibió.
  new.dentro_de_garantia := old.dentro_de_garantia;
  new.fecha_reclamo := old.fecha_reclamo;
  new.entrega_id := old.entrega_id;
  return new;
end;
$$;

drop trigger if exists trg_reclamo_antes_update on public.garantia_reclamos;
create trigger trg_reclamo_antes_update
  before update on public.garantia_reclamos
  for each row execute function public.fn_reclamo_antes_update();

revoke all on function public.fn_reclamo_antes_update() from public, anon, authenticated;

-- ------------------------------------------------------- el tablero del área
create or replace view public.garantias_resumen as
select
  e.id as entrega_id,
  o.id as orden_id,
  o.numero as orden,
  u.placa,
  u.marca,
  c.razon_social as cliente,
  t.nombre as carroceria,
  e.fecha_entrega,
  e.garantia_meses,
  e.garantia_vence,
  e.garantia_vence >= current_date as vigente,
  greatest(e.garantia_vence - current_date, 0) as dias_restantes,
  (select count(*) from public.garantia_reclamos r where r.entrega_id = e.id) as reclamos,
  (select count(*) from public.garantia_reclamos r
    where r.entrega_id = e.id and r.estado not in ('NO_PROCEDE', 'ATENDIDO')) as reclamos_abiertos
from public.ot_entregas e
join public.ordenes_trabajo o on o.id = e.orden_id
join public.clientes c on c.id = o.cliente_id
left join public.unidades u on u.id = o.unidad_id
left join public.tipos_carroceria t on t.id = o.tipo_carroceria_id
where e.garantia_meses > 0;

comment on view public.garantias_resumen is
  'Las unidades entregadas con garantía: cuánto les queda y cuántos reclamos cargan.';

alter view public.garantias_resumen set (security_invoker = on);
grant select on public.garantias_resumen to authenticated;

-- ---------------------------------------------------------------- permisos
insert into public.permisos (codigo, modulo, descripcion) values
  ('garantias.ver',       'garantias', 'Ver las garantías vigentes y sus reclamos'),
  ('garantias.gestionar', 'garantias', 'Registrar reclamos, evaluarlos y cerrarlos')
on conflict (codigo) do nothing;

-- Quién ve y quién gestiona, según el flujo real: Requerimientos recibe la
-- unidad, Calidad evalúa, el taller repara, Gerencia mira.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.permiso
  from public.roles r
  cross join (values ('garantias.ver')) as p(permiso)
 where r.codigo in ('GERENTE', 'JEFE_TALLER', 'SUPERVISOR', 'CALIDAD', 'VENDEDOR', 'CONSULTA')
on conflict do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.permiso
  from public.roles r
  cross join (values ('garantias.gestionar')) as p(permiso)
 where r.codigo in ('GERENTE', 'JEFE_TALLER', 'CALIDAD')
on conflict do nothing;

-- ---------------------------------------------------------------- seguridad
alter table public.garantia_reclamos enable row level security;

drop policy if exists ver_garantia_reclamos on public.garantia_reclamos;
create policy ver_garantia_reclamos on public.garantia_reclamos
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('garantias.ver'));

drop policy if exists crear_garantia_reclamos on public.garantia_reclamos;
create policy crear_garantia_reclamos on public.garantia_reclamos
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('garantias.gestionar'));

drop policy if exists editar_garantia_reclamos on public.garantia_reclamos;
create policy editar_garantia_reclamos on public.garantia_reclamos
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('garantias.gestionar'))
  with check (public.es_admin() or public.tiene_permiso('garantias.gestionar'));

drop policy if exists borrar_garantia_reclamos on public.garantia_reclamos;
create policy borrar_garantia_reclamos on public.garantia_reclamos
  for delete to authenticated using (public.es_admin());

grant select, insert, update, delete on public.garantia_reclamos to authenticated;
select public.activar_timestamps('garantia_reclamos');
select public.activar_auditoria('garantia_reclamos');
