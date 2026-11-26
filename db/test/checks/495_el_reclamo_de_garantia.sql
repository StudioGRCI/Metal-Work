-- El reclamo de garantía (migraciones 20261126990000 y 20261126991000, plan
-- aparte de las demás áreas, entrega A.2). Cada paso con su cuenta y `set local
-- role authenticated`: Ventas registra (y Gerencia Comercial anula uno sin OT),
-- Administración enlaza la OT de garantía o lo cierra como «No procede»,
-- Calidad anota la causa cuando la garantía está terminada. El área de
-- Garantías y Gerencia lo ven; Tesorería, nada. El mismo envío no entra dos
-- veces; nadie borra ni corrige por debajo. El armazón lo pone el
-- administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA495', 'Taller prueba 495') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA495' \gset
select test.crear_usuario('Ada', 'Admin', 'admin495@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ven495@demo.pe', 'VENDEDOR', :'sede_id') as ven_id \gset
select test.crear_usuario('Coma', 'Comercial', 'gco495@demo.pe', 'GERENTE_COMERCIAL', :'sede_id') as gco_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm495@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Cali', 'Calidad', 'cal495@demo.pe', 'CALIDAD', :'sede_id') as cal_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger495@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tes495@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset
select test.crear_usuario('Dino', 'Garantías', 'grt495@demo.pe', 'OPERARIO', :'sede_id') as grt_id \gset
select test.crear_usuario('Gus', 'Jefe', 'jgrt495@demo.pe', 'SUPERVISOR', :'sede_id') as jefe_id \gset
select test.crear_usuario('Sergio', 'General', 'sg495@demo.pe', 'SUPERVISOR_GENERAL', :'sede_id') as sg_id \gset

select test.como_usuario(:'admin_id');
-- Dino trabaja en Garantías; Gus es su responsable. Las otras cuentas de estos
-- puestos (las de la base) se apagan: los avisos tienen que ir a las del check.
update public.usuarios set area_id = (select id from public.areas where codigo = 'GRT') where id = :'grt_id';
update public.areas set jefe_id = :'jefe_id' where codigo = 'GRT';
update public.usuarios u set activo = false
 where u.id not in (:'ven_id', :'gco_id', :'adm_id', :'cal_id', :'ger_id') and u.activo
   and u.rol_id in (select id from public.roles where codigo in ('VENDEDOR', 'GERENTE_COMERCIAL', 'ADMINISTRACION', 'CALIDAD', 'GERENTE'));

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000495', 'QA CLIENTE 495') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.sede', :'sede_id', true);
create or replace function pg_temp.unidad(p_codigo text) returns uuid language sql as $$
  insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
  values (current_setting('prueba.cliente')::uuid, p_codigo, 'Q' || right(p_codigo, 2) || '-495', 'CAMION') returning id;
$$;
create or replace function pg_temp.orden(p_numero text, p_unidad uuid, p_tipo text) returns uuid language sql as $$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
  values (p_numero, current_setting('prueba.cliente')::uuid, p_unidad, current_setting('prueba.sede')::uuid,
          p_tipo::public.tipo_trabajo_ot, 'NORMAL', 'Prueba 495 ' || p_tipo, 'APROBADA') returning id;
$$;
select pg_temp.unidad('CHK495_A_26/60') as unidad_a \gset
select pg_temp.unidad('CHK495_B_26/61') as unidad_b \gset
select pg_temp.orden('8495-2026', :'unidad_a', 'FABRICACION') as fab_a \gset
select pg_temp.orden('9495-2026', :'unidad_a', 'GARANTIA') as gar_a \gset
select pg_temp.orden('9496-2026', :'unidad_b', 'GARANTIA') as gar_b1 \gset
select pg_temp.orden('9497-2026', :'unidad_b', 'GARANTIA') as gar_b2 \gset
select pg_temp.orden('9498-2026', :'unidad_b', 'GARANTIA') as gar_b3 \gset
select pg_temp.orden('9499-2026', :'unidad_b', 'GARANTIA') as gar_b4 \gset

select set_config('prueba.ven', :'ven_id', true), set_config('prueba.gco', :'gco_id', true),
       set_config('prueba.adm', :'adm_id', true), set_config('prueba.cal', :'cal_id', true),
       set_config('prueba.ger', :'ger_id', true), set_config('prueba.tes', :'tes_id', true),
       set_config('prueba.grt', :'grt_id', true), set_config('prueba.jefe', :'jefe_id', true),
       set_config('prueba.unidad_a', :'unidad_a', true), set_config('prueba.unidad_b', :'unidad_b', true),
       set_config('prueba.fab_a', :'fab_a', true), set_config('prueba.gar_a', :'gar_a', true),
       set_config('prueba.gar_b1', :'gar_b1', true), set_config('prueba.gar_b2', :'gar_b2', true),
       set_config('prueba.rg1', gen_random_uuid()::text, true), set_config('prueba.rg2', gen_random_uuid()::text, true),
       set_config('prueba.rg3', gen_random_uuid()::text, true), set_config('prueba.rg4', gen_random_uuid()::text, true),
       set_config('prueba.rg5', gen_random_uuid()::text, true),
       set_config('prueba.gar_b3', :'gar_b3', true), set_config('prueba.gar_b4', :'gar_b4', true),
       set_config('prueba.rg6', gen_random_uuid()::text, true), set_config('prueba.rg7', gen_random_uuid()::text, true),
       set_config('prueba.rg8', gen_random_uuid()::text, true);
select set_config('prueba.foto1', :'ven_id' || '/' || current_setting('prueba.rg1') || '/' || gen_random_uuid() || '.jpg', true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.avisos(p_cuenta text, p_reclamo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_cuenta) and origen_tabla = 'garantia_reclamos' and origen_id = pg_temp.id(p_reclamo);
$$;
reset role;

-- 0. Lo que la migración dejó ----------------------------------------------------
select test.afirmar(
  (select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where (r.codigo, rp.permiso_codigo) in (('VENDEDOR', 'garantias.registrar'), ('GERENTE_COMERCIAL', 'garantias.registrar'),
                                            ('ADMINISTRACION', 'garantias.atender'), ('CALIDAD', 'garantias.causa'),
                                            ('GERENTE', 'garantias.ver'))) = 5,
  'Ventas y Gerencia Comercial registran, Administración atiende, Calidad anota la causa, Gerencia consulta');
select test.afirmar(
  (select formato = 'RG-{numero}-{anio}' from public.series_documentarias where tipo = 'RECLAMO_GARANTIA'),
  'la serie del reclamo es RG-0001-2026');
select test.afirmar((select not public from storage.buckets where id = 'fotos-garantias'), 'el bucket de las fotos es privado');

-- 1. Ventas elige la unidad y sube su foto; Tesorería no ------------------------
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar('select * from public.garantias_unidades_para_elegir()', 'Tesorería no elige unidades para reclamar', 'Ventas');
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-garantias'', %L, %L, ''{}'')',
      current_setting('prueba.tes') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.tes')),
    'Tesorería no sube fotos de reclamos', 'row-level security');
  perform test.debe_fallar(format($q$select * from public.garantias_registrar(%L, %L, 'La compuerta no cierra bien', null, null, '[]')$q$,
      gen_random_uuid(), current_setting('prueba.unidad_a')),
    'Tesorería no registra reclamos', 'Ventas');
end $$;
reset role;

select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    exists (select 1 from public.garantias_unidades_para_elegir() u
             where u.id = pg_temp.id('unidad_a') and u.cliente = 'QA CLIENTE 495' and u.reclamo_abierto is null),
    'Ventas elige la unidad con su cliente');
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-garantias'', %L, %L, ''{}'')',
      current_setting('prueba.tes') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.ven')),
    'nadie sube a la carpeta de otra cuenta', 'row-level security');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-garantias', current_setting('prueba.foto1'), current_setting('prueba.ven'), '{"mimetype": "image/jpeg", "size": 180000}');
end $$;

-- 2. Ventas registra ------------------------------------------------------------
do $$
declare r record; r2 record;
begin
  perform test.debe_fallar(format($q$select * from public.garantias_registrar(%L, %L, 'corto', null, null, '[]')$q$,
      gen_random_uuid(), current_setting('prueba.unidad_a')),
    'sin contar qué reclama no entra', '10 a 2000');
  perform test.debe_fallar(format($q$select * from public.garantias_registrar(%L, %L, 'La compuerta no cierra bien', null, null, '[]')$q$,
      gen_random_uuid(), gen_random_uuid()),
    'una unidad que no existe no entra', 'Elige la unidad');
  select * into r from public.garantias_registrar(pg_temp.id('rg1'), pg_temp.id('unidad_a'),
    '  La compuerta trasera no cierra y gotea en la ruta.  ', ' Chofer Juan ', ' 999 111 222 ',
    jsonb_build_array(current_setting('prueba.foto1')));
  perform test.afirmar(r.reclamo = pg_temp.id('rg1') and r.numero_reclamo ~ ('^RG-[0-9]{4}-' || extract(year from now())::text || '$'),
    'entra con su número RG-…-año');
  perform test.afirmar(r.aviso_administracion and r.aviso_garantias and not r.aviso_gerencia,
    'dice que le llegó a Administración y a Garantías, no a Gerencia');
  select * into r2 from public.garantias_registrar(pg_temp.id('rg1'), pg_temp.id('unidad_a'),
    '  La compuerta trasera no cierra y gotea en la ruta.  ', ' Chofer Juan ', ' 999 111 222 ',
    jsonb_build_array(current_setting('prueba.foto1')));
  perform test.afirmar(r2.numero_reclamo = r.numero_reclamo, 'el mismo envío repetido devuelve el mismo reclamo');
  perform test.debe_fallar(format($q$select * from public.garantias_registrar(%L, %L, 'Otra cosa que reclama el cliente', null, null, '[]')$q$,
      current_setting('prueba.rg1'), current_setting('prueba.unidad_a')),
    'con otra cosa, dice que ya quedó', 'ya quedó registrado');
  perform test.afirmar(
    (select descripcion = 'La compuerta trasera no cierra y gotea en la ruta.' and trae = 'Chofer Juan' and contacto = '999 111 222'
            and cliente_id = current_setting('prueba.cliente')::uuid and estado = 'REGISTRADO'
       from public.garantia_reclamos where id = pg_temp.id('rg1'))
    and (select count(*) from public.garantia_reclamo_fotos where reclamo_id = pg_temp.id('rg1')) = 1,
    'queda con su cliente, lo que reclama sin espacios de más y su foto');
  perform test.afirmar(
    (select reclamo_abierto = r.numero_reclamo from public.garantias_unidades_para_elegir() u where u.id = pg_temp.id('unidad_a')),
    'la unidad dice que ya tiene un reclamo abierto');
  perform test.debe_fallar(format('update public.garantia_reclamos set descripcion = %L where id = %L', 'cambiada por debajo', current_setting('prueba.rg1')),
    'Ventas no lo corrige por debajo', 'permission denied');
end $$;
reset role;

select test.afirmar(pg_temp.avisos('adm', 'rg1') = 1 and pg_temp.avisos('jefe', 'rg1') = 1
                    and pg_temp.avisos('ger', 'rg1') = 0 and pg_temp.avisos('ven', 'rg1') = 0,
  'el aviso le llegó a Administración y al responsable de Garantías, una vez');
select test.debe_fallar(format('delete from public.garantia_reclamos where id = %L', current_setting('prueba.rg1')),
  'nadie lo borra, tampoco por debajo', 'no se borra');
select test.debe_fallar(format('update public.garantia_reclamos set unidad_id = %L where id = %L', current_setting('prueba.unidad_b'), current_setting('prueba.rg1')),
  'lo que dice no se corrige por debajo', 'no se corrige');
select test.debe_fallar(format('update public.garantia_reclamo_fotos set orden = 2 where reclamo_id = %L', current_setting('prueba.rg1')),
  'sus fotos no se cambian', 'no se cambian');

-- 3. Quién lo ve ----------------------------------------------------------------
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.garantia_reclamos) = 0
                       and (select count(*) from public.garantia_reclamo_fotos) = 0
                       and (select count(*) from public.garantias_reclamos_visibles(null)) = 0
                       and (select count(*) from storage.objects where bucket_id = 'fotos-garantias') = 0,
    'Tesorería no ve reclamos, ni sus fotos, ni la lista');
end $$;
reset role;
-- Como en producción: el área de Garantías sin responsable. «Responsable = yo»
-- daba null, y la lista dejaba ver todo a cualquier cuenta (lo vio el banco).
select test.como_usuario(:'admin_id');
update public.areas set jefe_id = null where codigo = 'GRT';
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(public.puede_ver_los_reclamos_de_garantia() is false
                       and (select count(*) from public.garantias_reclamos_visibles(null)) = 0
                       and (select count(*) from public.garantias_reclamos_visibles(pg_temp.id('rg1'))) = 0,
    'con el área de Garantías sin responsable, Tesorería tampoco ve nada');
end $$;
reset role;
select test.como_usuario(:'admin_id');
update public.areas set jefe_id = :'jefe_id' where codigo = 'GRT';
reset role;

select test.como_usuario(:'grt_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.garantias_reclamos_visibles(null)) = 1
                       and (select count(*) from storage.objects where bucket_id = 'fotos-garantias') = 1,
    'quien trabaja en Garantías lo ve, con su foto');
  perform test.afirmar((select not (puede_enlazar or puede_no_procede or puede_causa or puede_anular)
                          from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'y no tiene botones');
end $$;
reset role;

select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'POR_ABRIR_OT' and cliente = 'QA CLIENTE 495' and fotos = 1
                          and not (puede_enlazar or puede_no_procede or puede_causa or puede_anular)
                          from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'Gerencia lo consulta: espera su OT, sin botones');
  perform test.debe_fallar(format('select * from public.garantias_enlazar_ot(%L, %L)', current_setting('prueba.rg1'), current_setting('prueba.gar_a')),
    'Gerencia no enlaza la OT', 'Administración');
  perform test.debe_fallar(format('select public.garantias_anular(%L, %L)', current_setting('prueba.rg1'), 'Gerencia intenta anularlo'),
    'Gerencia no lo anula', 'Ventas o Administración');
  perform test.debe_fallar(format($q$select * from public.garantias_registrar(%L, %L, 'La compuerta no cierra bien', null, null, '[]')$q$,
      gen_random_uuid(), current_setting('prueba.unidad_a')),
    'Gerencia no registra', 'Ventas');
end $$;
reset role;

-- 4. Administración enlaza su OT ---------------------------------------------------
select test.como_usuario(:'adm_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select array_agg(orden) from public.garantias_ots_para_enlazar(pg_temp.id('rg1'))) = array[pg_temp.id('gar_a')],
    'le ofrece solo la OT de garantía de esa unidad');
  perform test.afirmar((select puede_enlazar and puede_no_procede and puede_anular and not puede_causa
                          from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'Administración puede enlazar, decir que no procede o anular');
  perform test.debe_fallar(format('select * from public.garantias_enlazar_ot(%L, %L)', current_setting('prueba.rg1'), current_setting('prueba.fab_a')),
    'una OT que no es de garantía no se enlaza', 'no es de garantía');
  perform test.debe_fallar(format('select * from public.garantias_enlazar_ot(%L, %L)', current_setting('prueba.rg1'), current_setting('prueba.gar_b1')),
    'una OT de otra unidad no se enlaza', 'otra unidad');
  select * into r from public.garantias_enlazar_ot(pg_temp.id('rg1'), pg_temp.id('gar_a'));
  perform test.afirmar(r.numero_ot = '9495-2026', 'enlaza su OT de garantía');
  select * into r from public.garantias_enlazar_ot(pg_temp.id('rg1'), pg_temp.id('gar_a'));
  perform test.afirmar(r.numero_ot = '9495-2026', 'el mismo pedido repetido entra');
  perform test.afirmar((select situacion = 'EN_TALLER' and orden_numero = '9495-2026' and not puede_anular and not puede_enlazar
                          from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'queda en el taller, sin anular ni cambiar de OT');
  perform test.debe_fallar(format('select public.garantias_anular(%L, %L)', current_setting('prueba.rg1'), 'Ya no se debería poder anular'),
    'con OT ya no se anula', 'ya no se anula');
  perform test.debe_fallar(format('select public.garantias_no_procede(%L, %L)', current_setting('prueba.rg1'), 'Ya tiene su OT de garantía'),
    'con OT ya no es «no procede»', 'ya no espera su OT');
  perform test.debe_fallar(format('select * from public.garantias_enlazar_ot(%L, %L)', current_setting('prueba.rg1'), current_setting('prueba.gar_b1')),
    'tampoco se cambia de OT mientras la suya sigue viva', 'se cambia solo si esa OT se anula');
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg1'), 'FABRICACION', 'Soldadura mal hecha en la bisagra'),
    'Administración no anota la causa', 'Calidad');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ven', 'rg1') = 1, 'a Ventas le llegó que ya tiene su OT');

-- 5. Calidad anota la causa cuando la garantía está terminada -------------------------
select test.como_usuario(:'cal_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'EN_TALLER' and not puede_causa from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'mientras el taller trabaja, Calidad no tiene qué anotar');
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg1'), 'FABRICACION', 'Soldadura mal hecha en la bisagra'),
    'antes de terminada, no se anota la causa', 'todavía no está terminada');
end $$;
reset role;

select test.como_usuario(:'adm_id');
set local role authenticated;
select public.dar_por_terminada_la_garantia(:'gar_a', 'Bisagra cambiada');
reset role;
select test.afirmar(pg_temp.avisos('cal', 'rg1') = 1, 'al terminar la garantía, a Calidad le llega que anote la causa');

select test.como_usuario(:'cal_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'POR_CAUSA' and puede_causa from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'ahora espera la causa de Calidad');
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg1'), 'MALA_SUERTE', 'Soldadura mal hecha en la bisagra'),
    'la causa sale de la lista', 'de la lista');
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg1'), 'FABRICACION', 'corta'),
    'la causa se cuenta', '10 a 1000');
  perform test.afirmar(public.garantias_anotar_causa(pg_temp.id('rg1'), 'FABRICACION', ' Soldadura mal hecha en la bisagra ') = pg_temp.id('rg1'),
    'Calidad anota la causa');
  perform test.afirmar(public.garantias_anotar_causa(pg_temp.id('rg1'), 'FABRICACION', 'Soldadura mal hecha en la bisagra') = pg_temp.id('rg1'),
    'el mismo pedido repetido entra');
  perform test.afirmar((select estado = 'CERRADO' and causa = 'FABRICACION' and causa_detalle = 'Soldadura mal hecha en la bisagra'
                               and cerro = 'Cali Calidad' and not puede_causa
                          from public.garantias_reclamos_visibles(pg_temp.id('rg1'))),
    'queda cerrado con su causa y quién la anotó');
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg1'), 'MATERIAL', 'Otra causa distinta de la primera'),
    'cerrado, no se cambia la causa', 'ya se cerró');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ven', 'rg1') = 2, 'a Ventas le llegó que se cerró con su causa');
select test.debe_fallar(format('update public.garantia_reclamos set causa = %L where id = %L', 'MATERIAL', current_setting('prueba.rg1')),
  'cerrado, queda como evidencia', 'ya está cerrado');

-- 6. «No procede» y anular ----------------------------------------------------------------
select test.como_usuario(:'ven_id');
set local role authenticated;
select reclamo from public.garantias_registrar(pg_temp.id('rg2'), :'unidad_b', 'El cliente dice que el piso se dobló', null, null, '[]');
select reclamo from public.garantias_registrar(pg_temp.id('rg3'), :'unidad_b', 'La pintura se pela en la tolva', null, null, '[]');
reset role;

select test.como_usuario(:'adm_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format('select public.garantias_no_procede(%L, %L)', current_setting('prueba.rg2'), 'corto'),
    'sin motivo no se cierra', '10 a 500');
  perform test.afirmar(public.garantias_no_procede(pg_temp.id('rg2'), 'Cargó el doble de lo que soporta la tolva') = pg_temp.id('rg2'),
    'Administración lo cierra como «No procede»');
  perform test.afirmar((select estado = 'NO_PROCEDE' and no_procede_motivo = 'Cargó el doble de lo que soporta la tolva' and cerro = 'Alma Administración'
                          from public.garantias_reclamos_visibles(pg_temp.id('rg2'))),
    'con su motivo y quién lo cerró');
  perform test.debe_fallar(format('select * from public.garantias_enlazar_ot(%L, %L)', current_setting('prueba.rg2'), current_setting('prueba.gar_b1')),
    'cerrado, no se le enlaza OT', 'ya está cerrado');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ven', 'rg2') = 1, 'a Ventas le llegó que no procede');

select test.como_usuario(:'gco_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select puede_anular and not puede_enlazar from public.garantias_reclamos_visibles(pg_temp.id('rg3'))),
    'Gerencia Comercial puede anular el que no tiene OT, no enlazarla');
  perform test.afirmar(public.garantias_anular(pg_temp.id('rg3'), 'Se registró en la unidad equivocada') = pg_temp.id('rg3'),
    'Gerencia Comercial lo anula con su motivo');
  perform test.afirmar(public.garantias_anular(pg_temp.id('rg3'), 'Se registró en la unidad equivocada') = pg_temp.id('rg3'),
    'el mismo pedido repetido entra');
  perform test.debe_fallar(format('select public.garantias_anular(%L, %L)', current_setting('prueba.rg3'), 'Otro motivo distinto del primero'),
    'con otro motivo, dice el que quedó', 'ya estaba anulado');
end $$;
reset role;
select test.afirmar(
  (select estado = 'ANULADO' and anulado_por = :'gco_id' and anulado_en is not null from public.garantia_reclamos where id = pg_temp.id('rg3'))
  and pg_temp.avisos('ven', 'rg3') = 1,
  'queda anulado, con quién y cuándo, y a quien lo registró le llega');
select test.afirmar(
  (select count(distinct numero) = 3 from public.garantia_reclamos where id in (pg_temp.id('rg1'), pg_temp.id('rg2'), pg_temp.id('rg3'))),
  'cada reclamo con su número');

-- 7. Si su OT se anula, Administración enlaza otra --------------------------------------
select test.como_usuario(:'ven_id');
set local role authenticated;
select reclamo from public.garantias_registrar(pg_temp.id('rg4'), :'unidad_b', 'La baranda lateral se soltó', null, null, '[]');
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
select numero_ot from public.garantias_enlazar_ot(pg_temp.id('rg4'), :'gar_b1');
reset role;
select test.como_usuario(:'admin_id');
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se abrió con el número equivocado' where id = :'gar_b1';
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select situacion = 'OT_ANULADA' and puede_enlazar and puede_no_procede and puede_anular
                          from public.garantias_reclamos_visibles(pg_temp.id('rg4'))),
    'con su OT anulada, pide otra, o se cierra como «No procede», o se anula');
  select * into r from public.garantias_enlazar_ot(pg_temp.id('rg4'), pg_temp.id('gar_b2'));
  perform test.afirmar(r.numero_ot = '9497-2026'
                       and (select situacion = 'EN_TALLER' from public.garantias_reclamos_visibles(pg_temp.id('rg4'))),
    'enlaza la nueva y vuelve al taller');
end $$;
reset role;
select test.como_usuario(:'cal_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format('select public.garantias_anotar_causa(%L, %L, %L)', current_setting('prueba.rg4'), 'MONTAJE', 'La baranda se montó con pernos cortos'),
    'la nueva OT todavía no está terminada', 'todavía no está terminada');
end $$;
reset role;

-- 7b. Con su OT anulada, también se cierra o se anula; si no, quedaba sin salida ---------
-- (lo vio el auditor: Gerencia anula la OT porque no era garantía, y el reclamo
-- se quedaba para siempre en el globo de Administración).
select test.como_usuario(:'ven_id');
set local role authenticated;
select reclamo from public.garantias_registrar(pg_temp.id('rg6'), :'unidad_b', 'La puerta lateral roza al cerrar', null, null, '[]');
select reclamo from public.garantias_registrar(pg_temp.id('rg7'), :'unidad_b', 'El piso de la tolva suena al cargar', null, null, '[]');
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
select numero_ot from public.garantias_enlazar_ot(pg_temp.id('rg6'), :'gar_b3');
select numero_ot from public.garantias_enlazar_ot(pg_temp.id('rg7'), :'gar_b4');
do $$ begin
  perform test.debe_fallar(format('select public.garantias_no_procede(%L, %L)', current_setting('prueba.rg6'), 'No es una garantía del taller'),
    'con su OT viva, no se cierra como «No procede»', 'tiene su OT de garantía');
end $$;
reset role;
select test.como_usuario(:'admin_id');
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'No era garantía: el daño es de un choque'
 where id in (:'gar_b3', :'gar_b4');
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(public.garantias_no_procede(pg_temp.id('rg6'), 'El daño es de un choque, no del trabajo del taller') = pg_temp.id('rg6'),
    'con su OT anulada, Administración lo cierra como «No procede»');
  perform test.afirmar((select situacion = 'NO_PROCEDE' and orden_numero = '9498-2026' and not (puede_enlazar or puede_no_procede or puede_anular)
                          from public.garantias_reclamos_visibles(pg_temp.id('rg6'))),
    'queda cerrado y la OT anulada sigue nombrada como evidencia');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ven', 'rg6') = 2, 'a Ventas le llegó la OT y después que no procede');
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(public.garantias_anular(pg_temp.id('rg7'), 'Era el mismo reclamo que la puerta lateral') = pg_temp.id('rg7'),
    'con su OT anulada, Ventas lo anula con su motivo');
  perform test.afirmar((select situacion = 'ANULADO' and orden_numero = '9499-2026' from public.garantias_reclamos_visibles(pg_temp.id('rg7'))),
    'queda anulado, con su OT anulada nombrada');
end $$;
reset role;
select test.debe_fallar(format('update public.garantia_reclamos set orden_id = null where id = %L', current_setting('prueba.rg6')),
  'cerrado con su OT anulada, queda como evidencia', 'ya está cerrado');

-- 7c. Enlazar una OT cuya garantía ya estaba terminada avisa a Calidad ---------------------
-- Su OT nace aquí: antes, la sección 4 la habría ofrecido junto a la del reclamo 1.
select test.como_usuario(:'admin_id');
select pg_temp.orden('9500-2026', :'unidad_a', 'GARANTIA') as gar_a2 \gset
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
select public.dar_por_terminada_la_garantia(:'gar_a2', 'Se cambió el gancho antes del reclamo');
reset role;
select test.como_usuario(:'ven_id');
set local role authenticated;
select reclamo from public.garantias_registrar(pg_temp.id('rg8'), :'unidad_a', 'El gancho volvió a soltarse', null, null, '[]');
reset role;
select test.como_usuario(:'adm_id');
set local role authenticated;
select numero_ot from public.garantias_enlazar_ot(pg_temp.id('rg8'), :'gar_a2');
reset role;
select test.afirmar(pg_temp.avisos('cal', 'rg8') = 1, 'al enlazar una OT ya terminada, a Calidad le llega que anote la causa');
select test.como_usuario(:'cal_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'POR_CAUSA' and puede_causa from public.garantias_reclamos_visibles(pg_temp.id('rg8'))),
    'y el reclamo ya espera su causa');
end $$;
reset role;

-- 8. Sin Administración, el aviso le llega a Gerencia ---------------------------------
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = :'adm_id';
reset role;
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.garantias_registrar(pg_temp.id('rg5'), pg_temp.id('unidad_a'), 'El gancho de arrastre tiene juego', null, null, '[]');
  perform test.afirmar(not r.aviso_administracion and r.aviso_gerencia, 'sin cuenta de Administración, le llega a Gerencia y lo dice');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ger', 'rg5') = 1, 'Gerencia recibió ese aviso');

-- 9. La auditoría del reclamo se lee con lo mismo que el reclamo -------------------------
-- Supervisor General tiene `auditoria.ver` y no ve reclamos: la copia de la fila
-- (qué reclama, quién lo trae, su contacto) tampoco (lo vio el auditor).
select test.afirmar(exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
                             where r.codigo = 'SUPERVISOR_GENERAL' and rp.permiso_codigo = 'auditoria.ver'),
  'Supervisor General lee la auditoría');
select test.como_usuario(:'sg_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.garantias_reclamos_visibles(null)) = 0, 'Supervisor General no ve los reclamos');
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'garantia_reclamos') = 0, 'ni su copia en la auditoría');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'garantia_reclamos') > 0,
    'Gerencia, que los ve, sí lee su auditoría');
end $$;
reset role;

select test.afirmar(true, 'fin del check 495');
rollback;
