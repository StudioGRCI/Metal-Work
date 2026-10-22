-- La OC aprobada se anula con motivo (migración 20261022150000, decisión de DKS
-- del 21/10): Gerencia —el puesto que aprueba las compras— la anula con su motivo
-- mientras nada entró ni quedó pagado; la OC «Devuelta» (pagada por la boleta y
-- devuelta entera) se anula igual. Sus líneas vuelven a quedar por comprar, la OC
-- sale de la lista del conductor y queda congelada como evidencia.
-- Cada paso con el rol que lo da —Requerimientos, Almacén, Logística, Gerencia,
-- Tesorería, Contabilidad y el conductor— y `set local role authenticated`.
-- Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'CONTABILIDAD:CON',
                           'TESORERIA:TES', 'CONDUCTOR:LOG'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.422@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 422', lower(replace(v, ':', '.')) || '.422@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK422-PLA', 'Plancha LAF 2 mm 4x8 (422)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000422' || d, 'Proveedor de prueba 422', 'Av. Argentina 422, Lima', '999 422 422' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000422' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'oc1', 'oc2', 'oc3', 'oc4', 'oc5', 'oc6', 'oc7', 'p4', 'dv4', 'f5', 'd5', 'd2'] loop
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
-- Una OC por cada insumo del RQ, de tres planchas a S/ 120.50.
create or replace function pg_temp.generar(p_oc text, p_item smallint, p_con_factura boolean) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(pg_temp.id(p_oc), pg_temp.id('rq'),
    array[p_item], pg_temp.id('proveedor'), null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', p_con_factura);
$$;
create or replace function pg_temp.anular(p_oc text, p_motivo text default 'El proveedor ya no tiene la plancha') returns uuid
language sql as $$
  select public.anular_orden_compra(pg_temp.id(p_oc), p_motivo);
$$;
create or replace function pg_temp.subir(p_bucket text, p_carpeta text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_carpeta) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, v_ruta, auth.uid()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  return v_ruta;
end $$;
create or replace function pg_temp.avisos(p_clave text, p_oc text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and origen_id = pg_temp.id(p_oc) and titulo like p_titulo || '%';
$$;

-- ============================================ 0. Puertas
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.anular_orden_compra(uuid, text)', 'execute')
                       and has_function_privilege('authenticated', 'public.anular_orden_compra(uuid, text)', 'execute')
                       and not has_function_privilege('anon', 'public.compras_que_se_pueden_anular()', 'execute')
                       and has_function_privilege('authenticated', 'public.compras_que_se_pueden_anular()', 'execute'),
                       'anular y la lista: una sesión sí, anon no');
  perform test.afirmar(not has_function_privilege('authenticated', 'public.motivo_para_no_anular_compra(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_compra_anulada_congelada()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_hijo_de_compra_anulada()', 'execute'),
                       'el motivo y los disparadores los llama el sistema');
end $$;

-- ============================================ 1. Un RQ con siete OC
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/22', 'Armado del chasis de la plataforma 22', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 6) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
-- La 5 va con factura; las demás, con boleta. La 6 se queda esperando a Gerencia.
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc' || n, n::smallint, n = 5) from generate_series(1, 6) n;
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 5) n;
reset role;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);
-- El aviso a Gerencia no le dice «sin requerimiento» a la OC que compra insumos de un RQ.
select test.afirmar((select count(*) from public.notificaciones
                      where usuario_id = pg_temp.id('gerente') and origen_id = pg_temp.id('oc6')) > 0
                    and not exists (select 1 from public.notificaciones
                                     where origen_id = pg_temp.id('oc6') and cuerpo like '%sin requerimiento%'),
  'Gerencia recibe «Compra por aprobar» de la OC del RQ sin «Directa, sin requerimiento»');

-- ============================================ 2. Solo Gerencia, con motivo, y solo lo aprobado
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc1') $$, 'Logística no anula la OC', 'Solo el puesto que aprueba');
select test.debe_fallar($$ select * from public.compras_que_se_pueden_anular() $$, 'ni pide la lista', 'Solo el puesto que aprueba');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc1') $$, 'Tesorería tampoco', 'Solo el puesto que aprueba');
reset role;
-- Nadie la marca anulada a mano: sin anular_orden_compra no queda el motivo ni se sueltan las líneas.
select test.debe_fallar($$ update public.ordenes_compra_materiales
                              set aprobacion = 'ANULADA', anulada_en = now(), anulada_por = pg_temp.id('gerente'),
                                  motivo_anulacion = 'Marcada a mano sin la función'
                            where id = pg_temp.id('oc1') $$,
  'ni el dueño de la base la anula por fuera de la función', 'se anula desde Aprobación de compras');

select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc1', 'corto') $$, 'sin motivo no se anula', 'motivo de la anulación');
select test.debe_fallar($$ select pg_temp.anular('oc6') $$, 'la que espera aprobación se rechaza, no se anula', 'espera aprobación');
select test.afirmar((select impide is null and monto = 361.50 and aprobacion = 'APROBADA' and codigos = array['PLA_SR_O4_1_26/22']
                       from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc1')),
  'Gerencia ve la OC aprobada en la lista de las que puede anular, con su monto y su código');
select test.afirmar((select count(*) from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc6')) = 0,
  'la que espera aprobación no está en esa lista');
reset role;

-- ============================================ 3. Anulada en la lista del conductor
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(pg_temp.id('oc1'), 45, null);
reset role;
select test.afirmar((select count(*) from public.programacion_recojo where orden_compra_id = pg_temp.id('oc1')) = 1,
  'la OC está en la lista del conductor');
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.anular('oc1') = pg_temp.id('oc1'), 'Gerencia anula la OC aprobada con su motivo');
select test.afirmar(pg_temp.anular('oc1') = pg_temp.id('oc1'), 'el reintento no hace nada');
select test.afirmar((select count(*) from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc1')) = 0,
  'la anulada ya no se ofrece para anular');
reset role;
select test.afirmar((select aprobacion = 'ANULADA' and anulada_por = pg_temp.id('gerente') and anulada_en is not null
                            and motivo_anulacion = 'El proveedor ya no tiene la plancha' and recojo is null
                            and jsonb_array_length(lineas_anuladas) = 1
                            and (lineas_anuladas->0->>'cantidad')::numeric = 3
                            and (lineas_anuladas->0->>'precio_unitario')::numeric = 120.50
                            and lineas_anuladas->0->>'material_codigo' = 'CHK422-PLA'
                       from public.ordenes_compra_materiales where id = pg_temp.id('oc1')),
  'queda con quién, cuándo y por qué, y sus líneas escritas en la OC');
select test.afirmar(not exists (select 1 from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oc1'))
                    and not exists (select 1 from public.programacion_recojo where orden_compra_id = pg_temp.id('oc1')),
  'sus líneas se soltaron y salió de la lista del conductor');
select test.afirmar((select orden_compra_detalle_id is null from public.requerimiento_lineas
                      where requerimiento_id = pg_temp.id('rq') and orden_compra_id = pg_temp.id('oc1')),
  'el insumo del RQ ya no apunta a ninguna línea de compra');
select test.afirmar(pg_temp.avisos('comprador', 'oc1', 'Compra anulada:') = 1,
  'a Logística le llega la anulación con su motivo');
select test.afirmar(pg_temp.avisos('conductor', 'oc1', 'No recojas') = 1,
  'y al conductor, que no la recoja');
select test.afirmar((select ruta = '/recojos' from public.notificaciones
                      where usuario_id = pg_temp.id('conductor') and origen_id = pg_temp.id('oc1') and titulo like 'No recojas%'),
  'el aviso del conductor lo lleva a su lista de recojos');
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select monto = 361.50 and lineas = 1
                       from public.ordenes_compra_listado() where id = pg_temp.id('oc1')),
  'en Órdenes de compra la anulada sigue diciendo qué se pidió y por cuánto');
reset role;

-- Lo que cuenta la anulada.
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select pago = 'NO_SE_PAGA' and total is null and motivo_anulacion = 'El proveedor ya no tiene la plancha'
                            and anulado_en is not null
                       from public.trazabilidad_de_compras() where id = pg_temp.id('oc1')),
  'en Adquisiciones la anulada no se paga, sin total, con su motivo');
reset role;

-- El insumo se vuelve a comprar.
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.generar('oc7', 1::smallint, false) = pg_temp.id('oc7'),
  'Logística vuelve a comprar el insumo de la OC anulada');
set constraints all immediate;
select test.debe_fallar($$ select public.programar_recojo(pg_temp.id('oc1'), 45, null) $$,
  'la anulada no vuelve a la lista del conductor', 'no va con el conductor');
reset role;

-- Congelada.
select test.debe_fallar($$ update public.ordenes_compra_materiales set referencia = 'Otra' where id = pg_temp.id('oc1') $$,
  'la anulada no cambia, ni para el dueño de la base', 'queda como evidencia');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.registrar_pago_compra(gen_random_uuid(), pg_temp.id('oc1'), current_setting('prueba.hoy')::date,
                                 10, false, null, null, pg_temp.subir('pagos-compras', 'oc1'), current_setting('prueba.caja')::uuid, null) $$,
  'a la anulada no se le paga', 'no está aprobada');
reset role;

-- ============================================ 4. En camino: sale de la lista; recogida: ya no
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(pg_temp.id('oc' || n), 30, null) from generate_series(2, 3) n;
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.id('oc2'));
select public.marcar_compra_en_recojo(pg_temp.id('oc3'));
select public.marcar_compra_recogida(pg_temp.id('oc3'));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select pg_temp.anular('oc2', 'Se compró a otro proveedor más cerca');
select test.debe_fallar($$ select pg_temp.anular('oc3') $$, 'la que el conductor ya recogió no se anula', 'no se anula');
select test.afirmar((select impide is not null from public.compras_que_se_pueden_anular() where id = pg_temp.id('oc3')),
  'y la lista dice por qué');
reset role;
select test.afirmar((select aprobacion = 'ANULADA' and recojo is null from public.ordenes_compra_materiales where id = pg_temp.id('oc2')),
  'la que el conductor iba a recoger se anula y sale de su ruta');
select test.afirmar(pg_temp.avisos('conductor', 'oc2', 'No recojas') = 1, 'y él se entera');
-- Dejada en Almacén: tampoco.
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_dejada_almacen(pg_temp.id('oc3'));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc3') $$, 'la que entró a Almacén no se anula', 'ya entró a Almacén');
reset role;

-- ============================================ 5. Pagada por la boleta: solo devuelta entera
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_compra(pg_temp.id('p4'), pg_temp.id('oc4'), current_setting('prueba.hoy')::date,
  100, false, 'OP-422', 'B001-422', pg_temp.subir('pagos-compras', 'oc4'), current_setting('prueba.caja')::uuid, null);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc4') $$, 'con lo pagado sin devolver no se anula', 'el proveedor tiene que devolverlo');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_devolucion_compra(pg_temp.id('dv4'), pg_temp.id('oc4'), current_setting('prueba.hoy')::date,
  100, 'DEV-422', pg_temp.subir('pagos-compras', 'oc4'), current_setting('prueba.caja')::uuid, null, false);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.anular('oc4', 'El proveedor devolvió todo, no tenía stock') = pg_temp.id('oc4'),
  'la OC devuelta entera se anula');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.anular_devolucion_compra(pg_temp.id('dv4'), 'Se registró por error en esta orden') $$,
  'lo que quedó en cero se queda en cero: su devolución no se anula después', 'pasaría de su total');
select test.debe_fallar($$ select public.anular_pago_compra(pg_temp.id('p4'), 'Se registró por error en esta orden') $$,
  'ni su pago', 'devolución');
reset role;
-- Y si alguna guardia de Tesorería cambiara, la de la anulada sigue ahí.
select test.debe_fallar($$ update public.devoluciones_orden_compra
                              set anulado_en = now(), anulado_por = pg_temp.id('tesoreria'), motivo_anulacion = 'Por fuera de la función'
                            where id = pg_temp.id('dv4') $$,
  'la devolución de la anulada no cambia ni por la tabla', 'no se le registran ni se le anulan devoluciones');

-- ============================================ 6. Con factura: primero se corrige
-- El PDF, como superusuario (Storage tiene su política aparte); el anexo, con el rol de Logística.
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('oc5') || '/' || pg_temp.id('d5') || '.pdf', pg_temp.id('comprador'),
        pg_temp.id('comprador')::text, '{"mimetype": "application/pdf", "size": 2048}');
select pg_temp.como('comprador');
set local role authenticated;
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                               subido_por, numero_documento, fecha_emision)
values (pg_temp.id('d5'), pg_temp.id('oc5'), 'FACTURA', 'factura.pdf', 'compra/' || pg_temp.id('oc5') || '/' || pg_temp.id('d5') || '.pdf',
        'application/pdf', 2048, pg_temp.id('comprador'), 'F009-422', current_setting('prueba.hoy')::date);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc5') $$, 'con el anexo de factura vigente no se anula', 'Logística le anexó');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f5'), 'FACTURA_COMPRA', 'Proveedor de prueba 422', 'F001-422', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 426.57, 'CONTADO');
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (pg_temp.id('f5'), pg_temp.id('oc5'));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anular('oc5') $$, 'con la factura de Contabilidad no se anula', 'Contabilidad registró la factura');
reset role;

-- ============================================ 7. Nada nuevo se le cuelga
select test.debe_fallar($$ insert into public.programacion_recojo (orden_compra_id, peso_kg, programado_por)
                            values (pg_temp.id('oc2'), 10, pg_temp.id('comprador')) $$,
  'la anulada no entra a la lista del conductor ni por la tabla', 'no va a la lista del conductor');
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('oc2') || '/' || pg_temp.id('d2') || '.pdf', pg_temp.id('comprador'),
        pg_temp.id('comprador')::text, '{"mimetype": "application/pdf", "size": 2048}');
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type,
                                                                          tamano_bytes, subido_por)
                            values (pg_temp.id('d2'), pg_temp.id('oc2'), 'COTIZACION', 'cotizacion.pdf', 'compra/' || pg_temp.id('oc2') || '/' || pg_temp.id('d2') || '.pdf',
                                    'application/pdf', 2048, pg_temp.id('comprador')) $$,
  'a la anulada Logística no le adjunta documentos', 'no se le adjuntan documentos');
reset role;

rollback;
