-- La OC sin número en lo que escribe la base (migración 20261022200000): la OC
-- de antes de la serie OC-…-MW se nombra «OC sin número (ref. del proveedor …)»
-- en los avisos, los mensajes y los nombres que la base devuelve armados, y no
-- con su referencia como si fuera su número. La OC con número sigue con su
-- número. Y el aviso de permiso de Adquisiciones ya no nombra puestos.
-- Cada paso con el rol que lo da —Requerimientos, Almacén, Logística, Gerencia y
-- Ventas— y `set local role authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'VENDEDOR:VEN'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.429@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 429', lower(replace(v, ':', '.')) || '.429@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  -- Otra persona de Logística: el aviso «Programa el recojo» no le llega a quien emitió la OC.
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'comprador2.log.429@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
  select v_id, 'COMPRADOR', 'Check 429 (2)', 'comprador2.log.429@prueba.local', r.id,
         (select id from public.areas where codigo = 'LOG')
    from public.roles r where r.codigo = 'COMPRADOR';
  perform set_config('prueba.comprador2', v_id::text, true);
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK429-PLA', 'Plancha LAF 2 mm 4x8 (429)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000429' || d, 'Proveedor de prueba 429', 'Av. Argentina 429, Lima', '999 429 429' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000429' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'oc1', 'oc2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
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

-- ============================================ 0. El nombre
do $$
begin
  perform test.afirmar(public.nombre_de_oc('OC-0005-MW', 'COT-77') = 'OC-0005-MW', 'con número, su número');
  perform test.afirmar(public.nombre_de_oc(null, 'OC-0001') = 'OC sin número (ref. del proveedor OC-0001)',
                       'sin número, «OC sin número» con la referencia del proveedor aparte');
  perform test.afirmar(public.nombre_de_oc('  ', ' OC-0001 ') = 'OC sin número (ref. del proveedor OC-0001)',
                       'un número en blanco no es un número, y la referencia va sin espacios de más');
  perform test.afirmar(public.nombre_de_oc(null, null) = 'OC sin número', 'sin nada, «OC sin número» a secas');
  perform test.afirmar(not has_function_privilege('anon', 'public.nombre_de_oc(text, text)', 'execute')
                       and has_function_privilege('authenticated', 'public.nombre_de_oc(text, text)', 'execute'),
                       'el nombre: una sesión sí, anon no');
  -- Ninguna función vuelve a armar «OC » || referencia: una migración que copie una
  -- versión anterior de alguna lo reabriría sin que nada avise.
  perform test.afirmar(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public'
                                      and (p.prosrc ~ '''OC '' *\|\| *[a-z_]+\.referencia'
                                           or p.prosrc ~ 'Adquisiciones la ven'
                                           or p.prosrc ~ 'Lo ve Contabilidad\.'
                                           or p.prosrc ~ 'El pago de la OC lo ven'
                                           or p.prosrc ~* '(la orden de compra|la compra) %')),
                       'ninguna función nombra la OC con «OC » || referencia ni el aviso viejo de Adquisiciones');
  -- Y las que la nombraban con coalesce(numero, referencia) en sus mensajes ya no lo hacen.
  perform test.afirmar(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public'
                                      and p.proname = any (array['anular_guia_remision', 'aprobar_compra', 'cargar_guia_remision',
                                                                 'corregir_orden_compra', 'corregir_requerimiento',
                                                                 'emitir_compra_de_requerimientos', 'evaluar_aprobacion_compra',
                                                                 'fijar_datos_compra', 'fn_adquisicion_oc_valida',
                                                                 'fn_compra_con_factura_no_cambia_pago', 'fn_compra_pagada_no_cambia',
                                                                 'fn_compra_recojo', 'mandar_compra_a_recojo',
                                                                 'marcar_compra_dejada_almacen', 'marcar_compra_en_recojo',
                                                                 'marcar_compra_recogida', 'programar_recojo',
                                                                 'quitar_recojo_de_la_lista', 'rechazar_compra', 'validar_ingresos_compra'])
                                      and p.prosrc ~ 'coalesce\([a-z_]+\.numero, *[a-z_]+\.referencia\)'),
                       'las que nombraban la OC con coalesce(numero, referencia) en sus mensajes ya no lo hacen');
end $$;

-- ============================================ 1. Un RQ con dos OC, una de antes de la serie
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/29', 'Armado del chasis de la plataforma 29', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 2) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id('oc' || n), pg_temp.id('rq'),
    array[n::smallint], pg_temp.id('proveedor'), null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', false)
  from generate_series(1, 2) n;
set constraints all immediate;
reset role;
-- La segunda pasa a ser de antes de la serie: sin número, y su referencia es la
-- cotización del proveedor, con la misma forma que un número de OC.
alter table public.ordenes_compra_materiales disable trigger user;
update public.ordenes_compra_materiales set numero = null, referencia = 'OC-0429' where id = pg_temp.id('oc2');
alter table public.ordenes_compra_materiales enable trigger user;
select set_config('prueba.num1', (select numero from public.ordenes_compra_materiales where id = pg_temp.id('oc1')), true);

-- ============================================ 2. Gerencia las aprueba: los avisos
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 2) n;
reset role;
-- Al aprobarse, Logística recibe «Programa el recojo» de cada una.
select test.afirmar(exists (select 1 from public.notificaciones
                             where usuario_id = pg_temp.id('comprador2') and origen_id = pg_temp.id('oc2')
                               and titulo = 'Programa el recojo: OC sin número (ref. del proveedor OC-0429)')
                    and exists (select 1 from public.notificaciones
                                 where usuario_id = pg_temp.id('comprador2') and origen_id = pg_temp.id('oc1')
                                   and titulo = 'Programa el recojo: ' || current_setting('prueba.num1')),
  'el aviso a Logística dice «OC sin número (ref. del proveedor …)» de la una y el número de la otra');
-- Ningún aviso de la de antes de la serie deja la referencia suelta, como si fuera su número.
select test.afirmar(not exists (select 1 from public.notificaciones
                                 where origen_id = pg_temp.id('oc2')
                                   and replace(titulo || ' ' || coalesce(cuerpo, ''), 'ref. del proveedor OC-0429', '') like '%OC-0429%'),
  'ningún aviso de la OC sin número nombra su referencia como número');
-- Logística quiere volver a comprar el insumo que ya va en ella: el mensaje la nombra bien.
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(format($q$ select public.emitir_compra_de_requerimientos(gen_random_uuid(),
                                     '[{"material_id": "%s", "cantidad": 3, "precio": 10, "insumos": ["%s"]}]'::jsonb,
                                     '%s', null, null, 'CONTADO', 0, 'PEN', false) $q$,
                               current_setting('prueba.mat'),
                               (select id from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq') and item = 2),
                               current_setting('prueba.proveedor')),
  'el insumo que ya va en la OC sin número no va en otra, y el mensaje no hace pasar su referencia por número',
  'Ya va en otra compra: el 2 del ' || (select numero from public.requerimientos where id = pg_temp.id('rq'))
    || ', en la OC sin número (ref. del proveedor OC-0429). Desmárcalo');
reset role;

-- ============================================ 3. La lista de las que se pueden anular, y la anulada
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select numero from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc2'))
                      = 'OC sin número (ref. del proveedor OC-0429)'
                    and (select numero from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc1'))
                      = current_setting('prueba.num1'),
  'en la lista de las que se pueden anular, la de antes de la serie sale «OC sin número (ref. …)» y la otra con su número');
select public.anular_orden_compra(pg_temp.id('oc2'), 'El proveedor ya no tiene la plancha');
-- En Aprobación, entre las decididas, la pantalla recibe el número tal cual (vacío
-- en la de antes de la serie) y la referencia aparte, y la nombra ella.
select test.afirmar((select numero is null and referencia = 'OC-0429' from public.documentos_por_aprobar() where id = pg_temp.id('oc2'))
                    and (select numero from public.documentos_por_aprobar() where id = pg_temp.id('oc1')) = current_setting('prueba.num1'),
  'Aprobación recibe la OC sin número sin la referencia en el lugar del número, y la otra con su número');
select test.debe_fallar($$ select public.aprobar_compra(pg_temp.id('oc2')) $$,
  'la anulada no se aprueba, y el mensaje no hace pasar la referencia por número',
  'La OC sin número (ref. del proveedor OC-0429) no está esperando aprobación');
reset role;
-- El disparador que la congela es la última puerta: la tabla no tiene política de
-- UPDATE, así que solo llegan a él las funciones de la base. Se le escribe como
-- ellas, sin rol.
select test.debe_fallar($$ update public.ordenes_compra_materiales set motivo = 'Otro motivo' where id = pg_temp.id('oc2') $$,
  'la anulada queda congelada y el mensaje la nombra bien',
  'La OC sin número (ref. del proveedor OC-0429) está anulada');

-- ============================================ 4. Quien no ve Adquisiciones
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.compras_sin_factura()', 'Ventas no ve Adquisiciones, y el aviso no nombra puestos',
  'No tienes permiso para ver Adquisiciones.');
select test.debe_fallar($$ select * from public.situacion_de_pago_de_compra(pg_temp.id('oc1')) $$,
  'ni el pago de la OC', 'No tienes permiso para ver el pago de la OC.');
select test.debe_fallar('select * from public.devoluciones_sin_nota_credito()',
  'ni lo que espera nota de crédito, con el mismo aviso', 'No tienes permiso para ver Adquisiciones.');
reset role;

rollback;
