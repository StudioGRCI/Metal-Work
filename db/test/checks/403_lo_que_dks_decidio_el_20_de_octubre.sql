-- Lo que DKS decidió el 2026-10-20, probado con los puestos reales y
-- `set local role authenticated`:
--
--   · los reportes de trabajos sin OT los aprueban Administración y Gerencia
--     (migración 20261020160000);
--   · la cotización rechazada, o la que ya pasó por Gerencia, no se quita: se
--     corrige y queda como evidencia; la recién subida sí (20261020161000);
--   · la salida de materia prima y la de EPP nacen con su número de la casa,
--     sin huecos, y la de consumibles no lleva (20261020162000);
--   · el costo por hora y el DNI viven fuera de `usuarios`: los lee Recursos
--     Humanos y quien administra el personal, nadie más, ni en la auditoría
--     (20261020163000), y los cambia solo Recursos Humanos (20261020165000).
--
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA403', 'Taller prueba 403') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA403' \gset
select test.crear_usuario('Gil', 'Gerente', 'gerencia403@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Ofe', 'Oficina', 'administracion403@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Ana', 'Admin', 'admin403@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Rut', 'Humanos', 'rrhh403@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Pio', 'Portero', 'porteria403@demo.pe', 'PORTERO', :'sede_id') as portero_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas403@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olo', 'Operario', 'operario403@demo.pe', 'OPERARIO', :'sede_id', true, 12) as operario_id \gset
select set_config('prueba.operario', :'operario_id', true);

-- =========================================== trabajos sin OT: quién aprueba
select test.afirmar(exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                             where r.codigo = 'ADMINISTRACION' and rp.permiso_codigo = 'produccion.aprobar_reportes'),
  'Administración tiene el permiso de aprobar los reportes del taller');
select test.afirmar(exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                             where r.codigo = 'GERENTE' and rp.permiso_codigo = 'produccion.aprobar_sin_orden'),
  'Gerencia tiene el permiso de aprobar los reportes de los trabajos sin orden');
-- Y solo ese: las hojas de las OT, sus observaciones y sus avisos van con el
-- permiso ancho, que DKS no le dio.
select test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                 where r.codigo = 'GERENTE' and rp.permiso_codigo = 'produccion.aprobar_reportes'),
  'Gerencia no aprueba los reportes de las OT');

insert into public.flota_unidades (placa, trabajo, registrado_por) values ('QA4-031', 'Cambio de piso', :'admin_id');
insert into public.flota_avances (flota_id, area_id, descripcion, registrado_por)
select f.id, (select id from public.areas where codigo = 'ACB'), 'Piso nuevo', :'admin_id'
  from public.flota_unidades f where f.placa = 'QA4-031';
select id as avance_id from public.flota_avances where descripcion = 'Piso nuevo' \gset
select set_config('prueba.avance', :'avance_id', true);

-- Administración no tiene `produccion.ver`: antes el UPDATE le daba 0 filas.
select test.como_usuario(:'oficina_id');
set local role authenticated;
do $$
declare v_n integer;
begin
  perform test.afirmar(not public.tiene_permiso('produccion.ver'), 'Administración no lee toda la producción');
  perform test.afirmar((select count(*) from public.flota_avances where id = current_setting('prueba.avance')::uuid) = 1,
    'Administración ve el reporte del trabajo sin OT que tiene que aprobar');
  update public.flota_avances set revision = 'APROBADO' where id = current_setting('prueba.avance')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Administración aprueba el reporte de un trabajo sin OT');
end $$;
reset role;

select test.como_usuario(:'gerente_id');
set local role authenticated;
do $$
declare v_n integer;
begin
  update public.flota_avances set revision = 'OBSERVADO', observacion = 'Falta la foto del piso'
   where id = current_setting('prueba.avance')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Gerencia también aprueba u observa el reporte de un trabajo sin OT');
end $$;
reset role;

select test.como_usuario(:'portero_id');
set local role authenticated;
select test.afirmar((select count(*) from public.flota_avances where id = :'avance_id') = 0,
  'Portería no ve los reportes del taller');
reset role;

-- Lo aprobado queda firme también para quien aprueba, y Gerencia, que solo
-- aprueba los trabajos sin orden, no borra ni el pendiente ajeno.
insert into public.flota_avances (flota_id, area_id, descripcion, registrado_por)
select f.id, (select id from public.areas where codigo = 'ACB'), 'Pintura del piso', :'admin_id'
  from public.flota_unidades f where f.placa = 'QA4-031';
select set_config('prueba.pendiente',
  (select id::text from public.flota_avances where descripcion = 'Pintura del piso'), true);

select test.como_usuario(:'oficina_id');
set local role authenticated;
update public.flota_avances set revision = 'APROBADO', observacion = null where id = :'avance_id';
reset role;

select test.como_usuario(:'gerente_id');
set local role authenticated;
do $$
declare v_n integer;
begin
  perform test.afirmar((select revision::text from public.flota_avances where id = current_setting('prueba.avance')::uuid) = 'APROBADO',
    'el reporte quedó aprobado por Administración');
  delete from public.flota_avances where id = current_setting('prueba.avance')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'Gerencia no borra un reporte que ya está aprobado');
  delete from public.flota_avances where id = current_setting('prueba.pendiente')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'Gerencia tampoco borra uno pendiente ajeno: aprueba, no quita');
  perform test.debe_fallar(format('update public.flota_avances set descripcion = %L where id = %L',
                                  'Texto de Gerencia', current_setting('prueba.avance')),
    'Gerencia no reescribe un reporte ya aprobado', 'queda como está');
end $$;
reset role;

-- ================================= la cotización rechazada queda como evidencia
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20607761403', 'TRANSPORTES PRUEBA 403 S.A.C.') on conflict do nothing;
insert into public.tipos_carroceria (codigo, nombre, orden_secuencia) values ('QA_403', 'Tolva QA 403', 99);

-- Puestas en su estado sin el circuito de revisión que las lleva ahí.
set local session_replication_role = replica;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, version, registrado_por, observacion)
select n.id, n.numero, c.id, t.id, n.numero || '.pdf', 'cot/' || n.id || '/' || n.numero || '.pdf',
       n.estado::public.estado_cotizacion_pdf, n.version, :'ventas_id', 'El precio no cuadra'
  from (values (gen_random_uuid(), 'COT-403-R', 'RECHAZADA', 1),
               (gen_random_uuid(), 'COT-403-C', 'POR_REVISAR', 2),
               (gen_random_uuid(), 'COT-403-N', 'POR_REVISAR', 1)) n(id, numero, estado, version)
 cross join (select id from public.clientes where numero_documento = '20607761403') c
 cross join (select id from public.tipos_carroceria where codigo = 'QA_403') t;
set local session_replication_role = origin;

select test.debe_fallar($$ delete from public.cotizaciones_pdf where numero = 'COT-403-R' $$,
  'ni el dueño de las tablas quita una cotización rechazada', 'queda como evidencia');
select test.debe_fallar($$ delete from public.cotizaciones_pdf where numero = 'COT-403-C' $$,
  'ni la corregida, que ya pasó por Gerencia', 'su historia queda como evidencia');

select test.como_usuario(:'ventas_id');
set local role authenticated;
do $$
declare v_n integer;
begin
  delete from public.cotizaciones_pdf where numero = 'COT-403-R';
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0 and exists (select 1 from public.cotizaciones_pdf where numero = 'COT-403-R'),
    'Ventas no quita su cotización rechazada: la política ya no la ofrece');
  delete from public.cotizaciones_pdf where numero = 'COT-403-N';
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Ventas sí quita la que acaba de subir y nadie revisó');
end $$;
reset role;

-- La rechazada no se esconde en dos pasos: devolverla a «por revisar» sin su
-- corrección para después quitarla. Ni Gerencia, que es quien revisa.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.debe_fallar($$ update public.cotizaciones_pdf set estado = 'POR_REVISAR' where numero = 'COT-403-R' $$,
  'Gerencia no devuelve una rechazada a «por revisar» sin su corrección', 'solo con su corrección');
reset role;
select test.afirmar((select estado::text from public.cotizaciones_pdf where numero = 'COT-403-R') = 'RECHAZADA',
  'la rechazada sigue rechazada');

-- ====================================== la salida de almacén tiene número
select m.id as mp_id from public.materiales m join public.categorias_material c on c.id = m.categoria_id
 where c.almacen = 'MATERIA_PRIMA' and m.activo order by m.codigo limit 1 \gset
select m.id as cons_id from public.materiales m join public.categorias_material c on c.id = m.categoria_id
 where c.almacen = 'CONSUMIBLES' and m.activo order by m.codigo limit 1 \gset
select correlativo_actual as sa_antes from public.series_documentarias where tipo = 'SALIDA_ALMACEN' and serie = '001' \gset

insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', 'SALDO_INICIAL', :'mp_id', 10, 'Saldo 403', :'admin_id'),
       (gen_random_uuid(), 'INGRESO', 'SALDO_INICIAL', :'cons_id', 10, 'Saldo 403', :'admin_id');
insert into public.movimientos_materiales
  (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por, numero_salida)
values (gen_random_uuid(), 'SALIDA', 'SALIDA_GENERAL', :'mp_id', 2, 'Vale 403-1', 'Julio Ramírez', 'QA_403_1', :'admin_id', 'SA-9999-2026'),
       (gen_random_uuid(), 'SALIDA', 'SALIDA_GENERAL', :'cons_id', 1, 'Vale 403-2', 'Julio Ramírez', 'QA_403_1', :'admin_id', null),
       (gen_random_uuid(), 'SALIDA', 'SALIDA_GENERAL', :'mp_id', 1, 'Vale 403-3', 'Julio Ramírez', 'QA_403_1', :'admin_id', null);

select test.afirmar(
  (select numero_salida from public.movimientos_materiales where documento_referencia = 'Vale 403-1')
    = 'SA-' || lpad((:'sa_antes'::int + 1)::text, 4, '0') || '-' || to_char(now(), 'YYYY'),
  'la salida de materia prima nace con su número de la serie, y no con el que trae escrito');
select test.afirmar(
  (select numero_salida from public.movimientos_materiales where documento_referencia = 'Vale 403-3')
    = 'SA-' || lpad((:'sa_antes'::int + 2)::text, 4, '0') || '-' || to_char(now(), 'YYYY'),
  'la siguiente lleva el siguiente número: la consumible de en medio no gastó ninguno');
select test.afirmar(
  (select numero_salida from public.movimientos_materiales where documento_referencia = 'Vale 403-2') is null,
  'la salida de consumibles no lleva número');

-- ========================================= el costo por hora y el DNI, aparte
select test.afirmar(
  (select costo_hora = 0 and documento is null from public.usuarios where id = :'operario_id')
  and (select costo_hora = 12 from public.usuario_datos_reservados where usuario_id = :'operario_id'),
  'al dar de alta, el costo por hora pasa a la tabla reservada y no queda en usuarios');

-- El alta real, con la función de la pantalla de Personal. Desde la
-- 20261020165000 el administrador da de alta la cuenta sin el DNI ni el costo:
-- los pone Recursos Humanos.
select test.como_usuario(:'admin_id');
set local role authenticated;
select test.debe_fallar($$
  select public.crear_personal('Leo', 'Soldador', 'soldadura403b@demo.pe', 'Clave-403-larga',
    (select id from public.roles where codigo = 'OPERARIO'), (select id from public.sedes where codigo = 'QA403'),
    null, 'Soldador', '41255679', null, true, 15)
$$, 'el administrador no pone el DNI ni el costo al dar de alta', 'No tienes permiso para poner el DNI ni el costo por hora');
select public.crear_personal('Lia', 'Soldadora', 'soldadura403@demo.pe', 'Clave-403-larga',
  (select id from public.roles where codigo = 'OPERARIO'), :'sede_id', null, 'Soldadora', null, null, true, 0) as lia_id \gset
reset role;
select set_config('prueba.lia', :'lia_id', true);

select test.como_usuario(:'rrhh_id');
set local role authenticated;
do $$
declare v_n integer;
begin
  insert into public.usuario_datos_reservados (usuario_id, documento, costo_hora)
  values (current_setting('prueba.lia')::uuid, '41255678', 15);
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Recursos Humanos pone el DNI y el costo de la cuenta');
end $$;
reset role;
select test.afirmar(
  (select costo_hora = 0 and documento is null from public.usuarios where id = :'lia_id')
  and (select costo_hora = 15 and documento = '41255678' from public.usuario_datos_reservados where usuario_id = :'lia_id'),
  'quedan en la tabla reservada, no en usuarios');

-- El camino viejo, escribir en usuarios, ya no los cambia: el administrador
-- pasa la protección de usuarios y lo frena la de los datos reservados.
select test.como_usuario(:'admin_id');
set local role authenticated;
select test.debe_fallar($$
  update public.usuarios set costo_hora = 18 where id = current_setting('prueba.lia')::uuid
$$, 'el administrador no cambia el costo por hora por usuarios', 'No tienes permiso para cambiar el DNI ni el costo por hora');
do $$
declare v_n integer;
begin
  update public.usuario_datos_reservados set costo_hora = 18 where usuario_id = current_setting('prueba.lia')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'ni en la tabla reservada');
  perform test.afirmar((select costo_hora = 15 from public.usuario_datos_reservados where usuario_id = current_setting('prueba.lia')::uuid),
    'pero el administrador sí los ve');
end $$;
update public.usuarios set telefono = '999111223' where id = :'lia_id';
reset role;
select test.afirmar(
  (select costo_hora = 15 and documento = '41255678' from public.usuario_datos_reservados where usuario_id = :'lia_id'),
  'editar otra cosa de la cuenta no borra el DNI ni el costo');

select test.como_usuario(:'operario_id');
set local role authenticated;
select test.debe_fallar($$
  update public.usuarios set costo_hora = 999 where id = current_setting('prueba.operario')::uuid
$$, 'nadie se cambia su propio costo por hora', 'Solo un administrador');
select test.afirmar((select count(*) from public.usuario_datos_reservados) = 0,
  'el operario no lee ni su propio costo por hora');
reset role;

select test.como_usuario(:'rrhh_id');
set local role authenticated;
select test.afirmar((select count(*) from public.usuario_datos_reservados where usuario_id in (:'lia_id', :'operario_id')) = 2,
  'Recursos Humanos lee el costo y el DNI');
do $$
declare v_n integer;
begin
  update public.usuario_datos_reservados set costo_hora = 16 where usuario_id = current_setting('prueba.lia')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'Recursos Humanos los cambia');
end $$;
reset role;

-- La auditoría de la tabla reservada pide lo mismo que la tabla.
select test.afirmar(exists (select 1 from public.audit_log where tabla = 'usuario_datos_reservados'),
  'los cambios del costo y del DNI quedan en la auditoría');
-- La auditoría de `usuarios` de antes de la mudanza: una fila con costo y DNI,
-- otra sin ellos (un cambio de cargo). Gerencia ve la segunda, no la primera.
insert into public.audit_log (tabla, registro_id, accion, datos_antes, datos_despues, campos_modificados)
values ('usuarios', :'lia_id', 'UPDATE', '{"documento": null, "costo_hora": 0, "cargo": "x"}',
        '{"documento": "40404040", "costo_hora": 12.5, "cargo": "x"}', array['documento', 'costo_hora']),
       ('usuarios', :'lia_id', 'UPDATE', '{"documento": null, "costo_hora": 0, "cargo": "Soldadora"}',
        '{"documento": null, "costo_hora": 0, "cargo": "Soldadora líder"}', array['cargo']);

select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar(public.tiene_permiso('auditoria.ver'), 'Gerencia consulta la auditoría');
select test.afirmar((select count(*) from public.audit_log where tabla = 'usuarios' and registro_id = :'lia_id'
                       and datos_despues ->> 'documento' = '40404040') = 0,
  'Gerencia no ve la auditoría vieja de usuarios que lleva el DNI y el costo');
select test.afirmar((select count(*) from public.audit_log where tabla = 'usuarios' and registro_id = :'lia_id'
                       and datos_despues ->> 'cargo' = 'Soldadora líder') = 1,
  'pero sí la que no los lleva, como un cambio de cargo');
select test.afirmar((select count(*) from public.usuario_datos_reservados) = 0,
  'Gerencia no lee el costo por hora ni el DNI');
select test.afirmar((select count(*) from public.audit_log where tabla = 'usuario_datos_reservados') = 0,
  'ni su copia en la auditoría');
select test.afirmar(
  (select count(*) from public.usuarios where id = :'lia_id' and costo_hora = 0 and documento is null) = 1,
  'y en usuarios, que todos leen, ya no están');
reset role;

select test.como_usuario(:'portero_id');
set local role authenticated;
select test.afirmar((select count(*) from public.usuario_datos_reservados) = 0, 'Portería no los lee');
-- La lista de OT y el puesto siguen leyendo la fila entera de usuarios.
select test.afirmar((select count(*) from public.usuarios) > 0 and public.puesto(u) is not null, 'la fila de usuarios se sigue leyendo entera')
  from public.usuarios u where u.id = :'portero_id';
reset role;

rollback;
