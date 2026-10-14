-- =============================================================================
-- RECURSOS HUMANOS: LOS PERMISOS DEL PERSONAL Y SU CANJE CON HORAS EXTRAS
-- -----------------------------------------------------------------------------
-- La empresa pidió (2026-10-14) un módulo de permisos en RR. HH. Hoy una
-- persona pide permiso (un trámite, el médico, un día) y queda dicho de
-- palabra; después nadie sabe cuántas horas debe:
--
--   * RR. HH. REGISTRA EL PERMISO: quién, qué día, CUÁNTAS HORAS pidió y para
--     qué. Hasta 8 horas por persona y día, la jornada; un permiso de varios
--     días se registra día por día.
--   * Después lo JUSTIFICA CON SUS HORAS EXTRAS: las que RR. HH. RESERVÓ al
--     saldo de la persona (20261014202000) pagan las horas del permiso. Ese es
--     el canje; con las tardanzas no hay canje (20261015100000). Se justifica
--     de una vez o por partes, a medida que la persona junta horas extras;
--     mientras le falten, el permiso queda «por justificar» con lo que debe.
--   * Cada justificación es un uso del saldo (`horas_compensadas`) que nombra
--     al permiso: el saldo de Horas extras baja solo y ahí se ve en qué se usó.
--     Si ese uso se anula desde Horas extras, el permiso vuelve a deber esas horas.
--   * Un permiso no se borra: se anula con motivo, y lo justificado vuelve al
--     saldo de la persona.
--
-- Lo ven RR. HH. (lo registra) y quien consulta la asistencia (Gerencia y
-- Administración). Las tablas se escriben solo por las funciones de abajo.
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permiso -------------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('rrhh.permisos', 'Recursos Humanos',
   'Registrar los permisos que pide el personal, justificarlos con sus horas extras reservadas y anularlos')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where r.codigo = 'RECURSOS_HUMANOS' and p.codigo = 'rrhh.permisos'
on conflict do nothing;

-- 2. El permiso de una persona ----------------------------------------------------------------
create table if not exists public.permisos_personal (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  -- El día del permiso.
  fecha             date not null,
  horas             numeric(4, 2) not null,
  motivo            text not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_permiso_personal check (horas > 0 and horas <= 8 and char_length(btrim(motivo)) between 10 and 300),
  constraint ck_permiso_personal_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.permisos_personal is
  'Las horas de permiso que pidió una persona en un día, que después se justifican con sus horas extras reservadas. No se borra: se anula.';
-- Los permisos de una persona en un día (b: el tope de 8 horas); sirve también a la llave.
create index if not exists ix_permisos_personal_trabajador on public.permisos_personal (trabajador_id, fecha);
-- La lista del mes, de lo más reciente a lo más viejo (b).
create index if not exists ix_permisos_personal_fecha on public.permisos_personal (fecha desc, creado_en desc);
select public.activar_timestamps('permisos_personal');
select public.activar_auditoria('permisos_personal');
select public.activar_registro_de_prueba('permisos_personal');

-- Como el tareo y las observaciones: solo se anula.
create or replace trigger trg_permiso_personal_guardia
  before update or delete on public.permisos_personal
  for each row execute function public.fn_rrhh_registro_guardia();

-- 3. La justificación es un uso del saldo que nombra al permiso -----------------------------------
alter table public.horas_compensadas
  add column if not exists permiso_id uuid references public.permisos_personal(id) on delete restrict;
comment on column public.horas_compensadas.permiso_id is
  'El permiso que justifican estas horas del saldo; vacío si se usaron en otra cosa (un descanso).';
-- Lo justificado de cada permiso se suma por aquí (b).
create index if not exists ix_horas_compensadas_permiso on public.horas_compensadas (permiso_id) where permiso_id is not null;

-- 4. Quién ve qué ------------------------------------------------------------------------------------
alter table public.permisos_personal enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'permisos_personal' and policyname = 'ver_permisos_personal') then
    create policy ver_permisos_personal on public.permisos_personal for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.permisos'))
             or (select public.tiene_permiso('asistencia.ver')));
  end if;
end $$;
revoke all on public.permisos_personal from public, anon, authenticated;
grant select on public.permisos_personal to authenticated;

-- 5. Lo que una persona tiene en su saldo de horas ------------------------------------------------------
-- Reservadas menos usadas. La llaman solo las funciones de abajo, que exigen el permiso.
create or replace function public.saldo_horas_de(p_trabajador_id uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select coalesce((select sum(x.horas) from public.horas_extras_decisiones x
                    where x.trabajador_id = p_trabajador_id and x.decision = 'RESERVAR' and x.anulado_en is null), 0)
       - coalesce((select sum(c.horas) from public.horas_compensadas c
                    where c.trabajador_id = p_trabajador_id and c.anulado_en is null), 0);
$$;
revoke all on function public.saldo_horas_de(uuid) from public, anon, authenticated;

-- «3,5 h» para los avisos.
create or replace function public.horas_en_texto(p_horas numeric)
returns text language sql immutable set search_path to 'public' as $$
  select replace(rtrim(rtrim(to_char(coalesce(p_horas, 0), 'FM990.00'), '0'), '.'), '.', ',') || ' h';
$$;
revoke all on function public.horas_en_texto(numeric) from public, anon, authenticated;

-- 6. Registrar el permiso -------------------------------------------------------------------------------
-- Un reintento con el mismo p_id devuelve el permiso ya registrado.
create or replace function public.rrhh_registrar_permiso(p_id uuid, p_trabajador_id uuid, p_fecha date, p_horas numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_horas  numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_trab   public.trabajadores%rowtype;
  v_ya     numeric;
begin
  perform public.exigir_permiso('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del permiso.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.permisos_personal where id = p_id) then return p_id; end if;
  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if not v_trab.activo then
    raise exception '% está de baja: no se le registran permisos.', v_trab.nombres || ' ' || v_trab.apellidos using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha < v_hoy - 366 or p_fecha > v_hoy + 366 then
    raise exception 'Elige el día del permiso.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 8 then
    raise exception 'Las horas de permiso van de 0,25 a 8 por día: un permiso de varios días se registra día por día.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 300 then
    raise exception 'Cuenta para qué pidió el permiso, en 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select coalesce(sum(horas), 0) into v_ya from public.permisos_personal
   where trabajador_id = p_trabajador_id and fecha = p_fecha and anulado_en is null;
  if v_ya + v_horas > 8 then
    raise exception '% ya tiene % de permiso ese día: con % más pasaría de las 8 horas de la jornada.',
      v_trab.nombres || ' ' || v_trab.apellidos, public.horas_en_texto(v_ya), public.horas_en_texto(v_horas)
      using errcode = 'check_violation';
  end if;

  insert into public.permisos_personal (id, trabajador_id, fecha, horas, motivo)
  values (p_id, p_trabajador_id, p_fecha, v_horas, v_motivo);
  return p_id;
end;
$$;
revoke all on function public.rrhh_registrar_permiso(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.rrhh_registrar_permiso(uuid, uuid, date, numeric, text) to authenticated;

-- 7. Justificarlo con las horas extras reservadas ----------------------------------------------------------
-- Sin p_horas, usa todo lo que el saldo alcanza a cubrir de lo que falta. Un
-- reintento con el mismo p_id devuelve la justificación ya hecha.
create or replace function public.rrhh_justificar_permiso(p_id uuid, p_permiso_id uuid, p_horas numeric default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_perm    public.permisos_personal%rowtype;
  v_nombre  text;
  v_hechas  numeric;
  v_falta   numeric;
  v_saldo   numeric;
  v_horas   numeric(4, 2);
begin
  perform public.exigir_permiso('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de permisos.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.horas_compensadas where id = p_id) then return p_id; end if;
  select * into v_perm from public.permisos_personal where id = p_permiso_id;
  if not found then
    raise exception 'Ese permiso no existe.' using errcode = 'check_violation';
  end if;
  if v_perm.anulado_en is not null then
    raise exception 'Ese permiso está anulado: no se justifica.' using errcode = 'check_violation';
  end if;
  select nombres || ' ' || apellidos into v_nombre from public.trabajadores where id = v_perm.trabajador_id;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_perm.trabajador_id::text, 0));
  select coalesce(sum(c.horas), 0) into v_hechas from public.horas_compensadas c
   where c.permiso_id = p_permiso_id and c.anulado_en is null;
  v_falta := v_perm.horas - v_hechas;
  if v_falta <= 0 then
    raise exception 'Ese permiso ya está justificado.' using errcode = 'check_violation';
  end if;
  v_saldo := public.saldo_horas_de(v_perm.trabajador_id);
  if v_saldo <= 0 then
    raise exception '% no tiene horas extras reservadas: resérvalas en «Horas extras» y vuelve a justificar.', v_nombre
      using errcode = 'check_violation';
  end if;

  v_horas := round(coalesce(p_horas, least(v_falta, v_saldo)), 2);
  if v_horas <= 0 then
    raise exception 'Escribe cuántas horas se justifican.' using errcode = 'check_violation';
  end if;
  if v_horas > v_falta then
    raise exception 'A ese permiso le faltan %: no se justifica más que eso.', public.horas_en_texto(v_falta) using errcode = 'check_violation';
  end if;
  if v_horas > v_saldo then
    raise exception '% tiene % reservadas: no le alcanzan para %.', v_nombre, public.horas_en_texto(v_saldo), public.horas_en_texto(v_horas)
      using errcode = 'check_violation';
  end if;

  insert into public.horas_compensadas (id, trabajador_id, fecha, horas, motivo, permiso_id)
  values (p_id, v_perm.trabajador_id, v_perm.fecha, v_horas,
          left('Permiso del ' || to_char(v_perm.fecha, 'DD/MM/YYYY') || ': ' || v_perm.motivo, 300), p_permiso_id);
  return p_id;
end;
$$;
revoke all on function public.rrhh_justificar_permiso(uuid, uuid, numeric) from public, anon;
grant execute on function public.rrhh_justificar_permiso(uuid, uuid, numeric) to authenticated;

-- 8. Anular el permiso: lo justificado vuelve al saldo ---------------------------------------------------------
create or replace function public.rrhh_anular_permiso(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_perm   public.permisos_personal%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.exigir_permiso('rrhh.permisos');
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_perm from public.permisos_personal where id = p_id for update;
  if not found then raise exception 'Ese permiso no existe.' using errcode = 'check_violation'; end if;
  if v_perm.anulado_en is not null then return p_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_perm.trabajador_id::text, 0));

  update public.horas_compensadas
     set anulado_por = public.usuario_actual(), anulado_en = now(),
         motivo_anulacion = left('Se anuló el permiso que justificaban: ' || v_motivo, 500)
   where permiso_id = p_id and anulado_en is null;
  update public.permisos_personal
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_permiso(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_permiso(uuid, text) to authenticated;

-- 9. La lista para la pantalla ------------------------------------------------------------------------------------
-- Con p_mes, los permisos de ese mes (también los anulados); sin él, los que
-- todavía deben horas, de cualquier mes. Cada uno con lo justificado, lo que
-- falta y el saldo que hoy tiene la persona. Lo calcula la base para que quien
-- solo consulta (Gerencia, Administración) vea lo mismo que RR. HH.: el uso
-- del saldo no lo pueden leer.
create or replace function public.rrhh_permisos_personal(p_mes date default null)
returns table (id uuid, trabajador_id uuid, nombre text, cargo text, activo boolean, fecha date, horas numeric,
               motivo text, justificadas numeric, por_justificar numeric, saldo numeric,
               creado_en timestamptz, anulado_en timestamptz, motivo_anulacion text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_desde date := date_trunc('month', p_mes)::date;
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.permisos') or public.tiene_permiso('asistencia.ver')) then
    raise exception 'No tiene permiso para consultar los permisos del personal.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with p as (
      select q.*, coalesce((select sum(c.horas) from public.horas_compensadas c
                             where c.permiso_id = q.id and c.anulado_en is null), 0) as hechas
        from public.permisos_personal q
       where (p_mes is null and q.anulado_en is null)
          or (p_mes is not null and q.fecha >= v_desde and q.fecha < (v_desde + interval '1 month')::date)
    )
    select p.id, p.trabajador_id, t.nombres || ' ' || t.apellidos, t.cargo, t.activo, p.fecha, p.horas, p.motivo,
           p.hechas, case when p.anulado_en is null then greatest(p.horas - p.hechas, 0) else 0 end,
           public.saldo_horas_de(p.trabajador_id), p.creado_en, p.anulado_en, p.motivo_anulacion
      from p
      join public.trabajadores t on t.id = p.trabajador_id
     where p_mes is not null or p.horas - p.hechas > 0
     order by p.fecha desc, p.creado_en desc;
end;
$$;
revoke all on function public.rrhh_permisos_personal(date) from public, anon;
grant execute on function public.rrhh_permisos_personal(date) to authenticated;
