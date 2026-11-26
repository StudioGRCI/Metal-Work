-- El supervisor lee el semáforo de las etapas de su área (migraciones
-- 20261126333000 y 20261126336000; Plan 1, entrega 1.3).
--
--   1. `etapas_abiertas_de_mi_area` da las etapas sin terminar del área de
--      quien llama, con el mismo semáforo y los mismos días hábiles que el
--      tablero de RR. HH. (`tiempos_de_entrega_etapas_calculado`): no se
--      calcula otro.
--   2. Trae el último reporte del área de ese código: el de hoy se ve.
--   3. El código con el costeo cerrado no sale: ya no se trabaja.
--   3b. El de una OT pausada sigue en `etapas_abiertas_de_mi_area`, con el plazo
--      del tablero para su tarjeta, y `codigos_pausados_de_mi_area` lo da para
--      que la bandeja no le pida el reporte (DKS, 2026-11-26). No lo da si la OT
--      está terminada o en control de calidad, ni si el código tiene otra OT
--      abierta (en marcha, o también pausada: el límite que se aceptó).
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
-- QA475-E: de Maestranza, con su única OT pausada: pausado.
-- QA475-F: de Maestranza, con una OT pausada que se entrega antes y otra en proceso: no pausado.
-- QA475-G: de Maestranza, con su OT terminada y la etapa sin cerrar: no pausado.
-- QA475-H: de Maestranza, con su OT en control de calidad: no pausado.
-- QA475-I: de Maestranza, con dos OT pausadas: el tablero cuenta dos abiertas y no se da por pausado.
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por, de_area)
select x.codigo, 1, x.nombre, a.id, current_date - 6, current_date + x.fin, current_date - 5, x.fin_real, current_setting('prueba.sup_mtz')::uuid, true
  from (values ('QA475-A', 'Armado (prueba 475)', 'MTZ', -3, null::date),
               ('QA475-B', 'Corte (prueba 475)', 'MTZ', -1, current_date - 1),
               ('QA475-C', 'Pintura (prueba 475)', 'ACB', 2, null::date),
               ('QA475-D', 'Forrado (prueba 475)', 'MTZ', 4, null::date),
               ('QA475-E', 'Soldadura (prueba 475)', 'MTZ', 4, null::date),
               ('QA475-F', 'Estructura (prueba 475)', 'MTZ', 4, null::date),
               ('QA475-G', 'Puertas (prueba 475)', 'MTZ', 4, null::date),
               ('QA475-H', 'Pintura final (prueba 475)', 'MTZ', 4, null::date),
               ('QA475-I', 'Chasis (prueba 475)', 'MTZ', 4, null::date)) x(codigo, nombre, area, fin, fin_real)
  join public.areas a on a.codigo = x.area;
insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
select (now() at time zone 'America/Lima')::date, 'QA475-A', 'Avance (prueba 475)', 'Se avanzó.', a.id, current_setting('prueba.sup_mtz')::uuid
  from public.areas a where a.codigo = 'MTZ';
insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
values ('QA475-D', 0, '{}'::jsonb, current_setting('prueba.sup_mtz')::uuid);
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20999475011', 'CLIENTE DE PRUEBA 475 S.A.C.');
insert into public.unidades (cliente_id, codigo_interno, marca)
select c.id, x.codigo, 'Prueba'
  from public.clientes c, (values ('QA475-E'), ('QA475-F'), ('QA475-G'), ('QA475-H'), ('QA475-I')) x(codigo)
 where c.numero_documento = '20999475011';
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, descripcion, estado, motivo_pausa, fecha_entrega_comprometida)
select x.numero, u.cliente_id, u.id, (select id from public.sedes where codigo = 'QA475'), 'Check 475 · ' || x.numero,
       x.estado::public.estado_ot, case when x.estado = 'PAUSADA' then 'Espera repuestos (prueba 475)' end, current_date + x.entrega
  from (values ('QA475-E', 'QA475-E1', 'PAUSADA', 5),
               ('QA475-F', 'QA475-F1', 'PAUSADA', 2),
               ('QA475-F', 'QA475-F2', 'EN_PROCESO', 10),
               ('QA475-G', 'QA475-G1', 'TERMINADA', 5),
               ('QA475-H', 'QA475-H1', 'CONTROL_CALIDAD', 5),
               ('QA475-I', 'QA475-I1', 'PAUSADA', 5),
               ('QA475-I', 'QA475-I2', 'PAUSADA', 8)) x(codigo, numero, estado, entrega)
  join public.unidades u on u.codigo_interno = x.codigo;
set local session_replication_role = origin;

create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
create or replace function pg_temp.codigos() returns text language sql as $$
  select coalesce(string_agg(codigo, ' ' order by codigo), '(nada)') from public.etapas_abiertas_de_mi_area() where codigo like 'QA475-%';
$$;
create or replace function pg_temp.pausados() returns text language sql as $$
  select coalesce(string_agg(codigo, ' ' order by codigo), '(nada)') from public.codigos_pausados_de_mi_area() where codigo like 'QA475-%';
$$;

-- El semáforo del tablero, sacado como postgres para compararlo.
create temp table esperado on commit drop as
select e.codigo, e.semaforo, e.dias_habiles from public.tiempos_de_entrega_etapas_calculado(null) e where e.codigo like 'QA475-%';
grant select on esperado to authenticated;

-- El cerrado sí está en el tablero: lo que lo saca es el cierre.
select test.afirmar(exists (select 1 from public.tiempos_de_entrega_etapas_calculado(null) where codigo = 'QA475-D'), 'QA475-D está en el tablero');

-- La pausada sí está en el tablero, con el estado de su OT: lo que la saca es la pausa.
select test.afirmar(
  (select c.ot_estado = 'PAUSADA' and c.ots_abiertas = 1 from public.tiempos_de_entrega_codigos_calculado('QA475-E') c),
  'QA475-E está en el tablero con su OT pausada');
select test.afirmar(
  (select c.ot_estado = 'PAUSADA' and c.ots_abiertas = 2 from public.tiempos_de_entrega_codigos_calculado('QA475-F') c),
  'en QA475-F manda en el tablero la OT pausada, que se entrega antes');

-- 1 y 2. Maestranza: solo sus etapas abiertas (ni la terminada ni la de costeo
-- cerrado), con el semáforo del tablero y el reporte de hoy. La pausada sigue,
-- con su plazo del tablero: la tarjeta lo muestra.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.codigos() = 'QA475-A QA475-E QA475-F QA475-G QA475-H QA475-I',
  'sup_mtz ve sus etapas abiertas, también la pausada: ' || pg_temp.codigos());
select test.afirmar(
  (select e.semaforo = x.semaforo and e.dias_habiles = x.dias_habiles
     from public.etapas_abiertas_de_mi_area() e join esperado x on x.codigo = e.codigo where e.codigo = 'QA475-E'),
  'la etapa del código pausado trae el semáforo del tablero, para su tarjeta');
-- 3b. Lo que la bandeja no pide: solo el código de la única OT pausada.
select test.afirmar(pg_temp.pausados() = 'QA475-E', 'el pausado de Maestranza es solo QA475-E (ni el de otra OT en marcha, ni terminado, ni en calidad, ni el de dos pausadas): ' || pg_temp.pausados());
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
select test.afirmar(pg_temp.pausados() = '(nada)', 'a Acabados no le sale el pausado de Maestranza: ' || pg_temp.pausados());
select test.afirmar(
  (select e.semaforo = x.semaforo and e.dias_habiles = x.dias_habiles
     from public.etapas_abiertas_de_mi_area() e join esperado x on x.codigo = e.codigo where e.codigo = 'QA475-C'),
  'la de Acabados trae el semáforo del tablero');
reset role;

-- Diseño y Ventas no reportan el día: no entran.
select pg_temp.como('diseno');
set local role authenticated;
select test.debe_fallar('select * from public.etapas_abiertas_de_mi_area()', 'Diseño no lee las etapas por reportar', 'reporte_diario.registrar');
select test.debe_fallar('select * from public.codigos_pausados_de_mi_area()', 'Diseño no lee los códigos pausados', 'reporte_diario.registrar');
reset role;
select pg_temp.como('ven');
set local role authenticated;
select test.debe_fallar('select * from public.etapas_abiertas_de_mi_area()', 'Ventas no lee las etapas por reportar', 'reporte_diario.registrar');
select test.debe_fallar('select * from public.codigos_pausados_de_mi_area()', 'Ventas no lee los códigos pausados', 'reporte_diario.registrar');
reset role;

-- Nadie anónimo.
select test.afirmar(not has_function_privilege('anon', 'public.etapas_abiertas_de_mi_area()', 'execute'), 'anon no la ejecuta');
select test.afirmar(not has_function_privilege('anon', 'public.codigos_pausados_de_mi_area()', 'execute'), 'anon no ejecuta la de los pausados');

rollback;
