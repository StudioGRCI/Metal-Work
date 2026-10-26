-- Las tardanzas y los permisos se restan del pago, y la planilla del mes ajusta
-- la mano de obra de cada código por sus horas (migraciones 20261026200000 y
-- 20261026210000; DKS, 2026-10-26).
--
--   1. Cada tres tardanzas del mes, el 5 % de la remuneración se resta solo: de
--      la planilla diaria (taller) y del pago de la oficina. Si se anula una
--      marca, lo restado de más se devuelve en el siguiente pago; si se anula la
--      planilla o el pago, vuelve a quedar por restar.
--   2. Un permiso sin justificar se descuenta o se reporta. En taller, lo
--      descontado que el reporte del día también trae se resta; en la oficina,
--      se resta a la hora de su remuneración entre 240. El permiso justificado
--      con extras reservadas se paga a la hora ordinaria.
--   3. El descuento no deja un pago en negativo: lo que no alcanza espera.
--   4. Al cerrar la planilla de taller, la diferencia con lo que entró por horas
--      se reparte entre los códigos por las horas de cada persona; quien no tiene
--      ficha, por las horas de todos; quien es de la oficina, no entra.
--   5. RR. HH. ve el recargo de las horas extras por código.
--   6. Quién ve y quién no: Gerencia y Administración consultan sin sueldo ni
--      escritura; el administrador lo ve y no lo cambia; Tesorería ve lo de la
--      planilla diaria, no lo de la oficina.
-- Cada paso con la cuenta del puesto y `set local role authenticated`. Termina
-- en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000445', 'PRUEBAS DESCUENTOS S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA36', 'Taller prueba de descuentos') on conflict (codigo) do nothing;

select test.crear_usuario('Rosa', 'Humanos', 'rrhh445@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA36')) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia445@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA36')) as gerente_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria445@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA36')) as tesoreria_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina445@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA36')) as oficina_id \gset
select test.crear_usuario('Mario', 'Maestranza', 'sup.mtz445@demo.pe', 'SUPERVISOR', (select id from public.sedes where codigo = 'QA36')) as sup_id \gset
select test.crear_usuario('Omar', 'Obrero', 'operario445@demo.pe', 'OPERARIO', (select id from public.sedes where codigo = 'QA36'), true, 14) as operario_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin445@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA36')) as admin_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup_id';

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.tesoreria', :'tesoreria_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.operario', :'operario_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.juan', gen_random_uuid()::text, true);
select set_config('prueba.lucia', gen_random_uuid()::text, true);
select set_config('prueba.p1', gen_random_uuid()::text, true);
select set_config('prueba.p2', gen_random_uuid()::text, true);
select set_config('prueba.p3', gen_random_uuid()::text, true);
select set_config('prueba.p4', gen_random_uuid()::text, true);
select set_config('prueba.pd1', gen_random_uuid()::text, true);
select set_config('prueba.pd2', gen_random_uuid()::text, true);
select set_config('prueba.pd3', gen_random_uuid()::text, true);
select set_config('prueba.pago1', gen_random_uuid()::text, true);
select set_config('prueba.pago2', gen_random_uuid()::text, true);
select set_config('prueba.planilla', gen_random_uuid()::text, true);
-- Cinco días seguidos del mismo mes, ya pasados: los de esta semana o, en los
-- primeros días del mes, los del mes anterior.
select set_config('prueba.base', (case when extract(day from (now() at time zone 'America/Lima')::date) >= 7
                                       then (now() at time zone 'America/Lima')::date
                                       else date_trunc('month', (now() at time zone 'America/Lima')::date)::date end)::text, true);
select set_config('prueba.d1', (current_setting('prueba.base')::date - 1)::text, true);
select set_config('prueba.d2', (current_setting('prueba.base')::date - 2)::text, true);
select set_config('prueba.d3', (current_setting('prueba.base')::date - 3)::text, true);
select set_config('prueba.d4', (current_setting('prueba.base')::date - 4)::text, true);
select set_config('prueba.d5', (current_setting('prueba.base')::date - 5)::text, true);
select set_config('prueba.mes', date_trunc('month', current_setting('prueba.d1')::date)::date::text, true);

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
-- Lo que falta restar (positivo) o devolver (negativo) a alguien, por concepto,
-- leído como lo lee RR. HH.
create or replace function pg_temp.falta(p_quien text, p_concepto text) returns numeric language sql as $$
  select coalesce(sum(d.monto), 0) from public.rrhh_descuentos_por_aplicar(null) d
   where d.trabajador_id = current_setting('prueba.' || p_quien)::uuid and d.concepto = p_concepto;
$$;

select test.afirmar(current_setting('prueba.d5')::date >= public.rrhh_descuentos_desde(),
  'los días de la prueba caen desde octubre de 2026, cuando los descuentos empiezan a restarse');

-- ------------------------------------------------- RR. HH.: Juan (taller) y Lucía (oficina)
-- Juan gana S/ 2,400 (la hora a S/ 10) y cuesta S/ 2,400 al mes (su tareo, a S/ 10).
-- Lucía gana S/ 3,000 (la hora a S/ 12,50) y es de planilla administrativa.
do $$
declare v uuid;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(current_setting('prueba.juan')::uuid, 'Juan', 'Soldador', '70000445', 'Soldador',
         (select id from public.areas where codigo = 'MTZ'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-36', null);
  v := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.juan')::uuid, 2400);
  perform public.rrhh_guardar_costo_trabajador(current_setting('prueba.juan')::uuid, 2400);
  v := public.rrhh_guardar_trabajador(current_setting('prueba.lucia')::uuid, 'Lucía', 'Contable', '70000446', 'Asistente contable',
         (select id from public.areas where codigo = 'CON'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-37', null);
  v := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.lucia')::uuid, 3000);
  v := public.rrhh_guardar_planilla_trabajador(current_setting('prueba.lucia')::uuid, 'ADMINISTRATIVA');
  perform public.rrhh_guardar_regla_tardanza(5, 3, 5);
  reset role;
end $$;

-- ----------------------------------------------- Supervisión: los cinco días de Juan
-- d5: 9 h en A (1 extra, se paga). d4: 8 h en A y 2 en B (2 extras, se reservan).
-- d3: 6 h en A (y 2 h de permiso). d2: 8 h en B (el supervisor también puso las
-- 2 h del permiso de ese día). d1: 8 h en A.
do $$
declare v uuid; d text; r jsonb;
begin
  perform pg_temp.como('sup');
  set local role authenticated;
  for d, r in values
    ('d5', format('[{"descripcion": "Soldadura", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 9}]}]', current_setting('prueba.juan'))::jsonb),
    ('d4', format('[{"descripcion": "Soldadura de refuerzos", "avance": 20, "personal": [{"trabajador_id": "%s", "horas": 8}]}]', current_setting('prueba.juan'))::jsonb),
    ('d3', format('[{"descripcion": "Armado", "avance": 30, "personal": [{"trabajador_id": "%s", "horas": 6}]}]', current_setting('prueba.juan'))::jsonb),
    ('d1', format('[{"descripcion": "Pintura", "avance": 40, "personal": [{"trabajador_id": "%s", "horas": 8}]}]', current_setting('prueba.juan'))::jsonb)
  loop
    v := public.registrar_reporte_diario(gen_random_uuid(), current_setting('prueba.' || d)::date, 'CHK445_A', 'Tolva de la unidad A',
           'Trabajo del día en la tolva.', r, null, null);
    perform set_config('prueba.r_a_' || d, v::text, true);
  end loop;
  v := public.registrar_reporte_diario(gen_random_uuid(), current_setting('prueba.d4')::date, 'CHK445_B', 'Bastidor de la unidad B',
         'Armado del bastidor.',
         format('[{"descripcion": "Armado", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 2}]}]', current_setting('prueba.juan'))::jsonb, null, null);
  perform set_config('prueba.r_b_d4', v::text, true);
  v := public.registrar_reporte_diario(gen_random_uuid(), current_setting('prueba.d2')::date, 'CHK445_B', 'Bastidor de la unidad B',
         'Armado del bastidor.',
         format('[{"descripcion": "Montaje del piso", "avance": 20, "personal": [{"trabajador_id": "%s", "horas": 8}]}]', current_setting('prueba.juan'))::jsonb, null, null);
  perform set_config('prueba.r_b_d2', v::text, true);
  reset role;
end $$;

-- Gerencia y RR. HH. validan todo menos el d1 (ese entra en la segunda planilla).
do $$
declare k text;
begin
  foreach k in array array['r_a_d5', 'r_a_d4', 'r_b_d4', 'r_a_d3', 'r_b_d2'] loop
    perform pg_temp.como('gerente');
    set local role authenticated;
    perform public.validar_reporte_diario(current_setting('prueba.' || k)::uuid, 'GERENCIA');
    reset role;
    perform pg_temp.como('rrhh');
    set local role authenticated;
    perform public.validar_reporte_diario(current_setting('prueba.' || k)::uuid, 'RRHH');
    reset role;
  end loop;
end $$;

-- Portería: tres tardanzas de cada uno en el mes (se cargan a mano: marcar_asistencia pone hoy).
do $$
declare d text;
begin
  perform pg_temp.como('rrhh');
  foreach d in array array['d5', 'd4', 'd3'] loop
    insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
    values (current_setting('prueba.juan')::uuid, current_setting('prueba.' || d)::date, 'INGRESO', '08:20', 20, true),
           (current_setting('prueba.lucia')::uuid, current_setting('prueba.' || d)::date, 'INGRESO', '08:15', 15, true);
  end loop;
  insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
  values (current_setting('prueba.juan')::uuid, current_setting('prueba.d3')::date, 'SALIDA', '15:05', 0, false);
end $$;

-- ------------------------------------------------- RR. HH.: extras, permisos y qué hacer con ellos
do $$
declare v uuid;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.rrhh_decidir_horas_extras(gen_random_uuid(), current_setting('prueba.juan')::uuid, current_setting('prueba.d5')::date, 'PAGAR');
  v := public.rrhh_decidir_horas_extras(gen_random_uuid(), current_setting('prueba.juan')::uuid, current_setting('prueba.d4')::date, 'RESERVAR');
  v := public.rrhh_registrar_permiso(current_setting('prueba.p1')::uuid, current_setting('prueba.juan')::uuid,
         current_setting('prueba.d3')::date, 2, 'Cita médica en EsSalud por la tarde.');
  v := public.rrhh_registrar_permiso(current_setting('prueba.p2')::uuid, current_setting('prueba.juan')::uuid,
         current_setting('prueba.d2')::date, 2, 'Trámite en el banco a media mañana.');
  v := public.rrhh_registrar_permiso(current_setting('prueba.p3')::uuid, current_setting('prueba.lucia')::uuid,
         current_setting('prueba.d3')::date, 4, 'Asunto familiar toda la tarde.');
  v := public.rrhh_registrar_permiso(current_setting('prueba.p4')::uuid, current_setting('prueba.lucia')::uuid,
         current_setting('prueba.d2')::date, 1, 'Salió una hora antes sin decir por qué.');
  -- p1 con las 2 h reservadas; p2 y p3 se descuentan; p4 se reporta.
  v := public.rrhh_justificar_permiso(gen_random_uuid(), current_setting('prueba.p1')::uuid, null);
  v := public.rrhh_descontar_permiso(gen_random_uuid(), current_setting('prueba.p2')::uuid);
  v := public.rrhh_descontar_permiso(gen_random_uuid(), current_setting('prueba.p3')::uuid);
  v := public.rrhh_reportar_permiso(gen_random_uuid(), current_setting('prueba.p4')::uuid, 'AMONESTACION_VERBAL', 'Se le explicó la regla.');

  perform test.debe_fallar(format('select public.rrhh_descontar_permiso(gen_random_uuid(), %L)', current_setting('prueba.p1')),
    'lo justificado no se descuenta', 'justificado o descontado');
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(gen_random_uuid(), %L, null)', current_setting('prueba.p2')),
    'lo descontado no se justifica después', 'justificado o descontado');
  perform test.debe_fallar(format('select public.rrhh_reportar_permiso(gen_random_uuid(), %L, ''OBSERVACION'', null)', current_setting('prueba.p4')),
    'un permiso se reporta una vez', 'ya está reportado');
  perform test.debe_fallar(format('select public.rrhh_reportar_permiso(gen_random_uuid(), %L, ''OBSERVACION'', null)', current_setting('prueba.p1')),
    'lo justificado con horas extras no se reporta', 'ya está justificado');
  perform test.debe_fallar(format('select public.rrhh_reportar_permiso(gen_random_uuid(), %L, ''SUSPENSION'', null)', current_setting('prueba.p2')),
    'un permiso se reporta como observación o amonestación', 'observación o como amonestación');
  v := public.rrhh_registrar_permiso(gen_random_uuid(), current_setting('prueba.juan')::uuid,
         (now() at time zone 'America/Lima')::date + 3, 1, 'Permiso para un trámite la próxima semana.');
  perform test.debe_fallar(format('select public.rrhh_descontar_permiso(gen_random_uuid(), %L)', v),
    'un permiso que todavía no llega no se descuenta', 'cuando llegue el día');

  perform test.afirmar((select por_justificar from public.rrhh_permisos_con_estado(null) where id = current_setting('prueba.p2')::uuid) is null,
    'el permiso descontado sale de los que faltan justificar');
  perform test.afirmar((select descontadas = 2 and horas_reporte = 8 and descontado = 0 and not reportado
                          from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date) where id = current_setting('prueba.p2')::uuid),
    'RR. HH. ve el permiso descontado, con las horas del reporte de ese día y nada restado todavía');
  perform test.afirmar((select ingreso = '08:20' and salida = '15:05' and horas_reporte = 6
                          from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date) where id = current_setting('prueba.p1')::uuid),
    'el permiso muestra a qué hora entró y salió según portería, y las horas del reporte');
  perform test.afirmar((select reportado from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date)
                         where id = current_setting('prueba.p4')::uuid),
    'el permiso reportado lo dice');
  reset role;
end $$;

-- Lo reportado es una observación, y le llega a Gerencia.
do $$
begin
  perform test.afirmar((select motivo = 'PERMISO_SIN_JUSTIFICAR' and tipo = 'AMONESTACION_VERBAL' and fecha = current_setting('prueba.d2')::date
                               and detalle like '%sin justificar: 1 h de 1 h%' and detalle like '%Se le explicó la regla.'
                          from public.observaciones_personal where permiso_id = current_setting('prueba.p4')::uuid),
    'reportar deja una observación con el motivo del permiso sin justificar');
  perform test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.gerente')::uuid
                                  and titulo = 'Permiso sin justificar: Lucía Contable' and ruta = '/rrhh/observaciones'),
    'Gerencia recibe el aviso del permiso reportado');
  perform test.afirmar(not exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.rrhh')::uuid
                                      and titulo like 'Permiso sin justificar%'),
    'quien lo reporta no se avisa a sí mismo');
end $$;

-- ----------------------------------------------------------- Lo que hay por restar, antes de pagar
do $$
declare v_mes text := public.mes_en_texto(current_setting('prueba.mes')::date);
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  perform test.afirmar(pg_temp.falta('juan', 'TARDANZAS') = 120, 'tres tardanzas de Juan: 5 % de S/ 2,400');
  perform test.afirmar(pg_temp.falta('juan', 'PERMISO') = 20,
    'el permiso descontado de Juan que el reporte también trae: 2 h a S/ 10');
  perform test.afirmar(pg_temp.falta('lucia', 'TARDANZAS') = 150, 'tres tardanzas de Lucía: 5 % de S/ 3,000');
  perform test.afirmar(pg_temp.falta('lucia', 'PERMISO') = 50, 'el permiso descontado de Lucía: 4 h a S/ 12,50');
  perform test.afirmar((select count(*) from public.rrhh_descuentos_por_aplicar(null) d
                         where d.trabajador_id in (current_setting('prueba.juan')::uuid, current_setting('prueba.lucia')::uuid)) = 4,
    'RR. HH. ve los cuatro descuentos por aplicar');
  perform test.afirmar((select detalle from public.rrhh_descuentos_por_aplicar(null) d
                         where d.trabajador_id = current_setting('prueba.juan')::uuid and d.concepto = 'TARDANZAS')
                       = '3 tardanzas en ' || v_mes || ': 5 % de la remuneración',
    'el descuento dice cuántas tardanzas y qué porcentaje');
  reset role;
  perform test.afirmar((select por_pagar from public.permisos_por_dia()
                         where trabajador_id = current_setting('prueba.juan')::uuid and fecha = current_setting('prueba.d3')::date) = 2,
    'el permiso justificado de Juan, que el reporte no trae, se paga: 2 h');
end $$;

-- ----------------------------------------------------------- La primera planilla diaria
-- Juan: 30 h ordinarias (8 + 8 + 6 + 8) = S/ 300; 1 h extra con 25 % = S/ 12,50;
-- 2 h del permiso justificado = S/ 20. Se le restan S/ 120 + S/ 20: cobra S/ 192,50.
do $$
declare v uuid; v_p public.planilla_diaria_personas%rowtype;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.enviar_planilla_diaria(current_setting('prueba.pd1')::uuid);
  select * into v_p from public.planilla_diaria_personas
   where planilla_id = current_setting('prueba.pd1')::uuid and trabajador_id = current_setting('prueba.juan')::uuid;
  perform test.afirmar(v_p.horas_ordinarias = 30 and v_p.monto_ordinarias = 300 and v_p.monto_extras = 12.5
                       and v_p.horas_permiso = 2 and v_p.monto_permiso = 20 and v_p.monto_descuentos = 140 and v_p.total = 192.5,
    format('la planilla paga ordinarias, extras y el permiso, y resta tardanzas y permiso (salió %s)', to_jsonb(v_p)));
  perform test.afirmar((select total from public.planillas_diarias where id = current_setting('prueba.pd1')::uuid) = 192.5,
    'el total de la planilla ya va con el descuento: es lo que Tesorería paga');
  perform test.afirmar((select count(*) = 1 and sum(horas) = 2 and sum(monto) = 20 from public.planilla_diaria_detalle
                         where persona_id = v_p.id and concepto = 'PERMISO' and fecha = current_setting('prueba.d3')::date),
    'el detalle lleva el día del permiso pagado');
  perform test.afirmar((select count(*) = 2 and sum(monto) = 140 from public.descuentos_del_pago where planilla_persona_id = v_p.id),
    'cada descuento queda anotado con su planilla');
  perform test.afirmar(pg_temp.falta('juan', 'TARDANZAS') = 0 and pg_temp.falta('juan', 'PERMISO') = 0,
    'lo restado ya no queda por restar');
  reset role;
end $$;

-- ------------------------------------------- Se anula una tardanza: se devuelve en la siguiente
-- Juan queda con dos tardanzas: 0 %. La segunda planilla paga el d1 (8 h = S/ 80)
-- y le devuelve los S/ 120: cobra S/ 200. Si se anula, lo devuelto vuelve a esperar.
do $$
declare v uuid; v_p public.planilla_diaria_personas%rowtype;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  perform public.anular_asistencia((select id from public.asistencias
                                     where trabajador_id = current_setting('prueba.juan')::uuid and fecha = current_setting('prueba.d5')::date
                                       and tipo = 'INGRESO'), 'Se marcó tarde por una falla del lector.');
  perform test.afirmar(pg_temp.falta('juan', 'TARDANZAS') = -120, 'con una tardanza menos, los S/ 120 quedan por devolver');
  perform test.afirmar((select detalle from public.rrhh_descuentos_por_aplicar(null) d
                         where d.trabajador_id = current_setting('prueba.juan')::uuid and d.concepto = 'TARDANZAS') like 'Se devuelve%',
    'lo que se devuelve lo dice');
  reset role;

  perform pg_temp.como('gerente');
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r_a_d1')::uuid, 'GERENCIA');
  reset role;
  perform pg_temp.como('rrhh');
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r_a_d1')::uuid, 'RRHH');
  v := public.enviar_planilla_diaria(current_setting('prueba.pd2')::uuid);
  select * into v_p from public.planilla_diaria_personas where planilla_id = current_setting('prueba.pd2')::uuid;
  perform test.afirmar(v_p.monto_ordinarias = 80 and v_p.monto_descuentos = -120 and v_p.total = 200,
    format('la segunda planilla le devuelve lo restado de más (salió %s)', to_jsonb(v_p)));
  perform test.afirmar(pg_temp.falta('juan', 'TARDANZAS') = 0, 'lo devuelto ya no queda por devolver');
  perform test.afirmar((select descontado = 0 and por_descontar = 0 and documentos like '%PD-%,%PD-%'
                          from public.rrhh_descuentos_de_tardanzas(current_setting('prueba.mes')::date)
                         where trabajador_id = current_setting('prueba.juan')::uuid),
    'Tardanzas dice cuánto se restó en el mes neto de lo devuelto, y en qué planillas');

  v := public.anular_planilla_diaria(current_setting('prueba.pd2')::uuid, 'Se armó antes de tiempo, va con la del viernes.');
  perform test.afirmar(pg_temp.falta('juan', 'TARDANZAS') = -120, 'con la planilla anulada, lo devuelto vuelve a quedar por devolver');
  reset role;
end $$;

-- ------------------------------------------------------ Se anula un permiso descontado
-- Lo restado por él se devuelve: la tercera planilla paga el d1 y devuelve S/ 120 + S/ 20.
do $$
declare v uuid; v_p public.planilla_diaria_personas%rowtype;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.rrhh_anular_permiso(current_setting('prueba.p2')::uuid, 'Al final hizo el trámite después de su hora.');
  perform test.afirmar((select count(*) from public.permisos_descontados
                         where permiso_id = current_setting('prueba.p2')::uuid and anulado_en is null) = 0,
    'al anular el permiso se anula lo descontado');
  perform test.afirmar(pg_temp.falta('juan', 'PERMISO') = -20, 'y lo restado por él queda por devolver');
  v := public.enviar_planilla_diaria(current_setting('prueba.pd3')::uuid);
  select * into v_p from public.planilla_diaria_personas where planilla_id = current_setting('prueba.pd3')::uuid;
  perform test.afirmar(v_p.monto_ordinarias = 80 and v_p.monto_descuentos = -140 and v_p.total = 220,
    format('la tercera planilla devuelve las dos cosas (salió %s)', to_jsonb(v_p)));
  reset role;
end $$;

-- ----------------------------------------------------------- El pago de la oficina
-- Lucía debe S/ 150 de tardanzas y S/ 50 del permiso. Con S/ 100 de sueldo en el
-- tramo, el descuento se lleva solo eso (el pago queda en cero) y el resto espera;
-- anulado ese pago, el siguiente de S/ 1,500 resta todo: se le pagan S/ 1,300.
do $$
declare v uuid;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.rrhh_registrar_pago_oficina(current_setting('prueba.pago1')::uuid, current_setting('prueba.lucia')::uuid,
         current_setting('prueba.mes')::date, current_setting('prueba.d1')::date, 100, 9, null);
  perform test.afirmar((select monto = 0 and aportes = 9 from public.oficina_pagos where id = current_setting('prueba.pago1')::uuid),
    'el descuento no deja el pago en negativo');
  perform test.afirmar((select count(*) = 1 and sum(monto) = 100 from public.descuentos_del_pago
                         where oficina_pago_id = current_setting('prueba.pago1')::uuid and concepto = 'TARDANZAS'),
    'se resta primero lo más viejo, hasta lo que alcanza');
  perform test.afirmar(pg_temp.falta('lucia', 'TARDANZAS') = 50 and pg_temp.falta('lucia', 'PERMISO') = 50,
    'lo que no alcanzó espera al siguiente pago');
  v := public.rrhh_anular_pago_oficina(current_setting('prueba.pago1')::uuid, 'Se registró con el monto de otra quincena.');
  perform test.afirmar(pg_temp.falta('lucia', 'TARDANZAS') = 150, 'con el pago anulado, todo vuelve a quedar por restar');
  v := public.rrhh_registrar_pago_oficina(current_setting('prueba.pago2')::uuid, current_setting('prueba.lucia')::uuid,
         current_setting('prueba.mes')::date, current_setting('prueba.d1')::date, 1500, 135, 'Quincena con descuentos.');
  perform test.afirmar((select monto from public.oficina_pagos where id = current_setting('prueba.pago2')::uuid) = 1300,
    'el pago guarda lo que se le pagó: el sueldo menos los descuentos');
  perform test.afirmar((select count(*) = 2 and sum(monto) = 200 from public.descuentos_del_pago
                         where oficina_pago_id = current_setting('prueba.pago2')::uuid),
    'los dos descuentos quedan con su pago');
  perform test.afirmar(pg_temp.falta('lucia', 'TARDANZAS') = 0 and pg_temp.falta('lucia', 'PERMISO') = 0,
    'y no queda nada por restar a Lucía');
  perform test.afirmar((select descontado = 50 from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date)
                         where id = current_setting('prueba.p3')::uuid),
    'RR. HH. ve lo restado por el permiso');
  reset role;
end $$;

-- ------------------------------------------------------------- Quién ve y quién no
do $$
begin
  perform pg_temp.como('gerente');
  set local role authenticated;
  perform test.debe_fallar('select * from public.rrhh_descuentos_por_aplicar(null)',
    'Gerencia no ve lo que hay por restar a cada persona', 'No tienes permiso');
  perform test.debe_fallar(format('select public.rrhh_descontar_permiso(gen_random_uuid(), %L)', current_setting('prueba.p4')),
    'Gerencia no descuenta permisos', 'rrhh.permisos');
  perform test.debe_fallar(format('select public.rrhh_reportar_permiso(gen_random_uuid(), %L, ''OBSERVACION'', null)', current_setting('prueba.p3')),
    'ni los reporta', 'rrhh.permisos');
  perform test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, %L, %L, 100, 0, null)',
                                  current_setting('prueba.lucia'), current_setting('prueba.d1'), current_setting('prueba.d1')),
    'ni registra pagos de la oficina', 'rrhh.personal');
  perform test.afirmar((select reportado and descontado is null from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date)
                         where id = current_setting('prueba.p4')::uuid),
    'Gerencia ve el permiso y si se reportó, sin lo restado en soles');
  perform test.afirmar((select count(*) from public.descuentos_del_pago where oficina_pago_id is not null) = 0,
    'Gerencia no lee lo restado a la oficina');
  perform test.afirmar((select count(*) from public.descuentos_del_pago where planilla_persona_id is not null) > 0,
    'lo de la planilla diaria lo ve, como ve la planilla');
  perform test.debe_fallar(format('insert into public.descuentos_del_pago (trabajador_id, concepto, fecha, base, monto, detalle, oficina_pago_id)
                                   values (%L, ''PERMISO'', current_date, 1000, 10, ''a mano por la API'', %L)',
                                  current_setting('prueba.lucia'), current_setting('prueba.pago2')),
    'nadie escribe un descuento a mano', 'permission denied');
  perform test.debe_fallar(format('select * from public.rrhh_recargo_extras_del_mes(%L)', current_setting('prueba.mes')),
    'el recargo por código es de RR. HH.', 'rrhh.personal');
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.descuentos_del_pago where oficina_pago_id is not null) = 0
                       and (select count(*) from public.descuentos_del_pago where planilla_persona_id is not null) > 0,
    'Tesorería ve lo restado en la planilla que paga, no lo de la oficina');
  reset role;

  perform pg_temp.como('oficina');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.descuentos_del_pago) = 0, 'Administración no lee lo restado a nadie');
  perform test.afirmar((select count(*) from public.permisos_descontados) > 0, 'pero sí qué permisos se descontaron, como ve los permisos');
  perform test.afirmar((select descontado is null from public.rrhh_permisos_con_estado(current_setting('prueba.mes')::date)
                         where id = current_setting('prueba.p3')::uuid),
    'y en la lista de permisos, sin soles');
  reset role;

  perform pg_temp.como('operario');
  set local role authenticated;
  perform test.debe_fallar('select * from public.rrhh_permisos_con_estado(null)', 'un operario no ve los permisos', 'No tienes permiso');
  perform test.afirmar((select count(*) from public.descuentos_del_pago) = 0 and (select count(*) from public.permisos_descontados) = 0,
    'ni lo descontado');
  reset role;

  perform pg_temp.como('admin');
  set local role authenticated;
  perform test.debe_fallar(format('select public.rrhh_descontar_permiso(gen_random_uuid(), %L)', current_setting('prueba.p4')),
    'el administrador no descuenta', 'el administrador lo ve, pero no lo cambia');
  perform test.debe_fallar(format('select public.rrhh_reportar_permiso(gen_random_uuid(), %L, ''OBSERVACION'', null)', current_setting('prueba.p3')),
    'ni reporta', 'el administrador lo ve, pero no lo cambia');
  perform test.afirmar((select count(*) from public.rrhh_descuentos_por_aplicar(null)) >= 0, 'pero lo ve');
  reset role;

  -- Lo restado no se cambia ni se borra, ni con la llave del dueño.
  perform test.debe_fallar('update public.descuentos_del_pago set monto = 1', 'un descuento no se corrige', 'no se cambia ni se borra');
  perform test.debe_fallar('delete from public.descuentos_del_pago', 'ni se borra', 'no se cambia ni se borra');
  perform test.debe_fallar('delete from public.permisos_descontados', 'lo descontado de un permiso no se borra', 'no se borra');
end $$;

-- ------------------------------------------------------------- El recargo, para RR. HH.
do $$
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  perform test.afirmar((select count(*) = 1 and sum(monto) = 2.5 and min(codigo) = 'CHK445_A'
                          from public.rrhh_recargo_extras_del_mes(current_setting('prueba.mes')::date)
                         where codigo like 'CHK445%'),
    'RR. HH. ve el recargo de la hora extra pagada (25 % de S/ 10) en el código que se trabajó');
  reset role;
end $$;

-- --------------------------------------------------- La planilla del mes ajusta la mano de obra
-- Juan cargó 41 h en el mes (31 en A y 10 en B) a S/ 10: S/ 410 por horas. Su
-- costo real es S/ 1,000: el ajuste de S/ 590 va por sus horas. Pedro no tiene
-- ficha: sus S/ 500 van por las horas de todos (las mismas, aquí). Lucía es de
-- la oficina: no entra.
do $$
declare v_a numeric; v_b numeric;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  insert into public.planillas (id, tipo, periodo, moneda) values (current_setting('prueba.planilla')::uuid, 'TALLER', current_setting('prueba.mes')::date, 'PEN');
  insert into public.planilla_personas (planilla_id, nombre, monto) values
    (current_setting('prueba.planilla')::uuid, 'SOLDADOR JUAN', 1000),
    (current_setting('prueba.planilla')::uuid, 'Pedro Sinficha', 500),
    (current_setting('prueba.planilla')::uuid, 'CONTABLE LUCIA', 800);
  perform test.afirmar((select string_agg(como || ':' || trim_scale(ajuste)::text, ' ' order by como)
                          from public.rrhh_planilla_al_costo(current_setting('prueba.planilla')::uuid)) = 'HORAS:590 OFICINA:0 SIN_FICHA:500',
    'antes de cerrar, RR. HH. ve cómo entra cada persona');
  perform test.afirmar((select trabajador = 'Juan Soldador' and horas = 41 and costo_horas = 410
                          from public.rrhh_planilla_al_costo(current_setting('prueba.planilla')::uuid) where como = 'HORAS'),
    'la ficha se encuentra por el nombre, en cualquier orden y sin tildes');
  perform public.cerrar_planilla(current_setting('prueba.planilla')::uuid);
  perform test.afirmar((select estado = 'CERRADA' from public.planillas where id = current_setting('prueba.planilla')::uuid),
    'se cierra sin repartir entre las OT');
  reset role;

  perform pg_temp.como('gerente');
  set local role authenticated;
  select sum(l.monto) into v_a from public.codigo_interno_costeo('CHK445_A') l where l.fuente = 'MANO_OBRA' and l.concepto like 'Ajuste de la planilla%';
  select sum(l.monto) into v_b from public.codigo_interno_costeo('CHK445_B') l where l.fuente = 'MANO_OBRA' and l.concepto like 'Ajuste de la planilla%';
  perform test.afirmar(v_a = 824.15 and v_b = 265.85,
    format('el ajuste (S/ 590 + S/ 500) va por horas: 31/41 a A y 10/41 a B (salió A %s, B %s)', v_a, v_b));
  perform test.afirmar((select sum(l.monto) from public.codigo_interno_costeo('CHK445_A') l where l.fuente = 'MANO_OBRA')
                       + (select sum(l.monto) from public.codigo_interno_costeo('CHK445_B') l where l.fuente = 'MANO_OBRA') = 1500,
    'la mano de obra de las dos unidades suma el costo real de la planilla: S/ 1,000 + S/ 500');
  perform test.afirmar(((select to_jsonb(k) from public.codigos_internos_costo('CHK445_A') k where k.codigo = 'CHK445_A')->>'mano_obra')::numeric = 1134.15,
    'el costo del código lo suma en su mano de obra: S/ 310 por horas y S/ 824,15 de ajuste');
  reset role;

  -- Una hora que llega después de cerrar: el ajuste se rehace y el total sigue siendo el real.
  perform pg_temp.como('rrhh');
  set local role authenticated;
  perform public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.juan')::uuid, current_setting('prueba.d1')::date,
                                      'CHK445_B', 1, 'Ajuste del bastidor');
  reset role;
  perform pg_temp.como('gerente');
  set local role authenticated;
  perform test.afirmar((select sum(l.monto) from public.codigo_interno_costeo('CHK445_A') l where l.fuente = 'MANO_OBRA')
                       + (select sum(l.monto) from public.codigo_interno_costeo('CHK445_B') l where l.fuente = 'MANO_OBRA') = 1500,
    'con una hora más, las dos unidades siguen sumando el costo real');
  reset role;
end $$;

-- ------------------------------------------------------------- Las funciones internas, cerradas
select test.afirmar(not has_function_privilege('authenticated', 'public.descuentos_pendientes(date)', 'execute')
                    and not has_function_privilege('authenticated', 'public.descuentos_vigentes()', 'execute')
                    and not has_function_privilege('authenticated', 'public.permisos_por_dia()', 'execute')
                    and not has_function_privilege('authenticated', 'public.rrhh_descuentos_desde()', 'execute')
                    and not has_function_privilege('authenticated', 'public.mes_en_texto(date)', 'execute')
                    and not has_function_privilege('authenticated', 'public.trabajador_de_planilla(text, text)', 'execute')
                    and not has_function_privilege('authenticated', 'public.planilla_al_costo(uuid)', 'execute')
                    and not has_function_privilege('authenticated', 'public.codigo_interno_lineas_planilla(text)', 'execute')
                    and not has_function_privilege('authenticated', 'public.fn_descuento_del_pago_guardia()', 'execute'),
  'los cálculos internos no los llama la gente: solo las funciones que piden permiso');
select test.afirmar(not has_function_privilege('anon', 'public.rrhh_descontar_permiso(uuid, uuid)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_reportar_permiso(uuid, uuid, text, text)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_permisos_con_estado(date)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_descuentos_por_aplicar(date)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_descuentos_de_tardanzas(date)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_recargo_extras_del_mes(date)', 'execute')
                    and not has_function_privilege('anon', 'public.rrhh_planilla_al_costo(uuid)', 'execute'),
  'nada de esto se llama sin sesión');

rollback;
