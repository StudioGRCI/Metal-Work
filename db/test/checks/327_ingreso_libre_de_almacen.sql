-- Ingreso libre: Almacén escribe el material sin buscarlo en el catálogo, y lo
-- que entra así se puede sacar después por salida. Con el rol real
-- (ALMACENERO del área ALM) y `set local role authenticated`; un supervisor de
-- taller como quien no puede ingresar. Termina en rollback.
begin;

do $$
begin
  perform set_config('prueba.almacenero', (
    select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
      join public.areas a on a.id = u.area_id
     where r.codigo = 'ALMACENERO' and a.codigo = 'ALM' and u.activo order by u.creado_en limit 1), true);
  perform set_config('prueba.supervisor', (
    select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
     where r.codigo = 'SUPERVISOR' and u.activo order by u.creado_en limit 1), true);
  if current_setting('prueba.almacenero') = '' or current_setting('prueba.supervisor') = '' then
    raise exception 'FALLA: faltan un almacenero del área ALM y un supervisor activos para probar';
  end if;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.ing1', gen_random_uuid()::text, true);
  perform set_config('prueba.ing2', gen_random_uuid()::text, true);
  perform set_config('prueba.mat1', gen_random_uuid()::text, true);
  perform set_config('prueba.mat2', gen_random_uuid()::text, true);
  perform set_config('prueba.salida', gen_random_uuid()::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- 1. El supervisor no ingresa nada, ni escribiendo el material.
select pg_temp.como('supervisor');
set local role authenticated;
do $$ begin
  perform public.registrar_ingreso_material_libre(current_setting('prueba.ing1')::uuid, current_setting('prueba.mat1')::uuid,
    'Disco de corte check 327', current_setting('prueba.und')::uuid, 20, 'INGRESO_GENERAL', 'GR 001-325', 4.5, 'PEN');
  raise exception 'FALLA: un supervisor registró un ingreso libre';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;
reset role;

-- 2. El almacenero escribe el material y entra con su saldo.
select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare v uuid; v_mat uuid; v_saldo numeric;
begin
  v := public.registrar_ingreso_material_libre(current_setting('prueba.ing1')::uuid, current_setting('prueba.mat1')::uuid,
    '  Disco de corte   check 327 ', current_setting('prueba.und')::uuid, 20, 'INGRESO_GENERAL', 'GR 001-325', 4.5, 'PEN');
  if v is distinct from current_setting('prueba.ing1')::uuid then raise exception 'FALLA: el ingreso libre no devolvió su id'; end if;
  select material_id into v_mat from public.movimientos_materiales where id = v;
  if v_mat is distinct from current_setting('prueba.mat1')::uuid then raise exception 'FALLA: el ingreso no quedó con el material nuevo'; end if;
  if not exists (select 1 from public.materiales where id = v_mat and activo and descripcion = 'DISCO DE CORTE CHECK 327') then
    raise exception 'FALLA: el material escrito no quedó activo y con su nombre limpio';
  end if;
  select existencia into v_saldo from public.v_existencias_materiales where material_id = v_mat;
  if v_saldo is distinct from 20::numeric then raise exception 'FALLA: el almacenero ve % de saldo y debía ver 20', v_saldo; end if;

  -- Volver a enviar lo mismo no duplica.
  perform public.registrar_ingreso_material_libre(current_setting('prueba.ing1')::uuid, current_setting('prueba.mat1')::uuid,
    'Disco de corte check 327', current_setting('prueba.und')::uuid, 20, 'INGRESO_GENERAL', 'GR 001-325', 4.5, 'PEN');
  if (select count(*) from public.movimientos_materiales where material_id = v_mat) <> 1 then
    raise exception 'FALLA: el reintento duplicó el ingreso';
  end if;

  -- El mismo nombre (otra forma de escribirlo) es el mismo material.
  perform public.registrar_ingreso_material_libre(current_setting('prueba.ing2')::uuid, current_setting('prueba.mat2')::uuid,
    'disco de CORTE check 327', current_setting('prueba.und')::uuid, 5, 'INGRESO_GENERAL', 'GR 002-325', 4.5, 'PEN');
  if exists (select 1 from public.materiales where id = current_setting('prueba.mat2')::uuid) then
    raise exception 'FALLA: el mismo nombre creó un segundo material';
  end if;
  select existencia into v_saldo from public.v_existencias_materiales where material_id = v_mat;
  if v_saldo is distinct from 25::numeric then raise exception 'FALLA: tras el segundo ingreso el saldo es % y debía ser 25', v_saldo; end if;
end $$;
reset role;

-- 3. Lo ingresado así se descuenta por salida. La foto se deja en el
--    almacenamiento como dueño, igual que la subiría la pantalla.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.salida') || '.jpg',
        current_setting('prueba.almacenero'), '{"mimetype": "image/jpeg", "size": 2048}');
select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare v_saldo numeric;
begin
  perform public.registrar_salida_almacen(current_setting('prueba.salida')::uuid, current_setting('prueba.mat1')::uuid, 8,
    null, 'CHK-325', 'Corte de largueros', 'Operario de prueba',
    current_setting('prueba.almacenero') || '/' || current_setting('prueba.salida') || '.jpg');
  select existencia into v_saldo from public.v_existencias_materiales where material_id = current_setting('prueba.mat1')::uuid;
  if v_saldo is distinct from 17::numeric then raise exception 'FALLA: tras la salida de 8 el saldo es % y debía ser 17', v_saldo; end if;
end $$;
reset role;

do $$ begin raise notice 'OK 327: ingreso libre con el rol de Almacén y salida que lo descuenta'; end $$;
rollback;
