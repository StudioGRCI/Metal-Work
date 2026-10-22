-- La factura se liga por el RUC (migración 20261022170000, decisión de DKS del
-- 22/10): Contabilidad anota el RUC al registrar la factura de compra, y se liga
-- solo a las OC de ese mismo RUC. Dos empresas que se escriben igual («Aceros
-- del Sur S.A.C.» y «ACEROS DEL SUR SAC») ya no se confunden, y la misma escrita
-- de dos formas se reconoce. Cada paso con el rol que lo da —Logística,
-- Contabilidad y Tesorería— y `set local role authenticated`. Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_ruc text;
begin
  foreach v in array array['COMPRADOR:LOG', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'GERENTE:GER'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.424@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 424', lower(replace(v, ':', '.')) || '.424@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK424-PLA', 'Plancha LAF 2 mm 4x8 (424)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  -- Dos empresas que se escriben casi igual, cada una con su RUC.
  foreach v in array array['uno:2060000424', 'otro:2060001424'] loop
    select split_part(v, ':', 2) || d into v_ruc from generate_series(0, 9) d
     where public.ruc_es_valido(split_part(v, ':', 2) || d) limit 1;
    perform set_config('prueba.ruc_' || split_part(v, ':', 1), v_ruc, true);
    insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
    values (v_ruc, case when split_part(v, ':', 1) = 'uno' then 'Aceros del Sur S.A.C.' else 'ACEROS DEL SUR SAC' end,
            'Av. Argentina 424, Lima', '999 424 424')
    returning id::text into v_ruc;
    perform set_config('prueba.prov_' || split_part(v, ':', 1), v_ruc, true);
  end loop;
  foreach v in array array['oc1', 'oc2', 'oc3', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'd3', 'c1'] loop
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
-- Una OC directa de cada proveedor.
create or replace function pg_temp.comprar(p_oc text, p_proveedor text, p_con_factura boolean) returns uuid language sql as $$
  select public.emitir_compra_directa(pg_temp.id(p_oc), pg_temp.id('prov_' || p_proveedor), 'COT-424-' || p_oc,
    'Reposición del almacén (424)',
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 2, 'precio', 50)),
    current_setting('prueba.hoy')::date + 5, 'CONTADO', 0, 'PEN', p_con_factura, 'PLANTA');
$$;
-- La factura en borrador, como la deja la pantalla antes de subir el PDF.
create or replace function pg_temp.factura(p_f text, p_proveedor text, p_numero text, p_ruc text, p_oc text default null)
returns void language sql as $$
  insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento,
                                    moneda, total, condicion_pago, orden_compra_id)
  values (pg_temp.id(p_f), 'FACTURA_COMPRA', p_proveedor, p_ruc, p_numero, current_setting('prueba.hoy')::date,
          current_setting('prueba.hoy')::date, 'PEN', 118, 'CONTADO', case when p_oc is not null then pg_temp.id(p_oc) end);
$$;
-- Registrarla: su PDF y el estado.
create or replace function pg_temp.registrar(p_f text) returns void language plpgsql as $$
declare v_ruta text := 'adquisiciones/' || pg_temp.id(p_f) || '/comprobante.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', v_ruta, auth.uid()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  update public.adquisiciones set ruta_storage = v_ruta, estado = 'REGISTRADA' where id = pg_temp.id(p_f);
end $$;
create or replace function pg_temp.ruc(p_f text) returns text language sql as $$
  select ruc_proveedor from public.adquisiciones where id = pg_temp.id(p_f);
$$;

-- ============================================ 0. Puertas
do $$
begin
  perform test.afirmar(not has_function_privilege('authenticated', 'public.ruc_de_la_compra(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_adquisicion_anota_ruc()', 'execute')
                       and not has_function_privilege('anon', 'public.mismo_emisor(text, text, text, text)', 'execute'),
                       'el RUC de la OC y el disparador los usa la base, no la gente');
  perform test.afirmar(public.mismo_emisor('20600004241', 'Aceros del Sur S.A.C.', '20600014241', 'ACEROS DEL SUR SAC') = false
                       and public.mismo_emisor(null, 'Aceros del Sur S.A.C.', '20600014241', 'ACEROS DEL SUR SAC')
                       and public.mismo_emisor('20600004241', 'Aceros del Sur', '20600004241', 'ACEROS SUR E.I.R.L.'),
                       'con los dos RUC manda el RUC; sin uno de ellos, el nombre');
end $$;

-- ============================================ 1. Logística compra a los dos
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.comprar('oc1', 'uno', true) = pg_temp.id('oc1')
                    and pg_temp.comprar('oc2', 'otro', true) = pg_temp.id('oc2')
                    and pg_temp.comprar('oc3', 'otro', false) = pg_temp.id('oc3'),
  'una OC con factura a cada empresa, y una con boleta a la segunda');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(c.id) from public.ordenes_compra_materiales c
 where c.id in (pg_temp.id('oc1'), pg_temp.id('oc2'), pg_temp.id('oc3')) and c.aprobacion = 'POR_APROBAR';
reset role;

-- ============================================ 2. Contabilidad registra con el RUC
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.factura('f1', 'Aceros del Sur S.A.C.', 'F001-4241', current_setting('prueba.ruc_uno'), 'oc1');
select pg_temp.registrar('f1');
select test.afirmar(pg_temp.ruc('f1') = current_setting('prueba.ruc_uno'), 'la factura de la OC de su RUC entra con su RUC');

select test.debe_fallar($$ select pg_temp.factura('f2', 'Aceros del Sur S.A.C.', 'F001-4242', current_setting('prueba.ruc_otro'), 'oc1') $$,
  'la factura de un RUC no va a la OC del otro, aunque se escriban igual', 'se liga solo a las OC de su proveedor');

-- Sin escribirlo, la OC del padrón lo pone.
select pg_temp.factura('f2', 'Aceros del Sur', 'F001-4242', null, 'oc2');
select test.afirmar(pg_temp.ruc('f2') = current_setting('prueba.ruc_otro'), 'sin RUC escrito, toma el del proveedor de su OC');

-- Sin OC y sin RUC no se registra.
select pg_temp.factura('f3', 'Ferretería sin OC', 'F001-4243', null);
select test.debe_fallar($$ select pg_temp.registrar('f3') $$, 'la factura de compra no se registra sin RUC', 'Anota el RUC');
select test.debe_fallar($$ update public.adquisiciones set ruc_proveedor = '20600004240' where id = pg_temp.id('f3') $$,
  'un RUC con el dígito de control mal se rechaza', 'no es válido');
update public.adquisiciones set ruc_proveedor = ' 2060-0004-24' || right(current_setting('prueba.ruc_uno'), 1) where id = pg_temp.id('f3');
select test.afirmar(pg_temp.ruc('f3') = current_setting('prueba.ruc_uno'), 'los espacios y guiones se quitan solos');
select pg_temp.registrar('f3');

-- ============================================ 3. La misma factura se reconoce por el RUC
select test.debe_fallar($$ select pg_temp.factura('f4', 'ACEROS DEL SUR', 'F001-4241', current_setting('prueba.ruc_uno')) $$,
  'la misma factura con el nombre escrito de otra forma no entra dos veces', 'del RUC ' || current_setting('prueba.ruc_uno') || ' (Aceros del Sur S.A.C.) ya está registrado');
select pg_temp.factura('f4', 'ACEROS DEL SUR SAC', 'F001-4241', current_setting('prueba.ruc_otro'));
select test.afirmar(pg_temp.ruc('f4') = current_setting('prueba.ruc_otro'),
  'el mismo número de la otra empresa sí entra: es otra factura');

-- ============================================ 4. Ligar una OC de otro RUC
select test.debe_fallar($$ insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
                            values (pg_temp.id('f4'), pg_temp.id('oc1')) $$,
  'a la factura de un RUC no se le liga la OC del otro', 'se liga solo a las OC de su proveedor');
select test.debe_fallar($$ update public.adquisiciones set ruc_proveedor = current_setting('prueba.ruc_uno') where id = pg_temp.id('f2') $$,
  'ni se le cambia el RUC a uno que no es el de su OC', 'se liga solo a las OC de su proveedor');
reset role;

-- ============================================ 5. El anexo de Logística, por el RUC
select pg_temp.como('comprador');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('oc3') || '/' || pg_temp.id('d3') || '.pdf', pg_temp.id('comprador'),
        pg_temp.id('comprador')::text, '{"mimetype": "application/pdf", "size": 2048}');
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                               subido_por, numero_documento, fecha_emision)
values (pg_temp.id('d3'), pg_temp.id('oc3'), 'FACTURA', 'factura.pdf', 'compra/' || pg_temp.id('oc3') || '/' || pg_temp.id('d3') || '.pdf',
        'application/pdf', 2048, pg_temp.id('comprador'), 'F002-4245', current_setting('prueba.hoy')::date);
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
-- Antes se ligaba por el nombre: la factura de la otra empresa se pegaba al anexo.
select pg_temp.factura('f5', 'Aceros del Sur S.A.C.', 'F002-4245', current_setting('prueba.ruc_uno'));
select test.afirmar((select orden_compra_id is null from public.adquisiciones where id = pg_temp.id('f5')),
  'la factura con ese número pero de otro RUC no se pega al anexo de Logística');
select pg_temp.factura('f6', 'Aceros del Sur', 'F002-4245', current_setting('prueba.ruc_otro'));
select test.afirmar((select orden_compra_id = pg_temp.id('oc3') and documento_compra_id = pg_temp.id('d3')
                       from public.adquisiciones where id = pg_temp.id('f6')),
  'la de su RUC sí se liga sola a la OC con boleta donde Logística la anexó');
reset role;
select test.afirmar((select count(*) from public.anexos_de_la_factura((select a from public.adquisiciones a where a.id = pg_temp.id('f5')))) = 0
                    and (select count(*) from public.anexos_de_la_factura((select a from public.adquisiciones a where a.id = pg_temp.id('f6')))) = 1,
  'el anexo es de la factura de su RUC, no de la otra');

-- ============================================ 6. La corrección cuida el RUC
select pg_temp.como('contabilidad');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('justificantes-correccion', pg_temp.id('f1') || '/' || pg_temp.id('c1') || '.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 2048}');
select test.debe_fallar(format($q$ select public.corregir_factura_compra('%s', '%s', 'El proveedor corrigió el RUC en su factura',
                                    '%s', 'correo.pdf', jsonb_build_object('ruc_proveedor', '%s')) $q$,
                               pg_temp.id('c1'), pg_temp.id('f1'), pg_temp.id('f1') || '/' || pg_temp.id('c1') || '.pdf',
                               current_setting('prueba.ruc_otro')),
  'corregirle el RUC a uno que no es el de su OC no pasa', 'se liga solo a las OC de su proveedor');
reset role;

rollback;
