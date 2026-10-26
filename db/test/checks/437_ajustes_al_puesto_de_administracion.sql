-- Los ajustes al puesto de Administración (migración 20261026100000), cada uno
-- con el rol que lo vive y `set local role authenticated`, nunca ADMIN:
--   * Administración hace la OC de su RQA, y nada más: ni la directa, ni la
--     de un RQ de operación, ni una orden de servicio, ni mover la OC de
--     Logística. Logística sigue igual.
--   * Los avisos de pago de compras le llegan a Logística y no a Administración.
--   * Administración registra clientes.
--   * Aprueba los reportes de los trabajos sin orden, no los de la OT.
--   * La evaluación que Diseño envía le avisa a Administración.
--   * El avance de la OT es el de su código interno.
-- La OC se mira al cerrar la transacción; aquí, `pg_temp.y_cerrar` adelanta
-- esa revisión al final de la sentencia. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS ADMINISTRACION S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE', 'DISENO:DIS', 'REQUERIMIENTOS:REQ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.436@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 436', lower(replace(v, ':', '.')) || '.436@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_rrh', (select id::text from public.areas where codigo = 'RRH'), true);
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rqa', 'rqo', 'oca', 'ocd', 'eva'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK436-1', 'Tóner de impresora (prueba 436)',
          (select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.m1', (select id::text from public.materiales where codigo = 'CHK436-1'), true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999436006', 'Proveedor de prueba 436', 'Av. Argentina 436, Lima', '999 436 436');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999436006'), true);
  update public.regla_aprobacion_compras set activa = true, monto_desde = 0,
         rol_aprobador_id = (select id from public.roles where codigo = 'GERENTE') where unica;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Corre la sentencia y hace la revisión que la base deja para el final de la transacción.
create or replace function pg_temp.y_cerrar(p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  set constraints trg_compra_de_administracion_es_de_su_rqa immediate;
  set constraints trg_compra_de_administracion_es_de_su_rqa deferred;
end $$;

create or replace function pg_temp.insumo(p_rq text) returns text language sql as $$
  select id::text from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = 1;
$$;

create or replace function pg_temp.directa(p_oc text) returns text language sql as $$
  select format($q$select pg_temp.y_cerrar(%L)$q$, format($q$select public.emitir_compra_directa('%s', '%s', null, 'Reposición de tóner del almacén',
                  '[{"material_id": "%s", "cantidad": 2, "precio": 80}]'::jsonb, null, 'CONTADO', 0, 'PEN', true, 'PLANTA')$q$,
                current_setting('prueba.' || p_oc), current_setting('prueba.prov'), current_setting('prueba.m1')));
$$;

-- ============================================ 1. Un RQA y un RQ de operación sin stock
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqa')::uuid, 'ADMINISTRACION', current_setting('prueba.area_rrh')::uuid,
  'OFICINA', 'Tóner para la impresora de la oficina (prueba 436)', null,
  format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqo')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'PLANTA', 'Tóner para la impresora de planta (prueba 436)', null,
  format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rqa')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rqo')::uuid, '[{"item": 1, "en_stock": 0}]', null);
reset role;

-- ============================================ 2. Administración: su RQA sí, lo demás no
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(pg_temp.directa('ocd'), 'Administración no emite una OC directa', 'solo la orden de compra de su RQA');
select test.debe_fallar(
  format($q$select public.emitir_orden_servicio(gen_random_uuid(), '%s', null, null, 'PLANTA', 'Arenado del chasis', null,
            null, null, 'PEN', 800, 'CONTADO', 0, '025', null)$q$, current_setting('prueba.prov')),
  'Administración no emite una orden de servicio', 'lleva Logística');
select test.debe_fallar(
  format($q$select public.emitir_compra_de_requerimientos(gen_random_uuid(), '[{"material_id": "%s", "cantidad": 1, "precio": 80, "insumos": ["%s"]}]'::jsonb,
            '%s', null, null, 'CONTADO', 0, 'PEN', true)$q$, current_setting('prueba.m1'), pg_temp.insumo('rqo'), current_setting('prueba.prov')),
  'Administración no compra el RQ de operación', 'requerimiento de operación');
select pg_temp.y_cerrar(format($q$select public.emitir_compra_de_requerimientos('%s',
  '[{"material_id": "%s", "cantidad": 1, "precio": 80, "insumos": ["%s"]}]'::jsonb, '%s', null, null, 'CONTADO', 0, 'PEN', true)$q$,
  current_setting('prueba.oca'), current_setting('prueba.m1'), pg_temp.insumo('rqa'), current_setting('prueba.prov')));
reset role;
select test.afirmar((select count(*) from public.requerimiento_lineas where orden_compra_id = current_setting('prueba.oca')::uuid) = 1,
  'Administración hace la OC de su RQA');

-- ============================================ 3. Logística sigue igual, y su OC no la mueve Administración
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(current_setting('prueba.ocd')::uuid, current_setting('prueba.prov')::uuid, null,
  'Reposición de tóner del almacén', format('[{"material_id": "%s", "cantidad": 2, "precio": 80}]', current_setting('prueba.m1'))::jsonb,
  null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
-- Lo que la base revisa al cerrar (la aprobación que pide, la OC de Administración), con la sesión de Logística.
set constraints all immediate;
set constraints all deferred;
reset role;
select test.afirmar(exists (select 1 from public.ordenes_compra_materiales where id = current_setting('prueba.ocd')::uuid),
  'Logística emite la OC directa');
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.ocd')::uuid);
select public.aprobar_compra(current_setting('prueba.oca')::uuid);
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format('select pg_temp.y_cerrar(%L)', format('select public.mandar_compra_a_recojo(%L)', current_setting('prueba.ocd'))),
  'Administración no manda al recojo la OC de Logística', 'no nace de un RQA');
reset role;
select test.afirmar((select recojo_pedido_por from public.ordenes_compra_materiales where id = current_setting('prueba.ocd')::uuid)
                      is distinct from current_setting('prueba.administracion')::uuid,
  'la OC de Logística quedó como estaba');

-- ============================================ 4. Los avisos de pago de compras
select public.notificar_a_permiso('compras.crear', 'OC pagada: prueba 436', 'Proveedor de prueba 436 · S/ 80.00',
  '/compras/ordenes', 'ordenes_compra_materiales', current_setting('prueba.ocd')::uuid, null);
select test.afirmar((select count(*) from public.notificaciones
                      where titulo = 'OC pagada: prueba 436' and usuario_id = current_setting('prueba.comprador')::uuid) = 1,
  'el aviso de pago le llega a Logística');
select test.afirmar((select count(*) from public.notificaciones
                      where titulo = 'OC pagada: prueba 436' and usuario_id = current_setting('prueba.administracion')::uuid) = 0,
  'el aviso de pago no le llega a Administración');

-- ============================================ 5. Clientes y reportes
select pg_temp.como('administracion');
set local role authenticated;
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20999436014', 'CLIENTE DE PRUEBA 436 S.A.C.');
reset role;
select test.afirmar(exists (select 1 from public.clientes where numero_documento = '20999436014'), 'Administración registra un cliente');
select test.afirmar(
  exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
           where r.codigo = 'ADMINISTRACION' and rp.permiso_codigo = 'produccion.aprobar_sin_orden')
  and not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                   where r.codigo = 'ADMINISTRACION' and rp.permiso_codigo = 'produccion.aprobar_reportes'),
  'Administración aprueba los reportes de los trabajos sin orden y no los de la OT');

-- ============================================ 6. La evaluación enviada avisa
select pg_temp.como('diseno');
set local role authenticated;
insert into public.diseno_evaluaciones (id, evaluado_nombre, puesto, area_servicio, fecha_evaluacion, respuestas)
values (current_setting('prueba.eva')::uuid, 'Persona de prueba 436', 'Proyectista', 'Ingeniería', current_date,
        array_fill(4::smallint, array[20]));
reset role;
select test.afirmar((select count(*) from public.notificaciones where origen_id = current_setting('prueba.eva')::uuid) = 0,
  'el borrador no avisa');
select pg_temp.como('diseno');
set local role authenticated;
update public.diseno_evaluaciones set estado = 'ENVIADA' where id = current_setting('prueba.eva')::uuid;
reset role;
select test.afirmar((select count(*) from public.notificaciones
                      where origen_id = current_setting('prueba.eva')::uuid
                        and usuario_id = current_setting('prueba.administracion')::uuid
                        and ruta = '/diseno/evaluaciones/' || current_setting('prueba.eva')) = 1,
  'la evaluación enviada le avisa a Administración');
select test.afirmar((select count(*) from public.notificaciones
                      where origen_id = current_setting('prueba.eva')::uuid
                        and usuario_id = current_setting('prueba.diseno')::uuid) = 0,
  'quien la envía no recibe su propio aviso');

-- ============================================ 7. El avance de la OT
do $$
declare v_cli uuid; v_uni uuid; v_sin uuid;
begin
  -- Se arma como dueño de las tablas, sin sesión.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999436022', 'CLIENTE DE AVANCE 436 S.A.C.') returning id into v_cli;
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK436_AV', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Sin cotización · check 436')
  returning id into v_sin;
  perform set_config('prueba.ot_sin', v_sin::text, true);
  update public.ordenes_trabajo set avance_porcentaje = 15 where id = v_sin;
end $$;
select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(
  (select avance from public.avance_de_ordenes(array[current_setting('prueba.ot_sin')::uuid])) = 15
  and not (select del_codigo from public.avance_de_ordenes(array[current_setting('prueba.ot_sin')::uuid])),
  'la orden sin cotización conserva su propio avance');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.avance_de_ordenes(array[current_setting('prueba.ot_sin')::uuid])) = 0,
  'quien no ve las órdenes no recibe su avance');
reset role;

rollback;
