-- El recojo con su foto y el que no se pudo (migración 20261125500000, Plan 5
-- «Conductor de Logística», entrega 5.2). Con la cuenta de cada puesto —nunca
-- ADMIN— y `set local role authenticated`:
--
--   1. El conductor sube sus fotos a su carpeta de fotos-recojo y marca «Ya la
--      recogí» con ellas; Ventas no sube, y nadie sube a la carpeta de otro.
--      Sin fotos también entra: son opcionales.
--   2. El mismo envío otra vez devuelve lo de la primera vez, sin duplicar; con
--      otras fotos dice que ya quedó. Una foto que no subió, la de otra cuenta
--      o la cuarta no entran.
--   3. Solo lo programado: la compra que Logística no puso en la lista no se
--      marca, y la que salió a recoger una cuenta no la marca otra.
--   4. La foto anotada la ven el conductor y Logística, no Almacén; la suelta
--      solo su dueño, que la puede quitar. La anotada no la quita nadie, ni se
--      cambia su fila.
--   5. «No se pudo recoger» pide motivo; devuelve la compra a «Por programar»
--      (sin la hora de la salida, que queda en el intento), la saca de la lista
--      y renumera las demás, y avisa a Logística por la campana, una vez. El
--      mismo envío repetido no entra dos veces; con otro motivo lo dice. Vuelta
--      a programar, sale otra vez y otro intento lleva otro id.
--   6. El conductor no lee las tablas nuevas: las ve por sus funciones, sin
--      precios. Logística las lee; Almacén, ni tablas ni funciones.
--   7. La puerta nueva del disparador se abre solo desde la función: a mano,
--      la compra en recojo no vuelve a pendiente.
--   8. Gerencia, que lee la auditoría, no ve por ella los motivos ni las fotos.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Storage, como en Supabase: con RLS y con lo que `authenticated` puede hacer ahí.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_clave text;
begin
  foreach v in array array['COMPRADOR:LOG:comprador', 'GERENTE:GER:gerente', 'CONDUCTOR:LOG:conductor',
                           'CONDUCTOR:LOG:conductor2', 'ALMACENERO:ALM:almacenero', 'VENDEDOR:VEN:vendedor'] loop
    v_id := gen_random_uuid();
    v_clave := split_part(v, ':', 3);
    insert into auth.users (id, email) values (v_id, v_clave || '.459@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, initcap(v_clave), 'Check 459', v_clave || '.459@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    if not found then raise exception 'Falta el rol %', split_part(v, ':', 1); end if;
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK459-PLA', 'Plancha LAF 2 mm 4x8 (459)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20600000340', 'Proveedor de prueba 459', 'Av. Argentina 459, Lima', '999 000 459')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['oc1', 'oc2', 'oc3', 'oc4', 'oc5', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'suelta', 'ajena',
                           'intento1', 'intento2', 'intento3', 'intento4'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.oc(p_oc text) returns uuid language sql as $$ select current_setting('prueba.' || p_oc)::uuid $$;
-- La ruta de una foto: {cuenta}/{oc}/{foto}.jpg
create or replace function pg_temp.ruta(p_dueno text, p_oc text, p_foto text) returns text language sql as $$
  select current_setting('prueba.' || p_dueno) || '/' || current_setting('prueba.' || p_oc) || '/' || current_setting('prueba.' || p_foto) || '.jpg';
$$;
-- Lo que hace Storage al subir, con la sesión puesta: pasa por la política de subir.
create or replace function pg_temp.subir(p_dueno text, p_oc text, p_foto text, p_carpeta text default null) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('fotos-recojo', pg_temp.ruta(coalesce(p_carpeta, p_dueno), p_oc, p_foto),
          current_setting('prueba.' || p_dueno)::uuid, current_setting('prueba.' || p_dueno),
          jsonb_build_object('mimetype', 'image/jpeg', 'size', 284113));
$$;
create or replace function pg_temp.fotos(variadic p_rutas text[]) returns jsonb language sql as $$ select to_jsonb(p_rutas) $$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid and titulo like p_titulo || '%';
$$;
create or replace function pg_temp.compra(p_oc text) returns public.ordenes_compra_materiales language sql as $$
  select c from public.ordenes_compra_materiales c where c.id = pg_temp.oc(p_oc);
$$;

-- ============================================ 0. Cinco OC aprobadas; Logística programa cuatro
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(pg_temp.oc(o), current_setting('prueba.proveedor')::uuid, 'COT-459-' || o,
         'Reposición del almacén, check 459',
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA')
  from unnest(array['oc1', 'oc2', 'oc3', 'oc4', 'oc5']) o;
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.oc(o)) from unnest(array['oc1', 'oc2', 'oc3', 'oc4', 'oc5']) o;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(pg_temp.oc('oc1'), 10, null);
select public.programar_recojo(pg_temp.oc('oc2'), 11, null);
select public.programar_recojo(pg_temp.oc('oc3'), 12, null);
select public.programar_recojo(pg_temp.oc('oc4'), 13, null);
reset role;
select test.afirmar(
  (select count(*) from public.programacion_recojo where posicion is not null
     and orden_compra_id in (pg_temp.oc('oc1'), pg_temp.oc('oc2'), pg_temp.oc('oc3'), pg_temp.oc('oc4'))) = 4
  and (pg_temp.compra('oc5')).recojo = 'POR_RECOGER',
  'cuatro en la lista del conductor y la quinta aprobada sin programar');

-- ============================================ 1. El conductor sube sus fotos; nadie más
select pg_temp.como('conductor');
set local role authenticated;
select pg_temp.subir('conductor', 'oc1', 'f1');
select pg_temp.subir('conductor', 'oc1', 'f2');
select pg_temp.subir('conductor', 'oc1', 'f3');
select pg_temp.subir('conductor', 'oc1', 'suelta');
select test.debe_fallar($q$select pg_temp.subir('conductor', 'oc1', 'ajena', 'conductor2')$q$,
  'el conductor no sube a la carpeta de otra cuenta', 'row-level security');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.subir('vendedor', 'oc1', 'ajena')$q$, 'Ventas no sube fotos de recojo', 'row-level security');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), '[]'::jsonb)$q$, 'ni marca recogida', 'compras.recojo');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento4'), pg_temp.oc('oc1'), 'El proveedor estaba cerrado')$q$,
  'ni avisa que no se pudo', 'compras.recojo');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.subir('comprador', 'oc1', 'ajena')$q$, 'Logística no sube fotos de recojo', 'row-level security');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), '[]'::jsonb)$q$,
  'Logística no marca recogida por el conductor', 'compras.recojo');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento4'), pg_temp.oc('oc1'), 'El proveedor estaba cerrado')$q$,
  'ni avisa por él que no se pudo', 'compras.recojo');
reset role;

-- ============================================ 2. «Ya la recogí» con fotos, y el mismo envío otra vez
select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar(
  $q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), pg_temp.fotos(pg_temp.ruta('conductor', 'oc1', 'f4')))$q$,
  'una foto que no llegó a Storage no entra', 'no terminó de subir');
select test.debe_fallar(
  $q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), pg_temp.fotos(pg_temp.ruta('conductor2', 'oc1', 'f1')))$q$,
  'ni la ruta de la carpeta de otra cuenta', 'Vuelve a poner las fotos');
select test.debe_fallar(
  $q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), pg_temp.fotos(pg_temp.ruta('conductor', 'oc2', 'f1')))$q$,
  'ni la foto de otra compra', 'Vuelve a poner las fotos');
select test.debe_fallar(
  $q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), pg_temp.fotos(
       pg_temp.ruta('conductor', 'oc1', 'f1'), pg_temp.ruta('conductor', 'oc1', 'f2'),
       pg_temp.ruta('conductor', 'oc1', 'f3'), pg_temp.ruta('conductor', 'oc1', 'suelta')))$q$,
  'ni la cuarta foto', 'hasta 3 fotos');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), '{"a": 1}'::jsonb)$q$,
  'ni algo que no es una lista de fotos', 'Vuelve a poner las fotos');
reset role;
select test.afirmar((pg_temp.compra('oc1')).recojo = 'POR_RECOGER' and (select count(*) from public.recojo_fotos) = 0,
  'tras los rechazos la compra sigue pendiente y no hay ninguna foto anotada');

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'),
    pg_temp.fotos(pg_temp.ruta('conductor', 'oc1', 'f1'), pg_temp.ruta('conductor', 'oc1', 'f2'))) = pg_temp.oc('oc1'),
  'el conductor marca «Ya la recogí» con dos fotos');
select test.afirmar(
  public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'),
    pg_temp.fotos(pg_temp.ruta('conductor', 'oc1', 'f1'), pg_temp.ruta('conductor', 'oc1', 'f2'))) = pg_temp.oc('oc1'),
  'el mismo envío otra vez devuelve lo de la primera vez');
select test.debe_fallar(
  $q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), pg_temp.fotos(pg_temp.ruta('conductor', 'oc1', 'f3')))$q$,
  'con otra foto dice que ya quedó, y no la guarda', 'la primera vez que lo enviaste');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc1'), '[]'::jsonb)$q$,
  'y sin fotos, también: no es el mismo envío', 'la primera vez que lo enviaste');
-- Sin fotos: son opcionales.
select test.afirmar(public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc2'), '[]'::jsonb) = pg_temp.oc('oc2'),
  'sin fotos también entra: son opcionales');
select test.afirmar(public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc2'), null) = pg_temp.oc('oc2'),
  'y el segundo toque sin fotos devuelve lo mismo');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc5'), '[]'::jsonb)$q$,
  'la que Logística no programó no se marca recogida', 'todavía no programa');
select test.afirmar(
  (select count(*) from public.recojo_fotos_en_gestion() f where f.orden_compra_id = pg_temp.oc('oc1')) = 2
  and (select array_agg(f.ruta order by f.orden) from public.recojo_fotos_en_gestion() f where f.orden_compra_id = pg_temp.oc('oc1'))
      = array[pg_temp.ruta('conductor', 'oc1', 'f1'), pg_temp.ruta('conductor', 'oc1', 'f2')],
  'el conductor ve sus dos fotos por la función, en su orden');
select test.afirmar((select count(*) from public.recojo_fotos) = 0 and (select count(*) from public.recojos_no_logrados) = 0,
  'y no lee las tablas: sigue sin acceso a ellas');
reset role;
select test.afirmar(
  (pg_temp.compra('oc1')).recojo = 'RECOGIDO' and (pg_temp.compra('oc1')).recogido_por = current_setting('prueba.conductor')::uuid
  and (select count(*) from public.recojo_fotos where orden_compra_id = pg_temp.oc('oc1')) = 2
  and (select bool_and(subida_por = current_setting('prueba.conductor')::uuid and tamano_bytes = 284113 and mime_type = 'image/jpeg')
         from public.recojo_fotos where orden_compra_id = pg_temp.oc('oc1'))
  and (pg_temp.compra('oc2')).recojo = 'RECOGIDO'
  and (select count(*) from public.recojo_fotos where orden_compra_id = pg_temp.oc('oc2')) = 0,
  'la base tiene la primera recogida con sus dos fotos (tipo y tamaño de Storage) y la segunda recogida sin fotos');

-- ============================================ 3. Quién ve la foto y quién la quita
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  (select count(*) from storage.objects where bucket_id = 'fotos-recojo') = 2
  and (select count(*) from public.recojo_fotos) = 2
  and (select count(*) from public.recojo_fotos_en_gestion()) = 2,
  'Logística ve las dos fotos anotadas (no las sueltas del conductor), en Storage, en la tabla y por la función');
reset role;
select pg_temp.como('conductor2');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-recojo') = 2,
  'otro conductor ve las anotadas y no las sueltas de su compañero');
with q as (delete from storage.objects where bucket_id = 'fotos-recojo' returning 1)
select test.afirmar((select count(*) from q) = 0, 'y no quita ninguna');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-recojo') = 0, 'Almacén no ve las fotos del recojo');
select test.afirmar((select count(*) from public.recojo_fotos) = 0 and (select count(*) from public.recojos_no_logrados) = 0, 'ni lee las tablas');
select test.debe_fallar($q$select count(*) from public.recojo_fotos_en_gestion()$q$, 'ni las funciones de la gestión', 'No tienes permiso');
select test.debe_fallar($q$select count(*) from public.recojos_no_logrados_en_gestion()$q$, 'ninguna de las dos', 'No tienes permiso');
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-recojo') = 4,
  'el conductor ve las suyas: las dos anotadas y las dos sueltas');
with q as (delete from storage.objects where bucket_id = 'fotos-recojo' and name = pg_temp.ruta('conductor', 'oc1', 'suelta') returning 1)
select test.afirmar((select count(*) from q) = 1, 'quita su foto suelta');
with q as (delete from storage.objects where bucket_id = 'fotos-recojo' and name = pg_temp.ruta('conductor', 'oc1', 'f1') returning 1)
select test.afirmar((select count(*) from q) = 0, 'y la anotada no la quita ni él');
reset role;
select test.debe_fallar($q$update public.recojo_fotos set orden = 3 where orden = 1$q$, 'la fila de la foto no se cambia, ni sin sesión', 'queda como evidencia');
select test.debe_fallar($q$delete from public.recojo_fotos$q$, 'ni se borra', 'queda como evidencia');

-- ============================================ 4. «No se pudo recoger»
select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), '  cerrado ')$q$,
  'sin un motivo que diga algo no entra', 'al menos 10 letras');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), null)$q$,
  'ni sin motivo', 'al menos 10 letras');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), repeat('no había nadie ', 40))$q$,
  'ni con uno de más de 500 letras', 'pasa de 500');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(null, pg_temp.oc('oc3'), 'El proveedor estaba cerrado')$q$,
  'ni sin el id del envío', 'Vuelve a cargar');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc5'), 'El proveedor estaba cerrado')$q$,
  'la que Logística no programó no está en su lista', 'no está en tu lista');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc1'), 'El proveedor estaba cerrado')$q$,
  'la ya recogida no vuelve', 'ya figura recogida');
select public.marcar_compra_en_recojo(pg_temp.oc('oc3'));
reset role;
select pg_temp.como('conductor2');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), 'El proveedor estaba cerrado')$q$,
  'por la que salió una cuenta no avisa otra', 'salió otra cuenta');
select test.debe_fallar($q$select public.marcar_compra_recogida_con_fotos(pg_temp.oc('oc3'), '[]'::jsonb)$q$,
  'ni la marca recogida', 'salió otra cuenta');
reset role;
select test.afirmar((pg_temp.compra('oc3')).recojo = 'EN_RECOJO' and (pg_temp.compra('oc3')).en_recojo_en is not null
  and (select posicion from public.programacion_recojo where orden_compra_id = pg_temp.oc('oc4')) = 4,
  'antes: la tercera en recojo, y la cuarta conserva el lugar 4 con que se programó');

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), '  El proveedor   estaba cerrado por inventario ') = pg_temp.oc('intento1'),
  'el conductor avisa que no se pudo recoger, con su motivo');
select test.afirmar(
  public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), 'El proveedor estaba cerrado por inventario') = pg_temp.oc('intento1'),
  'el mismo envío otra vez devuelve lo de la primera vez');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), 'No tenían el material listo todavía')$q$,
  'con otro motivo dice que ya quedó', 'la primera vez que lo enviaste');
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento2'), pg_temp.oc('oc3'), 'El proveedor estaba cerrado por inventario')$q$,
  'y otro aviso de la misma compra no entra: ya no está en su lista', 'no está en tu lista');
select test.debe_fallar($q$select public.marcar_compra_en_recojo(pg_temp.oc('oc3'))$q$,
  'no sale otra vez por ella hasta que Logística la programe', 'todavía no programa');
select test.afirmar(
  (select count(*) from public.recojos_no_logrados_en_gestion() n where n.orden_compra_id = pg_temp.oc('oc3')
      and n.motivo = 'El proveedor estaba cerrado por inventario' and n.salio_en is not null
      and n.registrado_por_nombre = 'Conductor Check 459') = 1
  and (select g.recojo = 'POR_RECOGER' and not g.en_lista and g.en_recojo_en is null
         from public.compras_en_gestion() g where g.id = pg_temp.oc('oc3'))
  and (select g.lugar from public.compras_en_gestion() g where g.id = pg_temp.oc('oc4')) = 1,
  'el conductor la ve fuera de su lista, con su motivo, y la que seguía pasa a ser la 1.ª');
reset role;
select test.afirmar(
  (pg_temp.compra('oc3')).recojo = 'POR_RECOGER' and (pg_temp.compra('oc3')).en_recojo_en is null and (pg_temp.compra('oc3')).en_recojo_por is null
  and (select posicion is null and peso_kg = 12 from public.programacion_recojo where orden_compra_id = pg_temp.oc('oc3'))
  and (select posicion from public.programacion_recojo where orden_compra_id = pg_temp.oc('oc4')) = 1
  and (select count(*) from public.recojos_no_logrados where orden_compra_id = pg_temp.oc('oc3')) = 1
  and (select salio_en is not null and programado_en is not null and registrado_por = current_setting('prueba.conductor')::uuid
         from public.recojos_no_logrados where id = pg_temp.oc('intento1')),
  'la base: vuelve a pendiente sin la hora de la salida, fuera de la lista y con su peso; la lista se renumera (la cuarta pasa a 1); el intento guarda a qué hora salió y quién avisó');
select test.afirmar(
  pg_temp.avisos('comprador', 'No se pudo recoger') = 1
  and (select cuerpo like '%El proveedor estaba cerrado por inventario%' and ruta = '/compras/gestion'
         from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid and titulo like 'No se pudo recoger%')
  and pg_temp.avisos('conductor', 'No se pudo recoger') = 0 and pg_temp.avisos('conductor2', 'No se pudo recoger') = 0
  and pg_temp.avisos('almacenero', 'No se pudo recoger') = 0,
  'a Logística le llega un solo aviso por la campana, con el motivo y hacia la gestión; a nadie más');

-- Logística la programa otra vez: sale de nuevo, y otro intento lleva otro id.
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.recojos_no_logrados_en_gestion() n where n.orden_compra_id = pg_temp.oc('oc3')) = 1
  and (select count(*) from public.recojos_no_logrados) = 1,
  'Logística ve el intento por la función y en la tabla');
select public.programar_recojo(pg_temp.oc('oc3'), 12, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.oc('oc3'));
select test.debe_fallar($q$select public.marcar_recojo_no_logrado(pg_temp.oc('intento1'), pg_temp.oc('oc3'), 'El proveedor estaba cerrado por inventario')$q$,
  'vuelta a programar, el id del aviso anterior no sirve para el intento nuevo: dice que aquel ya quedó', 'la primera vez que lo enviaste');
select test.afirmar(
  public.marcar_recojo_no_logrado(pg_temp.oc('intento2'), pg_temp.oc('oc3'), 'El proveedor estaba cerrado por inventario') = pg_temp.oc('intento2'),
  'con su id, el segundo intento entra');
-- Sin haber salido: llamó antes y no estaba lista.
select test.afirmar(
  public.marcar_recojo_no_logrado(pg_temp.oc('intento3'), pg_temp.oc('oc4'), 'Llamé y el material no está listo hasta el lunes') = pg_temp.oc('intento3'),
  'también avisa de una que tiene en la lista sin haber salido');
reset role;
select test.afirmar(
  (select count(*) from public.recojos_no_logrados where orden_compra_id = pg_temp.oc('oc3')) = 2
  and (select salio_en is null from public.recojos_no_logrados where id = pg_temp.oc('intento3'))
  and (pg_temp.compra('oc4')).recojo = 'POR_RECOGER'
  and (select posicion is null from public.programacion_recojo where orden_compra_id = pg_temp.oc('oc4'))
  and pg_temp.avisos('comprador', 'No se pudo recoger') = 3,
  'quedan los dos intentos de la tercera y el de la cuarta, sin hora de salida, con un aviso a Logística por cada uno');
select test.debe_fallar($q$update public.recojos_no_logrados set motivo = 'Otro motivo distinto' where id = pg_temp.oc('intento1')$q$,
  'el intento anotado no se cambia', 'queda como evidencia');
select test.debe_fallar($q$delete from public.recojos_no_logrados$q$, 'ni se borra', 'queda como evidencia');

-- ============================================ 5. La puerta del disparador es solo de la función
-- Aquí la señal ya existe (la puso la función, y la deja en ''). Sin la señal
-- nunca puesta, current_setting da null: lo prueban los checks 329 y 333, que
-- corren sin ella. La primera versión de esta migración se saltaba con eso todas
-- las guardas del recojo, y fueron ellos los que lo vieron.
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(pg_temp.oc('oc4'), 13, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.oc('oc4'));
reset role;
select test.debe_fallar($q$update public.ordenes_compra_materiales set recojo = 'POR_RECOGER', en_recojo_en = null, en_recojo_por = null where id = pg_temp.oc('oc4')$q$,
  'a mano, la compra en recojo no vuelve a pendiente', 'no puede pasar');
select set_config('metalwork.recojo_no_logrado', pg_temp.oc('oc3')::text, true);
select test.debe_fallar($q$update public.ordenes_compra_materiales set recojo = 'POR_RECOGER', en_recojo_en = null, en_recojo_por = null where id = pg_temp.oc('oc4')$q$,
  'ni con la señal de otra compra', 'no puede pasar');
select set_config('metalwork.recojo_no_logrado', '', true);
select test.debe_fallar($q$update public.ordenes_compra_materiales set en_recojo_en = now() - interval '1 hour' where id = pg_temp.oc('oc4')$q$,
  'y la hora de la salida sigue sin corregirse', 'no se corrige');
-- La función de antes, sin fotos, sigue sirviendo a la pestaña abierta antes del despliegue.
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(public.marcar_compra_recogida(pg_temp.oc('oc4')) = pg_temp.oc('oc4'), 'la función de antes, sin fotos, sigue marcando recogida');
select test.afirmar(public.marcar_compra_dejada_almacen(pg_temp.oc('oc1')) = pg_temp.oc('oc1'), 'y la recogida con fotos se deja en almacén como siempre');
select test.afirmar(
  (select count(*) from public.recojo_fotos_en_gestion() f where f.orden_compra_id = pg_temp.oc('oc1')) = 2,
  'ya dejada, sus fotos siguen a la vista esta semana');
reset role;

-- ============================================ 6. Las puertas
select test.afirmar(
  not has_function_privilege('anon', 'public.marcar_compra_recogida_con_fotos(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.marcar_recojo_no_logrado(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.recojo_fotos_en_gestion()', 'execute')
  and not has_function_privilege('anon', 'public.recojos_no_logrados_en_gestion()', 'execute')
  and not has_function_privilege('anon', 'public.foto_de_recojo_anotada(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.recojo_anotar_fotos(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.fn_recojo_evidencia_guardia()', 'execute')
  and not has_table_privilege('authenticated', 'public.recojo_fotos', 'insert')
  and not has_table_privilege('authenticated', 'public.recojo_fotos', 'update')
  and not has_table_privilege('authenticated', 'public.recojo_fotos', 'delete')
  and not has_table_privilege('authenticated', 'public.recojos_no_logrados', 'insert')
  and not has_table_privilege('authenticated', 'public.recojos_no_logrados', 'update')
  and not has_table_privilege('authenticated', 'public.recojos_no_logrados', 'delete')
  and not has_table_privilege('anon', 'public.recojo_fotos', 'select')
  and not has_table_privilege('anon', 'public.recojos_no_logrados', 'select')
  and (select not public from storage.buckets where id = 'fotos-recojo'),
  'sin sesión no se ejecuta ni se lee nada, nadie escribe las tablas directo y el bucket es privado');

-- Gerencia tiene `auditoria.ver` y no lee estas tablas: tampoco las lee por
-- la auditoría, porque no se auditan (la copia de la fila sacaba el motivo).
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(public.tiene_permiso('auditoria.ver'), 'Gerencia consulta la auditoría');
select test.afirmar(
  (select count(*) from public.recojo_fotos) = 0 and (select count(*) from public.recojos_no_logrados) = 0
  and (select count(*) from public.audit_log where tabla in ('recojo_fotos', 'recojos_no_logrados')) = 0,
  'Gerencia no lee las fotos ni los motivos del recojo, tampoco por la auditoría');
reset role;
select test.afirmar(
  (select count(*) from public.recojo_fotos) > 0
  and not exists (select 1 from pg_trigger where not tgisinternal and tgname = 'trg_auditoria'
                   and tgrelid in ('public.recojo_fotos'::regclass, 'public.recojos_no_logrados'::regclass)),
  'las tablas del recojo no copian sus filas a la auditoría');

do $$ begin raise notice 'OK 459: el recojo queda con sus fotos, y el que no se pudo vuelve a Logística con su motivo'; end $$;
rollback;
