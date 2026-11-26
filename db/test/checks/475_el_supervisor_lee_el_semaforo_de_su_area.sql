-- El supervisor lee el semáforo de las etapas de su área (migración
-- 20261126333000; Plan 1, entrega 1.3).
--
--   1. `etapas_abiertas_de_mi_area` da las etapas sin terminar del área de
--      quien llama, con el mismo semáforo y los mismos días hábiles que el
--      tablero de RR. HH. (`tiempos_de_entrega_etapas_calculado`): no se
--      calcula otro.
--   2. Trae el último reporte del área de ese código: el de hoy se ve.
--   3. El código con el costeo cerrado no sale: ya no se trabaja.
--   4. Solo su área: la etapa terminada no sale, la de Acabados no le sale al
--      de Maestranza y sí al de Acabados. Diseño y Ventas no tienen
--      `reporte_diario.registrar` y no entran.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA475', 'Taller prueba del semáforo') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR:ACB:sup_acb', 'DISENO:DIS:diseno', 'VENDEDOR:GCO:ven'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 3), 'Apellido475', split_part(v, ':', 3) || '.475@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA475'));
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
    perform set_config('prueba.area_' || split_part(v, ':', 3), split_part(v, ':', 2), true);
  end loop;
end $$;

set local session_replication_role = replica;
update public.usuarios u set area_id = a.id
  from public.areas a
 where u.correo like '%.475@prueba.local'
   and a.codigo = current_setting('prueba.area_' || split_part(u.correo, '.475@', 1));

-- QA475-A: etapa de Maestranza empezada y vencida hace 3 días corridos, con reporte de hoy.
-- QA475-B: etapa de Maestranza terminada. QA475-C: etapa de Acabados en marcha.
-- QA475-D: de Maestranza, con el costeo cerrado: ya no se trabaja y no sale.
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por, de_area)
select x.codigo, 1, x.nombre, a.id, current_date - 6, current_date + x.fin, current_date - 5, x.fin_real, current_setting('prueba.sup_mtz')::uuid, true
  from (values ('QA475-A', 'Armado (prueba 475)', 'MTZ', -3, null::date),
               ('QA475-B', 'Corte (prueba 475)', 'MTZ', -1, current_date - 1),
               ('QA475-C', 'Pintura (prueba 475)', 'ACB', 2, null::date),
               ('QA475-D', 'Forrado (prueba 475)', 'MTZ', 4, null::date)) x(codigo, nombre, area, fin, fin_real)
  join public.areas a on a.codigo = x.area;
insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
select (now() at time zone 'America/Lima')::date, 'QA475-A', 'Avance (prueba 475)', 'Se avanzó.', a.id, current_setting('prueba.sup_mtz')::uuid
  from public.areas a where a.codigo = 'MTZ';
insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
values ('QA475-D', 0, '{}'::jsonb, current_setting('prueba.sup_mtz')::uuid);
set local session_replication_role = origin;

create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
create or replace function pg_temp.codigos() returns text language sql as $$
  select coalesce(string_agg(codigo, ' ' order by codigo), '(nada)') from public.etapas_abiertas_de_mi_area() where codigo like 'QA475-%';
$$;

-- El semáforo del tablero, sacado como postgres para compararlo.
create temp table esperado on commit drop as
select e.codigo, e.semaforo, e.dias_habiles from public.tiempos_de_entrega_etapas_calculado(null) e where e.codigo like 'QA475-%';
grant select on esperado to authenticated;

-- El cerrado sí está en el tablero: lo que lo saca es el cierre.
select test.afirmar(exists (select 1 from public.tiempos_de_entrega_etapas_calculado(null) where codigo = 'QA475-D'), 'QA475-D está en el tablero');

-- 1 y 2. Maestranza: solo su etapa abierta (ni la terminada ni la de costeo cerrado), con el semáforo del tablero y el reporte de hoy.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.codigos() = 'QA475-A', 'sup_mtz ve solo su etapa abierta: ' || pg_temp.codigos());
select test.afirmar(
  (select e.semaforo = x.semaforo and e.dias_habiles = x.dias_habiles and e.semaforo = 'ROJO' and e.dias_habiles < 0
     from public.etapas_abiertas_de_mi_area() e join esperado x on x.codigo = e.codigo where e.codigo = 'QA475-A'),
  'la etapa vencida trae el semáforo y los días hábiles del tablero de RR. HH.');
select test.afirmar(
  (select ultimo_reporte = (now() at time zone 'America/Lima')::date from public.etapas_abiertas_de_mi_area() where codigo = 'QA475-A'),
  'trae el reporte de hoy de su área');
reset role;

-- 3. Acabados ve la suya y no la de Maestranza.
select pg_temp.como('sup_acb');
set local role authenticated;
select test.afirmar(pg_temp.codigos() = 'QA475-C', 'sup_acb ve solo la de Acabados: ' || pg_temp.codigos());
select test.afirmar(
  (select e.semaforo = x.semaforo and e.dias_habiles = x.dias_habiles
     from public.etapas_abiertas_de_mi_area() e join esperado x on x.codigo = e.codigo where e.codigo = 'QA475-C'),
  'la de Acabados trae el semáforo del tablero');
reset role;

-- Diseño y Ventas no reportan el día: no entran.
select pg_temp.como('diseno');
set local role authenticated;
select test.debe_fallar('select * from public.etapas_abiertas_de_mi_area()', 'Diseño no lee las etapas por reportar', 'reporte_diario.registrar');
reset role;
select pg_temp.como('ven');
set local role authenticated;
select test.debe_fallar('select * from public.etapas_abiertas_de_mi_area()', 'Ventas no lee las etapas por reportar', 'reporte_diario.registrar');
reset role;

-- Nadie anónimo.
select test.afirmar(not has_function_privilege('anon', 'public.etapas_abiertas_de_mi_area()', 'execute'), 'anon no la ejecuta');

rollback;
