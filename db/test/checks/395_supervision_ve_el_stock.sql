-- Supervisión ve el stock de Almacén (migración 20261016950000). El supervisor
-- de área ve cuánto hay de cada material, en qué almacén y, de cada accesorio,
-- cuánto es de cada código interno; lo mismo que dice el kardex, sin abrir el
-- kardex. Almacén lo ve igual. Desde la migración 20261020195000 también
-- Requerimientos, sin el kardex (check 414); Ventas no. Cada paso con el rol
-- que lo da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Una sola Supervisión activa por área: si la base ya trae la de Maestranza, se usa esa.
  foreach v in array array['SUPERVISOR:MTZ', 'ALMACENERO:ALM', 'REQUERIMIENTOS:REQ', 'VENDEDOR:GCO'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.395@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 395', lower(replace(v, ':', '.')) || '.395@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  -- Un consumible y un accesorio, cada uno de la familia de su almacén.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK395-DIS', 'Disco de corte 7 pulgadas (395)',
          (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id::text into v;
  perform set_config('prueba.consumible', v, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK395-FAR', 'Faro posterior LED (395)',
          (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id::text into v;
  perform set_config('prueba.accesorio', v, true);
end $$;

-- 1. Almacén mueve el kardex: 10 discos entran y salen 3; del faro entran 5 para
--    CHK395-A (sale 1 para ella), 2 para CHK395-B y 4 sin código.
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
values
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.consumible')::uuid, 10, 'INGRESO_GENERAL', 'GR 395-1', current_setting('prueba.almacenero')::uuid, null),
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.accesorio')::uuid, 5, 'INGRESO_GENERAL', 'GR 395-2', current_setting('prueba.almacenero')::uuid, 'chk395-a'),
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.accesorio')::uuid, 2, 'INGRESO_GENERAL', 'GR 395-3', current_setting('prueba.almacenero')::uuid, 'CHK395-B'),
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.accesorio')::uuid, 4, 'INGRESO_GENERAL', 'GR 395-4', current_setting('prueba.almacenero')::uuid, null);
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           codigo_unidad, registrado_por, codigo_interno)
values
  (gen_random_uuid(), 'SALIDA', current_setting('prueba.consumible')::uuid, 3, 'SALIDA_GENERAL', 'Corte de largueros', 'Soldador MTZ',
   'CHK395-A', current_setting('prueba.almacenero')::uuid, 'CHK395-A'),
  (gen_random_uuid(), 'SALIDA', current_setting('prueba.accesorio')::uuid, 1, 'SALIDA_GENERAL', 'Instalación', 'Electricista ACB',
   'CHK395-A', current_setting('prueba.almacenero')::uuid, 'CHK395-A');

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- 2. El supervisor de Maestranza ve el stock que reporta Almacén.
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select existencia = 7 and almacen = 'CONSUMIBLES' and por_codigo = '[]'::jsonb
     from public.stock_en_almacen() where material_id = current_setting('prueba.consumible')::uuid),
  'El supervisor ve 7 discos en Consumibles: 10 que entraron menos 3 que salieron');
select test.afirmar(
  (select existencia = 10 and almacen = 'ACCESORIOS'
          and por_codigo = '[{"codigo": "CHK395-A", "cantidad": 4}, {"codigo": "CHK395-B", "cantidad": 2}]'::jsonb
     from public.stock_en_almacen() where material_id = current_setting('prueba.accesorio')::uuid),
  'El supervisor ve 10 faros: 4 de CHK395-A, 2 de CHK395-B y el resto libre');
-- Cuántos ve, para compararlo con lo que ve Almacén en su kardex.
select set_config('prueba.vistos', (select count(*)::text from public.stock_en_almacen()), true);
-- Pero no abre el kardex: ni los movimientos ni quién recibió.
select test.afirmar(
  (select count(*) from public.movimientos_materiales
    where material_id in (current_setting('prueba.consumible')::uuid, current_setting('prueba.accesorio')::uuid)) = 0,
  'El supervisor no lee los movimientos del kardex');
select test.afirmar(
  (select count(*) from public.v_kardex_almacen
    where material_id in (current_setting('prueba.consumible')::uuid, current_setting('prueba.accesorio')::uuid)) = 0,
  'El supervisor no lee el kardex');
reset role;

-- 3. Almacén lo ve igual que en su kardex.
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(
  (select e.existencia = s.existencia
     from public.stock_en_almacen() s
     join public.v_existencias_materiales e on e.material_id = s.material_id
    where s.material_id = current_setting('prueba.accesorio')::uuid),
  'Almacén ve el mismo stock que su kardex');
select test.afirmar(
  (select count(*) from public.v_existencias_materiales) = current_setting('prueba.vistos')::integer,
  'El supervisor ve los mismos materiales que tienen kardex, ni uno más ni uno menos');
reset role;

-- 4. Requerimientos lo ve desde el 2026-10-20, para saber qué hay antes de pedir;
-- Ventas no.
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select count(*) from public.stock_en_almacen()) = current_setting('prueba.vistos')::integer,
  'Requerimientos ve el mismo stock que el supervisor');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.stock_en_almacen()', 'Ventas no ve el stock de Almacén', 'No tienes permiso');
reset role;

-- 5. Nadie sin sesión.
select test.afirmar(not has_function_privilege('anon', 'public.stock_en_almacen()', 'execute'),
  'Sin sesión no se lee el stock');
select test.afirmar(
  (select count(*) from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
    where rp.permiso_codigo = 'almacen.stock' and r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION')) = 2,
  'Los supervisores de área y el jefe de producción tienen el permiso');

rollback;
