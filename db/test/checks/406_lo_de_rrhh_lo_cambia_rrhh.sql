-- Lo de RR. HH. lo cambia RR. HH.; el administrador del sistema solo mira
-- (migración 20261020167000, StudioGRCI 2026-10-20: «admin solo visualizaria»).
-- El administrador no guarda la ficha, el costo, el tareo, la regla de tardanza
-- ni una observación, pero lee el personal y lo que espera su costo. RR. HH. sí
-- guarda. Cada paso con `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA406', 'Taller prueba 406') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA406' \gset
select test.crear_usuario('Ada', 'Admin', 'admin406@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh406@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- RR. HH. registra a la persona y le pone su costo.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Tito', 'Prueba 406', '70000406', 'Soldador',
  null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000406', null);
select public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 2400);
select test.afirmar((select count(*) from public.trabajador_costos where trabajador_id = current_setting('prueba.t1')::uuid) >= 1,
  'RR. HH. guarda la ficha y el costo');
reset role;

-- El administrador mira, pero no cambia.
select test.como_usuario(:'admin_id');
set local role authenticated;
select test.afirmar((select nombres from public.trabajadores where id = current_setting('prueba.t1')::uuid) = 'Tito',
  'el administrador ve al personal');
select test.afirmar((select count(*) from public.rrhh_horas_esperando_costo()) >= 0, 'y lee lo que espera su costo');
select test.debe_fallar(format($q$select public.rrhh_guardar_trabajador(%L, 'Tito', 'Cambiado', '70000406', 'Soldador', null,
  '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000406', null)$q$, current_setting('prueba.t1')),
  'el administrador no corrige la ficha', 'Recursos Humanos');
select test.debe_fallar(format('select public.rrhh_guardar_costo_trabajador(%L, 9999)', current_setting('prueba.t1')),
  'ni el costo mensual', 'Recursos Humanos');
select test.debe_fallar(format($q$select public.rrhh_registrar_tareo(%L, %L, %L, 'PLANTA', 4, null)$q$,
  gen_random_uuid(), current_setting('prueba.t1'), current_setting('prueba.hoy')),
  'ni carga el tareo', 'Recursos Humanos');
select test.debe_fallar('select public.rrhh_guardar_regla_tardanza(0, 3, 5)', 'ni la regla de tardanza', 'Recursos Humanos');
select test.debe_fallar(format($q$select public.rrhh_registrar_observacion(%L, %L, %L, 'VERBAL', 'Prueba 406', null, null, null)$q$,
  gen_random_uuid(), current_setting('prueba.t1'), current_setting('prueba.hoy')),
  'ni registra una observación', 'Recursos Humanos');
reset role;
select test.afirmar((select apellidos from public.trabajadores where id = current_setting('prueba.t1')::uuid) = 'Prueba 406',
  'la ficha quedó como la dejó RR. HH.');

-- Ninguna función que escribe lo de RR. HH. conserva el atajo.
select test.afirmar(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.provolatile = 'v'
     and p.prosrc ~ 'exigir_permiso\(''(rrhh\.[a-z_]+|planilla_diaria\.preparar)'''),
  'ninguna función que escribe lo de RR. HH. deja pasar al administrador');

rollback;
