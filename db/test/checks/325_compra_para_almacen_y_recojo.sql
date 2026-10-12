-- Compra para almacén (sin requerimiento), el recojo del conductor y el ingreso
-- que Almacén valida desde su kardex, probados con el rol que hace cada trabajo
-- —nunca como ADMIN— y `set local role authenticated`. Todo dentro de una
-- transacción que termina en rollback.
--
-- Las personas se toman de la base por su rol: Logística (COMPRADOR), Gerencia
-- (GERENTE), el conductor (CONDUCTOR), Almacén (ALMACENERO del área ALM) y un
-- supervisor de taller como quien no tiene nada que ver con compras.
begin;

do $$
declare
  v text;
begin
  foreach v in array array['COMPRADOR', 'GERENTE', 'CONDUCTOR', 'SUPERVISOR'] loop
    perform set_config('prueba.' || lower(v), (
      select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
       where r.codigo = v and u.activo order by u.creado_en limit 1), true);
    if current_setting('prueba.' || lower(v)) = '' then
      raise exception 'FALLA: no hay una cuenta activa con el rol % para probar', v;
    end if;
  end loop;
  perform set_config('prueba.almacenero', (
    select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
      join public.areas a on a.id = u.area_id
     where r.codigo = 'ALMACENERO' and a.codigo = 'ALM' and u.activo order by u.creado_en limit 1), true);
  if current_setting('prueba.almacenero') = '' then
    raise exception 'FALLA: no hay un almacenero activo del área ALM para probar';
  end if;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Cuántos avisos tiene una persona de una compra, por la ruta a la que llevan.
create or replace function pg_temp.avisos(p_clave text, p_compra text, p_ruta text) returns bigint language sql as $$
  select count(*) from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid
     and origen_id = current_setting('prueba.' || p_compra)::uuid and ruta = p_ruta;
$$;

-- ----------------------------------------------------------------- armazón
-- Un proveedor del padrón, dos materiales de almacén con su unidad, uno con la
-- unidad por definir, y la regla de aprobación encendida desde S/ 100 con
-- Gerencia como aprobador. Se arma como dueño: lo que se prueba viene después.
do $$
declare v_mat uuid; v_prov uuid; i int;
begin
  -- Un RUC válido que no esté ya en el padrón, para no chocar con los datos reales.
  insert into public.proveedores (numero_documento, razon_social, direccion, condicion_pago, dias_credito)
  select x.ruc, 'FERRETERIA DE PRUEBA S.A.C.', 'Av. Industrial 123, Trujillo', 'CONTADO', 0
    from (select '20' || lpad(n::text, 8, '0') || d as ruc from generate_series(99999000, 99999999) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(x.ruc) and not exists (select 1 from public.proveedores p where p.numero_documento = x.ruc)
   limit 1
  returning id into v_prov;
  perform set_config('prueba.proveedor', v_prov::text, true);
  for i in 1..3 loop
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK325-' || i, 'Material de almacén ' || i,
            (select id from public.categorias_material order by 1 limit 1),
            (select id from public.unidades_medida order by 1 limit 1))
    returning id into v_mat;
    perform set_config('prueba.mat' || i, v_mat::text, true);
  end loop;
  update public.materiales set unidad_pendiente = true where id = current_setting('prueba.mat3')::uuid;
  update public.regla_aprobacion_compras
     set activa = true, monto_desde = 100, rol_aprobador_id = (select id from public.roles where codigo = 'GERENTE')
   where unica;
end $$;

-- ======================================================== 1. EL PUESTO
select test.afirmar(
  exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
           where r.codigo = 'CONDUCTOR' and rp.permiso_codigo = 'compras.recoger'),
  'el conductor de Logística tiene su permiso de recoger: el permiso nuevo no es una puerta tapiada');
select test.afirmar(
  not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
               where r.codigo = 'CONDUCTOR' and rp.permiso_codigo in ('compras.ver', 'compras.crear', 'almacen.recibir')),
  'el conductor no ve compras ni precios ni recibe en almacén');

-- ======================================================== 2. LA COMPRA PARA ALMACÉN
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.emitir_compra_para_almacen(gen_random_uuid(), '%s', 'OC-NO', '[{"material_id":"%s","cantidad":1,"precio":1}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.proveedor'), current_setting('prueba.mat1')),
  'el taller no emite compras', 'compras.crear');
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select set_config('prueba.oc1', gen_random_uuid()::text, true);
select public.emitir_compra_para_almacen(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK325-1', jsonb_build_array(
    jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 10, 'precio', 20),
    jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 4, 'precio', 5)),
  null, 'CONTADO', 0, 'PEN');
select test.afirmar(
  (select requerimiento_id is null and proveedor = 'FERRETERIA DE PRUEBA S.A.C.'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'Logística emite una compra para almacén, sin requerimiento ni OT, con el proveedor del padrón');
select test.afirmar(
  (select count(*) = 2 and bool_and(material_id is not null and requerimiento_detalle_id is null)
     from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid),
  'Logística ve sus dos líneas, cada una con su material');
select test.afirmar(
  public.emitir_compra_para_almacen(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid,
    'OC-CHK325-1', jsonb_build_array(
      jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 4, 'precio', 5),
      jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 10, 'precio', 20)),
    null, 'CONTADO', 0, 'PEN') = current_setting('prueba.oc1')::uuid,
  'reintentar la misma compra —aunque las líneas lleguen en otro orden— no la duplica');
select test.debe_fallar(
  format($q$select public.emitir_compra_para_almacen('%s', '%s', 'OC-CHK325-1', '[{"material_id":"%s","cantidad":11,"precio":20}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.oc1'), current_setting('prueba.proveedor'), current_setting('prueba.mat1')),
  'el mismo identificador con otros datos no pisa la compra', 'ya existe con otros datos');
select test.debe_fallar(
  format($q$select public.emitir_compra_para_almacen(gen_random_uuid(), '%s', 'OC-REP', '[{"material_id":"%s","cantidad":1,"precio":1},{"material_id":"%s","cantidad":2,"precio":1}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.proveedor'), current_setting('prueba.mat1'), current_setting('prueba.mat1')),
  'un material repetido en la misma compra se rechaza', 'No repitas un material');
select test.debe_fallar(
  format($q$select public.emitir_compra_para_almacen(gen_random_uuid(), '%s', 'OC-UNI', '[{"material_id":"%s","cantidad":1,"precio":1}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.proveedor'), current_setting('prueba.mat3')),
  'un material con la unidad por definir no se compra', 'le falta su unidad');
select test.debe_fallar(
  format($q$select public.emitir_compra_para_almacen(gen_random_uuid(), '%s', 'OC-SINP', '[{"material_id":"%s","cantidad":1}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.proveedor'), current_setting('prueba.mat1')),
  'cada material lleva su precio', 'precio unitario');
-- Una compra chica, por debajo del monto que pide aprobación.
select set_config('prueba.oc2', gen_random_uuid()::text, true);
select public.emitir_compra_para_almacen(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK325-2', jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 8, 'precio', 5)),
  current_date + 2, 'CONTADO', 0, 'PEN');
reset role;

-- Una línea de requerimiento no se cuela en una compra para almacén.
select test.debe_fallar(
  format($q$insert into public.orden_compra_material_detalles (orden_compra_id, requerimiento_id, requerimiento_detalle_id, cantidad, precio_unitario)
            values ('%s', gen_random_uuid(), gen_random_uuid(), 1, 1)$q$, current_setting('prueba.oc2')),
  'una compra no mezcla lo de almacén con lo de una OT', 'es para almacén');

set constraints all immediate;
set constraints all deferred;
select test.afirmar(
  (select aprobacion = 'POR_APROBAR' and monto_pen = 220 from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la compra para almacén de S/ 220 pasa por la regla de aprobación como cualquier otra');
select test.afirmar(
  (select aprobacion from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid) = 'NO_REQUERIDA',
  'la de S/ 40 no pide aprobación');
select test.afirmar(pg_temp.avisos('conductor', 'oc1', '/recojos') = 0,
  'al conductor no le llega una compra que Gerencia todavía no aprobó');
select test.afirmar(pg_temp.avisos('conductor', 'oc2', '/recojos') = 1,
  'la compra que no pide aprobación le llega al conductor al emitirse');

-- Quién la ve.
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 1
  and (select count(*) from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid) = 2,
  'Almacén ve la compra para almacén y sus líneas aunque no tenga área de OT');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 0,
  'el taller no ve las compras');
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 0,
  'el conductor no lee la tabla de compras: sus recojos le llegan por su propia función, sin precios');
reset role;

-- ======================================================== 3. GERENCIA APRUEBA
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select cardinality(ordenes) = 0 and jsonb_array_length(lineas) = 2
     from public.compras_para_aprobar() where id = current_setting('prueba.oc1')::uuid),
  'Gerencia ve la compra para almacén por aprobar, sin OT y con sus dos materiales');
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(not exists (select 1 from public.recojos_de_compras() where id = current_setting('prueba.oc1')::uuid),
  'el conductor no ve en sus recojos la compra por aprobar');
select test.debe_fallar(
  format($q$select public.marcar_compra_recogida('%s')$q$, current_setting('prueba.oc1')),
  'ni puede marcarla recogida', 'espera la aprobación');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc1')::uuid);
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'oc1', '/recojos') = 1,
  'aprobada por Gerencia, la compra le llega al conductor');
select test.afirmar(
  (select cuerpo like '%Av. Industrial 123%' from public.notificaciones
    where usuario_id = current_setting('prueba.conductor')::uuid and origen_id = current_setting('prueba.oc1')::uuid and ruta = '/recojos'),
  'el aviso le dice a dónde ir: el proveedor y su dirección');
select test.afirmar(
  (select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id join public.roles r on r.id = u.rol_id
    where n.origen_id = current_setting('prueba.oc1')::uuid and n.ruta = '/recojos' and r.codigo <> 'CONDUCTOR') = 0,
  'el aviso de recojo solo le llega a quien recoge');

-- ======================================================== 4. EL CONDUCTOR
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select estado = 'POR_RECOGER' and proveedor_direccion = 'Av. Industrial 123, Trujillo' and jsonb_array_length(lineas) = 2
          and not (lineas::text like '%precio%')
     from public.recojos_de_compras() where id = current_setting('prueba.oc1')::uuid),
  'el conductor ve la compra por recoger, con la dirección y lo que tiene que recoger, sin precios');
select test.debe_fallar(
  format($q$select public.marcar_compra_dejada_en_almacen('%s', 'GR 001-123')$q$, current_setting('prueba.oc1')),
  'no se deja en almacén lo que no se marcó recogido', 'Marca primero que recogiste');
select test.afirmar(public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid) = current_setting('prueba.oc1')::uuid,
  'el conductor marca la compra recogida');
select test.afirmar(public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid) = current_setting('prueba.oc1')::uuid,
  'un segundo toque en «recogida» no hace nada');
select test.afirmar(
  (select estado = 'EN_CAMINO' and recogido_por is not null from public.recojos_de_compras() where id = current_setting('prueba.oc1')::uuid),
  'la compra recogida queda en camino, con quién la recogió');
reset role;
select test.afirmar(
  (select recogido_por = current_setting('prueba.conductor')::uuid and recogido_en is not null and entregado_almacen_en is null
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la compra guarda quién y cuándo la recogió');
select test.afirmar(pg_temp.avisos('comprador', 'oc1', '/compras') >= 1,
  'Logística se entera de que su compra fue recogida');

select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(not exists (select 1 from public.ingresos_por_validar() where id = current_setting('prueba.oc1')::uuid),
  'mientras está en camino, Almacén todavía no la tiene por validar');
select test.debe_fallar(
  format($q$select public.validar_ingreso_compra(gen_random_uuid(), '%s', 'GR 001-123')$q$, current_setting('prueba.oc1')),
  'ni puede validar lo que no llegó', 'todavía no llegó');
select test.debe_fallar(
  format($q$select public.marcar_compra_recogida('%s')$q$, current_setting('prueba.oc2')),
  'Almacén no marca recojos', 'compras.recoger');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar('select * from public.recojos_de_compras()', 'el taller no ve los recojos', 'permiso');
select test.debe_fallar(
  format($q$select public.marcar_compra_recogida('%s')$q$, current_setting('prueba.oc2')),
  'el taller no marca recojos', 'compras.recoger');
select test.debe_fallar('select * from public.ingresos_por_validar()', 'el taller no ve ingresos por validar', 'permiso');
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.marcar_compra_dejada_en_almacen('%s', ' ')$q$, current_setting('prueba.oc1')),
  'dejarla en almacén pide la guía o la factura', 'guía o la factura');
select test.afirmar(public.marcar_compra_dejada_en_almacen(current_setting('prueba.oc1')::uuid, ' GR 001-123 ') = current_setting('prueba.oc1')::uuid,
  'el conductor la deja en almacén con la guía del proveedor');
select test.afirmar(public.marcar_compra_dejada_en_almacen(current_setting('prueba.oc1')::uuid, 'GR 001-123') = current_setting('prueba.oc1')::uuid,
  'un segundo toque con la misma guía no hace nada');
select test.debe_fallar(
  format($q$select public.marcar_compra_dejada_en_almacen('%s', 'OTRA GUIA')$q$, current_setting('prueba.oc1')),
  'una vez dejada no se cambia la guía', 'ya fue dejada');
select test.afirmar(
  (select estado = 'EN_ALMACEN' and documento_entrega = 'GR 001-123' and not ingresado
     from public.recojos_de_compras() where id = current_setting('prueba.oc1')::uuid),
  'el conductor la ve en almacén, todavía sin validar');
select test.debe_fallar('select * from public.ingresos_por_validar()', 'el conductor no valida ingresos', 'permiso');
select test.debe_fallar(
  format($q$select public.validar_ingreso_compra(gen_random_uuid(), '%s', null)$q$, current_setting('prueba.oc1')),
  'ni puede ingresarla al kardex él mismo', 'almacen.recibir');
reset role;

select test.afirmar(
  (select entregado_almacen_por = current_setting('prueba.conductor')::uuid and documento_entrega = 'GR 001-123'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'dejada en almacén es la misma entrega a Almacén de siempre: queda quién la dejó y con qué guía');
select test.afirmar(pg_temp.avisos('almacenero', 'oc1', '/almacen/kardex#por-validar') = 1,
  'a Almacén le llega el aviso de un ingreso por validar en su kardex');

-- ======================================================== 5. ALMACÉN VALIDA
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(
  (select cardinality(ordenes) = 0 and documento_entrega = 'GR 001-123' and recogido_por is not null and jsonb_array_length(lineas) = 2
          and (select bool_and((l->>'pendiente')::numeric = (l->>'comprado')::numeric) from jsonb_array_elements(lineas) l)
     from public.ingresos_por_validar() where id = current_setting('prueba.oc1')::uuid),
  'Almacén ve el ingreso por validar con la guía, quién lo trajo y cada material con su cantidad');

select set_config('prueba.linea1', (select l->>'id' from public.ingresos_por_validar() i, jsonb_array_elements(i.lineas) l
                                      where i.id = current_setting('prueba.oc1')::uuid and l->>'material_codigo' = 'CHK325-1'), true);
select set_config('prueba.op1', gen_random_uuid()::text, true);
-- Llegaron 6 de las 10 del primer material y nada del segundo.
select test.afirmar(
  public.validar_ingreso_compra(current_setting('prueba.op1')::uuid, current_setting('prueba.oc1')::uuid, null,
    jsonb_build_array(jsonb_build_object('id', current_setting('prueba.linea1'), 'cantidad', 6))) = 1,
  'Almacén valida lo que de verdad llegó: 6 del primer material');
select test.afirmar(
  public.validar_ingreso_compra(current_setting('prueba.op1')::uuid, current_setting('prueba.oc1')::uuid, null,
    jsonb_build_array(jsonb_build_object('id', current_setting('prueba.linea1'), 'cantidad', 6))) = 1,
  'un segundo toque con la misma operación no ingresa dos veces');
select test.afirmar(
  (select count(*) from public.movimientos_materiales where orden_compra_detalle_id = current_setting('prueba.linea1')::uuid) = 1,
  'queda un solo movimiento de ingreso');
select test.afirmar(
  (select (select sum((l->>'pendiente')::numeric) from jsonb_array_elements(lineas) l) = 8
     from public.ingresos_por_validar() where id = current_setting('prueba.oc1')::uuid),
  'lo que no llegó sigue por validar: 4 + 4');
select test.debe_fallar(
  format($q$select public.validar_ingreso_compra(gen_random_uuid(), '%s', null, '[{"id":"%s","cantidad":5}]'::jsonb)$q$,
         current_setting('prueba.oc1'), current_setting('prueba.linea1')),
  'no entra más de lo pendiente', 'más de lo pendiente');
select test.debe_fallar(
  format($q$select public.validar_ingreso_compra(gen_random_uuid(), '%s', null, '[{"id":"%s","cantidad":1}]'::jsonb)$q$,
         current_setting('prueba.oc1'), gen_random_uuid()),
  'una línea ajena a la compra no entra', 'no es de esta compra');
select test.afirmar(
  public.validar_ingreso_compra(gen_random_uuid(), current_setting('prueba.oc1')::uuid, null) = 2,
  'al llegar el resto, Almacén valida todo lo pendiente de una vez');
select test.afirmar(not exists (select 1 from public.ingresos_por_validar() where id = current_setting('prueba.oc1')::uuid),
  'la compra completa sale de los ingresos por validar');
select test.afirmar(
  (select sum(entrada) = 10 and min(precio_unitario) = 20 and max(precio_unitario) = 20 and bool_and(documento = 'GR 001-123')
          and bool_and(origen = 'COMPRA')
     from public.v_kardex_almacen where material_id = current_setting('prueba.mat1')::uuid),
  'Almacén ve en su kardex las 10 unidades ingresadas con el precio de la compra y la guía del conductor');
select test.afirmar(
  (select existencia from public.v_existencias_materiales where material_id = current_setting('prueba.mat1')::uuid) = 10
  and (select existencia from public.v_existencias_materiales where material_id = current_setting('prueba.mat2')::uuid) = 4,
  'la existencia de almacén sube con lo validado');
reset role;
select test.afirmar(pg_temp.avisos('comprador', 'oc1', '/compras') >= 3,
  'Logística se entera de cada paso de su compra: recogida, en almacén y validada');

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select estado = 'EN_ALMACEN' and ingresado from public.recojos_de_compras() where id = current_setting('prueba.oc1')::uuid),
  'el conductor ve su recojo cerrado: en almacén e ingresado');
-- La compra chica, recogida y dejada sin pasar por Gerencia.
select public.marcar_compra_recogida(current_setting('prueba.oc2')::uuid);
select public.marcar_compra_dejada_en_almacen(current_setting('prueba.oc2')::uuid, 'F001-778');
reset role;

-- La recepción por línea de siempre sirve también para una compra para almacén.
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_recepcion_material(gen_random_uuid(),
  (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc2')::uuid), 3, 'F001-778');
select test.afirmar(
  (select existencia from public.v_existencias_materiales where material_id = current_setting('prueba.mat2')::uuid) = 7,
  'la recepción por línea de una compra para almacén también suma al material correcto');
select test.afirmar(
  (select (lineas->0->>'pendiente')::numeric = 5 from public.ingresos_por_validar() where id = current_setting('prueba.oc2')::uuid),
  'y lo que queda (5 de 8) sigue por validar');
reset role;

rollback;
