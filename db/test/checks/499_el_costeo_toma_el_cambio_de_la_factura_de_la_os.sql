-- El costeo del código interno pasa la OS en dólares a soles con el cambio de su
-- factura (migración 20261126998400) y pesa lo que dice su monto en soles, ni
-- un céntimo distinto (20261126998800). Con la cuenta de cada puesto —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Cambios registrados: ayer 3,70 (el único al emitir) y, después, hace 3 días 3,80.
-- Un código, PRB_SR_499_1, con tres OS aprobadas:
--
--   osa: US$ 1 000. Sin factura pesa S/ 3 700 en el costo, con el cambio del día
--        en que se emitió. Con su factura de hace 3 días pesa S/ 3 800, lo mismo
--        que dice la OS. Anulada la factura, vuelve a S/ 3 700.
--   osb: US$ 1 000. Su factura es de hace 20 días, sin cambio registrado: la OS
--        queda sin monto en soles y el costeo la cuenta como línea sin cambio,
--        sin sumarla. Contabilidad registra ese cambio (3,60) y pesa S/ 3 600.
--   osp: S/ 500. Su factura no cambia nada: la línea sigue con su día de emisión.
--
-- Otro código, PRB_SR_499_2, con una sola OS (osv, US$ 1 000) para lo que antes
-- no igualaba y lo que no debe moverse:
--
--   · Con factura y todavía por aprobar, su línea ya lleva el día de la factura.
--   · Depositada su detracción queda fija en S/ 3 800; Contabilidad corrige
--     después el cambio de ese día (3,90): el costeo sigue pesando S/ 3 800,
--     como la OS (hasta la 20261126998800 pesaba S/ 3 900).
--   · La «última actividad» del código es el día en que se emitió la OS, hace 40
--     días, no el de su factura.
--
-- Y de vuelta en el primero, la OS sin factura: Contabilidad registra el cambio
-- de hoy (3,75) después de emitida; la OS sigue en S/ 3 700, del cambio de
-- ayer, y el costeo también (antes tomaba el de hoy: S/ 3 750).
--
-- En cada paso, `codigo_interno_cambio_de_servicios` dice cuánto pesa en soles
-- cada OS en dólares y con qué cambio: el día que le toca, el del cambio
-- registrado del que sale su monto, el día en que se emitió, su monto en soles
-- y de dónde sale. Y lo que el costo suma en soles por las OS en dólares es la
-- suma de esos montos, leída de la tabla.
--
-- Al final Gerencia cierra el costeo: lo congelado es esa misma cifra.
--
-- Lo lee quien ve el costo (Gerencia, Administración) y no quien no (Supervisión).
\set ON_ERROR_STOP on
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'ADMINISTRACION:ADM', 'SUPERVISOR:MTZ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.499@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 499', lower(replace(v, ':', '.')) || '.499@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 499') = 5,
    'se crearon los cinco usuarios del check, uno por puesto');
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 499'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(499000, 499200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 499'), true);
  foreach v in array array['osa', 'osb', 'osp', 'osv', 'fa', 'fb', 'fp', 'fv', 'pagov'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select current_setting('prueba.' || p)::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;
create or replace function pg_temp.os(p text) returns public.ordenes_servicio language sql as $$
  select * from public.ordenes_servicio where id = pg_temp.id(p);
$$;
-- Un archivo ya subido a la carpeta de esa OS, a nombre de quien lo va a anotar.
create or replace function pg_temp.subir(p_os text, p_de text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_os) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-servicio', v_ruta, pg_temp.id(p_de), pg_temp.id(p_de)::text,
          jsonb_build_object('mimetype', 'application/pdf', 'size', 2048 + (random() * 1000)::int));
  return v_ruta;
end $$;
-- Lo que lee la pantalla de ese puesto, con su rol: el día de la línea de esa OS (contado
-- desde hoy) y, del costo del código, soles | dólares sin cambio | líneas sin cambio |
-- dólares pasados al cambio | lo que suman en soles.
create or replace function pg_temp.linea(p_os text, p_como text default 'gerente', p_codigo text default 'PRB_SR_499_1') returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como(p_como);
  set local role authenticated;
  select (k.fecha - pg_temp.hoy())::text || '|' || k.moneda || '|' || k.monto::text into v
    from public.codigo_interno_costeo(p_codigo) k where k.referencia_id = pg_temp.id(p_os);
  reset role;
  return coalesce(v, 'nada');
end $$;
create or replace function pg_temp.costo(p_como text default 'gerente', p_codigo text default 'PRB_SR_499_1') returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como(p_como);
  set local role authenticated;
  select concat_ws('|', c.costo_pen, c.usd_sin_cambio, c.lineas_sin_cambio, c.usd_al_cambio, c.usd_en_soles) into v
    from public.codigos_internos_costo(p_codigo) c;
  reset role;
  return coalesce(v, 'nada');
end $$;
-- Lo que la base dice de esa OS en el costeo, con los días contados desde hoy: el día que le
-- toca | el del cambio registrado del que sale su monto (∅ si de ninguno) | el día en que se
-- emitió | su monto en soles (∅ si no tiene) | de dónde sale su cambio. «nada» si no viene (la
-- OS en soles).
create or replace function pg_temp.cambio(p_os text, p_como text default 'gerente', p_codigo text default 'PRB_SR_499_1') returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como(p_como);
  set local role authenticated;
  select concat_ws('|', c.dia - pg_temp.hoy(), coalesce((c.registrado_el - pg_temp.hoy())::text, '∅'), c.emitida_el - pg_temp.hoy(),
                   coalesce(c.monto_pen::text, '∅'), coalesce(c.origen, '∅')) into v
    from public.codigo_interno_cambio_de_servicios(p_codigo) c where c.orden_servicio_id = pg_temp.id(p_os);
  reset role;
  return coalesce(v, 'nada');
end $$;
-- El costo del código pesa por sus OS en dólares lo que dicen sus montos en soles: lo que suma en
-- soles es la suma de los `monto_pen` de las aprobadas, y lo que deja «sin cambio» son los dólares
-- de las que todavía no lo tienen. Las cifras de la OS se leen de la tabla, no de otra función.
create or replace function pg_temp.el_costo_es_el_de_las_os(p_codigo text default 'PRB_SR_499_1') returns boolean language plpgsql as $$
declare v_soles numeric; v_sin numeric; v_lineas integer; v boolean;
begin
  select coalesce(sum(s.monto_pen), 0), coalesce(sum(s.monto) filter (where s.monto_pen is null), 0), count(*) filter (where s.monto_pen is null)
    into v_soles, v_sin, v_lineas
    from public.ordenes_servicio s
   where s.codigo_interno = p_codigo and s.moneda = 'USD' and s.aprobacion = 'APROBADA' and s.estado <> 'ANULADA';
  perform pg_temp.como('gerente');
  set local role authenticated;
  select c.usd_en_soles = v_soles and c.usd_sin_cambio = v_sin and c.lineas_sin_cambio = v_lineas into v
    from public.codigos_internos_costo(p_codigo) c;
  reset role;
  return coalesce(v, false);
end $$;
-- La fuente de la línea de esa OS y la «última actividad» de su código, contada desde hoy.
create or replace function pg_temp.fuente(p_os text, p_codigo text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como('gerente');
  set local role authenticated;
  select k.fuente into v from public.codigo_interno_costeo(p_codigo) k where k.referencia_id = pg_temp.id(p_os);
  reset role;
  return coalesce(v, 'nada');
end $$;
create or replace function pg_temp.ultima(p_codigo text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.como('gerente');
  set local role authenticated;
  select r.ultima_actividad - pg_temp.hoy() into v from public.codigos_internos_resumen() r where r.codigo = p_codigo;
  reset role;
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select test.afirmar((select count(*) from public.tipos_de_cambio) = 0, 'no hay ningún tipo de cambio registrado');

select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 1, 3.65, 3.70, 'SUNAT', pg_temp.id('contabilidad'));
reset role;

-- ============================================ Logística emite, Gerencia aprueba
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('osa'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PRB_SR_499_1', 'Torneado de ejes, prueba 499', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osb'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PRB_SR_499_1', 'Arenado del chasis, prueba 499', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osp'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PRB_SR_499_1', 'Pintura de la tolva, prueba 499', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('osa'));
select public.aprobar_orden_servicio(pg_temp.id('osb'));
select public.aprobar_orden_servicio(pg_temp.id('osp'));
reset role;

-- ============================================ Sin factura: el cambio del día en que se emitió
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null,
  'la OS en dólares se emitió a S/ 3 700 y sin día de factura');
select test.afirmar(pg_temp.linea('osa') = '0|USD|1000.00',
  format('sin factura, la línea de la OS lleva el día en que se emitió (dice %s)', pg_temp.linea('osa')));
select test.afirmar(pg_temp.costo() = '7900.00|0|0|2000.00|7400.00',
  format('el costo del código pasa las dos OS en dólares a S/ 3 700 cada una, más los S/ 500 (dice %s)', pg_temp.costo()));
select test.afirmar(pg_temp.cambio('osa') = '0|-1|0|3700.00|SIN_FACTURA',
  format('la base dice que pesa S/ 3 700, del cambio de ayer, el último registrado cuando se emitió (dice %s)', pg_temp.cambio('osa')));
select test.afirmar(pg_temp.cambio('osp') = 'nada', 'de la OS en soles no dice ningún cambio');

-- Contabilidad registra después el cambio de hace 3 días: nada cambia todavía.
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 3, 3.75, 3.80, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar(pg_temp.costo() = '7900.00|0|0|2000.00|7400.00', 'registrar el cambio de otro día no mueve el costo');

-- ============================================ Con su factura: el cambio de ese día, el mismo de la OS
select set_config('prueba.ruta_a', pg_temp.subir('osa', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fa'), pg_temp.id('osa'), 'FACTURA', 'F001-4991', 'factura.pdf',
                                     current_setting('prueba.ruta_a'), pg_temp.hoy() - 3) = pg_temp.id('fa'),
  'Logística adjunta la factura de hace 3 días');
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3800.00 and (pg_temp.os('osa')).fecha_cambio = pg_temp.hoy() - 3,
  'la OS tomó el cambio de su factura: S/ 3 800');
select test.afirmar(pg_temp.linea('osa') = '-3|USD|1000.00',
  format('la línea del costeo lleva el día de la factura, y sigue en dólares (dice %s)', pg_temp.linea('osa')));
select test.afirmar(pg_temp.linea('osb') = '0|USD|1000.00', 'la otra OS, sin factura, sigue con su día de emisión');
select test.afirmar(pg_temp.cambio('osa') = '-3|-3|0|3800.00|FACTURA' and pg_temp.cambio('osb') = '0|-1|0|3700.00|SIN_FACTURA',
  format('la base dice que pesa S/ 3 800, del cambio del día de su factura, y que se emitió hoy (dice %s)', pg_temp.cambio('osa')));
select test.afirmar(pg_temp.cambio('osa', 'administracion') = '-3|-3|0|3800.00|FACTURA', 'Administración lee lo mismo');
select test.afirmar(pg_temp.el_costo_es_el_de_las_os(), 'y el costo suma por las OS en dólares lo que dicen sus montos en soles');
select test.afirmar(pg_temp.costo() = '8000.00|0|0|2000.00|7500.00',
  format('el costo del código sube S/ 100: la OS pesa los mismos S/ 3 800 que dice (dice %s)', pg_temp.costo()));
select test.afirmar(
  split_part(pg_temp.costo(), '|', 5)::numeric = (pg_temp.os('osa')).monto_pen + (pg_temp.os('osb')).monto_pen,
  'lo que suman en soles las OS en dólares del costeo es la suma de sus montos en soles');
-- Administración lee el mismo costo; Supervisión no lo lee.
select test.afirmar(pg_temp.costo('administracion') = '8000.00|0|0|2000.00|7500.00',
  format('Administración lee el mismo costo que Gerencia (dice %s)', pg_temp.costo('administracion')));
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_costo('PRB_SR_499_1')$q$,
  'un supervisor no lee el costo del código', 'codigos_internos.ver');
select test.debe_fallar($q$select * from public.codigo_interno_costeo('PRB_SR_499_1')$q$,
  'ni sus líneas', 'codigos_internos.ver');
select test.debe_fallar($q$select * from public.codigo_interno_cambio_de_servicios('PRB_SR_499_1')$q$,
  'ni con qué cambio va cada OS', 'codigos_internos.ver');
select test.debe_fallar($q$select public.codigo_interno_lineas_servicio('PRB_SR_499_1')$q$,
  'la función interna sigue sin llamarse desde afuera', 'permission denied');
reset role;

-- ============================================ La factura de un día sin cambio: línea sin cambio
select set_config('prueba.ruta_b', pg_temp.subir('osb', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fb'), pg_temp.id('osb'), 'FACTURA', 'F001-4992', 'factura.pdf',
                                     current_setting('prueba.ruta_b'), pg_temp.hoy() - 20) = pg_temp.id('fb'),
  'Logística adjunta a la otra OS una factura de hace 20 días, sin cambio registrado');
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen is null, 'esa OS queda sin monto en soles');
select test.afirmar(pg_temp.costo() = '4300.00|1000.00|1|1000.00|3800.00',
  format('el costeo no la suma: la cuenta como una línea en dólares sin tipo de cambio (dice %s)', pg_temp.costo()));
select test.afirmar(pg_temp.cambio('osb') = '-20|∅|0|∅|FACTURA',
  format('y la base dice que no tiene monto en soles ni cambio registrado para el día de su factura (dice %s)', pg_temp.cambio('osb')));
select test.afirmar(pg_temp.el_costo_es_el_de_las_os(), 'lo mismo que dice el costo: sus dólares, sin cambio');

select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 20, 3.55, 3.60, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen = 3600.00, 'Contabilidad registra ese cambio y la OS se completa: S/ 3 600');
select test.afirmar(pg_temp.costo() = '7900.00|0|0|2000.00|7400.00',
  format('y el costeo la suma con ese mismo cambio: S/ 3 800 + S/ 3 600 + S/ 500 (dice %s)', pg_temp.costo()));
select test.afirmar(
  split_part(pg_temp.costo(), '|', 5)::numeric = (pg_temp.os('osa')).monto_pen + (pg_temp.os('osb')).monto_pen,
  'otra vez, lo que suman en soles es la suma de los montos en soles de las OS');
select test.afirmar(pg_temp.cambio('osb') = '-20|-20|0|3600.00|FACTURA' and pg_temp.el_costo_es_el_de_las_os(),
  format('y la base ya dice cuánto pesa y con cuál va (dice %s)', pg_temp.cambio('osb')));

-- ============================================ La OS en soles no cambia
select set_config('prueba.ruta_p', pg_temp.subir('osp', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fp'), pg_temp.id('osp'), 'FACTURA', 'F001-4993', 'factura.pdf',
                                     current_setting('prueba.ruta_p'), null::date) = pg_temp.id('fp'),
  'la factura de la OS en soles entra sin fecha');
reset role;
select test.afirmar(pg_temp.linea('osp') = '0|PEN|500.00' and (pg_temp.os('osp')).fecha_cambio is null,
  format('la línea de la OS en soles sigue con su día de emisión (dice %s)', pg_temp.linea('osp')));

-- ============================================ Anulada la factura, vuelve al día en que se emitió
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_servicio(pg_temp.id('fa'), 'Se adjuntó la factura de otra orden');
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null,
  'anulada su factura, la OS vuelve a S/ 3 700');
select test.afirmar(pg_temp.linea('osa') = '0|USD|1000.00', 'y su línea del costeo vuelve al día en que se emitió');
select test.afirmar(pg_temp.costo() = '7800.00|0|0|2000.00|7300.00',
  format('el costo del código baja con ella: S/ 3 700 + S/ 3 600 + S/ 500 (dice %s)', pg_temp.costo()));

-- La lista de Gerencia no cambia: sigue sumando cada OS en su moneda.
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select servicios = 3 and servicios_pen = 500 and servicios_usd = 2000 from public.codigos_internos_servicios() where codigo = 'PRB_SR_499_1'),
  'la lista de códigos sigue sumando las tres OS, cada una en su moneda');
reset role;

-- ============================================ Otro código: por aprobar, la OS fija y la última actividad
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('osv'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PRB_SR_499_2', 'Rectificado del eje, prueba 499', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
reset role;
select set_config('prueba.ruta_v', pg_temp.subir('osv', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fv'), pg_temp.id('osv'), 'FACTURA', 'F001-4994', 'factura.pdf',
                                     current_setting('prueba.ruta_v'), pg_temp.hoy() - 3) = pg_temp.id('fv'),
  'Logística adjunta la factura de hace 3 días a una OS que Gerencia todavía no aprobó');
reset role;
select test.afirmar(pg_temp.fuente('osv', 'PRB_SR_499_2') = 'SERVICIOS_POR_APROBAR'
                and pg_temp.linea('osv', 'gerente', 'PRB_SR_499_2') = '-3|USD|1000.00'
                and pg_temp.costo('gerente', 'PRB_SR_499_2') = '0|0|0|0|0',
  format('por aprobar, su línea ya lleva el día de su factura y todavía no suma (dice %s, %s y %s)',
         pg_temp.fuente('osv', 'PRB_SR_499_2'), pg_temp.linea('osv', 'gerente', 'PRB_SR_499_2'), pg_temp.costo('gerente', 'PRB_SR_499_2')));
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('osv'));
reset role;
select test.afirmar((pg_temp.os('osv')).monto_pen = 3800.00 and pg_temp.costo('gerente', 'PRB_SR_499_2') = '3800.00|0|0|1000.00|3800.00',
  format('aprobada, pesa los S/ 3 800 que dice la OS (dice %s)', pg_temp.costo('gerente', 'PRB_SR_499_2')));

-- Lo que antes no igualaba. Depositada su detracción, la OS queda fija; Contabilidad corrige
-- después el cambio del día de su factura: la OS sigue en S/ 3 800, y el costeo con ella.
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, destino, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('pagov'), pg_temp.id('osv'), current_date, 'PEN', (pg_temp.os('osv')).detraccion_monto, false, 'DETRACCION', 'prueba/499/detraccion-v.pdf', 'application/pdf', 1000, pg_temp.id('contabilidad'));
set local session_replication_role = origin;
select test.afirmar((pg_temp.os('osv')).detraccion_monto > 0 and public.servicio_con_el_cambio_fijo(pg_temp.id('osv')),
  'la OS tiene detracción y, depositada, queda fija');
select pg_temp.como('contabilidad');
set local role authenticated;
update public.tipos_de_cambio set venta = 3.90, compra = 3.85 where fecha = pg_temp.hoy() - 3;
reset role;
select test.afirmar((pg_temp.os('osv')).monto_pen = 3800.00,
  'la OS fija no se mueve con la corrección: sigue en S/ 3 800');
select test.afirmar(pg_temp.costo('gerente', 'PRB_SR_499_2') = '3800.00|0|0|1000.00|3800.00',
  format('el costeo tampoco: pesa los mismos S/ 3 800 que guarda la OS, no los S/ 3 900 del cambio corregido (dice %s)', pg_temp.costo('gerente', 'PRB_SR_499_2')));
select test.afirmar(pg_temp.cambio('osv', 'gerente', 'PRB_SR_499_2') = '-3|∅|0|3800.00|DEPOSITADA_CON_OTRO_CAMBIO' and pg_temp.el_costo_es_el_de_las_os('PRB_SR_499_2'),
  format('y la base dice que quedó fija con otro cambio que el que hoy tiene ese día, sin nombrar ninguno (dice %s)', pg_temp.cambio('osv', 'gerente', 'PRB_SR_499_2')));
select test.afirmar(pg_temp.costo() = '7800.00|0|0|2000.00|7300.00', 'el otro código, sin facturas de ese día, no se mueve');

-- La última actividad del código es el día en que se emitió la OS, no el de su factura.
set local session_replication_role = replica;
update public.ordenes_servicio set creado_en = creado_en - interval '40 days' where id = pg_temp.id('osv');
set local session_replication_role = origin;
select test.afirmar(pg_temp.linea('osv', 'gerente', 'PRB_SR_499_2') = '-3|USD|1000.00' and pg_temp.cambio('osv', 'gerente', 'PRB_SR_499_2') = '-3|∅|-40|3800.00|DEPOSITADA_CON_OTRO_CAMBIO',
  format('emitida hace 40 días, su línea sigue con el día de su factura y la base dice cuándo se emitió (dice %s)', pg_temp.cambio('osv', 'gerente', 'PRB_SR_499_2')));
select test.afirmar(pg_temp.ultima('PRB_SR_499_2') = -40,
  format('la última actividad del código es de hace 40 días, cuando se emitió la OS: la fecha de la factura no lo mueve (dice %s)', pg_temp.ultima('PRB_SR_499_2')));
select test.afirmar(pg_temp.ultima('PRB_SR_499_1') = 0, 'y la del código con OS emitidas hoy es hoy');

-- ============================================ La OS sin factura y el cambio de su día, registrado después
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy(), 3.70, 3.75, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null,
  'Contabilidad registra el cambio de hoy: la OS sin factura, emitida antes, sigue en S/ 3 700');
select test.afirmar(pg_temp.costo() = '7800.00|0|0|2000.00|7300.00' and pg_temp.el_costo_es_el_de_las_os(),
  format('y el costeo con ella: no la vuelve a pasar con el cambio de hoy, que daría S/ 3 750 (dice %s)', pg_temp.costo()));
select test.afirmar(pg_temp.cambio('osa') = '0|-1|0|3700.00|SIN_FACTURA',
  format('la base dice que su monto sale del cambio de ayer, no del de hoy (dice %s)', pg_temp.cambio('osa')));

-- Quien ve el costeo tiene que poder leer el cambio de la OS: si no, la fila sale sin decir con cuál.
select test.afirmar(
  not exists (
    select 1 from public.roles r
     where exists (select 1 from public.roles_permisos p where p.rol_id = r.id and p.permiso_codigo = 'codigos_internos.ver')
       and r.codigo <> 'ADMIN'
       and not exists (select 1 from public.roles_permisos p
                        where p.rol_id = r.id
                          and p.permiso_codigo in ('compras.ver', 'compras.crear', 'compras.detraccion', 'tesoreria.ver_documentos', 'costos.ver'))
       and not exists (select 1 from public.regla_aprobacion_compras g where g.rol_aprobador_id = r.id)),
  'todo rol que ve el costeo del código puede leer con qué cambio va la OS');

-- ============================================ El cierre del costeo congela ese mismo costo
select pg_temp.como('gerente');
set local role authenticated;
select public.cerrar_costeo_codigo('PRB_SR_499_1', 'Entregada al cliente en la planta, prueba 499');
reset role;
select test.afirmar(
  (select z.costo_pen = 7800.00 and (z.por_fuente->>'SERVICIOS')::numeric = 7800.00
     from public.codigo_interno_cierres z where z.codigo = 'PRB_SR_499_1' order by z.creado_en desc limit 1),
  'Gerencia cierra el costeo y queda congelado con lo que dicen las OS: S/ 3 700 + S/ 3 600 + S/ 500, no los S/ 7 850 de volver a pasar la OS sin factura con el cambio de hoy');

select 'OK: el costeo del código pasa la OS en dólares a soles con el cambio de su factura' as resultado;
rollback;
