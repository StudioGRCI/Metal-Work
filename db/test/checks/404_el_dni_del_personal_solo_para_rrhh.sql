-- El DNI de la ficha del personal (migración 20261020165000), probado con los
-- puestos reales y `set local role authenticated`:
--
--   · Gerencia, Administración y la portería leen la ficha (nombre, cargo,
--     horario) pero no el DNI, ni por la tabla, ni por las tardanzas, ni por
--     la auditoría;
--   · la portería escribe los 8 dígitos y encuentra a la persona sin ver el
--     número de nadie; Gerencia no busca por DNI;
--   · Recursos Humanos sí lo lee, para su ficha.
--
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA404', 'Taller prueba 404') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA404' \gset
select test.crear_usuario('Gil', 'Gerente', 'gerencia404@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Ofe', 'Oficina', 'administracion404@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Rut', 'Humanos', 'rrhh404@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Pio', 'Portero', 'porteria404@demo.pe', 'PORTERO', :'sede_id') as portero_id \gset

-- La ficha la crea RR. HH. con su función, que deja la copia en la auditoría.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(gen_random_uuid(), 'TOMÁS', 'QUISPE 404', '40440440', 'Soldador', null,
  '07:30', '17:00', 'BCP', 'AHORROS', '191-4040404', null) as tomas_id \gset
select public.rrhh_guardar_trabajador(gen_random_uuid(), 'ROSA', 'BAJA 404', '40440441', 'Pintora', null,
  '07:30', '17:00', 'BCP', 'AHORROS', '191-4040405', null) as rosa_id \gset
reset role;
select set_config('prueba.tomas', :'tomas_id', true);
update public.trabajadores set activo = false, fecha_baja = current_date where id = :'rosa_id';

-- ================================================ quien consulta, sin el DNI
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select count(*) from public.trabajadores where id = :'tomas_id' and cargo = 'Soldador') = 1,
  'Gerencia sigue leyendo la ficha: nombre, cargo y horario');
select test.debe_fallar($$ select dni from public.trabajadores $$,
  'Gerencia no lee el DNI de la ficha', 'permission denied');
select test.debe_fallar($$ select * from public.trabajadores $$,
  'ni pidiendo la fila entera', 'permission denied');
select test.afirmar((select dni is null from public.rrhh_tardanzas_del_mes(current_date) where trabajador_id = :'tomas_id'),
  'las tardanzas del mes le llegan sin el DNI');
select test.debe_fallar($$ select * from public.rrhh_dni_de_trabajadores() $$,
  'Gerencia no pide los DNI por la función de RR. HH.', 'Recursos Humanos');
select test.debe_fallar($$ select public.asistencia_buscar_por_dni('40440440') $$,
  'Gerencia no busca por DNI', 'portería');
select test.afirmar(public.tiene_permiso('auditoria.ver'), 'Gerencia consulta la auditoría');
select test.afirmar((select count(*) from public.audit_log where tabla = 'trabajadores') = 0,
  'pero no la copia de la ficha, que lleva el DNI');
reset role;
select test.afirmar((select count(*) from public.audit_log where tabla = 'trabajadores' and registro_id = :'tomas_id') > 0,
  'la ficha sí quedó en la auditoría');

select test.como_usuario(:'oficina_id');
set local role authenticated;
select test.afirmar((select count(*) from public.trabajadores where id = :'tomas_id') = 1, 'Administración lee la ficha');
select test.debe_fallar($$ select dni from public.trabajadores $$,
  'Administración no lee el DNI', 'permission denied');
select test.afirmar((select dni is null from public.rrhh_tardanzas_del_mes(current_date) where trabajador_id = :'tomas_id'),
  'ni en las tardanzas');
reset role;

-- ========================================= la portería busca sin ver el número
select test.como_usuario(:'portero_id');
set local role authenticated;
select test.afirmar((select count(*) from public.trabajadores where activo) >= 1, 'la portería lee la lista del personal');
select test.debe_fallar($$ select dni from public.trabajadores $$,
  'la portería no lee el DNI', 'permission denied');
select test.afirmar(public.asistencia_buscar_por_dni('40440440') = :'tomas_id'::uuid,
  'con los 8 dígitos encuentra a la persona');
select test.afirmar(public.asistencia_buscar_por_dni(' 4044 0440 ') = :'tomas_id'::uuid,
  'aunque los escriba con espacios');
select test.afirmar(public.asistencia_buscar_por_dni('40440441') is null,
  'a quien está de baja no lo encuentra');
select test.afirmar(public.asistencia_buscar_por_dni('40440449') is null,
  'un DNI que no es de nadie no encuentra a nadie');
select test.debe_fallar($$ select public.asistencia_buscar_por_dni('4044') $$,
  'con un pedazo del número no busca', '8 dígitos');
-- Y marca a la persona que encontró, por su id, como siempre.
select public.marcar_asistencia(gen_random_uuid(), :'tomas_id', 'INGRESO', null) is not null as marco \gset
select test.afirmar(:'marco'::boolean, 'la portería marca a la persona que encontró por su DNI');
reset role;

-- ============================================================ RR. HH. sí
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select test.afirmar((select dni from public.rrhh_dni_de_trabajadores() where trabajador_id = :'tomas_id') = '40440440',
  'Recursos Humanos lee el DNI para su ficha');
select test.afirmar((select dni from public.rrhh_tardanzas_del_mes(current_date) where trabajador_id = :'tomas_id') = '40440440',
  'y en las tardanzas');
reset role;

rollback;
