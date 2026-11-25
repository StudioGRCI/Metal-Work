-- =============================================================================
-- RECURSOS HUMANOS ASIGNA QUIÉN LLEVA CADA ETAPA
-- -----------------------------------------------------------------------------
-- Segunda entrega del plan de tiempos de entrega que DKS aprobó el 2026-11-25
-- («que lo pases a RR. HH. para que lleve esa gestión con el personal»). La
-- primera (20261125100000) le dio a RR. HH. el tablero con el semáforo; esta le
-- deja poner a una persona del personal a cargo de cada etapa de un código, y
-- ver lo de cada persona: qué tiene, qué venció y qué está por vencer. Así,
-- cuando llegue el aviso (tercera entrega), ya se sabe a quién llamar.
--
--   * Asigna solo Recursos Humanos (decisión 3 del plan), con un permiso de
--     escritura propio, `rrhh.tiempos_entrega_asignar`: Gerencia y Gerencia de
--     Producción consultan con `rrhh.tiempos_entrega` y no asignan. Tampoco el
--     administrador del sistema (`exigir_permiso_del_puesto`, como todo lo que
--     escribe RR. HH. desde la 20261020167000).
--   * El supervisor y Diseño ven quién lleva cada etapa junto a sus etapas
--     (los mismos que ya ven las etapas, `puede_ver_codigos_de_diseno`).
--   * Una etapa lleva una persona a la vez. Cambiarla no borra a la anterior:
--     queda con quién la quitó y cuándo, como historial.
--   * Las fechas de las etapas no se tocan: las sigue poniendo Diseño.
-- =============================================================================

-- 1. El permiso ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('rrhh.tiempos_entrega_asignar', 'Recursos Humanos',
   'Asignar a la persona del personal que lleva cada etapa de un código interno. No cambia las fechas de la etapa')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'rrhh.tiempos_entrega_asignar'
  from public.roles r
 where r.codigo = 'RECURSOS_HUMANOS'
on conflict do nothing;

-- 2. La tabla -----------------------------------------------------------------------
create table if not exists public.etapa_responsables (
  id              uuid primary key default gen_random_uuid(),
  etapa_id        uuid not null references public.codigo_etapas(id) on delete restrict,
  trabajador_id   uuid not null references public.trabajadores(id) on delete restrict,
  asignado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  asignado_en     timestamptz not null default now(),
  quitado_por     uuid references public.usuarios(id) on delete restrict,
  quitado_en      timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_etapa_responsable_quitado check ((quitado_en is null) = (quitado_por is null))
);
comment on table public.etapa_responsables is
  'Quién del personal lleva cada etapa de un código interno. La asigna Recursos Humanos; una vigente por etapa, las anteriores quedan con quién y cuándo se quitaron. Migración 20261125310000.';

-- Una vigente por etapa.
create unique index if not exists uq_etapa_responsable_vigente
  on public.etapa_responsables (etapa_id) where quitado_en is null;
-- Las dos llaves llevan además un índice pleno: el parcial de arriba deja fuera
-- el historial, y la integridad no lo puede usar al borrar una etapa o una
-- persona (check 190). Cumplen (b): el detalle busca por etapa y la vista por
-- persona filtra por trabajador.
create index if not exists ix_etapa_responsables_etapa
  on public.etapa_responsables (etapa_id);
create index if not exists ix_etapa_responsables_persona
  on public.etapa_responsables (trabajador_id);

alter table public.etapa_responsables enable row level security;
revoke all on public.etapa_responsables from public, anon, authenticated;
grant select on public.etapa_responsables to authenticated;

-- Quién ve a los responsables: quien lleva o consulta los tiempos de entrega, y
-- quien ya ve las etapas de los códigos (Diseño, Gerencia, supervisores y quien sigue los códigos).
create or replace function public.puede_ver_responsables_de_etapa()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('rrhh.tiempos_entrega') or public.puede_ver_codigos_de_diseno();
$$;
revoke all on function public.puede_ver_responsables_de_etapa() from public, anon;
grant execute on function public.puede_ver_responsables_de_etapa() to authenticated;

-- Sin DROP (el conector de producción no deja pasar ninguno): se crea si falta.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'etapa_responsables'
                    and policyname = 'ver_etapa_responsables') then
    create policy ver_etapa_responsables on public.etapa_responsables for select to authenticated
      using ((select public.puede_ver_responsables_de_etapa()));
  end if;
end $$;
-- Nadie escribe directo: se asigna y se quita por las funciones de abajo, que
-- exigen el permiso. Sin grant de insert, update ni delete, y sin política.

do $$ begin
  perform public.activar_timestamps('etapa_responsables');
  perform public.activar_auditoria('etapa_responsables');
  perform public.activar_registro_de_prueba('etapa_responsables');
end $$;

-- 3. Asignar y quitar ---------------------------------------------------------------
create or replace function public.asignar_responsable_de_etapa(p_etapa uuid, p_trabajador uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_etapa public.codigo_etapas%rowtype;
  v_activo boolean;
  v_actual public.etapa_responsables%rowtype;
  v_id uuid;
begin
  perform public.exigir_permiso_del_puesto('rrhh.tiempos_entrega_asignar');
  select * into v_etapa from public.codigo_etapas where id = p_etapa for update;
  if not found or v_etapa.quitada_en is not null then
    raise exception 'Esa etapa ya no está en el código: Diseño la quitó o la cambió. Recarga la pantalla.';
  end if;
  if v_etapa.fin_real is not null then
    raise exception 'La etapa «%» ya terminó: no se le asigna a nadie.', v_etapa.nombre;
  end if;
  select t.activo into v_activo from public.trabajadores t where t.id = p_trabajador;
  if v_activo is null then
    raise exception 'No se encontró a esa persona en el personal.';
  end if;
  if not v_activo then
    raise exception 'Esa persona está de baja en el personal: elige a otra.';
  end if;

  select * into v_actual from public.etapa_responsables where etapa_id = p_etapa and quitado_en is null;
  -- La misma persona otra vez: ya está, no se toca (un reenvío no cambia la hora).
  if found and v_actual.trabajador_id = p_trabajador then
    return v_actual.id;
  end if;
  if found then
    update public.etapa_responsables
       set quitado_en = now(), quitado_por = public.usuario_actual()
     where id = v_actual.id;
  end if;
  insert into public.etapa_responsables (etapa_id, trabajador_id)
  values (p_etapa, p_trabajador)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.asignar_responsable_de_etapa(uuid, uuid) is
  'Recursos Humanos pone a una persona del personal a cargo de una etapa sin terminar; si ya había otra, la quita y queda en el historial. Exige rrhh.tiempos_entrega_asignar.';
revoke all on function public.asignar_responsable_de_etapa(uuid, uuid) from public, anon;
grant execute on function public.asignar_responsable_de_etapa(uuid, uuid) to authenticated;

create or replace function public.quitar_responsable_de_etapa(p_etapa uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso_del_puesto('rrhh.tiempos_entrega_asignar');
  update public.etapa_responsables
     set quitado_en = now(), quitado_por = public.usuario_actual()
   where etapa_id = p_etapa and quitado_en is null;
  -- Sin nadie asignado no hay nada que quitar: el resultado es el mismo.
  return true;
end;
$$;
comment on function public.quitar_responsable_de_etapa(uuid) is
  'Deja la etapa sin persona a cargo; la que estaba queda en el historial. Exige rrhh.tiempos_entrega_asignar.';
revoke all on function public.quitar_responsable_de_etapa(uuid) from public, anon;
grant execute on function public.quitar_responsable_de_etapa(uuid) to authenticated;

-- 4. Leer quién lleva cada etapa ----------------------------------------------------
-- El nombre sale de `trabajadores`, que no todos leen (el supervisor sí, Diseño
-- no): corre como dueño y exige ver los responsables. Sin DNI.
create or replace function public.responsables_de_etapas(p_codigo text default null)
returns table (etapa_id uuid, codigo text, trabajador_id uuid, nombre text, area text, asignado_en timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  if public.usuario_actual() is not null and not public.puede_ver_responsables_de_etapa() then
    raise exception 'No tienes permiso para ver quién lleva las etapas.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.etapa_id, e.codigo_interno, r.trabajador_id,
         (t.apellidos || ', ' || t.nombres)::text, a.nombre::text, r.asignado_en
    from public.etapa_responsables r
    join public.codigo_etapas e on e.id = r.etapa_id and e.quitada_en is null
    join public.trabajadores t on t.id = r.trabajador_id
    left join public.areas a on a.id = t.area_id
   where r.quitado_en is null
     and (v_codigo is null or e.codigo_interno = v_codigo)
   order by e.codigo_interno, e.orden;
end;
$$;
comment on function public.responsables_de_etapas(text) is
  'Quién lleva cada etapa vigente (de un código o de todos): la persona, su área y desde cuándo. La ven RR. HH., Gerencia, Diseño y los supervisores.';
revoke all on function public.responsables_de_etapas(text) from public, anon;
grant execute on function public.responsables_de_etapas(text) to authenticated;

-- 5. Lo de cada persona -------------------------------------------------------------
-- Cada etapa sin terminar con alguien a cargo, con su semáforo: la vista por
-- persona de RR. HH. El cálculo va aparte, sin permiso y cerrado a la gente,
-- para que la revisión diaria de los avisos (tercera entrega) lo use sin sesión.
create or replace function public.tiempos_de_entrega_por_persona_calculado()
returns table (trabajador_id uuid, nombre text, area text, codigo text, etapa_id uuid, etapa text,
               area_etapa text, fin_plan date, inicio_real date, semaforo text, dias_habiles integer)
language sql stable set search_path to 'public' as $$
  select r.trabajador_id, (t.apellidos || ', ' || t.nombres)::text, a.nombre::text,
         e.codigo, e.id, e.nombre, e.area, e.fin_plan, e.inicio_real, e.semaforo, e.dias_habiles
    from public.etapa_responsables r
    join public.tiempos_de_entrega_etapas_calculado(null) e on e.id = r.etapa_id
    join public.trabajadores t on t.id = r.trabajador_id
    left join public.areas a on a.id = t.area_id
   where r.quitado_en is null
     and e.fin_real is null
   order by t.apellidos, t.nombres, e.fin_plan nulls last, e.codigo, e.orden;
$$;
comment on function public.tiempos_de_entrega_por_persona_calculado() is
  'El cálculo de tiempos_de_entrega_por_persona, sin permiso: lo llaman el envoltorio y la revisión diaria de avisos. Cerrado a authenticated.';
revoke all on function public.tiempos_de_entrega_por_persona_calculado() from public, anon, authenticated;

create or replace function public.tiempos_de_entrega_por_persona()
returns table (trabajador_id uuid, nombre text, area text, codigo text, etapa_id uuid, etapa text,
               area_etapa text, fin_plan date, inicio_real date, semaforo text, dias_habiles integer)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_ver_tiempos_de_entrega();
  return query select * from public.tiempos_de_entrega_por_persona_calculado();
end;
$$;
comment on function public.tiempos_de_entrega_por_persona() is
  'Las etapas sin terminar de cada persona del personal, con su fecha comprometida y su semáforo. Exige rrhh.tiempos_entrega.';
revoke all on function public.tiempos_de_entrega_por_persona() from public, anon;
grant execute on function public.tiempos_de_entrega_por_persona() to authenticated;
