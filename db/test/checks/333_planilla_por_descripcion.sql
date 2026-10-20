-- La planilla con solo la descripción y la cantidad (migración 20261013141000),
-- con el rol real: ALMACENERO del área ALM y `set local role authenticated`;
-- un supervisor como quien no registra ingresos. Termina en rollback.
--
-- Armazón como dueño: un material del catálogo con la unidad todavía
-- provisional, y uno con identificador hecho con md5 (no RFC), como los que
-- dejó la carga del inventario del 12/10, para que la base los acepte igual.
begin;

-- ----------------------------------------------------------------- armazón
-- Una cuenta por puesto, cada una en su área, como en producción (como el check
-- 330). Antes se tomaba de la base la primera cuenta activa de cada rol, y en
-- una base sin esas cuentas el check se caía antes de probar nada.
do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ALMACENERO:ALM:almacenero', 'SUPERVISOR:PRD:supervisor'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 3)) || '.333@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 333', lower(split_part(v, ':', 3)) || '.333@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

do $$
declare v_und uuid; v_kg uuid; v_cat uuid;
begin
  select id into v_und from public.unidades_medida where codigo = 'UND';
  select id into v_kg from public.unidades_medida where codigo = 'KG';
  select id into v_cat from public.categorias_material where almacen = 'ACCESORIOS' and activo order by codigo limit 1;
  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente)
  values (gen_random_uuid(), 'CHK333-PEND', 'VALVULA  DE PRUEBA 333   ', v_cat, v_und, true);
  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente)
  values (md5('chk333|md5')::uuid, 'CHK333-MD5', 'MATERIAL CON ID MD5 333', v_cat, v_und, true);
  perform set_config('prueba.und', v_und::text, true);
  perform set_config('prueba.kg', v_kg::text, true);
  perform set_config('prueba.pend', (select id::text from public.materiales where codigo = 'CHK333-PEND'), true);
  perform set_config('prueba.md5', md5('chk333|md5')::uuid::text, true);
  perform set_config('prueba.i1', gen_random_uuid()::text, true);
  perform set_config('prueba.i2', gen_random_uuid()::text, true);
  perform set_config('prueba.i3', gen_random_uuid()::text, true);
  perform set_config('prueba.i4', gen_random_uuid()::text, true);
  perform set_config('prueba.i5', gen_random_uuid()::text, true);
  perform set_config('prueba.nuevo', gen_random_uuid()::text, true);
  perform set_config('prueba.otro_nuevo', gen_random_uuid()::text, true);
end $$;

set local role authenticated;

-- 1. El supervisor no registra ingresos.
select pg_temp.como('supervisor');
do $$
begin
  begin
    perform public.registrar_ingreso_planilla_libre(current_setting('prueba.i1')::uuid, current_setting('prueba.pend')::uuid, null,
      'VALVULA DE PRUEBA 333', null, 3, 'SALDO_INICIAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
    raise exception 'FALLA: el supervisor registró un ingreso de planilla';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- 2. Almacén: el material de unidad provisional entra y su unidad queda confirmada.
select pg_temp.como('almacenero');
do $$
declare v uuid; v_pend boolean; v_n integer;
begin
  v := public.registrar_ingreso_planilla_libre(current_setting('prueba.i1')::uuid, current_setting('prueba.pend')::uuid, null,
    'VALVULA DE PRUEBA 333', null, 3, 'SALDO_INICIAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
  if v is distinct from current_setting('prueba.i1')::uuid then raise exception 'FALLA: el ingreso no devolvió su id'; end if;
  select count(*) into v_n from public.v_kardex_almacen where id = v and entrada = 3 and desde_planilla;
  if v_n <> 1 then raise exception 'FALLA: el ingreso no se ve en el kardex como de planilla (%)', v_n; end if;
  -- Reintento de la misma fila: no duplica.
  v := public.registrar_ingreso_planilla_libre(current_setting('prueba.i1')::uuid, current_setting('prueba.pend')::uuid, null,
    'VALVULA DE PRUEBA 333', null, 3, 'SALDO_INICIAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
  select count(*) into v_n from public.v_kardex_almacen where material_id = current_setting('prueba.pend')::uuid;
  if v_n <> 1 then raise exception 'FALLA: el reintento duplicó el ingreso (%)', v_n; end if;
end $$;
reset role;
do $$
begin
  if (select unidad_pendiente from public.materiales where id = current_setting('prueba.pend')::uuid) then
    raise exception 'FALLA: la unidad seguía provisional después de contarlo';
  end if;
end $$;
set local role authenticated;
select pg_temp.como('almacenero');

-- 3. Con movimientos, la unidad ya no se cambia desde la planilla.
do $$
begin
  begin
    perform public.registrar_ingreso_planilla_libre(current_setting('prueba.i2')::uuid, current_setting('prueba.pend')::uuid, null,
      'VALVULA DE PRUEBA 333', current_setting('prueba.kg')::uuid, 1, 'INGRESO_GENERAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
    raise exception 'FALLA: cambió la unidad de un material que ya tiene movimientos';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like '%otra unidad%' then raise exception 'FALLA: mensaje inesperado al cambiar la unidad: %', sqlerrm; end if;
  end;
end $$;

-- 4. Un material que no está: se da de alta en POR CLASIFICAR; el mismo nombre otra vez no lo duplica.
do $$
declare v uuid; v_n integer;
begin
  v := public.registrar_ingreso_planilla_libre(current_setting('prueba.i3')::uuid, null, current_setting('prueba.nuevo')::uuid,
    '  tanque de  agua 333 ', current_setting('prueba.und')::uuid, 10, 'SALDO_INICIAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
  v := public.registrar_ingreso_planilla_libre(current_setting('prueba.i4')::uuid, null, current_setting('prueba.otro_nuevo')::uuid,
    'TANQUE DE AGUA 333', current_setting('prueba.und')::uuid, 2, 'INGRESO_GENERAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
  select count(*) into v_n from public.v_kardex_almacen where material_id = current_setting('prueba.nuevo')::uuid;
  if v_n <> 2 then raise exception 'FALLA: el mismo nombre no fue al mismo material (% movimientos)', v_n; end if;
end $$;
reset role;
do $$
declare v_cat text; v_desc text;
begin
  select c.codigo, m.descripcion into v_cat, v_desc from public.materiales m join public.categorias_material c on c.id = m.categoria_id
   where m.id = current_setting('prueba.nuevo')::uuid;
  if v_cat is distinct from 'ALM_POR_CLASIFICAR' or v_desc is distinct from 'TANQUE DE AGUA 333' then
    raise exception 'FALLA: el material nuevo quedó en % como «%»', v_cat, v_desc;
  end if;
  if exists (select 1 from public.materiales where id = current_setting('prueba.otro_nuevo')::uuid) then
    raise exception 'FALLA: se dio de alta dos veces el mismo material';
  end if;
end $$;
set local role authenticated;
select pg_temp.como('almacenero');

-- 5. Un material con identificador md5 (no RFC) entra igual por la planilla.
do $$
declare v uuid;
begin
  v := public.registrar_ingreso_planilla_libre(current_setting('prueba.i5')::uuid, current_setting('prueba.md5')::uuid, null,
    'MATERIAL CON ID MD5 333', null, 4, 'SALDO_INICIAL', 'Planilla de Almacén del 13/10/2026', null, 'PEN', now() - interval '1 minute');
  if v is distinct from current_setting('prueba.i5')::uuid then raise exception 'FALLA: el material md5 no entró'; end if;
end $$;
reset role;

do $$ begin raise notice 'OK 333: planilla por descripción con ALMACENERO; supervisor rechazado'; end $$;
rollback;
