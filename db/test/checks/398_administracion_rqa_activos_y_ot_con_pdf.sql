-- Lo que DKS pidió para Administración el 2026-10-19 (migraciones 20261017400000,
-- 401000 y 402000), con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
--   1. Administración ya no administra el sistema: no da de alta cuentas, no
--      cambia puestos ni estados, no lee la empresa ni las series, no toca el
--      calendario. Sí ve los códigos internos, en lectura: no cierra el costeo.
--   2. El requerimiento de Administración se carga a TODOS LOS ACTIVOS: lo que
--      sale del almacén se reparte en partes iguales entre los códigos que
--      trabajaron ese mes; PLANTA y OFICINA no reciben; si ese mes no trabajó
--      ninguno, se queda en TODOS LOS ACTIVOS. El de operación no se carga así.
--      Los gastos del mes se reparten como antes; TODOS LOS ACTIVOS no recibe.
--   3. La orden sin cotización nace con su PDF ya subido, o no nace, y no entra
--      directo a la tabla. Quien la sube ve su PDF; Gerencia no, Diseño sí;
--      Ventas no la registra.
\set ON_ERROR_STOP on
begin;

-- Lo que la base ya tenga cargado «a todos los activos» este mes se repartiría
-- también entre los códigos de esta prueba y movería sus montos: se saca del mes.
update public.movimientos_materiales set registrado_en = registrado_en - interval '50 years'
 where public.normalizar_codigo_interno(codigo_interno) = 'TODOS LOS ACTIVOS';

insert into public.empresa (ruc, razon_social)
select '20100000398', 'PRUEBAS ADMINISTRACION S.A.C.' where not exists (select 1 from public.empresa);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'GERENTE:GGE', 'DISENO:DIS', 'VENDEDOR:GCO',
                           'REQUERIMIENTOS:REQ', 'SUPERVISOR:PRD'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.398@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 398', lower(replace(v, ':', '.')) || '.398@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_adm', (select id::text from public.areas where codigo = 'ADM'), true);
  perform set_config('prueba.area_prd', (select id::text from public.areas where codigo = 'PRD'), true);
  foreach v in array array['rqa', 'rqo', 'sal', 'gasto', 'ot', 'ot_mal', 'ot_vendedor'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.periodo', date_trunc('month', (now() at time zone 'America/Lima')::date)::date::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Lo que el código `p_codigo` lleva de la salida a todos los activos (cantidad) y de un gasto del mes (monto).
create or replace function pg_temp.parte(p_codigo text) returns numeric language sql as $$
  select coalesce(sum(l.cantidad), 0) from public.codigo_interno_lineas(null, true) l
   where l.fuente = 'MATERIALES' and l.codigo = p_codigo and l.referencia_id = current_setting('prueba.sal')::uuid;
$$;
create or replace function pg_temp.gasto(p_codigo text) returns numeric language sql as $$
  select coalesce(sum(l.monto), 0) from public.codigo_interno_lineas(null, true) l
   where l.fuente = 'GASTOS_DEL_MES' and l.codigo = p_codigo and l.referencia_id = current_setting('prueba.gasto')::uuid;
$$;

-- ============================================ 1. Administración no administra el sistema
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format($q$select public.cambiar_estado_personal('%s', false)$q$, current_setting('prueba.vendedor')),
  'Administración no da de baja una cuenta', 'usuarios.gestionar');
select test.debe_fallar($q$select public.crear_personal('Nueva', 'Cuenta', 'nueva.398@prueba.local', 'Clave-de-prueba-398',
  (select id from public.roles where codigo = 'VENDEDOR'), null, null, null, null, null, false, 0)$q$,
  'Administración no da de alta cuentas', 'usuarios.gestionar');
do $$
declare v int;
begin
  update public.usuarios set rol_id = (select id from public.roles where codigo = 'GERENTE')
   where id = current_setting('prueba.vendedor')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Administración no cambia el puesto de otra cuenta (0 filas)');
  update public.feriados set nombre = nombre where true;
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Administración no toca el calendario (0 filas)');
  perform test.afirmar((select count(*) from public.empresa) = 0, 'Administración no lee la empresa de Configuración');
  perform test.afirmar((select count(*) from public.series_documentarias) = 0, 'Administración no lee las series de los documentos');
end $$;
select test.debe_fallar($q$insert into public.areas (codigo, nombre) values ('X98', 'Área de prueba 398')$q$,
  'Administración no crea áreas', 'row-level security');
reset role;
-- Personal y Configuración quedan para el administrador del sistema.
select test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                 where r.codigo = 'ADMINISTRACION'
                                   and rp.permiso_codigo in ('usuarios.gestionar', 'configuracion.editar', 'configuracion.ver')),
  'Administración ya no tiene usuarios.gestionar ni configuracion.*');
select test.afirmar(exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                             where r.codigo = 'DISENO' and rp.permiso_codigo = 'configuracion.ver'),
  'Diseño conserva configuracion.ver para las plantillas de la ficha');

-- ============================================ 2. El RQA a todos los activos
-- Armazón, como dueño: un material con 20 en stock a S/ 10 y lo que salió este
-- mes para dos unidades, PLANTA y OFICINA.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid; v_c text;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK398-1', 'Guantes de prueba 398', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m, 20, 'INGRESO_GENERAL', 'Compra de prueba 398', current_setting('prueba.almacenero')::uuid,
          10, 'PEN', now() - interval '1 hour');
  foreach v_c in array array['CHK398_A', 'CHK398_B', 'PLANTA', 'OFICINA'] loop
    insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                               recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
    values (gen_random_uuid(), 'SALIDA', v_m, 1, 'SALIDA_GENERAL', 'Para ' || v_c, current_setting('prueba.almacenero')::uuid,
            'Área de prueba', v_c, v_c, 1);
  end loop;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
          current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
end $$;

-- Administración pide seis pares para toda la planta.
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqa')::uuid, 'ADMINISTRACION', current_setting('prueba.area_adm')::uuid,
  'TODOS LOS ACTIVOS', 'Guantes para todas las unidades en fabricación (prueba 398)', null,
  format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.m1'))::jsonb);
reset role;
select test.afirmar((select codigo_interno from public.requerimientos where id = current_setting('prueba.rqa')::uuid) = 'TODOS LOS ACTIVOS',
  'el RQA queda con el código TODOS LOS ACTIVOS');

-- El RQ de operación no se carga a todos.
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(format($q$select public.emitir_requerimiento('%s', 'OPERACION', '%s', 'todos  los activos',
  'Discos para todas las unidades (prueba 398)', null, '[{"material_id": "%s", "cantidad": 1}]'::jsonb)$q$,
  current_setting('prueba.rqo'), current_setting('prueba.area_prd'), current_setting('prueba.m1')),
  'el RQ de operación no se carga a todos los activos', 'Solo el requerimiento de Administración');
reset role;

-- Almacén entrega los seis por el RQ: la salida hereda TODOS LOS ACTIVOS.
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_salida_material(current_setting('prueba.sal')::uuid, current_setting('prueba.m1')::uuid, 6,
  null, null, 'RQA de prueba 398', 'Administración', current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
  (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rqa')::uuid and item = 1));
reset role;
select test.afirmar((select public.normalizar_codigo_interno(coalesce(m.codigo_interno, m.codigo_unidad))
                       from public.movimientos_materiales m where m.id = current_setting('prueba.sal')::uuid) = 'TODOS LOS ACTIVOS',
  'la salida del almacén lleva TODOS LOS ACTIVOS');

-- Cómo se reparte: partes iguales entre los que trabajaron este mes, sin perder nada.
do $$
declare v_n int; v_a numeric := pg_temp.parte('CHK398_A'); v_b numeric := pg_temp.parte('CHK398_B'); v_detalle text;
begin
  select count(distinct l.codigo) into v_n from public.codigo_interno_lineas(null, true) l
   where l.fuente = 'MATERIALES' and l.referencia_id = current_setting('prueba.sal')::uuid;
  perform test.afirmar(v_n >= 2, format('la salida se reparte entre los códigos que trabajaron (%s)', v_n));
  perform test.afirmar(v_a > 0 and v_a = v_b and abs(v_a - 6.0 / v_n) < 0.0001,
    format('cada código lleva su parte igual: A %s, B %s, de 6 entre %s', v_a, v_b, v_n));
  perform test.afirmar((select sum(l.cantidad) from public.codigo_interno_lineas(null, true) l
                         where l.fuente = 'MATERIALES' and l.referencia_id = current_setting('prueba.sal')::uuid) between 5.9999 and 6.0001,
    'entre todos suman los seis: no se pierde ni se duplica');
  perform test.afirmar(pg_temp.parte('PLANTA') = 0 and pg_temp.parte('OFICINA') = 0 and pg_temp.parte('TODOS LOS ACTIVOS') = 0,
    'PLANTA, OFICINA y TODOS LOS ACTIVOS no reciben');
  select l.detalle into v_detalle from public.codigo_interno_lineas('CHK398_A', true) l
   where l.fuente = 'MATERIALES' and l.referencia_id = current_setting('prueba.sal')::uuid;
  perform test.afirmar(v_detalle like 'Cargado a todos los activos: partes iguales entre los ' || v_n || ' códigos%',
    format('la línea dice entre cuántos se repartió: «%s»', v_detalle));
  perform test.afirmar((select sum(l.monto) from public.codigo_interno_lineas('CHK398_A', true) l
                         where l.fuente = 'MATERIALES' and l.referencia_id = current_setting('prueba.sal')::uuid)
                       = (select sum(l.monto) from public.codigo_interno_lineas('CHK398_B', true) l
                           where l.fuente = 'MATERIALES' and l.referencia_id = current_setting('prueba.sal')::uuid),
    'las dos unidades cargan el mismo monto');
end $$;

-- Requerimientos ve la misma parte en el gasto por código.
select set_config('prueba.parte_a', pg_temp.parte('CHK398_A')::text, true);
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select sum(g.cantidad) from public.codigo_interno_gasto('CHK398_A') g
                      where g.fuente = 'MATERIALES' and g.referencia_id = current_setting('prueba.sal')::uuid) = current_setting('prueba.parte_a')::numeric,
  'Requerimientos ve la misma parte en el gasto del código');
reset role;

-- Escrito a mano en una salida general, sin el RQA, no se acepta.
select set_config('prueba.sal_mano', gen_random_uuid()::text, true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal_mano') || '.jpg',
        current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_salida_material(%L::uuid, %L::uuid, 1, null, 'todos los activos',
                                   'Salida general 398', 'Administración', %L, null)$q$,
                               current_setting('prueba.sal_mano'), current_setting('prueba.m1'),
                               current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal_mano') || '.jpg'),
  'Almacén no carga a todos los activos una salida general escrita a mano', 'es solo para lo que sale de un requerimiento de Administración');
reset role;

-- Una salida a todos de un mes en que nadie trabajó se queda en TODOS LOS ACTIVOS.
do $$
declare
  v_salida uuid := gen_random_uuid();
begin
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock, registrado_en,
                                             precio_unitario, moneda, requerimiento_linea_id)
  values (v_salida, 'SALIDA', current_setting('prueba.m1')::uuid, 2, 'SALIDA_GENERAL', 'Mes sin trabajo 398',
          current_setting('prueba.almacenero')::uuid, 'Administración', 'TODOS LOS ACTIVOS', 'TODOS LOS ACTIVOS', 2,
          timestamptz '2020-01-15 10:00-05', 10, 'PEN',
          (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rqa')::uuid and item = 1));
  perform test.afirmar((select sum(l.cantidad) from public.codigo_interno_lineas('TODOS LOS ACTIVOS', true) l
                         where l.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO') and l.referencia_id = v_salida
                           and l.detalle like 'Cargado a todos los activos: ningún código trabajó%') = 2,
    'sin códigos que trabajaran ese mes, la salida espera en TODOS LOS ACTIVOS');
end $$;

-- Un gasto del mes en partes iguales: como en la 20261017300000, y TODOS LOS ACTIVOS no recibe.
select pg_temp.como('administracion');
set local role authenticated;
select public.registrar_gasto_general(current_setting('prueba.gasto')::uuid, current_setting('prueba.periodo')::date, 'AGUA',
  'Recibo de agua de prueba 398', 300, 'PEN', 'PARTES_IGUALES', null);
reset role;
select test.afirmar(pg_temp.gasto('PLANTA') = 0 and pg_temp.gasto('TODOS LOS ACTIVOS') = 0,
  'PLANTA y TODOS LOS ACTIVOS no reciben gastos del mes');
select test.afirmar(pg_temp.gasto('OFICINA') = pg_temp.gasto('CHK398_A'),
  'OFICINA, con su salida del mes, recibe su parte como hasta hoy (migración 20261017300000)');
select test.afirmar(pg_temp.gasto('CHK398_A') > 0 and pg_temp.gasto('CHK398_A') = pg_temp.gasto('CHK398_B'),
  format('las unidades reciben partes iguales del gasto: A %s, B %s', pg_temp.gasto('CHK398_A'), pg_temp.gasto('CHK398_B')));
-- Cada parte se redondea al céntimo: el total se aleja de 300 a lo más medio céntimo por parte.
select test.afirmar((select abs(sum(l.monto) - 300) <= count(*) * 0.005 from public.codigo_interno_lineas(null, true) l
                      where l.fuente = 'GASTOS_DEL_MES' and l.referencia_id = current_setting('prueba.gasto')::uuid),
  'el gasto entero queda repartido');

-- Administración ve los códigos y su costeo, pero no cierra.
select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(exists (select 1 from public.codigos_internos_resumen() r where r.codigo = 'CHK398_A'),
  'Administración ve el código en la lista de Códigos internos');
select test.afirmar((select count(*) from public.codigo_interno_costeo('CHK398_A') l where l.fuente = 'MATERIALES') = 2,
  'Administración ve el costeo del código: su salida y su parte de la de todos');
select test.afirmar((select costo_pen from public.codigos_internos_costo('CHK398_A')) > 0, 'Administración ve el costo del código');
select test.debe_fallar($q$select public.cerrar_costeo_codigo('CHK398_A', 'Entregada en planta el día de la prueba')$q$,
  'Administración no cierra el costeo', 'codigos_internos.cerrar');
-- La ficha de TODOS LOS ACTIVOS dice a dónde fue: lo mismo que suma el costeo de cada código.
select test.afirmar((select r.monto_pen from public.codigo_interno_reparto_a_todos() r
                      where r.codigo = 'CHK398_A' and r.periodo = date_trunc('month', current_date)::date)
                    = (select sum(l.monto) from public.codigo_interno_costeo('CHK398_A') l
                        where l.fuente = 'MATERIALES' and l.detalle like 'Cargado a todos los activos:%')
                    and (select r.monto_pen from public.codigo_interno_reparto_a_todos() r where r.codigo = 'CHK398_A' and r.periodo = date_trunc('month', current_date)::date)
                      = (select r.monto_pen from public.codigo_interno_reparto_a_todos() r where r.codigo = 'CHK398_B' and r.periodo = date_trunc('month', current_date)::date),
  'el reparto de TODOS LOS ACTIVOS dice lo que le tocó a cada código, igual que su costeo');
select test.afirmar(exists (select 1 from public.codigo_interno_reparto_a_todos() r where r.codigo = 'TODOS LOS ACTIVOS' and r.periodo = date '2020-01-01'),
  'y lo que espera, en el mes en que nadie trabajó');
select test.afirmar(not exists (select 1 from public.codigo_interno_reparto_a_todos() r where r.codigo in ('PLANTA', 'OFICINA')),
  'PLANTA y OFICINA no reciben nada de lo cargado a todos');
reset role;
-- El costeo de TODOS LOS ACTIVOS no se cierra: lo guarda la tabla, aunque
-- `cerrar_costeo_codigo` llegara a la escritura con todo completo.
select test.debe_fallar($q$insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
                          values ('TODOS LOS ACTIVOS', 0, '{}'::jsonb, current_setting('prueba.administracion')::uuid)$q$,
  'el costeo de TODOS LOS ACTIVOS no se cierra', 'no es una unidad');
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigo_interno_reparto_a_todos()$q$,
  'el reparto lo leen solo quienes ven los códigos internos', 'codigos_internos.ver');
reset role;

-- ============================================ 3. La orden sin cotización con su PDF
do $$
begin
  insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000398', 'QA CLIENTE 398');
  perform set_config('prueba.cliente', (select id::text from public.clientes where numero_documento = '20990000398'), true);
  perform set_config('prueba.sede', (select id::text from public.sedes order by codigo limit 1), true);
  perform set_config('prueba.ruta', 'ot/' || current_setting('prueba.ot') || '/' || gen_random_uuid() || '.pdf', true);
end $$;

create or replace function pg_temp.registrar(p_orden text, p_ruta text) returns text language sql as $$
  select format($q$select public.registrar_orden_sin_cotizacion('%s', '%s', null, '%s', null, 'REPARACION', 'ALTA',
    'Reparación del furgón de prueba 398', null, null, null, null, null, null, %s, 'OT 398.pdf', 125000)$q$,
    current_setting('prueba.' || p_orden), current_setting('prueba.cliente'), current_setting('prueba.sede'), coalesce(quote_literal(p_ruta), 'null'));
$$;

select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format($q$insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion) values ('%s', '%s', 'Orden sin PDF por la API')$q$,
  current_setting('prueba.cliente'), current_setting('prueba.sede')),
  'la orden no entra directo a la tabla, sin su PDF', 'row-level security');
select test.debe_fallar(pg_temp.registrar('ot', current_setting('prueba.ruta')),
  'un PDF que no se subió no cuenta', 'El PDF de la orden no llegó');
-- El PDF viaja primero a la carpeta de la orden.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', current_setting('prueba.ruta'), current_setting('prueba.administracion'),
        '{"mimetype":"application/pdf","size":125000}'::jsonb);
select test.debe_fallar(pg_temp.registrar('ot', null), 'sin PDF no hay orden', 'Falta el PDF de la orden');
select test.debe_fallar(pg_temp.registrar('ot_mal', current_setting('prueba.ruta')),
  'el PDF de otra orden no sirve', 'Falta el PDF de la orden');
select test.afirmar(not exists (select 1 from public.ordenes_trabajo where id in (current_setting('prueba.ot')::uuid, current_setting('prueba.ot_mal')::uuid)),
  'los intentos fallidos no dejaron orden');
do $$ begin execute pg_temp.registrar('ot', current_setting('prueba.ruta')); end $$;
select test.debe_fallar(pg_temp.registrar('ot', current_setting('prueba.ruta')), 'la misma orden no se registra dos veces', 'ya quedó registrada');
select test.afirmar((select count(*) from public.ot_adjuntos where orden_id = current_setting('prueba.ot')::uuid and tipo = 'ORDEN') = 1,
  'Administración ve el PDF que subió');
select test.afirmar((select count(*) from storage.objects where bucket_id = 'adjuntos-ot' and name = current_setting('prueba.ruta')) = 1,
  'Administración puede abrir el archivo');
-- Y la orden no se queda sin su PDF: ni quitando la fila ni borrando el archivo.
select test.debe_fallar(format('delete from public.ot_adjuntos where orden_id = %L and tipo = %L', current_setting('prueba.ot'), 'ORDEN'),
  'Administración no deja la orden sin su PDF', 'no se queda sin su PDF');
do $$
declare
  v integer;
begin
  delete from storage.objects where bucket_id = 'adjuntos-ot' and name = current_setting('prueba.ruta');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'ni borrando el archivo en Storage mientras la orden lo nombra');
end $$;
-- Para cambiarlo se sube el nuevo y se quita el viejo.
do $$
declare
  v_ruta text := 'ot/' || current_setting('prueba.ot') || '/' || gen_random_uuid() || '.pdf';
  v integer;
begin
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (current_setting('prueba.ot')::uuid, 'ORDEN', 'orden-corregida.pdf', v_ruta, 'application/pdf', 1000,
          current_setting('prueba.administracion')::uuid);
  delete from public.ot_adjuntos where orden_id = current_setting('prueba.ot')::uuid and ruta_storage = current_setting('prueba.ruta');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'con el PDF nuevo subido, el viejo sí se quita');
end $$;
reset role;
select test.afirmar((select estado::text from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid) = 'BORRADOR'
                    and (select numero from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid) is not null
                    and (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid) is null,
  'la orden nace en borrador, con su número y sin cotización');

select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid) = 1
                    and (select count(*) from public.ot_adjuntos where orden_id = current_setting('prueba.ot')::uuid and tipo = 'ORDEN') = 0,
  'Gerencia ve la orden para aprobarla, pero no el PDF de la OT');
select test.afirmar(public.orden_tiene_pdf(current_setting('prueba.ot')::uuid),
  'pero sabe que la orden tiene su PDF');
select test.afirmar(not public.orden_tiene_pdf(current_setting('prueba.ot_mal')::uuid),
  'y que una orden que no existe no lo tiene');
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar((select count(*) from public.ot_adjuntos where orden_id = current_setting('prueba.ot')::uuid and tipo = 'ORDEN') = 1,
  'Diseño ve el PDF de la orden');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(pg_temp.registrar('ot_vendedor', 'ot/' || current_setting('prueba.ot_vendedor') || '/x.pdf'),
  'Ventas no registra órdenes sin cotización', 'ordenes.crear');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(not public.orden_tiene_pdf(current_setting('prueba.ot')::uuid),
  'quien no ve la orden no sabe si tiene PDF');
reset role;

-- El PDF de una orden que la base rechazó lo quita quien lo subió: borrar por
-- la API de Storage pide poder leerlo. Nadie más lo ve.
select set_config('prueba.suelto', 'ot/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf', false);
select pg_temp.como('administracion');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', current_setting('prueba.suelto'), current_setting('prueba.administracion'),
        '{"mimetype":"application/pdf","size":1000}'::jsonb);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where name = current_setting('prueba.suelto')) = 0,
  'el PDF suelto de otra cuenta no se ve');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
do $$
declare
  v integer;
begin
  delete from storage.objects where bucket_id = 'adjuntos-ot' and name = current_setting('prueba.suelto');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'quien subió el PDF de una orden rechazada lo quita de Storage');
end $$;
reset role;

-- Ninguna unidad se llama TODOS LOS ACTIVOS: un despacho a ella se repartiría entre todas.
select test.debe_fallar($q$insert into public.unidades (codigo_interno) values ('todos los activos')$q$,
  'ninguna unidad se registra con el código TODOS LOS ACTIVOS', 'no es el código de una unidad');
insert into public.unidades (codigo_interno) values ('CHK398_UNIDAD');
select test.debe_fallar($q$update public.unidades set codigo_interno = 'Todos los activos' where codigo_interno = 'CHK398_UNIDAD'$q$,
  'ni se le cambia a ese código', 'no es el código de una unidad');

rollback;
