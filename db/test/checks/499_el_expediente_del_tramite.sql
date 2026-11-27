-- El expediente del trámite (migración 20261126998800; plan «El puesto de
-- Tramitador», entrega 2). Cada paso con su cuenta y `set local role
-- authenticated`: el Tramitador sube los archivos, anota las gestiones, cierra
-- el trámite con su documento final y retira lo que subió por error; Gerencia y
-- Administración leen todo el expediente; Ventas, el de los trámites de una
-- unidad y sin lo retirado; Tesorería, nada. El mismo envío no entra dos veces;
-- nadie borra ni corrige por debajo. El armazón lo pone el administrador.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA499', 'Taller prueba 499') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA499' \gset
select test.crear_usuario('Ada', 'Admin', 'admin499@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Tita', 'Trámites', 'tra499@demo.pe', 'TRAMITADOR', :'sede_id') as tra_id \gset
select test.crear_usuario('Toño', 'Trámites', 'trb499@demo.pe', 'TRAMITADOR', :'sede_id') as trb_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger499@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm499@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ven499@demo.pe', 'VENDEDOR', :'sede_id') as ven_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tes499@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset
select test.crear_usuario('Coma', 'Comercial', 'gco499@demo.pe', 'GERENTE_COMERCIAL', :'sede_id') as gco_id \gset
-- Lee la auditoría (auditoria.ver) y no tiene ningún permiso de trámites: el
-- que prueba que la copia en `audit_log` pide lo mismo que la tabla.
select test.crear_usuario('Susi', 'Supervisión', 'sup499@demo.pe', 'SUPERVISOR_GENERAL', :'sede_id') as sup_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000499', 'QA CLIENTE 499') returning id as cliente_id \gset
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK499_A_26/70', 'QA7-499', 'CAMION') returning id as unidad_a \gset
select id as tipo_tarjeta from public.tramite_tipos where nombre = 'Tarjeta de propiedad' \gset
select id as tipo_soat from public.tramite_tipos where nombre = 'SOAT' \gset

select set_config('prueba.tra', :'tra_id', true), set_config('prueba.trb', :'trb_id', true), set_config('prueba.ger', :'ger_id', true),
       set_config('prueba.adm', :'adm_id', true), set_config('prueba.ven', :'ven_id', true), set_config('prueba.tes', :'tes_id', true),
       set_config('prueba.gco', :'gco_id', true), set_config('prueba.sup', :'sup_id', true),
       set_config('prueba.unidad_a', :'unidad_a', true),
       set_config('prueba.tipo_tarjeta', :'tipo_tarjeta', true), set_config('prueba.tipo_soat', :'tipo_soat', true),
       -- tarjeta: de una unidad, ya presentado. soat: de la empresa, se renueva, por iniciar. viejo: para anular.
       set_config('prueba.tarjeta', gen_random_uuid()::text, true), set_config('prueba.soat', gen_random_uuid()::text, true),
       set_config('prueba.viejo', gen_random_uuid()::text, true),
       set_config('prueba.cargo', gen_random_uuid()::text, true), set_config('prueba.recibo', gen_random_uuid()::text, true),
       set_config('prueba.final', gen_random_uuid()::text, true), set_config('prueba.final2', gen_random_uuid()::text, true),
       set_config('prueba.final_soat', gen_random_uuid()::text, true), set_config('prueba.final_viejo', gen_random_uuid()::text, true),
       set_config('prueba.cargo_soat', gen_random_uuid()::text, true),
       set_config('prueba.gestion', gen_random_uuid()::text, true), set_config('prueba.gestion2', gen_random_uuid()::text, true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.hoy() returns date language sql as $$
  select (now() at time zone 'America/Lima')::date;
$$;
-- Lo que hace el navegador antes de anotar: sube el archivo a la carpeta del
-- trámite, a nombre de quien tiene la sesión. Entra por la política del bucket.
create or replace function pg_temp.subir(p_tramite text, p_ext text default 'pdf') returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_tramite)::text || '/' || gen_random_uuid()::text || '.' || p_ext;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('tramites', v_ruta, public.usuario_actual()::text,
          jsonb_build_object('mimetype', case p_ext when 'pdf' then 'application/pdf' else 'image/jpeg' end, 'size', 2048));
  return v_ruta;
end;
$$;
reset role;

-- 0. Lo que la migración dejó ----------------------------------------------------
select test.afirmar(
  (select not public and file_size_limit = 20971520 from storage.buckets where id = 'tramites'),
  'el bucket de los trámites es privado y admite hasta 20 MB');
select test.afirmar(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.tramite_archivos'::regclass, 'public.tramite_gestiones'::regclass)),
  'las dos tablas del expediente tienen RLS');
select test.afirmar(
  not has_table_privilege('authenticated', 'public.tramite_archivos', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.tramite_gestiones', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.tramite_archivos', 'select')
  and not has_table_privilege('anon', 'public.tramite_gestiones', 'select'),
  'el expediente se escribe solo por sus funciones, y quien no entró no lo lee');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.tramite_archivo_subido(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.tramites_concluir(uuid, uuid, text, text, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.tramites_archivos(uuid)', 'execute'),
  'el ayudante interno no se llama desde fuera y nada del expediente es de quien no entró');

-- 1. El Tramitador registra dos trámites -------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('tarjeta'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta de propiedad de la unidad QA7-499', 'SUNARP', 'T-499', pg_temp.hoy() - 10, pg_temp.hoy() - 1, null);
  perform * from public.tramites_registrar(pg_temp.id('soat'), pg_temp.id('tipo_soat'), null, null,
    'SOAT de la camioneta de reparto', 'Aseguradora', null, null, null, null);
  perform * from public.tramites_registrar(pg_temp.id('viejo'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta registrada dos veces por error', 'SUNARP', null, pg_temp.hoy() - 5, null, null);
  perform test.afirmar((select estado = 'EN_TRAMITE' from public.tramites where id = pg_temp.id('tarjeta'))
                       and (select estado = 'POR_INICIAR' and se_renueva from public.tramites where id = pg_temp.id('soat')),
    'el armazón: una tarjeta ya presentada y un SOAT por iniciar, que se renueva');
  perform test.afirmar((select vencido and puede_concluir and puede_llevar_expediente and archivos = 0
                          from public.tramites_visibles(pg_temp.id('tarjeta'))),
    'la tarjeta está vencida, sin archivos, y quien la lleva puede cerrarla');
  perform test.afirmar((select not puede_concluir and puede_llevar_expediente from public.tramites_visibles(pg_temp.id('soat'))),
    'el que está por iniciar todavía no se puede cerrar');
end $$;
reset role;

-- 2. Quien no lleva trámites no sube ni anota ---------------------------------------
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar($q$select pg_temp.subir('tarjeta')$q$, 'Tesorería no sube al bucket de los trámites', 'row-level security');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, 'x', 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Tesorería no adjunta', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, current_date, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Tesorería no anota gestiones', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, 'x', 'final.pdf', current_date, null)$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Tesorería no cierra trámites', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'Se subió por error al trámite')$q$, gen_random_uuid()),
    'Tesorería no retira archivos', 'No tienes permiso');
end $$;
reset role;

select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar($q$select pg_temp.subir('tarjeta')$q$, 'Gerencia consulta: no sube archivos', 'row-level security');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, current_date, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Gerencia no anota gestiones', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, 'x', 'final.pdf', current_date, null)$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Gerencia no cierra trámites', 'No tienes permiso');
end $$;
reset role;

select test.como_usuario(:'adm_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar($q$select pg_temp.subir('tarjeta')$q$, 'Administración consulta: no sube archivos', 'row-level security');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, 'x', 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'Administración no adjunta', 'No tienes permiso');
end $$;
reset role;

-- 3. El Tramitador sube los archivos del expediente --------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare v_ruta text; v_otra text; v_suelta text; v_n integer;
begin
  perform test.debe_fallar(format($q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('tramites', %L, %L, '{"mimetype":"application/pdf","size":10}')$q$,
      gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.pdf', current_setting('prueba.tra')),
    'no se sube a la carpeta de un trámite que no existe', 'row-level security');
  v_ruta := pg_temp.subir('tarjeta');
  perform set_config('prueba.ruta_cargo', v_ruta, true);
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'tramites' and name = v_ruta) = 1,
    'el Tramitador sube a la carpeta del trámite y ve su archivo mientras está suelto');

  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'DOCUMENTO_FINAL', null, %L, 'tarjeta.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), v_ruta),
    'el documento final no entra como un archivo más', 'al cerrar el trámite');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'FOTO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), v_ruta),
    'la clase es una de las del expediente', 'Elige qué es el archivo');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'OTRO', '  ', %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), v_ruta),
    '«otro documento» dice qué es', 'Cuenta qué documento es');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.soat'), v_ruta),
    'el archivo de la carpeta de un trámite no entra al expediente de otro', 'Vuelve a adjuntar el archivo');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'),
      current_setting('prueba.tarjeta') || '/' || gen_random_uuid()::text || '.pdf'),
    'una ruta que no se subió no entra', 'no terminó de subir');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), gen_random_uuid(), v_ruta),
    'ni a un trámite que no existe', 'no existe');

  perform public.tramites_adjuntar_archivo(pg_temp.id('cargo'), pg_temp.id('tarjeta'), 'CARGO', '  Cargo   de mesa de partes ', v_ruta, ' cargo sunarp.pdf ');
  perform test.afirmar((select clase = 'CARGO' and descripcion = 'Cargo de mesa de partes' and archivo_nombre = 'cargo sunarp.pdf'
                               and archivo_mime = 'application/pdf' and archivo_tamano = 2048 and subido_por = pg_temp.id('tra') and retirado_en is null
                          from public.tramite_archivos where id = pg_temp.id('cargo')),
    'adjunta el cargo, con su descripción sin espacios de más y el tamaño que dice Storage');
  perform public.tramites_adjuntar_archivo(pg_temp.id('cargo'), pg_temp.id('tarjeta'), 'CARGO', 'Cargo de mesa de partes', v_ruta, 'cargo sunarp.pdf');
  perform test.afirmar((select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta')) = 1,
    'el mismo envío repetido no lo adjunta dos veces');
  v_otra := pg_temp.subir('tarjeta');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'otro.pdf')$q$, current_setting('prueba.cargo'), current_setting('prueba.tarjeta'), v_otra),
    'con el mismo id y otra copia (se perdió la respuesta y se volvió a pulsar) dice que ya quedó, y no entra a escondidas', 'la primera vez que lo enviaste');
  perform test.afirmar((select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta')) = 1
                       and (select archivo_ruta = v_ruta from public.tramite_archivos where id = pg_temp.id('cargo')),
    'y el que quedó es el primero');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'RECIBO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), v_ruta),
    'un archivo que ya está en el expediente no entra otra vez', 'ya está en un expediente');

  -- El que quedó en el expediente no lo quita ni su dueño; el suelto, sí.
  delete from storage.objects where bucket_id = 'tramites' and name = v_ruta;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0 and public.tramite_ruta_adjunta(v_ruta), 'el archivo que está en el expediente no se quita de Storage');
  delete from storage.objects where bucket_id = 'tramites' and name = v_otra;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'el que quedó suelto lo quita quien lo subió');

  perform public.tramites_adjuntar_archivo(pg_temp.id('recibo'), pg_temp.id('tarjeta'), 'RECIBO', null, pg_temp.subir('tarjeta', 'jpg'), 'tasa.jpg');
  perform test.afirmar((select archivos = 2 from public.tramites_visibles(pg_temp.id('tarjeta'))), 'la lista cuenta los archivos del expediente');
  perform test.afirmar((select count(*) = 2 and bool_and(puede_retirar) and bool_and(subio = 'Tita Trámites') from public.tramites_archivos(pg_temp.id('tarjeta'))),
    'la ficha los lee con quién los subió, y quien lleva el trámite los puede retirar');
  perform test.debe_fallar(format($q$update public.tramite_archivos set descripcion = 'Otra' where id = %L$q$, current_setting('prueba.cargo')),
    'la tabla no se escribe directo', 'permission denied');
end $$;
reset role;

-- Otra cuenta que lleva trámites no repite el envío de la primera.
select test.como_usuario(:'trb_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', 'Cargo de mesa de partes', %L, 'cargo sunarp.pdf')$q$,
      current_setting('prueba.cargo'), current_setting('prueba.tarjeta'), current_setting('prueba.ruta_cargo')),
    'el id de un archivo que subió otra persona no se da por propio', 'Vuelve a abrir la ventana');
end $$;
reset role;

-- 4. Las gestiones -----------------------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, %L, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), pg_temp.hoy() + 1),
    'una gestión no lleva fecha futura', 'no puede ser futura');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, null, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'la gestión lleva su fecha', 'Pon la fecha');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, %L, 'ok')$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), pg_temp.hoy()),
    'la gestión dice qué se hizo', '5 a 500');
  perform public.tramites_anotar_gestion(pg_temp.id('gestion'), pg_temp.id('tarjeta'), pg_temp.hoy() - 3, '  Se dejó el expediente en mesa de partes.  ');
  perform test.afirmar((select fecha = pg_temp.hoy() - 3 and detalle = 'Se dejó el expediente en mesa de partes.' and registrado_por = pg_temp.id('tra')
                          from public.tramite_gestiones where id = pg_temp.id('gestion')),
    'el Tramitador anota una gestión con su fecha');
  perform public.tramites_anotar_gestion(pg_temp.id('gestion'), pg_temp.id('tarjeta'), pg_temp.hoy() - 3, 'Se dejó el expediente en mesa de partes.');
  perform test.afirmar((select count(*) from public.tramite_gestiones where tramite_id = pg_temp.id('tarjeta')) = 1,
    'el mismo envío repetido no la anota dos veces');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, %L, 'Otra cosa distinta')$q$, current_setting('prueba.gestion'), current_setting('prueba.tarjeta'), pg_temp.hoy()),
    'el reenvío con otra cosa no corrige a escondidas', 'ya quedó anotada la primera vez');
  perform public.tramites_anotar_gestion(pg_temp.id('gestion2'), pg_temp.id('tarjeta'), pg_temp.hoy(), 'Llamaron de SUNARP: el título sale mañana.');
  perform test.afirmar((select array_agg(id order by n) = array[pg_temp.id('gestion2'), pg_temp.id('gestion')]
                          from (select id, row_number() over () as n from public.tramites_gestiones(pg_temp.id('tarjeta'))) g)
                       and (select bool_and(anoto = 'Tita Trámites') from public.tramites_gestiones(pg_temp.id('tarjeta'))),
    'la ficha las lee de la más reciente a la más vieja, con quién las anotó');
  perform test.debe_fallar(format($q$delete from public.tramite_gestiones where id = %L$q$, current_setting('prueba.gestion')),
    'la tabla de gestiones no se escribe directo', 'permission denied');
end $$;
reset role;
do $$ begin
  perform test.debe_fallar(format($q$update public.tramite_gestiones set detalle = 'Corregida por debajo' where id = %L$q$, current_setting('prueba.gestion')),
    'una gestión anotada no se corrige ni por debajo', 'no se corrige ni se borra');
  perform test.debe_fallar(format($q$delete from public.tramite_gestiones where id = %L$q$, current_setting('prueba.gestion')),
    'ni se borra', 'no se corrige ni se borra');
  perform test.debe_fallar(format($q$delete from public.tramite_archivos where id = %L$q$, current_setting('prueba.cargo')),
    'un archivo del expediente no se borra ni por debajo', 'no se borra');
  perform test.debe_fallar(format($q$update public.tramite_archivos set clase = 'OTRO', descripcion = 'Cambiado' where id = %L$q$, current_setting('prueba.cargo')),
    'ni se cambia', 'no se cambia');
  perform test.debe_fallar(format($q$update public.tramites set estado = 'CONCLUIDO', fecha_conclusion = current_date where id = %L$q$, current_setting('prueba.tarjeta')),
    'un trámite no se cierra por debajo sin su documento final', 'se cierra al subir su documento final');
  perform test.debe_fallar(format($q$update public.tramites set fecha_conclusion = current_date where id = %L$q$, current_setting('prueba.tarjeta')),
    'ni se le anota un cierre sin cerrarlo', 'no está concluido');
end $$;

-- 5. Cerrar con el documento final ---------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare v_ruta text; v_visto timestamptz;
begin
  v_ruta := pg_temp.subir('soat');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy(), pg_temp.hoy() + 365),
    'el que está por iniciar no se cierra', 'Por iniciar');
  select actualizado_en into v_visto from public.tramites_visibles(pg_temp.id('soat'));
  perform public.tramites_actualizar(pg_temp.id('soat'), 'EN_TRAMITE', 'SOAT de la camioneta de reparto', 'Aseguradora', null, pg_temp.hoy() - 2, null, null, v_visto);
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, null)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy()),
    'el que se renueva dice hasta cuándo vale su documento', 'hasta cuándo vale');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy(), pg_temp.hoy()),
    'la vigencia termina después de la fecha del documento', 'después de la fecha del documento');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy(), pg_temp.hoy() + 3660),
    'ni pasa de diez años: un año mal tecleado no entra', 'diez años');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy() + 1, pg_temp.hoy() + 365),
    'la fecha del documento no es futura', 'no puede ser futura');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', %L, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy() - 3, pg_temp.hoy() + 365),
    'ni anterior a la fecha en que se presentó', 'no puede ser anterior');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'soat.pdf', null, %L)$q$, current_setting('prueba.final_soat'), current_setting('prueba.soat'), v_ruta, pg_temp.hoy() + 365),
    'el cierre lleva la fecha del documento', 'Pon la fecha');
  perform test.afirmar((select estado = 'EN_TRAMITE' from public.tramites where id = pg_temp.id('soat'))
                       and (select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('soat')) = 0,
    'ningún intento fallido lo cerró ni dejó un archivo en su expediente');
  perform public.tramites_concluir(pg_temp.id('final_soat'), pg_temp.id('soat'), v_ruta, 'soat 2026.pdf', pg_temp.hoy() - 1, pg_temp.hoy() + 364);
  perform test.afirmar((select estado = 'CONCLUIDO' and fecha_conclusion = pg_temp.hoy() - 1 and vigente_hasta = pg_temp.hoy() + 364
                               and concluido_por = pg_temp.id('tra') and concluido_en is not null
                          from public.tramites where id = pg_temp.id('soat'))
                       and (select clase = 'DOCUMENTO_FINAL' and archivo_nombre = 'soat 2026.pdf' from public.tramite_archivos where id = pg_temp.id('final_soat')),
    'el SOAT queda concluido al subir su documento, con su vigencia y quién lo cerró');

  -- La tarjeta, que no se renueva.
  v_ruta := pg_temp.subir('tarjeta');
  perform set_config('prueba.ruta_final', v_ruta, true);
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'tarjeta.pdf', %L, %L)$q$, current_setting('prueba.final'), current_setting('prueba.tarjeta'), v_ruta, pg_temp.hoy(), pg_temp.hoy() + 365),
    'el que no se renueva no lleva vigencia', 'no se renueva');
  perform public.tramites_concluir(pg_temp.id('final'), pg_temp.id('tarjeta'), v_ruta, 'tarjeta.pdf', pg_temp.hoy(), null);
  perform public.tramites_concluir(pg_temp.id('final'), pg_temp.id('tarjeta'), v_ruta, 'tarjeta.pdf', pg_temp.hoy(), null);
  perform test.afirmar((select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta') and clase = 'DOCUMENTO_FINAL') = 1,
    'el cierre repetido no sube dos documentos finales');
  perform test.afirmar((select situacion = 'CONCLUIDO' and not vencido and dias_para_limite is null and not puede_actualizar and not puede_concluir
                               and puede_llevar_expediente and puede_pedir_anulacion and concluyo = 'Tita Trámites' and archivos = 3
                          from public.tramites_visibles(pg_temp.id('tarjeta'))),
    'concluido ya no vence ni se actualiza, y su expediente sigue abierto');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'tarjeta.pdf', %L, null)$q$, current_setting('prueba.final'), current_setting('prueba.tarjeta'), pg_temp.subir('tarjeta'), pg_temp.hoy()),
    'el mismo cierre con otra copia del archivo dice que ya quedó', 'la primera vez que lo enviaste');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'otra.pdf', %L, null)$q$, gen_random_uuid(), current_setting('prueba.tarjeta'), pg_temp.subir('tarjeta'), pg_temp.hoy()),
    'un trámite concluido no se cierra otra vez', 'ya está concluido');
  select actualizado_en into v_visto from public.tramites_visibles(pg_temp.id('tarjeta'));
  perform test.debe_fallar(format($q$select public.tramites_actualizar(%L, 'EN_TRAMITE', 'Tarjeta de propiedad de la unidad QA7-499', 'SUNARP', 'T-499', %L, null, null, %L)$q$,
      current_setting('prueba.tarjeta'), pg_temp.hoy() - 10, v_visto),
    'uno concluido no se cambia con «Actualizar»', 'está concluido');

  -- Lo que sí recibe un trámite concluido.
  perform public.tramites_adjuntar_archivo(gen_random_uuid(), pg_temp.id('tarjeta'), 'OTRO', 'Cargo de entrega al cliente', pg_temp.subir('tarjeta'), 'entrega.pdf');
  perform public.tramites_anotar_gestion(gen_random_uuid(), pg_temp.id('tarjeta'), pg_temp.hoy(), 'Se entregó la tarjeta al cliente.');
  perform test.afirmar((select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta')) = 4
                       and (select count(*) from public.tramite_gestiones where tramite_id = pg_temp.id('tarjeta')) = 3,
    'uno concluido sigue recibiendo archivos y gestiones');
end $$;
reset role;
do $$ begin
  perform test.debe_fallar(format($q$update public.tramites set asunto = 'Cambiado por debajo' where id = %L$q$, current_setting('prueba.tarjeta')),
    'uno concluido no se corrige ni por debajo', 'está concluido');
  perform test.debe_fallar(format($q$update public.tramites set estado = 'OBSERVADO', nota = 'Vuelve observado' where id = %L$q$, current_setting('prueba.tarjeta')),
    'ni se reabre por debajo a otro estado', 'vuelve a «En trámite»');
  perform test.debe_fallar(format($q$update public.tramites set estado = 'EN_TRAMITE' where id = %L$q$, current_setting('prueba.tarjeta')),
    'ni se reabre por debajo con su documento final en pie', 'se reabre solo al retirar su documento final');
end $$;

-- 6. Retirar lo que se subió por error ---------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare v_reabrio boolean;
begin
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'corto')$q$, current_setting('prueba.recibo')),
    'retirar pide su motivo', '10 a 500');
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'Era el recibo de otro trámite')$q$, gen_random_uuid()),
    'un archivo que no existe no se retira', 'no existe');
  v_reabrio := public.tramites_retirar_archivo(pg_temp.id('recibo'), '  Era el recibo de otro trámite. ');
  perform test.afirmar(not v_reabrio and (select retirado_por = pg_temp.id('tra') and retirado_en is not null and retiro_motivo = 'Era el recibo de otro trámite.'
                                            from public.tramite_archivos where id = pg_temp.id('recibo'))
                       and (select estado = 'CONCLUIDO' from public.tramites where id = pg_temp.id('tarjeta')),
    'retira el recibo, con su motivo, quién y cuándo; el trámite sigue concluido');
  perform test.afirmar(not public.tramites_retirar_archivo(pg_temp.id('recibo'), 'Era el recibo de otro trámite.'),
    'el mismo retiro repetido no falla ni cambia nada');
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'Ahora con otro motivo distinto')$q$, current_setting('prueba.recibo')),
    'uno ya retirado no se retira otra vez', 'ya estaba retirado');
  perform test.afirmar((select archivos = 3 from public.tramites_visibles(pg_temp.id('tarjeta')))
                       and (select count(*) = 4 and count(*) filter (where retirado_en is not null and retiro = 'Tita Trámites' and not puede_retirar) = 1
                              from public.tramites_archivos(pg_temp.id('tarjeta'))),
    'el retirado deja de contarse y queda a la vista de quien lleva los trámites');

  v_reabrio := public.tramites_retirar_archivo(pg_temp.id('final'), 'Se subió la tarjeta de otra unidad.');
  perform test.afirmar(v_reabrio and (select estado = 'EN_TRAMITE' and concluido_en is null and concluido_por is null and fecha_conclusion is null
                                        from public.tramites where id = pg_temp.id('tarjeta')),
    'retirar el documento final reabre el trámite, que vuelve a «En trámite»');
  perform test.afirmar(public.tramites_retirar_archivo(pg_temp.id('final'), 'Se subió la tarjeta de otra unidad.')
                       and (select estado = 'EN_TRAMITE' from public.tramites where id = pg_temp.id('tarjeta')),
    'el mismo retiro repetido dice otra vez que lo reabrió, sin cambiar nada');
  perform test.afirmar((select vencido and puede_actualizar and puede_concluir from public.tramites_visibles(pg_temp.id('tarjeta'))),
    'reabierto, vuelve a contar su plazo');
  perform public.tramites_concluir(pg_temp.id('final2'), pg_temp.id('tarjeta'), pg_temp.subir('tarjeta'), 'tarjeta buena.pdf', pg_temp.hoy(), null);
  perform test.afirmar((select estado = 'CONCLUIDO' from public.tramites where id = pg_temp.id('tarjeta'))
                       and (select count(*) filter (where retirado_en is null) = 1 and count(*) = 2
                              from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta') and clase = 'DOCUMENTO_FINAL'),
    'y se cierra otra vez con el documento correcto: uno en pie, el otro retirado');
  perform test.afirmar(not public.tramites_retirar_archivo(pg_temp.id('final'), 'Se subió la tarjeta de otra unidad.')
                       and (select estado = 'CONCLUIDO' from public.tramites where id = pg_temp.id('tarjeta')),
    'el retiro repetido desde una pestaña vieja, ya cerrado con el otro, no dice que lo reabrió ni lo reabre');

  -- El SOAT: al reabrirlo se va también su vigencia.
  perform public.tramites_retirar_archivo(pg_temp.id('final_soat'), 'La póliza es de otra camioneta.');
  perform test.afirmar((select estado = 'EN_TRAMITE' and vigente_hasta is null from public.tramites where id = pg_temp.id('soat')),
    'al reabrir el que se renueva se quita su vigencia');
  perform public.tramites_adjuntar_archivo(pg_temp.id('cargo_soat'), pg_temp.id('soat'), 'CARGO', null, pg_temp.subir('soat'), 'cargo soat.pdf');
end $$;
reset role;

-- 7. Quién lee el expediente -------------------------------------------------------------------
select test.como_usuario(:'adm_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) = 5 and count(*) filter (where retirado_en is not null) = 2 and not bool_or(puede_retirar)
                          from public.tramites_archivos(pg_temp.id('tarjeta')))
                       and (select count(*) = 3 from public.tramites_gestiones(pg_temp.id('tarjeta')))
                       and (select count(*) = 2 from public.tramites_archivos(pg_temp.id('soat'))),
    'Administración lee todo el expediente, también lo retirado, y no retira nada');
  perform test.afirmar((select count(*) from public.tramite_archivos where tramite_id in (pg_temp.id('tarjeta'), pg_temp.id('soat'))) = 7
                       and (select count(*) from public.tramite_gestiones where tramite_id = pg_temp.id('tarjeta')) = 3,
    'y lo mismo por la tabla');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'tramites' and name = current_setting('prueba.ruta_cargo')) = 1,
    'y abre el archivo que está en el expediente');
end $$;
reset role;

select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) = 3 and count(*) filter (where retirado_en is not null) = 0 and not bool_or(puede_retirar)
                          from public.tramites_archivos(pg_temp.id('tarjeta')))
                       and (select count(*) = 3 from public.tramites_gestiones(pg_temp.id('tarjeta'))),
    'Ventas lee el expediente del trámite de la unidad, sin lo retirado');
  perform test.afirmar((select count(*) from public.tramites_archivos(pg_temp.id('soat'))) = 0
                       and (select count(*) from public.tramites_gestiones(pg_temp.id('soat'))) = 0,
    'y no el del trámite de la empresa');
  perform test.afirmar((select count(*) = 3 and bool_and(retirado_en is null) from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta'))
                       and (select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('soat')) = 0
                       and (select count(*) from public.tramite_archivos where retirado_en is not null) = 0
                       and (select count(*) from public.tramite_gestiones where tramite_id = pg_temp.id('soat')) = 0,
    'tampoco por la tabla');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'tramites' and name like current_setting('prueba.tarjeta') || '/%') = 3
                       and (select count(*) from storage.objects where bucket_id = 'tramites' and name like current_setting('prueba.soat') || '/%') = 0,
    'ni en Storage: solo los archivos en pie del trámite de la unidad');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'tramites' and name = current_setting('prueba.ruta_final')) = 0,
    'el documento final retirado ya no lo abre Ventas');
  perform test.afirmar((select count(*) from public.audit_log where tabla in ('tramites', 'tramite_archivos', 'tramite_gestiones')) = 0,
    'ni lee su copia en la auditoría');
  perform test.debe_fallar($q$select pg_temp.subir('tarjeta')$q$, 'Ventas consulta: no sube archivos', 'row-level security');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, 'x', 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'ni adjunta', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, current_date, 'Se llamó al cliente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'ni anota gestiones', 'No tienes permiso');
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'Lo quiere retirar Ventas')$q$, current_setting('prueba.cargo')),
    'ni retira', 'No tienes permiso');
  perform test.debe_fallar(format($q$insert into public.tramite_gestiones (tramite_id, fecha, detalle, registrado_por) values (%L, current_date, 'Por la tabla', %L)$q$,
      current_setting('prueba.tarjeta'), current_setting('prueba.ven')),
    'ni escribe por la tabla', 'permission denied');
end $$;
reset role;

select test.como_usuario(:'gco_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) = 3 and count(*) filter (where retirado_en is not null) = 0 and not bool_or(puede_retirar)
                          from public.tramites_archivos(pg_temp.id('tarjeta')))
                       and (select count(*) from public.tramites_archivos(pg_temp.id('soat'))) = 0
                       and (select count(*) from public.tramite_archivos where tramite_id = pg_temp.id('soat') or retirado_en is not null) = 0
                       and (select count(*) from storage.objects where bucket_id = 'tramites' and name like current_setting('prueba.tarjeta') || '/%') = 3
                       and (select count(*) from storage.objects where bucket_id = 'tramites' and name like current_setting('prueba.soat') || '/%') = 0,
    'Gerencia Comercial lee lo mismo que Ventas: el de la unidad, sin lo retirado ni lo de la empresa');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, current_date, 'Se llamó al cliente')$q$, gen_random_uuid(), current_setting('prueba.tarjeta')),
    'y no anota gestiones', 'No tienes permiso');
end $$;
reset role;

-- La copia en la auditoría pide lo mismo que la tabla: quien lee la auditoría
-- sin ver los trámites no los lee por ahí; Gerencia, que ve todos, sí.
select test.como_usuario(:'sup_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(public.tiene_permiso('auditoria.ver') and not public.tramites_ve_todos(),
    'Supervisión General lee la auditoría y no ve los trámites');
  perform test.afirmar((select count(*) from public.audit_log) > 0
                       and (select count(*) from public.audit_log where tabla in ('tramites', 'tramite_archivos', 'tramite_gestiones')) = 0,
    'y por la auditoría no lee los trámites, sus archivos ni sus gestiones');
  perform test.afirmar((select count(*) from public.tramite_archivos) = 0 and (select count(*) from public.tramite_gestiones) = 0
                       and (select count(*) from storage.objects where bucket_id = 'tramites') = 0,
    'ni por la tabla ni por Storage');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'tramite_archivos' and registro_id in (select id from public.tramite_archivos where tramite_id = pg_temp.id('tarjeta'))) > 0
                       and (select count(*) from public.audit_log where tabla = 'tramite_gestiones') > 0
                       and (select count(*) from public.audit_log where tabla = 'tramites') > 0,
    'Gerencia, que ve todos los trámites, sí lee su auditoría');
end $$;
reset role;

select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramites_archivos(pg_temp.id('tarjeta'))) = 0
                       and (select count(*) from public.tramites_gestiones(pg_temp.id('tarjeta'))) = 0
                       and (select count(*) from public.tramite_archivos) = 0 and (select count(*) from public.tramite_gestiones) = 0
                       and (select count(*) from storage.objects where bucket_id = 'tramites') = 0,
    'Tesorería no lee nada del expediente: ni la ficha, ni la tabla, ni Storage');
  perform test.afirmar((select count(*) from public.audit_log where tabla in ('tramite_archivos', 'tramite_gestiones')) = 0,
    'ni por la auditoría');
end $$;
reset role;

-- 8. Mientras espera el visto de Gerencia, y anulado ----------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$
declare v_ruta text;
begin
  v_ruta := pg_temp.subir('viejo');
  perform set_config('prueba.ruta_viejo', v_ruta, true);
  perform public.tramites_pedir_anulacion(pg_temp.id('viejo'), 'Es el mismo trámite que la tarjeta de arriba.');
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.viejo'), v_ruta),
    'mientras espera el visto de Gerencia no recibe archivos', 'espera el visto de Gerencia');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, %L, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.viejo'), pg_temp.hoy()),
    'ni gestiones', 'espera el visto de Gerencia');
  perform test.debe_fallar(format($q$select public.tramites_concluir(%L, %L, %L, 'final.pdf', %L, null)$q$, current_setting('prueba.final_viejo'), current_setting('prueba.viejo'), v_ruta, pg_temp.hoy()),
    'ni se cierra', 'espera el visto de Gerencia');
  perform test.afirmar((select not puede_llevar_expediente and not puede_concluir from public.tramites_visibles(pg_temp.id('viejo'))),
    'y la ficha no lo ofrece');

  -- Uno concluido también puede pedirse anular: mientras espera, su expediente no se toca.
  perform public.tramites_pedir_anulacion(pg_temp.id('tarjeta'), 'Se registró para la unidad equivocada.');
  perform test.debe_fallar(format($q$select public.tramites_retirar_archivo(%L, 'Se quiere retirar mientras espera')$q$, current_setting('prueba.final2')),
    'ni se retira su documento final mientras espera', 'espera el visto de Gerencia');
  perform test.afirmar((select count(*) = 5 and not bool_or(puede_retirar) from public.tramites_archivos(pg_temp.id('tarjeta'))),
    'la ficha tampoco ofrece retirar');
end $$;
reset role;

select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_resolver_anulacion(pg_temp.id('tarjeta'), false, 'El trámite está bien: es de esa unidad.',
    (select anulacion_pedida_en from public.tramites_visibles(pg_temp.id('tarjeta'))));
  perform test.afirmar((select estado = 'CONCLUIDO' and concluido_en is not null from public.tramites where id = pg_temp.id('tarjeta')),
    'Gerencia no aprueba la anulación de uno concluido: sigue concluido');
  perform * from public.tramites_resolver_anulacion(pg_temp.id('viejo'), true, null,
    (select anulacion_pedida_en from public.tramites_visibles(pg_temp.id('viejo'))));
  perform test.afirmar((select estado = 'ANULADO' from public.tramites where id = pg_temp.id('viejo')), 'y aprueba la del repetido');
  perform test.afirmar((select count(*) = 5 from public.tramites_archivos(pg_temp.id('tarjeta')))
                       and (select count(*) from storage.objects where bucket_id = 'tramites' and name = current_setting('prueba.ruta_final')) = 1,
    'Gerencia lee todo el expediente y abre también el archivo retirado');
end $$;
reset role;

select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select public.tramites_adjuntar_archivo(%L, %L, 'CARGO', null, %L, 'cargo.pdf')$q$, gen_random_uuid(), current_setting('prueba.viejo'), current_setting('prueba.ruta_viejo')),
    'un trámite anulado no recibe archivos', 'está anulado');
  perform test.debe_fallar(format($q$select public.tramites_anotar_gestion(%L, %L, %L, 'Se presentó el expediente')$q$, gen_random_uuid(), current_setting('prueba.viejo'), pg_temp.hoy()),
    'ni gestiones', 'está anulado');
  perform test.debe_fallar($q$select pg_temp.subir('viejo')$q$, 'ni se sube a su carpeta', 'row-level security');
  -- Tras el «no» de Gerencia, el concluido se puede anular de verdad y conserva su cierre.
  perform public.tramites_pedir_anulacion(pg_temp.id('tarjeta'), 'Ahora sí: el cliente desistió de la compra.');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_resolver_anulacion(pg_temp.id('tarjeta'), true, null,
    (select anulacion_pedida_en from public.tramites_visibles(pg_temp.id('tarjeta'))));
  perform test.afirmar((select estado = 'ANULADO' and concluido_en is not null and fecha_conclusion is not null from public.tramites where id = pg_temp.id('tarjeta')),
    'uno concluido que se anula conserva cuándo se había cerrado');
end $$;
reset role;
do $$ begin
  perform test.debe_fallar(format($q$update public.tramite_archivos set retiro_motivo = 'Retirado después de anular' where id = %L$q$, current_setting('prueba.final2')),
    'el expediente de un trámite anulado queda como evidencia', 'está anulado');
end $$;

rollback;
