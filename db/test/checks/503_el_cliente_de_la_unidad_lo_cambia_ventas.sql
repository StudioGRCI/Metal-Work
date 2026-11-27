-- El cliente de la unidad lo cambia Ventas, no Diseño (migración 20261127200000;
-- lo dejó abierto la 20261127183500 y StudioGRCI pidió cerrarlo en otro PR):
--   1. Diseño (`diseno.unidades`) no cambia ni quita el cliente de una unidad
--      sin OT por la API, y el aviso le dice que no es de su puesto.
--   2. Diseño sigue corrigiendo los datos del vehículo, también mandando el
--      mismo cliente que ya tenía (lo que manda la ficha de la unidad).
--   3. Ventas (`clientes.editar`) y el administrador sí cambian el cliente de
--      la unidad sin OT, como siempre.
--   4. Un camino del sistema (`security definer`) que le pone el cliente a la
--      unidad lo hace aunque quien lo llama no tenga `clientes.editar`:
--      Administración con «Poner cliente» (la cadena completa está en el 502).
--   5. Sin sesión sigue entrando.
-- Cada paso con la cuenta del puesto y `set local role authenticated`. Termina
-- en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000503', 'PRUEBAS 503 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA503', 'Taller prueba 503') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA503' \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas503@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Dora', 'Diseño', 'diseno503@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('Lino', 'Líder', 'lider503@demo.pe', 'DISENO_LIDER', :'sede_id') as lider_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina503@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin503@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000503', 'QA PRIMER CLIENTE 503');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001503', 'QA SEGUNDO CLIENTE 503');

select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.lider', :'lider_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.cliente_a', (select id::text from public.clientes where numero_documento = '20990000503'), true);
select set_config('prueba.cliente_b', (select id::text from public.clientes where numero_documento = '20990001503'), true);
select set_config('prueba.u_libre', gen_random_uuid()::text, true);  -- del primer cliente, sin OT
select set_config('prueba.u_taller', gen_random_uuid()::text, true); -- sin cliente, de una OT del taller
select set_config('prueba.taller', gen_random_uuid()::text, true);

create function pg_temp.cliente_de_unidad(p_unidad text) returns uuid
language sql as $$ select cliente_id from public.unidades where id = p_unidad::uuid $$;

-- 0. Lo que ya hay: la unidad sin OT, registrada por Ventas, y la OT del taller --
do $$
begin
  perform test.afirmar(
    (select count(*) from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
      where r.codigo in ('DISENO', 'DISENO_LIDER') and rp.permiso_codigo = 'diseno.unidades') = 2
    and not exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
      where r.codigo in ('DISENO', 'DISENO_LIDER', 'ADMINISTRACION') and rp.permiso_codigo = 'clientes.editar'),
    'La prueba vale: Diseño corrige unidades sin llevar clientes, y Administración tampoco los lleva');

  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  insert into public.unidades (id, cliente_id, placa, tipo_vehiculo, marca, modelo)
  values (current_setting('prueba.u_libre')::uuid, current_setting('prueba.cliente_a')::uuid, 'QA5-503', 'CAMION', 'VOLVO', 'FH');
  reset role;

  -- La OT del taller sin cliente, como la abre el taller (armazón sin sesión).
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.unidades (id, placa, tipo_vehiculo) values (current_setting('prueba.u_taller')::uuid, 'QA6-503', 'CAMION');
  insert into public.ordenes_trabajo (id, numero, sede_id, descripcion, abierta_en_taller, unidad_id) values
    (current_setting('prueba.taller')::uuid, '50399-2026', current_setting('prueba.sede')::uuid, 'OT del taller sin cliente 503', true,
     current_setting('prueba.u_taller')::uuid);
end $$;

-- 1 y 2. Diseño corrige el vehículo, no el cliente ------------------------------
do $$
declare
  v integer;
  quien text;
begin
  foreach quien in array array['prueba.diseno', 'prueba.lider'] loop
    perform test.como_usuario(current_setting(quien)::uuid);
    set local role authenticated;
    perform test.debe_fallar(
      format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_b'), current_setting('prueba.u_libre')),
      quien || ' no cambia el cliente de la unidad sin OT',
      'El cliente de la unidad QA5-503 no se cambia desde tu puesto: eso lo ve Ventas');
    perform test.debe_fallar(
      format('update public.unidades set cliente_id = null where id = %L', current_setting('prueba.u_libre')),
      quien || ' tampoco se lo quita', 'no se cambia desde tu puesto');
    perform test.debe_fallar(
      format('update public.unidades set marca = %L, cliente_id = %L where id = %L', 'SCANIA', current_setting('prueba.cliente_b'), current_setting('prueba.u_libre')),
      quien || ' no lo cuela junto con los datos del vehículo', 'no se cambia desde tu puesto');
    perform test.debe_fallar(
      format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_a'), current_setting('prueba.u_taller')),
      quien || ' no le pone cliente a la unidad que no tenía', 'no se cambia desde tu puesto');

    update public.unidades set marca = 'SCANIA', modelo = 'R450', numero_chasis = 'QACHASIS503', color = 'ROJO'
     where id = current_setting('prueba.u_libre')::uuid;
    get diagnostics v = row_count;
    perform test.afirmar(v = 1, quien || ' sigue corrigiendo los datos del vehículo: ' || v || ' fila');
    -- Lo que manda la ficha al corregir: el mismo cliente que ya tenía.
    update public.unidades set cliente_id = current_setting('prueba.cliente_a')::uuid, color = 'BLANCO'
     where id = current_setting('prueba.u_libre')::uuid;
    get diagnostics v = row_count;
    perform test.afirmar(v = 1, quien || ' corrige mandando el mismo cliente: ' || v || ' fila');
    reset role;
  end loop;

  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u_libre')) = current_setting('prueba.cliente_a')::uuid
    and (select marca from public.unidades where id = current_setting('prueba.u_libre')::uuid) = 'SCANIA'
    and pg_temp.cliente_de_unidad(current_setting('prueba.u_taller')) is null,
    'La unidad sigue del primer cliente con los datos que corrigió Diseño, y la del taller sigue sin cliente');
end $$;

-- 3. Ventas y el administrador sí -----------------------------------------------
do $$
declare
  v integer;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  update public.unidades set cliente_id = current_setting('prueba.cliente_b')::uuid where id = current_setting('prueba.u_libre')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1 and pg_temp.cliente_de_unidad(current_setting('prueba.u_libre')) = current_setting('prueba.cliente_b')::uuid,
    'Ventas cambia el cliente de la unidad sin OT: ' || v || ' fila');

  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  set local role authenticated;
  update public.unidades set cliente_id = current_setting('prueba.cliente_a')::uuid where id = current_setting('prueba.u_libre')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1 and pg_temp.cliente_de_unidad(current_setting('prueba.u_libre')) = current_setting('prueba.cliente_a')::uuid,
    'El administrador también: ' || v || ' fila');
end $$;

-- 4. El camino del sistema no pide `clientes.editar` -----------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform public.poner_cliente_a_orden(current_setting('prueba.taller')::uuid, current_setting('prueba.cliente_b')::uuid);
  reset role;
  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u_taller')) = current_setting('prueba.cliente_b')::uuid
    and (select cliente_id from public.ordenes_trabajo where id = current_setting('prueba.taller')::uuid) = current_setting('prueba.cliente_b')::uuid,
    'Administración le pone el cliente a la OT del taller y a su unidad con «Poner cliente»');
end $$;

-- 5. Sin sesión, y el disparador en su lugar -------------------------------------
do $$
declare
  v integer;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  update public.unidades set cliente_id = current_setting('prueba.cliente_b')::uuid where id = current_setting('prueba.u_libre')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Sin sesión sigue entrando');

  perform test.afirmar(
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.unidades'::regclass
             and t.tgname = 'trg_unidad_cliente_lo_cambia_ventas' and t.tgenabled = 'O')
    and 'trg_unidad_cliente_lo_cambia_ventas' < 'trg_unidad_con_ot_conserva_su_cliente'
    and not has_function_privilege('authenticated', 'public.fn_unidad_cliente_lo_cambia_ventas()', 'execute')
    and not has_function_privilege('anon', 'public.fn_unidad_cliente_lo_cambia_ventas()', 'execute'),
    'El disparador está, corre antes que el de la unidad con OT y nadie llama su función');
end $$;

rollback;
