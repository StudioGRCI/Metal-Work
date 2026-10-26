-- =============================================================================
-- LAS TARDANZAS Y LOS PERMISOS SE RESTAN DEL PAGO
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-26, al revisar el manual de Recursos Humanos. Del
-- descuento por tardanzas: «tiene que restarse del sueldo final del trabajador
-- pues es un 5 % de su sueldo». Del permiso que nunca se justifica: «debe haber
-- opciones de reportar o generar descuento; igualmente los permisos se
-- descuentan o justifican con horas extras».
--
-- 1. LAS TARDANZAS SE RESTAN SOLAS. Cada tres tardanzas del mes (la regla de
--    `rrhh_regla_tardanza`) son el 5 % de la remuneración mensual. Hasta hoy
--    Tardanzas lo calculaba y nadie lo restaba. Desde octubre de 2026 se resta
--    del pago de la persona:
--      · a la gente de taller, en la planilla diaria que se envía a Tesorería;
--      · a la oficina, en su pago (Pagos de la oficina): RR. HH. escribe el
--        sueldo del tramo y la base le resta lo que hay por descontar.
--    Lo que se debe de cada mes sale de las marcas vigentes, contadas hasta
--    hoy; lo ya restado queda anotado en `descuentos_del_pago` con la planilla
--    o el pago que lo restó. Si después se anula una marca, la planilla o el
--    pago, la diferencia entra en el siguiente pago: se devuelve lo restado de
--    más o se resta lo que falta. Un descuento nunca deja un pago en negativo:
--    lo que no alcanza queda para el siguiente.
--
-- 2. EL PERMISO SIN JUSTIFICAR SE DESCUENTA O SE REPORTA. RR. HH. elige:
--      · «Descontar»: las horas que faltan justificar se descuentan. En taller
--        no se pagan (la planilla diaria paga solo las horas del reporte; si el
--        reporte de ese día también trae las del permiso, se restan); en la
--        oficina se restan de su próximo pago, a la hora de su remuneración
--        entre 240.
--      · «Reportar»: queda una observación con el motivo «Permiso sin
--        justificar» en las observaciones de la persona, y Gerencia y
--        Administración reciben el aviso.
--    Y el permiso JUSTIFICADO con horas extras reservadas SE PAGA: en taller,
--    la planilla diaria paga esas horas a la hora ordinaria, porque las extras
--    reservadas no se pagaron cuando se trabajaron. En la oficina no cambia
--    nada: su sueldo ya cubre ese día.
--
-- 3. RR. HH. VE EL RECARGO DE LAS HORAS EXTRAS en Costeo por código: lo que la
--    planilla diaria pagó de más por cada hora extra, repartido entre los
--    códigos que la persona trabajó ese día. Hasta hoy solo salía en el costeo
--    del código, que ve Gerencia.
--
-- Lo de antes de octubre de 2026 no se toca: ya se pagó como se pagó.
-- =============================================================================

-- 0. Ayudantes ---------------------------------------------------------------------------------
create or replace function public.rrhh_descuentos_desde()
returns date language sql immutable set search_path to 'public' as $$
  select date '2026-10-01'
$$;
comment on function public.rrhh_descuentos_desde() is
  'Desde qué día las tardanzas y los permisos se restan del pago (migración 20261026100000): lo de antes ya se pagó como se pagó.';
revoke all on function public.rrhh_descuentos_desde() from public, anon, authenticated;

-- «octubre de 2026», con «setiembre» como se escribe en el Perú.
create or replace function public.mes_en_texto(p_mes date)
returns text language sql immutable set search_path to 'public' as $$
  select (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre',
                'noviembre', 'diciembre'])[extract(month from p_mes)::int]
         || ' de ' || extract(year from p_mes)::int::text
$$;
revoke all on function public.mes_en_texto(date) from public, anon, authenticated;

-- 1. El permiso reportado es una observación ----------------------------------------------------
alter table public.observaciones_personal drop constraint if exists ck_observacion_motivo;
alter table public.observaciones_personal add constraint ck_observacion_motivo check (
  motivo in ('TARDANZAS', 'FALTA_INJUSTIFICADA', 'PERMISO_SIN_JUSTIFICAR', 'EPP', 'SEGURIDAD', 'CALIDAD', 'CONDUCTA', 'OTRO'));
alter table public.observaciones_personal
  add column if not exists permiso_id uuid references public.permisos_personal(id) on delete restrict;
comment on column public.observaciones_personal.permiso_id is
  'El permiso sin justificar que esta observación reporta (rrhh_reportar_permiso); vacío en las demás.';
-- Si un permiso ya se reportó, y qué se anula con él (b).
create index if not exists ix_observaciones_personal_permiso on public.observaciones_personal (permiso_id) where permiso_id is not null;

-- 2. Las horas de un permiso que se descuentan ------------------------------------------------------
create table if not exists public.permisos_descontados (
  id                uuid primary key default gen_random_uuid(),
  permiso_id        uuid not null references public.permisos_personal(id) on delete restrict,
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  -- El día del permiso.
  fecha             date not null,
  horas             numeric(4, 2) not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_permiso_descontado check (horas > 0 and horas <= 8),
  constraint ck_permiso_descontado_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.permisos_descontados is
  'Las horas de un permiso que RR. HH. decidió descontar en vez de justificar. En taller no se pagan; en la oficina se restan de su próximo pago. No se borra: se anula con el permiso.';
-- Lo descontado de cada permiso (b; es también su llave). La llave del
-- trabajador: el cálculo va por permiso, ni (a) ni (b) ni (c).
create index if not exists ix_permisos_descontados_permiso on public.permisos_descontados (permiso_id);
select public.activar_timestamps('permisos_descontados');
select public.activar_auditoria('permisos_descontados');
select public.activar_registro_de_prueba('permisos_descontados');
create or replace trigger trg_permiso_descontado_guardia
  before update or delete on public.permisos_descontados
  for each row execute function public.fn_rrhh_registro_guardia();

alter table public.permisos_descontados enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'permisos_descontados' and policyname = 'ver_permisos_descontados') then
    create policy ver_permisos_descontados on public.permisos_descontados for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.permisos'))
             or (select public.tiene_permiso('asistencia.ver')));
  end if;
end $$;
revoke all on public.permisos_descontados from public, anon, authenticated;
grant select on public.permisos_descontados to authenticated;

-- 3. Lo que cada pago restó o devolvió -------------------------------------------------------------
create table if not exists public.descuentos_del_pago (
  id                   uuid primary key default gen_random_uuid(),
  trabajador_id        uuid not null references public.trabajadores(id) on delete restrict,
  concepto             text not null,
  -- TARDANZAS: el primer día del mes de las tardanzas. PERMISO: el día del permiso.
  fecha                date not null,
  -- PERMISO: las horas que este monto descuenta (negativas si las devuelve).
  horas                numeric(6, 2),
  -- TARDANZAS: cuántas había en el mes y qué porcentaje tocaba al restarlo.
  tardanzas            smallint,
  porcentaje           numeric(5, 2),
  -- La remuneración con que se calculó: la primera vez se congela.
  base                 numeric(10, 2) not null,
  -- Positivo se resta del pago; negativo se le devuelve.
  monto                numeric(12, 2) not null,
  detalle              text not null,
  planilla_persona_id  uuid references public.planilla_diaria_personas(id) on delete restrict,
  oficina_pago_id      uuid references public.oficina_pagos(id) on delete restrict,
  registrado_por       uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint ck_descuento_del_pago check (
    concepto in ('TARDANZAS', 'PERMISO') and monto <> 0 and base > 0
    and char_length(btrim(detalle)) between 5 and 300
    and (planilla_persona_id is null) <> (oficina_pago_id is null)
    and (concepto <> 'TARDANZAS' or fecha = date_trunc('month', fecha)::date))
);
comment on table public.descuentos_del_pago is
  'Lo que la planilla diaria (gente de taller) o un pago de la oficina restó por tardanzas o por un permiso descontado, o devolvió. Vale mientras su planilla o su pago no esté anulado. No se cambia ni se borra.';
-- Lo ya restado de cada persona por mes o por día (b; sirve también a la llave
-- del trabajador). Lo restado en cada planilla y en cada pago (b, la pantalla de
-- cada uno, y son sus llaves).
create index if not exists ix_descuentos_del_pago_trabajador on public.descuentos_del_pago (trabajador_id, concepto, fecha);
create index if not exists ix_descuentos_del_pago_planilla on public.descuentos_del_pago (planilla_persona_id) where planilla_persona_id is not null;
create index if not exists ix_descuentos_del_pago_oficina on public.descuentos_del_pago (oficina_pago_id) where oficina_pago_id is not null;
select public.activar_timestamps('descuentos_del_pago');
-- Sin activar_auditoria: la base es la remuneración, y audit_log lo leen puestos
-- que no la ven (Gerencia, con auditoria.ver). La fila no cambia nunca y dice
-- quién la anotó y cuándo.
select public.activar_registro_de_prueba('descuentos_del_pago');

create or replace function public.fn_descuento_del_pago_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Lo que un pago restó no se cambia ni se borra: anula la planilla o el pago y vuelve a hacerlo.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_descuento_del_pago_guardia() from public, anon, authenticated;
create or replace trigger trg_descuento_del_pago_guardia
  before update or delete on public.descuentos_del_pago
  for each row execute function public.fn_descuento_del_pago_guardia();

-- Lo de la planilla diaria lo ve quien ve la planilla (su detalle ya dice la
-- hora de cada persona); lo de la oficina, quien ve sus pagos.
alter table public.descuentos_del_pago enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'descuentos_del_pago' and policyname = 'ver_descuentos_del_pago') then
    create policy ver_descuentos_del_pago on public.descuentos_del_pago for select to authenticated
      using ((select public.es_admin())
             or (planilla_persona_id is not null and (select public.puede_ver_planilla_diaria()))
             or (oficina_pago_id is not null and (select public.tiene_permiso('rrhh.personal'))));
  end if;
end $$;
revoke all on public.descuentos_del_pago from public, anon, authenticated;
grant select on public.descuentos_del_pago to authenticated;

-- 4. La planilla diaria paga el permiso justificado y resta los descuentos ---------------------------
alter table public.planilla_diaria_personas
  add column if not exists horas_permiso numeric(6, 2) not null default 0,
  add column if not exists monto_permiso numeric(12, 2) not null default 0,
  add column if not exists monto_descuentos numeric(12, 2) not null default 0;
comment on column public.planilla_diaria_personas.horas_permiso is
  'Las horas de permiso justificadas con horas extras reservadas que esta planilla paga, a la hora ordinaria.';
comment on column public.planilla_diaria_personas.monto_descuentos is
  'Lo que se le restó por tardanzas o permisos descontados, menos lo que se le devolvió (descuentos_del_pago). El total ya lo trae restado.';
alter table public.planilla_diaria_personas drop constraint if exists ck_planilla_diaria_persona;
alter table public.planilla_diaria_personas add constraint ck_planilla_diaria_persona check (
  horas_ordinarias >= 0 and horas_extras >= 0 and horas_permiso >= 0
  and horas_ordinarias + horas_extras + horas_permiso > 0
  and monto_ordinarias >= 0 and monto_extras >= 0 and monto_permiso >= 0
  and total >= 0 and total = monto_ordinarias + monto_extras + monto_permiso - monto_descuentos);

alter table public.planilla_diaria_detalle drop constraint if exists ck_planilla_diaria_detalle;
alter table public.planilla_diaria_detalle add constraint ck_planilla_diaria_detalle check (
  concepto in ('ORDINARIAS', 'EXTRAS', 'PERMISO') and horas > 0 and horas <= 16 and valor_hora >= 0 and monto >= 0
  and ((concepto in ('ORDINARIAS', 'PERMISO') and decision_id is null and horas_tramo1 = 0 and horas_tramo2 = 0)
       or (concepto = 'EXTRAS' and decision_id is not null and horas_tramo1 + horas_tramo2 = horas)));

-- 5. Los cálculos ----------------------------------------------------------------------------------------
-- Lo restado que vale: el de una planilla o un pago sin anular.
create or replace function public.descuentos_vigentes()
returns setof public.descuentos_del_pago
language sql stable set search_path to 'public' as $$
  select d.*
    from public.descuentos_del_pago d
   where (d.planilla_persona_id is not null
          and exists (select 1 from public.planilla_diaria_personas pp
                        join public.planillas_diarias p on p.id = pp.planilla_id
                       where pp.id = d.planilla_persona_id and p.anulado_en is null))
      or (d.oficina_pago_id is not null
          and exists (select 1 from public.oficina_pagos o where o.id = d.oficina_pago_id and o.anulado_en is null))
$$;
comment on function public.descuentos_vigentes() is
  'Lo que la planilla diaria o los pagos de la oficina restaron o devolvieron, sin lo de una planilla o un pago anulado. No pide permiso: la llaman los cálculos de abajo.';
revoke all on function public.descuentos_vigentes() from public, anon, authenticated;

-- Cada día con permiso de cada persona, desde octubre de 2026 y hasta hoy:
--   P = horas de permiso, J = justificadas, D = descontadas,
--   R = horas ordinarias del reporte validado (hasta 8), y solape = R + P − 8
--   (las horas que el reporte trae de más, si el supervisor también puso las
--   del permiso).
-- En taller la planilla paga del permiso lo justificado que el reporte no trae
-- (J − solape), y descuenta lo descontado que el reporte sí trae (hasta
-- solape − J), más lo que se haya pagado del permiso de más. En la oficina no
-- se paga nada aparte y se descuenta D. También salen los días que ya no
-- tienen permiso pero sí algo pagado o restado: así una anulación se corrige.
create or replace function public.permisos_por_dia()
returns table (trabajador_id uuid, fecha date, taller boolean, horas_permiso numeric, justificadas numeric, descontadas numeric,
               ordinarias numeric, pagadas numeric, a_pagar numeric, por_pagar numeric, a_descontar numeric)
language sql stable set search_path to 'public' as $$
  with lim as (
    select public.rrhh_descuentos_desde() as desde, (now() at time zone 'America/Lima')::date as hoy
  ), perm as (
    select q.trabajador_id, q.fecha, sum(q.horas) as horas,
           sum(coalesce((select sum(c.horas) from public.horas_compensadas c
                          where c.permiso_id = q.id and c.anulado_en is null), 0)) as justificadas,
           sum(coalesce((select sum(x.horas) from public.permisos_descontados x
                          where x.permiso_id = q.id and x.anulado_en is null), 0)) as descontadas
      from public.permisos_personal q
      cross join lim
     where q.anulado_en is null and q.fecha >= lim.desde and q.fecha <= lim.hoy
     group by q.trabajador_id, q.fecha
  ), pagado as (
    select d.trabajador_id, d.fecha, sum(d.horas) as horas
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'PERMISO' and p.anulado_en is null
     group by d.trabajador_id, d.fecha
  ), dia as (
    select x.trabajador_id, x.fecha from perm x
    union
    select g.trabajador_id, g.fecha from pagado g
    union
    select v.trabajador_id, v.fecha from public.descuentos_vigentes() v where v.concepto = 'PERMISO'
  ), jornada as (
    select j.trabajador_id, j.fecha, j.ordinarias
      from public.jornadas_validadas() j
     where exists (select 1 from dia d where d.trabajador_id = j.trabajador_id and d.fecha = j.fecha)
  ), base as (
    select d.trabajador_id, d.fecha, w.planilla = 'TALLER' as taller,
           coalesce(x.horas, 0) as horas_permiso, coalesce(x.justificadas, 0) as justificadas,
           coalesce(x.descontadas, 0) as descontadas, coalesce(j.ordinarias, 0) as ordinarias,
           coalesce(g.horas, 0) as pagadas
      from dia d
      join public.trabajadores w on w.id = d.trabajador_id
      left join perm x on x.trabajador_id = d.trabajador_id and x.fecha = d.fecha
      left join pagado g on g.trabajador_id = d.trabajador_id and g.fecha = d.fecha
      left join jornada j on j.trabajador_id = d.trabajador_id and j.fecha = d.fecha
  ), cuenta as (
    select b.*, greatest(b.ordinarias + b.horas_permiso - 8, 0) as solape,
           case when b.taller then greatest(b.justificadas - greatest(b.ordinarias + b.horas_permiso - 8, 0), 0) else 0 end as a_pagar
      from base b
  )
  select c.trabajador_id, c.fecha, c.taller, c.horas_permiso, c.justificadas, c.descontadas, c.ordinarias, c.pagadas,
         c.a_pagar, greatest(c.a_pagar - c.pagadas, 0),
         case when c.taller
              then greatest(least(c.descontadas, c.solape - c.justificadas), 0) + greatest(c.pagadas - c.a_pagar, 0)
              else c.descontadas end
    from cuenta c
$$;
comment on function public.permisos_por_dia() is
  'Por persona y día con permiso (desde rrhh_descuentos_desde() y hasta hoy): horas de permiso, justificadas y descontadas, horas ordinarias validadas, horas de permiso ya pagadas, lo que la planilla diaria tiene que pagar (a_pagar, por_pagar) y las horas que se descuentan en dinero (a_descontar). No pide permiso.';
revoke all on function public.permisos_por_dia() from public, anon, authenticated;

-- Lo que falta restar (positivo) o devolver (negativo) a cada persona, hasta
-- p_hasta (hoy, si va vacío): las tardanzas de cada mes hasta el de p_hasta y
-- los permisos descontados de cada día hasta p_hasta.
create or replace function public.descuentos_pendientes(p_hasta date default null)
returns table (trabajador_id uuid, concepto text, fecha date, horas numeric, tardanzas integer, porcentaje numeric,
               base numeric, monto numeric, detalle text)
language sql stable set search_path to 'public' as $$
  with lim as (
    select public.rrhh_descuentos_desde() as desde,
           (now() at time zone 'America/Lima')::date as hoy,
           least(coalesce(p_hasta, (now() at time zone 'America/Lima')::date), (now() at time zone 'America/Lima')::date) as hasta
  ), regla as (
    select greatest(coalesce((select g.tardanzas_por_descuento from public.rrhh_regla_tardanza g where g.id), 3), 1)::int as por,
           coalesce((select g.porcentaje_descuento from public.rrhh_regla_tardanza g where g.id), 5)::numeric as pct
  ), aplicado as (
    select v.trabajador_id, v.concepto, v.fecha, sum(v.monto) as monto, sum(coalesce(v.horas, 0)) as horas,
           (array_agg(v.base order by v.creado_en, v.id))[1] as base
      from public.descuentos_vigentes() v
     group by v.trabajador_id, v.concepto, v.fecha
  ), marcas as (
    -- Las tardanzas de cada mes se cuentan hasta hoy aunque el pago cubra menos
    -- días: un pago de la primera quincena registrado tarde no devuelve lo que
    -- otro pago ya restó por las del mes entero.
    select a.trabajador_id, date_trunc('month', a.fecha)::date as mes, (count(*) filter (where a.es_tardanza))::int as veces
      from public.asistencias a
      cross join lim
     where a.tipo = 'INGRESO' and a.anulado_en is null
       and a.fecha >= lim.desde and a.fecha <= lim.hoy
       and a.fecha < (date_trunc('month', lim.hasta) + interval '1 month')::date
     group by a.trabajador_id, date_trunc('month', a.fecha)
  ), mes as (
    select coalesce(m.trabajador_id, ap.trabajador_id) as trabajador_id, coalesce(m.mes, ap.fecha) as mes,
           coalesce(m.veces, 0) as veces, coalesce(ap.monto, 0) as aplicado, ap.base as base_aplicada
      from marcas m
      full join (select x.* from aplicado x cross join lim where x.concepto = 'TARDANZAS' and x.fecha <= lim.hasta) ap
        on ap.trabajador_id = m.trabajador_id and ap.fecha = m.mes
  ), tardanza as (
    select t.trabajador_id, t.mes, t.veces, least((t.veces / r.por) * r.pct, 100) as pct,
           coalesce(t.base_aplicada, w.remuneracion_mensual) as base, t.aplicado
      from mes t
      cross join regla r
      left join public.trabajador_remuneraciones w on w.trabajador_id = t.trabajador_id
  ), tardanza_monto as (
    select t.*, round(t.base * t.pct / 100, 2) - t.aplicado as falta from tardanza t where t.base is not null
  ), permiso as (
    select x.trabajador_id, x.fecha, x.taller, x.a_descontar, coalesce(ap.base, w.remuneracion_mensual) as base,
           coalesce(ap.monto, 0) as aplicado, coalesce(ap.horas, 0) as horas_aplicadas
      from public.permisos_por_dia() x
      cross join lim
      left join aplicado ap on ap.trabajador_id = x.trabajador_id and ap.concepto = 'PERMISO' and ap.fecha = x.fecha
      left join public.trabajador_remuneraciones w on w.trabajador_id = x.trabajador_id
     where x.fecha <= lim.hasta
  ), permiso_monto as (
    select p.*, round(p.a_descontar * round(p.base / 240, 4), 2) - p.aplicado as falta from permiso p where p.base is not null
  )
  select t.trabajador_id, 'TARDANZAS'::text, t.mes, null::numeric, t.veces, t.pct, t.base, t.falta,
         case when t.falta > 0
              then t.veces || case when t.veces = 1 then ' tardanza' else ' tardanzas' end || ' en ' || public.mes_en_texto(t.mes)
                   || ': ' || rtrim(rtrim(to_char(t.pct, 'FM990.00'), '0'), '.') || ' % de la remuneración'
                   || case when t.aplicado > 0 then ' (ya se restaron S/ ' || to_char(t.aplicado, 'FM999G999G990D00') || ')' else '' end
              else 'Se devuelve lo restado de más por las tardanzas de ' || public.mes_en_texto(t.mes) || ': ahora son ' || t.veces
         end
    from tardanza_monto t
   where t.falta <> 0
  union all
  select p.trabajador_id, 'PERMISO'::text, p.fecha, p.a_descontar - p.horas_aplicadas, null::integer, null::numeric, p.base, p.falta,
         case when p.falta > 0
              then 'Permiso del ' || to_char(p.fecha, 'DD/MM/YYYY') || ': ' || public.horas_en_texto(p.a_descontar - p.horas_aplicadas)
                   || case when p.taller then ' que se pagaron y no se trabajaron' else ' sin justificar' end
              else 'Se devuelve lo descontado por el permiso del ' || to_char(p.fecha, 'DD/MM/YYYY')
         end
    from permiso_monto p
   where p.falta <> 0
$$;
comment on function public.descuentos_pendientes(date) is
  'Lo que falta restar (monto positivo) o devolver (negativo) a cada persona por tardanzas (por mes, el 5 % de la regla por cada tres) y por permisos descontados (por día, a la remuneración entre 240), hasta p_hasta. La base es la remuneración de la primera vez que se restó, o la de hoy. No pide permiso.';
revoke all on function public.descuentos_pendientes(date) from public, anon, authenticated;

-- 6. Lo que falta pagar en la planilla diaria: también el permiso justificado ------------------------------
create or replace function public.planilla_diaria_pendiente()
returns table (trabajador_id uuid, fecha date, concepto text, horas numeric, horas_tramo1 numeric, horas_tramo2 numeric, decision_id uuid)
language sql stable set search_path to 'public' as $$
  select j.trabajador_id, j.fecha, 'ORDINARIAS', j.ordinarias - j.ordinarias_en_planilla, 0::numeric, 0::numeric, null::uuid
    from public.jornadas_validadas() j
   where j.ordinarias - j.ordinarias_en_planilla > 0
  union all
  select x.trabajador_id, x.fecha, 'EXTRAS', x.horas, x.horas_tramo1, x.horas_tramo2, x.id
    from public.horas_extras_decisiones x
   where x.decision = 'PAGAR' and x.anulado_en is null
     and not exists (select 1 from public.planilla_diaria_detalle d
                       join public.planilla_diaria_personas pp on pp.id = d.persona_id
                       join public.planillas_diarias p on p.id = pp.planilla_id
                      where d.decision_id = x.id and p.anulado_en is null)
  union all
  -- Las horas de permiso justificadas con extras reservadas, a la hora ordinaria.
  select x.trabajador_id, x.fecha, 'PERMISO', x.por_pagar, 0::numeric, 0::numeric, null::uuid
    from public.permisos_por_dia() x
   where x.por_pagar > 0;
$$;

-- 7. Enviar la planilla diaria: paga el permiso y resta los descuentos -----------------------------------------
-- La misma función de la 20261014202000 (con el permiso del puesto de la
-- 20261020167000), con dos cosas más por persona: las horas de permiso
-- justificadas y lo que hay por descontar. Lo que se devuelve entra siempre;
-- lo que se resta, hasta lo que la persona cobra en esta planilla: lo que no
-- alcanza queda para la siguiente.
create or replace function public.enviar_planilla_diaria(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo        uuid := public.usuario_actual();
  v_hoy       date := (now() at time zone 'America/Lima')::date;
  v_regla     public.rrhh_regla_horas_extras%rowtype;
  v_pend      jsonb;
  v_desc      jsonb;
  v_personas  jsonb := '[]'::jsonb;
  v_aplicados jsonb;
  v_persona   record;
  v_p         jsonb;
  v_linea     jsonb;
  v_d         jsonb;
  v_pid       uuid;
  v_hora      numeric(10, 4);
  v_horas     numeric;
  v_ord_h     numeric;
  v_ext_h     numeric;
  v_per_h     numeric;
  v_ord_m     numeric;
  v_ext_m     numeric;
  v_per_m     numeric;
  v_libre     numeric;
  v_aplica    numeric;
  v_desc_m    numeric;
  v_total     numeric := 0;
  v_n         int := 0;
  v_numero    text;
  v_faltan    text;
begin
  perform public.exigir_permiso_del_puesto('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de la planilla diaria.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.planillas_diarias where id = p_id) then return p_id; end if;

  -- Dos envíos a la vez no se llevan las mismas horas ni los mismos descuentos.
  perform pg_advisory_xact_lock(hashtextextended('planilla_diaria', 0));
  if exists (select 1 from public.planillas_diarias where id = p_id) then return p_id; end if;
  select * into v_regla from public.rrhh_regla_horas_extras where id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_pend
    from public.planilla_diaria_pendiente() p
   where exists (select 1 from public.trabajador_remuneraciones r where r.trabajador_id = p.trabajador_id);

  if jsonb_array_length(v_pend) = 0 then
    select string_agg(distinct t.nombres || ' ' || t.apellidos, ', ') into v_faltan
      from public.planilla_diaria_pendiente() p join public.trabajadores t on t.id = p.trabajador_id;
    if v_faltan is not null then
      raise exception 'Falta la remuneración mensual de %: pónsela en Personal y vuelve a armar la planilla.', v_faltan
        using errcode = 'check_violation';
    end if;
    raise exception 'No hay horas validadas por pagar: la planilla sale de los reportes con el visto de Gerencia y de Recursos Humanos.'
      using errcode = 'check_violation';
  end if;

  -- Lo que hay por restar o devolver hasta hoy: primero lo que se devuelve,
  -- después lo que se resta, de lo más viejo a lo más nuevo.
  select coalesce(jsonb_agg(to_jsonb(d) order by d.monto > 0, d.fecha, d.concepto), '[]'::jsonb) into v_desc
    from public.descuentos_pendientes(v_hoy) d;

  v_numero := public.siguiente_correlativo('PLANILLA_DIARIA', '001', null);
  -- Primero se arma cada persona con su total: la guardia deja cambiar solo la
  -- anulación, así que el total va en el mismo insert de la planilla.
  for v_persona in
    select distinct (e->>'trabajador_id')::uuid as trabajador_id, t.nombres || ' ' || t.apellidos as nombre, t.cargo, t.apellidos, t.nombres,
           r.remuneracion_mensual
      from jsonb_array_elements(v_pend) e
      join public.trabajadores t on t.id = (e->>'trabajador_id')::uuid
      join public.trabajador_remuneraciones r on r.trabajador_id = t.id
     order by t.apellidos, t.nombres
  loop
    v_n := v_n + 1;
    v_hora := round(v_persona.remuneracion_mensual / 240, 4);
    v_ord_h := 0; v_ext_h := 0; v_per_h := 0; v_ord_m := 0; v_ext_m := 0; v_per_m := 0;
    for v_linea in select e from jsonb_array_elements(v_pend) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      v_horas := (v_linea->>'horas')::numeric;
      if v_linea->>'concepto' = 'ORDINARIAS' then
        v_ord_h := v_ord_h + v_horas;
        v_ord_m := v_ord_m + round(v_horas * v_hora, 2);
      elsif v_linea->>'concepto' = 'PERMISO' then
        v_per_h := v_per_h + v_horas;
        v_per_m := v_per_m + round(v_horas * v_hora, 2);
      else
        v_ext_h := v_ext_h + v_horas;
        v_ext_m := v_ext_m + round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                             + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2);
      end if;
    end loop;

    v_libre := v_ord_m + v_ext_m + v_per_m;
    v_desc_m := 0;
    v_aplicados := '[]'::jsonb;
    for v_d in select e from jsonb_array_elements(v_desc) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      v_aplica := (v_d->>'monto')::numeric;
      if v_aplica > 0 then v_aplica := least(v_aplica, v_libre); end if;
      continue when v_aplica = 0;
      v_libre := v_libre - v_aplica;
      v_desc_m := v_desc_m + v_aplica;
      v_aplicados := v_aplicados || jsonb_build_object(
        'concepto', v_d->>'concepto', 'fecha', v_d->>'fecha', 'tardanzas', v_d->'tardanzas', 'porcentaje', v_d->'porcentaje',
        'base', v_d->'base', 'monto', v_aplica, 'detalle', v_d->>'detalle',
        'horas', case when v_d->>'horas' is not null
                      then round((v_d->>'horas')::numeric * v_aplica / (v_d->>'monto')::numeric, 2) end);
    end loop;

    v_total := v_total + v_ord_m + v_ext_m + v_per_m - v_desc_m;
    v_personas := v_personas || jsonb_build_object(
      'trabajador_id', v_persona.trabajador_id, 'nombre', v_persona.nombre, 'cargo', v_persona.cargo, 'hora', v_hora,
      'ord_h', v_ord_h, 'ext_h', v_ext_h, 'per_h', v_per_h, 'ord_m', v_ord_m, 'ext_m', v_ext_m, 'per_m', v_per_m,
      'desc_m', v_desc_m, 'descuentos', v_aplicados);
  end loop;

  insert into public.planillas_diarias (id, numero, fecha, personas, total, enviada_por)
  values (p_id, v_numero, v_hoy, v_n, v_total, v_yo);

  for v_p in select e from jsonb_array_elements(v_personas) e loop
    v_hora := (v_p->>'hora')::numeric;
    insert into public.planilla_diaria_personas (planilla_id, trabajador_id, nombre, cargo, horas_ordinarias, horas_extras, horas_permiso,
                                                 monto_ordinarias, monto_extras, monto_permiso, monto_descuentos, total)
    values (p_id, (v_p->>'trabajador_id')::uuid, v_p->>'nombre', v_p->>'cargo',
            (v_p->>'ord_h')::numeric, (v_p->>'ext_h')::numeric, (v_p->>'per_h')::numeric,
            (v_p->>'ord_m')::numeric, (v_p->>'ext_m')::numeric, (v_p->>'per_m')::numeric, (v_p->>'desc_m')::numeric,
            (v_p->>'ord_m')::numeric + (v_p->>'ext_m')::numeric + (v_p->>'per_m')::numeric - (v_p->>'desc_m')::numeric)
    returning id into v_pid;

    for v_linea in
      select e from jsonb_array_elements(v_pend) e
       where e->>'trabajador_id' = v_p->>'trabajador_id'
       order by e->>'fecha', e->>'concepto' desc
    loop
      if v_linea->>'concepto' in ('ORDINARIAS', 'PERMISO') then
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, valor_hora, monto)
        values (v_pid, (v_p->>'trabajador_id')::uuid, (v_linea->>'fecha')::date, v_linea->>'concepto', (v_linea->>'horas')::numeric,
                v_hora, round((v_linea->>'horas')::numeric * v_hora, 2));
      else
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, horas_tramo1, horas_tramo2,
                                                    valor_hora, recargo_tramo1, recargo_tramo2, monto, decision_id)
        values (v_pid, (v_p->>'trabajador_id')::uuid, (v_linea->>'fecha')::date, 'EXTRAS', (v_linea->>'horas')::numeric,
                (v_linea->>'horas_tramo1')::numeric, (v_linea->>'horas_tramo2')::numeric, v_hora,
                v_regla.recargo_tramo1, v_regla.recargo_tramo2,
                round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2),
                (v_linea->>'decision_id')::uuid);
      end if;
    end loop;

    for v_d in select e from jsonb_array_elements(v_p->'descuentos') e loop
      insert into public.descuentos_del_pago (trabajador_id, concepto, fecha, horas, tardanzas, porcentaje, base, monto, detalle,
                                              planilla_persona_id)
      values ((v_p->>'trabajador_id')::uuid, v_d->>'concepto', (v_d->>'fecha')::date, (v_d->>'horas')::numeric,
              (v_d->>'tardanzas')::smallint, (v_d->>'porcentaje')::numeric, (v_d->>'base')::numeric, (v_d->>'monto')::numeric,
              left(v_d->>'detalle', 300), v_pid);
    end loop;
  end loop;

  perform public.notificar_a_permiso('planilla_diaria.pagar', 'Planilla diaria por pagar: ' || v_numero,
    v_n || case when v_n = 1 then ' persona · S/ ' else ' personas · S/ ' end || to_char(v_total, 'FM999G999G990D00'),
    '/planilla-diaria/' || p_id, 'planillas_diarias', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.enviar_planilla_diaria(uuid) from public, anon;
grant execute on function public.enviar_planilla_diaria(uuid) to authenticated;

-- 8. El pago de la oficina resta lo que hay por descontar --------------------------------------------------------
-- Un pago puede quedar en cero si el descuento se lleva todo el tramo.
alter table public.oficina_pagos drop constraint if exists ck_oficina_pago_montos;
alter table public.oficina_pagos add constraint ck_oficina_pago_montos check (
  monto >= 0 and monto <= 100000 and aportes >= 0 and aportes <= 100000);
comment on column public.oficina_pagos.monto is
  'Lo que se le pagó por ese tramo: sueldo, asignación y bonos, menos lo que se le restó por tardanzas y permisos (descuentos_del_pago).';

-- La misma función de la 20261020200000. Cambia lo que se escribe: p_monto es el
-- sueldo del tramo sin descuentos, y la base resta lo que hay por descontar
-- hasta el último día que paga.
create or replace function public.rrhh_registrar_pago_oficina(
  p_id uuid, p_trabajador_id uuid, p_desde date, p_hasta date, p_monto numeric, p_aportes numeric, p_nota text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_w      public.trabajadores;
  v_previo public.oficina_pagos;
  v_cruce  public.oficina_pagos;
  v_d      record;
  v_libre  numeric;
  v_aplica numeric;
  v_desc   numeric := 0;
  v_filas  jsonb := '[]'::jsonb;
  v_f      jsonb;
begin
  perform public.exigir_permiso_del_puesto('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  -- El reintento del mismo pago devuelve el que ya entró, sin duplicarlo.
  select * into v_previo from public.oficina_pagos where id = p_id;
  if found then
    if v_previo.anulado_en is not null then
      raise exception 'Ese pago ya se anuló: regístralo de nuevo si corresponde.' using errcode = 'check_violation';
    end if;
    return p_id;
  end if;

  -- Bloquear la ficha: dos registros a la vez de la misma persona no se cruzan sin verse.
  select * into v_w from public.trabajadores where id = p_trabajador_id for update;
  if not found then raise exception 'Elige a la persona a quien se le pagó.' using errcode = 'check_violation'; end if;
  -- El mismo envío que llegó dos veces a la vez: el segundo esperó el bloqueo y ya lo encuentra.
  if exists (select 1 from public.oficina_pagos where id = p_id and anulado_en is null) then
    return p_id;
  end if;
  if v_w.planilla is distinct from 'ADMINISTRATIVA' then
    raise exception '% % es de planilla de taller: su costo entra por las horas que carga a cada unidad. Si es de la oficina, cámbiale la planilla en Personal.',
      v_w.nombres, v_w.apellidos using errcode = 'check_violation';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Pon desde qué día y hasta qué día paga: el último día no puede ir antes del primero.' using errcode = 'check_violation';
  end if;
  if p_desde < date '2020-01-01' or p_hasta - p_desde > 61 then
    raise exception 'Un pago cubre como mucho dos meses, desde 2020.' using errcode = 'check_violation';
  end if;
  if p_desde > v_hoy + 31 then
    raise exception 'El pago no puede empezar más de un mes adelante.' using errcode = 'check_violation';
  end if;
  -- Dentro del periodo de ahora, o entero dentro de uno anterior (si volvió a entrar).
  if not exists (select 1 from public.trabajador_periodos q
                  where q.trabajador_id = p_trabajador_id and (q.ingreso is null or p_desde >= q.ingreso) and p_hasta <= q.baja) then
    if v_w.fecha_ingreso is not null and p_desde < v_w.fecha_ingreso then
      raise exception '% % entró el %: el pago no puede empezar antes.', v_w.nombres, v_w.apellidos,
        to_char(v_w.fecha_ingreso, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
    if v_w.fecha_baja is not null and p_hasta > v_w.fecha_baja then
      raise exception '% % dejó de trabajar el %: el pago no puede pasar de ese día.', v_w.nombres, v_w.apellidos,
        to_char(v_w.fecha_baja, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 100000 then
    raise exception 'Escribe el sueldo de esos días, en soles, mayor que cero y hasta S/ 100 000.' using errcode = 'check_violation';
  end if;
  if coalesce(p_aportes, 0) < 0 or coalesce(p_aportes, 0) > 100000 then
    raise exception 'Los aportes van en soles, de cero a S/ 100 000.' using errcode = 'check_violation';
  end if;
  if v_nota is not null and char_length(v_nota) not between 2 and 200 then
    raise exception 'La nota va de 2 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  -- Dos pagos del mismo día lo contarían dos veces en el costeo.
  select * into v_cruce from public.oficina_pagos p
   where p.trabajador_id = p_trabajador_id and p.anulado_en is null
     and p.desde <= p_hasta and p.hasta >= p_desde
   order by p.desde limit 1;
  if found then
    raise exception 'Ya hay un pago de % % del % al % que cruza esas fechas: corrige las fechas o anula ese pago.',
      v_w.nombres, v_w.apellidos, to_char(v_cruce.desde, 'DD/MM/YYYY'), to_char(v_cruce.hasta, 'DD/MM/YYYY')
      -- check_violation y no unique_violation: mensajeDeError cambia este último por un texto genérico.
      using errcode = 'check_violation';
  end if;

  -- Lo que hay por restar o devolver hasta el último día que paga, con la misma
  -- llave que la planilla diaria: un descuento no lo toman dos pagos a la vez.
  perform pg_advisory_xact_lock(hashtextextended('planilla_diaria', 0));
  v_libre := round(p_monto, 2);
  for v_d in
    select d.* from public.descuentos_pendientes(p_hasta) d
     where d.trabajador_id = p_trabajador_id
     order by d.monto > 0, d.fecha, d.concepto
  loop
    v_aplica := v_d.monto;
    if v_aplica > 0 then v_aplica := least(v_aplica, v_libre); end if;
    continue when v_aplica = 0;
    v_libre := v_libre - v_aplica;
    v_desc := v_desc + v_aplica;
    v_filas := v_filas || jsonb_build_object(
      'concepto', v_d.concepto, 'fecha', v_d.fecha, 'tardanzas', v_d.tardanzas, 'porcentaje', v_d.porcentaje,
      'base', v_d.base, 'monto', v_aplica, 'detalle', v_d.detalle,
      'horas', case when v_d.horas is not null then round(v_d.horas * v_aplica / v_d.monto, 2) end);
  end loop;

  insert into public.oficina_pagos (id, trabajador_id, desde, hasta, monto, aportes, nota)
  values (p_id, p_trabajador_id, p_desde, p_hasta, round(p_monto, 2) - v_desc, round(coalesce(p_aportes, 0), 2), v_nota);
  for v_f in select e from jsonb_array_elements(v_filas) e loop
    insert into public.descuentos_del_pago (trabajador_id, concepto, fecha, horas, tardanzas, porcentaje, base, monto, detalle,
                                            oficina_pago_id)
    values (p_trabajador_id, v_f->>'concepto', (v_f->>'fecha')::date, (v_f->>'horas')::numeric, (v_f->>'tardanzas')::smallint,
            (v_f->>'porcentaje')::numeric, (v_f->>'base')::numeric, (v_f->>'monto')::numeric, left(v_f->>'detalle', 300), p_id);
  end loop;
  return p_id;
end;
$$;
comment on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) is
  'RR. HH. registra un pago a una persona de planilla administrativa con el tramo de días que paga. p_monto es el sueldo del tramo sin descuentos: la base resta lo que hay por descontar por tardanzas y permisos hasta p_hasta (y suma lo que hay por devolver) y guarda lo que se le pagó. Exige rrhh.personal.';
revoke all on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) from public, anon;
grant execute on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) to authenticated;

-- 9. Los permisos: justificar, descontar, reportar y anular -------------------------------------------------------
-- Lo que falta de un permiso: sus horas menos lo justificado y lo descontado.
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
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
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
  v_falta := v_perm.horas - v_hechas
             - coalesce((select sum(x.horas) from public.permisos_descontados x
                          where x.permiso_id = p_permiso_id and x.anulado_en is null), 0);
  if v_falta <= 0 then
    raise exception 'Ese permiso ya está justificado o descontado.' using errcode = 'check_violation';
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

-- Descontar lo que falta justificar, de una vez. Un reintento con el mismo p_id
-- devuelve el descuento ya registrado.
create or replace function public.rrhh_descontar_permiso(p_id uuid, p_permiso_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_perm   public.permisos_personal%rowtype;
  v_falta  numeric;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
begin
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de permisos.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.permisos_descontados where id = p_id) then return p_id; end if;
  select * into v_perm from public.permisos_personal where id = p_permiso_id;
  if not found then
    raise exception 'Ese permiso no existe.' using errcode = 'check_violation';
  end if;
  if v_perm.anulado_en is not null then
    raise exception 'Ese permiso está anulado: no se descuenta.' using errcode = 'check_violation';
  end if;
  if v_perm.fecha > v_hoy then
    raise exception 'Ese permiso es del %: se descuenta cuando llegue el día, si para entonces no se justificó.',
      to_char(v_perm.fecha, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if v_perm.fecha < public.rrhh_descuentos_desde() then
    raise exception 'Los permisos de antes de % no se descuentan: esos días ya se pagaron como se pagaron.',
      public.mes_en_texto(public.rrhh_descuentos_desde()) using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_perm.trabajador_id::text, 0));
  v_falta := v_perm.horas
             - coalesce((select sum(c.horas) from public.horas_compensadas c
                          where c.permiso_id = p_permiso_id and c.anulado_en is null), 0)
             - coalesce((select sum(x.horas) from public.permisos_descontados x
                          where x.permiso_id = p_permiso_id and x.anulado_en is null), 0);
  if v_falta <= 0 then
    raise exception 'Ese permiso ya está justificado o descontado.' using errcode = 'check_violation';
  end if;

  insert into public.permisos_descontados (id, permiso_id, trabajador_id, fecha, horas)
  values (p_id, p_permiso_id, v_perm.trabajador_id, v_perm.fecha, v_falta);
  return p_id;
end;
$$;
comment on function public.rrhh_descontar_permiso(uuid, uuid) is
  'RR. HH. descuenta lo que falta justificar de un permiso que ya pasó: en taller esas horas no se pagan, en la oficina se restan de su próximo pago. Exige rrhh.permisos.';
revoke all on function public.rrhh_descontar_permiso(uuid, uuid) from public, anon;
grant execute on function public.rrhh_descontar_permiso(uuid, uuid) to authenticated;

-- Reportar el permiso sin justificar: una observación en su legajo y el aviso a
-- quien consulta la asistencia. Un reintento con el mismo p_id devuelve la misma.
create or replace function public.rrhh_reportar_permiso(p_id uuid, p_permiso_id uuid, p_tipo text, p_nota text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_perm    public.permisos_personal%rowtype;
  v_nombre  text;
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_hechas  numeric;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_yo      uuid := public.usuario_actual();
begin
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de permisos.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.observaciones_personal where id = p_id) then return p_id; end if;
  select * into v_perm from public.permisos_personal where id = p_permiso_id;
  if not found then
    raise exception 'Ese permiso no existe.' using errcode = 'check_violation';
  end if;
  if v_perm.anulado_en is not null then
    raise exception 'Ese permiso está anulado: no se reporta.' using errcode = 'check_violation';
  end if;
  if v_perm.fecha > v_hoy then
    raise exception 'Ese permiso es del %: se reporta cuando pase el día, si no se justificó.',
      to_char(v_perm.fecha, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('OBSERVACION', 'AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA') then
    raise exception 'Elige si queda como observación o como amonestación verbal o escrita.' using errcode = 'check_violation';
  end if;
  if v_nota is not null and char_length(v_nota) not between 2 and 500 then
    raise exception 'La nota va de 2 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select nombres || ' ' || apellidos into v_nombre from public.trabajadores where id = v_perm.trabajador_id;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_perm.trabajador_id::text, 0));
  select coalesce(sum(c.horas), 0) into v_hechas from public.horas_compensadas c
   where c.permiso_id = p_permiso_id and c.anulado_en is null;
  if v_perm.horas - v_hechas <= 0 then
    raise exception 'Ese permiso ya está justificado con horas extras: no hay nada que reportar.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.observaciones_personal o where o.permiso_id = p_permiso_id and o.anulado_en is null) then
    raise exception 'Ese permiso ya está reportado: lo ves en Observaciones.' using errcode = 'check_violation';
  end if;

  insert into public.observaciones_personal (id, trabajador_id, fecha, tipo, motivo, detalle, permiso_id)
  values (p_id, v_perm.trabajador_id, v_perm.fecha, p_tipo, 'PERMISO_SIN_JUSTIFICAR',
          left('Permiso del ' || to_char(v_perm.fecha, 'DD/MM/YYYY') || ' sin justificar: ' || public.horas_en_texto(v_perm.horas - v_hechas)
               || ' de ' || public.horas_en_texto(v_perm.horas) || '. Para qué lo pidió: ' || v_perm.motivo
               || coalesce('. ' || v_nota, ''), 1000),
          p_permiso_id);
  perform public.notificar_a_permiso('asistencia.ver', 'Permiso sin justificar: ' || v_nombre,
    case p_tipo when 'OBSERVACION' then 'Observación' when 'AMONESTACION_VERBAL' then 'Amonestación verbal' else 'Amonestación escrita' end
      || ' por el permiso del ' || to_char(v_perm.fecha, 'DD/MM/YYYY') || ' · ' || public.horas_en_texto(v_perm.horas - v_hechas) || ' sin justificar',
    '/rrhh/observaciones', 'observaciones_personal', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.rrhh_reportar_permiso(uuid, uuid, text, text) is
  'RR. HH. reporta un permiso sin justificar: queda una observación (motivo PERMISO_SIN_JUSTIFICAR) en las observaciones de la persona y avisa a quien consulta la asistencia. Exige rrhh.permisos.';
revoke all on function public.rrhh_reportar_permiso(uuid, uuid, text, text) from public, anon;
grant execute on function public.rrhh_reportar_permiso(uuid, uuid, text, text) to authenticated;

-- Al anular el permiso se anula también lo descontado y su reporte.
create or replace function public.rrhh_anular_permiso(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_perm   public.permisos_personal%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
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
  update public.permisos_descontados
     set anulado_por = public.usuario_actual(), anulado_en = now(),
         motivo_anulacion = left('Se anuló el permiso: ' || v_motivo, 500)
   where permiso_id = p_id and anulado_en is null;
  update public.observaciones_personal
     set anulado_por = public.usuario_actual(), anulado_en = now(),
         motivo_anulacion = left('Se anuló el permiso que reportaba: ' || v_motivo, 500)
   where permiso_id = p_id and anulado_en is null;
  update public.permisos_personal
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_permiso(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_permiso(uuid, text) to authenticated;

-- La lista de siempre, con lo descontado fuera de lo que falta justificar.
create or replace function public.rrhh_permisos_personal(p_mes date default null)
returns table (id uuid, trabajador_id uuid, nombre text, cargo text, activo boolean, fecha date, horas numeric, motivo text,
               justificadas numeric, por_justificar numeric, saldo numeric, creado_en timestamptz, anulado_en timestamptz,
               motivo_anulacion text)
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
                             where c.permiso_id = q.id and c.anulado_en is null), 0) as hechas,
                  coalesce((select sum(x.horas) from public.permisos_descontados x
                             where x.permiso_id = q.id and x.anulado_en is null), 0) as descontadas
        from public.permisos_personal q
       where (p_mes is null and q.anulado_en is null)
          or (p_mes is not null and q.fecha >= v_desde and q.fecha < (v_desde + interval '1 month')::date)
    )
    select p.id, p.trabajador_id, t.nombres || ' ' || t.apellidos, t.cargo, t.activo, p.fecha, p.horas, p.motivo,
           p.hechas, case when p.anulado_en is null then greatest(p.horas - p.hechas - p.descontadas, 0) else 0 end,
           public.saldo_horas_de(p.trabajador_id), p.creado_en, p.anulado_en, p.motivo_anulacion
      from p
      join public.trabajadores t on t.id = p.trabajador_id
     where p_mes is not null or p.horas - p.hechas - p.descontadas > 0
     order by p.fecha desc, p.creado_en desc;
end;
$$;

-- La pantalla de permisos: cada permiso con lo descontado, si se reportó, las
-- marcas de portería y las horas del reporte de ese día, y lo que la planilla
-- pagó o restó por él. Lo que se pagó o restó en soles, solo para quien ve el
-- sueldo (como en Tardanzas).
create or replace function public.rrhh_permisos_con_estado(p_mes date default null)
returns table (id uuid, trabajador_id uuid, nombre text, cargo text, activo boolean, planilla text, fecha date, horas numeric,
               motivo text, justificadas numeric, descontadas numeric, por_justificar numeric, saldo numeric, reportado boolean,
               ingreso time, salida time, horas_reporte numeric, horas_pagadas numeric, descontado numeric,
               creado_en timestamptz, anulado_en timestamptz, motivo_anulacion text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_desde     date := date_trunc('month', p_mes)::date;
  v_ve_sueldo boolean := public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('planilla_diaria.preparar');
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.permisos') or public.tiene_permiso('asistencia.ver')) then
    raise exception 'No tienes permiso para consultar los permisos del personal.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with p as (
      select q.*, coalesce((select sum(c.horas) from public.horas_compensadas c
                             where c.permiso_id = q.id and c.anulado_en is null), 0) as hechas,
                  coalesce((select sum(x.horas) from public.permisos_descontados x
                             where x.permiso_id = q.id and x.anulado_en is null), 0) as descontadas
        from public.permisos_personal q
       where (p_mes is null and q.anulado_en is null)
          or (p_mes is not null and q.fecha >= v_desde and q.fecha < (v_desde + interval '1 month')::date)
    ), dia as (
      select d.* from public.permisos_por_dia() d
    ), restado as (
      select v.trabajador_id, v.fecha, sum(v.monto) as monto
        from public.descuentos_vigentes() v
       where v.concepto = 'PERMISO'
       group by v.trabajador_id, v.fecha
    )
    select p.id, p.trabajador_id, t.nombres || ' ' || t.apellidos, t.cargo, t.activo, t.planilla, p.fecha, p.horas, p.motivo,
           p.hechas, p.descontadas,
           case when p.anulado_en is null then greatest(p.horas - p.hechas - p.descontadas, 0) else 0 end,
           public.saldo_horas_de(p.trabajador_id),
           exists (select 1 from public.observaciones_personal o where o.permiso_id = p.id and o.anulado_en is null),
           (select a.hora from public.asistencias a
             where a.trabajador_id = p.trabajador_id and a.fecha = p.fecha and a.tipo = 'INGRESO' and a.anulado_en is null
             order by a.marcado_en limit 1),
           (select a.hora from public.asistencias a
             where a.trabajador_id = p.trabajador_id and a.fecha = p.fecha and a.tipo = 'SALIDA' and a.anulado_en is null
             order by a.marcado_en desc limit 1),
           (select sum(l.horas) from public.reporte_diario_personal l
              join public.reportes_diarios r on r.id = l.reporte_id
             where l.trabajador_id = p.trabajador_id and l.fecha = p.fecha and r.anulado_en is null and r.observado_en is null),
           coalesce(d.pagadas, 0),
           case when v_ve_sueldo then coalesce(rs.monto, 0) end,
           p.creado_en, p.anulado_en, p.motivo_anulacion
      from p
      join public.trabajadores t on t.id = p.trabajador_id
      left join dia d on d.trabajador_id = p.trabajador_id and d.fecha = p.fecha
      left join restado rs on rs.trabajador_id = p.trabajador_id and rs.fecha = p.fecha
     where p_mes is not null or p.horas - p.hechas - p.descontadas > 0
     order by p.fecha desc, p.creado_en desc;
end;
$$;
comment on function public.rrhh_permisos_con_estado(date) is
  'Los permisos del mes (o los vigentes por justificar, sin p_mes) con lo justificado, lo descontado, si se reportó, la marca de ingreso y salida de portería y las horas del reporte de ese día, las horas de permiso que la planilla diaria pagó ese día y lo restado en soles ese día (solo para quien ve el sueldo). Lo ven RR. HH., Gerencia y Administración.';
revoke all on function public.rrhh_permisos_con_estado(date) from public, anon;
grant execute on function public.rrhh_permisos_con_estado(date) to authenticated;

-- 10. Lo que RR. HH. lee ---------------------------------------------------------------------------------------------
-- Lo que hay por restar o devolver a cada persona: lo que la próxima planilla
-- diaria o el próximo pago de la oficina va a aplicar.
create or replace function public.rrhh_descuentos_por_aplicar(p_hasta date default null)
returns table (trabajador_id uuid, nombre text, planilla text, concepto text, fecha date, horas numeric, monto numeric, detalle text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('planilla_diaria.preparar')) then
    raise exception 'No tienes permiso para consultar los descuentos del personal.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.trabajador_id, t.nombres || ' ' || t.apellidos, t.planilla, d.concepto, d.fecha, d.horas, d.monto, d.detalle
      from public.descuentos_pendientes(p_hasta) d
      join public.trabajadores t on t.id = d.trabajador_id
     order by t.apellidos, t.nombres, d.monto > 0, d.fecha, d.concepto;
end;
$$;
comment on function public.rrhh_descuentos_por_aplicar(date) is
  'Lo que falta restar (positivo) o devolver (negativo) a cada persona por tardanzas y permisos descontados, hasta p_hasta (hoy, sin él). Lo ven RR. HH. (rrhh.personal o planilla_diaria.preparar) y el administrador.';
revoke all on function public.rrhh_descuentos_por_aplicar(date) from public, anon;
grant execute on function public.rrhh_descuentos_por_aplicar(date) to authenticated;

-- Las tardanzas de un mes: lo ya restado, lo que falta y en qué pago se restó.
create or replace function public.rrhh_descuentos_de_tardanzas(p_mes date)
returns table (trabajador_id uuid, descontado numeric, por_descontar numeric, documentos text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_mes date := date_trunc('month', p_mes)::date;
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('planilla_diaria.preparar')) then
    raise exception 'No tienes permiso para consultar los descuentos del personal.' using errcode = 'insufficient_privilege';
  end if;
  if p_mes is null then
    raise exception 'Elige el mes.' using errcode = 'check_violation';
  end if;
  return query
    with ap as (
      select v.trabajador_id, sum(v.monto) as monto,
             string_agg(distinct coalesce(p.numero, 'pago de la oficina del ' || to_char(o.desde, 'DD/MM') || ' al ' || to_char(o.hasta, 'DD/MM')),
                        ', ') as documentos
        from public.descuentos_vigentes() v
        left join public.planilla_diaria_personas pp on pp.id = v.planilla_persona_id
        left join public.planillas_diarias p on p.id = pp.planilla_id
        left join public.oficina_pagos o on o.id = v.oficina_pago_id
       where v.concepto = 'TARDANZAS' and v.fecha = v_mes
       group by v.trabajador_id
    ), pend as (
      select d.trabajador_id, d.monto from public.descuentos_pendientes(null) d
       where d.concepto = 'TARDANZAS' and d.fecha = v_mes
    )
    select coalesce(a.trabajador_id, x.trabajador_id), coalesce(a.monto, 0), coalesce(x.monto, 0), a.documentos
      from ap a
      full join pend x on x.trabajador_id = a.trabajador_id;
end;
$$;
comment on function public.rrhh_descuentos_de_tardanzas(date) is
  'Por persona, lo que se le restó por las tardanzas del mes de p_mes (y en qué planilla diaria o pago de la oficina) y lo que falta restar (o devolver, si es negativo). Lo ven RR. HH. y el administrador.';
revoke all on function public.rrhh_descuentos_de_tardanzas(date) from public, anon;
grant execute on function public.rrhh_descuentos_de_tardanzas(date) to authenticated;

-- El recargo de las horas extras de un mes, por código: lo mismo que suma el
-- costeo del código (codigo_interno_lineas_recargo).
create or replace function public.rrhh_recargo_extras_del_mes(p_mes date)
returns table (codigo text, fecha date, documento text, planilla_id uuid, personas integer, horas numeric, monto numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_mes date := date_trunc('month', p_mes)::date;
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_mes is null then
    raise exception 'Elige el mes.' using errcode = 'check_violation';
  end if;
  return query
    select r.codigo, r.fecha, r.documento, r.referencia_id, r.cantidad::integer, r.horas, r.monto
      from public.codigo_interno_lineas_recargo(null) r
     where r.fecha >= v_mes and r.fecha < (v_mes + interval '1 month')::date
     order by r.codigo, r.fecha;
end;
$$;
comment on function public.rrhh_recargo_extras_del_mes(date) is
  'El recargo que la planilla diaria pagó por las horas extras del mes de p_mes, repartido entre los códigos que cada persona trabajó ese día por sus horas validadas: lo mismo que suma el costeo del código. Exige rrhh.personal.';
revoke all on function public.rrhh_recargo_extras_del_mes(date) from public, anon;
grant execute on function public.rrhh_recargo_extras_del_mes(date) to authenticated;
