-- El Tramitador y sus trámites (migraciones 20261126997000, 20261126997100 y
-- 20261126997200; plan «El puesto de Tramitador», entrega 1). Cada paso con su
-- cuenta y `set local role authenticated`: el Tramitador mantiene el catálogo,
-- registra, lleva el trámite y pide anularlo; Gerencia consulta y aprueba o no
-- la anulación; Administración consulta todo; Ventas y Gerencia Comercial, solo
-- los de una unidad; Tesorería, nada. El mismo envío no entra dos veces; nadie
-- borra ni corrige por debajo. El armazón lo pone el administrador. Termina en
-- rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA496', 'Taller prueba 496') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA496' \gset
select test.crear_usuario('Ada', 'Admin', 'admin496@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Tita', 'Trámites', 'tra496@demo.pe', 'TRAMITADOR', :'sede_id') as tra_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger496@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm496@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ven496@demo.pe', 'VENDEDOR', :'sede_id') as ven_id \gset
select test.crear_usuario('Coma', 'Comercial', 'gco496@demo.pe', 'GERENTE_COMERCIAL', :'sede_id') as gco_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tes496@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset

select test.como_usuario(:'admin_id');
-- Las otras cuentas de Gerencia (las de la base) se apagan: el aviso de la
-- anulación tiene que ir a la del check.
update public.usuarios u set activo = false
 where u.id <> :'ger_id' and u.activo
   and u.rol_id in (select id from public.roles where codigo = 'GERENTE');

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000496', 'QA CLIENTE 496') returning id as cliente_id \gset
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990001496', 'QA OTRO CLIENTE 496') returning id as cliente_b \gset
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK496_A_26/70', 'QA7-496', 'CAMION') returning id as unidad_a \gset
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK496_B_26/71', 'QB7-496', 'CAMION') returning id as unidad_b \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8496-2026', :'cliente_id', :'unidad_a', :'sede_id', 'FABRICACION', 'NORMAL', 'Prueba 496 A', 'APROBADA') returning id as ot_a \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8497-2026', :'cliente_id', :'unidad_b', :'sede_id', 'FABRICACION', 'NORMAL', 'Prueba 496 B', 'APROBADA') returning id as ot_b \gset
select id as tipo_tarjeta from public.tramite_tipos where nombre = 'Tarjeta de propiedad' \gset
select id as tipo_soat from public.tramite_tipos where nombre = 'SOAT' \gset

select set_config('prueba.tra', :'tra_id', true), set_config('prueba.ger', :'ger_id', true),
       set_config('prueba.adm', :'adm_id', true), set_config('prueba.ven', :'ven_id', true),
       set_config('prueba.gco', :'gco_id', true), set_config('prueba.tes', :'tes_id', true),
       set_config('prueba.cliente', :'cliente_id', true), set_config('prueba.cliente_b', :'cliente_b', true),
       set_config('prueba.unidad_a', :'unidad_a', true), set_config('prueba.unidad_b', :'unidad_b', true),
       set_config('prueba.ot_a', :'ot_a', true), set_config('prueba.ot_b', :'ot_b', true),
       set_config('prueba.tipo_tarjeta', :'tipo_tarjeta', true), set_config('prueba.tipo_soat', :'tipo_soat', true),
       set_config('prueba.tr1', gen_random_uuid()::text, true), set_config('prueba.tr2', gen_random_uuid()::text, true),
       set_config('prueba.tr3', gen_random_uuid()::text, true), set_config('prueba.tipo_nuevo', gen_random_uuid()::text, true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.avisos(p_cuenta text, p_tramite text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_cuenta) and origen_tabla = 'tramites' and origen_id = pg_temp.id(p_tramite);
$$;
create or replace function pg_temp.hoy() returns date language sql as $$
  select (now() at time zone 'America/Lima')::date;
$$;
reset role;

-- 0. Lo que la migración dejó ----------------------------------------------------
select test.afirmar(
  (select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo like 'tramites.%') = 6
  and (select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
        where (r.codigo, rp.permiso_codigo) in (('TRAMITADOR', 'tramites.gestionar'), ('GERENTE', 'tramites.ver'),
                                                ('ADMINISTRACION', 'tramites.ver'), ('GERENTE', 'tramites.aprobar_anulacion'),
                                                ('VENDEDOR', 'tramites.ver_de_unidades'), ('GERENTE_COMERCIAL', 'tramites.ver_de_unidades'))) = 6,
  'el Tramitador gestiona; Gerencia y Administración consultan; Gerencia aprueba la anulación; Ventas ve los de una unidad; nadie más');
select test.afirmar(
  (select array_agg(rp.permiso_codigo order by 1) = array['tramites.gestionar']
     from public.roles_permisos rp join public.roles r on r.id = rp.rol_id where r.codigo = 'TRAMITADOR'),
  'el Tramitador tiene solo lo suyo');
select test.afirmar(
  (select formato = 'TR-{numero}-{anio}' from public.series_documentarias where tipo = 'TRAMITE'),
  'la serie del trámite es TR-0001-2026');
select test.afirmar(
  (select count(*) filter (where ambito = 'UNIDAD') >= 3 and count(*) filter (where ambito = 'EMPRESA') >= 3 from public.tramite_tipos where activo),
  'el catálogo nace con tipos de una unidad y de la empresa');
select test.afirmar(
  (select a.codigo = 'ADM' and r.codigo = 'TRAMITADOR' and u.activo
     from public.usuarios u join public.roles r on r.id = u.rol_id left join public.areas a on a.id = u.area_id
    where u.correo = 'tramitador@metalworkperusac.com'),
  'la cuenta del Tramitador existe, en el área de Administración');

-- 1. Quien no lleva trámites no registra ni toca el catálogo ---------------------
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar('select * from public.tramites_unidades_para_elegir()', 'Tesorería no elige unidades', 'No tienes permiso');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'SOAT de la camioneta', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat')),
    'Tesorería no registra trámites', 'No tienes permiso');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Permiso de prueba', 'MTC', 'EMPRESA', true, '[30]', true)$q$, gen_random_uuid()),
    'Tesorería no toca el catálogo', 'No tienes permiso');
  perform test.afirmar((select count(*) from public.tramite_tipos) = 0, 'Tesorería no lee el catálogo');
end $$;
reset role;

select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'SOAT de la camioneta', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat')),
    'Gerencia consulta: no registra', 'No tienes permiso');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Permiso de prueba', 'MTC', 'EMPRESA', true, '[30]', true)$q$, gen_random_uuid()),
    'Gerencia no toca el catálogo', 'No tienes permiso');
end $$;
reset role;

-- 2. El Tramitador mantiene el catálogo ------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select count(*) from public.tramite_tipos) >= 6, 'el Tramitador lee el catálogo');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, ' soat ', 'Otra', 'EMPRESA', true, '[30]', true)$q$, current_setting('prueba.tipo_nuevo')),
    'un nombre repetido no entra, tampoco con otras mayúsculas', 'Ya hay un tipo');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Bonificación de placas', 'MTC', 'EMPRESA', true, '[200]', true)$q$, current_setting('prueba.tipo_nuevo')),
    'los días de aviso van de 0 a 120', '0 a 120');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Bonificación de placas', 'MTC', 'EMPRESA', true, '[]', true)$q$, current_setting('prueba.tipo_nuevo')),
    'hace falta al menos un aviso', '1 a 5');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Bonificación de placas', 'MTC', 'TALLER', true, '[30]', true)$q$, current_setting('prueba.tipo_nuevo')),
    'el ámbito es unidad o empresa', 'unidad o de la empresa');
  select * into r from public.tramites_guardar_tipo(pg_temp.id('tipo_nuevo'), '  Bonificación   de placas ', ' MTC ', 'UNIDAD', false, '[7, 15, 7, 30]', true);
  perform test.afirmar(r.creado and (select nombre = 'Bonificación de placas' and entidad = 'MTC' and dias_aviso = array[30, 15, 7] and creado_por = pg_temp.id('tra')
                                        from public.tramite_tipos where id = pg_temp.id('tipo_nuevo')),
    'da de alta un tipo, sin espacios de más y con los días de más a menos y sin repetir');
  select * into r from public.tramites_guardar_tipo(pg_temp.id('tipo_nuevo'), 'Bonificación de placas', 'MTC', 'UNIDAD', false, '[10]', false);
  perform test.afirmar(not r.creado and (select dias_aviso = array[10] and not activo from public.tramite_tipos where id = pg_temp.id('tipo_nuevo')),
    'lo corrige y lo desactiva');
  perform test.debe_fallar(format('delete from public.tramite_tipos where id = %L', current_setting('prueba.tipo_nuevo')),
    'el Tramitador no borra un tipo por debajo', 'permission denied');
  perform test.debe_fallar(format('update public.tramite_tipos set nombre = %L where id = %L', 'por debajo', current_setting('prueba.tipo_nuevo')),
    'ni lo corrige por debajo', 'permission denied');
end $$;
reset role;
select test.debe_fallar(format('delete from public.tramite_tipos where id = %L', current_setting('prueba.tipo_nuevo')),
  'un tipo no se borra, tampoco por debajo', 'no se borra');

-- 3. El Tramitador registra ------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare r record; r2 record;
begin
  perform test.afirmar(
    exists (select 1 from public.tramites_unidades_para_elegir() u
             where u.id = pg_temp.id('unidad_a') and u.cliente = 'QA CLIENTE 496'
               and u.ordenes @> jsonb_build_array(jsonb_build_object('numero', '8496-2026'))),
    'elige la unidad con su cliente y sus OT');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, %L, null, 'Tarjeta de la unidad', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_nuevo'), current_setting('prueba.unidad_a')),
    'un tipo desactivado no se ofrece', 'Elige el tipo');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'Tarjeta de la unidad', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_tarjeta')),
    'el de una unidad pide su unidad', 'elige la unidad');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, %L, %L, 'Tarjeta de la unidad', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_tarjeta'), current_setting('prueba.unidad_a'), current_setting('prueba.ot_b')),
    'la OT tiene que ser de esa unidad', 'OT de esa unidad');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, %L, null, 'SOAT de la camioneta', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat'), current_setting('prueba.unidad_a')),
    'el de la empresa no lleva unidad', 'no lleva unidad');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'SOAT', null, null, null, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat')),
    'sin decir qué se tramita no entra', '5 a 300');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'SOAT de la camioneta', null, null, %L, null, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat'), pg_temp.hoy() + 1),
    'la fecha en que se presentó no es futura', 'no puede ser futura');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, null, null, 'SOAT de la camioneta', null, null, %L, %L, null)$q$,
      gen_random_uuid(), current_setting('prueba.tipo_soat'), pg_temp.hoy(), pg_temp.hoy() - 1),
    'la fecha límite no es anterior al inicio', 'no puede ser anterior');

  -- El de una unidad, con su OT, ya presentado.
  select * into r from public.tramites_registrar(pg_temp.id('tr1'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), pg_temp.id('ot_a'),
    '  Tarjeta de propiedad   de la unidad  ', null, ' 2026-01234 ', pg_temp.hoy() - 3, pg_temp.hoy() + 10, null);
  perform test.afirmar(r.tramite = pg_temp.id('tr1') and r.numero_tramite ~ ('^TR-[0-9]{4}-' || extract(year from now())::text || '$'),
    'entra con su número TR-…-año');
  select * into r2 from public.tramites_registrar(pg_temp.id('tr1'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), pg_temp.id('ot_a'),
    '  Tarjeta de propiedad   de la unidad  ', null, ' 2026-01234 ', pg_temp.hoy() - 3, pg_temp.hoy() + 10, null);
  perform test.afirmar(r2.numero_tramite = r.numero_tramite and (select count(*) from public.tramites) = 1,
    'el mismo envío repetido devuelve el mismo trámite');
  perform test.debe_fallar(format($q$select * from public.tramites_registrar(%L, %L, %L, %L, 'Otra cosa distinta', null, null, null, null, null)$q$,
      current_setting('prueba.tr1'), current_setting('prueba.tipo_tarjeta'), current_setting('prueba.unidad_a'), current_setting('prueba.ot_a')),
    'con otra cosa, dice que ya quedó', 'la primera vez que lo enviaste');
  perform test.afirmar(
    (select asunto = 'Tarjeta de propiedad de la unidad' and entidad = 'SUNARP' and expediente = '2026-01234' and ambito = 'UNIDAD'
            and cliente_id = pg_temp.id('cliente') and orden_id = pg_temp.id('ot_a') and estado = 'EN_TRAMITE' and registrado_por = pg_temp.id('tra')
       from public.tramites where id = pg_temp.id('tr1')),
    'queda con su cliente, su OT, la entidad del tipo y «En trámite»');

  -- El de la empresa, sin presentar todavía.
  select * into r from public.tramites_registrar(pg_temp.id('tr2'), pg_temp.id('tipo_soat'), null, null,
    'SOAT de la camioneta de reparto', 'Rímac', null, null, pg_temp.hoy() - 2, null);
  perform test.afirmar(
    (select estado = 'POR_INICIAR' and entidad = 'Rímac' and ambito = 'EMPRESA' and unidad_id is null and cliente_id is null
       from public.tramites where id = pg_temp.id('tr2')),
    'el de la empresa nace «Por iniciar» si no se ha presentado, con la entidad que se escribió');
  perform test.afirmar(
    (select array_agg(v.numero order by v.numero) from public.tramites_visibles(null) v) =
    (select array_agg(t.numero order by t.numero) from public.tramites t)
    and (select v.vencido and v.dias_para_limite = -2 and v.situacion = 'POR_INICIAR' and v.puede_actualizar and v.puede_pedir_anulacion
                and not v.puede_resolver_anulacion and v.tipo = 'SOAT' and v.se_renueva
           from public.tramites_visibles(pg_temp.id('tr2')) v)
    and (select not v.vencido and v.dias_para_limite = 10 and v.placa = 'QA7-496' and v.cliente = 'QA CLIENTE 496' and v.orden_numero = '8496-2026'
                and v.registro = 'Tita Trámites'
           from public.tramites_visibles(pg_temp.id('tr1')) v),
    'el Tramitador ve los dos, con su unidad, su OT, sus días y lo que puede hacer');
  perform test.debe_fallar(format('update public.tramites set asunto = %L where id = %L', 'cambiado por debajo', current_setting('prueba.tr1')),
    'el Tramitador no lo corrige por debajo', 'permission denied');
  perform test.debe_fallar(format('delete from public.tramites where id = %L', current_setting('prueba.tr1')),
    'ni lo borra', 'permission denied');
  perform test.debe_fallar(
    format($q$insert into public.tramites (numero, tipo_id, ambito, entidad, asunto) values ('TR-9999-2026', %L, 'EMPRESA', 'Rímac', 'Metido por debajo')$q$,
      current_setting('prueba.tipo_soat')),
    'ni mete uno por debajo', 'permission denied');
end $$;
reset role;

-- El cliente queda congelado: la unidad cambia de dueño y el trámite no.
update public.unidades set cliente_id = :'cliente_b' where id = :'unidad_a';
select test.debe_fallar(format('delete from public.tramites where id = %L', current_setting('prueba.tr1')),
  'nadie lo borra, tampoco por debajo', 'no se borra');
select test.debe_fallar(format('update public.tramites set unidad_id = %L where id = %L', current_setting('prueba.unidad_b'), current_setting('prueba.tr1')),
  'la unidad no se corrige por debajo', 'no se corrigen');
select test.debe_fallar(format($q$update public.tramites set estado = 'ANULADO' where id = %L$q$, current_setting('prueba.tr1')),
  'no se anula por debajo sin el pedido y el visto', 'visto de Gerencia');

-- 4. El Tramitador lo lleva ------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select cliente = 'QA CLIENTE 496' from public.tramites_visibles(pg_temp.id('tr1'))),
    'el trámite sigue con el cliente que tenía la unidad al registrarlo');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'OBSERVADO', 'Tarjeta de propiedad de la unidad', 'SUNARP', '2026-01234', %L, %L, null)$q$,
      current_setting('prueba.tr1'), pg_temp.hoy() - 3, pg_temp.hoy() + 10),
    'observado pide decir qué observó la entidad', 'qué observó');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Rímac', null, null, null, null)$q$,
      current_setting('prueba.tr2')),
    'en trámite pide la fecha en que se presentó', 'fecha en que se presentó');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'CONCLUIDO', 'SOAT de la camioneta de reparto', 'Rímac', null, null, null, null)$q$,
      current_setting('prueba.tr2')),
    'el estado es uno de los tres', 'por iniciar, en trámite u observado');
  perform public.tramites_actualizar(pg_temp.id('tr1'), 'OBSERVADO', 'Tarjeta de propiedad de la unidad', 'SUNARP', '2026-01234',
    pg_temp.hoy() - 3, pg_temp.hoy() + 12, '  Falta la firma legalizada del cliente.  ');
  perform test.afirmar(
    (select estado = 'OBSERVADO' and nota = 'Falta la firma legalizada del cliente.' and fecha_limite = pg_temp.hoy() + 12
       from public.tramites where id = pg_temp.id('tr1')),
    'queda observado, con su nota y su nueva fecha límite');
  perform public.tramites_actualizar(pg_temp.id('tr2'), 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Rímac', 'POL-778', pg_temp.hoy(), pg_temp.hoy() + 5, null);
  perform test.afirmar((select estado = 'EN_TRAMITE' and expediente = 'POL-778' and fecha_inicio = pg_temp.hoy() from public.tramites where id = pg_temp.id('tr2')),
    'el de la empresa pasa a «En trámite» con su fecha y su expediente');
end $$;
reset role;

-- 5. Quién lo ve -----------------------------------------------------------------
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramites) = 0 and (select count(*) from public.tramites_visibles(null)) = 0,
    'Tesorería no ve trámites, ni por la tabla ni por la lista');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'Cambiado por Tesorería', 'SUNARP', null, %L, null, null)$q$,
      current_setting('prueba.tr1'), pg_temp.hoy()),
    'ni los lleva', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'Se registró por error dos veces')$q$, current_setting('prueba.tr1')),
    'ni pide anularlos', 'No tienes permiso');
  perform test.debe_fallar(format($q$select * from public.tramites_resolver_anulacion(%L, true, null)$q$, current_setting('prueba.tr1')),
    'ni aprueba una anulación', 'No tienes permiso');
end $$;
reset role;

select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select array_agg(id) = array[pg_temp.id('tr1')] from public.tramites)
    and (select array_agg(v.id) = array[pg_temp.id('tr1')] from public.tramites_visibles(null) v)
    and (select count(*) from public.tramites_visibles(pg_temp.id('tr2'))) = 0,
    'Ventas ve solo el de la unidad, por la tabla y por la lista');
  perform test.afirmar(
    (select not v.puede_actualizar and not v.puede_pedir_anulacion and not v.puede_resolver_anulacion from public.tramites_visibles(pg_temp.id('tr1')) v),
    'y no puede hacer nada en él');
  perform test.afirmar((select count(*) from public.tramite_tipos where ambito = 'EMPRESA') = 0 and (select count(*) from public.tramite_tipos) >= 3,
    'del catálogo lee solo los tipos de una unidad');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'Cambiado por Ventas', 'SUNARP', null, %L, null, null)$q$,
      current_setting('prueba.tr1'), pg_temp.hoy()),
    'Ventas consulta: no los lleva', 'No tienes permiso');
  perform test.debe_fallar('select * from public.tramites_unidades_para_elegir()', 'ni elige unidades para registrar', 'No tienes permiso');
end $$;
reset role;

select test.como_usuario(:'gco_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select array_agg(v.id) = array[pg_temp.id('tr1')] from public.tramites_visibles(null) v),
    'Gerencia Comercial ve solo el de la unidad');
end $$;
reset role;

select test.como_usuario(:'adm_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select count(*) from public.tramites) = 2 and (select count(*) from public.tramites_visibles(null)) = 2
    and (select bool_and(not v.puede_actualizar and not v.puede_pedir_anulacion and not v.puede_resolver_anulacion) from public.tramites_visibles(null) v),
    'Administración ve los dos y no puede hacer nada en ellos');
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'Se registró por error dos veces')$q$, current_setting('prueba.tr1')),
    'Administración consulta: no pide anular', 'No tienes permiso');
end $$;
reset role;

-- 6. La anulación: la pide el Tramitador, la aprueba Gerencia ----------------------
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramites_visibles(null)) = 2, 'Gerencia ve los dos');
  perform test.debe_fallar(format($q$select * from public.tramites_resolver_anulacion(%L, true, null)$q$, current_setting('prueba.tr2')),
    'Gerencia no anula lo que nadie pidió anular', 'no espera tu visto');
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'Se registró por error dos veces')$q$, current_setting('prueba.tr2')),
    'ni pide anular: eso es de quien lo lleva', 'No tienes permiso');
end $$;
reset role;

select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'corto')$q$, current_setting('prueba.tr2')),
    'el pedido lleva su motivo', '10 a 500');
  perform public.tramites_pedir_anulacion(pg_temp.id('tr2'), '  Se registró dos veces el mismo SOAT.  ');
  perform public.tramites_pedir_anulacion(pg_temp.id('tr2'), 'Se registró dos veces el mismo SOAT.');
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'Ahora con otro motivo distinto')$q$, current_setting('prueba.tr2')),
    'un segundo pedido no entra mientras espera', 'ya espera el visto');
  perform test.afirmar(
    (select v.situacion = 'POR_ANULAR' and v.estado = 'EN_TRAMITE' and v.motivo_anulacion = 'Se registró dos veces el mismo SOAT.'
            and v.anulacion_pidio = 'Tita Trámites' and not v.puede_actualizar and not v.puede_pedir_anulacion and not v.puede_resolver_anulacion
       from public.tramites_visibles(pg_temp.id('tr2')) v),
    'queda esperando el visto, y el Tramitador ya no lo toca');
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Rímac', 'POL-779', %L, null, null)$q$,
      current_setting('prueba.tr2'), pg_temp.hoy()),
    'mientras espera no se cambia', 'espera el visto');
  perform test.debe_fallar(format($q$select * from public.tramites_resolver_anulacion(%L, true, null)$q$, current_setting('prueba.tr2')),
    'el Tramitador no se aprueba su propio pedido', 'No tienes permiso');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('ger', 'tr2') = 1 and pg_temp.avisos('adm', 'tr2') = 0 and pg_temp.avisos('tra', 'tr2') = 0,
  'el pedido le llegó a Gerencia, una sola vez, y a nadie más');
select test.debe_fallar(format($q$update public.tramites set asunto = 'cambiado mientras espera' where id = %L$q$, current_setting('prueba.tr2')),
  'mientras espera no se cambia, tampoco por debajo', 'espera el visto');

-- Gerencia no la aprueba: el trámite sigue.
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select v.puede_resolver_anulacion and not v.puede_actualizar from public.tramites_visibles(pg_temp.id('tr2')) v),
    'Gerencia puede responder, y nada más');
  perform test.debe_fallar(format($q$select * from public.tramites_resolver_anulacion(%L, false, 'no')$q$, current_setting('prueba.tr2')),
    'no aprobar pide el motivo', '10 a 500');
  select * into r from public.tramites_resolver_anulacion(pg_temp.id('tr2'), false, 'El otro SOAT es de otra camioneta: este sigue.');
  perform test.afirmar(not r.anulado, 'no la aprueba');
  select * into r from public.tramites_resolver_anulacion(pg_temp.id('tr2'), false, 'El otro SOAT es de otra camioneta: este sigue.');
  perform test.afirmar(not r.anulado, 'la misma respuesta repetida entra igual');
  perform test.debe_fallar(format($q$select * from public.tramites_resolver_anulacion(%L, true, null)$q$, current_setting('prueba.tr2')),
    'respondida, ya no espera', 'no espera tu visto');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('tra', 'tr2') = 1, 'al Tramitador le llegó que no se aprobó, una vez');

select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select v.situacion = 'EN_TRAMITE' and v.anulacion_rechazo = 'Gera Gerencia' and v.anulacion_rechazo_motivo = 'El otro SOAT es de otra camioneta: este sigue.'
            and v.puede_actualizar and v.puede_pedir_anulacion
       from public.tramites_visibles(pg_temp.id('tr2')) v),
    'el trámite sigue como estaba, con la respuesta a la vista, y se puede llevar otra vez');
  perform public.tramites_actualizar(pg_temp.id('tr2'), 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Rímac', 'POL-779', pg_temp.hoy(), pg_temp.hoy() + 5, null);
  -- Lo pide otra vez, con otro motivo.
  perform public.tramites_pedir_anulacion(pg_temp.id('tr2'), 'La aseguradora devolvió la solicitud: se hará con otra.');
  perform test.afirmar(
    (select v.situacion = 'POR_ANULAR' and v.anulacion_rechazada_en is null and v.anulacion_rechazo_motivo is null
       from public.tramites_visibles(pg_temp.id('tr2')) v),
    'un pedido nuevo deja atrás la respuesta del anterior');
end $$;
reset role;

-- Gerencia la aprueba: queda anulado y congelado.
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.tramites_resolver_anulacion(pg_temp.id('tr2'), true, null);
  perform test.afirmar(r.anulado, 'la aprueba');
  select * into r from public.tramites_resolver_anulacion(pg_temp.id('tr2'), true, null);
  perform test.afirmar(r.anulado, 'la misma aprobación repetida entra igual');
  perform test.afirmar(
    (select v.estado = 'ANULADO' and v.situacion = 'ANULADO' and v.anulo = 'Gera Gerencia' and v.anulado_en is not null
            and v.dias_para_limite is null and not v.vencido
            and not v.puede_actualizar and not v.puede_pedir_anulacion and not v.puede_resolver_anulacion
       from public.tramites_visibles(pg_temp.id('tr2')) v),
    'queda anulado, con quién y cuándo, y sin nada que hacer en él');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('tra', 'tr2') = 2, 'al Tramitador le llegó que se anuló');
select test.afirmar((select anulado_por = pg_temp.id('ger') and anulacion_pedida_por = pg_temp.id('tra') from public.tramites where id = pg_temp.id('tr2')),
  'quién pidió y quién anuló quedan sellados');
select test.debe_fallar(format($q$update public.tramites set nota = 'tocado después' where id = %L$q$, current_setting('prueba.tr2')),
  'anulado queda congelado, también por debajo', 'está anulado');
select test.debe_fallar(format('delete from public.tramites where id = %L', current_setting('prueba.tr2')),
  'y no se borra', 'no se borra');

select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Rímac', null, %L, null, null)$q$,
      current_setting('prueba.tr2'), pg_temp.hoy()),
    'el Tramitador no toca uno anulado', 'está anulado');
  perform test.debe_fallar(format($q$select public.tramites_pedir_anulacion(%L, 'Pedirlo otra vez no tiene sentido')$q$, current_setting('prueba.tr2')),
    'ni pide anularlo otra vez', 'ya está anulado');
  -- El tipo con trámites no cambia de ámbito.
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'SOAT', 'Aseguradora', 'UNIDAD', true, '[30, 15, 7]', true)$q$, current_setting('prueba.tipo_soat')),
    'un tipo con trámites no cambia de empresa a unidad', 'ya tiene trámites');
end $$;
reset role;

-- 7. La auditoría del trámite se lee con lo mismo que el trámite -------------------
select test.afirmar((select count(*) from public.audit_log where tabla = 'tramites') > 0, 'los trámites quedan en la auditoría');
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'tramites') = 0,
    'Ventas no lee por la auditoría los trámites de la empresa que la lista le tapa');
end $$;
reset role;
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'tramites') = 0, 'Tesorería tampoco');
end $$;
reset role;

rollback;
