-- Diseño trabaja por código interno (migración 20261015200000): carga cada plano
-- con el área de producción a la que va y su PDF, le sube revisiones, lo anula
-- con motivo; arma la lista de materiales y las etapas de la unidad. El
-- supervisor ve solo los planos de su área, marca que los recibió y marca sus
-- etapas; Gerencia ve todo; Logística no ve nada. Cada paso con el rol que lo
-- da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Sin jefatura de taller: la migración 20260929110100 ya no deja activar esas
  -- cuentas. Y cada área tiene una sola Supervisión activa: si la base ya tiene
  -- la de Maestranza o la de Producción, el check usa esa.
  foreach v in array array['DISENO:DIS', 'DISENO_COLABORADOR:DIS', 'SUPERVISOR:MTZ', 'SUPERVISOR:PRD',
                           'GERENTE:GGE', 'COMPRADOR:LOG', 'REQUERIMIENTOS:REQ', 'ALMACENERO:ALM'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.360@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 360', lower(replace(v, ':', '.')) || '.360@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
  perform set_config('prueba.log', (select id::text from public.areas where codigo = 'LOG'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK360-PLA', 'Plancha LAF 3 mm (360)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat1', v, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK360-TUB', 'Tubo LAC 2x2 (360)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat2', v, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK360-DIS', 'Disco de corte (360)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat3', v, true);
  foreach v in array array['p1', 'r1', 'p2', 'r2', 'r1b', 'p3', 'r3', 'suelto', 'rq', 'oc'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK360_SR_O4_1_26/28', true);
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
create or replace function pg_temp.ruta(p_plano text, p_rev text) returns text language sql as $$
  select current_setting('prueba.' || p_plano) || '/' || current_setting('prueba.' || p_rev) || '.pdf';
$$;
-- Lo que hace Storage al subir, con la sesión del que sube y su política.
create or replace function pg_temp.subir(p_plano text, p_rev text, p_dueno text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('planos-codigo', pg_temp.ruta(p_plano, p_rev), pg_temp.id(p_dueno), current_setting('prueba.' || p_dueno),
          jsonb_build_object('mimetype', 'application/pdf', 'size', 81234));
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and titulo like p_titulo || '%' and creado_en >= now();
$$;

-- Lo que el que mira alcanza de este código, aunque la base ya traiga otros planos.
create or replace function pg_temp.planos() returns integer language sql as $$
  select count(*)::integer from public.codigo_planos where codigo_interno = current_setting('prueba.codigo');
$$;
create or replace function pg_temp.pdfs() returns integer language sql as $$
  select count(*)::integer from storage.objects
   where bucket_id = 'planos-codigo'
     and split_part(name, '/', 1) in (current_setting('prueba.p1'), current_setting('prueba.p2'), current_setting('prueba.p3'));
$$;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 1. Diseño carga el plano de Maestranza
select pg_temp.como('diseno_dis');
set local role authenticated;
select pg_temp.subir('p1', 'r1', 'diseno_dis');
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), ' ' || lower(current_setting('prueba.codigo')) || ' ',
  ' 001 ', 'Estructura  del cajón', pg_temp.id('mtz'), null, 'cajon-r1.pdf');
-- Un reintento con los mismos ids no duplica.
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), current_setting('prueba.codigo'),
  '001', 'Estructura del cajón', pg_temp.id('mtz'), null, 'cajon-r1.pdf');
reset role;
select test.afirmar(
  (select count(*) from public.codigo_planos where id = pg_temp.id('p1') and codigo_interno = current_setting('prueba.codigo')
      and numero = '001' and nombre = 'Estructura del cajón' and creado_por = pg_temp.id('diseno_dis')) = 1
  and (select count(*) from public.codigo_plano_revisiones where plano_id = pg_temp.id('p1') and revision = 1
          and tamano_bytes = 81234 and ruta = pg_temp.ruta('p1', 'r1')) = 1,
  'el plano queda con el código escrito siempre igual, su área y su R1, una sola vez aunque se reintente');
select test.afirmar(
  pg_temp.avisos('supervisor_mtz', 'Plano nuevo para') = 1
  and pg_temp.avisos('supervisor_prd', 'Plano nuevo') = 0 and pg_temp.avisos('diseno_dis', 'Plano nuevo') = 0
  and pg_temp.avisos('gerente_gge', 'Plano nuevo') = 0,
  'le avisa al supervisor de Maestranza, no al de Producción, ni a Gerencia ni a quien lo cargó');

-- El mismo número para la misma área no entra otra vez; para Producción sí.
select pg_temp.como('diseno_dis');
set local role authenticated;
select pg_temp.subir('p2', 'r2', 'diseno_dis');
select test.debe_fallar($q$select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), current_setting('prueba.codigo'),
  '001', 'Otra vez', pg_temp.id('mtz'), null, 'x.pdf')$q$, 'el mismo plano para la misma área no se carga dos veces', 'súbele una revisión');
select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), current_setting('prueba.codigo'),
  '001', 'Bastidor', pg_temp.id('prd'), 'Va con el cajón', 'bastidor.pdf');
select test.debe_fallar($q$select public.registrar_plano_codigo(gen_random_uuid(), gen_random_uuid(), 'PLANTA',
  '009', 'Algo', pg_temp.id('mtz'), null, 'x.pdf')$q$, 'PLANTA no es una unidad', 'PLANTA no es una unidad');
select test.debe_fallar($q$select public.registrar_plano_codigo(gen_random_uuid(), gen_random_uuid(), current_setting('prueba.codigo'),
  '009', 'Algo', pg_temp.id('log'), null, 'x.pdf')$q$, 'un plano no va a Logística', 'área de producción');
select test.debe_fallar($q$select public.registrar_plano_codigo(pg_temp.id('p3'), pg_temp.id('r3'), current_setting('prueba.codigo'),
  '009', 'Sin PDF', pg_temp.id('mtz'), null, 'x.pdf')$q$, 'sin el PDF subido no se registra', 'no terminó de subir');
reset role;

-- Logística no sube ni registra; el colaborador de Diseño tampoco.
select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.subir('p3', 'r3', 'comprador_log')$q$, 'Logística no sube planos', 'row-level security');
select test.debe_fallar($q$select public.registrar_plano_codigo(pg_temp.id('p3'), pg_temp.id('r3'), current_setting('prueba.codigo'),
  '009', 'Algo', pg_temp.id('mtz'), null, 'x.pdf')$q$, 'Logística no registra planos', 'diseno.codigos');
select test.afirmar((select count(*) from public.codigo_planos) = 0
  and (select count(*) from storage.objects where bucket_id = 'planos-codigo') = 0, 'Logística no ve ni los planos ni sus PDF');
select test.debe_fallar($q$select * from public.codigo_interno_planos(null)$q$, 'ni por la función', 'No tienes permiso');
select test.debe_fallar($q$select * from public.codigos_internos_de_diseno()$q$, 'ni la lista de códigos de Diseño', 'No tienes permiso');
reset role;
select pg_temp.como('diseno_colaborador_dis');
set local role authenticated;
select test.debe_fallar($q$select public.registrar_plano_codigo(pg_temp.id('p3'), pg_temp.id('r3'), current_setting('prueba.codigo'),
  '009', 'Algo', pg_temp.id('mtz'), null, 'x.pdf')$q$, 'el colaborador de Diseño no carga planos', 'diseno.codigos');
reset role;

-- ============================================ 2. Cada supervisor ve los de su área
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar(
  pg_temp.planos() = 1
  and (select count(*) from public.codigo_plano_revisiones where plano_id in (pg_temp.id('p1'), pg_temp.id('p2'))) = 1
  and (select count(*) from public.codigo_interno_planos(null) where codigo = current_setting('prueba.codigo')) = 1
  and (select area_codigo from public.codigo_interno_planos(current_setting('prueba.codigo'))) = 'MTZ'
  and (select count(*) from storage.objects where bucket_id = 'planos-codigo' and name = pg_temp.ruta('p1', 'r1')) = 1
  and (select count(*) from storage.objects where bucket_id = 'planos-codigo' and name = pg_temp.ruta('p2', 'r2')) = 0,
  'el supervisor de Maestranza ve su plano y su PDF, y no el de Producción');
select test.debe_fallar($q$select public.recibir_plano_codigo(pg_temp.id('r2'))$q$,
  'no recibe el plano de otra área', 'lo recibe su supervisor');
select public.recibir_plano_codigo(pg_temp.id('r1'));
select public.recibir_plano_codigo(pg_temp.id('r1'));
select test.debe_fallar($q$select * from public.codigos_internos_de_diseno()$q$,
  'la lista de códigos de Diseño es de Diseño y Gerencia', 'No tienes permiso');
select test.debe_fallar($q$update public.codigo_plano_revisiones set recibido_en = now() where id = pg_temp.id('r2')$q$,
  'nadie escribe la tabla directo', 'permission denied');
reset role;
select test.afirmar(
  (select recibido_por from public.codigo_plano_revisiones where id = pg_temp.id('r1')) = pg_temp.id('supervisor_mtz')
  and pg_temp.avisos('diseno_dis', 'Plano recibido por Maestranza') = 1,
  'queda recibido una vez, y Diseño se entera de qué área lo recibió');

select pg_temp.como('gerente_gge');
set local role authenticated;
select test.afirmar(pg_temp.planos() = 2
  and (select count(*) from public.codigo_interno_planos(null) where codigo = current_setting('prueba.codigo')) = 2
  and pg_temp.pdfs() = 2
  and (select recibido_por_area from public.codigo_interno_planos(current_setting('prueba.codigo')) where id = pg_temp.id('p1')) = 'Maestranza'
  and (select planos from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 2
  and (select planos_por_recibir from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 1,
  'Gerencia ve los dos planos de todas las áreas con sus PDF, quién los recibió por área y cuántos faltan recibir');
select test.debe_fallar($q$select public.recibir_plano_codigo(pg_temp.id('r2'))$q$, 'Gerencia mira, no recibe', 'codigos_internos.area');
reset role;

-- ============================================ 3. Una revisión nueva y la anulación
select pg_temp.como('diseno_dis');
set local role authenticated;
select pg_temp.subir('p1', 'r1b', 'diseno_dis');
select test.debe_fallar($q$select public.subir_revision_plano(pg_temp.id('p1'), pg_temp.id('r1b'), ' ', 'cajon-r2.pdf')$q$,
  'una revisión dice qué cambió', 'qué cambió');
select public.subir_revision_plano(pg_temp.id('p1'), pg_temp.id('r1b'), 'Se alargó el cajón 20 cm', 'cajon-r2.pdf');
select public.subir_revision_plano(pg_temp.id('p1'), pg_temp.id('r1b'), 'Se alargó el cajón 20 cm', 'cajon-r2.pdf');
select test.afirmar(
  (select revision from public.codigo_interno_planos(current_setting('prueba.codigo')) where id = pg_temp.id('p1')) = 2
  and (select revisiones from public.codigo_interno_planos(current_setting('prueba.codigo')) where id = pg_temp.id('p1')) = 2
  and (select recibido_en from public.codigo_interno_planos(current_setting('prueba.codigo')) where id = pg_temp.id('p1')) is null
  and (select count(*) from public.codigo_plano_historial(pg_temp.id('p1'))) = 2,
  'el plano pasa a R2 sin recibir, y la R1 queda en su historia');
reset role;
select test.afirmar(pg_temp.avisos('supervisor_mtz', 'Revisión R2 del plano 001') = 1, 'el supervisor se entera de la R2');
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_plano_historial(pg_temp.id('p1'))) = 2
  and (select count(*) from public.codigo_plano_historial(pg_temp.id('p2'))) = 0,
  'el supervisor ve la historia de su plano y no la del otro');
select test.debe_fallar($q$select public.recibir_plano_codigo(gen_random_uuid())$q$, 'una revisión que no existe', 'no existe');
select public.recibir_plano_codigo(pg_temp.id('r1b'));
reset role;

-- Lo cargado no se corrige ni se borra, ni por el dueño de la tabla.
select test.debe_fallar($q$update public.codigo_planos set nombre = 'Otro' where id = pg_temp.id('p1')$q$,
  'un plano no se corrige', 'no se corrige');
select test.debe_fallar($q$delete from public.codigo_planos where id = pg_temp.id('p1')$q$, 'ni se borra', 'no se borra');
select test.debe_fallar($q$delete from public.codigo_plano_revisiones where id = pg_temp.id('r1')$q$,
  'una revisión no se borra', 'no se borra');
select test.debe_fallar($q$update public.codigo_plano_revisiones set recibido_en = now() where id = pg_temp.id('r1')$q$,
  'una revisión recibida no cambia', 'ya se recibió');

-- El PDF suelto lo retira su dueño; el registrado, nadie.
select pg_temp.como('diseno_dis');
set local role authenticated;
select pg_temp.subir('p3', 'suelto', 'diseno_dis');
delete from storage.objects where bucket_id = 'planos-codigo' and name in (pg_temp.ruta('p3', 'suelto'), pg_temp.ruta('p1', 'r1'));
select test.afirmar(pg_temp.pdfs() = 3,
  'el suelto se retira y el que nombra una revisión se queda');

select test.debe_fallar($q$select public.anular_plano_codigo(pg_temp.id('p2'), 'no')$q$, 'se anula con motivo', 'por qué se anula');
select public.anular_plano_codigo(pg_temp.id('p2'), 'El bastidor va en el plano 002');
select pg_temp.subir('p2', 'p3', 'diseno_dis');
select test.debe_fallar($q$select public.subir_revision_plano(pg_temp.id('p2'), pg_temp.id('p3'), 'Otra corrección', 'x.pdf')$q$,
  'un plano anulado no lleva revisiones', 'anulado');
reset role;
select test.debe_fallar($q$update public.codigo_planos set nombre = 'Otro' where id = pg_temp.id('p2')$q$,
  'anulado queda congelado', 'evidencia');
select pg_temp.como('supervisor_prd');
set local role authenticated;
select test.debe_fallar($q$select public.recibir_plano_codigo(pg_temp.id('r2'))$q$, 'el anulado no se recibe', 'anulado');
reset role;
select test.afirmar(pg_temp.avisos('supervisor_prd', 'Plano anulado') = 1, 'Producción se entera de que no trabaje con él');

-- ============================================ 4. La lista de materiales
select pg_temp.como('diseno_dis');
set local role authenticated;
select set_config('prueba.l1', public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat1'), 4.5,
  pg_temp.id('p1'), 'Para el piso')::text, true);
select set_config('prueba.l2', public.guardar_material_codigo(null, lower(current_setting('prueba.codigo')), pg_temp.id('mat2'), 12,
  null, null)::text, true);
select test.debe_fallar($q$select public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat2'), 3, null, null)$q$,
  'el mismo material sin plano dos veces', 'corrige su cantidad');
select test.debe_fallar($q$select public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat3'), 3, pg_temp.id('p2'), null)$q$,
  'no cuelga de un plano anulado', 'no está vigente');
select test.debe_fallar($q$select public.guardar_material_codigo(null, 'OTRO_CODIGO_360', pg_temp.id('mat3'), 3, pg_temp.id('p1'), null)$q$,
  'ni de un plano de otro código', 'no está vigente');
select test.debe_fallar($q$select public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat3'), 0, null, null)$q$,
  'la cantidad es más de cero', 'más de cero');
select public.guardar_material_codigo(pg_temp.id('l2'), null, pg_temp.id('mat2'), 10, null, 'Corregido');
select set_config('prueba.l3', public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat3'), 2,
  null, null)::text, true);
select public.quitar_material_codigo(pg_temp.id('l3'));
reset role;
select test.debe_fallar($q$delete from public.codigo_materiales where id = pg_temp.id('l3')$q$, 'una línea no se borra', 'no se borra');

select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select public.guardar_material_codigo(null, current_setting('prueba.codigo'), pg_temp.id('mat3'), 3, null, null)$q$,
  'Logística no toca la lista de Diseño', 'diseno.codigos');
select test.afirmar((select count(*) from public.codigo_materiales) = 0, 'ni la ve');
reset role;

-- Lo pedido, comprado y salido para el código: un RQ con su OC y una salida del almacén.
select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('mtz'), lower(current_setting('prueba.codigo')),
  'Armado del cajón', null,
  jsonb_build_array(jsonb_build_object('descripcion', 'Plancha LAF 3 mm', 'cantidad', 5,
    'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat'))));
reset role;
select pg_temp.como('almacenero_alm');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay plancha');
reset role;
insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
values ('20600000340', 'Proveedor de prueba 360', 'Av. Argentina 360, Lima', '999 360 360');
select pg_temp.como('comprador_log');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id('oc'), pg_temp.id('rq'), array[1]::smallint[],
  (select id from public.proveedores where numero_documento = '20600000340'), null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 150)),
  null, 'CONTADO', 0, 'PEN', true);
reset role;
-- La salida se arma como dueño: lo que se prueba es la lectura.
do $$
declare v_sal uuid := gen_random_uuid();
begin
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', pg_temp.id('mat3'), 20, 'INGRESO_GENERAL', 'Compra en tienda', pg_temp.id('almacenero_alm'),
          6, 'PEN', now() - interval '2 days');
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (v_sal, 'SALIDA', pg_temp.id('mat3'), 6, 'SALIDA_GENERAL', 'Para el cajón', pg_temp.id('almacenero_alm'), 'Área de Maestranza',
          current_setting('prueba.codigo'), current_setting('prueba.codigo'), 6);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, devolucion_de)
  values (gen_random_uuid(), 'INGRESO', pg_temp.id('mat3'), 1, 'DEVOLUCION', 'Sobró', pg_temp.id('almacenero_alm'), v_sal);
end $$;

select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.codigo_interno_materiales(current_setting('prueba.codigo'))) = 2
  and (select cantidad from public.codigo_interno_materiales(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat2')) = 10
  and (select plano from public.codigo_interno_materiales(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat1'))
      = '001 · Estructura del cajón (Maestranza)',
  'el supervisor ve la lista: dos líneas vigentes, la corregida con su cantidad nueva y el plano del que sale');
select test.afirmar(
  (select disenado from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat1')) = 4.5
  and (select comprado from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat1')) = 5
  and (select salido from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat3')) = 5
  and (select en_la_lista from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat3')) = false
  and (select disenado from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo')) where material_id = pg_temp.id('mat3')) is null,
  'material por material: 4.5 en la lista y 5 comprados; el disco quitado de la lista salió 6 menos 1 devuelto y se marca fuera de la lista');
select test.afirmar(
  (select count(*) from public.codigo_interno_lo_pedido(current_setting('prueba.codigo'))) = 1
  and (select area from public.codigo_interno_lo_pedido(current_setting('prueba.codigo'))) = 'Maestranza',
  'lo pedido por requerimiento para el código, con el área que lo pidió');
reset role;

-- ============================================ 5. Las etapas
select pg_temp.como('diseno_dis');
set local role authenticated;
select test.afirmar(public.etapas_de_siempre_codigo(lower(current_setting('prueba.codigo'))) = 6, 'las seis etapas de siempre');
select test.debe_fallar($q$select public.etapas_de_siempre_codigo(current_setting('prueba.codigo'))$q$,
  'no se repiten', 'ya tiene etapas');
select set_config('prueba.e7', public.guardar_etapa_codigo(null, current_setting('prueba.codigo'), 'Prueba de carga',
  null, null, null)::text, true);
select public.mover_etapa_codigo(pg_temp.id('e7'), true);
select set_config('prueba.hab', (select id::text from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo')
  and nombre = 'Habilitado'), true);
select set_config('prueba.arm', (select id::text from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo')
  and nombre = 'Armado'), true);
select public.guardar_etapa_codigo(pg_temp.id('hab'), null, 'Habilitado', pg_temp.id('mtz'),
  (now() at time zone 'America/Lima')::date - 10, (now() at time zone 'America/Lima')::date - 3);
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.id('arm'), null, 'Armado', pg_temp.id('prd'),
  current_date, current_date - 1)$q$, 'lo comprometido no va antes del inicio', 'anterior al inicio');
reset role;
select test.afirmar(
  (select array_agg(nombre order by orden) from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo')
      and quitada_en is null)
  = array['Diseño y planos', 'Habilitado', 'Armado', 'Arenado y pintura', 'Trámites: homologación y tarjeta', 'Prueba de carga', 'Entrega'],
  'en el orden del taller, con la nueva subida un lugar antes de la entrega');

select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('arm'), 'INICIO', current_date, null)$q$,
  'Maestranza no marca el armado de Producción', 'supervisor de Producción');
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('hab'), 'INICIO', (now() at time zone 'America/Lima')::date + 1, null)$q$,
  'no se marca una fecha que no llegó', 'posterior a hoy');
select public.marcar_etapa_codigo(pg_temp.id('hab'), 'INICIO', (now() at time zone 'America/Lima')::date - 8, null);
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('hab'), 'FIN', (now() at time zone 'America/Lima')::date, null)$q$,
  'terminar tarde pide el porqué', 'escribe por qué se atrasó');
select public.marcar_etapa_codigo(pg_temp.id('hab'), 'FIN', (now() at time zone 'America/Lima')::date, 'Faltó plancha dos días');
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('hab'), 'FIN', (now() at time zone 'America/Lima')::date, 'x')$q$,
  'terminada no se vuelve a terminar', 'ya terminó');
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('hab'), 'REABRIR', null, null)$q$,
  'reabrir pide el porqué', 'por qué se reabre');
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.id('hab'), null, 'Otra', null, null, null)$q$,
  'el supervisor no arma las etapas', 'diseno.codigos');
reset role;
select test.afirmar(
  (select fin_real from public.codigo_etapas where id = pg_temp.id('hab')) = (now() at time zone 'America/Lima')::date
  and (select nota from public.codigo_etapas where id = pg_temp.id('hab')) = 'Faltó plancha dos días'
  and pg_temp.avisos('diseno_dis', 'Etapa terminada: Habilitado') = 1,
  'queda terminada con su porqué, y Diseño se entera');

select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('arm'), 'INICIO', current_date, null)$q$,
  'Logística no marca etapas', 'No tienes permiso');
select test.afirmar((select count(*) from public.codigo_etapas) = 0, 'ni las ve');
select test.debe_fallar($q$select * from public.codigo_interno_etapas(null)$q$, 'ni por la función', 'No tienes permiso');
reset role;

-- El reporte diario de Maestranza da el avance de su etapa (armazón como dueño).
do $$
declare v_r uuid := gen_random_uuid();
begin
  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
  values (v_r, (now() at time zone 'America/Lima')::date - 1, lower(current_setting('prueba.codigo')), 'Habilitado del cajón',
          'Se cortó la plancha', pg_temp.id('mtz'), pg_temp.id('supervisor_mtz'));
  insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance)
  values (v_r, 1, 'Corte de plancha', 80), (v_r, 2, 'Doblez', 40);
end $$;

select pg_temp.como('gerente_gge');
set local role authenticated;
select test.afirmar(
  (select reportes from public.codigo_interno_etapas(current_setting('prueba.codigo')) where id = pg_temp.id('hab')) = 1
  and (select avance_reportado from public.codigo_interno_etapas(current_setting('prueba.codigo')) where id = pg_temp.id('hab')) = 60
  and (select reportes from public.codigo_interno_etapas(current_setting('prueba.codigo')) where id = pg_temp.id('arm')) = 0,
  'Gerencia ve en la etapa de Maestranza su reporte y su avance (80 y 40: 60 %), y en la de Producción nada todavía');
select test.afirmar(
  (select etapas from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 7
  and (select etapas_terminadas from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 1
  and (select etapa_actual from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 'Diseño y planos'
  and (select materiales from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')) = 2
  and not exists (select 1 from public.codigos_internos_de_diseno() where codigo = 'PLANTA'),
  'en la lista de Gerencia: siete etapas, una terminada, la que sigue abierta primero y dos materiales; PLANTA no sale');
select test.debe_fallar($q$select public.marcar_etapa_codigo(pg_temp.id('arm'), 'INICIO', current_date, null)$q$,
  'Gerencia mira, no marca', 'la marca Diseño');
reset role;

select pg_temp.como('diseno_dis');
set local role authenticated;
select public.marcar_etapa_codigo(pg_temp.id('hab'), 'REABRIR', null, 'Hay que rehacer el doblez');
select public.quitar_etapa_codigo(pg_temp.id('e7'));
select test.afirmar(
  (select fin_real from public.codigo_etapas where id = pg_temp.id('hab')) is null
  and (select count(*) from public.codigo_interno_etapas(current_setting('prueba.codigo'))) = 6,
  'Diseño reabre con su porqué y quita la etapa que sobraba');
reset role;
select test.debe_fallar($q$delete from public.codigo_etapas where id = pg_temp.id('e7')$q$, 'una etapa no se borra', 'no se borra');

rollback;
