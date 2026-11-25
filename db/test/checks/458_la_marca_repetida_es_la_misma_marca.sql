-- La marca repetida es la misma marca (migración 20261125100000). La portería
-- reenvía sin señal el mismo envío: si es la misma persona, el mismo tipo y la
-- marca sigue vigente, entra una vez y contesta su id; si ese envío ya fue otra
-- marca (otra persona, el ingreso cuando ahora es la salida, otra observación)
-- o se anuló, lo dice y no guarda nada. Logística no marca. Cada paso con
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA458', 'Taller prueba 458') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA458' \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh458@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria458@demo.pe', 'PORTERO', :'sede_id') as portero_id \gset
select test.crear_usuario('Luis', 'Compras', 'logistica458@demo.pe', 'LOGISTICA', :'sede_id') as logistica_id \gset
select set_config('prueba.ana', gen_random_uuid()::text, true);
select set_config('prueba.beto', gen_random_uuid()::text, true);
select set_config('prueba.ingreso', gen_random_uuid()::text, true);
select set_config('prueba.otro', gen_random_uuid()::text, true);

select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(current_setting('prueba.ana')::uuid, 'Ana', 'Prueba 458', '70000458', 'Soldador',
  null, '23:58', '23:59', 'Banco de Pruebas', 'AHORROS', '191-0000458', null);
select public.rrhh_guardar_trabajador(current_setting('prueba.beto')::uuid, 'Beto', 'Prueba 458', '70000459', 'Soldador',
  null, '23:58', '23:59', 'Banco de Pruebas', 'AHORROS', '191-0000459', null);
reset role;

-- Logística no marca.
select test.como_usuario(:'logistica_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'INGRESO', null)$q$, gen_random_uuid(), current_setting('prueba.ana')),
  'Logística no marca la asistencia', 'asistencia.marcar');
reset role;

select test.como_usuario(:'portero_id');
set local role authenticated;
-- El ingreso de Ana, y el mismo envío tres veces: una sola marca, con su id.
select test.afirmar(public.marcar_asistencia(current_setting('prueba.ingreso')::uuid, current_setting('prueba.ana')::uuid, 'INGRESO', null)
  = current_setting('prueba.ingreso')::uuid, 'la portería marca el ingreso');
select test.afirmar(public.marcar_asistencia(current_setting('prueba.ingreso')::uuid, current_setting('prueba.ana')::uuid, 'INGRESO', '  ')
  = current_setting('prueba.ingreso')::uuid, 'el mismo envío otra vez contesta su id (la observación en blanco es la misma)');
select test.afirmar(public.marcar_asistencia(current_setting('prueba.ingreso')::uuid, current_setting('prueba.ana')::uuid, 'INGRESO', null)
  = current_setting('prueba.ingreso')::uuid, 'y otra vez');
select test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.ana')::uuid) = 1,
  'el mismo envío deja una sola marca');

-- Ese envío no sirve para la salida, ni para otra persona, ni con otra observación.
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'SALIDA', null)$q$, current_setting('prueba.ingreso'), current_setting('prueba.ana')),
  'la salida con el envío del ingreso no se da por marcada', 'como el ingreso de Ana Prueba 458: esta marca no entró');
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'INGRESO', null)$q$, current_setting('prueba.ingreso'), current_setting('prueba.beto')),
  'el ingreso de otra persona con ese envío no se da por marcado', 'la primera vez que lo enviaste, como el ingreso de Ana');
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'INGRESO', 'Llegó con permiso')$q$, current_setting('prueba.ingreso'), current_setting('prueba.ana')),
  'con otra observación tampoco', 'esta marca no entró');
select test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.ana')::uuid and tipo = 'SALIDA') = 0,
  'Ana sigue sin salida');
select test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.beto')::uuid) = 0,
  'Beto sigue sin marcas');

-- Anulada, el mismo envío dice que se anuló; un envío nuevo la marca otra vez.
select public.anular_asistencia(current_setting('prueba.ingreso')::uuid, 'Prueba 458: se marcó a quien no era');
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'INGRESO', null)$q$, current_setting('prueba.ingreso'), current_setting('prueba.ana')),
  'el envío de una marca anulada no se da por marcado', 'después se anuló');
select test.afirmar(public.marcar_asistencia(current_setting('prueba.otro')::uuid, current_setting('prueba.ana')::uuid, 'INGRESO', null)
  = current_setting('prueba.otro')::uuid, 'con un envío nuevo, el ingreso se marca otra vez');
select test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.ana')::uuid and anulado_en is null) = 1,
  'queda un ingreso vigente y el anulado como evidencia');
-- Un envío nuevo sobre un ingreso vigente sigue diciendo a qué hora marcó.
select test.debe_fallar(format($q$select public.marcar_asistencia(%L, %L, 'INGRESO', null)$q$, gen_random_uuid(), current_setting('prueba.ana')),
  'un segundo ingreso del día no entra', 'ya marcó su ingreso hoy a las');
reset role;

select 'check 458: la marca repetida es la misma marca' as ok;
rollback;
