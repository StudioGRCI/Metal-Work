-- Contabilidad recibe el aviso de cada pago por confirmar (migración
-- 20261026120000, DKS 26/10): la OC con boleta que se dio por pagada fuera, cuando
-- llega su factura, deja un aviso a cada cuenta con `adquisiciones.registrar`,
-- también a la que registró la factura; uno por OC mientras no lo lea, y se da por
-- leído cuando la OC deja de esperar. Cada paso con el rol que lo da y `set local
-- role authenticated`. Los avisos salen al confirmar la transacción: aquí se
-- adelantan con `set constraints all immediate`. Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_ruc text;
begin
  foreach v in array array['comprador:COMPRADOR:LOG', 'contabilidad:CONTABILIDAD:CON', 'contabilidad2:CONTABILIDAD:CON',
                           'tesoreria:TESORERIA:TES', 'gerente:GERENTE:GER'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 1) || '.436@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 436', split_part(v, ':', 1) || '.436@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || split_part(v, ':', 1), v_id::text, true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK436-PLA', 'Plancha LAF 2 mm 4x8 (436)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  select '2060000436' || d into v_ruc from generate_series(0, 9) d where public.ruc_es_valido('2060000436' || d) limit 1;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values (v_ruc, 'Ferretería del Check 436 S.A.C.', 'Av. Argentina 436, Lima', '999 436 436')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['oca', 'ocb', 'da', 'db', 'fa', 'fb'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Los avisos de pago por confirmar de esa OC que tiene esa persona: todos, o los sin leer.
create or replace function pg_temp.avisos(p_quien text, p_oc text, p_sin_leer boolean default true) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_quien) and origen_id = pg_temp.id(p_oc) and titulo like 'Pago por confirmar:%'
     and (not p_sin_leer or leida_en is null);
$$;

-- ============================================ 1. Dos OC con boleta, de antes del 20/10
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(pg_temp.id(x), pg_temp.id('proveedor'), 'COT-436-' || x, 'Reposición del almacén (436)',
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 4, 'precio', 100)),
         current_setting('prueba.hoy')::date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA')
  from unnest(array['oca', 'ocb']) x;
reset role;
-- Desde aquí los disparadores diferidos corren al final de cada sentencia, como si
-- cada paso fuera su propia transacción: la regla de aprobación fija la OC al
-- emitirse y el aviso sale al registrar la factura.
set constraints all immediate;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(c.id) from public.ordenes_compra_materiales c
 where c.id in (pg_temp.id('oca'), pg_temp.id('ocb')) and c.aprobacion = 'POR_APROBAR';
reset role;
-- Las de antes: la base no deja marcarlas, así que se marcan con los disparadores
-- apagados, como la migración 20261020210000 marcó las de antes al crear la columna.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = false where id in (pg_temp.id('oca'), pg_temp.id('ocb'));
set local session_replication_role = origin;
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) + pg_temp.avisos('contabilidad', 'ocb', false) = 0,
  'sin factura registrada, la OC dada por pagada fuera no avisa: no hay nada que confirmar');
select set_config('prueba.total', public.total_orden_compra(pg_temp.id('oca'))::text, true);

-- ============================================ 2. Llega la factura de cada una
-- La de la primera, por el anexo de Logística que Contabilidad elige; la de la segunda, solo por el anexo
-- (Contabilidad la registró para la primera y alcanza para las dos).
do $$
declare x text;
begin
  foreach x in array array['a', 'b'] loop
    insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values ('documentos-compras', 'compra/' || pg_temp.id('oc' || x) || '/' || pg_temp.id('d' || x) || '.pdf', pg_temp.id('comprador'),
            pg_temp.id('comprador')::text, '{"mimetype": "application/pdf", "size": 2048}');
  end loop;
end $$;
select pg_temp.como('comprador');
set local role authenticated;
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                               subido_por, numero_documento, fecha_emision)
values (pg_temp.id('da'), pg_temp.id('oca'), 'FACTURA', 'factura.pdf',
        'compra/' || pg_temp.id('oca') || '/' || pg_temp.id('da') || '.pdf', 'application/pdf', 2048, pg_temp.id('comprador'),
        'F001-4361', current_setting('prueba.hoy')::date);
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) = 0,
  'el anexo de Logística sin factura registrada todavía no avisa');

select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id, documento_compra_id)
values (pg_temp.id('fa'), 'FACTURA_COMPRA', 'Ferretería del Check 436 S.A.C.', 'F001-4361', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', current_setting('prueba.total')::numeric * 2, 'CONTADO', pg_temp.id('oca'), pg_temp.id('da'));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('fa') || '/comprobante.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 2048}');
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) = 0, 'el borrador no avisa');
-- Este paso, como en la vida real: el aviso sale al confirmar, no antes.
set constraints trg_avisar_pago_por_confirmar_adquisicion deferred;
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
 where id = pg_temp.id('fa');
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) = 0, 'el aviso no sale a medio camino');
set constraints all immediate;
reset role;

select test.afirmar(pg_temp.avisos('contabilidad', 'oca') = 1 and pg_temp.avisos('contabilidad2', 'oca') = 1,
  'registrada la factura, le llega el aviso a cada cuenta de Contabilidad, también a la que la registró');
select test.afirmar(pg_temp.avisos('tesoreria', 'oca', false) = 0 and pg_temp.avisos('comprador', 'oca', false) = 0
                    and pg_temp.avisos('gerente', 'oca', false) = 0,
  'a Tesorería, Logística y Gerencia no: no les toca decirlo');
select test.afirmar((select titulo = 'Pago por confirmar: ' || c.numero
                            and cuerpo like 'La factura F001-4361 es de la ' || c.numero || '%si esa OC ya se pagó o si falta pagarla.'
                            and ruta = '/adquisiciones?vista=por-confirmar'
                       from public.notificaciones n join public.ordenes_compra_materiales c on c.id = n.origen_id
                      where n.usuario_id = pg_temp.id('contabilidad') and n.origen_id = pg_temp.id('oca')),
  'el aviso nombra la OC y su factura, y lleva a «Pago por confirmar»');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones where origen_id = pg_temp.id('oca')) = 1,
  'cada cuenta lee solo su aviso');
reset role;

-- La misma OC no avisa dos veces, ni después de leído: volver a correr la migración no repite nada.
select pg_temp.como('contabilidad');
set local role authenticated;
update public.notificaciones set leida_en = now() where origen_id = pg_temp.id('oca');
reset role;
select public.avisar_pago_por_confirmar(array[pg_temp.id('oca'), pg_temp.id('oca')]);
select public.avisar_pago_por_confirmar(array(select id from public.ordenes_compra_materiales));
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) = 1 and pg_temp.avisos('contabilidad', 'oca') = 0
                    and pg_temp.avisos('contabilidad2', 'oca', false) = 1,
  'la OC que sigue esperando no repite el aviso, aunque ya se haya leído');

-- La segunda OC: Logística le anexa la misma factura y alcanza (la factura es por las dos).
select pg_temp.como('comprador');
set local role authenticated;
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                               subido_por, numero_documento, fecha_emision)
values (pg_temp.id('db'), pg_temp.id('ocb'), 'FACTURA', 'factura.pdf',
        'compra/' || pg_temp.id('ocb') || '/' || pg_temp.id('db') || '.pdf', 'application/pdf', 2048, pg_temp.id('comprador'),
        'F001-4361', current_setting('prueba.hoy')::date);
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'ocb', false) = 0
                    and (select compra from public.facturas_en_espera(array[pg_temp.id('fa')]))
                        = (select numero from public.ordenes_compra_materiales where id = pg_temp.id('oca')),
  'la factura pregunta por una OC a la vez, como la pestaña: la segunda espera su turno sin aviso');

-- ============================================ 3. Contabilidad lo dice, y el aviso queda leído
select pg_temp.como('contabilidad');
set local role authenticated;
select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date,
                                          current_setting('prueba.total')::numeric, 'Transferencia del 15/10, según el estado de cuenta');
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'oca') = 0 and pg_temp.avisos('contabilidad2', 'oca') = 0
                    and pg_temp.avisos('contabilidad', 'oca', false) = 1,
  '«Ya se pagó»: el aviso de esa OC queda leído para las dos cuentas');
select test.afirmar(pg_temp.avisos('contabilidad', 'ocb') = 1 and pg_temp.avisos('contabilidad2', 'ocb') = 1,
  'respondida la primera, la factura pregunta por la otra OC y llega su aviso');

select pg_temp.como('contabilidad2');
set local role authenticated;
select public.confirmar_pago_de_la_boleta(pg_temp.id('ocb'), false, null, null, 'El proveedor dice que nunca le pagaron');
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'ocb') = 0 and pg_temp.avisos('contabilidad2', 'ocb') = 0,
  '«Falta pagarla»: también queda leído');
select test.afirmar(pg_temp.avisos('contabilidad', 'oca', false) + pg_temp.avisos('contabilidad', 'ocb', false) = 2,
  'y ninguno vuelve a llegar');

rollback;
