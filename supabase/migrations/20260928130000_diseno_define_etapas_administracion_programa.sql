-- Las etapas de una OT las elige Diseño; Administración fija sus fechas.
-- Las etapas ya registradas permanecen intactas. La aprobación deja de copiar
-- todo el catálogo y de inventar un cronograma con la fecha del servidor.

-- Las OTs históricas conservan su flujo: algunas ya están aprobadas con
-- fechas incompletas. Solo las creadas desde este cambio exigen plan manual.
alter table public.ordenes_trabajo
  add column if not exists plan_etapas_manual boolean;
update public.ordenes_trabajo set plan_etapas_manual = false
 where plan_etapas_manual is null;
alter table public.ordenes_trabajo
  alter column plan_etapas_manual set default true;
alter table public.ordenes_trabajo
  alter column plan_etapas_manual set not null;
comment on column public.ordenes_trabajo.plan_etapas_manual is
  'Las OTs nuevas requieren etapas elegidas por Diseño y fechas de Administración; las históricas conservan su flujo.';

create or replace function public.fn_ot_plan_manual_guardia()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.plan_etapas_manual := true;
  elsif new.plan_etapas_manual is distinct from old.plan_etapas_manual then
    raise exception 'El origen del plan de etapas de la OT no se puede cambiar';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_plan_manual_guardia() from public, anon, authenticated;
drop trigger if exists trg_ot_plan_manual_guardia on public.ordenes_trabajo;
create trigger trg_ot_plan_manual_guardia before insert or update on public.ordenes_trabajo
for each row execute function public.fn_ot_plan_manual_guardia();

create or replace function public.crear_etapas_ot(p_orden_id uuid)
returns integer language plpgsql security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'No existe la orden de trabajo %', p_orden_id;
  end if;
  return 0;
end;
$$;
revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;

-- El pago también llamaba esta función: sin neutralizarla, las fechas volverían
-- a aparecer automáticamente aunque la aprobación ya no copie etapas.
create or replace function public.programar_etapas_ot(p_orden_id uuid)
returns integer language plpgsql security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'La orden de trabajo no existe';
  end if;
  return 0;
end;
$$;
revoke all on function public.programar_etapas_ot(uuid) from public, anon, authenticated;

create or replace function public.fn_ot_exigir_plan_de_etapas()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.plan_etapas_manual and new.estado is distinct from old.estado
     and new.estado in ('PROGRAMADA', 'EN_PROCESO')
     and old.estado = 'APROBADA' then
    if not exists (select 1 from public.ot_etapas where orden_id = new.id) then
      raise exception 'Diseño debe definir las etapas de la OT % antes de iniciar el taller', new.numero;
    end if;
  end if;
  if new.plan_etapas_manual and new.estado is distinct from old.estado
     and new.estado in ('PROGRAMADA', 'EN_PROCESO')
     and exists (select 1 from public.ot_etapas where orden_id = new.id
                 and (fecha_inicio_programada is null or fecha_fin_programada is null)) then
    raise exception 'Administración debe poner inicio y fin a todas las etapas de la OT %', new.numero;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_exigir_plan_de_etapas() from public, anon, authenticated;
drop trigger if exists trg_ot_exigir_plan_de_etapas on public.ordenes_trabajo;
create trigger trg_ot_exigir_plan_de_etapas before update of estado on public.ordenes_trabajo
for each row execute function public.fn_ot_exigir_plan_de_etapas();

create or replace function public.definir_etapas_diseno(p_orden_id uuid, p_etapas uuid[])
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare
  v_numero text;
  v_estado public.estado_ot;
  v_total integer;
begin
  perform public.exigir_permiso('diseno.planos');
  select numero, estado into v_numero, v_estado
    from public.ordenes_trabajo where id = p_orden_id for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'TERMINADA') then
    raise exception 'La OT % ya está cerrada; sus etapas no se pueden cambiar', v_numero;
  end if;
  if p_etapas is null or cardinality(p_etapas) = 0 then
    raise exception 'Elija al menos una etapa para la OT %', v_numero;
  end if;
  if cardinality(p_etapas) <> (select count(distinct u.id) from unnest(p_etapas) as u(id)) then
    raise exception 'Una etapa no puede repetirse en la OT %', v_numero;
  end if;
  if exists (select 1 from unnest(p_etapas) as u(id)
             left join public.etapas_catalogo c on c.id = u.id and c.activo
             where c.id is null) then
    raise exception 'La selección contiene una etapa inexistente o inactiva';
  end if;
  if exists (select 1 from public.ot_etapas e where e.orden_id = p_orden_id
             and e.etapa_catalogo_id <> all(p_etapas)) then
    raise exception 'La OT % ya tiene etapas registradas: no se pueden retirar ni perder sus reportes', v_numero;
  end if;

  -- Primero se insertan las faltantes y luego se ordenan todas. Repetir la
  -- misma selección no duplica filas ni altera los reportes existentes.
  insert into public.ot_etapas
    (orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion)
  select p_orden_id, c.id, c.orden_secuencia, c.horas_estandar, c.requiere_inspeccion
    from public.etapas_catalogo c where c.id = any(p_etapas)
  on conflict (orden_id, etapa_catalogo_id) do nothing;

  update public.ot_etapas e set orden_secuencia = s.posicion
    from unnest(p_etapas) with ordinality as s(id, posicion)
   where e.orden_id = p_orden_id and e.etapa_catalogo_id = s.id
     and e.orden_secuencia is distinct from s.posicion;
  select count(*) into v_total from public.ot_etapas where orden_id = p_orden_id;
  return v_total;
end;
$$;
revoke all on function public.definir_etapas_diseno(uuid, uuid[]) from public, anon;
grant execute on function public.definir_etapas_diseno(uuid, uuid[]) to authenticated;

create or replace function public.programar_etapa_administracion(
  p_etapa_id uuid, p_inicio date, p_fin date)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_orden text;
  v_orden_id uuid;
  v_estado public.estado_ot;
  v_inicio date;
  v_fin date;
begin
  perform public.exigir_permiso('ordenes.editar');
  select o.numero, o.id, o.estado into v_orden, v_orden_id, v_estado
    from public.ot_etapas e join public.ordenes_trabajo o on o.id = e.orden_id
   where e.id = p_etapa_id for update of e;
  if not found then raise exception 'La etapa no existe'; end if;
  if v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'TERMINADA') then
    raise exception 'La OT % ya está cerrada; no se puede programar', v_orden;
  end if;
  if p_inicio is null or p_fin is null or p_fin < p_inicio then
    raise exception 'Indique inicio y fin válidos para la etapa de la OT %', v_orden;
  end if;
  update public.ot_etapas
     set fecha_inicio_programada = p_inicio, fecha_fin_programada = p_fin
   where id = p_etapa_id
     and (fecha_inicio_programada, fecha_fin_programada)
         is distinct from (p_inicio, p_fin);
  -- El plazo global de la OT sigue siendo el marco del taller. Cuando todas
  -- las etapas tienen fechas, se deriva del mínimo inicio y máximo fin que
  -- Administración acaba de programar.
  if not exists (select 1 from public.ot_etapas where orden_id = v_orden_id
      and (fecha_inicio_programada is null or fecha_fin_programada is null)) then
    select min(fecha_inicio_programada), max(fecha_fin_programada)
      into v_inicio, v_fin from public.ot_etapas where orden_id = v_orden_id;
    update public.ordenes_trabajo set
      fecha_inicio_programada = v_inicio, fecha_fin_programada = v_fin
    where id = v_orden_id
      and (fecha_inicio_programada, fecha_fin_programada)
          is distinct from (v_inicio, v_fin);
  end if;
  return p_etapa_id;
end;
$$;
revoke all on function public.programar_etapa_administracion(uuid, date, date) from public, anon;
grant execute on function public.programar_etapa_administracion(uuid, date, date) to authenticated;

-- El permiso de UPDATE de producción sigue sirviendo para reportar avance.
-- La guarda distingue columnas: ni Producción puede cambiar el calendario ni
-- Administración puede declarar avance, aunque intenten saltarse la pantalla.
create or replace function public.fn_ot_etapa_responsabilidades()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.orden_id is distinct from old.orden_id
     or new.etapa_catalogo_id is distinct from old.etapa_catalogo_id then
    raise exception 'No se puede cambiar la orden ni el catálogo de una etapa ya creada';
  end if;
  if new.horas_estimadas is distinct from old.horas_estimadas
     and not (public.es_admin() or public.tiene_permiso('diseno.planos')) then
    raise exception 'Solo Diseño define las horas previstas de la etapa';
  end if;
  if new.fecha_inicio_programada is distinct from old.fecha_inicio_programada
     or new.fecha_fin_programada is distinct from old.fecha_fin_programada then
    if not (public.es_admin() or public.tiene_permiso('ordenes.editar')) then
      raise exception 'Solo Administración programa las fechas de las etapas';
    end if;
  end if;
  if new.orden_secuencia is distinct from old.orden_secuencia then
    if not (public.es_admin() or public.tiene_permiso('diseno.planos')) then
      raise exception 'Solo Diseño ordena las etapas de producción';
    end if;
  end if;
  if new.estado is distinct from old.estado
     or new.avance_porcentaje is distinct from old.avance_porcentaje
     or new.horas_reales is distinct from old.horas_reales then
    if not (public.es_admin() or public.tiene_permiso('produccion.registrar')) then
      raise exception 'Solo Producción registra el avance de las etapas';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_etapa_responsabilidades() from public, anon, authenticated;
drop trigger if exists trg_ot_etapa_responsabilidades on public.ot_etapas;
create trigger trg_ot_etapa_responsabilidades before update on public.ot_etapas
for each row execute function public.fn_ot_etapa_responsabilidades();

drop policy if exists crear_ot_etapas on public.ot_etapas;
create policy crear_ot_etapas on public.ot_etapas for insert to authenticated
with check (public.es_admin() or public.tiene_permiso('diseno.planos'));
-- La inserción entra exclusivamente por definir_etapas_diseno, que valida
-- estado de la OT, catálogo, duplicados y preservación de etapas anteriores.
revoke insert on public.ot_etapas from authenticated;
drop policy if exists editar_ot_etapas on public.ot_etapas;
create policy editar_ot_etapas on public.ot_etapas for update to authenticated
using (public.es_admin() or public.tiene_permiso('produccion.registrar')
       or public.tiene_permiso('diseno.planos') or public.tiene_permiso('ordenes.editar'))
with check (public.es_admin() or public.tiene_permiso('produccion.registrar')
       or public.tiene_permiso('diseno.planos') or public.tiene_permiso('ordenes.editar'));
