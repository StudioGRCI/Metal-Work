-- =============================================================================
-- LOS GASTOS DEL MES SE REPARTEN POR HORAS, Y LA OFICINA ENTRA AL COSTO
-- -----------------------------------------------------------------------------
-- DKS lo eligió el 2026-10-20 («Por horas + oficina»): lo más importante es el
-- costeo de cada vehículo, y que sea lo más real posible. Hasta hoy cada gasto
-- del mes —luz, agua, internet, depreciación— se cargaba con una tasa fija por
-- código o en partes iguales entre los códigos que trabajaron ese mes: una
-- unidad con 200 horas en el taller y otra con 20 cargaban lo mismo. Y el
-- sueldo de la gente de oficina no entraba al costo de ninguna unidad.
--
-- Desde aquí:
--   · Un gasto del mes se reparte POR HORAS: cada código carga la parte del
--     gasto que le toca por las horas que su gente trabajó en él ese mes (las
--     del tareo de RR. HH. y las del reporte diario que aún no tienen tareo).
--     PLANTA, OFICINA y TODOS LOS ACTIVOS no son una unidad y no reciben. Un mes
--     sin horas en ninguna unidad todavía no reparte: el gasto espera y se
--     reparte solo en cuanto alguien reporte horas ese mes.
--   · El sueldo de la oficina entra como un gasto del mes más, repartido igual
--     por horas, sin que nadie lo escriba: es el costo mensual que RR. HH. ya
--     tiene de cada trabajador activo de las áreas marcadas como oficina
--     (areas.es_oficina: las de escritorio). Si esa persona además cargó horas
--     a una unidad, ese tramo ya está en la mano de obra de la unidad y se
--     descuenta: el mismo sueldo no se cobra dos veces. Un mes pasado no cambia
--     porque hoy RR. HH. cambie un costo, una baja o un área: antes se anota
--     quiénes eran la oficina de ese mes y con qué costo.
--   · En el mes en curso la parte de cada unidad es provisional (las horas
--     siguen llegando), y el costeo de una unidad con horas en el mes en curso
--     no se cierra hasta que el mes termine.
--   · Lo nuevo solo se registra por horas. Los gastos ya registrados con tasa o
--     en partes iguales se siguen repartiendo como se registraron.
--
-- El reparto se calcula en un solo lugar (horas_por_codigo_del_mes y
-- sueldos_oficina_del_mes): lo leen el costeo de cada código y la pantalla de
-- Gastos del mes, que muestra entre quiénes se reparte el mes y cuánto es la
-- oficina. Producción no tenía gastos del mes ni tareos al escribir esto (consultado
-- el 2026-10-20): el cambio no mueve ningún gasto ya registrado.
-- =============================================================================

-- 1. La forma de reparto POR HORAS, la única para lo que se registra desde hoy -------------------------------------------------------------------
alter table public.gastos_generales_mes drop constraint if exists gastos_generales_mes_reparto_check;
alter table public.gastos_generales_mes add constraint gastos_generales_mes_reparto_check
  check (reparto in ('TASA', 'PARTES_IGUALES', 'HORAS'));
alter table public.gastos_generales_mes drop constraint if exists gastos_generales_mes_check;
alter table public.gastos_generales_mes add constraint gastos_generales_mes_check
  check ((reparto = 'TASA' and tasa > 0 and tasa <= 100) or (reparto in ('PARTES_IGUALES', 'HORAS') and tasa is null));
comment on column public.gastos_generales_mes.reparto is
  'Cómo se reparte entre los códigos que trabajaron el mes: HORAS (por las horas de cada uno; lo que se registra desde el 2026-10-20), o TASA y PARTES_IGUALES, como se registraban antes.';

create or replace function public.registrar_gasto_general(p_id uuid, p_periodo date, p_concepto text, p_descripcion text,
  p_monto numeric, p_moneda text, p_reparto text, p_tasa numeric)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.gastos_generales_mes%rowtype; v_periodo date := date_trunc('month', p_periodo)::date;
begin
  perform public.exigir_permiso('costos.gastos_generales');
  if p_id is null or p_periodo is null or length(btrim(coalesce(p_descripcion, ''))) not between 3 and 300
     or p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) or p_moneda is null or p_moneda not in ('PEN','USD')
     then
    raise exception 'Indica mes, concepto, detalle (3 a 300 caracteres), importe y moneda.';
  end if;
  -- Lo nuevo va por horas (DKS, 2026-10-20). La tabla sigue admitiendo TASA y
  -- PARTES_IGUALES solo por los gastos que ya se registraron así.
  if p_reparto is distinct from 'HORAS' or p_tasa is not null then
    raise exception 'Los gastos del mes se reparten por horas: ya no se registran con tasa ni en partes iguales.';
  end if;
  perform 1 from public.conceptos_gasto_general where codigo = p_concepto and activo;
  if not found then raise exception 'Elige un concepto de gasto válido.'; end if;
  select * into v from public.gastos_generales_mes where id = p_id;
  if found then
    if v.estado <> 'ACTIVO' then
      raise exception 'Ese gasto ya se anuló: regístralo de nuevo si corresponde.';
    end if;
    if v.periodo = v_periodo and v.concepto = p_concepto and v.monto = p_monto and v.moneda = p_moneda
       and v.reparto = p_reparto and v.tasa is not distinct from p_tasa and v.registrado_por = public.usuario_actual() then
      return p_id;
    end if;
    raise exception 'Ese gasto ya se registró con otros datos. Recarga la pantalla.';
  end if;
  insert into public.gastos_generales_mes(id, periodo, concepto, descripcion, monto, moneda, reparto, tasa)
  values (p_id, v_periodo, p_concepto, btrim(p_descripcion), p_monto, p_moneda, p_reparto, p_tasa);
  return p_id;
end $$;
revoke all on function public.registrar_gasto_general(uuid, date, text, text, numeric, text, text, numeric) from public, anon;
grant execute on function public.registrar_gasto_general(uuid, date, text, text, numeric, text, text, numeric) to authenticated;

-- 2. Las horas de cada unidad en el mes ---------------------------------------------------------------
-- Las del tareo de RR. HH. vigente y las de las líneas del reporte diario vigente
-- que todavía no tienen tareo (su persona no tiene costo mensual): las mismas
-- horas que la mano de obra del costeo. Solo las unidades: PLANTA, OFICINA y
-- TODOS LOS ACTIVOS no reciben gastos del mes.
create or replace function public.horas_por_codigo_del_mes(p_periodo date default null)
returns table (periodo date, codigo text, horas numeric, total numeric, codigos integer)
language sql stable set search_path to 'public' as $$
  with hora as (
    select date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.horas
      from public.tareos t
     where t.anulado_en is null
       and (p_periodo is null or date_trunc('month', t.fecha)::date = date_trunc('month', p_periodo)::date)
    union all
    select date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno), l.horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
       and (p_periodo is null or date_trunc('month', l.fecha)::date = date_trunc('month', p_periodo)::date)
  ), por_codigo as (
    select h.periodo, h.codigo, sum(h.horas) as horas
      from hora h
     where h.codigo is not null and h.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
     group by h.periodo, h.codigo
    having sum(h.horas) > 0
  )
  select c.periodo, c.codigo, c.horas, sum(c.horas) over (partition by c.periodo),
         (count(*) over (partition by c.periodo))::integer
    from por_codigo c
$$;
comment on function public.horas_por_codigo_del_mes(date) is
  'Las horas de cada unidad en cada mes (o en el mes de p_periodo), con el total del mes y cuántas unidades trabajaron: tareo vigente y líneas del reporte diario sin tareo, sin PLANTA, OFICINA ni TODOS LOS ACTIVOS. Es la base del reparto de los gastos del mes por horas. No pide permiso: la llaman el costeo y gastos_del_mes_reparto.';
revoke all on function public.horas_por_codigo_del_mes(date) from public, anon, authenticated;

-- 3. El sueldo de la oficina de cada mes ----------------------------------------------------------------
-- Qué áreas son la oficina lo dice cada área (areas.es_oficina), no una lista
-- escondida en el SQL. DKS dijo «el sueldo de la oficina»: arrancan marcadas las
-- áreas de escritorio. Las de apoyo al taller (Almacén, Calidad, Diseño,
-- Ingeniería, Garantías, Mantenimiento, SSOMA, Servicios de apoyo) y las del
-- taller (Maestranza, Producción, Acabados) no: su gente carga sus horas a cada
-- unidad. La marca se pone una sola vez, al crear la columna, para que volver a
-- correr la migración no deshaga lo que la empresa cambie después.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'areas' and column_name = 'es_oficina') then
    alter table public.areas add column es_oficina boolean not null default false;
    update public.areas set es_oficina = true
     where codigo in ('ADM', 'CON', 'GCO', 'GGE', 'GOP', 'LOG', 'MKT', 'REQ', 'RRH', 'TES', 'TIC');
  end if;
end $$;
comment on column public.areas.es_oficina is
  'Si el sueldo de su gente entra al costo de las unidades como sueldo de la oficina, repartido por horas con los gastos del mes (migración 20261020110000).';

-- Un mes que ya pasó no cambia porque hoy cambie el personal. trabajador_costos
-- guarda un solo costo por persona, sin historia: subirle el sueldo a alguien o
-- darlo de baja movía la oficina de los meses ya cerrados. Antes de ese cambio se
-- anota quiénes eran la oficina de cada mes pasado con horas, y con qué costo; el
-- mes en curso sigue al día. Lo que cada uno cargó en horas a una unidad se sigue
-- descontando al leer: un tareo tardío de un mes pasado sí cuenta.
-- Cuenta quien está activo, no quien ya estaba dado de alta en el sistema ese mes:
-- trabajadores no guarda la fecha de ingreso, y la de alta es el día en que RR. HH.
-- lo tecleó (en producción, toda la gente se está dando de alta en octubre de
-- 2026), así que un tareo atrasado de setiembre dejaba la oficina en cero. Quien
-- entra después no llega a los meses pasados porque su primer costo los anota antes.
-- Sin activar_timestamps: son anotaciones que nadie edita, sin permisos de escritura.
create table if not exists public.oficina_meses_congelados (
  periodo date primary key check (extract(day from periodo) = 1),
  congelado_en timestamptz not null default now()
);
-- Sin índice por trabajador_id: nadie filtra por él y un trabajador no se borra
-- (fn_trabajador_guardia); la llave primaria empieza por el mes, que es como se lee.
create table if not exists public.oficina_mes_personas (
  periodo date not null references public.oficina_meses_congelados (periodo),
  trabajador_id uuid not null references public.trabajadores (id),
  costo_mensual numeric not null check (costo_mensual >= 0),
  primary key (periodo, trabajador_id)
);
comment on table public.oficina_meses_congelados is
  'Los meses pasados cuyo sueldo de la oficina ya quedó anotado en oficina_mes_personas. Lo llena congelar_oficina, nadie a mano.';
comment on table public.oficina_mes_personas is
  'Quiénes eran la oficina en cada mes pasado y con qué costo mensual, anotado antes de que RR. HH. cambiara un costo, una baja o un área. Lleva sueldos: sin políticas, solo lo leen las funciones del costeo.';
alter table public.oficina_meses_congelados enable row level security;
alter table public.oficina_mes_personas enable row level security;
revoke all on public.oficina_meses_congelados from anon, authenticated;
revoke all on public.oficina_mes_personas from anon, authenticated;
-- Cerradas a todos a propósito, y dicho con una política: sin ninguna, no se
-- distingue de una que se olvidó (20260101000007).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'oficina_meses_congelados' and policyname = 'nadie_lee_oficina_meses_congelados') then
    create policy nadie_lee_oficina_meses_congelados on public.oficina_meses_congelados for select to authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'oficina_mes_personas' and policyname = 'nadie_lee_oficina_mes_personas') then
    create policy nadie_lee_oficina_mes_personas on public.oficina_mes_personas for select to authenticated using (false);
  end if;
end $$;

create or replace function public.congelar_oficina()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  -- Todos los meses pasados desde el primero con horas, tengan horas hoy o no: un
  -- tareo atrasado (RR. HH. carga hasta un año atrás) puede darle horas después a
  -- un mes que hoy no tiene, y ese mes tiene que repartir la oficina de entonces.
  with mes as (
    select s.periodo::date as periodo
      from (select min(h.periodo) as desde from public.horas_por_codigo_del_mes(null) h) d
     cross join generate_series(d.desde, v_mes - interval '1 month', interval '1 month') s(periodo)
     where d.desde is not null
       and not exists (select 1 from public.oficina_meses_congelados k where k.periodo = s.periodo::date)
  ), nuevo as (
    insert into public.oficina_meses_congelados (periodo)
    select m.periodo from mes m
    on conflict (periodo) do nothing
    returning periodo
  )
  insert into public.oficina_mes_personas (periodo, trabajador_id, costo_mensual)
  select n.periodo, w.id, c.costo_mensual
    from nuevo n
    join public.trabajadores w on w.activo
                              and not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
    join public.trabajador_costos c on c.trabajador_id = w.id
    join public.areas a on a.id = w.area_id and a.es_oficina;
end;
$$;
comment on function public.congelar_oficina() is
  'Anota quiénes eran la oficina, y con qué costo, en cada mes pasado (desde el primero con horas) que todavía no estaba anotado. La llaman los disparadores antes de que entre o cambie un costo mensual, una baja, un área o qué área es oficina.';
revoke all on function public.congelar_oficina() from public, anon, authenticated;

create or replace function public.fn_congelar_oficina()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- Antes del cambio: la consulta todavía ve la fila como era.
  perform public.congelar_oficina();
  return new;
end;
$$;
revoke all on function public.fn_congelar_oficina() from public, anon, authenticated;
-- El primer costo de una persona entra por insert (rrhh_guardar_costo_trabajador
-- hace insert … on conflict): también anota, o el primer costo movería los meses pasados.
create or replace trigger trg_costo_nuevo_congela_oficina
  before insert on public.trabajador_costos
  for each row execute function public.fn_congelar_oficina();
-- Sin «update of columna»: el disparador mira el SET, no lo que cambió (skill esquema).
create or replace trigger trg_costo_congela_oficina
  before update on public.trabajador_costos
  for each row when (old.costo_mensual is distinct from new.costo_mensual)
  execute function public.fn_congelar_oficina();
create or replace trigger trg_trabajador_congela_oficina
  before update on public.trabajadores
  for each row when (old.activo is distinct from new.activo or old.area_id is distinct from new.area_id)
  execute function public.fn_congelar_oficina();
create or replace trigger trg_area_congela_oficina
  before update on public.areas
  for each row when (old.es_oficina is distinct from new.es_oficina)
  execute function public.fn_congelar_oficina();

-- El costo mensual de la oficina de cada mes, menos lo que ese mes cada persona
-- ya cargó en horas a una unidad: ese tramo está en la mano de obra de la unidad
-- y no se cobra dos veces. Un mes pasado, con la gente anotada; el mes en curso,
-- con la de hoy. Quien tiene costo y no tiene área no se sabe si es de la oficina:
-- se cuenta aparte para que la pantalla lo diga, solo en un mes todavía sin anotar:
-- en uno anotado, ponerle el área hoy ya no lo cambia. Sin p_periodo, los meses con
-- horas en alguna unidad, que son los que se reparten.
create or replace function public.sueldos_oficina_del_mes(p_periodo date default null)
returns table (periodo date, personas integer, monto numeric, sin_area integer)
language sql stable set search_path to 'public' as $$
  with mes as (
    select date_trunc('month', p_periodo)::date as periodo where p_periodo is not null
    union
    select distinct h.periodo from public.horas_por_codigo_del_mes(null) h where p_periodo is null
  ), persona as (
    select m.periodo, p.trabajador_id, p.costo_mensual
      from mes m
      join public.oficina_mes_personas p on p.periodo = m.periodo
    union all
    select m.periodo, w.id, c.costo_mensual
      from mes m
      join public.trabajadores w on w.activo
      join public.trabajador_costos c on c.trabajador_id = w.id
      join public.areas a on a.id = w.area_id and a.es_oficina
     where not exists (select 1 from public.oficina_meses_congelados k where k.periodo = m.periodo)
       -- La gente de un lote de prueba no es la oficina de la empresa.
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
  ), neto as (
    select p.periodo,
           greatest(p.costo_mensual - coalesce((select sum(t.costo) from public.tareos t
                                                  where t.trabajador_id = p.trabajador_id and t.anulado_en is null
                                                    and date_trunc('month', t.fecha)::date = p.periodo
                                                    and public.normalizar_codigo_interno(t.codigo_interno) not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')), 0), 0) as monto
      from persona p
  )
  select m.periodo,
         (select count(*) from neto n where n.periodo = m.periodo)::integer,
         coalesce((select round(sum(n.monto), 2) from neto n where n.periodo = m.periodo), 0),
         (select count(*) from public.trabajadores w
            join public.trabajador_costos c on c.trabajador_id = w.id
           where w.activo and w.area_id is null
             and not exists (select 1 from public.oficina_meses_congelados k where k.periodo = m.periodo)
             and not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id))::integer
    from mes m
$$;
comment on function public.sueldos_oficina_del_mes(date) is
  'El sueldo de la oficina de cada mes (o del mes de p_periodo): el costo mensual de RR. HH. de la gente de las áreas marcadas es_oficina (el de entonces en un mes pasado ya anotado, el de hoy en el mes en curso), menos lo que ese mes cargaron en horas a una unidad; y cuántos trabajadores con costo no tienen área. No pide permiso: la llaman el costeo y gastos_del_mes_oficina.';
revoke all on function public.sueldos_oficina_del_mes(date) from public, anon, authenticated;

-- 4. Lo que ve la pantalla de Gastos del mes --------------------------------------------------------------
-- Entre qué unidades se reparte un mes y con qué parte, y el sueldo de la oficina
-- de ese mes. El reparto lo leen quienes ven los gastos del mes: Administración
-- (costos.gastos_generales) y quien ve los costos (costos.ver), como la política
-- ver_gastos_generales_mes. El sueldo de la oficina, sumado y sin decir cuántas
-- personas son, solo quien ya lo ve en el costeo de cada código: Administración y
-- Gerencia. Con una o dos personas en la oficina el total deja adivinar su
-- sueldo; quién lo ve se le preguntó a DKS (el costo de la unidad lo incluye igual).
create or replace function public.gastos_del_mes_reparto(p_periodo date)
returns table (codigo text, horas numeric, parte numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('costos.gastos_generales') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tiene el permiso costos.gastos_generales ni costos.ver para realizar esta operación' using errcode = 'insufficient_privilege';
  end if;
  if p_periodo is null then
    return;
  end if;
  return query
  select h.codigo, h.horas, round(100 * h.horas / h.total, 2)
    from public.horas_por_codigo_del_mes(p_periodo) h
   order by h.horas desc, h.codigo;
end;
$$;
comment on function public.gastos_del_mes_reparto(date) is
  'Las unidades que trabajaron el mes de p_periodo, con sus horas y el porcentaje de cada gasto del mes que cargan. Exige costos.gastos_generales o costos.ver.';
revoke all on function public.gastos_del_mes_reparto(date) from public, anon;
grant execute on function public.gastos_del_mes_reparto(date) to authenticated;

create or replace function public.gastos_del_mes_oficina(p_periodo date)
returns table (monto numeric, sin_area integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  -- El total, solo a quien registra los gastos o ve el costeo de cada código.
  -- Con costos.ver solo (Supervisión general, Costos y Materiales) no se muestra
  -- suelto, pero el costo de cada código lo lleva dentro (codigos_internos_costo):
  -- el costeo de una unidad es el mismo para todo puesto. Si la oficina se tapa a
  -- esos puestos lo decide DKS.
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('costos.gastos_generales') or public.tiene_permiso('codigos_internos.ver')) then
    raise exception 'No tiene el permiso costos.gastos_generales ni codigos_internos.ver para realizar esta operación' using errcode = 'insufficient_privilege';
  end if;
  if p_periodo is null then
    return;
  end if;
  return query
  select o.monto, o.sin_area from public.sueldos_oficina_del_mes(p_periodo) o;
end;
$$;
comment on function public.gastos_del_mes_oficina(date) is
  'El sueldo de la oficina del mes de p_periodo, sumado y sin cuántas personas son (sin lo que ya cargaron en horas a una unidad), y cuántos trabajadores con costo no tienen área. Exige costos.gastos_generales o codigos_internos.ver, los que ya lo ven en el costeo de cada código.';
revoke all on function public.gastos_del_mes_oficina(date) from public, anon;
grant execute on function public.gastos_del_mes_oficina(date) to authenticated;

-- 5. El costeo de cada código ------------------------------------------------------------------------------
-- La misma función de la 20261017401000, con los gastos POR HORAS y el sueldo de
-- la oficina. Lo demás —mano de obra, materiales, lo cargado a todos los activos,
-- compras, servicios, subcontratos, caja, recargo, gastos de la OT y merma— se
-- conserva tal cual.

create or replace function public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  -- El mes en curso todavía reparte con las horas que van: su parte es provisional.
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where p_mano_obra and t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where p_mano_obra and r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  ), horas as (
    select 'MANO_OBRA'::text as fuente, x.codigo, x.fecha, x.horas, x.costo, x.trabajador_id, x.reporte_id, x.trabajo_id, x.labor from tareo x
    union all
    select 'MANO_OBRA_SIN_COSTO', e.codigo, e.fecha, e.horas, null::numeric, e.trabajador_id, e.reporte_id, e.trabajo_id, e.labor from espera e
  ), salida_base as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad,
           date_trunc('month', m.registrado_en at time zone 'America/Lima')::date as periodo
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), trabajo as (
    -- Los códigos que trabajaron cada mes: con horas del reporte diario o de
    -- RR. HH., o con una salida del almacén. Es lo que se llama «activo» al
    -- repartir los gastos del mes y lo cargado a TODOS LOS ACTIVOS. Solo dice
    -- qué códigos y qué meses, sin horas ni costos: por eso se arma también
    -- cuando no se pide la mano de obra (el gasto por código de Requerimientos
    -- reparte igual que Gerencia).
    select distinct date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo
      from public.tareos t
     where t.anulado_en is null
    union
    select distinct date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
    union
    select distinct s.periodo, s.codigo
      from salida_base s
     where s.cantidad > 0
  ), activo as (
    -- Entre quiénes se reparte lo cargado a todos: las unidades. PLANTA y OFICINA
    -- no lo son.
    select t.periodo, t.codigo, count(*) over (partition by t.periodo) as n
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
  ), movido as (
    -- Entre quiénes se reparten los gastos del mes: los mismos de la
    -- 20261017300000, todos menos PLANTA. TODOS LOS ACTIVOS no recibe: lo suyo ya
    -- está repartido.
    select t.periodo, t.codigo
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'TODOS LOS ACTIVOS')
  ), salida as (
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           s.codigo, s.cantidad, null::bigint as entre, false as a_todos
      from salida_base s
     where s.codigo is distinct from 'TODOS LOS ACTIVOS'
    union all
    -- Lo cargado a todos: una parte igual para cada código que trabajó el mes de
    -- la salida. Sin ninguno, la salida entera queda en TODOS LOS ACTIVOS.
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           coalesce(a.codigo, s.codigo), case when a.n is null then s.cantidad else s.cantidad / a.n end, a.n, true
      from salida_base s
      left join activo a on a.periodo = s.periodo
     where s.codigo = 'TODOS LOS ACTIVOS'
  ), valorizada as (
    -- El mismo orden que el costeo de la OT: precio congelado, último ingreso con
    -- precio hasta ese día, y el precio que fijó Logística (el vigente ese día, o
    -- el primero después).
    select s.*,
           coalesce(s.precio_unitario, ing.precio_unitario, val.precio)::numeric as precio,
           case when s.precio_unitario is not null then coalesce(s.moneda, ing.moneda, val.moneda)
                when ing.precio_unitario is not null then ing.moneda
                else val.moneda end as moneda_val
      from salida s
      left join lateral (
        select i.precio_unitario, i.moneda from public.movimientos_materiales i
         where i.material_id = s.material_id and i.tipo = 'INGRESO' and i.precio_unitario is not null
           and i.moneda in ('PEN', 'USD') and i.registrado_en <= s.registrado_en
         order by i.registrado_en desc, i.id
         limit 1) ing on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = s.material_id
         order by (v.vigente_desde > s.registrado_en),
                  case when v.vigente_desde <= s.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), porcion as (
    -- Lo que faltaba de los insumos que cubre cada línea de OC, por el código de su RQ.
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    -- La parte de la línea que va a cada código; si nada faltaba, a partes iguales.
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), compra_linea as (
    -- La línea sin insumos (la directa, o la OC de antes) va entera al código de la OC.
    select c.id, coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           d.id as detalle_id, d.precio_unitario,
           d.cantidad * d.precio_unitario * coalesce(r.parte, 1) as importe
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
      left join reparto r on r.detalle_id = d.id
     where c.aprobacion <> 'RECHAZADA'
  ), compra as (
    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  ), por_horas as (
    -- Las horas de cada unidad en cada mes: la base del reparto POR HORAS y del
    -- sueldo de la oficina.
    select h.periodo, h.codigo, h.horas, h.total, h.codigos
      from public.horas_por_codigo_del_mes(null) h
     where p_mano_obra
  ), gasto_mes as (
    -- POR HORAS, cada unidad lleva la parte del gasto de sus horas en el mes. Los
    -- registrados antes con TASA llevan esa tasa; en partes iguales, su parte.
    -- La línea lleva el día en que se registró el gasto, no el 1 del mes: el
    -- gasto en dólares toma el cambio de Tesorería de ese día, y cambio_del_dia
    -- solo mira diez días atrás (con el día 1 quedaba sin cambio y trababa el cierre).
    select m.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date as registrado,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n, null::numeric as horas, null::numeric as total, null::numeric as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto <> 'HORAS'
    union all
    select h.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           h.codigos::bigint, h.horas, h.total,
           -- Cada parte al céntimo, y lo que el redondeo deja suelto a la unidad con
           -- más horas: el gasto entero queda repartido, ni un céntimo de más o de menos.
           round(g.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by g.id order by h.horas desc, h.codigo) = 1
                  then g.monto - sum(round(g.monto * h.horas / h.total, 2)) over (partition by g.id) else 0 end as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join por_horas h on h.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto = 'HORAS'
  ), oficina as (
    -- El sueldo de la oficina de cada mes, que se reparte igual que un gasto POR
    -- HORAS, con el residuo del redondeo a la unidad con más horas.
    select o.periodo, o.monto, h.codigo, h.horas, h.total, h.codigos,
           round(o.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by o.periodo order by h.horas desc, h.codigo) = 1
                  then o.monto - sum(round(o.monto * h.horas / h.total, 2)) over (partition by o.periodo) else 0 end as parte
      from public.sueldos_oficina_del_mes(null) o
      join por_horas h on h.periodo = o.periodo
     where p_mano_obra and o.monto > 0
  ), merma as (
    -- La merma que Diseño evaluó en la OT de la unidad va sobre los materiales
    -- con precio del código. Si el código tiene varias OT con merma (una
    -- garantía), manda la última evaluada: sumarlas cobraría dos veces el mismo acero.
    select distinct on (public.normalizar_codigo_interno(u.codigo_interno))
           public.normalizar_codigo_interno(u.codigo_interno) as codigo, mm.id, mm.porcentaje, mm.motivo,
           (mm.registrado_en at time zone 'America/Lima')::date as fecha, o.numero
      from public.ot_mermas mm
      join public.ordenes_trabajo o on o.id = mm.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p_mano_obra and mm.porcentaje > 0 and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
     order by public.normalizar_codigo_interno(u.codigo_interno), mm.registrado_en desc, mm.id
  )
  select h.codigo, h.fuente, h.fecha,
         coalesce(tr.descripcion, case when h.reporte_id is not null then 'Personal general del reporte' end,
                  h.labor, 'Horas cargadas por Recursos Humanos')::text,
         coalesce(rd.asunto, 'Cargadas por Recursos Humanos')::text,
         count(distinct h.trabajador_id)::numeric,
         case when count(distinct h.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         sum(h.horas)::numeric, null::numeric, 'PEN'::text,
         case when h.fuente = 'MANO_OBRA' then round(sum(h.costo), 2) end,
         0, null::text, h.reporte_id
    from horas h
    left join public.reporte_diario_trabajos tr on tr.id = h.trabajo_id
    left join public.reportes_diarios rd on rd.id = h.reporte_id
   where h.codigo is not null and (v_codigo is null or h.codigo = v_codigo)
   group by h.codigo, h.fuente, h.fecha, h.reporte_id, h.trabajo_id, h.labor, tr.descripcion, rd.asunto
  union all
  select v.codigo, case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text,
         (case when not v.a_todos then v.documento_referencia
               when v.entre is null then concat_ws(' · ', 'Cargado a todos los activos: ningún código trabajó ese mes todavía, se reparte cuando alguno trabaje', v.documento_referencia)
               when v.entre = 1 then concat_ws(' · ', 'Cargado a todos los activos: todo a este código, el único que trabajó ese mes', v.documento_referencia)
               else concat_ws(' · ', 'Cargado a todos los activos: partes iguales entre los ' || v.entre || ' códigos que trabajaron ese mes', v.documento_referencia)
          end)::text,
         v.cantidad, um.codigo::text, null::numeric, v.precio, v.moneda_val::text,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         case when v.precio is null then 1 else 0 end, v.rq_numero::text, v.id
    from valorizada v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select c.codigo, 'COMPRAS', c.fecha, c.proveedor::text, null::text, c.lineas,
         case when c.lineas = 1 then 'línea' else 'líneas' end::text, null::numeric, null::numeric, c.moneda::text,
         round(c.monto, 2), c.sin_precio, c.numero::text, c.id
    from compra c
   where c.codigo is not null and (v_codigo is null or c.codigo = v_codigo)
  union all
  select g.codigo, 'GASTOS_DEL_MES', g.registrado, (g.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'))::text,
         (case when g.reparto = 'TASA' then trim(trailing '.' from to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
               when g.reparto = 'HORAS' and g.periodo >= v_mes and g.n = 1 then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina) · ' || g.descripcion
               when g.reparto = 'HORAS' and g.n = 1 then 'Todo a este código, la única unidad con horas ese mes · ' || g.descripcion
               when g.reparto = 'HORAS' then case when g.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(g.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(g.total, 'FM999,999,990.99'))
                                             || ' h del mes, entre ' || g.n || ' unidades · ' || g.descripcion
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2)
              when g.reparto = 'HORAS' then g.parte
              else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
  union all
  select o.codigo, 'GASTOS_DEL_MES', o.periodo, ('Sueldos de la oficina ' || to_char(o.periodo, 'MM/YYYY'))::text,
         (case when o.codigos = 1 and o.periodo >= v_mes then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina)'
               when o.codigos = 1 then 'Todo a este código, la única unidad con horas ese mes'
               else case when o.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(o.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(o.total, 'FM999,999,990.99'))
                    || ' h del mes, entre ' || o.codigos || ' unidades' end
          || ' · costo mensual de RR. HH. de la oficina')::text,
         1::numeric, null::text, null::numeric, o.monto, 'PEN'::text,
         o.parte,
         0, null::text, null::uuid
    from oficina o
   where v_codigo is null or o.codigo = v_codigo
  union all
  select v.codigo, 'MERMA', mm.fecha,
         ('Merma de material ' || trim(trailing '.' from to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
         ('Evaluada por Diseño en la OT ' || mm.numero || ' · ' || mm.motivo)::text,
         1::numeric, null::text, null::numeric, null::numeric, v.moneda_val::text,
         round(sum(round(v.cantidad * v.precio, 2)) * mm.porcentaje / 100, 2),
         0, mm.numero::text, mm.id
    from valorizada v
    join merma mm on mm.codigo = v.codigo
   where v.precio is not null and v.moneda_val in ('PEN', 'USD')
   group by v.codigo, v.moneda_val, mm.id, mm.fecha, mm.porcentaje, mm.motivo, mm.numero
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
  union all
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_gastos_ot(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales (lo salido con el código TODOS LOS ACTIVOS se reparte en partes iguales entre los códigos que trabajaron ese mes), compras (no van al total; la OC con insumos de varios códigos se reparte entre ellos), órdenes de servicio, recibos por honorarios de los subcontratos y, cuando se pide la mano de obra, los gastos del mes (por horas de cada unidad en el mes, con el sueldo de la oficina; los registrados antes con tasa o en partes iguales, así), los egresos de caja con el código, los gastos aprobados en la OT de la unidad, la merma que Diseño evaluó en ella y el recargo de las horas extras. Solo la llaman codigo_interno_costeo (Gerencia), codigos_internos_costo, codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin la mano de obra) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 6. El costeo se cierra cuando el mes de sus horas terminó --------------------------------------
-- La misma función de la 20261017300000, con una condición más: si la unidad
-- tiene horas en el mes en curso, falta que el mes termine. Entregada a mitad de
-- mes, cargaría una parte de los gastos y de la oficina calculada con las pocas
-- horas que van; el resto del mes la movería después de congelada.
create or replace function public.cerrar_costeo_codigo(p_codigo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
  k record;
  v_falta text[] := '{}';
  v_fuentes jsonb;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if v_codigo is null then
    raise exception 'Indica el código interno.' using errcode = 'check_violation';
  end if;
  if v_codigo = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: su costeo no se cierra.' using errcode = 'check_violation';
  end if;
  -- El sistema no sabe todavía cuándo se entrega una unidad: lo dice Gerencia al cerrar.
  if char_length(btrim(coalesce(p_observacion, ''))) not between 10 and 500 then
    raise exception 'Escribe cómo y cuándo se entregó la unidad (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  -- Un reintento no cierra dos veces.
  select id into v_id from public.codigo_interno_cierres where codigo = v_codigo and reabierto_en is null;
  if found then
    return v_id;
  end if;

  select * into k from public.codigos_internos_costo_calculado(v_codigo) where codigo = v_codigo;
  if not found then
    raise exception 'El código % no tiene costos que cerrar.', v_codigo using errcode = 'check_violation';
  end if;
  if k.materiales_sin_precio > 0 then
    v_falta := v_falta || (k.materiales_sin_precio || case when k.materiales_sin_precio = 1 then ' salida del almacén sin precio (la valoriza Logística)'
                                                      else ' salidas del almacén sin precio (las valoriza Logística)' end);
  end if;
  if k.horas_sin_costo > 0 then
    v_falta := v_falta || (trim(to_char(k.horas_sin_costo, 'FM999990.##')) || ' h de personal sin costo mensual (lo pone RR. HH.)');
  end if;
  if k.lineas_sin_cambio > 0 then
    v_falta := v_falta || (k.lineas_sin_cambio || case when k.lineas_sin_cambio = 1 then ' línea en dólares sin tipo de cambio' else ' líneas en dólares sin tipo de cambio' end
                           || ' (lo carga Tesorería)');
  end if;
  -- Con cotización aprobada, el cierre congela también el margen: sin el IGV
  -- confirmado o sin el cambio del día de la venta en dólares quedaría congelado
  -- sin margen, y nada empujaría después a reabrirlo.
  if k.cotizaciones > 0 and k.venta_sin_igv_confirmado > 0 then
    v_falta := v_falta || (case when k.venta_sin_igv_confirmado = 1 then 'confirmar si la cotización incluye IGV'
                                else 'confirmar si ' || k.venta_sin_igv_confirmado || ' cotizaciones incluyen IGV' end
                           || ' (Gerencia o Administración en el expediente de la OT, o Ventas al corregir la cotización)');
  end if;
  if k.cotizaciones > 0 and k.venta_sin_cambio > 0 then
    v_falta := v_falta || 'el tipo de cambio del día en que se aprobó la cotización en dólares (lo carga Tesorería)'::text;
  end if;
  -- Los gastos del mes y el sueldo de la oficina se reparten por las horas de
  -- todo el mes (migración 20261020110000): cerrado a mitad de mes, la unidad se
  -- quedaría con una parte que el resto del mes todavía mueve.
  if exists (select 1 from public.horas_por_codigo_del_mes((now() at time zone 'America/Lima')::date) h where h.codigo = v_codigo) then
    v_falta := v_falta || ('que termine el mes ' || to_char(now() at time zone 'America/Lima', 'MM/YYYY')
                           || ': los gastos del mes y el sueldo de la oficina se reparten por las horas de todo el mes');
  end if;
  if cardinality(v_falta) > 0 then
    raise exception 'El costeo de % todavía no está completo: falta %.', v_codigo, array_to_string(v_falta, '; ')
      using errcode = 'check_violation';
  end if;
  if k.costo_pen <= 0 then
    raise exception 'El código % todavía no tiene costo cargado: no hay nada que congelar.', v_codigo
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_object_agg(f.fuente, f.total), '{}'::jsonb) into v_fuentes
    from (select l.fuente, sum(case when l.moneda = 'PEN' then l.monto
                                    else round(l.monto * public.cambio_del_dia(l.fecha, 'VENTA'), 2) end) as total
            from public.codigo_interno_lineas(v_codigo, true) l
           where l.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')
           group by l.fuente) f;

  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion)
  values (v_codigo, k.costo_pen, k.precio_neto_pen, k.margen_pen, k.margen_pct, v_fuentes, nullif(btrim(coalesce(p_observacion, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.cerrar_costeo_codigo(text, text) is
  'Gerencia cierra el costeo de un código interno al entregar la unidad: congela su costo, su precio sin IGV y su margen, con quién, cuándo y cómo se entregó (la observación, obligatoria). Solo con todo lo que suma completo y, si tiene cotización, con su precio sin IGV en soles. Un reintento devuelve el cierre vigente. Exige codigos_internos.cerrar.';
revoke all on function public.cerrar_costeo_codigo(text, text) from public, anon;
grant execute on function public.cerrar_costeo_codigo(text, text) to authenticated;
