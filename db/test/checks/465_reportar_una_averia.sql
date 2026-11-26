-- Reportar una avería (migraciones 20261126100000 y 20261126100100, Plan 16.2).
-- Cada paso con su cuenta y `set local role authenticated`: cualquier cuenta
-- reporta (aquí, alguien de Ventas que no tiene ningún permiso de equipos), la
-- avería que detiene el trabajo deja el equipo parado, le avisa a Mantenimiento
-- y al responsable del área, y la de riesgo, a SSOMA o, sin SSOMA, a Gerencia.
-- El mismo envío no entra dos veces. Cada quien ve lo suyo y lo de su área;
-- Mantenimiento y Gerencia, todo; otra área, nada. Mantenimiento anula con
-- motivo y el equipo vuelve a como estaba. Nadie borra. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA465', 'Taller prueba 465') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA465' \gset
select test.crear_usuario('Ada', 'Admin', 'admin465@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Manu', 'Mantenimiento', 'mnt465@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger465@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Jaime', 'Jefe', 'jefe465@demo.pe', 'SUPERVISOR', :'sede_id') as jefe_id \gset
select test.crear_usuario('Coti', 'Compañero', 'comp465@demo.pe', 'OPERARIO', :'sede_id') as comp_id \gset
select test.crear_usuario('Remo', 'Reporta', 'rep465@demo.pe', 'VENDEDOR', :'sede_id') as rep_id \gset
select test.crear_usuario('Ajo', 'Ajeno', 'ajeno465@demo.pe', 'VENDEDOR', :'sede_id') as ajeno_id \gset
select test.crear_usuario('Sofi', 'Seguridad', 'ssoma465@demo.pe', 'SSOMA', :'sede_id') as ssoma_id \gset

-- El equipo es de Maestranza; su jefe y un compañero trabajan ahí. Quien
-- reporta es de Gerencia Comercial, y el ajeno, de Logística.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id in (:'jefe_id', :'comp_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'GCO') where id = :'rep_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'LOG') where id = :'ajeno_id';
update public.areas set jefe_id = :'jefe_id' where codigo = 'MTZ';
-- SSOMA entra recién en la sección 11: hasta entonces, la de riesgo va a Gerencia.
update public.usuarios set activo = false where id = :'ssoma_id';
-- Las cuentas de SSOMA y de Mantenimiento que traen las migraciones (las de
-- producción, 20261126600000) se apagan aquí: si no, los avisos les llegaban a
-- esas y no a las del check, ni a Gerencia cuando las del check se apagan.
update public.usuarios u set activo = false
 where u.id not in (:'ssoma_id', :'mnt_id') and u.activo
   and u.rol_id in (select id from public.roles where codigo in ('SSOMA', 'MANTENIMIENTO'));

select set_config('prueba.mnt', :'mnt_id', true);
select set_config('prueba.ger', :'ger_id', true);
select set_config('prueba.jefe', :'jefe_id', true);
select set_config('prueba.comp', :'comp_id', true);
select set_config('prueba.rep', :'rep_id', true);
select set_config('prueba.ajeno', :'ajeno_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.ssoma', :'ssoma_id', true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

-- El padrón lo arma Mantenimiento; aquí, por debajo, para no repetir el check 462.
select test.como_usuario(:'mnt_id');
insert into public.equipos (codigo, descripcion, categoria_id, area_id, ubicacion, estado, estado_nota)
select v.codigo, v.descripcion, c.id, (select id from public.areas where codigo = 'MTZ'), 'Nave 2', v.estado, v.nota
  from (values ('AM-04-91', 'Amoladora de prueba 1', 'OPERATIVO', null),
               ('AM-04-92', 'Amoladora de prueba 2', 'CON_OBSERVACION', 'La guarda está floja.'),
               ('AM-04-93', 'Amoladora de prueba 3', 'OPERATIVO', null)) v(codigo, descripcion, estado, nota)
  cross join public.equipo_categorias c where c.prefijo = 'AM-04';
update public.equipos set activo = false, baja_motivo = 'Se quemó el motor, no tiene arreglo.' where codigo = 'AM-04-93';
select set_config('prueba.e1', (select id::text from public.equipos where codigo = 'AM-04-91'), true);
select set_config('prueba.e2', (select id::text from public.equipos where codigo = 'AM-04-92'), true);
select set_config('prueba.e3', (select id::text from public.equipos where codigo = 'AM-04-93'), true);
select set_config('prueba.av1', gen_random_uuid()::text, true);
select set_config('prueba.av2', gen_random_uuid()::text, true);
select set_config('prueba.av3', gen_random_uuid()::text, true);
select set_config('prueba.av4', gen_random_uuid()::text, true);
select set_config('prueba.av5', gen_random_uuid()::text, true);
select set_config('prueba.av6', gen_random_uuid()::text, true);
select set_config('prueba.av7', gen_random_uuid()::text, true);
select set_config('prueba.foto1', :'rep_id' || '/' || current_setting('prueba.av1') || '/' || gen_random_uuid() || '.jpg', true);

-- 0. Lo que la migración dejó ----------------------------------------------------
select test.afirmar(
  exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
           where r.codigo = 'MANTENIMIENTO' and rp.permiso_codigo = 'averias.atender')
  and exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
               where r.codigo = 'GERENTE' and rp.permiso_codigo = 'averias.ver'),
  'Mantenimiento atiende las averías y Gerencia las consulta');
select test.afirmar(
  (select formato = 'AV-{numero}-{anio}' from public.series_documentarias where tipo = 'REPORTE_AVERIA'),
  'la serie del reporte es AV-0001-2026');
select test.afirmar(
  (select not public from storage.buckets where id = 'fotos-averias'),
  'el bucket de las fotos es privado');

-- 1. Quien reporta no tiene permisos de equipos, pero los elige ------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.equipos) = 0, 'Ventas no lee el padrón');
  perform test.afirmar(
    exists (select 1 from public.averias_equipos_para_elegir() where codigo = 'AM-04-91')
    and not exists (select 1 from public.averias_equipos_para_elegir() where codigo = 'AM-04-93'),
    'pero elige el equipo de los que están en uso, sin los dados de baja');
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-averias'', %L, %L, ''{}'')',
      current_setting('prueba.ajeno') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.rep')),
    'nadie sube fotos a la carpeta de otra cuenta', 'row-level security');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-averias', current_setting('prueba.foto1'), current_setting('prueba.rep'), '{"mimetype": "image/jpeg", "size": 240000}');
end $$;

-- 2. La avería que detiene el trabajo y es un riesgo ----------------------------
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av1'), pg_temp.id('e2'), 'AVERIA', true, true,
    'Se traba el disco y saca chispas por la guarda.', jsonb_build_array(current_setting('prueba.foto1')));
  perform test.afirmar(r.numero_averia ~ ('^AV-[0-9]{4}-' || extract(year from now())::int || '$'), format('entra con su número (%s)', r.numero_averia));
  perform test.afirmar(r.equipo_parado, 'y dice que dejó el equipo parado');
  perform test.afirmar(r.aviso_mantenimiento and r.aviso_responsable, 'le llegó a Mantenimiento y al responsable del área');
  perform test.afirmar(not r.aviso_ssoma and r.aviso_gerencia, 'sin SSOMA con cuenta, la de riesgo le llegó a Gerencia');
  perform set_config('prueba.numero1', r.numero_averia, true);
  perform test.afirmar((select count(*) from public.averias) = 1, 'quien reporta ve su reporte');
  perform test.afirmar((select count(*) from public.averia_fotos) = 1, 'y su foto');
  perform test.afirmar((select count(*) from public.equipos) = 0, 'y sigue sin leer el padrón');
end $$;
reset role;

select test.afirmar(
  (select estado = 'PARADO' and estado_nota like 'Avería ' || current_setting('prueba.numero1') || ':%' from public.equipos where id = pg_temp.id('e2')),
  'el equipo quedó parado, con el número del reporte en su nota');
select test.afirmar(
  (select paro_el_equipo and equipo_estado_antes = 'CON_OBSERVACION' and equipo_nota_antes = 'La guarda está floja.'
     from public.averias where id = pg_temp.id('av1')),
  'el reporte guarda cómo estaba el equipo antes');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('mnt'))
  and (select count(*) = 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('jefe')
                                                         and titulo like '%(en tu área)')
  and (select count(*) = 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('ger'))
  and not exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('rep')),
  'un aviso a cada uno, y ninguno a quien reporta');
select test.afirmar(
  (select titulo like 'Avería AV-%: AM-04-92 %' and cuerpo like 'Detiene el trabajo. Es un riesgo para las personas.%'
     from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('mnt')),
  'el aviso dice el equipo, que detiene el trabajo y que es un riesgo');

-- 3. El mismo envío no entra dos veces --------------------------------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av1'), pg_temp.id('e2'), 'AVERIA', true, true,
    'Se traba el disco y saca chispas por la guarda.', jsonb_build_array(current_setting('prueba.foto1')));
  perform test.afirmar(r.numero_averia = current_setting('prueba.numero1') and r.aviso_mantenimiento,
    'el reintento con lo mismo devuelve el mismo número');
  perform test.afirmar((select count(*) from public.averias) = 1, 'y no entra otro');
  perform test.debe_fallar(
    format('select * from public.averias_reportar(%L, %L, ''AVERIA'', true, true, ''Otra cosa distinta que se cambió.'', ''[]'')',
      current_setting('prueba.av1'), current_setting('prueba.e2')),
    'con otra cosa, dice que ya quedó', 'ya quedó registrado');
end $$;

-- 4. Lo que no entra ---------------------------------------------------------------
do $$ begin
  perform test.debe_fallar(
    format('select * from public.averias_reportar(%L, %L, ''POSIBLE_AVERIA'', true, false, ''Hace un ruido raro al arrancar.'', ''[]'')',
      current_setting('prueba.av2'), current_setting('prueba.e1')),
    'una posible avería no detiene el trabajo', 'es una avería');
  perform test.debe_fallar(
    format('select * from public.averias_reportar(%L, %L, ''AVERIA'', false, false, ''Ya no prende para nada.'', ''[]'')',
      current_setting('prueba.av2'), current_setting('prueba.e3')),
    'un equipo dado de baja no se reporta', 'dado de baja');
  perform test.debe_fallar(
    format('select * from public.averias_reportar(%L, %L, ''AVERIA'', false, false, ''Falla'', ''[]'')',
      current_setting('prueba.av2'), current_setting('prueba.e1')),
    'sin contar qué le pasa no entra', 'al menos 10');
  perform test.debe_fallar(
    format('select * from public.averias_reportar(%L, %L, ''AVERIA'', null, false, ''Ya no prende para nada.'', ''[]'')',
      current_setting('prueba.av2'), current_setting('prueba.e1')),
    'la avería dice si detiene el trabajo', 'detiene el trabajo');
  perform test.debe_fallar(
    'insert into public.averias (numero, equipo_id, tipo, riesgo_personas, descripcion) values (''AV-9999-2026'', '''
      || current_setting('prueba.e1') || ''', ''AVERIA'', false, ''Por la tabla, sin función.'')',
    'por la tabla no se reporta', 'permission denied');
end $$;

-- 5. La posible avería no cambia el estado ------------------------------------------
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av2'), pg_temp.id('e1'), 'POSIBLE_AVERIA', null, false,
    'Hace un ruido raro al arrancar, como de rodaje.', '[]');
  perform test.afirmar(not r.equipo_parado and r.aviso_mantenimiento and r.aviso_responsable and not r.aviso_gerencia,
    'la posible avería entra, avisa a Mantenimiento y al área, y a Gerencia no');
end $$;
reset role;
select test.afirmar((select estado = 'OPERATIVO' from public.equipos where id = pg_temp.id('e1')),
  'y el equipo sigue operativo');

-- 6. Quién ve qué ---------------------------------------------------------------------
select test.como_usuario(:'comp_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias) = 2 and (select count(*) from public.averia_fotos) = 1,
    'quien trabaja en el área del equipo ve sus reportes y sus fotos');
  perform test.afirmar((select count(*) from public.averias_visibles(null) where alcance = 'AREA') = 2,
    'en la lista, como de su área');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''No me parece una avería.'')', current_setting('prueba.av1')),
    'y no los anula', 'lo anula Mantenimiento');
end $$;
reset role;

select test.como_usuario(:'ajeno_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias) = 0 and (select count(*) from public.averia_fotos) = 0
                       and (select count(*) from public.averias_visibles(null)) = 0,
    'otra área no ve nada: ni la tabla, ni las fotos, ni la lista');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-averias') = 0, 'ni la foto en Storage');
end $$;
reset role;

select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias_visibles(null) where alcance = 'TODAS') = 2,
    'Gerencia ve todos');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''No me parece una avería.'')', current_setting('prueba.av1')),
    'pero no anula', 'lo anula Mantenimiento');
end $$;
reset role;

-- 7. Mantenimiento anula, y el equipo vuelve a como estaba --------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select count(*) from public.averias) = 2 and (select count(*) from storage.objects where bucket_id = 'fotos-averias') = 1,
    'Mantenimiento ve todos, con sus fotos');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''corto'')', current_setting('prueba.av1')),
    'sin motivo no anula', '10 a 500');
  select * into r from public.averias_anular(pg_temp.id('av1'), 'Era la amoladora de al lado, ya se reportó.');
  perform test.afirmar(r.equipo_vuelve_a = 'CON_OBSERVACION', 'anula, y el equipo vuelve a como estaba');
  select * into r from public.averias_anular(pg_temp.id('av1'), 'Era la amoladora de al lado, ya se reportó.');
  perform test.afirmar(r.averia = pg_temp.id('av1'), 'el mismo pedido repetido no falla');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''Otro motivo distinto al primero.'')', current_setting('prueba.av1')),
    'con otro motivo dice que ya estaba anulado', 'ya estaba anulado');
end $$;
reset role;
select test.afirmar(
  (select estado = 'CON_OBSERVACION' and estado_nota = 'La guarda está floja.' from public.equipos where id = pg_temp.id('e2')),
  'con su nota de antes');
select test.afirmar(
  (select estado = 'ANULADA' and anulado_por = pg_temp.id('mnt') and anulado_en is not null from public.averias where id = pg_temp.id('av1')),
  'el reporte queda anulado, con quién y cuándo');
select test.afirmar(
  exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('rep') and titulo like 'Mantenimiento anuló%'),
  'y a quien lo reportó le llega el aviso');

-- 8. Si alguien cambió el equipo después, la anulación no lo pisa ------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
select * from public.averias_reportar(pg_temp.id('av3'), pg_temp.id('e1'), 'AVERIA', true, false, 'Se cortó el cable de alimentación.', '[]') \gset r3_
reset role;
select test.afirmar(:'r3_equipo_parado'::boolean, 'la avería que detiene deja parado un equipo operativo');
select test.como_usuario(:'mnt_id');
set local role authenticated;
update public.equipos set estado = 'CON_OBSERVACION', estado_nota = 'Cable cambiado, falta probarlo.' where id = pg_temp.id('e1');
do $$
declare r record;
begin
  select * into r from public.averias_anular(pg_temp.id('av3'), 'Se reportó dos veces la misma falla.');
  perform test.afirmar(r.equipo_vuelve_a is null, 'si Mantenimiento ya lo cambió, la anulación no lo toca');
end $$;
reset role;
select test.afirmar((select estado = 'CON_OBSERVACION' from public.equipos where id = pg_temp.id('e1')), 'y queda como lo dejó Mantenimiento');

-- 9. Sin Mantenimiento con cuenta, le llega a Gerencia --------------------------------
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = :'mnt_id';
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av4'), pg_temp.id('e1'), 'POSIBLE_AVERIA', null, false,
    'El mango se mueve un poco al usarla.', '[]');
  perform test.afirmar(not r.aviso_mantenimiento and r.aviso_gerencia, 'sin Mantenimiento activo, el aviso le llega a Gerencia');
end $$;
reset role;
select test.como_usuario(:'admin_id');
update public.usuarios set activo = true where id = :'mnt_id';

-- 9b. El recorrido lo ve quien ve el reporte -------------------------------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select string_agg(paso || ':' || situacion, ' ' order by orden) from public.recorrido_de_averias(array[pg_temp.id('av2')]))
      = 'REPORTE:HECHO ATENCION:AHORA CIERRE:PENDIENTE CONFIRMACION:PENDIENTE',
    'quien reporta ve el recorrido: reportada, la tiene Mantenimiento, falta el cierre y su confirmación');
  perform test.afirmar(
    (select puesto = 'Mantenimiento' and dias = 0 and espera = 'ATENCION' from public.recorrido_de_averias(array[pg_temp.id('av2')]) where situacion = 'AHORA'),
    'quién la tiene ahora y desde hace cuántos días');
  perform test.afirmar(
    (select puesto is not null and puesto <> 'Mantenimiento' from public.recorrido_de_averias(array[pg_temp.id('av2')]) where paso = 'REPORTE'),
    'lo hecho, con el puesto de quien lo hizo');
  perform test.afirmar(
    (select string_agg(paso, ' ' order by orden) from public.recorrido_de_averias(array[pg_temp.id('av1')])) = 'REPORTE ANULACION',
    'la anulada no espera a nadie');
end $$;
reset role;
select test.como_usuario(:'ajeno_id');
set local role authenticated;
select test.afirmar((select count(*) from public.recorrido_de_averias(array[pg_temp.id('av1'), pg_temp.id('av2')])) = 0,
  'otra área no ve el recorrido');
reset role;

-- 11. Al que le llega el aviso, lo abre: el responsable de otra área y SSOMA ---------
-- El responsable de Maestranza puede trabajar en otra área (aquí, el de Logística),
-- y SSOMA no trabaja en Maestranza. A los dos les llega el aviso con su enlace.
select test.como_usuario(:'admin_id');
update public.areas set jefe_id = :'ajeno_id' where codigo = 'MTZ';
update public.usuarios set activo = true where id = :'ssoma_id';
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av5'), pg_temp.id('e1'), 'POSIBLE_AVERIA', null, true,
    'El cable de la amoladora está pelado cerca del mango.', '[]');
  perform test.afirmar(r.aviso_mantenimiento and r.aviso_responsable and r.aviso_ssoma and not r.aviso_gerencia,
    'la de riesgo le llega a Mantenimiento, al responsable y a SSOMA; con SSOMA activo, a Gerencia no');
  perform test.afirmar(r.codigo_equipo = 'AM-04-91', 'y devuelve el código del equipo, para decirlo en pantalla');
end $$;
reset role;
select test.afirmar(
  exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av5') and usuario_id = pg_temp.id('ajeno') and titulo like '%(en tu área)')
  and exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av5') and usuario_id = pg_temp.id('ssoma') and titulo like 'Riesgo para las personas:%'),
  'el aviso le llegó al responsable de otra área y a SSOMA');

select test.como_usuario(:'ajeno_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    exists (select 1 from public.averias_visibles(pg_temp.id('av5')) where alcance = 'AREA')
    and exists (select 1 from public.averias where id = pg_temp.id('av5'))
    and exists (select 1 from public.recorrido_de_averias(array[pg_temp.id('av5')])),
    'el responsable de otra área abre el reporte que le llegó, con su recorrido');
  perform test.afirmar((select count(*) from public.averias_visibles(null) where alcance = 'AREA') = 5,
    'y ve todos los del área que tiene a cargo');
end $$;
reset role;

select test.como_usuario(:'ssoma_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    exists (select 1 from public.averias_visibles(pg_temp.id('av5')) where alcance = 'RIESGO')
    and exists (select 1 from public.averias where id = pg_temp.id('av5'))
    and exists (select 1 from public.recorrido_de_averias(array[pg_temp.id('av5')])),
    'SSOMA abre la de riesgo que le llegó, con su recorrido');
  perform test.afirmar(
    not exists (select 1 from public.averias where id = pg_temp.id('av2'))
    and not exists (select 1 from public.averias_visibles(null) where not riesgo_personas),
    'y no ve las que no son un riesgo');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''No me parece una avería.'')', current_setting('prueba.av5')),
    'ni las anula', 'lo anula Mantenimiento');
end $$;
reset role;
select test.como_usuario(:'admin_id');
update public.areas set jefe_id = :'jefe_id' where codigo = 'MTZ';

-- 12. Anular el repetido no arregla la falla que otro reporte sigue diciendo ---------
select test.como_usuario(:'mnt_id');
update public.equipos set estado = 'OPERATIVO', estado_nota = null where id = pg_temp.id('e1');
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av6'), pg_temp.id('e1'), 'AVERIA', true, false, 'Ya no prende: el interruptor no hace contacto.', '[]');
  perform test.afirmar(r.equipo_parado, 'la primera deja el equipo parado');
  select * into r from public.averias_reportar(pg_temp.id('av7'), pg_temp.id('e1'), 'AVERIA', true, false, 'No prende, el interruptor está suelto.', '[]');
  perform test.afirmar(not r.equipo_parado, 'la segunda lo encuentra ya parado');
end $$;
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_anular(pg_temp.id('av6'), 'Es la misma falla del otro reporte, se queda el otro.');
  perform test.afirmar(r.equipo_vuelve_a is null and r.sigue_parado_por ~ '^AV-',
    'anular el que lo paró no lo devuelve mientras el otro siga diciendo que detiene, y dice cuál');
end $$;
reset role;
select test.afirmar(
  (select e.estado = 'PARADO' and e.estado_nota like 'Avería ' || v.numero || ':%'
     from public.equipos e join public.averias v on v.id = pg_temp.id('av7') where e.id = pg_temp.id('e1')),
  'y el equipo sigue parado, con la nota del reporte que sigue vigente');
select test.afirmar(
  (select paro_el_equipo and equipo_estado_antes = 'OPERATIVO' from public.averias where id = pg_temp.id('av7')),
  'el que sigue vigente se queda con el paro y con cómo estaba el equipo antes');
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_anular(pg_temp.id('av7'), 'Se arregló el interruptor, prueba del check.');
  perform test.afirmar(r.equipo_vuelve_a = 'OPERATIVO' and r.sigue_parado_por is null,
    'y al anular el último, el equipo vuelve a como estaba antes del primero');
end $$;
reset role;
select test.debe_fallar(format('update public.averias set paro_el_equipo = true where id = %L', current_setting('prueba.av5')),
  'el paro no se pasa a mano, solo al anular', 'no se corrige');

-- 10. Nadie borra ni corrige por debajo -------------------------------------------------
select test.como_usuario(:'admin_id');
select test.debe_fallar(format('delete from public.averias where id = %L', current_setting('prueba.av2')),
  'un reporte no se borra, ni por el administrador', 'no se borra');
select test.debe_fallar(format('update public.averias set descripcion = ''Corregido por debajo.'' where id = %L', current_setting('prueba.av2')),
  'lo que dice no se corrige', 'no se corrige');
select test.debe_fallar(format('update public.averias set motivo_anulacion = ''Cambiado.'' where id = %L', current_setting('prueba.av1')),
  'un reporte anulado queda congelado', 'está anulado');
select test.debe_fallar('delete from public.averia_fotos',
  'las fotos no se borran', 'quedan como evidencia');
select test.afirmar(
  not has_table_privilege('authenticated', 'public.averias', 'insert')
  and not has_table_privilege('authenticated', 'public.averias', 'update')
  and not has_table_privilege('authenticated', 'public.averias', 'delete')
  and not has_table_privilege('anon', 'public.averias', 'select'),
  'se escribe solo por sus funciones, y anon no lee');

rollback;
