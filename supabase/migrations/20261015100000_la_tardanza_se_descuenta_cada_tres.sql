-- =============================================================================
-- RECURSOS HUMANOS: LA TARDANZA SE DESCUENTA CADA TRES VECES, NO POR MINUTO
-- -----------------------------------------------------------------------------
-- La regla de 20261013160000 descontaba S/ 0,08 por cada minuto de tardanza.
-- La empresa la corrigió (2026-10-14): la tardanza no se cobra por tiempo sino
-- por veces. Si una persona llega tarde TRES VECES, se le descuenta el 5 % de
-- su sueldo:
--
--   * La TOLERANCIA sigue (5 minutos) y dice qué ingreso cuenta como
--     tardanza: llegar dentro de ella no cuenta. Si una marca fue tardanza
--     queda escrito al marcar (`es_tardanza`), con la tolerancia de ese
--     momento; cambiar la tolerancia no reescribe el pasado.
--   * Se cuentan por MES CALENDARIO, y cada grupo de tres descuenta el 5 %:
--     tres son 5 %, seis son 10 %. Dos en un mes no descuentan nada, y el mes
--     siguiente empieza de cero.
--   * El 5 % es de la REMUNERACIÓN MENSUAL que RR. HH. pone en la ficha
--     (20261014202000: lo que se le paga, no el costo mensual del costeo). De
--     quien todavía no la tiene se ve el porcentaje, sin el monto.
--   * RR. HH. ajusta cuántas tardanzas hacen un descuento y el porcentaje, como
--     antes ajustaba los soles por minuto.
--
-- Con las tardanzas no hay canje de horas extras: el canje es con los permisos
-- (20261015101000). La marca ya no lleva descuento propio: queda en 0 desde
-- aquí. Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. La regla ------------------------------------------------------------------------
alter table public.rrhh_regla_tardanza
  add column if not exists tardanzas_por_descuento smallint not null default 3,
  add column if not exists porcentaje_descuento numeric(5, 2) not null default 5;

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_regla_tardanza_por_veces' and conrelid = 'public.rrhh_regla_tardanza'::regclass) then
    alter table public.rrhh_regla_tardanza add constraint ck_regla_tardanza_por_veces check (
      tardanzas_por_descuento between 1 and 31 and porcentaje_descuento between 0 and 100);
  end if;
  -- Los soles por minuto ya no se cobran: la columna queda en cero, como evidencia.
  update public.rrhh_regla_tardanza set descuento_por_minuto = 0 where id and descuento_por_minuto <> 0;
end $$;

comment on table public.rrhh_regla_tardanza is
  'Una sola fila: la tolerancia en minutos, cuántas tardanzas del mes hacen un descuento (3) y qué porcentaje de la remuneración mensual descuenta cada grupo (5).';
comment on column public.rrhh_regla_tardanza.tardanzas_por_descuento is
  'Cuántas tardanzas en un mes calendario hacen un descuento: cada grupo completo descuenta el porcentaje.';
comment on column public.rrhh_regla_tardanza.porcentaje_descuento is
  'El porcentaje de la remuneración mensual que se descuenta por cada grupo de tardanzas.';
comment on column public.rrhh_regla_tardanza.descuento_por_minuto is
  'Ya no se usa desde 20261015100000: la tardanza se descuenta por veces, no por minuto.';

-- 2. Qué marca fue tardanza ------------------------------------------------------------
-- Las marcas de antes: tardanza era la que pasó la tolerancia de entonces, que
-- es la que llevó descuento. Solo la primera vez que corre.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'asistencias' and column_name = 'es_tardanza') then
    alter table public.asistencias add column es_tardanza boolean not null default false;
    update public.asistencias set es_tardanza = true
     where tipo = 'INGRESO' and anulado_en is null and descuento > 0;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_asistencia_es_tardanza' and conrelid = 'public.asistencias'::regclass) then
    alter table public.asistencias add constraint ck_asistencia_es_tardanza check (not es_tardanza or tipo = 'INGRESO');
  end if;
end $$;
comment on column public.asistencias.es_tardanza is
  'El ingreso pasó la tolerancia de ese momento: cuenta para el descuento del mes.';
comment on column public.asistencias.descuento is
  'Ya no se usa desde 20261015100000 (queda en 0): el descuento sale del mes, cada tres tardanzas.';

-- La marca hecha tampoco cambia si fue tardanza.
create or replace function public.fn_asistencia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una marca de asistencia no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Esa marca está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if row(new.trabajador_id, new.fecha, new.tipo, new.marcado_en, new.hora, new.tardanza_minutos, new.descuento, new.registrado_por, new.es_tardanza)
     is distinct from row(old.trabajador_id, old.fecha, old.tipo, old.marcado_en, old.hora, old.tardanza_minutos, old.descuento, old.registrado_por, old.es_tardanza) then
    raise exception 'Una marca ya hecha no se corrige: anúlala con su motivo y vuelve a marcar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_asistencia_guardia() from public, anon, authenticated;

-- 3. Marcar la asistencia ---------------------------------------------------------------
-- Igual que antes, pero sin soles: el ingreso que pasa la tolerancia queda
-- marcado como tardanza, con sus minutos.
create or replace function public.marcar_asistencia(p_id uuid, p_trabajador_id uuid, p_tipo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_trab     public.trabajadores%rowtype;
  v_regla    public.rrhh_regla_tardanza%rowtype;
  v_ahora    timestamptz := now();
  v_fecha    date := (now() at time zone 'America/Lima')::date;
  v_hora     time := (now() at time zone 'America/Lima')::time;
  v_minutos  int := 0;
  v_tarde    boolean := false;
  v_previa   public.asistencias%rowtype;
begin
  perform public.exigir_permiso('asistencia.marcar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de asistencia.' using errcode = 'check_violation';
  end if;
  if p_tipo not in ('INGRESO', 'SALIDA') then
    raise exception 'Elige si marca ingreso o salida.' using errcode = 'check_violation';
  end if;
  if p_observacion is not null and char_length(p_observacion) > 300 then
    raise exception 'La observación pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found or not v_trab.activo then
    raise exception 'Esa persona no está en el personal activo: pídele a Recursos Humanos que la registre.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trabajador_id::text, 0));
  select * into v_previa from public.asistencias where id = p_id;
  if found then return p_id; end if;

  select * into v_previa from public.asistencias
   where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = p_tipo and anulado_en is null;
  if found then
    raise exception '% ya marcó % hoy a las %.', v_trab.nombres || ' ' || v_trab.apellidos,
      case p_tipo when 'INGRESO' then 'su ingreso' else 'su salida' end, to_char(v_previa.hora, 'HH24:MI')
      using errcode = 'unique_violation';
  end if;
  if p_tipo = 'SALIDA' and not exists (
      select 1 from public.asistencias
       where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = 'INGRESO' and anulado_en is null) then
    raise exception '% no tiene ingreso marcado hoy: marca primero el ingreso.', v_trab.nombres || ' ' || v_trab.apellidos
      using errcode = 'check_violation';
  end if;

  if p_tipo = 'INGRESO' and v_hora > v_trab.hora_entrada then
    select * into v_regla from public.rrhh_regla_tardanza where id;
    v_minutos := floor(extract(epoch from (v_hora - v_trab.hora_entrada)) / 60)::int;
    v_tarde := v_minutos > coalesce(v_regla.tolerancia_minutos, 0);
  end if;

  insert into public.asistencias (id, trabajador_id, fecha, tipo, marcado_en, hora, tardanza_minutos, descuento, es_tardanza, observacion)
  values (p_id, p_trabajador_id, v_fecha, p_tipo, v_ahora, v_hora, v_minutos, 0, v_tarde, nullif(btrim(coalesce(p_observacion, '')), ''));
  return p_id;
end;
$$;
revoke all on function public.marcar_asistencia(uuid, uuid, text, text) from public, anon;
grant execute on function public.marcar_asistencia(uuid, uuid, text, text) to authenticated;

-- 4. La regla la ajusta RR. HH. -------------------------------------------------------------
create or replace function public.rrhh_guardar_regla_tardanza(
  p_tolerancia_minutos int, p_tardanzas_por_descuento int, p_porcentaje_descuento numeric
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_tolerancia_minutos is null or p_tolerancia_minutos not between 0 and 120 then
    raise exception 'La tolerancia va de 0 a 120 minutos.' using errcode = 'check_violation';
  end if;
  if p_tardanzas_por_descuento is null or p_tardanzas_por_descuento not between 1 and 31 then
    raise exception 'Las tardanzas que hacen un descuento van de 1 a 31 en el mes.' using errcode = 'check_violation';
  end if;
  if p_porcentaje_descuento is null or p_porcentaje_descuento not between 0 and 100 then
    raise exception 'El porcentaje del sueldo va de 0 %% a 100 %%.' using errcode = 'check_violation';
  end if;
  insert into public.rrhh_regla_tardanza (id, tolerancia_minutos, tardanzas_por_descuento, porcentaje_descuento,
                                          descuento_por_minuto, actualizado_por, actualizado_en)
  values (true, p_tolerancia_minutos, p_tardanzas_por_descuento, round(p_porcentaje_descuento, 2), 0, public.usuario_actual(), now())
  on conflict (id) do update
     set tolerancia_minutos = excluded.tolerancia_minutos, tardanzas_por_descuento = excluded.tardanzas_por_descuento,
         porcentaje_descuento = excluded.porcentaje_descuento, descuento_por_minuto = 0,
         actualizado_por = excluded.actualizado_por, actualizado_en = now();
end;
$$;
revoke all on function public.rrhh_guardar_regla_tardanza(int, int, numeric) from public, anon;
grant execute on function public.rrhh_guardar_regla_tardanza(int, int, numeric) to authenticated;

-- La de soles por minuto ya no guarda nada: quien la llame desde una pantalla
-- vieja recibe el aviso. Sin DROP, por el conector.
create or replace function public.rrhh_guardar_regla_tardanza(p_tolerancia_minutos int, p_descuento_por_minuto numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  raise exception 'La tardanza ya no se descuenta por minuto sino cada tres tardanzas del mes: recarga la pantalla.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.rrhh_guardar_regla_tardanza(int, numeric) from public, anon, authenticated;

-- 5. Las tardanzas del mes y su descuento ------------------------------------------------------
-- Una fila por persona activa o con ingresos en el mes. La remuneración y el
-- monto, solo para quien ve el sueldo (RR. HH.); Gerencia y Administración ven
-- las veces y el porcentaje.
create or replace function public.rrhh_tardanzas_del_mes(p_mes date)
returns table (trabajador_id uuid, nombres text, apellidos text, dni text, cargo text, activo boolean,
               dias_con_ingreso integer, tardanzas integer, minutos integer, grupos integer,
               porcentaje numeric, remuneracion_mensual numeric, descuento numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_ve_sueldo boolean := public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('planilla_diaria.preparar');
  v_por       int;
  v_pct       numeric;
  v_desde     date;
begin
  if not (v_ve_sueldo or public.tiene_permiso('asistencia.ver')) then
    raise exception 'No tiene permiso para consultar las tardanzas.' using errcode = 'insufficient_privilege';
  end if;
  if p_mes is null then
    raise exception 'Elige el mes.' using errcode = 'check_violation';
  end if;
  v_desde := date_trunc('month', p_mes)::date;
  select greatest(coalesce(g.tardanzas_por_descuento, 3), 1), coalesce(g.porcentaje_descuento, 5)
    into v_por, v_pct
    from public.rrhh_regla_tardanza g where g.id;
  v_por := coalesce(v_por, 3);
  v_pct := coalesce(v_pct, 5);

  return query
    with m as (
      select a.trabajador_id as tid, count(*)::int as dias,
             (count(*) filter (where a.es_tardanza))::int as veces,
             coalesce(sum(a.tardanza_minutos) filter (where a.es_tardanza), 0)::int as mins
        from public.asistencias a
       where a.tipo = 'INGRESO' and a.anulado_en is null
         and a.fecha >= v_desde and a.fecha < (v_desde + interval '1 month')::date
       group by a.trabajador_id
    ), c as (
      select t.id as tid, t.nombres, t.apellidos, t.dni, t.cargo, t.activo,
             coalesce(m.dias, 0) as dias, coalesce(m.veces, 0) as veces, coalesce(m.mins, 0) as mins,
             coalesce(m.veces, 0) / v_por as grp,
             r.remuneracion_mensual as rem
        from public.trabajadores t
        left join m on m.tid = t.id
        left join public.trabajador_remuneraciones r on r.trabajador_id = t.id
       where t.activo or m.tid is not null
    )
    select c.tid, c.nombres, c.apellidos, c.dni, c.cargo, c.activo, c.dias, c.veces, c.mins, c.grp,
           least(c.grp * v_pct, 100)::numeric,
           case when v_ve_sueldo then c.rem end,
           case when v_ve_sueldo and c.rem is not null then round(c.rem * least(c.grp * v_pct, 100) / 100, 2) end
      from c
     order by c.grp desc, c.veces desc, c.apellidos, c.nombres;
end;
$$;
revoke all on function public.rrhh_tardanzas_del_mes(date) from public, anon;
grant execute on function public.rrhh_tardanzas_del_mes(date) to authenticated;
