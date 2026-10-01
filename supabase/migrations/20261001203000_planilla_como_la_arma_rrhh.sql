-- =============================================================================
-- LA PLANILLA DEL MES COMO LA ARMA RECURSOS HUMANOS
-- -----------------------------------------------------------------------------
-- Recursos Humanos mandó su Excel de agosto de 2026 para mejorar la carga. El
-- libro no es una sola hoja: trae una hoja «RESUMEN <MES> … - <AÑO>» por grupo
-- de boletas (MWP, la del taller, «OTROS»…) y la hoja «PAGOS», el estado
-- general de la planilla, que agrupa a cada persona por la empresa que le
-- paga: Metal Work Perú y otras empresas que también figuran en el libro.
--
-- El sistema solo aceptaba la hoja «RESUMEN <MES> MWP - <AÑO>». Con eso no
-- entraba nadie de Metal Work Perú cuya boleta estuviera en la hoja OTROS, ni
-- el personal de taller que figura en la hoja de otra empresa. Ahora:
--
-- 1. Cada persona entra con la hoja y la fila de su boleta y con su empresa,
--    de cualquier hoja RESUMEN del mes y año de la planilla. Cuál empresa
--    entra en qué planilla lo decide Recursos Humanos al elegir; la empresa
--    queda guardada en el detalle y se ve en cada persona.
-- 2. Una persona no se cuenta dos veces en el mismo mes, ni en la misma
--    planilla ni en otra: se reconoce por el nombre sin importar el orden
--    («Quispe Rojas, Ana Lucía» = «Ana Lucia Quispe Rojas»).
-- 3. El costo de varias personas se reparte en partes iguales entre varias OT
--    de una vez, en lugar de una OT por persona y por vez.
--
-- El cálculo del costo no cambia: ingresos brutos más aporte del empleador
-- (`calcular_detalle_planilla`). Lo que sí cambia es de dónde sale el aporte:
-- el lector usa el 9 % de sueldo más horas extras cuando la celda de EsSalud
-- del Excel no lo es —en agosto había fórmulas rotas— y lo deja escrito como
-- aviso en la persona.
--
-- En producción había una planilla de taller de agosto sin personas.
-- =============================================================================

-- El nombre como clave: sin tildes ni signos, con las palabras ordenadas.
create or replace function public.clave_nombre_planilla(p_nombre text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(string_agg(t, ' ' order by t), '')
    from regexp_split_to_table(upper(public.unaccent(coalesce(p_nombre, ''))), '[^A-Z]+') t
   where t <> ''
$$;

revoke all on function public.clave_nombre_planilla(text) from public, anon, authenticated;

create or replace function public.importar_planilla_excel(p_id uuid, p_planilla uuid, p_lineas jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
  v_periodo date;
  v_moneda text;
  v_meses text[] := array['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SE(P)?TIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  v_mes text;
  v_anio text;
  v_actual jsonb;
  v_nueva jsonb;
  v_repetido text;
  v_choque record;
begin
  perform public.exigir_permiso('rrhh.gestionar_planillas');
  if p_id is null or jsonb_typeof(p_lineas) is distinct from 'array' then
    raise exception 'El detalle no se pudo leer. Vuelve a cargar el Excel.';
  end if;
  if jsonb_array_length(p_lineas) not between 1 and 300 or octet_length(p_lineas::text) > 1500000 then
    raise exception 'Selecciona entre una y trescientas personas.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select estado, periodo, moneda into v_estado, v_periodo, v_moneda
    from public.planillas where id = p_planilla for update;
  if not found then raise exception 'La planilla no existe.'; end if;
  if v_moneda <> 'PEN' then raise exception 'El Excel de planilla está en soles: impórtalo en una planilla en soles.'; end if;

  -- El mismo envío otra vez (un doble toque, una señal que se cortó): si ya
  -- entró igual, no hace nada.
  select jsonb_agg(jsonb_build_object('nombre', nombre, 'hoja', origen_hoja, 'fila', fila_origen, 'detalle', detalle) order by origen_hoja, fila_origen)
    into v_actual
    from public.planilla_personas where importacion_id = p_id and planilla_id = p_planilla;
  if v_actual is not null then
    select jsonb_agg(jsonb_build_object('nombre', btrim(x.nombre), 'hoja', btrim(x.hoja), 'fila', x.fila,
                                        'detalle', x.detalle || jsonb_build_object('empresa', x.empresa)) order by btrim(x.hoja), x.fila)
      into v_nueva
      from jsonb_to_recordset(p_lineas) x(nombre text, hoja text, fila integer, empresa text, detalle jsonb);
    if v_actual = v_nueva then return p_id; end if;
    raise exception 'La importación ya existe con otros datos. Recarga la planilla.';
  end if;
  if v_estado <> 'BORRADOR' then raise exception 'Solo se importa en una planilla en borrador.'; end if;

  v_mes := v_meses[extract(month from v_periodo)::integer];
  v_anio := extract(year from v_periodo)::integer::text;
  if exists (select 1 from jsonb_to_recordset(p_lineas) x(hoja text)
              where upper(public.unaccent(btrim(coalesce(x.hoja, '')))) !~ ('^RESUMEN ' || v_mes || '\M')
                 or btrim(coalesce(x.hoja, '')) !~ (v_anio || '$')) then
    raise exception 'Las boletas tienen que salir de las hojas RESUMEN del mes y año de esta planilla (%).', to_char(v_periodo, 'MM/YYYY');
  end if;
  if (select count(*) from (select distinct btrim(x.hoja), x.fila from jsonb_to_recordset(p_lineas) x(hoja text, fila integer)) d) <> jsonb_array_length(p_lineas)
     or exists (select 1 from jsonb_to_recordset(p_lineas) x(nombre text, fila integer)
                 where length(btrim(coalesce(x.nombre, ''))) not between 3 and 160 or x.fila is null or x.fila < 1) then
    raise exception 'Revisa nombres y filas: no se pueden repetir.';
  end if;

  select min(btrim(x.nombre)) into v_repetido
    from jsonb_to_recordset(p_lineas) x(nombre text)
   group by public.clave_nombre_planilla(x.nombre)
  having count(*) > 1
   limit 1;
  if v_repetido is not null then
    raise exception '% aparece dos veces en lo que elegiste: una persona se cuenta una sola vez.', v_repetido;
  end if;

  select btrim(x.nombre) as nombre, p.tipo into v_choque
    from jsonb_to_recordset(p_lineas) x(nombre text)
    join public.planilla_personas pp on public.clave_nombre_planilla(pp.nombre) = public.clave_nombre_planilla(x.nombre)
    join public.planillas p on p.id = pp.planilla_id and p.periodo = v_periodo
   limit 1;
  if found then
    raise exception '% ya está en la planilla % de este mes: una persona se cuenta una sola vez.',
      v_choque.nombre, lower(case v_choque.tipo when 'TALLER' then 'de taller' when 'ADMINISTRATIVA' then 'administrativa' else 'de subcontratos' end);
  end if;

  insert into public.planilla_personas (planilla_id, nombre, monto, detalle, origen_hoja, fila_origen, importacion_id, registrado_por)
  select p_planilla, btrim(x.nombre), 0, x.detalle || jsonb_build_object('empresa', x.empresa), btrim(x.hoja), x.fila, p_id, public.usuario_actual()
    from jsonb_to_recordset(p_lineas) x(nombre text, hoja text, fila integer, empresa text, detalle jsonb);
  return p_id;
end;
$$;

revoke all on function public.importar_planilla_excel(uuid, uuid, jsonb) from public, anon;
grant execute on function public.importar_planilla_excel(uuid, uuid, jsonb) to authenticated;

-- La función anterior aceptaba solo la hoja MWP; la aplicación ya no la usa.
drop function if exists public.importar_detalle_planilla(uuid, uuid, text, jsonb);

-- Repartir en partes iguales: cada persona elegida queda con el mismo % en
-- cada OT elegida (el último se lleva el redondeo para sumar 100). Reemplaza
-- el reparto que tuvieran esas personas. Solo con la planilla en borrador; el
-- disparador `fn_planilla_abierta` lo vuelve a comprobar fila por fila.
create or replace function public.repartir_planilla_en_partes_iguales(p_planilla uuid, p_personas uuid[], p_ordenes uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
  v_n integer := coalesce(array_length(p_ordenes, 1), 0);
  v_parte numeric(5,2);
  v_ultimo numeric(5,2);
  v_persona uuid;
  v_cuenta integer := 0;
begin
  perform public.exigir_permiso('rrhh.gestionar_planillas');
  select estado into v_estado from public.planillas where id = p_planilla for update;
  if not found then raise exception 'La planilla no existe.'; end if;
  if v_estado <> 'BORRADOR' then raise exception 'La planilla ya está cerrada: su reparto no cambia.'; end if;
  if v_n = 0 or v_n > 50 then raise exception 'Elige entre una y cincuenta OT.'; end if;
  if (select count(distinct o) from unnest(p_ordenes) o) <> v_n then raise exception 'Hay OT repetidas.'; end if;
  if exists (select 1 from unnest(p_ordenes) o
              where not exists (select 1 from public.ordenes_trabajo t where t.id = o and t.estado <> 'ANULADA')) then
    raise exception 'Una de las OT no existe o está anulada.';
  end if;
  if coalesce(array_length(p_personas, 1), 0) = 0 then raise exception 'Elige al menos una persona.'; end if;
  if exists (select 1 from unnest(p_personas) x
              where not exists (select 1 from public.planilla_personas pp where pp.id = x and pp.planilla_id = p_planilla)) then
    raise exception 'Alguna de las personas no es de esta planilla.';
  end if;

  v_parte := trunc(100.0 / v_n, 2);
  v_ultimo := 100 - v_parte * (v_n - 1);
  foreach v_persona in array (select array_agg(distinct x) from unnest(p_personas) x) loop
    delete from public.planilla_distribuciones where persona_id = v_persona;
    insert into public.planilla_distribuciones (persona_id, orden_id, porcentaje, registrado_por)
    select v_persona, t.o, case when t.i = v_n then v_ultimo else v_parte end, public.usuario_actual()
      from unnest(p_ordenes) with ordinality as t(o, i);
    v_cuenta := v_cuenta + 1;
  end loop;
  return v_cuenta;
end;
$$;

revoke all on function public.repartir_planilla_en_partes_iguales(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.repartir_planilla_en_partes_iguales(uuid, uuid[], uuid[]) to authenticated;
