-- El gasto operativo por área (migración 20261127190000), con el rol real:
-- Gerencia, Administración, los supervisores de Producción y Maestranza, uno
-- sin área y el almacenero, cada uno con `set local role authenticated`.
-- Termina en rollback.
--
-- Lo cargado a PLANTA:
--   a. lo que salió para un RQ del área de Producción: 2 × S/ 10 = S/ 20, de Producción;
--   b. lo que salió a PLANTA sin RQ: 1 × S/ 10 = S/ 10, «Planta, sin área»;
--   c. una OS aprobada de Maestranza con PLANTA: S/ 100, de Maestranza;
--   d. una OS de Maestranza todavía por aprobar: S/ 40, se muestra y no suma;
--   e. las horas de un reporte de Producción con PLANTA: S/ 50 de mano de obra, de Producción;
--   f. una compra con PLANTA: no es gasto todavía (cuenta cuando sale) y no aparece;
--   g. el recibo de un subcontrato de Producción con PLANTA: S/ 300, de Producción.
--
-- 1. Gerencia y Administración ven las seis líneas; lo que suma da S/ 480, lo
--    mismo que el costo de PLANTA en `codigos_internos_costo_calculado`.
-- 2. El supervisor de Producción ve solo lo de Producción, sin la mano de obra
--    ni el subcontrato (los ve sin montos desde la 20261020180000): S/ 20. El de
--    Maestranza, solo sus OS: S/ 100 que suman.
-- 3. Sin área, o sin permiso, no ve nada y se le dice por qué.
-- 4. El periodo filtra por fecha, y uno al revés se rechaza.
-- 5. El cálculo no lo llama nadie directo, y cada permiso lo tiene algún rol.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['GERENTE:GGE:gerente', 'ADMINISTRACION:ADM:administracion', 'SUPERVISOR:PRD:sup_prd',
                           'SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR::sup_sin_area', 'ALMACENERO:ALM:almacenero'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, replace(split_part(v, ':', 3), '_', '.') || '.504@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 504', replace(split_part(v, ':', 3), '_', '.') || '.504@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Lo que vale para el cálculo, sin contar lo que otros checks dejaron en PLANTA
-- (la base de prueba empieza vacía, pero así el check vale en cualquiera).
create temp table antes on commit drop as
  select count(*) as lineas, coalesce(sum(soles) filter (where suma), 0) as soles
    from public.gasto_operativo_lineas_calculado(null, null);

-- a y b. Lo que sale del almacén ------------------------------------------------------
do $$
declare v_mat uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK504-HERR', 'Broca del check 504',
          (select id from public.categorias_material where almacen = 'CONSUMIBLES' and activo order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id into v_mat;
  perform set_config('prueba.mat', v_mat::text, true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
end $$;

select pg_temp.como('sup_prd');
set local role authenticated;
select public.emitir_requerimiento_del_area(current_setting('prueba.rq')::uuid, current_setting('prueba.prd')::uuid,
  'Brocas para el área de Producción, se deshace', null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 2)));
reset role;

select test.metrado_autorizado();
do $$
declare k text;
begin
  perform set_config('prueba.linea', (select id::text from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1), true);
  foreach k in array array['s_area', 's_suelta'] loop
    perform set_config('prueba.' || k, gen_random_uuid()::text, true);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || k) || '.jpg',
            current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
  end loop;
end $$;

select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.mat')::uuid, 10, 'INGRESO_GENERAL', 'ENSAYO 504', 10, 'PEN');
do $$
declare v_uid text := auth.uid()::text;
begin
  perform public.registrar_salida_material(current_setting('prueba.s_area')::uuid, current_setting('prueba.mat')::uuid, 2,
    null, 'PLANTA', 'Salida del check 504', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_area') || '.jpg',
    current_setting('prueba.linea')::uuid);
  perform public.registrar_salida_material(current_setting('prueba.s_suelta')::uuid, current_setting('prueba.mat')::uuid, 1,
    null, 'PLANTA', 'Salida del check 504 sin RQ', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_suelta') || '.jpg',
    null);
end $$;
reset role;

-- c a f. Las OS, las horas y la compra se siembran directo: lo que se prueba es
-- de qué área es cada una y quién la ve, no cómo se registran (sus checks son otros).
set local session_replication_role = replica;
do $$
declare v_prov uuid := gen_random_uuid(); v_trab uuid := gen_random_uuid(); v_rep uuid := gen_random_uuid();
        v_lin uuid := gen_random_uuid(); v_hoy date := (now() at time zone 'America/Lima')::date;
        v_ger uuid := current_setting('prueba.gerente')::uuid; v_sct uuid := gen_random_uuid(); v_sc uuid := gen_random_uuid();
begin
  insert into public.proveedores (id, numero_documento, razon_social) values (v_prov, '20999950401', 'SERVICIOS DEL CHECK 504 S.A.C.');
  insert into public.ordenes_servicio (numero, proveedor_id, proveedor, area_id, descripcion, moneda, monto, monto_pen,
                                       aprobacion, aprobado_por, aprobado_en, codigo_interno, creado_por)
  values ('OS-CHK504-1', v_prov, 'SERVICIOS DEL CHECK 504 S.A.C.', current_setting('prueba.mtz')::uuid,
          'Afilado de las cuchillas de la cizalla', 'PEN', 100, 100, 'APROBADA', v_ger, now(), 'PLANTA', v_ger),
         ('OS-CHK504-2', v_prov, 'SERVICIOS DEL CHECK 504 S.A.C.', current_setting('prueba.mtz')::uuid,
          'Revisión de la soldadora del área', 'PEN', 40, 40, 'POR_APROBAR', null, null, 'PLANTA', v_ger);

  insert into public.trabajadores (id, nombres, apellidos, dni, area_id) values (v_trab, 'OPERARIO', 'DEL CHECK 504', '99950401', current_setting('prueba.prd')::uuid);
  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
  values (v_rep, v_hoy, 'PLANTA', 'Orden del área', 'Ordenar y limpiar la mesa de armado', current_setting('prueba.prd')::uuid,
          current_setting('prueba.sup_prd')::uuid);
  insert into public.reporte_diario_personal (id, reporte_id, trabajador_id, nombre, fecha, horas)
  values (v_lin, v_rep, v_trab, 'OPERARIO DEL CHECK 504', v_hoy, 5);
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, costo_hora, costo, registrado_por, reporte_linea_id)
  values (v_trab, v_hoy, 'PLANTA', 5, 10, 50, v_ger, v_lin);

  insert into public.subcontratistas (id, ruc, nombre) values (v_sct, '10999950405', 'SOLDADOR DEL CHECK 504');
  insert into public.subcontratos (id, numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, area_id, creado_por)
  values (v_sc, 'SC-CHK504', v_sct, 'PLANTA', 'Reparar la mesa de armado de Producción', 'PEN', 300, current_setting('prueba.prd')::uuid, v_ger);
  insert into public.recibos_honorarios (subcontrato_id, subcontratista_id, numero, fecha_emision, moneda, monto_bruto,
                                         archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (v_sc, v_sct, 'E001-504', v_hoy, 'PEN', 300, 'chk504/recibo.pdf', 'application/pdf', 100, v_ger);

  insert into public.ordenes_compra_materiales (numero, referencia, proveedor, codigo_interno, moneda, origen, motivo, creado_por)
  values ('OC-CHK504', 'OC del check 504', 'SERVICIOS DEL CHECK 504 S.A.C.', 'PLANTA', 'PEN', 'DIRECTA', 'Compra directa del check 504', v_ger);
end $$;
set local session_replication_role = origin;
-- La compra sí está en las líneas del costeo de PLANTA: si no, que no aparezca no probaría nada.
select test.afirmar(
  (select count(*) = 1 from public.codigo_interno_lineas('PLANTA', true) k
    where k.fuente = 'COMPRAS' and k.referencia_id = (select id from public.ordenes_compra_materiales where numero = 'OC-CHK504')),
  'la compra con PLANTA está en el costeo de PLANTA, como compra');

-- 1. Gerencia y Administración ven todo ----------------------------------------------------
select pg_temp.como('gerente');
set local role authenticated;
create temp table de_gerencia on commit drop as select * from public.gasto_operativo(null, null);
reset role;
select test.afirmar((select count(*) from de_gerencia) = (select lineas from antes) + 6,
  'Gerencia ve las seis líneas nuevas del gasto operativo: dos salidas, dos OS, las horas y el recibo (la compra no)');
select test.afirmar(
  (select coalesce(sum(soles) filter (where suma), 0) from de_gerencia) = (select soles from antes) + 480,
  'lo que suma para Gerencia es S/ 480: 20 + 10 + 100 + 50 + 300, sin la OS por aprobar');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where grupo = 'SUBCONTRATOS' and area = 'Producción' and suma and soles = 300),
  'el recibo del subcontrato de Producción con PLANTA es de Producción, S/ 300');
select test.afirmar(
  (select coalesce(sum(soles) filter (where suma), 0) from de_gerencia)
  = (select coalesce(sum(costo_pen), 0) from public.codigos_internos_costo_calculado('PLANTA')),
  'el gasto operativo suma lo mismo que el costo de PLANTA: la misma regla de qué cuenta');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where fuente = 'MATERIALES' and area = 'Producción' and soles = 20),
  'lo salido para el RQ del área es de Producción, a S/ 20');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where fuente = 'MATERIALES' and area_id is null and area = 'Planta, sin área' and soles = 10),
  'lo salido a PLANTA sin RQ del área va como «Planta, sin área»');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where grupo = 'SERVICIOS' and area = 'Maestranza' and suma and soles = 100),
  'la OS aprobada es de Maestranza y suma S/ 100');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where fuente = 'SERVICIOS_POR_APROBAR' and area = 'Maestranza' and not suma and soles is null),
  'la OS por aprobar se ve y no suma');
select test.afirmar(
  (select count(*) = 1 from de_gerencia where grupo = 'MANO_OBRA' and area = 'Producción' and soles = 50),
  'las horas del reporte de Producción con PLANTA son mano de obra de Producción, S/ 50');
select test.afirmar((select count(*) = 0 from de_gerencia where fuente = 'COMPRAS'
                or referencia_id = (select id from public.ordenes_compra_materiales where numero = 'OC-CHK504')),
  'la compra con PLANTA no es gasto operativo: cuenta cuando sale del almacén');

select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar((select count(*) from public.gasto_operativo(null, null)) = (select count(*) from de_gerencia),
  'Administración ve lo mismo que Gerencia');
reset role;

-- 2. Cada supervisor, su área y sin la mano de obra ---------------------------------------------
select pg_temp.como('sup_prd');
set local role authenticated;
create temp table de_produccion on commit drop as select * from public.gasto_operativo(null, null);
reset role;
select test.afirmar((select count(*) = 1 from de_produccion),
  'el supervisor de Producción ve una sola línea: lo salido para su RQ del área');
select test.afirmar((select bool_and(area = 'Producción' and grupo = 'MATERIALES' and soles = 20) from de_produccion),
  'y es de Producción, S/ 20, sin la mano de obra ni el subcontrato de su área');

select pg_temp.como('sup_mtz');
set local role authenticated;
create temp table de_maestranza on commit drop as select * from public.gasto_operativo(null, null);
reset role;
select test.afirmar((select count(*) = 2 and bool_and(area = 'Maestranza' and grupo = 'SERVICIOS') from de_maestranza),
  'el supervisor de Maestranza ve solo sus dos OS');
select test.afirmar((select sum(soles) filter (where suma) = 100 from de_maestranza),
  'y le suman S/ 100: la por aprobar no');

-- 3. Sin área o sin permiso ---------------------------------------------------------------------
select pg_temp.como('sup_sin_area');
set local role authenticated;
select test.debe_fallar($q$select * from public.gasto_operativo(null, null)$q$,
  'un supervisor sin área no ve el gasto operativo', 'Tu cuenta no tiene área');
select pg_temp.como('almacenero');
select test.debe_fallar($q$select * from public.gasto_operativo(null, null)$q$,
  'el almacenero no ve el gasto operativo', 'No tienes permiso para ver el gasto operativo');

-- 4. El periodo -----------------------------------------------------------------------------------
select pg_temp.como('gerente');
select test.afirmar(
  (select count(*) = 0 from public.gasto_operativo((now() at time zone 'America/Lima')::date + 1, null)),
  'desde mañana no hay gasto operativo');
select test.afirmar(
  (select count(*) from public.gasto_operativo(date_trunc('month', now() at time zone 'America/Lima')::date,
                                               (now() at time zone 'America/Lima')::date)) >= 6,
  'el mes en curso trae las seis líneas');
select test.debe_fallar($q$select * from public.gasto_operativo('2026-11-30', '2026-11-01')$q$,
  'un periodo al revés se rechaza', 'termina antes de empezar');

-- 5. Las puertas ----------------------------------------------------------------------------------
select test.debe_fallar($q$select * from public.gasto_operativo_lineas_calculado(null, null)$q$,
  'el cálculo no se llama directo', 'permission denied');
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.gasto_operativo(date, date)', 'execute'),
  'anon no ejecuta el gasto operativo');
select test.afirmar(
  (select count(distinct rp.permiso_codigo) = 2 from public.roles_permisos rp
    where rp.permiso_codigo in ('gasto_operativo.ver', 'gasto_operativo.area')),
  'los dos permisos del gasto operativo los tiene algún rol');

select 'OK 504 el gasto operativo por área' as resultado;
rollback;
