-- Lo que se le paga a la oficina se cuenta una sola vez en todo Metal Work,
-- también cuando esa gente carga horas a PLANTA u OFICINA o pasa a la planilla de
-- taller a mitad de mes (migraciones 20261128110000 y 20261128111000; DKS,
-- 2026-11-28: «descontarlas del sueldo que se reparte»).
--
--   1. Elsa, de planilla administrativa, cobra 1 200 por la primera quincena de
--      noviembre de 2026 y carga 10 h a PLANTA el 10 (100). El sueldo de la
--      oficina que se reparte es 1 100, y PLANTA lleva 100 de gasto operativo.
--   2. El 16 pasa a la planilla de taller y carga 80 h a la unidad (800). La
--      planilla de taller de noviembre le paga 1 300: el ajuste es 1 300 − 800 =
--      500, sin volver a restar las 10 h del tramo de oficina.
--   3. Oficina 1 100 + horas 900 + ajuste 500 = 2 500, lo que se le pagó.
--
-- Noviembre de 2026 porque desde ahí la planilla de taller ajusta el costo
-- (planilla_ajuste_desde). Las horas se cargan a mano: rrhh_registrar_tareo no
-- acepta días de hace más de un año y la prueba tiene que seguir valiendo.
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA01', 'Taller prueba de las horas de la oficina') on conflict (codigo) do nothing;
select test.crear_usuario('Rita', 'Humanos', 'rrhh507@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA01')) as rrhh_id \gset
select test.crear_usuario('Gino', 'Gerente', 'gerencia507@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA01')) as gerente_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina507@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA01')) as oficina_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin507@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA01')) as admin_id \gset
select set_config('prueba.rrhh', :'rrhh_id', true);

-- ------------------------------------------------------------- Armazón (ADMIN)
select test.como_usuario(:'admin_id');
do $$
declare v_id uuid;
begin
  perform test.afirmar(not exists (select 1 from public.tareos t where t.fecha between date '2026-11-01' and date '2026-11-30')
                       and not exists (select 1 from public.reporte_diario_personal l where l.fecha between date '2026-11-01' and date '2026-11-30')
                       and not exists (select 1 from public.planillas p where p.tipo = 'TALLER' and p.periodo = date '2026-11-01'),
    'la base no tiene horas ni planilla de taller en noviembre de 2026: los números son solo de esta prueba');
  -- La oficina que ya está en la base sale antes de 2026 dentro de esta prueba (se deshace al final).
  update public.trabajadores w set activo = false, fecha_ingreso = date '2020-12-01', fecha_baja = date '2020-12-31'
   where w.planilla = 'ADMINISTRATIVA';
  insert into public.trabajadores (nombres, apellidos, dni, area_id, activo, fecha_ingreso, planilla)
  values ('Elsa', 'Check 507', '50700001', (select id from public.areas where codigo = 'ADM'), true, date '2026-01-05', 'ADMINISTRATIVA')
  returning id into v_id;
  perform set_config('prueba.elsa', v_id::text, true);
end $$;

-- RR. HH.: su costo y el pago de la primera quincena, cuando aún es de la oficina.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_costo_trabajador(current_setting('prueba.elsa')::uuid, 2400);
select public.rrhh_registrar_pago_oficina(gen_random_uuid(), current_setting('prueba.elsa')::uuid,
                                          date '2026-11-01', date '2026-11-15', 1200, 0, null);
reset role;

-- Sus horas a S/ 10 (2 400 / 240): 10 h a PLANTA el 10, y 80 h a la unidad del 16 al 23.
select test.como_usuario(:'admin_id');
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
values (current_setting('prueba.elsa')::uuid, date '2026-11-10', 'PLANTA', 10, 'Orden del almacén', 10, 100);
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
select current_setting('prueba.elsa')::uuid, d::date, 'CHK507_U_26/11', 10, 'Armado', 10, 100
  from generate_series(date '2026-11-16', date '2026-11-23', interval '1 day') d;

-- ---------------------------------------------------- 1. La oficina y PLANTA (Gerencia)
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select o.monto from public.gastos_del_mes_oficina(date '2026-11-01') o) = 1100,
  format('el sueldo de la oficina que se reparte es 1 200 menos sus 100 en PLANTA: %s',
         (select o.monto from public.gastos_del_mes_oficina(date '2026-11-01') o)));
select test.afirmar((select sum(l.monto) from public.codigo_interno_costeo('PLANTA') l
                      where l.fuente = 'MANO_OBRA' and l.fecha between date '2026-11-01' and date '2026-11-30') = 100,
  'sus 10 h siguen en la mano de obra de PLANTA, por su costo');
select test.afirmar((select sum(l.monto) from public.codigo_interno_costeo('CHK507_U_26/11') l
                      where l.concepto = 'Sueldos de la oficina 11/2026') = 1100,
  'la unidad, la única con horas, lleva el sueldo de la oficina sin lo de PLANTA');
reset role;

select test.como_usuario(:'oficina_id');
set local role authenticated;
select test.afirmar((select o.monto from public.gastos_del_mes_oficina(date '2026-11-01') o) = 1100,
  'Administración ve el mismo sueldo de la oficina');
reset role;

-- ------------------------------- 2. Pasa a la planilla de taller y la planilla se cierra
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_planilla_trabajador(current_setting('prueba.elsa')::uuid, 'TALLER');
reset role;
-- La planilla se arma como RR. HH. y se cierra directo: el cierre con su pantalla
-- es de otro check (la planilla de taller); aquí importa el costo que deja.
do $$
declare v_pl uuid;
begin
  insert into public.planillas (tipo, periodo, moneda, estado, registrado_por)
  values ('TALLER', date '2026-11-01', 'PEN', 'BORRADOR', current_setting('prueba.rrhh')::uuid) returning id into v_pl;
  insert into public.planilla_personas (planilla_id, nombre, documento, monto, registrado_por)
  values (v_pl, 'Elsa Check 507', '50700001', 1300, current_setting('prueba.rrhh')::uuid);
  update public.planillas set estado = 'CERRADA', cerrado_por = current_setting('prueba.rrhh')::uuid, cerrado_en = now()
   where id = v_pl;
end $$;

select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select sum(l.monto) from public.codigo_interno_costeo(null) l
                      where l.concepto = 'Ajuste de la planilla de taller 11/2026') = 500,
  format('el ajuste es 1 300 menos sus 800 de taller, sin restar otra vez las 10 h de la oficina: %s',
         (select sum(l.monto) from public.codigo_interno_costeo(null) l where l.concepto = 'Ajuste de la planilla de taller 11/2026')));
select test.afirmar(not exists (select 1 from public.codigo_interno_costeo('PLANTA') l
                                 where l.concepto = 'Ajuste de la planilla de taller 11/2026'),
  'el ajuste se reparte por sus horas de taller: nada a PLANTA, que es de su tramo de oficina');

-- ------------------------------------------- 3. Lo pagado se cuenta una vez: 2 500
select test.afirmar((select o.monto from public.gastos_del_mes_oficina(date '2026-11-01') o)
                    + (select sum(l.monto) from public.codigo_interno_costeo(null) l
                        where l.fecha between date '2026-11-01' and date '2026-11-30'
                          and (l.fuente = 'MANO_OBRA'))
                    = 2500,
  format('oficina + horas + ajuste = lo pagado (1 200 + 1 300): %s',
         (select o.monto from public.gastos_del_mes_oficina(date '2026-11-01') o)
         + (select sum(l.monto) from public.codigo_interno_costeo(null) l
             where l.fecha between date '2026-11-01' and date '2026-11-30' and l.fuente = 'MANO_OBRA')));
reset role;

select 'CHECK 507 OK' as resultado;
rollback;
