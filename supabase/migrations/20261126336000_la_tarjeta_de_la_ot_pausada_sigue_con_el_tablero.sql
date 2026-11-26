-- =============================================================================
-- LA TARJETA DE LA OT PAUSADA SIGUE CON EL PLAZO DEL TABLERO
-- -----------------------------------------------------------------------------
-- La 20261126335000 sacó de `etapas_abiertas_de_mi_area()` los códigos cuya
-- única OT abierta está pausada, para que no pidan el reporte de hoy (DKS eligió
-- «Sacar las pausadas» el 2026-11-26). Pero esa función alimenta también la
-- tarjeta de cada código en Planos y etapas, con el semáforo y los días hábiles
-- del tablero de entregas. Sin ella, la tarjeta del código pausado volvía a
-- contar el plazo en días corridos: RR. HH. leía «2 días hábiles» y el
-- supervisor otro número. DKS pidió que la pausa saque el código de la bandeja,
-- no que cambie su plazo.
--
-- Por eso:
--   1. `etapas_abiertas_de_mi_area()` vuelve al filtro de la 20261126333000:
--      la tarjeta del código pausado lee el plazo del tablero, como las demás.
--   2. `codigos_pausados_de_mi_area()` da los códigos con una etapa abierta del
--      área de quien llama cuya única OT abierta está pausada. La pantalla los
--      saca solo de «Sin reporte de hoy».
--
-- El estado se lee del tablero (`tiempos_de_entrega_codigos_calculado`), no se
-- vuelve a calcular. El tablero da el estado de la OT que se entrega antes y
-- cuántas OT abiertas tiene el código (cuenta también las de borrador, aprobadas
-- y programadas). Si hay más de una, el código sigue pidiendo el reporte: la
-- otra puede estar en marcha. Así, dos OT pausadas, o una pausada con otra en
-- borrador, siguen pidiéndolo.
--
-- Antes de reemplazar `etapas_abiertas_de_mi_area()` se mira que sea una de las
-- dos que conoce el repositorio (333000 o 335000): una arreglada a mano en el
-- editor de Supabase no se pisa sin aviso.
--
-- Solo lectura. Sin DROP: el conector de producción no deja pasar ninguno.
-- Idempotente: la guarda acepta también la versión que deja esta migración.
-- =============================================================================

do $$
declare
  -- 464f…: la de la 20261126333000, que es también la que deja esta.
  -- 8c39…: la de la 20261126335000.
  conocidas constant text[] := array['464f4ad3aaf89cd9462118e559b800ba', '8c39825f6f871e3b41f7ed0bd7a31768'];
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.etapas_abiertas_de_mi_area()');
  if huella is null then
    raise exception 'Falta la función etapas_abiertas_de_mi_area: esta base no tiene la migración 20261126333000.';
  end if;
  if not huella = any (conocidas) then
    raise exception 'La función etapas_abiertas_de_mi_area no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

create or replace function public.etapas_abiertas_de_mi_area()
returns table (id uuid, codigo text, nombre text, padre_id uuid,
               inicio_plan date, fin_plan date, inicio_real date,
               ultimo_reporte date, semaforo text, dias_habiles integer)
language plpgsql
stable
security definer
set search_path to 'public'
rows 50
as $$
declare
  v_area uuid;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  select u.area_id into v_area from public.usuarios u where u.id = public.usuario_actual();
  if v_area is null then
    return;
  end if;
  return query
    select e.id, e.codigo, e.nombre, e.padre_id, e.inicio_plan, e.fin_plan, e.inicio_real,
           e.ultimo_reporte, e.semaforo, e.dias_habiles
      from public.tiempos_de_entrega_etapas_calculado(null) e
     where e.area_id = v_area
       and e.fin_real is null
       and e.codigo in (select c.codigo from public.tiempos_de_entrega_codigos_calculado(null) c)
       -- El código con el costeo cerrado ya no se trabaja: no pide reporte.
       and not exists (select 1 from public.codigo_interno_cierres k where k.codigo = e.codigo and k.reabierto_en is null)
     order by e.codigo, e.orden, e.id;
end;
$$;

comment on function public.etapas_abiertas_de_mi_area() is
  'Las etapas sin terminar del área de quien llama, de los códigos que siguen en el tablero de tiempos de entrega, con su semáforo (semaforo_de_fecha), los días hábiles que faltan (negativo si venció) y el último reporte del área. Para «Sin reporte de hoy» y las tarjetas de Planos y etapas (Plan 1, entrega 1.3). Los códigos pausados siguen aquí; la bandeja los saca con codigos_pausados_de_mi_area(). Exige reporte_diario.registrar.';

revoke all on function public.etapas_abiertas_de_mi_area() from public, anon;
grant execute on function public.etapas_abiertas_de_mi_area() to authenticated;

create or replace function public.codigos_pausados_de_mi_area()
returns table (codigo text)
language plpgsql
stable
security definer
set search_path to 'public'
rows 5
as $$
declare
  v_area uuid;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  select u.area_id into v_area from public.usuarios u where u.id = public.usuario_actual();
  if v_area is null then
    return;
  end if;
  return query
    select c.codigo
      from public.tiempos_de_entrega_codigos_calculado(null) c
     -- La OT pausada no se trabaja: no pide reporte (DKS, 2026-11-26).
     where c.ot_estado = 'PAUSADA'
       and c.ots_abiertas = 1
       and exists (select 1 from public.tiempos_de_entrega_etapas_calculado(c.codigo) e
                    where e.area_id = v_area and e.fin_real is null)
     order by c.codigo;
end;
$$;

comment on function public.codigos_pausados_de_mi_area() is
  'Los códigos con una etapa sin terminar del área de quien llama cuya única OT abierta está pausada, según el tablero de tiempos de entrega. «Sin reporte de hoy», en Planos y etapas, no se los pide (DKS, 2026-11-26). Exige reporte_diario.registrar.';

revoke all on function public.codigos_pausados_de_mi_area() from public, anon;
grant execute on function public.codigos_pausados_de_mi_area() to authenticated;
