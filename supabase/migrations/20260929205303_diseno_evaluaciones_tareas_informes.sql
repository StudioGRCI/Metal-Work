-- METAL WORK (usnbwnemfqyjjkzdizgv): evaluación del área e informe semanal de colaboradores.
-- Los nombres nominales de Diseño ya existen por OT; no se importan personas de otras empresas.

create table if not exists public.diseno_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  evaluado_nombre text not null check (length(btrim(evaluado_nombre)) between 2 and 120),
  puesto text not null check (length(btrim(puesto)) between 2 and 100),
  fecha_ingreso date,
  fecha_evaluacion date not null,
  respuestas smallint[] not null
    check (array_length(respuestas, 1) = 20
      and array_position(respuestas, null) is null
      and respuestas <@ array[1,2,3,4,5]::smallint[]),
  comentarios text not null default '' check (length(comentarios) <= 3000),
  evaluador_id uuid not null default public.usuario_actual() references public.usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists ix_diseno_evaluaciones_fecha
  on public.diseno_evaluaciones(fecha_evaluacion desc, id);
create index if not exists ix_diseno_evaluaciones_evaluador
  on public.diseno_evaluaciones(evaluador_id);
alter table public.diseno_evaluaciones enable row level security;
drop policy if exists diseno_evaluaciones_ver on public.diseno_evaluaciones;
create policy diseno_evaluaciones_ver on public.diseno_evaluaciones for select to authenticated
  using (public.tiene_permiso('diseno.planos') or public.tiene_permiso('rrhh.ver_planillas')
    or public.tiene_permiso('supervision.general'));
drop policy if exists diseno_evaluaciones_crear on public.diseno_evaluaciones;
create policy diseno_evaluaciones_crear on public.diseno_evaluaciones for insert to authenticated
  with check (public.tiene_permiso('diseno.planos') and evaluador_id = (select auth.uid()));
revoke all on public.diseno_evaluaciones from public, anon, authenticated;
grant select, insert on public.diseno_evaluaciones to authenticated;

-- La FK compuesta impide atribuir una tarea a una persona de otra OT.
create unique index if not exists ux_ot_equipo_diseno_id_orden
  on public.ot_equipo_diseno(id, orden_id);
create table if not exists public.diseno_tareas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  integrante_id uuid not null,
  tipo text not null check (tipo in ('MODELADO','PLOTEO','CREACION_PLANO','REVISION','SOPORTE','OTRA')),
  componente text not null check (length(btrim(componente)) between 2 and 200),
  fecha_inicio date not null,
  fecha_entrega date not null,
  observacion text not null default '' check (length(observacion) <= 1500),
  creado_por uuid not null default public.usuario_actual() references public.usuarios(id),
  creado_en timestamptz not null default now(),
  constraint fk_diseno_tarea_integrante_orden foreign key (integrante_id, orden_id)
    references public.ot_equipo_diseno(id, orden_id) on delete restrict,
  constraint ck_diseno_tarea_fechas check (fecha_entrega >= fecha_inicio)
);
create index if not exists ix_diseno_tareas_semana
  on public.diseno_tareas(fecha_inicio, fecha_entrega, id);
create index if not exists ix_diseno_tareas_orden on public.diseno_tareas(orden_id);
create index if not exists ix_diseno_tareas_integrante on public.diseno_tareas(integrante_id);
create index if not exists ix_diseno_tareas_autor on public.diseno_tareas(creado_por);
alter table public.diseno_tareas enable row level security;
drop policy if exists diseno_tareas_ver on public.diseno_tareas;
create policy diseno_tareas_ver on public.diseno_tareas for select to authenticated
  using ((public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
    or public.tiene_permiso('supervision.general')) and public.puede_ver_orden(orden_id));
drop policy if exists diseno_tareas_crear on public.diseno_tareas;
create policy diseno_tareas_crear on public.diseno_tareas for insert to authenticated
  with check (creado_por = (select auth.uid()) and public.puede_ver_orden(orden_id)
    and (public.tiene_permiso('diseno.planos') or
      (public.tiene_permiso('diseno.subir_pdf') and exists (
        select 1 from public.ot_equipo_diseno e where e.id=integrante_id
          and e.orden_id=diseno_tareas.orden_id and e.funcion='COLABORADOR'))));
revoke all on public.diseno_tareas from public, anon, authenticated;
grant select, insert on public.diseno_tareas to authenticated;

create table if not exists public.diseno_informes (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null unique check (extract(isodow from semana_inicio)=1),
  responsable text not null check (length(btrim(responsable)) between 2 and 120),
  resumen text not null default '' check (length(resumen) <= 4000),
  incidencias text not null default '' check (length(incidencias) <= 4000),
  acciones text not null default '' check (length(acciones) <= 4000),
  no_conformidades text not null default '' check (length(no_conformidades) <= 4000),
  indicadores text not null default '' check (length(indicadores) <= 4000),
  plan_siguiente text not null default '' check (length(plan_siguiente) <= 4000),
  conclusiones text not null default '' check (length(conclusiones) <= 4000),
  creado_por uuid not null default public.usuario_actual() references public.usuarios(id),
  actualizado_por uuid not null default public.usuario_actual() references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists ix_diseno_informes_autor on public.diseno_informes(creado_por);
create index if not exists ix_diseno_informes_editor on public.diseno_informes(actualizado_por);
select public.activar_timestamps('diseno_informes');
alter table public.diseno_informes enable row level security;
drop policy if exists diseno_informes_ver on public.diseno_informes;
create policy diseno_informes_ver on public.diseno_informes for select to authenticated
  using (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
    or public.tiene_permiso('supervision.general'));
drop policy if exists diseno_informes_crear on public.diseno_informes;
create policy diseno_informes_crear on public.diseno_informes for insert to authenticated
  with check ((public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf'))
    and creado_por = (select auth.uid()) and actualizado_por = (select auth.uid()));
drop policy if exists diseno_informes_editar on public.diseno_informes;
create policy diseno_informes_editar on public.diseno_informes for update to authenticated
  using (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf'))
  with check ((public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf'))
    and actualizado_por = (select auth.uid()));
revoke all on public.diseno_informes from public, anon, authenticated;
grant select, insert, update on public.diseno_informes to authenticated;
