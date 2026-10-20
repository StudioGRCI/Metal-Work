-- =============================================================================
-- EL SUELDO DE LA OFICINA VA POR LA PLANILLA, NO POR EL ÁREA
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20: «tiene que ser por la planilla así se puede
-- realizar un costeo mejor por unidad y después sacar el coste general».
--
-- Hasta hoy el sueldo de la oficina (20261020120000) contaba a la gente de las
-- áreas de escritorio (`areas.es_oficina`), y la planilla que RR. HH. elige en
-- cada ficha (20261020181000) solo decidía quién sale en el reporte diario. Las
-- dos cosas no se miraban: alguien de Maestranza en planilla administrativa no
-- salía en el reporte (no carga horas a las unidades) y tampoco se le podía
-- registrar un pago de la oficina, así que su sueldo no entraba en ningún costo.
--
-- Desde aquí manda la planilla en los dos lados:
--   · TALLER: su costo entra por las horas que carga a cada unidad.
--   · ADMINISTRATIVA: RR. HH. registra lo que se le paga y entra en el sueldo de
--     la oficina, que se reparte entre las unidades del mes por sus horas.
-- El área sigue diciendo dónde trabaja la persona, no cómo se costea.
--
-- Producción tiene una sola persona (Recursos Humanos, administrativa) y ningún
-- pago registrado: no cambia ningún número ya cerrado.
-- =============================================================================

create or replace function public.rrhh_registrar_pago_oficina(
  p_id uuid, p_trabajador_id uuid, p_desde date, p_hasta date, p_monto numeric, p_aportes numeric, p_nota text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
  v_w     public.trabajadores;
  v_previo public.oficina_pagos;
  v_cruce public.oficina_pagos;
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
    raise exception 'Escribe lo que se le pagó, en soles, mayor que cero y hasta S/ 100 000.' using errcode = 'check_violation';
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

  insert into public.oficina_pagos (id, trabajador_id, desde, hasta, monto, aportes, nota)
  values (p_id, p_trabajador_id, p_desde, p_hasta, round(p_monto, 2), round(coalesce(p_aportes, 0), 2), v_nota);
  return p_id;
end;
$$;
comment on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) is
  'RR. HH. registra un pago a una persona de planilla administrativa con el tramo de días que paga. Exige rrhh.personal.';
revoke all on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) from public, anon;
grant execute on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) to authenticated;

create or replace function public.sueldos_oficina_del_mes(p_periodo date default null)
returns table (periodo date, personas integer, monto numeric, sin_pago integer)
language sql stable set search_path to 'public' as $$
  with mes as (
    select date_trunc('month', p_periodo)::date as periodo where p_periodo is not null
    union
    select distinct h.periodo from public.horas_por_codigo_del_mes(null) h where p_periodo is null
  ), pago as (
    select m.periodo, p.trabajador_id,
           round((p.monto + p.aportes) * (least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) - p.desde + 1) / (p.hasta - p.desde + 1), 2)
           - round((p.monto + p.aportes) * greatest(0, least(p.hasta, m.periodo - 1) - p.desde + 1) / (p.hasta - p.desde + 1), 2) as parte
      from mes m
      join public.oficina_pagos p on p.anulado_en is null
                                 and p.desde < (m.periodo + interval '1 month')::date and p.hasta >= m.periodo
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = p.id)
  ), neto as (
    select g.periodo, g.trabajador_id,
           greatest(sum(g.parte) - coalesce((select sum(t.costo) from public.tareos t
                                               where t.trabajador_id = g.trabajador_id and t.anulado_en is null
                                                 and date_trunc('month', t.fecha)::date = g.periodo
                                                 and public.normalizar_codigo_interno(t.codigo_interno) not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')), 0), 0) as monto
      from pago g
     group by g.periodo, g.trabajador_id
  ), horas as (
    -- El primer mes con horas por código: desde ahí también faltan los pagos.
    select min(h.periodo) as desde from public.horas_por_codigo_del_mes(null) h
  ), falta as (
    -- Los días que trabajó en el mes hasta hoy (en el periodo de ahora o en uno
    -- anterior, si volvió a entrar) y que ningún pago cubre.
    select m.periodo, w.id
      from mes m
      cross join horas hh
      join public.trabajadores w on (w.activo or w.fecha_baja is not null) and w.planilla = 'ADMINISTRATIVA'
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
       and exists (select 1
                     from generate_series(greatest(m.periodo, least(public.inicio_registro_pagos_oficina(w.id), hh.desde)),
                                          least((m.periodo + interval '1 month' - interval '1 day')::date,
                                                (now() at time zone 'America/Lima')::date),
                                          interval '1 day') d(dia)
                    where ((w.fecha_ingreso is null or d.dia::date >= w.fecha_ingreso)
                           and (w.fecha_baja is null or d.dia::date <= w.fecha_baja)
                           or exists (select 1 from public.trabajador_periodos q
                                       where q.trabajador_id = w.id and (q.ingreso is null or d.dia::date >= q.ingreso)
                                         and d.dia::date <= q.baja))
                      and not exists (select 1 from public.oficina_pagos p
                                       where p.trabajador_id = w.id and p.anulado_en is null
                                         and d.dia::date between p.desde and p.hasta
                                         and not exists (select 1 from public.pruebas_filas f
                                                          where f.tabla = 'oficina_pagos' and f.fila_id = p.id)))
  )
  select m.periodo,
         (select count(*) from neto n where n.periodo = m.periodo)::integer,
         coalesce((select round(sum(n.monto), 2) from neto n where n.periodo = m.periodo), 0),
         (select count(*) from falta f where f.periodo = m.periodo)::integer
    from mes m
$$;
comment on function public.sueldos_oficina_del_mes(date) is
  'El sueldo de la oficina de cada mes (o del mes de p_periodo): la parte, por días, de cada pago de oficina_pagos que cae en el mes (con aportes), menos lo que esa persona cargó ese mes en horas a una unidad; y cuántas personas de planilla administrativa tienen días trabajados del mes, desde inicio_registro_pagos_oficina(persona) y hasta hoy, sin pago. No pide permiso: la llaman el costeo y gastos_del_mes_oficina.';
revoke all on function public.sueldos_oficina_del_mes(date) from public, anon, authenticated;

-- La llave oficina_pagos → trabajadores solo la cubría ix_oficina_pagos_persona,
-- que es parcial (where anulado_en is null) y la integridad no puede usar: el check
-- 190 lo marcó en rojo desde la 20261020120000. Cumple (a): ningún índice completo
-- empieza por trabajador_id.
create index if not exists ix_oficina_pagos_trabajador on public.oficina_pagos (trabajador_id);
