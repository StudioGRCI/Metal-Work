-- La factura de una OC que se dio por pagada fuera espera a Contabilidad
-- (migración 20261022175000, decisión de DKS del 22/10): la OC con boleta aprobada
-- antes del 20/10 se dio por pagada fuera del sistema; si llega su factura, no se
-- paga hasta que Contabilidad diga si esa OC ya se pagó o si falta pagarla. «Ya se
-- pagó» deja un pago de la OC hecho fuera, sin voucher ni caja, que la factura
-- toma; lo que falte lo paga Tesorería. «Falta pagarla» la deja como cualquier
-- factura. Cada paso con el rol que lo da y `set local role authenticated`.
-- Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_ruc text;
begin
  foreach v in array array['COMPRADOR:LOG', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'GERENTE:GER'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.425@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 425', lower(replace(v, ':', '.')) || '.425@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK425-PLA', 'Plancha LAF 2 mm 4x8 (425)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  select '2060000425' || d into v_ruc from generate_series(0, 9) d where public.ruc_es_valido('2060000425' || d) limit 1;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values (v_ruc, 'Ferretería del Check 425 S.A.C.', 'Av. Argentina 425, Lima', '999 425 425')
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
-- Lo que la factura tiene tomado de los pagos de sus OC con boleta, y lo que le falta.
create or replace function pg_temp.tomado(p_factura text) returns numeric language sql as $$
  select coalesce(sum(monto), 0) from public.pagos_adquisicion
   where adquisicion_id = pg_temp.id(p_factura) and anulado_en is null and pago_orden_compra_id is not null;
$$;
create or replace function pg_temp.saldo(p_factura text) returns numeric language sql as $$
  select a.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null), 0)
    from public.adquisiciones a where a.id = pg_temp.id(p_factura);
$$;
create or replace function pg_temp.en_espera(p_factura text) returns text language sql as $$
  select compra from public.facturas_en_espera(array[pg_temp.id(p_factura)]);
$$;
create or replace function pg_temp.voucher(p_factura text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_factura) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-facturas', v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  return v_ruta;
end $$;
create or replace function pg_temp.pagar(p_factura text, p_monto numeric) returns uuid language sql as $$
  select public.registrar_pago_factura(gen_random_uuid(), pg_temp.id(p_factura), current_setting('prueba.hoy')::date, p_monto,
    'OP-425', pg_temp.voucher(p_factura), current_setting('prueba.caja')::uuid, null);
$$;
create or replace function pg_temp.avisos(p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones where usuario_id = pg_temp.id('tesoreria') and titulo like p_titulo || '%';
$$;

-- ============================================ 1. Dos OC con boleta, de antes del 20/10
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(pg_temp.id(x), pg_temp.id('proveedor'), 'COT-425-' || x, 'Reposición del almacén (425)',
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 4, 'precio', 100)),
         current_setting('prueba.hoy')::date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA')
  from unnest(array['oca', 'ocb']) x;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(c.id) from public.ordenes_compra_materiales c
 where c.id in (pg_temp.id('oca'), pg_temp.id('ocb')) and c.aprobacion = 'POR_APROBAR';
reset role;
-- Las de antes: la base no deja marcarlas, así que se marcan con los disparadores
-- apagados, como la migración marcó las de antes al crear la columna.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = false where id in (pg_temp.id('oca'), pg_temp.id('ocb'));
set local session_replication_role = origin;
select set_config('prueba.total', public.total_orden_compra(pg_temp.id('oca'))::text, true);
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);

-- ============================================ 2. Llega la factura de cada una
-- Logística la anexa a su OC y Contabilidad la registra eligiendo ese anexo, por más de lo que dice la OC.
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
select pg_temp.id('d' || x), pg_temp.id('oc' || x), 'FACTURA', 'factura.pdf',
       'compra/' || pg_temp.id('oc' || x) || '/' || pg_temp.id('d' || x) || '.pdf', 'application/pdf', 2048, pg_temp.id('comprador'),
       'F001-425' || case x when 'a' then '1' else '2' end, current_setting('prueba.hoy')::date
  from unnest(array['a', 'b']) x;
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id, documento_compra_id)
select pg_temp.id('f' || x), 'FACTURA_COMPRA', 'Ferretería del Check 425 S.A.C.', 'F001-425' || case x when 'a' then '1' else '2' end, current_setting('prueba.hoy')::date,
       current_setting('prueba.hoy')::date, 'PEN', current_setting('prueba.total')::numeric + 50, 'CONTADO', pg_temp.id('oc' || x), pg_temp.id('d' || x)
  from unnest(array['a', 'b']) x;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'comprobantes-financieros', 'adquisiciones/' || pg_temp.id(x) || '/comprobante.pdf', auth.uid()::text,
       '{"mimetype": "application/pdf", "size": 2048}'
  from unnest(array['fa', 'fb']) x;
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
 where id in (pg_temp.id('fa'), pg_temp.id('fb'));
select test.afirmar(pg_temp.en_espera('fa') is not null and pg_temp.en_espera('fb') is not null,
  'Contabilidad ve que las dos facturas esperan que diga si su OC ya se pagó');
select test.afirmar((select count(*) from public.facturas_en_espera() e where e.adquisicion_id in (pg_temp.id('fa'), pg_temp.id('fb'))) = 2
                    and (select desde from public.facturas_en_espera() e where e.adquisicion_id = pg_temp.id('fa'))
                        = (select (creado_en at time zone 'America/Lima')::date from public.ordenes_compra_materiales where id = pg_temp.id('oca')),
  'sin lista, salen todas las que esperan, aunque no estén entre las cien más nuevas, con el día desde el que pudo pagarse');
reset role;
-- La que deja de ser de esa OC (Logística anuló el anexo y Contabilidad le quitó
-- la OC) deja de esperar por ella: esperaba para siempre por una OC ajena.
savepoint sin_la_oc;
set local session_replication_role = replica;
update public.documentos_compra_material set anulado_en = now(), anulado_por = pg_temp.id('comprador'),
       motivo_anulacion = 'Era la factura de otra compra' where id = pg_temp.id('da');
update public.adquisiciones_ordenes_compra set quitada_en = now() where adquisicion_id = pg_temp.id('fa');
update public.adquisiciones set orden_compra_id = null, documento_compra_id = null where id = pg_temp.id('fa');
set local session_replication_role = origin;
select test.afirmar(pg_temp.en_espera('fa') is null and pg_temp.en_espera('fb') is not null,
  'sin el anexo ni el vínculo, la factura ya no espera por esa OC; la otra sigue esperando');
rollback to savepoint sin_la_oc;

-- ============================================ 3. En espera, Tesorería no la paga
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(pg_temp.en_espera('fa') = (select numero from public.ordenes_compra_materiales where id = pg_temp.id('oca')),
  'Tesorería también ve por qué OC espera');
select test.debe_fallar($$ select pg_temp.pagar('fa', 10) $$,
  'la factura en espera no se paga', 'espera que Contabilidad diga en Adquisiciones si ya se pagó o si falta pagarla');
select test.debe_fallar($$ select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date, 1, 'Lo dice el estado de cuenta') $$,
  'Tesorería no confirma por Contabilidad', 'permiso');
reset role;

-- ============================================ 4. Contabilidad: «Ya se pagó»
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date,
                                                                      current_setting('prueba.total')::numeric, 'Sí') $$,
  'sin decir cómo lo sabe no se confirma', 'Cuenta cómo lo sabes');
select test.debe_fallar($$ select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date + 1,
                                                                      current_setting('prueba.total')::numeric, 'Transferencia del 15/10, según el banco') $$,
  'ni con un día que no llegó', 'Elige el día en que se pagó');
select test.debe_fallar($$ select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date,
                                                                      current_setting('prueba.total')::numeric + 1, 'Transferencia del 15/10, según el banco') $$,
  'ni por más que la OC', 'no pasa de su total');
select set_config('prueba.pago_fuera',
  public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), true, current_setting('prueba.hoy')::date,
                                     current_setting('prueba.total')::numeric, 'Transferencia del 15/10, según el estado de cuenta')::text, true);
reset role;
select test.afirmar((select pagado_fuera is not null and archivo_ruta is null and monto = current_setting('prueba.total')::numeric and cancela
                       from public.pagos_orden_compra where id = pg_temp.id('pago_fuera')),
  'queda un pago de la OC hecho fuera, sin voucher, por lo que dijo Contabilidad');
select test.afirmar((select count(*) from public.movimientos_caja where origen_id = pg_temp.id('pago_fuera')) = 0,
  'y no mueve la caja: ya está en su saldo');
select test.afirmar((select pago_en_tesoreria from public.ordenes_compra_materiales where id = pg_temp.id('oca')),
  'la OC pasa a Tesorería');
select test.afirmar(pg_temp.tomado('fa') = current_setting('prueba.total')::numeric and pg_temp.saldo('fa') = 50,
  'la factura toma lo pagado fuera y le falta lo que es por más: S/ 50');
select test.afirmar(pg_temp.avisos('Se pagó fuera:') = 1, 'a Tesorería le llega el aviso');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.en_espera('fa') is null, 'la factura ya no espera');
select test.afirmar(not exists (select 1 from public.facturas_en_espera() e where e.adquisicion_id = pg_temp.id('fa')),
  'ni en la lista de todas las que esperan');
select test.debe_fallar($$ select public.confirmar_pago_de_la_boleta(pg_temp.id('oca'), false, null, null, 'Me equivoqué, no se pagó') $$,
  'y no se vuelve a decidir', 'ya la lleva Tesorería');
reset role;

-- ============================================ 5. Tesorería paga la diferencia
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.pagar('fa', 51) $$, 'no paga más de lo que falta', '');
select pg_temp.pagar('fa', 50);
reset role;
select test.afirmar(pg_temp.saldo('fa') = 0, 'con la diferencia, la factura queda pagada');

-- Mientras la otra espera, lo pagado fuera por la primera OC no se descuenta en ella.
select test.debe_fallar($$ insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por, pago_orden_compra_id)
                           values (pg_temp.id('fb'), current_setting('prueba.hoy')::date, 1, 'Descuento 425', pg_temp.id('tesoreria'),
                                   pg_temp.id('pago_fuera')) $$,
  'en la factura que espera no se descuenta lo pagado en otra OC', 'espera que Contabilidad diga');

-- ============================================ 6. Contabilidad: «Falta pagarla»
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(public.confirmar_pago_de_la_boleta(pg_temp.id('ocb'), false, null, null, 'El proveedor dice que nunca le pagaron') = pg_temp.id('ocb'),
  'Contabilidad dice que falta pagarla');
reset role;
select test.afirmar((select pago_en_tesoreria from public.ordenes_compra_materiales where id = pg_temp.id('ocb'))
                    and not exists (select 1 from public.pagos_orden_compra where orden_compra_id = pg_temp.id('ocb'))
                    and pg_temp.avisos('Falta pagar:') = 1,
  'la OC pasa a Tesorería sin pago anotado, y a Tesorería le llega el aviso');
select test.afirmar((select count(*) from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and titulo like 'Falta pagar:%' and cuerpo like '%nunca le pagaron%') = 1,
  'el aviso trae la nota de Contabilidad');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select ya_pagada and pago_id = pg_temp.id('pago_fuera') from public.compras_pagadas_fuera_confirmadas
                      where orden_compra_id = pg_temp.id('oca'))
                    and (select not ya_pagada and pago_id is null and nota = 'El proveedor dice que nunca le pagaron'
                           and confirmada_por = pg_temp.id('contabilidad')
                           from public.compras_pagadas_fuera_confirmadas where orden_compra_id = pg_temp.id('ocb')),
  'Tesorería lee lo que dijo Contabilidad de cada OC, con su nota y quién lo dijo');
select test.debe_fallar($$ update public.compras_pagadas_fuera_confirmadas set nota = 'Otra cosa distinta' $$,
  'y nadie lo cambia', 'permission denied');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('fb', current_setting('prueba.total')::numeric + 50);
reset role;
select test.afirmar(pg_temp.saldo('fb') = 0, 'Tesorería la paga entera, como cualquier factura');

-- ============================================ 7. Si resultó que no salió, Tesorería lo anula
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_compra(pg_temp.id('pago_fuera'), 'El banco no tiene esa transferencia');
reset role;
select test.afirmar(pg_temp.tomado('fa') = 0 and pg_temp.saldo('fa') = current_setting('prueba.total')::numeric,
  'anulado lo pagado fuera, la factura deja de tomarlo y debe el resto');
select test.debe_fallar($$ update public.pagos_orden_compra set pagado_fuera = null where id = pg_temp.id('pago_fuera') $$,
  'el pago anotado fuera queda como evidencia', '');

rollback;
