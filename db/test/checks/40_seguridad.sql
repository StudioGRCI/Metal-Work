-- Seguridad a nivel de fila: cada perfil ve y hace únicamente lo suyo.
-- Las consultas se ejecutan con "set role authenticated" y el claim de sesión
-- correspondiente, igual que lo haría PostgREST en Supabase.
\set ON_ERROR_STOP on
begin;

-- Auxiliar de prueba: lee todas las órdenes saltando la seguridad por fila.
-- Sirve para tomar el identificador de una orden ajena y comprobar que el
-- INSERT la rechaza; sin esto habría que poder leerla, que es justo lo que se
-- está probando que no se puede.
create or replace function public.ot_todas_para_prueba()
returns table (id uuid, descripcion text)
language sql
stable
security definer
set search_path = public
as $fn$ select o.id, o.descripcion from public.ordenes_trabajo o $fn$;

insert into public.empresa (ruc, razon_social) values ('20100000004', 'PRUEBAS RLS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres',  'ana@demo.pe',   'ADMIN',       (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Beto',  'Ríos',    'beto@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Carla', 'Vega',    'carla@demo.pe', 'VENDEDOR',    (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Diego', 'Quispe',  'diego@demo.pe', 'OPERARIO',    (select id from public.sedes limit 1), true, 14) as operario_id \gset
select test.crear_usuario('Elsa',  'Mendoza', 'elsa@demo.pe',  'OPERARIO',    (select id from public.sedes limit 1), true, 14) as operario2_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20666666666', 'TRANSPORTES UNIDOS S.A.C.');

-- Dos órdenes: en la primera trabaja Diego, en la segunda no.
insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select c.id, s.id, 'Tolva 18 m3 — orden de Diego'
    from public.clientes c cross join public.sedes s limit 1;
insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select c.id, s.id, 'Plataforma — orden ajena'
    from public.clientes c cross join public.sedes s limit 1;

update public.ordenes_trabajo set estado = 'APROBADA';

insert into public.ot_personal (orden_id, usuario_id, rol)
  select id, :'operario_id', 'SOLDADOR'
    from public.ordenes_trabajo where descripcion like '%Diego%';

-- --- el operario solo ve las órdenes en las que participa -------------------
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 1,
    'el operario ve solo la orden en la que está asignado');
  perform test.afirmar(
    (select descripcion from public.ordenes_trabajo) like '%Diego%',
    'y es exactamente la suya');
  perform test.debe_fallar(
    'insert into public.clientes (tipo_documento, numero_documento, razon_social)
     values (''RUC'', ''20555555555'', ''CLIENTE COLADO'')',
    'un operario no puede registrar clientes');
  perform test.debe_fallar(
    'insert into public.ot_bitacora (orden_id, tipo_evento, descripcion)
     select id, ''COMENTARIO'', ''historial falso'' from public.ordenes_trabajo limit 1',
    'nadie escribe la bitácora a mano: solo la función de registro de eventos');
end $$;

reset role;

-- --- el segundo operario no ve nada -----------------------------------------
select test.como_usuario(:'operario2_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 0,
    'un operario sin órdenes asignadas no ve ninguna');
end $$;

reset role;

-- --- el vendedor ve órdenes pero no toca almacén ni costos ------------------
select test.como_usuario(:'vendedor_id');
set role authenticated;

do $$
declare v_filas int;
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 2,
    'el vendedor ve todas las órdenes');
  perform test.afirmar(
    (select count(*) from public.kardex) = 0,
    'el vendedor no ve el kardex');
  perform test.debe_fallar(
    'insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     select ''X'', ''Material colado'',
            (select id from public.categorias_material limit 1),
            (select id from public.unidades_medida limit 1)',
    'el vendedor no puede crear materiales');
  -- Con RLS, un UPDATE que la política bloquea no lanza error: simplemente no
  -- alcanza ninguna fila. Se comprueba el efecto real, no la excepción.
  update public.ordenes_trabajo set estado = 'EN_PROCESO';
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 0, 'el vendedor no puede mover el estado de ninguna orden');
end $$;

reset role;

-- --- el jefe de taller sí puede mover la producción -------------------------
select test.como_usuario(:'jefe_id');
set role authenticated;

do $$
declare v_filas int;
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 2,
    'el jefe de taller ve todas las órdenes');

  update public.ordenes_trabajo set estado = 'EN_PROCESO'
   where descripcion like '%Diego%';

  perform test.afirmar(
    (select estado from public.ordenes_trabajo where descripcion like '%Diego%') = 'EN_PROCESO',
    'el jefe de taller sí puede iniciar el trabajo');

  delete from public.ordenes_trabajo;
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 0, 'nadie salvo un administrador borra órdenes: se anulan');
end $$;

reset role;

-- --- nadie puede ascenderse a sí mismo --------------------------------------
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
begin
  perform test.debe_fallar(
    format('update public.usuarios set rol_id = (select id from public.roles where codigo = ''ADMIN'')
             where id = %L', public.usuario_actual()),
    'un usuario no puede cambiarse el rol a administrador');

  update public.usuarios set telefono = '987654321' where id = public.usuario_actual();
  perform test.afirmar(
    (select telefono from public.usuarios where id = public.usuario_actual()) = '987654321',
    'pero sí puede corregir sus propios datos de contacto');
end $$;

reset role;

-- --- el administrador pasa por encima de todo --------------------------------
select test.como_usuario(:'admin_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 2,
    'el administrador ve todas las órdenes');
  perform test.afirmar(
    (select count(*) from public.audit_log) > 0,
    'y tiene acceso al historial de auditoría');
end $$;

reset role;

-- --- el operario no puede ampliarse el alcance a sí mismo --------------------
-- Las dos puertas que encontró la auditoría. Antes del blindaje estas dos
-- comprobaciones pasaban sin error: esa era exactamente la falla.
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
declare v_visibles_antes int;
begin
  select count(*) into v_visibles_antes from public.ordenes_trabajo;

  -- Puerta A: dejar de ser operario para dejar de estar restringido.
  perform test.debe_fallar(
    format('update public.usuarios set es_operario = false where id = %L',
           current_setting('request.jwt.claim.sub', true)),
    'el operario no puede quitarse a sí mismo la marca de operario');

  perform test.debe_fallar(
    format('update public.usuarios set costo_hora = 999 where id = %L',
           current_setting('request.jwt.claim.sub', true)),
    'ni cambiarse su costo por hora');

  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = v_visibles_antes,
    'y su alcance de órdenes no cambió tras los intentos');
end $$;

reset role;

-- Puerta B: imputarse horas en una orden ajena para que pase a ser visible.
-- El parte diario sí lo puede crear -es su trabajo-; lo que no puede es
-- colgarle una línea a una orden que no le corresponde.
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
declare
  v_parte  uuid;
  v_ajena  uuid;
  v_antes  int;
begin
  select count(*) into v_antes from public.ordenes_trabajo;

  insert into public.partes_diarios (fecha, sede_id)
    select current_date, id from public.sedes limit 1
    returning id into v_parte;

  -- La orden ajena no se ve desde acá, así que se toma su identificador de la
  -- descripción con una función que corre con privilegios: lo que se prueba es
  -- el insert, no si puede leerla.
  select id into v_ajena from public.ot_todas_para_prueba()
   where descripcion like '%ajena%';

  perform test.debe_fallar(
    format($sql$insert into public.parte_detalle (parte_id, orden_id, usuario_id, horas)
                values (%L, %L, %L, 4)$sql$,
           v_parte, v_ajena, current_setting('request.jwt.claim.sub', true)),
    'el operario no puede imputar horas a una orden ajena');

  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = v_antes,
    'y por lo tanto esa orden sigue sin ser visible para él');
end $$;

reset role;

-- --- las funciones privilegiadas exigen su permiso ---------------------------
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
begin
  perform test.debe_fallar(
    'select public.exigir_permiso(''almacen.confirmar'')',
    'un operario no tiene permiso para confirmar movimientos de almacén');
  perform test.debe_fallar(
    'select public.exigir_permiso(''requerimientos.aprobar'')',
    'ni para aprobar requerimientos');
end $$;

reset role;

-- --- y las internas no son alcanzables --------------------------------------
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
begin
  perform test.debe_fallar(
    'select public.siguiente_correlativo(''ORDEN_TRABAJO'')',
    'nadie quema correlativos a mano');
end $$;

reset role;

-- --- sin sesión no se ve nada ------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo) = 0,
    'sin sesión válida no se ve ninguna orden');
  perform test.afirmar(
    (select count(*) from public.clientes) = 0,
    'ni ningún cliente');
end $$;

reset role;
rollback;
