-- El reporte diario lo validan Gerencia y RR. HH. (en cualquier orden); si una
-- de las dos lo observa, vuelve al supervisor, que lo corrige y lo sube de
-- nuevo. De lo validado sale la planilla diaria: hasta 8 horas por persona y por
-- día son ordinarias; lo que pasa son horas extras, que RR. HH. reserva (al
-- saldo de la persona) o paga (con 25 % las 2 primeras y 35 % las demás). RR.
-- HH. manda la planilla a Tesorería, que ve la cuenta solo de esa gente, paga
-- con comprobante y adjunta la boleta; RR. HH. la entrega. Nada se borra.
-- Cada paso, con la cuenta del área que lo hace; ninguno como ADMIN.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000043', 'PRUEBAS PLANILLA S.A.C.' where not exists (select 1 from public.empresa);

select test.crear_usuario('Rosa', 'Humanos', 'rrhh343@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia343@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria343@demo.pe', 'TESORERIA', (select id from public.sedes limit 1)) as tesoreria_id \gset
select test.crear_usuario('Mario', 'Maestranza', 'sup.mtz343@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup1_id \gset
select test.crear_usuario('Alba', 'Acabados', 'sup.acb343@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup2_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria343@demo.pe', 'PORTERO', (select id from public.sedes limit 1)) as portero_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin343@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup1_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'ACB') where id = :'sup2_id';

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.tesoreria', :'tesoreria_id', true);
select set_config('prueba.caja', test.crear_caja()::text, true);  -- desde la 20261019100000 todo pago pide su cuenta
select set_config('prueba.sup1', :'sup1_id', true);
select set_config('prueba.sup2', :'sup2_id', true);
select set_config('prueba.portero', :'portero_id', true);
select set_config('prueba.juan', gen_random_uuid()::text, true);
select set_config('prueba.ana', gen_random_uuid()::text, true);
select set_config('prueba.r1', gen_random_uuid()::text, true);
select set_config('prueba.r2', gen_random_uuid()::text, true);
select set_config('prueba.r2b', gen_random_uuid()::text, true);
select set_config('prueba.r3', gen_random_uuid()::text, true);
select set_config('prueba.r4', gen_random_uuid()::text, true);
select set_config('prueba.pagar', gen_random_uuid()::text, true);
select set_config('prueba.reservar', gen_random_uuid()::text, true);
select set_config('prueba.uso', gen_random_uuid()::text, true);
select set_config('prueba.pd1', gen_random_uuid()::text, true);
select set_config('prueba.pd2', gen_random_uuid()::text, true);
select set_config('prueba.pago', gen_random_uuid()::text, true);
select set_config('prueba.d1', ((now() at time zone 'America/Lima')::date - 1)::text, true);
select set_config('prueba.d2', ((now() at time zone 'America/Lima')::date - 2)::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ---------------------------------------------------- RR. HH. registra al personal
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(current_setting('prueba.juan')::uuid, 'Juan', 'Soldador', '70000361', 'Soldador',
         (select id from public.areas where codigo = 'MTZ'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-61', null);
  v := public.rrhh_guardar_trabajador(current_setting('prueba.ana')::uuid, 'Ana', 'Pintora', '70000362', 'Pintora',
         (select id from public.areas where codigo = 'MTZ'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-62', null);
  -- S/ 2400 al mes: la hora a S/ 10. A Ana todavía no se le pone.
  v := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.juan')::uuid, 2400);
  perform test.debe_fallar(format('select public.rrhh_guardar_remuneracion_trabajador(%L, 0)', current_setting('prueba.ana')),
    'la remuneración es mayor que cero', 'S/ 0,01');
  perform test.afirmar((select remuneracion_mensual from public.trabajador_remuneraciones
                         where trabajador_id = current_setting('prueba.juan')::uuid) = 2400, 'RR. HH. ve la remuneración que puso');
  reset role;
end $$;

-- ----------------------------------------------------------- los reportes del supervisor
-- Día 1: Juan 6 + 4 h en un reporte y 1 h en otro (11 h: 3 extras); Ana 5 h.
-- Día 2: Juan 9,5 h (1,5 extras).
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  v := public.registrar_reporte_diario(current_setting('prueba.r1')::uuid, current_setting('prueba.d1')::date, 'PLANTA',
         'Tolva de la unidad 7', 'Soldadura y armado de la tolva.',
         format('[{"descripcion": "Soldadura", "avance": 40, "personal": [{"trabajador_id": "%1$s", "horas": 6}, {"trabajador_id": "%2$s", "horas": 5}]},
                  {"descripcion": "Armado", "avance": 20, "personal": [{"trabajador_id": "%1$s", "horas": 4}]}]',
                current_setting('prueba.juan'), current_setting('prueba.ana'))::jsonb, null, null);
  v := public.registrar_reporte_diario(current_setting('prueba.r2')::uuid, current_setting('prueba.d1')::date, 'PLANTA',
         'Limpieza al cierre', 'Orden de la zona de corte.',
         format('[{"descripcion": "Limpieza", "avance": 100, "personal": [{"trabajador_id": "%s", "horas": 2}]}]', current_setting('prueba.juan'))::jsonb,
         null, null);
  v := public.registrar_reporte_diario(current_setting('prueba.r3')::uuid, current_setting('prueba.d2')::date, 'PLANTA',
         'Bastidor', 'Armado del bastidor.',
         format('[{"descripcion": "Bastidor", "avance": 60, "personal": [{"trabajador_id": "%s", "horas": 9.5}]}]', current_setting('prueba.juan'))::jsonb,
         null, null);
  -- El supervisor no se da el visto a sí mismo.
  perform test.debe_fallar(format('select public.validar_reporte_diario(%L, ''GERENCIA'')', current_setting('prueba.r1')),
    'el supervisor no valida como Gerencia', 'reporte_diario.validar_gerencia');
  perform test.debe_fallar(format('select public.validar_reporte_diario(%L, ''RRHH'')', current_setting('prueba.r1')),
    'ni como RR. HH.', 'reporte_diario.validar_rrhh');
  reset role;
end $$;

-- ----------------------------------------------------------------- el visto de cada área
do $$
declare v_estado text;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  v_estado := public.validar_reporte_diario(current_setting('prueba.r1')::uuid, 'GERENCIA');
  perform test.afirmar(v_estado = 'POR_VALIDAR', 'con el visto de Gerencia solo, el reporte sigue por validar');
  v_estado := public.validar_reporte_diario(current_setting('prueba.r1')::uuid, 'GERENCIA');
  perform test.afirmar(v_estado = 'POR_VALIDAR', 'un segundo toque no cambia nada');
  perform test.debe_fallar(format('select public.validar_reporte_diario(%L, ''RRHH'')', current_setting('prueba.r1')),
    'Gerencia no da el visto de RR. HH.', 'reporte_diario.validar_rrhh');
  v_estado := public.validar_reporte_diario(current_setting('prueba.r3')::uuid, 'GERENCIA');
  perform test.debe_fallar(format('select public.observar_reporte_diario(%L, ''GERENCIA'', ''corto'')', current_setting('prueba.r2')),
    'observar pide qué corregir', '10 a 500');
  reset role;

  -- RR. HH. observa el reporte 2: Juan no hizo 2 horas de limpieza, hizo 1.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform public.observar_reporte_diario(current_setting('prueba.r2')::uuid, 'RRHH', 'Juan hizo 1 hora de limpieza, no 2.');
  perform test.afirmar((select observacion_area = 'RRHH' and observado_en is not null from public.reportes_diarios
                         where id = current_setting('prueba.r2')::uuid), 'el reporte queda observado por RR. HH.');
  perform test.debe_fallar(format('select public.validar_reporte_diario(%L, ''RRHH'')', current_setting('prueba.r2')),
    'un observado no se valida', 'observado');
  v_estado := public.validar_reporte_diario(current_setting('prueba.r1')::uuid, 'RRHH');
  perform test.afirmar(v_estado = 'VALIDADO', 'con los dos vistos, el reporte queda validado');
  v_estado := public.validar_reporte_diario(current_setting('prueba.r3')::uuid, 'RRHH');
  perform test.debe_fallar(format('select public.observar_reporte_diario(%L, ''RRHH'', ''Ya validado pero lo observo'')', current_setting('prueba.r1')),
    'un validado ya no se observa: RR. HH. lo anula', 'ya lo validaron');
  reset role;

  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.validar_reporte_diario(%L, ''GERENCIA'')', current_setting('prueba.r2')),
    'el portero no valida', 'reporte_diario.validar_gerencia');
  reset role;
end $$;

-- ------------------------------------------------- el supervisor corrige lo observado
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.notificaciones where titulo like 'Reporte observado por Recursos Humanos%') = 1,
    'al supervisor le llega el aviso de la observación');
  perform test.debe_fallar(format('select public.anular_reporte_diario(%L, ''Lo anulo aunque ya está validado'')', current_setting('prueba.r1')),
    'el supervisor no anula un reporte ya validado', 'ya lo validaron');
  perform test.debe_fallar(format('select public.registrar_reporte_corregido(%L, %L, %L, ''PLANTA'', ''Otro'', ''Otro texto'', ''[]'')',
      current_setting('prueba.r1'), gen_random_uuid(), current_setting('prueba.d1')),
    'solo se corrige lo observado', 'no está observado');
  v := public.registrar_reporte_corregido(current_setting('prueba.r2')::uuid, current_setting('prueba.r2b')::uuid,
         current_setting('prueba.d1')::date, 'PLANTA', 'Limpieza al cierre', 'Orden de la zona de corte.',
         format('[{"descripcion": "Limpieza", "avance": 100, "personal": [{"trabajador_id": "%s", "horas": 1}]}]', current_setting('prueba.juan'))::jsonb,
         null, null);
  perform test.afirmar((select reemplaza_a from public.reportes_diarios where id = current_setting('prueba.r2b')::uuid)
    = current_setting('prueba.r2')::uuid, 'el corregido sabe a cuál reemplaza');
  perform test.afirmar((select motivo_anulacion from public.reportes_diarios where id = current_setting('prueba.r2')::uuid)
    = 'Corregido por la observación de Recursos Humanos: Juan hizo 1 hora de limpieza, no 2.',
    'el observado queda anulado con la observación como motivo');
  reset role;

  perform test.como_usuario(current_setting('prueba.sup2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_reporte_corregido(%L, %L, %L, ''PLANTA'', ''Otro'', ''Otro texto'', ''[]'')',
      current_setting('prueba.r2'), gen_random_uuid(), current_setting('prueba.d1')),
    'otro supervisor no corrige un reporte ajeno', 'tus propios');
  reset role;

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.notificaciones where titulo like 'Reporte corregido por validar%') = 1,
    'a RR. HH. le llega el corregido para validar');
  perform public.validar_reporte_diario(current_setting('prueba.r2b')::uuid, 'RRHH');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r2b')::uuid, 'GERENCIA');
  reset role;
end $$;

-- -------------------------------- una foto pasa de corrección en corrección
-- Observado dos veces: la foto del primero sigue en el tercero. Al final el
-- supervisor lo anula (no estaba validado) y sus horas no cuentan para nada.
select set_config('prueba.r4b', gen_random_uuid()::text, true);
select set_config('prueba.r4c', gen_random_uuid()::text, true);
select set_config('prueba.foto4', :'sup1_id' || '/' || current_setting('prueba.r4') || '/' || gen_random_uuid() || '.jpg', true);
do $$
declare
  v uuid;
  v_trab jsonb := format('[{"descripcion": "Masillado", "avance": 30, "personal": [{"trabajador_id": "%s", "horas": 1}]}]',
                         current_setting('prueba.ana'))::jsonb;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-reporte-diario', current_setting('prueba.foto4'), current_setting('prueba.sup1'), '{"mimetype": "image/jpeg", "size": 90000}');
  v := public.registrar_reporte_diario(current_setting('prueba.r4')::uuid, current_setting('prueba.d2')::date, 'PLANTA', 'Masillado',
         'Masillado de la puerta.', v_trab, null, jsonb_build_array(current_setting('prueba.foto4')));
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.observar_reporte_diario(current_setting('prueba.r4')::uuid, 'GERENCIA', 'El avance no es 30 %, es 20 %.');
  reset role;
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  v := public.registrar_reporte_corregido(current_setting('prueba.r4')::uuid, current_setting('prueba.r4b')::uuid,
         current_setting('prueba.d2')::date, 'PLANTA', 'Masillado', 'Masillado de la puerta.', v_trab, null,
         jsonb_build_array(current_setting('prueba.foto4')));
  reset role;
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform public.observar_reporte_diario(current_setting('prueba.r4b')::uuid, 'RRHH', 'Ana no trabajó ese día en Acabados.');
  reset role;
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  v := public.registrar_reporte_corregido(current_setting('prueba.r4b')::uuid, current_setting('prueba.r4c')::uuid,
         current_setting('prueba.d2')::date, 'PLANTA', 'Masillado', 'Masillado de la puerta.', v_trab, null,
         jsonb_build_array(current_setting('prueba.foto4')));
  perform test.afirmar((select count(*) from public.reporte_diario_fotos where ruta = current_setting('prueba.foto4')) = 3,
    'la misma foto queda en los tres reportes: los dos observados y el que vale');
  v := public.anular_reporte_diario(current_setting('prueba.r4c')::uuid, 'Lo subo de nuevo mañana con todo');
  reset role;
end $$;

-- ------------------------------------------------------------------- las horas extras
do $$
declare v uuid; r record;
begin
  -- Tesorería y el supervisor no deciden ni miran las extras.
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.horas_extras_por_decidir()', 'Tesorería no ve las horas extras', 'horas extras');
  perform test.afirmar((select count(*) from public.trabajador_remuneraciones) = 0, 'Tesorería NO lee la remuneración en la ficha');
  perform test.afirmar((select count(*) from public.trabajador_cuentas) = 0, 'ni las cuentas del personal fuera de la planilla');
  reset role;
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.horas_extras_por_decidir()', 'el supervisor no ve las horas extras', 'horas extras');
  perform test.afirmar((select count(*) from public.trabajador_remuneraciones) = 0, 'el supervisor NO ve la remuneración');
  reset role;

  -- Gerencia las consulta, sin el sueldo, y no decide.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.horas_extras_por_decidir()) = 2, 'Gerencia ve las dos jornadas con extras');
  perform test.afirmar((select bool_and(remuneracion_mensual is null) from public.horas_extras_por_decidir()), 'sin la remuneración');
  perform test.debe_fallar(format('select public.rrhh_decidir_horas_extras(%L, %L, %L, ''PAGAR'')',
      gen_random_uuid(), current_setting('prueba.juan'), current_setting('prueba.d1')),
    'Gerencia no decide las extras', 'planilla_diaria.preparar');
  reset role;

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  select * into r from public.horas_extras_por_decidir() where fecha = current_setting('prueba.d1')::date;
  perform test.afirmar(r.horas_del_dia = 11 and r.extras = 3 and r.por_decidir = 3 and r.horas_tramo1 = 2 and r.horas_tramo2 = 1
    and r.remuneracion_mensual = 2400,
    'día 1: 11 h validadas (el reporte observado ya no cuenta), 3 extras: 2 al 25 % y 1 al 35 %');
  select * into r from public.horas_extras_por_decidir() where fecha = current_setting('prueba.d2')::date;
  perform test.afirmar(r.extras = 1.5 and r.horas_tramo1 = 1.5 and r.horas_tramo2 = 0, 'día 2: 1,5 extras, todas al 25 %');

  v := public.rrhh_decidir_horas_extras(current_setting('prueba.pagar')::uuid, current_setting('prueba.juan')::uuid,
         current_setting('prueba.d1')::date, 'PAGAR');
  v := public.rrhh_decidir_horas_extras(current_setting('prueba.pagar')::uuid, current_setting('prueba.juan')::uuid,
         current_setting('prueba.d1')::date, 'PAGAR');
  perform test.afirmar((select count(*) from public.horas_extras_decisiones) = 1, 'el reintento no duplica la decisión');
  perform test.debe_fallar(format('select public.rrhh_decidir_horas_extras(%L, %L, %L, ''RESERVAR'')',
      gen_random_uuid(), current_setting('prueba.juan'), current_setting('prueba.d1')),
    'lo decidido no se decide otra vez', 'no tiene horas extras por decidir');
  v := public.rrhh_decidir_horas_extras(current_setting('prueba.reservar')::uuid, current_setting('prueba.juan')::uuid,
         current_setting('prueba.d2')::date, 'RESERVAR');
  perform test.afirmar((select count(*) from public.horas_extras_por_decidir()) = 0, 'ya no queda nada por decidir');
  perform test.afirmar((select saldo from public.saldo_horas_por_persona(current_setting('prueba.juan')::uuid)) = 1.5,
    'Juan tiene 1,5 h en su saldo');

  -- Usar el saldo: no más de lo que hay.
  perform test.debe_fallar(format('select public.rrhh_usar_saldo_horas(%L, %L, %L, 2, ''Permiso por trámite personal'')',
      gen_random_uuid(), current_setting('prueba.juan'), current_setting('prueba.d1')),
    'no se usa más de lo reservado', 'no le alcanzan');
  v := public.rrhh_usar_saldo_horas(current_setting('prueba.uso')::uuid, current_setting('prueba.juan')::uuid,
         (now() at time zone 'America/Lima')::date, 1, 'Permiso por trámite personal');
  perform test.afirmar((select saldo from public.saldo_horas_por_persona(current_setting('prueba.juan')::uuid)) = 0.5, 'le queda 0,5 h');
  perform test.debe_fallar(format('select public.rrhh_anular_decision_horas_extras(%L, ''Se reservó por error'')', current_setting('prueba.reservar')),
    'no se anula una reserva ya usada', 'ya se usaron');
  v := public.rrhh_anular_uso_saldo(current_setting('prueba.uso')::uuid, 'Al final no tomó el permiso');
  v := public.rrhh_anular_decision_horas_extras(current_setting('prueba.reservar')::uuid, 'Se reservó por error');
  perform test.afirmar((select por_decidir from public.horas_extras_por_decidir() where fecha = current_setting('prueba.d2')::date) = 1.5,
    'anulada la decisión, las horas vuelven a esperar');
  v := public.rrhh_decidir_horas_extras(gen_random_uuid(), current_setting('prueba.juan')::uuid, current_setting('prueba.d2')::date, 'RESERVAR');

  -- La regla la ajusta RR. HH., sin bajar de la ley.
  perform test.debe_fallar('select public.rrhh_guardar_regla_horas_extras(2, 20, 35)', 'el primer recargo no baja de 25 %', '25 %');
  perform test.debe_fallar('select public.rrhh_guardar_regla_horas_extras(2, 25, 30)', 'el segundo recargo no baja de 35 %', '35 %');
  perform test.debe_fallar('select public.rrhh_guardar_regla_horas_extras(3, 25, 35)', 'no más de 2 horas con el primer recargo', '0 a 2');
  perform test.debe_fallar('select public.rrhh_guardar_regla_horas_extras(2, 40, 35)', 'el segundo recargo no es menor', 'segundo recargo');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select public.rrhh_guardar_regla_horas_extras(2, 30, 40)', 'Gerencia no cambia la regla', 'planilla_diaria.preparar');
  perform test.afirmar((select count(*) from public.horas_extras_decisiones where anulado_en is null) = 2, 'Gerencia ve lo decidido');
  reset role;
end $$;

-- --------------------------------------------------- RR. HH. arma la planilla y la manda
do $$
declare v uuid; v_pd public.planillas_diarias%rowtype; v_pp public.planilla_diaria_personas%rowtype;
begin
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.enviar_planilla_diaria(%L)', gen_random_uuid()),
    'Tesorería no arma la planilla', 'planilla_diaria.preparar');
  reset role;

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.planilla_diaria_por_enviar()) = 4,
    'por enviar: Juan día 1 y día 2 ordinarias, sus extras pagadas del día 1, y Ana día 1');
  perform test.afirmar((select remuneracion_mensual from public.planilla_diaria_por_enviar()
                         where trabajador_id = current_setting('prueba.ana')::uuid) is null, 'Ana todavía sin remuneración');
  v := public.enviar_planilla_diaria(current_setting('prueba.pd1')::uuid);
  v := public.enviar_planilla_diaria(current_setting('prueba.pd1')::uuid);
  select * into v_pd from public.planillas_diarias where id = current_setting('prueba.pd1')::uuid;
  perform test.afirmar((select count(*) from public.planillas_diarias) = 1, 'el reintento no duplica la planilla');
  perform test.afirmar(v_pd.numero = 'PD-0001-' || extract(year from now() at time zone 'America/Lima'), 'la planilla lleva su número: ' || v_pd.numero);
  select * into v_pp from public.planilla_diaria_personas where planilla_id = v_pd.id;
  -- 16 h ordinarias a S/ 10 = 160; 3 extras: 10 × (2 × 1,25 + 1 × 1,35) = 38,50.
  perform test.afirmar(v_pd.personas = 1 and v_pp.horas_ordinarias = 16 and v_pp.horas_extras = 3
    and v_pp.monto_ordinarias = 160 and v_pp.monto_extras = 38.5 and v_pd.total = 198.5,
    'entra solo Juan (Ana no tiene remuneración): 16 h ordinarias S/ 160 y 3 extras S/ 38,50');
  perform test.afirmar((select count(*) from public.planilla_diaria_detalle where persona_id = v_pp.id) = 3, 'con un renglón por día y concepto');
  perform test.debe_fallar(format('select public.enviar_planilla_diaria(%L)', gen_random_uuid()),
    'lo de Ana espera su remuneración y se dice', 'Falta la remuneración mensual de Ana Pintora');

  v := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.ana')::uuid, 1200);
  v := public.enviar_planilla_diaria(current_setting('prueba.pd2')::uuid);
  perform test.afirmar((select total from public.planillas_diarias where id = current_setting('prueba.pd2')::uuid) = 25,
    'con su remuneración, Ana entra en la siguiente: 5 h a S/ 5');
  perform test.debe_fallar(format('select public.enviar_planilla_diaria(%L)', gen_random_uuid()),
    'sin nada pendiente no sale planilla', 'No hay horas validadas por pagar');

  -- Lo que ya está en una planilla no se deshace por debajo.
  perform test.debe_fallar(format('select public.anular_reporte_diario(%L, ''Se subió con un error'')', current_setting('prueba.r1')),
    'no se anula un reporte cuyas horas ya están en la planilla', 'ya están en la planilla PD-');
  perform test.debe_fallar(format('select public.rrhh_anular_decision_horas_extras(%L, ''Mejor reservarlas'')', current_setting('prueba.pagar')),
    'no se anula una decisión de pagar que ya está en la planilla', 'PD-0001');

  -- La segunda se anula (no tiene pagos) y lo de Ana vuelve a esperar.
  perform test.debe_fallar(format('select public.anular_planilla_diaria(%L, ''corto'')', current_setting('prueba.pd2')), 'anular pide motivo', '10 a 500');
  v := public.anular_planilla_diaria(current_setting('prueba.pd2')::uuid, 'Se armó antes de revisar las horas de Ana');
  perform test.afirmar((select count(*) from public.planilla_diaria_por_enviar() where trabajador_id = current_setting('prueba.ana')::uuid) = 1,
    'anulada la planilla, lo de Ana vuelve a esperar');
  reset role;

  -- Tesorería recibe el aviso.
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.notificaciones where titulo = 'Planilla diaria por pagar: ' || v_pd.numero) = 1,
    'a Tesorería le llega la planilla por pagar');
  perform test.debe_fallar(format('select public.anular_planilla_diaria(%L, ''Tesorería quiere anularla'')', current_setting('prueba.pd1')),
    'Tesorería no anula la planilla', 'planilla_diaria.preparar');
  reset role;
end $$;

-- ------------------------------------------------------------- quién ve la planilla
do $$
begin
  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.planillas_diarias) = 2, 'Tesorería ve las planillas');
  perform test.afirmar((select count(*) from public.planilla_diaria_detalle) = 4, 'y su detalle');
  perform test.afirmar((select count(*) from public.planilla_diaria_cuentas(current_setting('prueba.pd1')::uuid) where numero_cuenta is not null) = 1,
    'Tesorería ve la cuenta de quien está en la planilla');
  perform test.afirmar((select count(*) from public.planilla_diaria_cuentas(current_setting('prueba.pd2')::uuid)) = 0,
    'y no la de una planilla anulada');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.planilla_diaria_personas) = 2, 'Gerencia consulta las planillas');
  perform test.debe_fallar(format('select * from public.planilla_diaria_cuentas(%L)', current_setting('prueba.pd1')),
    'Gerencia no ve las cuentas', 'No tienes permiso para ver las cuentas de la planilla');
  perform test.afirmar((select count(*) from public.trabajador_remuneraciones) = 0, 'ni la remuneración de la ficha');
  reset role;

  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.planillas_diarias) = 0, 'el supervisor NO ve la planilla');
  perform test.afirmar((select count(*) from public.planilla_diaria_personas) = 0, 'ni lo que se le paga a nadie');
  perform test.debe_fallar(format('select * from public.planilla_diaria_cuentas(%L)', current_setting('prueba.pd1')),
    'ni las cuentas', 'No tienes permiso para ver las cuentas de la planilla');
  reset role;

  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.planillas_diarias) = 0, 'el portero NO ve la planilla');
  perform test.afirmar((select count(*) from public.horas_extras_decisiones) = 0, 'ni las horas extras');
  reset role;
end $$;

-- ------------------------------------------------- Tesorería paga y adjunta la boleta
select set_config('prueba.comprobante', current_setting('prueba.pd1') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.boleta', current_setting('prueba.pd1') || '/' || gen_random_uuid() || '.pdf', true);
do $$
declare v uuid; v_persona uuid;
begin
  select id into v_persona from public.planilla_diaria_personas where planilla_id = current_setting('prueba.pd1')::uuid;
  perform set_config('prueba.persona', v_persona::text, true);

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''planilla-diaria'', %L, %L, ''{}'')',
      current_setting('prueba.pd1') || '/' || gen_random_uuid() || '.pdf', current_setting('prueba.rrhh')),
    'RR. HH. no sube comprobantes', 'row-level security');
  reset role;

  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''planilla-diaria'', %L, %L, ''{}'')',
      current_setting('prueba.pd2') || '/' || gen_random_uuid() || '.pdf', current_setting('prueba.tesoreria')),
    'no se sube a una planilla anulada', 'row-level security');
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('planilla-diaria', current_setting('prueba.comprobante'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 84000}'),
    ('planilla-diaria', current_setting('prueba.boleta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 52000}');

  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, ''OP-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      gen_random_uuid(), current_setting('prueba.pd1'), '{}', (now() at time zone 'America/Lima')::date, current_setting('prueba.comprobante')),
    'el pago dice a quién se pagó', 'Marca a quién');
  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, ''OP-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      gen_random_uuid(), current_setting('prueba.pd1'), array[v_persona], (now() at time zone 'America/Lima')::date,
      current_setting('prueba.pd1') || '/' || gen_random_uuid() || '.pdf'),
    'un comprobante que no subió no entra', 'no terminó de subir');
  v := public.registrar_pago_planilla_diaria(current_setting('prueba.pago')::uuid, current_setting('prueba.pd1')::uuid, array[v_persona],
         (now() at time zone 'America/Lima')::date, 'OP-000123', current_setting('prueba.comprobante'), current_setting('prueba.caja')::uuid, null);
  v := public.registrar_pago_planilla_diaria(current_setting('prueba.pago')::uuid, current_setting('prueba.pd1')::uuid, array[v_persona],
         (now() at time zone 'America/Lima')::date, 'OP-000123', current_setting('prueba.comprobante'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar((select count(*) from public.planilla_diaria_pagos) = 1, 'el reintento no duplica el pago');
  perform test.afirmar((select pago_id from public.planilla_diaria_personas where id = v_persona) = current_setting('prueba.pago')::uuid,
    'Juan queda pagado con su comprobante');
  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      gen_random_uuid(), current_setting('prueba.pd1'), array[v_persona], (now() at time zone 'America/Lima')::date, current_setting('prueba.boleta')),
    'a quien ya se pagó no se le paga otra vez', 'ya está pagada');
  v := public.subir_boleta_planilla_diaria(v_persona, current_setting('prueba.boleta'));
  reset role;

  -- RR. HH.: aviso de pagada y de boletas, ve el comprobante y entrega la boleta.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.notificaciones where titulo like 'Planilla diaria pagada:%') = 1,
    'a RR. HH. le llega que la planilla está pagada');
  perform test.afirmar((select count(*) from public.notificaciones where titulo like 'Boletas por entregar:%') = 1,
    'y que las boletas están para entregar');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'planilla-diaria') = 2,
    'RR. HH. ve el comprobante y la boleta');
  perform test.debe_fallar(format('select public.subir_boleta_planilla_diaria(%L, %L)', v_persona, current_setting('prueba.boleta')),
    'RR. HH. no sube boletas', 'planilla_diaria.pagar');
  perform test.debe_fallar(format('select public.anular_planilla_diaria(%L, ''Ya pagada pero la anulo'')', current_setting('prueba.pd1')),
    'una planilla con pago no se anula', 'ya registró un pago');
  v := public.entregar_boleta_planilla_diaria(v_persona);
  perform test.afirmar((select boleta_entregada_en is not null from public.planilla_diaria_personas where id = v_persona), 'RR. HH. entregó la boleta');
  reset role;

  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'planilla-diaria') = 0, 'el supervisor NO ve comprobantes ni boletas');
  reset role;

  perform test.como_usuario(current_setting('prueba.tesoreria')::uuid);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'planilla-diaria' and name = current_setting('prueba.comprobante');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'planilla-diaria') = 2, 'el comprobante y la boleta siguen');
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('planilla-diaria', current_setting('prueba.pd1') || '/' || '00000000-0000-4000-8000-000000000001.pdf', current_setting('prueba.tesoreria'),
     '{"mimetype": "application/pdf", "size": 1000}');
  perform test.debe_fallar(format('select public.subir_boleta_planilla_diaria(%L, %L)', v_persona,
      current_setting('prueba.pd1') || '/' || '00000000-0000-4000-8000-000000000001.pdf'),
    'una boleta entregada ya no se cambia', 'ya entregó');
  v := public.anular_pago_planilla_diaria(current_setting('prueba.pago')::uuid, 'Se registró en la planilla equivocada');
  perform test.afirmar((select pago_id from public.planilla_diaria_personas where id = v_persona) is null,
    'anulado el pago, Juan vuelve a quedar por pagar');
  reset role;
end $$;

-- ------------------------------------------------ ni siquiera el dueño de la tabla
do $$
begin
  perform test.debe_fallar(format('delete from public.planillas_diarias where id = %L', current_setting('prueba.pd1')),
    'la planilla no se borra', 'no se borran');
  perform test.debe_fallar(format('update public.planillas_diarias set total = 1 where id = %L', current_setting('prueba.pd1')),
    'el total de la planilla no se corrige', 'no se corrige');
  perform test.debe_fallar(format('update public.planillas_diarias set motivo_anulacion = ''Otro motivo cualquiera'' where id = %L', current_setting('prueba.pd2')),
    'una planilla anulada queda congelada', 'anulado');
  perform test.debe_fallar(format('update public.planilla_diaria_personas set total = 1 where id = %L', current_setting('prueba.persona')),
    'lo que se le paga a una persona no se corrige', 'no se corrige');
  perform test.debe_fallar(format('delete from public.planilla_diaria_detalle where persona_id = %L', current_setting('prueba.persona')),
    'el detalle no se borra', 'no se cambia ni se borra');
  perform test.debe_fallar(format('delete from public.horas_extras_decisiones where id = %L', current_setting('prueba.pagar')),
    'una decisión no se borra');
  perform test.debe_fallar(format('delete from public.planilla_diaria_pagos where id = %L', current_setting('prueba.pago')),
    'un pago no se borra', 'no se borran');
end $$;

rollback;
