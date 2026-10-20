-- La asistencia la corrige RR. HH. y la regla de las horas extras se guarda
-- (migración 20261020169000). RR. HH. anula una marca de cualquier día; la
-- portería, solo la de hoy; Gerencia, que consulta, y el administrador del
-- sistema, no anulan ni marcan. RR. HH. guarda la regla de las horas extras.
-- Cada paso con `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA407', 'Taller prueba 407') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA407' \gset
select test.crear_usuario('Ada', 'Admin', 'admin407@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh407@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria407@demo.pe', 'PORTERO', :'sede_id') as portero_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia407@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.hoy', gen_random_uuid()::text, true);
select set_config('prueba.ayer', gen_random_uuid()::text, true);
select set_config('prueba.ayer_rrhh', gen_random_uuid()::text, true);

-- RR. HH. registra a la persona; la portería la marca hoy.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Tito', 'Prueba 407', '70000407', 'Soldador',
  null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000407', null);
reset role;
select test.como_usuario(:'portero_id');
set local role authenticated;
select public.marcar_asistencia(current_setting('prueba.hoy')::uuid, current_setting('prueba.t1')::uuid, 'INGRESO', null);
reset role;
-- Dos marcas de ayer, puestas como el dueño de la tabla (la portería marca solo hoy).
insert into public.asistencias (id, trabajador_id, fecha, tipo, marcado_en, hora, tardanza_minutos, descuento, registrado_por)
select current_setting(k)::uuid, current_setting('prueba.t1')::uuid, (now() at time zone 'America/Lima')::date - 1, t,
       now() - interval '1 day', '08:30', 0, 0, :'portero_id'
  from (values ('prueba.ayer', 'INGRESO'), ('prueba.ayer_rrhh', 'SALIDA')) v(k, t);

-- Gerencia consulta la asistencia, pero no la anula.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.t1')::uuid) = 3,
  'Gerencia ve las marcas');
select test.debe_fallar(format($q$select public.anular_asistencia(%L, 'Se marcó a otra persona')$q$, current_setting('prueba.hoy')),
  'Gerencia no anula una marca', 'las anula Recursos Humanos');
reset role;

-- El administrador tampoco: ni anula ni marca.
select test.como_usuario(:'admin_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_asistencia(%L, 'Se marcó a otra persona')$q$, current_setting('prueba.hoy')),
  'el administrador no anula una marca', 'Recursos Humanos');
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'SALIDA', null)$q$, gen_random_uuid(), current_setting('prueba.t1')),
  'ni marca la asistencia', 'Recursos Humanos');
reset role;

-- La portería anula la de hoy, no la de ayer.
select test.como_usuario(:'portero_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_asistencia(%L, 'Se marcó a otra persona')$q$, current_setting('prueba.ayer_rrhh')),
  'la portería no anula una marca de ayer', 'solo anula marcas de hoy');
select public.anular_asistencia(current_setting('prueba.hoy')::uuid, 'Se marcó a otra persona');
reset role;

-- RR. HH. anula la de ayer.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.anular_asistencia(current_setting('prueba.ayer_rrhh')::uuid, 'La salida de ayer se marcó dos veces');
reset role;
select test.afirmar((select count(*) from public.asistencias
                      where id in (current_setting('prueba.hoy')::uuid, current_setting('prueba.ayer_rrhh')::uuid)
                        and anulado_en is not null) = 2,
  'la portería anuló la de hoy y RR. HH. la de ayer');
select test.afirmar((select anulado_en is null from public.asistencias where id = current_setting('prueba.ayer')::uuid),
  'y la que nadie podía anular sigue vigente');

-- RR. HH. guarda la regla de las horas extras (antes reventaba en la auditoría).
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_regla_horas_extras(2, 30, 40);
select test.afirmar((select recargo_tramo1 = 30 and recargo_tramo2 = 40 from public.rrhh_regla_horas_extras),
  'RR. HH. guarda la regla de las horas extras');
reset role;

-- Ninguna tabla auditada tiene un id que la auditoría no pueda guardar.
select test.afirmar(not exists (
  select 1 from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attname = 'id'
   where t.tgname = 'trg_auditoria' and t.tgenabled <> 'D' and a.atttypid <> 'uuid'::regtype),
  'ninguna tabla auditada tiene un id que no sea uuid');

rollback;
