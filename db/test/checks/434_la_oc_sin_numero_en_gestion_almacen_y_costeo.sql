-- La OC sin número tampoco pasa por un número de OC en Gestión de compras, Almacén
-- y Costeo (migración 20261023130000). La OC de antes de la serie OC-…-MW no tiene
-- número, y su referencia es la cotización del proveedor, con la forma de un número
-- de OC («OC-0434»). Diez funciones daban `coalesce(numero, referencia)`: la
-- referencia en el lugar del número, sin que la pantalla pudiera saberlo.
--   · Gestión de compras, Recojos y Órdenes de compra reciben el número tal cual
--     (vacío en la de antes de la serie) y la referencia aparte.
--   · Contabilidad (guías por emitir), Almacén (ingresos por validar y el documento
--     del kardex cuando la guía va en blanco), el avance de cada RQ y el Costeo
--     reciben el nombre armado: «OC sin número (ref. del proveedor OC-0434)».
--   · La OC con número sale igual que antes, y el insumo sin OC sigue sin OC.
--
-- Un RQ del código PLA_SR_O4_1_26/34 con tres insumos: el 1 va en la OC1 (con
-- número), el 2 en la OC2 (con factura, que pasa a ser de antes de la serie) y el 3
-- no tiene OC. Las dos OC llegan en partes: una boleta de una parte con IGV y la
-- factura del resto, y Contabilidad registra contra cada factura una nota de
-- crédito por descuento. Así cada línea del Costeo que nombra la OC sale para las dos.
--
-- Cada afirmación con la cuenta del puesto que usa esa pantalla —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'CONDUCTOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GGE',
                           'CONTABILIDAD:CON', 'SUPERVISOR:MTZ'] loop
    -- Maestranza tiene una sola cuenta activa de Supervisión (fn_una_supervision_por_area):
    -- si la base ya la tiene, como en una copia de producción, la prueba usa esa.
    v_id := null;
    if v = 'SUPERVISOR:MTZ' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id
        join public.areas a on a.id = u.area_id
       where r.codigo = 'SUPERVISOR' and a.codigo = 'MTZ' and u.activo
       limit 1;
    end if;
    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.434@prueba.local');
      insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
      select v_id, split_part(v, ':', 1), 'Check 434', lower(replace(v, ':', '.')) || '.434@prueba.local', r.id,
             (select id from public.areas where codigo = split_part(v, ':', 2))
        from public.roles r where r.codigo = split_part(v, ':', 1);
    end if;
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from unnest(array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'CONDUCTOR:LOG', 'ALMACENERO:ALM',
                                                          'GERENTE:GGE', 'CONTABILIDAD:CON', 'SUPERVISOR:MTZ']) x
                          join public.usuarios u on u.id = current_setting('prueba.' || lower(split_part(x, ':', 1)))::uuid and u.activo
                          join public.roles r on r.id = u.rol_id and r.codigo = split_part(x, ':', 1)
                          join public.areas a on a.id = u.area_id and a.codigo = split_part(x, ':', 2)) = 7,
    'el check tiene sus siete cuentas, cada una activa, con su puesto y su área');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK434-PLA', 'Plancha LAF 2 mm 4x8 (434)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000434' || d, 'Proveedor de prueba 434', 'Av. Argentina 434, Lima', '999 434 434' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000434' || d)
     and not exists (select 1 from public.proveedores p where p.numero_documento = '2060000434' || d)
   limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.ruc', (select numero_documento from public.proveedores where id = v::uuid), true);
  foreach v in array array['rq', 'oc1', 'oc2', 'b1', 'b2', 'f1', 'f2', 'nc1', 'nc2', 'mov1', 'mov2', 'mov_a', 'mov_b'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.codigo', public.normalizar_codigo_interno('PLA_SR_O4_1_26/34'), true);
  -- Lo que se espera de la OC de antes de la serie: el nombre, no la referencia.
  perform set_config('prueba.nombre2', 'OC sin número (ref. del proveedor OC-0434)', true);
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
-- Logística anexa a la OC la boleta de una parte con IGV, como `registrarDocumentoCompra`.
create or replace function pg_temp.anexar_parte(p_doc text, p_oc text, p_numero text, p_monto numeric)
returns void language plpgsql as $$
declare v_ruta text := 'compra/' || pg_temp.id(p_oc) || '/' || pg_temp.id(p_doc) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-compras', v_ruta, auth.uid(), auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                                 subido_por, numero_documento, fecha_emision, monto_de_la_parte, parte_trae_igv)
  values (pg_temp.id(p_doc), pg_temp.id(p_oc), 'COMPROBANTE', 'boleta-' || p_numero || '.pdf', v_ruta, 'application/pdf', 2048,
          public.usuario_actual(), p_numero, current_setting('prueba.hoy')::date, p_monto, true);
end $$;
-- El archivo de la nota de crédito, como lo deja Storage a quien la sube (como el 427).
create or replace function pg_temp.archivo(p_carpeta text, p_id text, p_quien text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_carpeta) || '/' || pg_temp.id(p_id) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('notas-credito', v_ruta, pg_temp.id(p_quien), pg_temp.id(p_quien)::text, '{"mimetype": "application/pdf", "size": 2048}');
  return v_ruta;
end $$;
-- La OC de cada insumo en el avance del RQ, leída con la sesión puesta.
create or replace function pg_temp.oc_del_insumo(p_item int) returns jsonb language sql as $$
  select l->'orden_compra' from public.avance_de_requerimientos(array[pg_temp.id('rq')]) a,
         jsonb_array_elements(a.lineas) l where (l->>'item')::int = p_item;
$$;
create or replace function pg_temp.etapa_del_insumo(p_item int) returns text language sql as $$
  select l->>'etapa' from public.avance_de_requerimientos(array[pg_temp.id('rq')]) a,
         jsonb_array_elements(a.lineas) l where (l->>'item')::int = p_item;
$$;
-- El documento de la única línea del Costeo (Gerencia) o del gasto por código
-- (Requerimientos) que nace de `p_ref`: la OC, la boleta de una parte o la nota.
create or replace function pg_temp.doc_costeo(p_ref text) returns text language sql as $$
  select case when count(*) = 1 then min(c.documento) end
    from public.codigo_interno_costeo(current_setting('prueba.codigo')) c where c.referencia_id = pg_temp.id(p_ref);
$$;
create or replace function pg_temp.doc_gasto(p_ref text) returns text language sql as $$
  select case when count(*) = 1 then min(g.documento) end
    from public.codigo_interno_gasto(current_setting('prueba.codigo')) g where g.referencia_id = pg_temp.id(p_ref);
$$;

-- ============================================ 1. Un RQ de tres insumos: dos con OC, uno sin
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/34', 'Armado del chasis de la plataforma 34', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 3) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
-- Logística compra el insumo 1 en la OC1 y el 2 en la OC2, las dos con factura. El 3 se queda sin OC.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id('oc' || n), pg_temp.id('rq'), array[n::smallint], pg_temp.id('proveedor'), null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 100)),
  null, 'CONTADO', 0, 'PEN', true)
  from generate_series(1, 2) n;
set constraints all immediate;
reset role;
-- La OC2 pasa a ser de antes de la serie: sin número, y su referencia es la
-- cotización del proveedor, con la misma forma que un número de OC.
alter table public.ordenes_compra_materiales disable trigger user;
update public.ordenes_compra_materiales set numero = null, referencia = 'OC-0434' where id = pg_temp.id('oc2');
alter table public.ordenes_compra_materiales enable trigger user;
select set_config('prueba.num1', (select numero from public.ordenes_compra_materiales where id = pg_temp.id('oc1')), true);
select test.afirmar(current_setting('prueba.num1') ~ '^OC-[0-9]+-MW$'
                    and current_setting('prueba.num1') <> 'OC-0434',
  'la OC1 tiene su número de la serie OC-…-MW, distinto de la referencia de la OC2');
select test.afirmar((select count(*) from public.requerimiento_lineas
                      where requerimiento_id = pg_temp.id('rq') and item = 3 and orden_compra_id is null) = 1,
  'el insumo 3 no va en ninguna OC');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 2) n
 where (select aprobacion from public.ordenes_compra_materiales where id = pg_temp.id('oc' || n)) = 'POR_APROBAR';
reset role;
-- Logística las pone en la lista del conductor con su peso, y anexa a cada una la
-- boleta de una parte con IGV (S/ 118: S/ 18 de IGV que no se recupera).
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(pg_temp.id('oc' || n)) from generate_series(1, 2) n;
select public.programar_recojo(pg_temp.id('oc' || n), 40, null) from generate_series(1, 2) n;
select pg_temp.anexar_parte('b1', 'oc1', 'B001-4341', 118);
select pg_temp.anexar_parte('b2', 'oc2', 'B001-4342', 118);
reset role;

-- ============================================ 2. Gestión de compras, Recojos y Órdenes de compra
-- El número tal cual —vacío en la de antes de la serie— y la referencia aparte: la
-- pantalla la nombra con nombreDeOc.
select pg_temp.como('conductor');
set local role authenticated;
-- El conductor no lee la tabla de compras: no tiene cómo saber que «OC-0434» no es un
-- número. Por eso lo arregla la base y no la pantalla.
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id in (pg_temp.id('oc1'), pg_temp.id('oc2'))) = 0,
  'el conductor no lee la fila de la OC en la tabla de compras');
select test.afirmar((select numero is null and referencia = 'OC-0434' from public.compras_en_gestion() where id = pg_temp.id('oc2')),
  'Gestión de compras, al conductor: la OC sin número llega sin número y con la referencia aparte');
select test.afirmar((select numero from public.compras_en_gestion() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Gestión de compras, al conductor: la OC con número, con su número');
select test.afirmar((select numero is null and referencia = 'OC-0434' from public.compras_para_recojo() where id = pg_temp.id('oc2'))
                    and (select numero from public.compras_para_recojo() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Recojos, al conductor: la OC sin número sin número y con la referencia aparte; la otra, con su número');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select numero is null and referencia = 'OC-0434' from public.compras_en_gestion() where id = pg_temp.id('oc2'))
                    and (select numero from public.compras_en_gestion() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Gestión de compras, a Logística: lo mismo');
select test.afirmar((select numero is null and referencia = 'OC-0434' from public.ordenes_compra_listado() where id = pg_temp.id('oc2'))
                    and (select numero from public.ordenes_compra_listado() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Órdenes de compra, a Logística: la OC sin número sin número y con la referencia aparte; la otra, con su número');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select numero is null and referencia = 'OC-0434' from public.ordenes_compra_listado() where id = pg_temp.id('oc2'))
                    and (select numero from public.ordenes_compra_listado() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Órdenes de compra, a Gerencia: lo mismo');
reset role;

-- ============================================ 3. Las guías por emitir (Contabilidad): el nombre
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select numero from public.guias_por_emitir() where orden_compra_id = pg_temp.id('oc2')) = current_setting('prueba.nombre2')
                    and (select numero from public.guias_por_emitir() where orden_compra_id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'guías por emitir: «OC sin número (ref. del proveedor OC-0434)» de la una y el número de la otra');
reset role;

-- ============================================ 4. El avance del RQ: el nombre, y el insumo sin OC sin OC
-- Requerimientos y Supervisión del área del RQ; Supervisión no lee la tabla de compras.
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(pg_temp.oc_del_insumo(1) = to_jsonb(current_setting('prueba.num1'))
                    and pg_temp.oc_del_insumo(2) = to_jsonb(current_setting('prueba.nombre2')),
  'el avance, a Requerimientos: el insumo 1 va en la OC con su número y el 2 en «OC sin número (ref. …)»');
select test.afirmar(jsonb_typeof(pg_temp.oc_del_insumo(3)) = 'null' and pg_temp.etapa_del_insumo(3) = 'POR_COMPRAR',
  'el insumo 3, sin OC, sigue sin OC y por comprar: no sale «OC sin número»');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id in (pg_temp.id('oc1'), pg_temp.id('oc2'))) = 0,
  'Supervisión no lee la fila de la OC en la tabla de compras');
select test.afirmar(pg_temp.oc_del_insumo(1) = to_jsonb(current_setting('prueba.num1'))
                    and pg_temp.oc_del_insumo(2) = to_jsonb(current_setting('prueba.nombre2'))
                    and jsonb_typeof(pg_temp.oc_del_insumo(3)) = 'null',
  'el avance, a Supervisión de Maestranza: el número, el nombre y nada para el insumo sin OC');
reset role;

-- ============================================ 5. El conductor las recoge y las deja
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.id('oc' || n)) from generate_series(1, 2) n;
select public.marcar_compra_recogida(pg_temp.id('oc' || n)) from generate_series(1, 2) n;
select public.marcar_compra_dejada_almacen(pg_temp.id('oc' || n)) from generate_series(1, 2) n;
reset role;
-- Lo que Almacén va a validar de cada OC, con el id del ingreso de cada intento.
select set_config('prueba.lineas_' || x.oc || '_' || x.mov,
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.' || x.mov), 'cantidad', i.cantidad))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id(x.oc))::text, true)
  from (values ('oc1', 'mov1'), ('oc2', 'mov2'), ('oc2', 'mov_a'), ('oc2', 'mov_b')) as x(oc, mov);
select test.afirmar((select count(*) from public.ingresos_pendientes_almacen
                      where orden_compra_id in (pg_temp.id('oc1'), pg_temp.id('oc2')) and estado = 'PENDIENTE') = 2,
  'el conductor dejó una línea de cada OC para validar');

-- ============================================ 6. Almacén: lo que valida, el kardex y lo que puede devolver
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select referencia from public.ingresos_por_validar() where orden_compra_id = pg_temp.id('oc2')) = current_setting('prueba.nombre2')
                    and (select referencia from public.ingresos_por_validar() where orden_compra_id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'ingresos por validar: la cabecera de la OC sin número es su nombre, no su referencia; la otra, su número');
reset role;

-- Guía en blanco (null): el kardex guarda el nombre de la OC sin número.
savepoint sin_guia;
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc2'), current_setting('prueba.lineas_oc2_mov_a')::jsonb, null);
select test.afirmar((select documento from public.v_kardex_almacen where id = pg_temp.id('mov_a')) = current_setting('prueba.nombre2'),
  'sin guía, el documento del kardex de la OC sin número es su nombre');
reset role;
rollback to savepoint sin_guia;

-- Con la guía escrita, la guía.
savepoint con_guia;
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc2'), current_setting('prueba.lineas_oc2_mov_b')::jsonb, 'GR 001-0434');
select test.afirmar((select documento from public.v_kardex_almacen where id = pg_temp.id('mov_b')) = 'GR 001-0434',
  'con la guía escrita, el kardex guarda la guía');
reset role;
rollback to savepoint con_guia;

-- La guía en espacios es una guía en blanco. Estos dos ingresos se quedan.
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc2'), current_setting('prueba.lineas_oc2_mov2')::jsonb, '   ');
select public.validar_ingresos_compra(pg_temp.id('oc1'), current_setting('prueba.lineas_oc1_mov1')::jsonb, '  ');
select test.afirmar((select documento from public.v_kardex_almacen where id = pg_temp.id('mov2')) = current_setting('prueba.nombre2'),
  'con la guía en espacios, el kardex de la OC sin número guarda su nombre');
select test.afirmar((select documento from public.v_kardex_almacen where id = pg_temp.id('mov1')) = current_setting('prueba.num1'),
  'y el de la OC con número, en blanco, su número');
select test.afirmar((select compra = current_setting('prueba.nombre2') and documento = current_setting('prueba.nombre2')
                       from public.ingresos_para_devolver() where ingreso_id = pg_temp.id('mov2'))
                    and (select compra = current_setting('prueba.num1') and documento = current_setting('prueba.num1')
                           from public.ingresos_para_devolver() where ingreso_id = pg_temp.id('mov1')),
  'lo que se puede devolver: la OC sin número y su documento con su nombre; la otra, con su número');
reset role;

-- ============================================ 7. Las facturas del resto y sus notas de crédito
-- Contabilidad registra la factura del resto de cada OC (354 − 118 = 236) y, contra
-- cada una, una nota de crédito por descuento (como el 427).
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, orden_compra_id)
select pg_temp.id('f' || n), 'FACTURA_COMPRA', 'Proveedor de prueba 434', current_setting('prueba.ruc'), 'F001-434' || n,
       current_setting('prueba.hoy')::date - 5, current_setting('prueba.hoy')::date - 5, 'PEN', 236, 'CONTADO', pg_temp.id('oc' || n)
  from generate_series(1, 2) n;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f' || n) || '/comprobante.pdf', auth.uid()::text,
       '{"mimetype": "application/pdf", "size": 2048}'
  from generate_series(1, 2) n;
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
 where id in (pg_temp.id('f1'), pg_temp.id('f2'));
reset role;
select test.afirmar((select count(*) from public.adquisiciones where id in (pg_temp.id('f1'), pg_temp.id('f2')) and estado = 'REGISTRADA') = 2,
  'las dos facturas quedaron registradas');
select pg_temp.archivo('f' || n, 'nc' || n, 'contabilidad') from generate_series(1, 2) n;
select pg_temp.como('contabilidad');
set local role authenticated;
select public.registrar_nota_credito(pg_temp.id('nc' || n), pg_temp.id('f' || n), 'FC01-434' || n, current_setting('prueba.hoy')::date, 23.60,
  'DESCUENTO', null, 'Descuento por pronto pago acordado', pg_temp.id('f' || n) || '/' || pg_temp.id('nc' || n) || '.pdf')
  from generate_series(1, 2) n;
reset role;

-- ============================================ 8. El Costeo del código y el gasto por código
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select numero from public.codigo_interno_compras(current_setting('prueba.codigo')) where id = pg_temp.id('oc2')) = current_setting('prueba.nombre2')
                    and (select numero from public.codigo_interno_compras(current_setting('prueba.codigo')) where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'las compras del código, a Gerencia: la OC sin número con su nombre; la otra, con su número');
select test.afirmar(pg_temp.doc_costeo('oc2') = current_setting('prueba.nombre2') and pg_temp.doc_costeo('oc1') = current_setting('prueba.num1'),
  'el Costeo, a Gerencia: la línea de compras de la OC sin número dice su nombre; la otra, su número');
select test.afirmar(pg_temp.doc_costeo('b2') = current_setting('prueba.nombre2') and pg_temp.doc_costeo('b1') = current_setting('prueba.num1'),
  'la línea del IGV de la boleta de una parte, también');
select test.afirmar((select concepto from public.codigo_interno_costeo(current_setting('prueba.codigo')) where referencia_id = pg_temp.id('b2'))
                      = 'IGV de la boleta B001-4342 (una parte)',
  'y es la línea del IGV de su boleta');
select test.afirmar(pg_temp.doc_costeo('nc2') = current_setting('prueba.nombre2') and pg_temp.doc_costeo('nc1') = current_setting('prueba.num1'),
  'la línea de la nota de crédito, también');
select test.afirmar((select concepto = 'Nota de crédito FC01-4342 (descuento)' and monto < 0
                       from public.codigo_interno_costeo(current_setting('prueba.codigo')) where referencia_id = pg_temp.id('nc2')),
  'y es la de su nota, que baja el código');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(pg_temp.doc_gasto('oc2') = current_setting('prueba.nombre2') and pg_temp.doc_gasto('oc1') = current_setting('prueba.num1')
                    and pg_temp.doc_gasto('b2') = current_setting('prueba.nombre2') and pg_temp.doc_gasto('b1') = current_setting('prueba.num1')
                    and pg_temp.doc_gasto('nc2') = current_setting('prueba.nombre2') and pg_temp.doc_gasto('nc1') = current_setting('prueba.num1'),
  'el gasto por código, a Requerimientos: compras, IGV de la boleta y nota de crédito con el nombre de la OC sin número y el número de la otra');
reset role;

-- ============================================ 9. Ninguna función da ya la referencia en el lugar del número
-- La misma guarda con que termina la migración: quitadas las llamadas a
-- nombre_de_oc, ninguna función da coalesce(numero, referencia), con alias o sin
-- él, ni coalesce(…, x.numero, x.referencia). La línea `as compra` de la nota de crédito
-- se perdona solo mientras nadie use `l.compra`.
select test.afirmar((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and regexp_replace(p.prosrc, 'nombre_de_oc\(\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*\)', '', 'g')
                            ~ ('coalesce\(\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*[,)]'
                               '|,\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*\)')
                        and not (p.proname = 'codigo_interno_lineas_nota_credito' and p.prosrc !~ 'l\.compra\M')) = 0,
  'ninguna función de la base da la referencia del proveedor como número de OC');
select test.afirmar((select p.prosrc !~ 'l\.compra\M' and p.prosrc ~ 'l\.nombre_oc::text, l\.id'
                       from pg_proc p where p.oid = 'public.codigo_interno_lineas_nota_credito(text)'::regprocedure),
  'la nota de crédito saca el nombre de la OC como documento y ya no usa l.compra: lo que la guarda le perdona');

-- Qué trae cada columna, en el comentario de cada función.
select test.afirmar(bool_and(position(x.frase in coalesce(obj_description(('public.' || x.funcion)::regprocedure, 'pg_proc'), '')) > 0),
  'el comentario de las ocho funciones dice qué trae su columna')
  from (values
    ('compras_en_gestion()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
    ('compras_para_recojo()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
    ('ordenes_compra_listado()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
    ('guias_por_emitir()', 'numero: el nombre de la OC armado por nombre_de_oc; no sirve para buscarla.'),
    ('ingresos_por_validar()', 'referencia: el nombre de la OC armado por nombre_de_oc, no la referencia del proveedor; no sirve para buscarla.'),
    ('avance_de_requerimientos(uuid[])', 'orden_compra de cada insumo: el nombre de su OC armado por nombre_de_oc, o vacío si no tiene OC.'),
    ('codigo_interno_lineas(text,boolean)', 'documento de las líneas de compras, del IGV de la boleta de una parte y de la nota de crédito: el nombre de la OC armado por nombre_de_oc.'),
    ('codigo_interno_compras(text)', 'numero: el nombre de la OC armado por nombre_de_oc; no sirve para buscarla.')
  ) as x(funcion, frase);

do $$ begin raise notice 'OK 434: la OC sin número no pasa por un número de OC en Gestión de compras, Almacén y Costeo'; end $$;
rollback;
