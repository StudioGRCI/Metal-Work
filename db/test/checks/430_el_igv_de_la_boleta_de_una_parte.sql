-- El IGV de la boleta de una parte va al costo del código (decisión de DKS del 22/10,
-- migración 20261022210000). Con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
-- Un RQ del código PLA_SR_O4_1_26/30 con dos insumos; Logística compra cada uno en su OC:
--   · OC1, con factura (3 planchas a S/ 100, sin IGV en sus precios). Otro RQ, del código
--     PLA_SR_O4_1_26/31, pide 1 plancha más que cubre la misma línea: de los S/ 300 de la OC,
--     3 de 4 planchas (S/ 225, 75 %) son del /30 y 1 de 4 (S/ 75, 25 %) del /31.
--     Una parte llega con la boleta B001-4301 por S/ 118, que trae S/ 18 de IGV que no se
--     recupera (118 − 118 / 1.18 = 118 − 100). Gerencia ve en el /30 S/ 13.50 (18 × 75 %) y en
--     el /31 S/ 4.50 (18 × 25 %), y el total de cada código sube eso y nada más. Anulada la
--     boleta, dejan de sumar.
--   · Una nota de venta de la OC1 por S/ 59, que no trae IGV: no suma nada.
--   · OC2, con boleta: su boleta de una parte no suma nada, sus precios ya son lo que se paga.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GGE'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.430@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 430', lower(replace(v, ':', '.')) || '.430@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 430') = 4,
    'se crearon los cuatro usuarios del check, uno por puesto');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK430-PLA', 'Plancha LAF 3 mm 4x8 (430)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000430' || d, 'Proveedor de prueba 430', 'Av. Argentina 430, Lima', '999 430 430' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000430' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'rq2', 'oc1', 'oc2', 'b1', 'b2', 'b3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.codigo', public.normalizar_codigo_interno('PLA_SR_O4_1_26/30'), true);
  perform set_config('prueba.codigo2', public.normalizar_codigo_interno('PLA_SR_O4_1_26/31'), true);
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
-- Logística anexa a la OC la boleta de una parte, como `registrarDocumentoCompra`.
create or replace function pg_temp.anexar(p_doc text, p_oc text, p_numero text, p_monto numeric, p_igv boolean)
returns void language plpgsql as $$
declare v_ruta text := 'compra/' || pg_temp.id(p_oc) || '/' || pg_temp.id(p_doc) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-compras', v_ruta, auth.uid(), auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                                 subido_por, numero_documento, fecha_emision, monto_de_la_parte, parte_trae_igv)
  values (pg_temp.id(p_doc), pg_temp.id(p_oc), 'COMPROBANTE', 'boleta-' || p_numero || '.pdf', v_ruta, 'application/pdf', 2048,
          public.usuario_actual(), p_numero, current_setting('prueba.hoy')::date, p_monto, p_igv);
end $$;
-- Lo que Gerencia ve en el costeo de un código: la línea del IGV de una boleta, su detalle y el total.
create or replace function pg_temp.igv(p_boleta text, p_codigo text default 'codigo') returns numeric language sql as $$
  select sum(c.monto) from public.codigo_interno_costeo(current_setting('prueba.' || p_codigo)) c
   where c.fuente = 'MATERIALES' and c.concepto = 'IGV de la boleta ' || p_boleta || ' (una parte)';
$$;
create or replace function pg_temp.detalle(p_boleta text, p_codigo text) returns text language sql as $$
  select c.detalle from public.codigo_interno_costeo(current_setting('prueba.' || p_codigo)) c
   where c.concepto = 'IGV de la boleta ' || p_boleta || ' (una parte)';
$$;
create or replace function pg_temp.costo(p_codigo text default 'codigo') returns numeric language sql as $$
  select coalesce((select c.costo_pen from public.codigos_internos_costo(current_setting('prueba.' || p_codigo)) c), 0);
$$;

-- ============================================ 0. Puertas
select test.afirmar(not has_function_privilege('authenticated', 'public.codigo_interno_lineas_igv_de_parte(text)', 'execute')
                    and not has_function_privilege('anon', 'public.codigo_interno_lineas_igv_de_parte(text)', 'execute'),
  'las líneas del IGV de una parte son internas: se leen por el costeo, con su permiso');

-- ============================================ 1. Un RQ con dos OC
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/30', 'Armado de la plataforma 30', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 2) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
-- La 1 va con factura; la 2, con boleta.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id('oc' || n), pg_temp.id('rq'), array[n::smallint], pg_temp.id('proveedor'), null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 100)),
  null, 'CONTADO', 0, 'PEN', n = 1)
  from generate_series(1, 2) n;
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 2) n
 where (select aprobacion from public.ordenes_compra_materiales where id = pg_temp.id('oc' || n)) = 'POR_APROBAR';
reset role;
-- El RQ del /31 pide una plancha más que cubre la misma línea de la OC1: lo que hace Logística
-- al juntar insumos de dos RQ en una OC (20261016700000). Aquí se liga directo el insumo 1 del
-- RQ del /30 y el del /31, que el armado de la OC no es lo que se prueba.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq2'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/31', 'Armado de la plataforma 31', null,
  jsonb_build_array(jsonb_build_object('descripcion', 'Insumo del 31', 'cantidad', 1,
    'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat'))));
reset role;
update public.requerimiento_lineas set orden_compra_detalle_id =
       (select d.id from public.orden_compra_material_detalles d where d.orden_compra_id = pg_temp.id('oc1'))
 where requerimiento_id = pg_temp.id('rq2')
    or (requerimiento_id = pg_temp.id('rq') and descripcion = 'Insumo 1');
select test.afirmar((select count(*) from public.requerimiento_lineas where orden_compra_detalle_id =
                       (select d.id from public.orden_compra_material_detalles d where d.orden_compra_id = pg_temp.id('oc1'))) = 2,
  'la línea de la OC1 la cubren los dos RQ');
select pg_temp.como('gerente');
set local role authenticated;
select set_config('prueba.antes', pg_temp.costo()::text, true);
select set_config('prueba.antes2', pg_temp.costo('codigo2')::text, true);
reset role;

-- ============================================ 2. Las boletas de una parte
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anexar('b3', 'oc1', 'NV01-4303', 59, null) $$,
  'la boleta de una parte dice si trae IGV', 'ck_documento_compra_parte_igv');
select pg_temp.anexar('b1', 'oc1', 'B001-4301', 118, true);
select pg_temp.anexar('b3', 'oc1', 'NV01-4303', 59, false);
select pg_temp.anexar('b2', 'oc2', 'B001-4302', 100, true);
select test.debe_fallar($$ update public.documentos_compra_material set parte_trae_igv = false where id = pg_temp.id('b1') $$,
  'Logística no corrige si trae IGV', 'permission denied');
reset role;
-- Ni por encima de los permisos: la base lo rechaza al dueño de la tabla.
select test.debe_fallar($$ update public.documentos_compra_material set parte_trae_igv = false where id = pg_temp.id('b1') $$,
  'si trae IGV no se corrige ni por encima de los permisos: se anula y se anexa de nuevo', 'no se corrigen');

-- ============================================ 3. Gerencia ve el IGV en el costo del código
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.igv('B001-4301') = 13.50 and pg_temp.igv('B001-4301', 'codigo2') = 4.50,
  'los S/ 18 de IGV de la boleta se reparten como la OC: S/ 13.50 al /30 (75 %) y S/ 4.50 al /31 (25 %)');
select test.afirmar(pg_temp.detalle('B001-4301', 'codigo') = 'Pagó IGV que no se recupera: 75 % va a este código, lo de la OC que es suyo'
                    and pg_temp.detalle('B001-4301', 'codigo2') = 'Pagó IGV que no se recupera: 25 % va a este código, lo de la OC que es suyo',
  'y cada línea dice por qué y cuánto le toca');
select test.afirmar(pg_temp.igv('NV01-4303') is null and pg_temp.igv('NV01-4303', 'codigo2') is null,
  'la nota de venta que no trae IGV no suma nada');
select test.afirmar(pg_temp.igv('B001-4302') is null,
  'la boleta de una parte de la OC con boleta no suma nada: sus precios ya llevan el IGV');
select test.afirmar(pg_temp.costo() = current_setting('prueba.antes')::numeric + 13.50
                    and pg_temp.costo('codigo2') = current_setting('prueba.antes2')::numeric + 4.50,
  'el costo de cada código sube exactamente su parte');
select test.afirmar((select salidas from public.codigos_internos_resumen() where codigo = current_setting('prueba.codigo2')) = 0,
  'el IGV suma al costo pero no es una salida del almacén: el /31 sigue con cero salidas');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select sum(g.monto) from public.codigo_interno_gasto(current_setting('prueba.codigo2')) g
                      where g.concepto = 'IGV de la boleta B001-4301 (una parte)') = 4.50
                    and (select salidas from public.codigos_internos_gasto() where codigo = current_setting('prueba.codigo2')) = 0,
  'Requerimientos ve los S/ 4.50 en el gasto del /31, sin contarlos como salida');
reset role;

-- ============================================ 4. Anulada la boleta, deja de sumar
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('b1'), 'La boleta era de otra OC del proveedor');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.igv('B001-4301') is null and pg_temp.costo() = current_setting('prueba.antes')::numeric
                    and pg_temp.costo('codigo2') = current_setting('prueba.antes2')::numeric,
  'anulada la boleta de una parte, su IGV sale del costo de los dos códigos');
reset role;

rollback;
