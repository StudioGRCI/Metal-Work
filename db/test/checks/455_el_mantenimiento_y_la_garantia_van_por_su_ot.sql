-- El mantenimiento y la garantía van por el número de su OT, no por código
-- interno (migración 20261120500000, observaciones del área de Requerimientos
-- del 2026-11-20): su código es «OT 9455-2026», sale en la lista de códigos de
-- los formularios y en la del reporte diario, el RQ se emite con él, y su
-- vehículo entra eligiendo la OT y sale cuando Administración da por terminado
-- el trabajo, con el visto de Tesorería. Cada paso con su puesto —Requerimientos
-- registra, Administración termina, Supervisión reporta— y `set local role
-- authenticated`. El armazón lo pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA455', 'Taller prueba 455') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA455' \gset
select test.crear_usuario('Ada', 'Admin', 'admin455@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req455@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm455@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Sam', 'Supervisión', 'sup455@demo.pe', 'SUPERVISOR', :'sede_id') as sup_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas455@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset

-- Armazón: un cliente, una unidad con placa y su OT de mantenimiento; una OT de
-- mantenimiento sin unidad; una de garantía; una de mantenimiento anulada; y
-- una unidad con su OT de fabricación.
select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000455', 'QA CLIENTE 455') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.sede', :'sede_id', true);
create or replace function pg_temp.orden(p_numero text, p_unidad uuid, p_tipo text) returns uuid language sql as $$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
  values (p_numero, current_setting('prueba.cliente')::uuid, p_unidad, current_setting('prueba.sede')::uuid,
          p_tipo::public.tipo_trabajo_ot, 'NORMAL', 'Prueba 455 ' || p_tipo, 'APROBADA') returning id;
$$;
insert into public.unidades (cliente_id, tipo_vehiculo, placa, marca, modelo, numero_chasis)
values (:'cliente_id', 'CAMION', 'QAA-455', 'Volvo', 'FH 455', '9BM455000AA000001') returning id as unidad_u \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK455_F_26/60', 'CAMION') returning id as unidad_f \gset
select pg_temp.orden('8455-2026', :'unidad_f', 'FABRICACION') as fabricacion \gset
update public.ordenes_trabajo set creado_en = now() - interval '30 days' where id = :'fabricacion';
select pg_temp.orden('9455-2026', :'unidad_u', 'MANTENIMIENTO') as mant_u \gset
select pg_temp.orden('9456-2026', null, 'MANTENIMIENTO') as mant_sin \gset
select pg_temp.orden('9457-2026', :'unidad_f', 'GARANTIA') as garantia \gset
select pg_temp.orden('9458-2026', null, 'MANTENIMIENTO') as mant_anulada \gset
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se registró dos veces (prueba 455)' where id = :'mant_anulada';

select set_config('prueba.req', :'req_id', true);
do $$
declare v text;
begin
  foreach v in array array['u', 'u2', 's', 's2', 'g', 'x', 'c', 'rq'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;
select set_config('prueba.mant_u', :'mant_u', true);
select set_config('prueba.mant_sin', :'mant_sin', true);
select set_config('prueba.garantia', :'garantia', true);
select set_config('prueba.mant_anulada', :'mant_anulada', true);
select set_config('prueba.fabricacion', :'fabricacion', true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := current_setting('prueba.req') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
                       || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;
-- El ingreso con OT: registro, placa, vehículo, motivo y la OT (o null).
create or replace function pg_temp.ingreso_sql(p_registro text, p_placa text, p_unidad text, p_motivo text, p_orden text)
returns text language sql as $$
  select format($q$select public.registrar_ingreso_vehiculo(%L, %L, null, null, %L, '', %L, null, null, pg_temp.foto(%L, 'ingreso'), %L)$q$,
                current_setting('prueba.' || p_registro), p_placa, p_unidad, p_motivo, p_registro,
                case when p_orden is null then null else current_setting('prueba.' || p_orden) end);
$$;
create or replace function pg_temp.estado(p_registro text) returns jsonb language sql as $$
  select to_jsonb(e) from public.vehiculos_estado_de_salida(array[current_setting('prueba.' || p_registro)::uuid]) e;
$$;

-- ===================================================== 1. El código de la OT
select test.afirmar(public.codigo_de_la_ot(' 9455-2026 ') = 'OT 9455-2026' and public.codigo_de_la_ot('') is null,
  'el código de la OT es «OT » y su número');
select test.afirmar(public.es_codigo_de_ot('ot  9455-2026') and not public.es_codigo_de_ot('CHK455_F_26/60')
                    and not public.es_codigo_de_ot('PLANTA') and not public.es_codigo_de_ot(null),
  'y se reconoce aunque se escriba en minúsculas o con espacios de más');

-- ===================================================== 2. La lista de los formularios
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(
  (select unidad = 'Mantenimiento · QAA-455 · Volvo FH 455' and registrada and not cerrado
     from public.codigos_internos_para_elegir() where codigo = 'OT 9455-2026'),
  'Requerimientos ve la OT de mantenimiento con su placa y su vehículo');
select test.afirmar(
  (select unidad = 'Mantenimiento · QA CLIENTE 455' from public.codigos_internos_para_elegir() where codigo = 'OT 9456-2026'),
  'la que no tiene unidad, con su cliente');
select test.afirmar(
  (select unidad like 'Garantía%' from public.codigos_internos_para_elegir() where codigo = 'OT 9457-2026'),
  'y la de garantía, dicha como garantía');
select test.afirmar(not exists (select 1 from public.codigos_internos_para_elegir() where codigo in ('OT 9458-2026', 'OT 8455-2026')),
  'la anulada no se ofrece, ni la de fabricación, que va por el código de su unidad');
-- El RQ se emite con el número de la OT, como con cualquier código.
select public.emitir_requerimiento(pg_temp.id('rq'), (select id from public.areas where codigo = 'MTZ'), ' ot 9455-2026 ',
  'Cambio de mangueras del mantenimiento', null,
  jsonb_build_array(jsonb_build_object('descripcion', 'Manguera hidráulica 1/2 (455)', 'cantidad', 2,
    'unidad_medida_id', (select id from public.unidades_medida where codigo = 'UND'),
    'categoria_id', (select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1))));
reset role;
select test.afirmar((select normalizar_codigo_interno(codigo_interno) = 'OT 9455-2026' from public.requerimientos where id = pg_temp.id('rq')),
  'el RQ queda con el código de la OT de mantenimiento');

-- Quien reporta el día también la ve, para cargarle las horas.
select test.como_usuario(:'sup_id');
set local role authenticated;
select test.afirmar(exists (select 1 from public.rrhh_codigos_internos() where codigo = 'OT 9456-2026')
                    and not exists (select 1 from public.rrhh_codigos_internos() where codigo = 'OT 9458-2026'),
  'la Supervisión ve las OT de mantenimiento en la lista del reporte diario, sin la anulada');
reset role;

-- Ventas no tiene ninguna de las dos listas.
select test.como_usuario(:'ventas_id');
set local role authenticated;
select test.debe_fallar('select * from public.codigos_internos_para_elegir()', 'Ventas no pide la lista de códigos', 'No tienes permiso');
select test.debe_fallar('select * from public.vehiculos_ots_para_ingreso()', 'ni las OT para el ingreso', 'vehiculos.registrar');
reset role;

-- ===================================================== 3. El ingreso por su OT
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(
  (select string_agg(orden_numero || '=' || tipo || '/' || coalesce(placa, '-') || '/' || en_planta::text, ' ' order by orden_numero)
     from public.vehiculos_ots_para_ingreso() where cliente = 'QA CLIENTE 455')
  = '9455-2026=MANTENIMIENTO/QAA-455/false 9456-2026=MANTENIMIENTO/-/false 9457-2026=GARANTIA/-/false',
  'la ventana ofrece las OT de mantenimiento y de garantía vigentes, con la placa de su unidad');
select test.afirmar(not exists (select 1 from public.vehiculos_codigos_para_ingreso() where orden_numero in ('9455-2026', '9457-2026')),
  'y por código solo la fabricación: la OT de garantía de la unidad F no es la de su código');

select test.debe_fallar(pg_temp.ingreso_sql('x', null, '', 'MANTENIMIENTO', null),
  'por mantenimiento no entra sin su OT', 'Elige la OT de mantenimiento');
select test.debe_fallar(format($q$select public.registrar_ingreso_vehiculo(%L, null, null, 'CHK455_F_26/60', '', '', 'MANTENIMIENTO', null, null, pg_temp.foto('x', 'ingreso'))$q$,
  pg_temp.txt('x')), 'ni con la llamada de antes del despliegue, por código', 'Elige la OT de mantenimiento');
select test.debe_fallar(pg_temp.ingreso_sql('x', null, '', 'GARANTIA', 'mant_u'),
  'la OT de mantenimiento no sirve para la garantía', 'no es de garantía');
select test.debe_fallar(pg_temp.ingreso_sql('x', null, '', 'FABRICACION', 'mant_u'),
  'ni se elige OT para la fabricación', 'La OT se elige solo para mantenimiento o garantía');
select test.debe_fallar(pg_temp.ingreso_sql('x', 'QAB-455', 'Camión', 'MANTENIMIENTO', 'mant_anulada'),
  'con la OT anulada no entra', 'está anulada');
select test.debe_fallar(pg_temp.ingreso_sql('x', null, 'Camión', 'MANTENIMIENTO', 'mant_sin'),
  'la OT sin unidad pide la placa o el chasis', 'Anota la placa o el número de chasis');

-- Con unidad: la placa, el chasis, el vehículo y el cliente salen de ella.
select public.registrar_ingreso_vehiculo(pg_temp.id('u'), null, null, null, '', '', 'MANTENIMIENTO', null,
  'Viene por frenos', pg_temp.foto('u', 'ingreso'), pg_temp.id('mant_u'));
select test.afirmar(public.registrar_ingreso_vehiculo(pg_temp.id('u'), null, null, null, '', '', 'MANTENIMIENTO', null,
  'Viene por frenos', (select jsonb_agg(ruta order by orden) from public.registro_vehiculo_fotos where registro_id = pg_temp.id('u')),
  pg_temp.id('mant_u')) = pg_temp.id('u'),
  'el mismo envío repetido devuelve el mismo ingreso');
reset role;
select test.afirmar(
  (select codigo_interno = 'OT 9455-2026' and orden_id = :'mant_u'::uuid and unidad_id = :'unidad_u'::uuid
          and placa = 'QAA455' and chasis = '9BM455000AA000001' and empresa = 'QA CLIENTE 455' and unidad like '%Volvo%'
     from public.registro_vehiculos where id = pg_temp.id('u')),
  'el ingreso queda con el código de la OT, atado a ella y a su unidad, con sus datos');

select test.como_usuario(:'req_id');
set local role authenticated;
select test.debe_fallar(pg_temp.ingreso_sql('u2', null, '', 'MANTENIMIENTO', 'mant_u'),
  'la misma OT no entra dos veces sin haber salido', 'ya está en la planta');
-- Sin unidad: con la placa y el vehículo escritos, y el cliente de la OT.
select public.registrar_ingreso_vehiculo(pg_temp.id('s'), 'qab 455', null, null, 'Camioneta Hilux', '', 'MANTENIMIENTO', null,
  null, pg_temp.foto('s', 'ingreso'), pg_temp.id('mant_sin'));
select test.afirmar(
  (select codigo_interno = 'OT 9456-2026' and unidad_id is null and placa = 'QAB455' and unidad = 'Camioneta Hilux'
          and empresa = 'QA CLIENTE 455'
     from public.registro_vehiculos where id = pg_temp.id('s')),
  'la OT sin unidad entra con la placa y el vehículo anotados, y el cliente de la OT');
select test.afirmar((select en_planta from public.vehiculos_ots_para_ingreso() where orden_numero = '9456-2026'),
  'y la ventana ya la muestra en la planta');
-- La OT escrita como código en la cochera no se salta la regla.
select test.debe_fallar(format($q$select public.registrar_ingreso_vehiculo(%L, null, null, 'ot 9457-2026', 'Camión', 'QA', 'COCHERA', null, null, pg_temp.foto('c', 'ingreso'))$q$,
  pg_temp.txt('c')), 'la OT de garantía escrita como código no entra como cochera', 'elige el motivo (mantenimiento o garantía) y su OT');
-- La garantía entra por su OT aunque la unidad tenga su código y su OT de fabricación.
select public.registrar_ingreso_vehiculo(pg_temp.id('g'), null, null, null, '', '', 'GARANTIA', null, null,
  pg_temp.foto('g', 'ingreso'), pg_temp.id('garantia'));
reset role;
select test.afirmar((select codigo_interno = 'OT 9457-2026' and orden_id = :'garantia'::uuid and unidad_id = :'unidad_f'::uuid
                       from public.registro_vehiculos where id = pg_temp.id('g')),
  'la garantía entra con el código de su OT, no con el de la unidad');

-- ===================================================== 4. La salida espera a Administración
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(
  (pg_temp.estado('u') ->> 'exige')::boolean and pg_temp.estado('u') ->> 'avance' is null
  and pg_temp.estado('u') ->> 'garantia_ot' = '9455-2026' and pg_temp.estado('u') ->> 'garantia_estado' = 'APROBADA',
  'la pantalla recibe la OT de mantenimiento y su estado, sin avance');
select test.afirmar(pg_temp.estado('u') ->> 'falta_para_pedir'
                    = 'Administración todavía no da por terminado el mantenimiento de la OT 9455-2026: la salida se habilita cuando lo marque.',
  format('y dice qué falta: %s', pg_temp.estado('u') ->> 'falta_para_pedir'));
select test.debe_fallar(format($q$select public.registrar_salida_vehiculo(%L, null, 'Sale', pg_temp.foto('u', 'salida'))$q$, pg_temp.txt('u')),
  'con el mantenimiento sin terminar no sale', 'mantenimiento de la OT 9455-2026');
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('mant_u')),
  'Requerimientos no da por terminado el mantenimiento', 'ordenes.editar');
reset role;

select test.como_usuario(:'adm_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('fabricacion')),
  'una OT de fabricación no se termina así', 'no es de garantía ni de mantenimiento');
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('mant_anulada')),
  'ni una anulada', 'está anulada');
select public.dar_por_terminada_la_garantia(pg_temp.id('mant_u'), 'Frenos cambiados');
reset role;
select test.afirmar(exists (select 1 from public.notificaciones
                             where usuario_id = :'req_id' and origen_id = pg_temp.id('u')
                               and titulo = 'El mantenimiento de la OT 9455-2026 está terminado'),
  'Administración da por terminado el mantenimiento y a Requerimientos le llega el aviso');

select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(pg_temp.estado('u') ->> 'garantia_estado' = 'TERMINADA' and pg_temp.estado('u') ->> 'falta_para_pedir' is null
                    and pg_temp.estado('u') ->> 'falta_para_salir' = 'Falta la aprobación de Tesorería: pídele la revisión de la salida.',
  'terminado el mantenimiento, solo falta Tesorería');
select test.afirmar(not exists (select 1 from public.vehiculos_ots_para_ingreso() where orden_numero = '9455-2026'),
  'y la OT terminada ya no se ofrece para otro ingreso');
select test.afirmar(exists (select 1 from public.codigos_internos_para_elegir() where codigo = 'OT 9455-2026'),
  'aunque su código sigue en la lista, para lo que falte costear');
reset role;

-- La OT de garantía sigue pidiendo su unidad, pero ya no su código interno.
select test.como_usuario(:'admin_id');
insert into public.unidades (cliente_id, tipo_vehiculo, placa) values (:'cliente_id', 'CAMION', 'QAC-455') returning id as unidad_sin_codigo \gset
select test.afirmar(pg_temp.orden('9459-2026', :'unidad_sin_codigo', 'GARANTIA') is not null,
  'la OT de garantía de una unidad sin código se registra');

-- Las funciones nuevas no las llama nadie sin sesión.
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.vehiculos_ots_para_ingreso()', 'execute')
                    and not has_function_privilege('anon', 'public.registrar_ingreso_vehiculo(uuid,text,text,text,text,text,text,timestamptz,text,jsonb,uuid)', 'execute')
                    and not has_function_privilege('anon', 'public.codigo_de_la_ot(text)', 'execute'),
  'anon no ejecuta las funciones nuevas');

rollback;
