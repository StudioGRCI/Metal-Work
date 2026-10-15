-- Una orden de compra en varias facturas: el proveedor entrega por partes y
-- factura cada parte. Contabilidad marca la factura que cubre solo una parte de
-- la OC; la OC sigue esperando su factura hasta que otra la complete, y el
-- detector compara cada factura con lo que FALTA facturar. Cada paso con la
-- cuenta del área que lo hace —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000384', 'PRUEBAS FACTURAS 384 S.A.C.' where not exists (select 1 from public.empresa);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_mat uuid; r record;
begin
  foreach v in array array['CONTABILIDAD:CON', 'COMPRADOR:LOG', 'TESORERIA:TES', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.384@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 384', lower(split_part(v, ':', 1)) || '.384@prueba.local', r2.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r2 where r2.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

  -- Un proveedor, un material y cinco OC directas, como dueño de las tablas (con IGV):
  --   ocA 20 × 50 → 1 180.00   ocB 2 × 100 → 236.00   ocC 1 × 100 → 118.00
  --   ocD 10 × 100 → 1 180.00  ocE 1 × 100 → 118.00
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.proveedores (numero_documento, razon_social) values ('20100055008', 'PROVEEDOR UNO 384')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK384', 'Plancha de la factura 384', (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  for r in select * from (values ('ocA', 20::numeric, 50::numeric), ('ocB', 2, 100), ('ocC', 1, 100), ('ocD', 10, 100), ('ocE', 1, 100))
                          as t(clave, cantidad, precio) loop
    perform set_config('prueba.' || r.clave, gen_random_uuid()::text, true);
    insert into public.ordenes_compra_materiales (id, proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda,
                                                  origen, motivo, con_factura, creado_por, aprobacion)
    select current_setting('prueba.' || r.clave)::uuid, p.id, p.razon_social, 'QA384-' || r.clave, 'CONTADO', 0, 'PEN',
           'DIRECTA', 'Reposición de prueba 384', true, current_setting('prueba.comprador')::uuid, 'NO_REQUERIDA'
      from public.proveedores p where p.numero_documento = '20100055008';
    insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id)
    values (current_setting('prueba.' || r.clave)::uuid, r.cantidad, r.precio, v_mat);
  end loop;
  foreach v in array array['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'c1', 'c2', 'c3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Contabilidad crea el borrador de la factura `p_f` con su OC principal y su total.
create or replace function pg_temp.borrador(p_f text, p_oc text, p_total numeric) returns void language plpgsql as $$
begin
  insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.' || p_f)::uuid, current_setting('prueba.' || p_oc)::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 384',
          'F001-384' || substr(p_f, 2), current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', p_total, 'CONTADO');
end $$;

-- La marca de «solo una parte de esta OC», en borrador.
create or replace function pg_temp.marcar(p_f text, p_oc text, p_parcial boolean) returns integer language plpgsql as $$
declare v integer;
begin
  update public.adquisiciones_ordenes_compra set parcial = p_parcial
   where adquisicion_id = current_setting('prueba.' || p_f)::uuid and orden_compra_id = current_setting('prueba.' || p_oc)::uuid;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function pg_temp.parcial(p_f text, p_oc text) returns integer language sql as $$
  select pg_temp.marcar(p_f, p_oc, true);
$$;

-- Sube el PDF y la registra.
create or replace function pg_temp.registrar(p_f text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.' || p_f) || '/comprobante.pdf',
          current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 2048}');
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.' || p_f) || '/comprobante.pdf',
         estado = 'REGISTRADA'
   where id = current_setting('prueba.' || p_f)::uuid;
end $$;

create or replace function pg_temp.control(p_f text) returns table (control text, total_oc numeric, diferencia numeric) language sql as $$
  select c.control, c.total_oc, c.diferencia from public.adquisiciones_control(array[current_setting('prueba.' || p_f)::uuid]) c;
$$;

create or replace function pg_temp.espera(p_oc text) returns boolean language sql as $$
  select exists (select 1 from public.compras_sin_factura() where orden_compra_id = current_setting('prueba.' || p_oc)::uuid);
$$;

create or replace function pg_temp.facturado(p_oc text) returns numeric language sql as $$
  select facturado from public.facturado_de_compras(array[current_setting('prueba.' || p_oc)::uuid]);
$$;

create or replace function pg_temp.justificante(p_f text, p_c text) returns text language plpgsql as $$
declare v_ruta text := current_setting('prueba.' || p_f) || '/' || current_setting('prueba.' || p_c) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('justificantes-correccion', v_ruta, public.usuario_actual()::text, '{"mimetype": "application/pdf", "size": 3072}');
  return v_ruta;
end $$;

-- ============================================ 1. La primera entrega: media OC
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.borrador('f1', 'ocA', 590);
select test.afirmar(pg_temp.parcial('f1', 'ocA') = 1, 'en borrador, Contabilidad marca que la factura cubre solo una parte de la OC');
select pg_temp.registrar('f1');
select test.afirmar((select control = 'PARCIAL' and total_oc = 1180.00 and diferencia = -590.00 from pg_temp.control('f1')),
  'la factura parcial sale «Parcial»: faltan 590 de los 1 180 de la OC');
select test.afirmar(pg_temp.espera('ocA'), 'la OC sigue esperando su factura');
select test.afirmar(pg_temp.facturado('ocA') = 590, 'con 590 facturados');
select test.afirmar(pg_temp.marcar('f1', 'ocA', false) = 0, 'registrada, Contabilidad ya no cambia la marca por fuera de una corrección');
reset role;
select test.debe_fallar(format($q$update public.adquisiciones_ordenes_compra set parcial = false where adquisicion_id = '%s'$q$,
  current_setting('prueba.f1')), 'ni por debajo de la pantalla', 'no se cambian');
select test.afirmar((select parcial from public.adquisiciones_ordenes_compra where adquisicion_id = current_setting('prueba.f1')::uuid),
  'y la factura sigue marcada como parcial');

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.espera('ocA') and pg_temp.facturado('ocA') = 590, 'Logística ve que la OC espera el resto de su factura');
select test.afirmar(pg_temp.parcial('f1', 'ocA') = 0, 'Logística no marca nada');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(format($q$select * from public.facturado_de_compras(array['%s']::uuid[])$q$, current_setting('prueba.ocA')),
  'Ventas no ve lo facturado de las OC', 'Contabilidad, Tesorería y Logística');
reset role;

-- ============================================ 2. La segunda entrega completa la OC
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.borrador('f2', 'ocA', 590);
select pg_temp.registrar('f2');
select test.afirmar((select control = 'CALZA' and total_oc = 590.00 and diferencia = 0.00 from pg_temp.control('f2')),
  'la segunda factura calza con lo que faltaba de la OC, no con su total');
select test.afirmar(not pg_temp.espera('ocA') and pg_temp.facturado('ocA') = 1180,
  'con la OC completa, deja de esperar');
select test.afirmar((select (c.ordenes->0->>'facturado_otras')::numeric = 590 and jsonb_array_length(c.ordenes->0->'otras_facturas') = 1
                       from public.adquisiciones_control(array[current_setting('prueba.f2')::uuid]) c),
  'el detector dice en qué otra factura está la OC');
select test.debe_fallar($q$select pg_temp.borrador('f3', 'ocA', 100)$q$,
  'la OC completa no entra en otra factura', 'ya tiene su factura completa');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.adquisiciones_control(array[current_setting('prueba.f1')::uuid, current_setting('prueba.f2')::uuid])) = 2,
  'Tesorería ve el aviso de las dos facturas');
reset role;

-- ============================================ 3. Dos parciales que suman la OC
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.borrador('f4', 'ocB', 118);
select pg_temp.parcial('f4', 'ocB');
select pg_temp.registrar('f4');
select pg_temp.borrador('f5', 'ocB', 118);
select pg_temp.parcial('f5', 'ocB');
select pg_temp.registrar('f5');
select test.afirmar(not pg_temp.espera('ocB'), 'cuando lo facturado llega al total, la OC deja de esperar aunque las dos digan «parcial»');
select test.afirmar((select control from pg_temp.control('f5')) = 'CALZA', 'y la última calza');

-- ============================================ 4. Una factura que completa una OC y cubre parte de otra
select pg_temp.borrador('f6', 'ocC', 618);
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id, parcial)
values (current_setting('prueba.f6')::uuid, current_setting('prueba.ocD')::uuid, true);
select pg_temp.registrar('f6');
select test.afirmar((select control from pg_temp.control('f6')) = 'PARCIAL', 'la factura que cubre parte de una OC sale «Parcial»');
select test.afirmar(pg_temp.facturado('ocC') = 118 and pg_temp.facturado('ocD') = 500,
  'a la OC que completa le toca su total y a la parcial lo que sobra');
select test.afirmar(not pg_temp.espera('ocC') and pg_temp.espera('ocD'), 'la completa deja de esperar; la parcial, no');
select pg_temp.borrador('f7', 'ocD', 680);
select pg_temp.registrar('f7');
select test.afirmar((select control = 'CALZA' and total_oc = 680.00 and diferencia = 0.00 from pg_temp.control('f7')) and not pg_temp.espera('ocD'),
  'la factura del resto calza con los 680 que faltaban');

-- ============================================ 5. La parcial que se pasa de la OC no calza
select pg_temp.borrador('f8', 'ocE', 200);
select pg_temp.parcial('f8', 'ocE');
select pg_temp.registrar('f8');
select test.afirmar((select control = 'NO_CALZA' and total_oc = 118.00 and diferencia = 82.00 from pg_temp.control('f8')),
  'una factura parcial por más de lo que falta no calza: sobran 82');

-- ============================================ 6. La marca se corrige con su justificante
select pg_temp.justificante('f1', 'c1');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'La primera factura era la completa', '%s/%s.pdf', 'correo.pdf',
  '{"parciales": []}'::jsonb)$q$, current_setting('prueba.c1'), current_setting('prueba.f1'), current_setting('prueba.f1'), current_setting('prueba.c1')),
  'no se completa una OC que ya completa otra factura', 'ya tiene su factura completa');
select pg_temp.justificante('f2', 'c2');
select public.corregir_factura_compra(current_setting('prueba.c2')::uuid, current_setting('prueba.f2')::uuid,
  'La segunda factura también era solo una parte', current_setting('prueba.f2') || '/' || current_setting('prueba.c2') || '.pdf', 'correo.pdf',
  format('{"parciales": ["%s"]}', current_setting('prueba.ocA'))::jsonb);
select test.afirmar((select parcial from public.adquisiciones_ordenes_compra
                      where adquisicion_id = current_setting('prueba.f2')::uuid and orden_compra_id = current_setting('prueba.ocA')::uuid)
                    and (select (despues->'parciales') = to_jsonb(array[current_setting('prueba.ocA')]) from public.correcciones
                          where id = current_setting('prueba.c2')::uuid),
  'la corrección marca la factura como parcial y lo deja en su historial');
select public.corregir_factura_compra(current_setting('prueba.c1')::uuid, current_setting('prueba.f1')::uuid,
  'La primera factura era la completa', current_setting('prueba.f1') || '/' || current_setting('prueba.c1') || '.pdf', 'correo.pdf',
  '{"parciales": []}'::jsonb);
select test.afirmar(not (select parcial from public.adquisiciones_ordenes_compra
                          where adquisicion_id = current_setting('prueba.f1')::uuid and orden_compra_id = current_setting('prueba.ocA')::uuid),
  'y entonces la otra sí puede completarla');
reset role;

-- ============================================ 7. La factura que Logística anexa a la OC lleva número y fecha
select set_config('prueba.d' || n, gen_random_uuid()::text, true) from generate_series(1, 5) n;
-- Anexa a la OC E el documento `p_d` (su PDF ya subido) con este tipo, número y fecha.
create or replace function pg_temp.anexar(p_d text, p_tipo text, p_numero text, p_fecha date) returns void language plpgsql as $$
declare v_ruta text := 'compra/' || current_setting('prueba.ocE') || '/' || current_setting('prueba.' || p_d) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('documentos-compras', v_ruta, current_setting('prueba.comprador'), '{"mimetype": "application/pdf", "size": 2048}')
  on conflict do nothing;
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                                 numero_documento, fecha_emision)
  values (current_setting('prueba.' || p_d)::uuid, current_setting('prueba.ocE')::uuid, p_tipo, p_tipo || '.pdf', v_ruta,
          'application/pdf', 2048, p_numero, p_fecha);
end $$;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.anexar('d1', 'FACTURA', null, null)$q$,
  'sin número ni fecha, la factura no se anexa', 'ck_documento_compra_factura_con_numero');
select test.debe_fallar($q$select pg_temp.anexar('d2', 'FACTURA', 'F001-45', current_date + 3)$q$,
  'ni con fecha de pasado mañana', 'posterior a hoy');
select test.debe_fallar($q$select pg_temp.anexar('d3', 'FACTURA', 'factura 45', current_date - 1)$q$,
  'ni con un número sin serie', 'como F001-123');
select pg_temp.anexar('d4', 'FACTURA', 'f001-00045', current_setting('prueba.hoy')::date);
select pg_temp.anexar('d5', 'COMPROBANTE', null, null);
reset role;
select test.afirmar((select numero_documento = 'F001-45' and fecha_emision = current_setting('prueba.hoy')::date
                       from public.documentos_compra_material where id = current_setting('prueba.d4')::uuid)
                    and exists (select 1 from public.documentos_compra_material where id = current_setting('prueba.d5')::uuid),
  'la factura queda con su número como lo guarda la base y su fecha; la boleta, sin exigirlos');

rollback;
