-- El vehículo entra con su código interno y su OT, y sale con el 100 % del
-- avance y la aprobación de Tesorería (migración 20261020166000). Cada paso con
-- el puesto que lo da —Requerimientos registra, el supervisor reporta el
-- avance, Tesorería revisa— y `set local role authenticated`. El armazón (el
-- cliente, las unidades y sus OT) lo pone el administrador.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA405', 'Taller prueba 405') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA405' \gset
select test.crear_usuario('Ada', 'Admin', 'admin405@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req405@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria405@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia405@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas405@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh405@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
-- Una sola Supervisión activa por área: si la base ya tiene la de Maestranza, se usa esa.
select coalesce(
  (select u.id from public.usuarios u join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
     join public.areas a on a.id = u.area_id and a.codigo = 'MTZ' where u.activo limit 1),
  test.crear_usuario('Mario', 'Maestranza', 'sup.mtz405@demo.pe', 'SUPERVISOR', :'sede_id')) as sup_id \gset

-- Armazón: el cliente y tres unidades con código —una con su OT, otra sin OT y
-- otra con la OT anulada—.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup_id';
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000405', 'QA CLIENTE 405') returning id as cliente_id \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo, marca, modelo, tipo_carroceria_id, numero_chasis)
values (:'cliente_id', 'CHK405_A_26/45', 'CAMION', 'Volvo', 'FMX', :'carroceria_id', '9BM405000AA000001')
returning id as unidad_a \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK405_B_26/46', 'SEMIRREMOLQUE');
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK405_C_26/47', 'CAMION') returning id as unidad_c \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8405-2026', :'cliente_id', :'unidad_a', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Tolva de prueba 405', 'APROBADA')
returning id as orden_a \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8406-2026', :'cliente_id', :'unidad_c', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Anulada 405', 'APROBADA');
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Prueba 405: orden repetida' where numero = '8406-2026';
-- Una cuarta unidad sin cliente: el cliente lo pone su OT.
insert into public.unidades (codigo_interno, tipo_vehiculo)
values ('CHK405_D_26/48', 'CAMION') returning id as unidad_d \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8407-2026', :'cliente_id', :'unidad_d', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Sin cliente en la unidad 405', 'APROBADA');

select set_config('prueba.req', :'req_id', true);
select set_config('prueba.tes', :'tes_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.unidad_a', :'unidad_a', true);
select set_config('prueba.orden_a', :'orden_a', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
do $$
declare v text;
begin
  foreach v in array array['v1', 'v2', 'v3', 'v4', 'rev1', 'rev2', 'pdf'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.todo_ingreso', (select jsonb_object_agg(codigo, jsonb_build_object('ingreso', 'CONFORME'))::text
                                               from public.control_vehicular_items), true);
  perform set_config('prueba.todo_salida', (select jsonb_object_agg(codigo, jsonb_build_object('salida', 'CONFORME'))::text
                                              from public.control_vehicular_items), true);
end $$;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
-- La foto ya subida a Storage por Requerimientos, en la carpeta del ingreso.
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := current_setting('prueba.req') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
                       || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;
create or replace function pg_temp.ingreso_sql(p_registro text, p_placa text, p_codigo text, p_motivo text) returns text language sql as $$
  select format($q$select public.registrar_ingreso_vehiculo(%L, %L, null, %L, '', '', %L, null, null, pg_temp.foto(%L, 'ingreso'))$q$,
                current_setting('prueba.' || p_registro), p_placa, p_codigo, p_motivo, p_registro);
$$;
create or replace function pg_temp.salida_sql(p_registro text) returns text language sql as $$
  select format($q$select public.registrar_salida_vehiculo(%L, null, 'Sale', pg_temp.foto(%L, 'salida'))$q$,
                current_setting('prueba.' || p_registro), p_registro);
$$;
create or replace function pg_temp.estado(p_registro text) returns jsonb language sql as $$
  select to_jsonb(e) from public.vehiculos_estado_de_salida(array[current_setting('prueba.' || p_registro)::uuid]) e;
$$;

-- ===================================================== 1. Qué puede entrar
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(
  (select orden_numero = '8405-2026' and cliente = 'QA CLIENTE 405' and unidad like '%Volvo FMX%'
          and chasis = '9BM405000AA000001' and not en_planta
     from public.vehiculos_codigos_para_ingreso() where codigo_interno = 'CHK405_A_26/45'),
  'Requerimientos ve el código con su OT, su cliente y el vehículo');
select test.afirmar(
  not exists (select 1 from public.vehiculos_codigos_para_ingreso() where codigo_interno in ('CHK405_B_26/46', 'CHK405_C_26/47')),
  'el código sin OT y el de la OT anulada no se ofrecen');

select test.debe_fallar(pg_temp.ingreso_sql('v1', 'ABC405', null, 'FABRICACION'),
  'para fabricación no entra un vehículo sin código interno', 'Elige el código interno');
select test.debe_fallar(pg_temp.ingreso_sql('v1', null, 'NO_EXISTE_405', 'MANTENIMIENTO'),
  'ni con un código que no es de ninguna unidad', 'no es de ninguna unidad');
select test.debe_fallar(pg_temp.ingreso_sql('v1', null, 'CHK405_B_26/46', 'GARANTIA'),
  'ni con un código sin OT', 'no tiene una OT vigente');
select test.debe_fallar(pg_temp.ingreso_sql('v1', null, 'CHK405_C_26/47', 'ARENADO'),
  'ni con un código cuya OT está anulada', 'no tiene una OT vigente');

-- Entra con el código escrito en minúsculas: carga el cliente, el vehículo y el chasis.
select public.registrar_ingreso_vehiculo(pg_temp.id('v1'), 'abc 405', null, ' chk405_a_26/45 ', '', '', 'FABRICACION', null,
  'Llega para la tolva', pg_temp.foto('v1', 'ingreso'));
reset role;
select test.afirmar(
  (select codigo_interno = 'CHK405_A_26/45' and unidad_id = :'unidad_a'::uuid and orden_id = :'orden_a'::uuid
          and empresa = 'QA CLIENTE 405' and unidad like '%Volvo FMX%' and placa = 'ABC405' and chasis = '9BM405000AA000001'
     from public.registro_vehiculos where id = pg_temp.id('v1')),
  'el ingreso queda atado a la unidad y a su OT, con el cliente y el vehículo de la unidad');
select test.debe_fallar(format($q$update public.registro_vehiculos set orden_id = null where id = %L$q$, pg_temp.txt('v1')),
  'el vínculo con la OT no se cambia después', 'ya quedó atado');

select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar((select en_planta from public.vehiculos_codigos_para_ingreso() where codigo_interno = 'CHK405_A_26/45'),
  'el código que ya entró figura en la planta');
select test.debe_fallar(pg_temp.ingreso_sql('v2', null, 'CHK405_A_26/45', 'MANTENIMIENTO'),
  'el mismo código no entra dos veces sin haber salido', 'ya está en la planta');
-- La cochera no es trabajo: entra con la placa, como antes.
select public.registrar_ingreso_vehiculo(pg_temp.id('v3'), 'XYZ405', null, null, 'Camioneta del cliente', 'QA CLIENTE 405',
  'COCHERA', null, null, pg_temp.foto('v3', 'ingreso'));
-- Pero un código con OT no entra como cochera ni «otro»: se saltaría la regla de la salida.
select test.debe_fallar(pg_temp.ingreso_sql('v2', null, 'CHK405_D_26/48', 'COCHERA'),
  'un código con OT no entra como cochera', 'es de un vehículo con OT');
select test.debe_fallar(pg_temp.ingreso_sql('v2', null, 'chk405-d 26/48', 'OTRO'),
  'ni como «otro», aunque se escriba distinto', 'es de un vehículo con OT');
-- La unidad sin cliente entra con el de su OT, sin que nadie lo escriba.
select public.registrar_ingreso_vehiculo(pg_temp.id('v4'), null, null, 'CHK405_D_26/48', '', '', 'GARANTIA', null, null,
  pg_temp.foto('v4', 'ingreso'));
select test.afirmar((select empresa = 'QA CLIENTE 405' from public.registro_vehiculos where id = pg_temp.id('v4')),
  'la unidad sin cliente entra con el cliente de su OT');
-- Dos ingresos de la misma unidad en planta no caben ni por carrera: lo cuida un índice único.
reset role;
select test.debe_fallar(format($q$insert into public.registro_vehiculos (id, placa, codigo_interno, unidad, empresa, motivo, ingreso_por, ingreso_en, unidad_id)
  select gen_random_uuid(), null, codigo_interno, unidad, empresa, motivo, ingreso_por, ingreso_en, unidad_id from public.registro_vehiculos where id = %L$q$,
  pg_temp.txt('v4')), 'la misma unidad no queda dos veces en la planta', 'uq_vehiculo_unidad_en_planta');
select test.como_usuario(:'req_id');
set local role authenticated;

-- ===================================================== 2. La salida espera el 100 %
select test.afirmar((pg_temp.estado('v1') ->> 'exige')::boolean and (pg_temp.estado('v1') ->> 'avance')::integer = 0,
  'el ingreso de trabajo exige el avance, que va en 0 %');
select test.afirmar(not (pg_temp.estado('v3') ->> 'exige')::boolean and pg_temp.estado('v3') ->> 'falta_para_salir' is null,
  'el de la cochera no espera nada');
select test.debe_fallar(pg_temp.salida_sql('v1'), 'sin el 100 % del avance no sale', 'va en 0 %');
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'Revisar el pago')$q$, pg_temp.txt('rev1'), pg_temp.txt('v1')),
  'ni se le pide la revisión a Tesorería', 'Tesorería revisa la salida de un vehículo terminado');
select public.registrar_salida_vehiculo(pg_temp.id('v3'), null, null, pg_temp.foto('v3', 'salida'));
select test.afirmar((select salida_en is not null from public.registro_vehiculos where id = pg_temp.id('v3')),
  'el de la cochera sale sin esperar avance ni Tesorería');
-- La ficha, cerrada y firmada, como pide el pedido a Tesorería.
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'CERRAR_INGRESO', jsonb_build_object(
  'marca', 'Volvo', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'fecha_ingreso', current_date,
  'combustible_ingreso', '1/2', 'items', pg_temp.txt('todo_ingreso')::jsonb));
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'CERRAR_SALIDA', jsonb_build_object(
  'conductor_salida', 'Ana Prueba', 'dni_salida', '11111111', 'fecha_salida', current_date, 'combustible_salida', '1/4',
  'items', pg_temp.txt('todo_salida')::jsonb));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('fichas-vehiculos', pg_temp.txt('v1') || '/' || pg_temp.txt('pdf') || '.pdf', pg_temp.txt('req'),
        '{"mimetype": "application/pdf", "size": 350000}');
select public.adjuntar_ficha_vehiculo_firmada(pg_temp.id('v1'), pg_temp.txt('v1') || '/' || pg_temp.txt('pdf') || '.pdf', 'ficha.pdf');
reset role;

-- RR. HH. registra a Juan, que trabaja en la tolva.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(gen_random_uuid(), 'Juan', 'Habilitador 405', '70000405', 'Habilitador',
  null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-05', null) as juan_id \gset
reset role;
select set_config('prueba.juan', :'juan_id', true);
create or replace function pg_temp.gente() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('trabajador_id', current_setting('prueba.juan'), 'horas', 4));
$$;

-- El supervisor reporta la tolva al 60 %, y al día siguiente al 100 %.
select test.como_usuario(:'sup_id');
set local role authenticated;
select public.registrar_reporte_diario(gen_random_uuid(), pg_temp.txt('hoy')::date - 2, 'chk405_a_26/45',
  'Tolva de la unidad', 'Armado de la tolva.',
  jsonb_build_array(jsonb_build_object('descripcion', 'Armado de la tolva', 'avance', 60, 'personal', pg_temp.gente())), null, null);
reset role;

select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar((pg_temp.estado('v1') ->> 'avance')::integer = 60, 'Requerimientos ve que va en 60 %');
select test.debe_fallar(pg_temp.salida_sql('v1'), 'con 60 % todavía no sale', 'va en 60 %');
reset role;
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select avance from public.codigos_internos_avance('CHK405_A_26/45')) = 60,
  'el mismo 60 % que ve Gerencia en el código');
reset role;

select test.como_usuario(:'sup_id');
set local role authenticated;
select set_config('prueba.act', (select id::text from public.codigo_actividades
                                   where codigo_interno = 'CHK405_A_26/45' and lower(descripcion) = 'armado de la tolva'), true);
select public.registrar_reporte_diario(gen_random_uuid(), pg_temp.txt('hoy')::date - 1, 'CHK405_A_26/45',
  'Tolva de la unidad', 'Tolva terminada.',
  jsonb_build_array(jsonb_build_object('actividad_id', pg_temp.txt('act'), 'avance', 100, 'personal', pg_temp.gente())), null, null);
reset role;

-- ===================================================== 3. Y la aprobación de Tesorería
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar((pg_temp.estado('v1') ->> 'avance')::integer = 100 and pg_temp.estado('v1') ->> 'falta_para_pedir' is null,
  'con el 100 % ya se le puede pedir la revisión a Tesorería');
select test.debe_fallar(pg_temp.salida_sql('v1'), 'pero sin Tesorería no sale', 'pídele la revisión');
select public.solicitar_revision_salida(pg_temp.id('rev1'), pg_temp.id('v1'), 'Revisar si el cliente pagó');
select test.debe_fallar(pg_temp.salida_sql('v1'), 'con el pedido esperando, tampoco', 'esperando su respuesta');
reset role;

select test.como_usuario(:'tes_id');
set local role authenticated;
select public.responder_revision_salida(pg_temp.id('rev1'), 'OBSERVADA', 'Falta el segundo adelanto');
reset role;
-- En la vida real cada pedido va en su propia transacción; aquí todo pasa en
-- la misma y `now()` no avanza: el primero se corre una hora atrás para que
-- «el último» sea el último.
alter table public.registro_vehiculo_revisiones disable trigger trg_registro_vehiculo_revision_guardia;
update public.registro_vehiculo_revisiones set creado_en = creado_en - interval '1 hour', atendido_en = atendido_en - interval '1 hour'
 where id = pg_temp.id('rev1');
alter table public.registro_vehiculo_revisiones enable trigger trg_registro_vehiculo_revision_guardia;
select test.como_usuario(:'req_id');
set local role authenticated;
select test.debe_fallar(pg_temp.salida_sql('v1'), 'si Tesorería la observa, no sale', 'Tesorería observó');
select public.solicitar_revision_salida(pg_temp.id('rev2'), pg_temp.id('v1'), 'Ya pagó el segundo adelanto');
reset role;
select test.como_usuario(:'tes_id');
set local role authenticated;
select public.responder_revision_salida(pg_temp.id('rev2'), 'ATENDIDA', 'Está al día');
reset role;

select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(pg_temp.estado('v1') ->> 'falta_para_salir' is null and pg_temp.estado('v1') ->> 'tesoreria' = 'ATENDIDA',
  'con el 100 % y Tesorería, la salida se desbloquea');
select public.registrar_salida_vehiculo(pg_temp.id('v1'), null, 'Sale terminada', pg_temp.foto('v1', 'salida'));
select test.afirmar((select salida_en is not null from public.registro_vehiculos where id = pg_temp.id('v1')),
  'y el vehículo sale');
select test.afirmar(not (select en_planta from public.vehiculos_codigos_para_ingreso() where codigo_interno = 'CHK405_A_26/45'),
  'el código queda libre para volver a entrar');
reset role;

-- ===================================================== 4. Quién no
select test.como_usuario(:'ventas_id');
set local role authenticated;
select test.debe_fallar($q$select * from public.vehiculos_codigos_para_ingreso()$q$,
  'Ventas no lista los códigos para el ingreso', 'vehiculos.registrar');
select test.debe_fallar(format($q$select * from public.vehiculos_estado_de_salida(array[%L::uuid])$q$, pg_temp.txt('v1')),
  'ni el estado de la salida', 'No tiene permiso');
select test.debe_fallar($q$select public.vehiculo_avance_del_codigo('CHK405_A_26/45')$q$,
  'ni el avance por la función interna', 'permission denied');
select test.debe_fallar($q$select * from public.codigo_interno_etapas_calculado('CHK405_A_26/45')$q$,
  'ni las etapas sin el permiso de verlas', 'permission denied');
select test.debe_fallar($q$select * from public.codigo_interno_etapas('CHK405_A_26/45')$q$,
  'y la pestaña de etapas sigue pidiendo su permiso', 'No tienes permiso');
reset role;

rollback;
