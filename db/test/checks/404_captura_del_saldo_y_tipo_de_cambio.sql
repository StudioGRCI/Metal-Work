-- La captura del saldo con que se abre cada cuenta de la caja (migración
-- 20261020174500) y lo que DKS movió de Tesorería a Contabilidad el mismo día
-- (migración 20261020174600): el tipo de cambio lo registra Contabilidad, que
-- ya no lee los requerimientos, y el puesto se llama «Contabilidad».
--
-- Cada paso con el rol que lo da —Tesorería, Contabilidad, Gerencia; nunca
-- ADMIN— y `set local role authenticated`, con las políticas de Storage
-- encendidas: la subida y la lectura de la captura las decide el bucket.
-- Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['tesoreria:TESORERIA', 'tesoreria2:TESORERIA', 'contabilidad:CONTABILIDAD',
                           'gerente:GERENTE', 'administracion:ADMINISTRACION'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 1) || '.404@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    select v_id, split_part(v, ':', 2), 'Check 404', split_part(v, ':', 1) || '.404@prueba.local', r.id
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || split_part(v, ':', 1), v_id::text, true);
  end loop;
  foreach v in array array['banco', 'chica', 'otro'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.d3', ((now() at time zone 'America/Lima')::date - 3)::text, true);
  perform set_config('prueba.d2', ((now() at time zone 'America/Lima')::date - 2)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

-- Lo que hace el navegador con la sesión de quien sube: guardar el archivo en
-- `{cuenta}/{archivo}`. Corre con el rol de la sesión, así que pasa por la
-- política de subida del bucket.
create or replace function pg_temp.subir(p_cuenta text, p_tipo text default 'image/png', p_extension text default 'png')
returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_cuenta) || '/' || gen_random_uuid() || '.' || p_extension;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('apertura-caja', v_ruta, auth.uid()::text, jsonb_build_object('mimetype', p_tipo, 'size', 48000));
  return v_ruta;
end $$;

-- ============================================ 0. Puertas
do $$
begin
  perform test.afirmar((select not public and file_size_limit = 10485760 from storage.buckets where id = 'apertura-caja'),
                       'el bucket de las capturas es privado y de hasta 10 MB');
  perform test.afirmar(not has_function_privilege('anon', 'public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text)', 'execute')
                       and not has_function_privilege('anon', 'public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean)', 'execute'),
                       'anon no da de alta cuentas, con captura o sin ella');
  perform test.afirmar((select count(*) from pg_proc where proname = 'guardar_caja' and pronamespace = 'public'::regnamespace
                          and pg_get_function_arguments(oid) like '%DEFAULT%') = 0,
                       'ninguna guardar_caja tiene parámetros por omisión: PostgREST no duda entre las dos');

  -- El tipo de cambio es de Contabilidad (y de Administración, que lo conserva).
  perform test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                    where r.codigo = 'TESORERIA' and rp.permiso_codigo = 'tesoreria.tipo_cambio'),
                       'Tesorería ya no tiene tesoreria.tipo_cambio');
  perform test.afirmar((select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                         where r.codigo in ('CONTABILIDAD', 'ADMINISTRACION') and rp.permiso_codigo = 'tesoreria.tipo_cambio') = 2,
                       'Contabilidad y Administración lo tienen');
  perform test.afirmar((select modulo from public.permisos where codigo = 'tesoreria.tipo_cambio') = 'Contabilidad',
                       'el permiso se lista con Contabilidad');
  perform test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                    where r.codigo = 'CONTABILIDAD' and rp.permiso_codigo = 'requerimientos.ver'),
                       'Contabilidad ya no tiene requerimientos.ver');
  perform test.afirmar((select nombre from public.roles where codigo = 'CONTABILIDAD') = 'Contabilidad',
                       'el puesto se llama Contabilidad');
end $$;

-- ============================================ 1. Quién sube la captura
do $$
declare v_ruta text;
begin
  foreach v_ruta in array array['contabilidad', 'gerente', 'administracion'] loop
    perform pg_temp.como(v_ruta);
    set local role authenticated;
    perform test.debe_fallar(format('select pg_temp.subir(%L)', 'banco'), v_ruta || ' no sube capturas del saldo', 'row-level security');
    reset role;
  end loop;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''apertura-caja'', %L, %L, ''{"mimetype":"image/png","size":10}'')',
           pg_temp.id('banco') || '/' || gen_random_uuid() || '.png', current_setting('prueba.tesoreria2')),
    'Tesorería no sube a nombre de otra cuenta', 'row-level security');
  perform set_config('prueba.cap_banco', pg_temp.subir('banco'), true);
  perform set_config('prueba.cap_otra_cuenta', pg_temp.subir('otro'), true);
  perform set_config('prueba.cap_texto', pg_temp.subir('banco', 'text/plain', 'png'), true);
  reset role;

  perform pg_temp.como('tesoreria2');
  set local role authenticated;
  perform set_config('prueba.cap_ajena', pg_temp.subir('banco'), true);
  reset role;
end $$;

-- ============================================ 2. Un banco nuevo no entra sin su captura
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true)',
      pg_temp.id('banco'), current_setting('prueba.d3')),
    'la versión de ocho parámetros no da de alta un banco', 'Adjunta la captura');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true, null)',
      pg_temp.id('banco'), current_setting('prueba.d3')),
    'ni la nueva sin captura', 'Adjunta la captura');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true, %L)',
      pg_temp.id('banco'), current_setting('prueba.d3'), current_setting('prueba.cap_otra_cuenta')),
    'con la captura de otra cuenta tampoco', 'Vuelve a adjuntar');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true, %L)',
      pg_temp.id('banco'), current_setting('prueba.d3'), current_setting('prueba.cap_ajena')),
    'ni con la que subió otra persona', 'no terminó de subir');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true, %L)',
      pg_temp.id('banco'), current_setting('prueba.d3'), current_setting('prueba.cap_texto')),
    'ni con un archivo que no es foto ni PDF', 'no terminó de subir');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 404'', ''BANCO'', ''Interbank'', ''PEN'', 3500, %L, true, %L)',
      pg_temp.id('banco'), current_setting('prueba.d3'), pg_temp.id('banco') || '/' || gen_random_uuid() || '.png'),
    'ni con una que nunca subió', 'no terminó de subir');
  perform test.afirmar(not exists (select 1 from public.cajas where id = pg_temp.id('banco')), 'el banco no quedó a medias');

  perform public.guardar_caja(pg_temp.id('banco'), 'Interbank 404', 'BANCO', 'Interbank', 'PEN', 3500, current_setting('prueba.d3')::date, true,
                              current_setting('prueba.cap_banco'));
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('banco')) = current_setting('prueba.cap_banco'),
                       'con su captura entra, y la cuenta la nombra');

  -- La caja chica en efectivo no tiene aplicativo: la foto es opcional.
  perform public.guardar_caja(pg_temp.id('chica'), 'Caja chica 404', 'EFECTIVO', null, 'PEN', 300, current_setting('prueba.d3')::date, true);
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('chica')) is null,
                       'la caja chica entra sin captura');
  -- Pasarla a banco es darla de alta como banco: sin captura no.
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Caja chica 404'', ''BANCO'', ''BCP'', ''PEN'', 300, %L, true)',
      pg_temp.id('chica'), current_setting('prueba.d3')),
    'la caja chica no pasa a banco sin la captura', 'Adjunta la captura');
  perform test.afirmar((select tipo from public.cajas where id = pg_temp.id('chica')) = 'EFECTIVO', 'y sigue en efectivo');
  reset role;
end $$;

-- ============================================ 3. Quién la ve
do $$
declare v_clave text;
begin
  -- Quien lleva la caja ve la que nombra una cuenta, aunque la haya subido otra persona.
  perform pg_temp.como('tesoreria2');
  set local role authenticated;
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'apertura-caja' and name = current_setting('prueba.cap_banco')) = 1,
                       'otra cuenta de Tesorería ve la captura de la cuenta');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'apertura-caja' and name = current_setting('prueba.cap_otra_cuenta')) = 0,
                       'pero no la suelta que subió otra persona');
  reset role;

  foreach v_clave in array array['contabilidad', 'gerente'] loop
    perform pg_temp.como(v_clave);
    set local role authenticated;
    perform test.afirmar((select count(*) from storage.objects where bucket_id = 'apertura-caja') = 0, v_clave || ' no ve las capturas');
    reset role;
  end loop;
end $$;

-- ============================================ 4. Corregir y cambiar la captura
do $$
declare v_nueva text; v_n integer;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  -- Corregir el nombre sin captura nueva (la pantalla de antes) deja la que tenía.
  perform public.guardar_caja(pg_temp.id('banco'), 'Interbank soles 404', 'BANCO', 'Interbank', 'PEN', 3500, current_setting('prueba.d3')::date, true);
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('banco')) = current_setting('prueba.cap_banco'),
                       'corregir sin captura nueva deja la que tenía');

  -- Sin movimientos se cambia, como el saldo inicial.
  v_nueva := pg_temp.subir('banco', 'application/pdf', 'pdf');
  perform public.guardar_caja(pg_temp.id('banco'), 'Interbank soles 404', 'BANCO', 'Interbank', 'PEN', 3600, current_setting('prueba.d3')::date, true, v_nueva);
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('banco')) = v_nueva,
                       'sin movimientos se cambia la captura, y el saldo con ella');

  -- La que la cuenta nombra no se quita; la que dejó de nombrar, sí, y solo quien la subió.
  delete from storage.objects where bucket_id = 'apertura-caja' and name = v_nueva;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'la captura que la cuenta nombra no se quita');
  reset role;

  perform pg_temp.como('tesoreria2');
  set local role authenticated;
  delete from storage.objects where bucket_id = 'apertura-caja' and name = current_setting('prueba.cap_banco');
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'otra persona no quita la captura vieja de quien la subió');
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  delete from storage.objects where bucket_id = 'apertura-caja' and name = current_setting('prueba.cap_banco');
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'quien la subió quita la captura vieja que ya ninguna cuenta nombra');

  -- Con movimientos queda como respaldo del saldo y ya no cambia.
  perform public.registrar_movimiento_caja(gen_random_uuid(), pg_temp.id('banco'), current_setting('prueba.d2')::date,
                                           'EGRESO', 100, 'Comisión de mantenimiento 404', null, null, null);
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank soles 404'', ''BANCO'', ''Interbank'', ''PEN'', 3600, %L, true, %L)',
      pg_temp.id('banco'), current_setting('prueba.d3'), pg_temp.subir('banco')),
    'con movimientos la captura ya no cambia', 'no se cambia');
  perform public.guardar_caja(pg_temp.id('banco'), 'Interbank soles 404', 'BANCO', 'Interbank', 'PEN', 3600, current_setting('prueba.d3')::date, true, v_nueva);
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('banco')) = v_nueva,
                       'volver a mandar la misma no es cambiarla');

  -- La cuenta de antes, sin captura y con movimientos, la adjunta cuando la tenga.
  perform public.registrar_movimiento_caja(gen_random_uuid(), pg_temp.id('chica'), current_setting('prueba.d2')::date,
                                           'EGRESO', 20, 'Movilidad 404', null, null, null);
  v_nueva := pg_temp.subir('chica', 'image/jpeg', 'jpg');
  perform public.guardar_caja(pg_temp.id('chica'), 'Caja chica 404', 'EFECTIVO', null, 'PEN', 300, current_setting('prueba.d3')::date, true, v_nueva);
  perform test.afirmar((select apertura_ruta from public.cajas where id = pg_temp.id('chica')) = v_nueva,
                       'una cuenta con movimientos y sin captura la adjunta después');
  reset role;
end $$;

-- ============================================ 5. El tipo de cambio lo registra Contabilidad
do $$
declare v_n integer;
begin
  perform pg_temp.como('contabilidad');
  set local role authenticated;
  insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
  values (current_setting('prueba.d2')::date, 3.71, 3.74, 'SUNAT', pg_temp.id('contabilidad'))
  on conflict (fecha) do update set compra = excluded.compra, venta = excluded.venta;
  perform test.afirmar((select venta from public.tipos_de_cambio where fecha = current_setting('prueba.d2')::date) = 3.74,
                       'Contabilidad registra el tipo de cambio');
  -- Y no lee los requerimientos: ni la lista ni sus líneas.
  perform test.afirmar(not public.puede_ver_requerimientos(), 'Contabilidad no lee los requerimientos');
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into public.tipos_de_cambio (fecha, compra, venta, registrado_por) values (%L, 3.70, 3.72, %L)',
           current_setting('prueba.d3'), current_setting('prueba.tesoreria')),
    'Tesorería ya no registra el tipo de cambio', 'row-level security');
  update public.tipos_de_cambio set venta = 3.99 where fecha = current_setting('prueba.d2')::date;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 0, 'ni lo corrige');
  perform test.afirmar((select venta from public.tipos_de_cambio where fecha = current_setting('prueba.d2')::date) = 3.74,
                       'pero lo sigue leyendo para pasar sus dólares a soles');
  reset role;
end $$;

-- ============================================ 6. Lo que entra de Logística, entero
-- Una OC de antes, de la solicitud de materiales de una OT: sin `requerimientos.ver`
-- Contabilidad la sigue viendo con sus líneas y su atención (lo que pide su PDF).
set local session_replication_role = replica;
do $$
declare v_conta uuid := current_setting('prueba.contabilidad')::uuid;
begin
  perform set_config('prueba.ot_antes', gen_random_uuid()::text, true);
  perform set_config('prueba.otm_antes', gen_random_uuid()::text, true);
  perform set_config('prueba.sol_antes', gen_random_uuid()::text, true);
  perform set_config('prueba.sold_antes', gen_random_uuid()::text, true);
  perform set_config('prueba.oc_antes', gen_random_uuid()::text, true);
  insert into public.ordenes_trabajo (id, sede_id, descripcion, abierta_en_taller)
  values (pg_temp.id('ot_antes'), (select id from public.sedes limit 1), 'OT de antes 404', true);
  insert into public.ot_materiales (id, orden_id, material_id, cantidad, area_destino)
  values (pg_temp.id('otm_antes'), pg_temp.id('ot_antes'), (select id from public.materiales limit 1), 5, 'MTZ');
  insert into public.requerimientos_materiales (id, orden_id, area_destino, solicitado_por)
  values (pg_temp.id('sol_antes'), pg_temp.id('ot_antes'), 'MTZ', v_conta);
  insert into public.requerimiento_material_detalles (id, requerimiento_id, ot_material_id, cantidad_solicitada)
  values (pg_temp.id('sold_antes'), pg_temp.id('sol_antes'), pg_temp.id('otm_antes'), 5);
  insert into public.ordenes_compra_materiales (id, proveedor, referencia, creado_por, requerimiento_id)
  values (pg_temp.id('oc_antes'), 'Proveedor 404', 'OC de antes 404', v_conta, pg_temp.id('sol_antes'));
  insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, requerimiento_id, requerimiento_detalle_id)
  values (pg_temp.id('oc_antes'), 5, pg_temp.id('sol_antes'), pg_temp.id('sold_antes'));
end $$;
set local session_replication_role = origin;

do $$
begin
  perform pg_temp.como('contabilidad');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ordenes_compra_materiales where id = pg_temp.id('oc_antes')) = 1,
                       'Contabilidad ve la OC de antes');
  perform test.afirmar((select count(*) from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oc_antes')) = 1,
                       'con sus líneas');
  perform test.afirmar((select count(*) from public.v_atencion_materiales where detalle_id = pg_temp.id('sold_antes')) = 1,
                       'y lo que su PDF lee de la solicitud');
  perform test.afirmar((select count(*) from public.requerimientos) = 0 and not public.puede_ver_requerimientos(),
                       'pero los requerimientos de ahora no los lee');
  reset role;

  -- Administración ve las compras pero no Adquisiciones ni los requerimientos:
  -- la puerta nueva no le abre la solicitud de antes.
  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.afirmar(not public.tiene_permiso('requerimientos.ver') and not public.tiene_permiso('adquisiciones.ver')
                       and (select count(*) from public.requerimientos_materiales where id = pg_temp.id('sol_antes')) = 0,
                       'quien no tiene ninguno de los dos permisos sigue sin leer la solicitud de antes');
  reset role;
end $$;

-- ============================================ 7. El nombre del puesto y de su cuenta
-- La migración otra vez, sobre cuentas de Contabilidad que todavía dicen
-- «Adquisiciones»: solo se quita esa palabra, y nada más cambia.
update public.roles set nombre = 'Contabilidad y Adquisiciones' where codigo = 'CONTABILIDAD';
update public.usuarios set nombres = 'Adquisiciones', apellidos = 'Check 404', cargo = 'Contabilidad y Adquisiciones'
 where id = current_setting('prueba.contabilidad')::uuid;
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'contabilidad2.404@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, cargo)
  select v_id, 'Rosa', 'Pérez / Adquisición', 'contabilidad2.404@prueba.local', r.id, 'Contadora'
    from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad2', v_id::text, true);
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'contabilidad3.404@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, cargo)
  select v_id, 'Ana', 'Check 404', 'contabilidad3.404@prueba.local', r.id, 'Jefa de Adquisiciones'
    from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad3', v_id::text, true);
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'contabilidad4.404@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, cargo)
  select v_id, 'Adquisiciones y Contabilidad', 'Check 404', 'contabilidad4.404@prueba.local', r.id, 'Contabilidad - Adquisiciones'
    from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad4', v_id::text, true);
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'contabilidad5.404@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, cargo)
  select v_id, 'Contabilidad (Adquisiciones)', 'De la Cruz / Adquisiciones', 'contabilidad5.404@prueba.local', r.id, 'Contabilidad de Adquisiciones'
    from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad5', v_id::text, true);
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'contabilidad6.404@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, cargo)
  select v_id, 'ADQUISICIÓN', 'Check 404', 'contabilidad6.404@prueba.local', r.id, 'Contabilidad – Adquisiciones y/o Facturación'
    from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad6', v_id::text, true);
end $$;
update public.usuarios set cargo = 'Jefa de Adquisiciones' where id = current_setting('prueba.tesoreria')::uuid;

\ir ../../../supabase/migrations/20261020174600_contabilidad_lleva_el_tipo_de_cambio.sql

do $$
begin
  perform test.afirmar((select nombre from public.roles where codigo = 'CONTABILIDAD') = 'Contabilidad', 'el puesto vuelve a llamarse Contabilidad');
  perform test.afirmar((select (nombres, apellidos, cargo) = ('Contabilidad', 'Check 404', 'Contabilidad')
                          from public.usuarios where id = pg_temp.id('contabilidad')),
                       'la cuenta que decía Adquisiciones en su nombre y su cargo dice Contabilidad');
  perform test.afirmar((select (nombres, apellidos, cargo) = ('Rosa', 'Pérez', 'Contadora')
                          from public.usuarios where id = pg_temp.id('contabilidad2')),
                       'de otra cuenta del puesto solo sale la palabra, y su cargo no cambia');
  perform test.afirmar((select cargo from public.usuarios where id = pg_temp.id('contabilidad3')) = 'Jefa de Contabilidad',
                       'un cargo que no decía Contabilidad pasa a decirla en lugar de Adquisiciones');
  perform test.afirmar((select (nombres, cargo) = ('Contabilidad', 'Contabilidad') from public.usuarios where id = pg_temp.id('contabilidad4')),
                       'con «y» o «-» delante o detrás, la palabra sale entera con lo que la une');
  perform test.afirmar((select (nombres, apellidos, cargo) = ('Contabilidad', 'De la Cruz', 'Contabilidad')
                          from public.usuarios where id = pg_temp.id('contabilidad5')),
                       'entre paréntesis o tras «de» también sale entera, sin dejar «( )», «de» ni «/» sueltos; el «De» de un apellido se queda');
  perform test.afirmar((select (nombres, cargo) = ('Contabilidad', 'Contabilidad – Facturación')
                          from public.usuarios where id = pg_temp.id('contabilidad6')),
                       'en mayúsculas con tilde, o tras la raya de Word y «y/o», también sale');
  perform test.afirmar((select cargo from public.usuarios where id = pg_temp.id('tesoreria')) = 'Jefa de Adquisiciones',
                       'las cuentas de otros puestos no se tocan');
  perform test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                    where (r.codigo = 'TESORERIA' and rp.permiso_codigo = 'tesoreria.tipo_cambio')
                                       or (r.codigo = 'CONTABILIDAD' and rp.permiso_codigo = 'requerimientos.ver')),
                       'correrla otra vez deja los permisos igual');
end $$;

rollback;
