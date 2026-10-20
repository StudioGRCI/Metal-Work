-- Los gastos del mes se reparten por horas, y la oficina entra al costo
-- (migración 20261020110000). DKS eligió el 2026-10-20 «Por horas + oficina».
--
--   1. Administración registra un gasto POR HORAS; con tasa o en partes
--      iguales ya no entra, y quien no es de Administración no lo registra.
--   2. Cada unidad carga la parte del gasto de sus horas en el mes; PLANTA y
--      OFICINA no reciben, y el gasto entero queda repartido.
--   3. El sueldo de la oficina entra solo, repartido igual: el costo mensual de
--      RR. HH. de los activos de las áreas marcadas como oficina, sin lo que ya
--      cargaron en horas a una unidad. El taller, el almacén, el inactivo y el que
--      entró después no cuentan; el que no tiene área se cuenta aparte.
--   4. Un mes sin horas no reparte: el gasto espera hasta que alguien reporte.
--   5. La pantalla de Gastos del mes: Administración y Gerencia ven el reparto
--      y la oficina sumada; Ventas no.
--   6. Un mes pasado no cambia porque RR. HH. suba un sueldo o dé de baja a
--      alguien hoy; el mes en curso sigue al día.
--
-- Todo pasa en marzo y mayo de 2021, para que las horas y el personal que la
-- base ya tenga no muevan los números. Cada paso con la cuenta del puesto
-- —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA01', 'Taller prueba de gastos del mes') on conflict (codigo) do nothing;
select test.crear_usuario('Olga', 'Oficina', 'oficina401@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA01')) as oficina_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia401@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA01')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas401@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA01')) as vendedor_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh401@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA01')) as rrhh_id \gset
select test.crear_usuario('Coco', 'Costos', 'costos401@demo.pe', 'COSTOS_MATERIALES', (select id from public.sedes where codigo = 'QA01')) as costos_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin401@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA01')) as admin_id \gset
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.luz', gen_random_uuid()::text, true);
select set_config('prueba.agua', gen_random_uuid()::text, true);

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
-- Lo que lleva el código de un gasto (por su id) o del sueldo de la oficina (sin id), leído por Gerencia.
create or replace function pg_temp.gasto(p_codigo text, p_concepto text) returns numeric language sql as $$
  select coalesce(sum(l.monto), 0) from public.codigo_interno_costeo(p_codigo) l
   where l.fuente = 'GASTOS_DEL_MES' and l.concepto like p_concepto || '%';
$$;

-- ----------------------------------------- Armazón (ADMIN): la gente, sus costos y sus horas
-- Ana (Administración, S/ 3,000), Caro (Administración, S/ 2,000, que cargó 10 h a
-- la unidad A a S/ 10), Beto (Maestranza, S/ 2,400), Dani (sin área, S/ 1,000),
-- Eli (Administración, de baja), Fico (Administración, entra cuando marzo ya tiene horas) y Gil
-- (Almacén, S/ 1,500: apoya al taller, no es oficina).
-- Marzo: A 40 h (30 de Beto y 10 de Caro), B 10 h; PLANTA 5 h y OFICINA 4 h no son unidades.
select test.como_usuario(:'admin_id');
do $$
declare v_nombre text; v_area text; v_costo numeric; v_activo boolean; v_alta date; v_id uuid;
begin
  perform test.afirmar(not exists (select 1 from public.horas_por_codigo_del_mes(date '2021-03-01'))
                       and not exists (select 1 from public.horas_por_codigo_del_mes(date '2021-05-01')),
    'la base no tiene horas en marzo ni mayo de 2021: los números de esta prueba son solo suyos');
  -- La oficina es la gente activa de hoy: la que ya está en la base, de baja dentro
  -- de esta prueba (se deshace al final), para que los números sean solo de ella.
  update public.trabajadores w set activo = false
   where w.activo and exists (select 1 from public.trabajador_costos c where c.trabajador_id = w.id)
     and (w.area_id is null or w.area_id in (select a.id from public.areas a where a.es_oficina));
  for v_nombre, v_area, v_costo, v_activo, v_alta in
    select * from (values ('Ana', 'ADM', 3000, true, date '2021-01-04'), ('Caro', 'ADM', 2000, true, date '2021-01-04'),
                          ('Beto', 'MTZ', 2400, true, date '2021-01-04'), ('Dani', null, 1000, true, date '2021-01-04'),
                          ('Eli', 'ADM', 5000, false, date '2021-01-04'), 
                          ('Gil', 'ALM', 1500, true, date '2021-01-04')) x
  loop
    insert into public.trabajadores (nombres, apellidos, dni, area_id, activo, creado_en)
    values (v_nombre, 'Check 401', '4010' || lpad((length(v_nombre) * 7 + ascii(v_nombre))::text, 4, '0'),
            (select id from public.areas where codigo = v_area), v_activo, v_alta)
    returning id into v_id;
    insert into public.trabajador_costos (trabajador_id, costo_mensual) values (v_id, v_costo);
    perform set_config('prueba.' || lower(v_nombre), v_id::text, true);
  end loop;
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo) values
    (current_setting('prueba.beto')::uuid, date '2021-03-08', 'CHK401_A_21/03', 10, 'Soldadura', 10, 100),
    (current_setting('prueba.beto')::uuid, date '2021-03-09', 'CHK401_A_21/03', 10, 'Soldadura', 10, 100),
    (current_setting('prueba.beto')::uuid, date '2021-03-10', 'CHK401_A_21/03', 10, 'Soldadura', 10, 100),
    (current_setting('prueba.beto')::uuid, date '2021-03-11', 'CHK401_B_21/03', 10, 'Armado', 10, 100),
    (current_setting('prueba.beto')::uuid, date '2021-03-12', 'PLANTA', 5, 'Orden del taller', 10, 50),
    (current_setting('prueba.caro')::uuid, date '2021-03-12', 'OFICINA', 4, 'Archivo', 10, 40),
    (current_setting('prueba.caro')::uuid, date '2021-03-15', 'CHK401_A_21/03', 10, 'Compras en obra', 10, 100);
end $$;
-- Fico entra a la oficina con marzo ya trabajado: RR. HH. le pone su primer costo
-- y eso anota antes los meses pasados, así que no llega a ninguno.
insert into public.trabajadores (nombres, apellidos, dni, area_id, activo)
values ('Fico', 'Check 401', '40109998', (select id from public.areas where codigo = 'ADM'), true)
returning id as fico_id \gset
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_costo_trabajador(:'fico_id'::uuid, 9000);
reset role;
select test.como_usuario(:'admin_id');

-- ------------------------------------------------- 1. Administración registra POR HORAS
select pg_temp.como('oficina');
set local role authenticated;
select public.registrar_gasto_general(current_setting('prueba.luz')::uuid, date '2021-03-20', 'ELECTRICIDAD',
  'Recibo de luz de marzo', 1000, 'PEN', 'HORAS', null);
select test.afirmar(public.registrar_gasto_general(current_setting('prueba.luz')::uuid, date '2021-03-20', 'ELECTRICIDAD',
  'Recibo de luz de marzo', 1000, 'PEN', 'HORAS', null) = current_setting('prueba.luz')::uuid,
  'el reintento del mismo gasto devuelve el mismo, sin duplicarlo');
select test.debe_fallar($q$select public.registrar_gasto_general(gen_random_uuid(), date '2021-03-20', 'AGUA',
  'Por horas con tasa', 100, 'PEN', 'HORAS', 5)$q$, 'por horas no lleva tasa', 'se reparten por horas');
select test.debe_fallar($q$select public.registrar_gasto_general(gen_random_uuid(), date '2021-03-20', 'AGUA',
  'Con la tasa de la hoja', 100, 'PEN', 'TASA', 10)$q$, 'con tasa ya no se registra', 'se reparten por horas');
select test.debe_fallar($q$select public.registrar_gasto_general(gen_random_uuid(), date '2021-03-20', 'AGUA',
  'En partes iguales', 100, 'PEN', 'PARTES_IGUALES', null)$q$, 'en partes iguales ya no se registra', 'se reparten por horas');
select test.debe_fallar($q$select public.registrar_gasto_general(gen_random_uuid(), date '2021-03-20', 'AGUA',
  'Reparto inventado', 100, 'PEN', 'A_OJO', null)$q$, 'otra forma de reparto no entra', 'se reparten por horas');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($q$select public.registrar_gasto_general(gen_random_uuid(), date '2021-03-20', 'AGUA',
  'Ventas no registra gastos', 100, 'PEN', 'HORAS', null)$q$, 'Ventas no registra gastos del mes', 'costos.gastos_generales');
reset role;

-- ---------------------------------- 2 y 3. Gerencia ve cada unidad con su parte, y la oficina
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.gasto('CHK401_A_21/03', 'Electricidad') = 800,
  format('A, con 40 de 50 h, carga 800 de la luz: carga %s', pg_temp.gasto('CHK401_A_21/03', 'Electricidad')));
select test.afirmar(pg_temp.gasto('CHK401_B_21/03', 'Electricidad') = 200,
  format('B, con 10 de 50 h, carga 200 de la luz: carga %s', pg_temp.gasto('CHK401_B_21/03', 'Electricidad')));
select test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK401_A_21/03') l
                             where l.fuente = 'GASTOS_DEL_MES' and l.detalle = 'Por horas: 40 de 50 h del mes, entre 2 unidades · Recibo de luz de marzo'),
  'la línea dice de dónde sale: sus horas, las del mes y entre cuántas unidades');
-- Oficina: Ana 3,000 y Caro 2,000 menos sus 100 en la unidad A = 4,900; A carga 4/5 y B 1/5.
select test.afirmar(pg_temp.gasto('CHK401_A_21/03', 'Sueldos de la oficina 03/2021') = 3920,
  format('A carga 3,920 de los 4,900 de la oficina: carga %s', pg_temp.gasto('CHK401_A_21/03', 'Sueldos de la oficina 03/2021')));
select test.afirmar(pg_temp.gasto('CHK401_B_21/03', 'Sueldos de la oficina 03/2021') = 980,
  format('B carga 980 de la oficina: carga %s', pg_temp.gasto('CHK401_B_21/03', 'Sueldos de la oficina 03/2021')));
select test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK401_B_21/03') l
                             where l.concepto = 'Sueldos de la oficina 03/2021'
                               and l.detalle = 'Por horas: 10 de 50 h del mes, entre 2 unidades · costo mensual de RR. HH. de la oficina'
                               and l.precio_unitario = 4900 and l.moneda = 'PEN'),
  'la línea de la oficina dice el total del mes, sin nombres ni cuántas personas');
select test.afirmar(pg_temp.gasto('PLANTA', '') = 0 and pg_temp.gasto('OFICINA', '') = 0,
  'PLANTA y OFICINA no son unidades: no reciben gastos del mes');
select test.afirmar((select sum(l.monto) from public.codigo_interno_costeo(null) l
                      where l.fuente = 'GASTOS_DEL_MES' and l.referencia_id = current_setting('prueba.luz')::uuid) = 1000,
  'la luz entera queda repartida entre las unidades');
-- La mano de obra no cambia: Caro sigue con sus 100 en A, y no vuelven a cobrarse en la oficina.
select test.afirmar((select sum(l.monto) from public.codigo_interno_costeo('CHK401_A_21/03') l where l.fuente = 'MANO_OBRA') = 400,
  'la mano de obra de A sigue siendo la del tareo (300 de Beto y 100 de Caro)');
reset role;

-- ------------------------------------------- 4. Un mes sin horas no reparte hasta que las haya
select pg_temp.como('oficina');
set local role authenticated;
select public.registrar_gasto_general(current_setting('prueba.agua')::uuid, date '2021-05-03', 'AGUA',
  'Recibo de agua de mayo', 300, 'PEN', 'HORAS', null);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(not exists (select 1 from public.codigo_interno_costeo(null) l
                                 where l.fuente = 'GASTOS_DEL_MES' and (l.referencia_id = current_setting('prueba.agua')::uuid
                                                                        or l.concepto like 'Sueldos de la oficina 05/2021%')),
  'en mayo nadie reportó horas: el agua y la oficina esperan');
reset role;
select test.como_usuario(:'admin_id');
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
values (current_setting('prueba.beto')::uuid, date '2021-05-04', 'CHK401_B_21/03', 8, 'Pintura', 10, 80);
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK401_B_21/03') l
                             where l.referencia_id = current_setting('prueba.agua')::uuid and l.monto = 300
                               and l.detalle = 'Todo a este código, la única unidad con horas ese mes · Recibo de agua de mayo'),
  'con las primeras horas de mayo, el agua entera va a la única unidad que trabajó');
-- Mayo ya era pasado cuando entró Fico: Ana y Caro, 3,000 + 2,000.
select test.afirmar(pg_temp.gasto('CHK401_B_21/03', 'Sueldos de la oficina 05/2021') = 5000,
  format('la oficina de mayo es la de cuando se anotó, sin Fico: %s', pg_temp.gasto('CHK401_B_21/03', 'Sueldos de la oficina 05/2021')));
reset role;

-- ------------------------------------------------------------- 5. La pantalla de Gastos del mes
select pg_temp.como('oficina');
set local role authenticated;
select test.afirmar((select string_agg(r.codigo || ' ' || r.horas::text || ' ' || r.parte::text, ' | ' order by r.horas desc)
                       from public.gastos_del_mes_reparto(date '2021-03-01') r) = 'CHK401_A_21/03 40.00 80.00 | CHK401_B_21/03 10.00 20.00',
  format('Administración ve entre quiénes se reparte marzo: %s',
         (select string_agg(r.codigo || ' ' || r.horas::text || ' ' || r.parte::text, ' | ' order by r.horas desc)
            from public.gastos_del_mes_reparto(date '2021-03-01') r)));
select test.afirmar((select o.monto = 4900 and o.sin_area = 0 from public.gastos_del_mes_oficina(date '2021-03-01') o),
  'Administración ve la oficina de marzo sumada (S/ 4,900), sin cuántas personas; marzo ya está anotado y no avisa de nadie sin área');
select test.afirmar((select o.sin_area = 1 from public.gastos_del_mes_oficina(date_trunc('month', now() at time zone 'America/Lima')::date) o),
  'en el mes en curso sí avisa: Dani tiene costo y no tiene área');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.gastos_del_mes_reparto(date '2021-03-01')) = 2
                    and (select o.monto from public.gastos_del_mes_oficina(date '2021-03-01') o) = 4900,
  'Gerencia, que ve los costos, ve el mismo reparto');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($q$select * from public.gastos_del_mes_reparto(date '2021-03-01')$q$,
  'Ventas no ve el reparto de los gastos del mes', 'costos.gastos_generales');
select test.debe_fallar($q$select * from public.gastos_del_mes_oficina(date '2021-03-01')$q$,
  'Ventas no ve lo que cuesta la oficina', 'codigos_internos.ver');
select test.debe_fallar($q$select * from public.sueldos_oficina_del_mes(date '2021-03-01')$q$,
  'nadie llama desde fuera la función interna de la oficina', 'permission denied');
select test.debe_fallar($q$select * from public.horas_por_codigo_del_mes(date '2021-03-01')$q$,
  'nadie llama desde fuera la función interna de las horas', 'permission denied');
reset role;

-- Costos y Materiales ve los costos (costos.ver) y el reparto, pero no el costeo de
-- cada código: el total de la oficina no lo lee, que mes a mes delataría un sueldo.
select test.como_usuario(:'costos_id');
set local role authenticated;
select test.afirmar((select count(*) from public.gastos_del_mes_reparto(date '2021-03-01')) = 2,
  'Costos y Materiales ve entre quiénes se reparte marzo');
select test.debe_fallar($q$select * from public.gastos_del_mes_oficina(date '2021-03-01')$q$,
  'Costos y Materiales no lee el total de la oficina suelto', 'codigos_internos.ver');
-- Pero el costo de la unidad es el mismo para todo puesto: lleva su parte de la
-- oficina (luz 800 + oficina 3,920 en A). Si eso se tapa, lo decide DKS.
select test.afirmar((select c.gastos_mes_pen from public.codigos_internos_costo('CHK401_A_21/03') c) = 800 + 3920,
  format('Costos y Materiales ve el costo de A con su parte de la oficina: %s',
         (select c.gastos_mes_pen from public.codigos_internos_costo('CHK401_A_21/03') c)));
reset role;

-- ------------------------------------- 6. Un mes pasado no cambia con el personal de hoy
-- RR. HH. le sube el costo a Ana y da de baja a Caro: marzo y mayo siguen como eran.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_costo_trabajador(current_setting('prueba.ana')::uuid, 4000);
select public.rrhh_cambiar_estado_trabajador(current_setting('prueba.caro')::uuid, false);
reset role;
select test.afirmar((select o.monto from public.sueldos_oficina_del_mes(date '2021-03-01') o) = 4900,
  format('marzo sigue con S/ 4,900 de oficina: %s', (select o.monto from public.sueldos_oficina_del_mes(date '2021-03-01') o)));
select test.afirmar((select o.monto from public.sueldos_oficina_del_mes(date '2021-05-01') o) = 5000,
  format('mayo sigue con S/ 5,000: %s', (select o.monto from public.sueldos_oficina_del_mes(date '2021-05-01') o)));
select test.afirmar(not exists (select 1 from public.oficina_meses_congelados
                                 where periodo = date_trunc('month', now() at time zone 'America/Lima')::date),
  'el mes en curso no se congela: sigue con el personal de hoy');
-- El primer costo de alguien de la oficina entra por insert, y tampoco mueve marzo.
-- Ponerle hoy el área a Dani tampoco: marzo ya está anotado, y ya no avisa de él.
select test.como_usuario(:'admin_id');
insert into public.trabajadores (nombres, apellidos, dni, area_id, activo, creado_en)
values ('Hugo', 'Check 401', '40109999', (select id from public.areas where codigo = 'ADM'), true, date '2021-01-04')
returning id as hugo_id \gset
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_costo_trabajador(:'hugo_id'::uuid, 5000);
reset role;
select test.como_usuario(:'admin_id');
update public.trabajadores set area_id = (select id from public.areas where codigo = 'ADM') where id = current_setting('prueba.dani')::uuid;
select test.afirmar((select o.monto = 4900 and o.sin_area = 0 from public.sueldos_oficina_del_mes(date '2021-03-01') o),
  format('el primer costo de Hugo y el área de Dani no mueven marzo, que ya no avisa sin área: %s',
         (select row(o.monto, o.sin_area)::text from public.sueldos_oficina_del_mes(date '2021-03-01') o)));
-- Un tareo tardío de marzo de Ana en una unidad sí se descuenta: ese tramo ya va en la mano de obra.
select test.como_usuario(:'admin_id');
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
values (current_setting('prueba.ana')::uuid, date '2021-03-25', 'CHK401_B_21/03', 10, 'Compras en obra', 20, 200);
select test.afirmar((select o.monto from public.sueldos_oficina_del_mes(date '2021-03-01') o) = 4700,
  format('el tareo tardío de Ana en B se descuenta de la oficina de marzo: %s', (select o.monto from public.sueldos_oficina_del_mes(date '2021-03-01') o)));
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($q$select * from public.oficina_mes_personas$q$, 'nadie lee los sueldos anotados por mes', 'permission denied');
reset role;

-- --------------------------------------------- 7. El gasto entero queda repartido, al céntimo
-- Julio: tres unidades con 1 h cada una. S/ 100 no se parten exacto en tres: el
-- céntimo que sobra va a una sola, y la suma da 100. Un gasto anulado no se
-- vuelve a registrar con su mismo número.
select test.como_usuario(:'admin_id');
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo) values
  (current_setting('prueba.beto')::uuid, date '2021-07-05', 'CHK401_A_21/03', 1, 'Repaso', 10, 10),
  (current_setting('prueba.beto')::uuid, date '2021-07-05', 'CHK401_B_21/03', 1, 'Repaso', 10, 10),
  (current_setting('prueba.beto')::uuid, date '2021-07-05', 'CHK401_C_21/07', 1, 'Repaso', 10, 10);
select set_config('prueba.julio', gen_random_uuid()::text, true);
select pg_temp.como('oficina');
set local role authenticated;
select public.registrar_gasto_general(current_setting('prueba.julio')::uuid, date '2021-07-10', 'AGUA', 'Recibo de agua de julio', 100, 'PEN', 'HORAS', null);
select public.anular_gasto_general(current_setting('prueba.julio')::uuid, 'Prueba del número anulado');
select test.debe_fallar(format($q$select public.registrar_gasto_general(%L, date '2021-07-10', 'AGUA', 'Recibo de agua de julio', 100, 'PEN', 'HORAS', null)$q$,
                               current_setting('prueba.julio')), 'un gasto anulado no se vuelve a registrar con su número', 'ya se anuló');
select public.registrar_gasto_general(gen_random_uuid(), date '2021-07-10', 'INTERNET', 'Internet de julio', 100, 'PEN', 'HORAS', null);
reset role;
select test.afirmar((select sum(l.monto) = 100 and count(*) = 3 and min(l.monto) = 33.33 and max(l.monto) = 33.34
                       from public.codigo_interno_lineas(null, true) l where l.detalle like '% · Internet de julio'),
  format('S/ 100 entre tres unidades iguales: %s', (select string_agg(l.monto::text, ' + ' order by l.codigo)
                                                       from public.codigo_interno_lineas(null, true) l where l.detalle like '% · Internet de julio')));
select test.afirmar((select abs(sum(l.monto) - max(l.precio_unitario)) = 0 from public.codigo_interno_lineas(null, true) l
                      where l.concepto = 'Sueldos de la oficina 07/2021'),
  'la oficina de julio también queda repartida entera, al céntimo');

select 'CHECK 401 OK' as resultado;
rollback;
