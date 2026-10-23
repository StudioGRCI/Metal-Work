-- El IGV de la boleta de una parte va al costo del código (decisión de DKS del 22/10,
-- migración 20261022210000). Con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
-- Un RQ del código PLA_SR_O4_1_26/30 con dos insumos; Logística compra cada uno en su OC:
--   · OC1, con factura (3 planchas a S/ 100, sin IGV en sus precios): una parte llega con la
--     boleta B001-4301 por S/ 118, que trae S/ 18 de IGV que no se recupera. Gerencia ve esos
--     S/ 18 en el costeo del código y en su total; anulada la boleta, dejan de sumar.
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
  foreach v in array array['rq', 'oc1', 'oc2', 'b1', 'b2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.codigo', public.normalizar_codigo_interno('PLA_SR_O4_1_26/30'), true);
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
create or replace function pg_temp.anexar(p_doc text, p_oc text, p_numero text, p_monto numeric)
returns void language plpgsql as $$
declare v_ruta text := 'compra/' || pg_temp.id(p_oc) || '/' || pg_temp.id(p_doc) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-compras', v_ruta, auth.uid(), auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                                 subido_por, numero_documento, fecha_emision, monto_de_la_parte)
  values (pg_temp.id(p_doc), pg_temp.id(p_oc), 'COMPROBANTE', 'boleta-' || p_numero || '.pdf', v_ruta, 'application/pdf', 2048,
          public.usuario_actual(), p_numero, current_setting('prueba.hoy')::date, p_monto);
end $$;
-- Lo que Gerencia ve en el costeo del código: la línea del IGV de una boleta, y el total.
create or replace function pg_temp.igv(p_boleta text) returns numeric language sql as $$
  select sum(c.monto) from public.codigo_interno_costeo(current_setting('prueba.codigo')) c
   where c.fuente = 'MATERIALES' and c.concepto = 'IGV de la boleta ' || p_boleta || ' (una parte)';
$$;
create or replace function pg_temp.costo() returns numeric language sql as $$
  select coalesce((select c.costo_pen from public.codigos_internos_costo(current_setting('prueba.codigo')) c), 0);
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
select set_config('prueba.antes', pg_temp.costo()::text, true);
reset role;

-- ============================================ 2. Las boletas de una parte
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.anexar('b1', 'oc1', 'B001-4301', 118);
select pg_temp.anexar('b2', 'oc2', 'B001-4302', 100);
reset role;

-- ============================================ 3. Gerencia ve el IGV en el costo del código
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.igv('B001-4301') = 18,
  'la boleta de una parte de la OC con factura suma al código los S/ 18 de IGV que trae dentro');
select test.afirmar((select c.detalle from public.codigo_interno_costeo(current_setting('prueba.codigo')) c
                      where c.concepto = 'IGV de la boleta B001-4301 (una parte)') = 'Pagó IGV que no se recupera: todo va a este código',
  'y dice por qué: es IGV que no se recupera, y todo es de este código');
select test.afirmar(pg_temp.igv('B001-4302') is null,
  'la boleta de una parte de la OC con boleta no suma nada: sus precios ya llevan el IGV');
select test.afirmar(pg_temp.costo() = current_setting('prueba.antes')::numeric + 18,
  'el costo del código sube exactamente esos S/ 18');
reset role;

-- ============================================ 4. Anulada la boleta, deja de sumar
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('b1'), 'La boleta era de otra OC del proveedor');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.igv('B001-4301') is null and pg_temp.costo() = current_setting('prueba.antes')::numeric,
  'anulada la boleta de una parte, su IGV sale del costo del código');
reset role;

rollback;
