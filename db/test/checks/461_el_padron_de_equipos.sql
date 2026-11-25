-- El padrón de equipos de la planta y el puesto de Mantenimiento (migración
-- 20261125160000, Plan 16.1). Cada paso con su puesto y `set local role
-- authenticated`: Mantenimiento da de alta, corrige, cambia el estado y da de
-- baja; Almacén solo cambia quién lo tiene a cargo; Gerencia consulta; Ventas
-- no ve ni escribe. El permiso de cada acción es el de la política de la tabla.
-- Un equipo no se borra, ni por el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA460', 'Taller prueba 460') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA460' \gset
select test.crear_usuario('Ada', 'Admin', 'admin460@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Manu', 'Mantenimiento', 'mnt460@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt_id \gset
select test.crear_usuario('Alma', 'Almacén', 'alm460@demo.pe', 'ALMACENERO', :'sede_id') as alm_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger460@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas460@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset

select set_config('prueba.mnt', :'mnt_id', true);
select set_config('prueba.alm', :'alm_id', true);
select set_config('prueba.ger', :'ger_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.amoladora', (select id::text from public.equipo_categorias where prefijo = 'AM-04'), true);
select set_config('prueba.soldar', (select id::text from public.equipo_categorias where prefijo = 'MS'), true);
select set_config('prueba.otros', (select id::text from public.equipo_categorias where nombre = 'Otros'), true);
select set_config('prueba.area', (select id::text from public.areas where codigo = 'MTZ'), true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

-- 0. Lo que la migración dejó ----------------------------------------------------
select test.afirmar(
  (select count(*) = 3 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo = 'MANTENIMIENTO' and rp.permiso_codigo in ('equipos.ver', 'equipos.gestionar', 'equipos.asignar')),
  'Mantenimiento tiene los tres permisos del padrón');
select test.afirmar(
  (select array_agg(rp.permiso_codigo order by rp.permiso_codigo) = array['equipos.asignar', 'equipos.ver']
     from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo = 'ALMACENERO' and rp.permiso_codigo like 'equipos.%'),
  'Almacén ve y asigna, no gestiona');
select test.afirmar(
  (select array_agg(rp.permiso_codigo) = array['equipos.ver']
     from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo = 'GERENTE' and rp.permiso_codigo like 'equipos.%'),
  'Gerencia solo consulta');
select test.afirmar(
  not exists (select 1 from public.permisos p where p.codigo like 'equipos.%'
               and not exists (select 1 from public.roles_permisos rp where rp.permiso_codigo = p.codigo)),
  'ningún permiso del padrón quedó sin puesto');
select test.afirmar(
  (select count(*) >= 8 from public.equipo_categorias)
  and (select prefijo is null from public.equipo_categorias where nombre = 'Otros'),
  'las categorías de la hoja están, y «Otros» no tiene prefijo');

-- 1. Mantenimiento da de alta ----------------------------------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;

do $$
declare v_id uuid; v record;
begin
  -- Sin código: la base da el que sigue en su categoría.
  insert into public.equipos (descripcion, categoria_id, marca, area_id, a_cargo_de)
  values ('  Esmeril/Amoladora   angular 4-1/2" 1500W ', pg_temp.id('amoladora'), ' Dewalt ', pg_temp.id('area'), ' juan  pérez ')
  returning id into v_id;
  perform set_config('prueba.eq1', v_id::text, true);
  select * into v from public.equipos where id = v_id;
  perform test.afirmar(v.codigo = 'AM-04-01', 'el primer equipo de la categoría toma AM-04-01 (dio ' || v.codigo || ')');
  perform test.afirmar(v.descripcion = 'Esmeril/Amoladora angular 4-1/2" 1500W' and v.marca = 'DEWALT' and v.a_cargo_de = 'JUAN PÉREZ',
    'la descripción queda sin espacios de más, y la marca y «a cargo de» en mayúsculas');
  perform test.afirmar(v.estado = 'OPERATIVO' and v.activo and v.creado_por = pg_temp.id('mnt'),
    'nace operativo, en uso y a nombre de quien lo dio de alta');

  -- Con el código que el equipo ya lleva grabado, como en la hoja.
  insert into public.equipos (codigo, descripcion, categoria_id) values (' am-04-06 ', 'Amoladora 4 1/2 Dewalt', pg_temp.id('amoladora'))
  returning id into v_id;
  perform set_config('prueba.eq2', v_id::text, true);
  perform test.afirmar((select codigo = 'AM-04-06' from public.equipos where id = v_id), 'el código escrito se respeta, en mayúsculas');
  perform test.afirmar((select codigo = 'AM-04-07' from public.equipos_codigos_que_siguen() where categoria_id = pg_temp.id('amoladora')),
    'el que sigue cuenta desde el mayor que existe: AM-04-07');
  perform test.afirmar((select codigo = 'MS-01' from public.equipos_codigos_que_siguen() where categoria_id = pg_temp.id('soldar')),
    'la primera máquina de soldar será MS-01');
  perform test.afirmar(not exists (select 1 from public.equipos_codigos_que_siguen() where categoria_id = pg_temp.id('otros')),
    '«Otros» no propone código');
end $$;

select test.debe_fallar(
  $$insert into public.equipos (descripcion, categoria_id) values ('Sierra circular', pg_temp.id('otros'))$$,
  'sin prefijo y sin código, no entra', 'Escribe el código');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id) values ('AM-04-06', 'Repetida', pg_temp.id('amoladora'))$$,
  'el código no se repite', 'uq_equipos_codigo');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id) values ('AM 04/99', 'Mal código', pg_temp.id('amoladora'))$$,
  'un código con signos raros no entra', 'ck_equipos_codigo');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id, estado) values ('MC-01', 'Máquina de calor', pg_temp.id('otros'), 'PARADO')$$,
  'parado sin decir qué tiene, no entra', 'Di qué tiene');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id, activo, baja_motivo) values ('MC-02', 'Máquina de calor', pg_temp.id('otros'), false, 'Nació de baja')$$,
  'no se da de alta un equipo ya dado de baja', 'se da de alta en uso');

-- 2. Mantenimiento corrige, cambia el estado y da de baja -------------------------
do $$
declare v integer; e record; v_antes timestamptz;
begin
  select estado_desde into v_antes from public.equipos where id = pg_temp.id('eq1');
  update public.equipos set estado = 'CON_OBSERVACION', estado_nota = 'El cable está pelado', estado_desde = '2020-01-01'
   where id = pg_temp.id('eq1');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Mantenimiento cambia el estado (una fila, no cero)');
  select * into e from public.equipos where id = pg_temp.id('eq1');
  perform test.afirmar(e.estado = 'CON_OBSERVACION' and e.estado_nota = 'El cable está pelado' and e.estado_desde >= v_antes,
    'queda con observación, con su motivo, y el «desde» lo pone la base, no quien escribe');

  update public.equipos set estado = 'OPERATIVO', estado_nota = 'ya no importa' where id = pg_temp.id('eq1');
  perform test.afirmar((select estado_nota is null from public.equipos where id = pg_temp.id('eq1')),
    'operativo no guarda motivo');

  update public.equipos set ubicacion = 'Nave 2', creado_por = pg_temp.id('ger'), creado_en = '2020-01-01' where id = pg_temp.id('eq1');
  select * into e from public.equipos where id = pg_temp.id('eq1');
  perform test.afirmar(e.ubicacion = 'Nave 2' and e.creado_por = pg_temp.id('mnt') and e.creado_en > '2026-01-01',
    'corrige la ubicación; quién y cuándo lo dio de alta no se reescribe');
end $$;

select test.debe_fallar(
  $$update public.equipos set activo = false where id = pg_temp.id('eq2')$$,
  'la baja sin motivo no entra', 'hay que decir el motivo');

do $$
declare v integer; e record;
begin
  update public.equipos set activo = false, baja_motivo = 'Se quemó el motor y no tiene arreglo', baja_por = pg_temp.id('ger'), dado_de_baja_en = '2020-01-01'
   where id = pg_temp.id('eq2');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Mantenimiento da de baja con motivo (una fila)');
  select * into e from public.equipos where id = pg_temp.id('eq2');
  perform test.afirmar(not e.activo and e.baja_por = pg_temp.id('mnt') and e.dado_de_baja_en > '2026-01-01',
    'la baja lleva quién y cuándo, sellados por la base');
  perform test.afirmar((select codigo = 'AM-04-07' from public.equipos_codigos_que_siguen() where categoria_id = pg_temp.id('amoladora')),
    'el código del dado de baja no se vuelve a dar');
end $$;

select test.debe_fallar(
  $$update public.equipos set descripcion = 'Otra cosa' where id = pg_temp.id('eq2')$$,
  'dado de baja queda congelado', 'está dado de baja');
select test.debe_fallar(
  $$select public.equipo_cambiar_a_cargo(pg_temp.id('eq2'), 'ALGUIEN')$$,
  'a un equipo dado de baja no se le asigna a nadie', 'está dado de baja');
select test.debe_fallar(
  $$delete from public.equipos where id = pg_temp.id('eq2')$$,
  'Mantenimiento no borra un equipo', 'permission denied');

select test.debe_fallar(
  $$update public.equipos set activo = true where id = pg_temp.id('eq2')$$,
  'no se reactiva por la tabla sin decir por qué', 'hay que decir por qué');
select test.debe_fallar(
  $$select * from public.equipo_reactivar(pg_temp.id('eq2'), 'ok')$$,
  'reactivar pide un motivo de verdad', '5 letras');
select test.debe_fallar(
  $$insert into public.equipo_bajas (equipo_id, motivo, dado_de_baja_en) values (pg_temp.id('eq2'), 'A mano', now())$$,
  'la historia de bajas no se escribe a mano', 'permission denied');

do $$
declare e record; b record; r record;
begin
  select * into r from public.equipo_reactivar(pg_temp.id('eq2'), 'Se reparó el motor en el taller');
  perform test.afirmar(r.codigo = 'AM-04-06' and not r.ya_estaba, 'Mantenimiento reactiva con motivo');
  select * into e from public.equipos where id = pg_temp.id('eq2');
  perform test.afirmar(e.activo and e.baja_motivo is null and e.baja_por is null and e.dado_de_baja_en is null,
    'reactivado vuelve al padrón sin baja en la fila');
  select * into b from public.equipo_bajas where equipo_id = pg_temp.id('eq2');
  perform test.afirmar(b.motivo = 'Se quemó el motor y no tiene arreglo' and b.baja_por = pg_temp.id('mnt')
      and b.reactivado_por = pg_temp.id('mnt') and b.reactivacion_motivo = 'Se reparó el motor en el taller',
    'la baja y la reactivación quedan en la historia, con quién y por qué');
  select * into r from public.equipo_reactivar(pg_temp.id('eq2'), 'Se reparó el motor en el taller');
  perform test.afirmar(r.ya_estaba and (select count(*) = 1 from public.equipo_bajas where equipo_id = pg_temp.id('eq2')),
    'el mismo envío otra vez no cambia nada y lo dice');
  perform public.equipo_cambiar_a_cargo(pg_temp.id('eq2'), 'rosa díaz');
  perform test.afirmar((select a_cargo_de = 'ROSA DÍAZ' from public.equipos where id = pg_temp.id('eq2')),
    'Mantenimiento también cambia quién lo tiene');
end $$;

-- Las categorías: agrega una, y el prefijo de una con equipos no se cambia.
do $$
declare v_id uuid;
begin
  insert into public.equipo_categorias (nombre, prefijo) values ('  Compresor  ', ' cmp ') returning id into v_id;
  perform test.afirmar((select nombre = 'Compresor' and prefijo = 'CMP' from public.equipo_categorias where id = v_id),
    'Mantenimiento agrega una categoría, con su prefijo en mayúsculas');
end $$;
select test.debe_fallar(
  $$update public.equipo_categorias set prefijo = 'AMO' where id = pg_temp.id('amoladora')$$,
  'el prefijo de una categoría con equipos no se cambia', 'su prefijo no se cambia');
select test.debe_fallar(
  $$delete from public.equipo_categorias where id = pg_temp.id('otros')$$,
  'una categoría no se borra', 'permission denied');
reset role;

-- 3. Almacén: ve, cambia «a cargo de» y nada más ------------------------------------
select test.como_usuario(:'alm_id');
set local role authenticated;
do $$
declare v integer;
begin
  perform test.afirmar((select count(*) = 2 from public.equipos where id in (pg_temp.id('eq1'), pg_temp.id('eq2'))),
    'Almacén ve el padrón');
  perform public.equipo_cambiar_a_cargo(pg_temp.id('eq1'), '  mario   soto ');
  perform test.afirmar((select a_cargo_de = 'MARIO SOTO' from public.equipos where id = pg_temp.id('eq1')),
    'Almacén cambia quién lo tiene a cargo');
  perform public.equipo_cambiar_a_cargo(pg_temp.id('eq1'), '');
  perform test.afirmar((select a_cargo_de is null from public.equipos where id = pg_temp.id('eq1')),
    'y lo deja sin nadie a cargo');

  update public.equipos set descripcion = 'Cambiada por Almacén', estado = 'PARADO', estado_nota = 'no' where id = pg_temp.id('eq1');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Almacén no corrige el padrón por la tabla: cero filas');
  perform test.afirmar((select descripcion <> 'Cambiada por Almacén' and estado = 'OPERATIVO' from public.equipos where id = pg_temp.id('eq1')),
    'y el equipo sigue como estaba');
end $$;
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id) values ('TA-99', 'Taladro de Almacén', pg_temp.id('otros'))$$,
  'Almacén no da de alta equipos', 'row-level security');
select test.debe_fallar(
  $$select * from public.equipos_codigos_que_siguen()$$,
  'ni pide el código que sigue', 'equipos.gestionar');
select test.debe_fallar(
  $$insert into public.equipo_categorias (nombre) values ('De Almacén')$$,
  'ni agrega categorías', 'row-level security');
reset role;

-- 4. Gerencia consulta y no registra -------------------------------------------------
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$
declare v integer;
begin
  perform test.afirmar((select count(*) = 2 from public.equipos where id in (pg_temp.id('eq1'), pg_temp.id('eq2'))),
    'Gerencia ve el padrón');
  perform test.afirmar((select count(*) = 1 from public.equipo_bajas where equipo_id = pg_temp.id('eq2')),
    'y la historia de bajas');
  update public.equipos set ubicacion = 'Gerencia' where id = pg_temp.id('eq1');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Gerencia no corrige: cero filas');
end $$;
select test.debe_fallar(
  $$select public.equipo_cambiar_a_cargo(pg_temp.id('eq1'), 'GERENCIA')$$,
  'Gerencia no asigna', 'equipos.asignar');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id) values ('GG-01', 'De Gerencia', pg_temp.id('otros'))$$,
  'Gerencia no da de alta', 'row-level security');
reset role;

-- 5. Ventas, que no tiene nada que ver, no ve ni escribe -------------------------------
select test.como_usuario(:'ventas_id');
set local role authenticated;
do $$
declare v integer;
begin
  perform test.afirmar((select count(*) = 0 from public.equipos), 'Ventas no ve ningún equipo');
  perform test.afirmar((select count(*) = 0 from public.equipo_categorias), 'ni las categorías');
  perform test.afirmar((select count(*) = 0 from public.equipo_bajas), 'ni la historia de bajas');
  update public.equipos set ubicacion = 'Ventas' where id = pg_temp.id('eq1');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Ventas no corrige: cero filas');
end $$;
select test.debe_fallar(
  $$select * from public.equipo_reactivar(pg_temp.id('eq2'), 'Ventas lo quiere')$$,
  'Ventas no reactiva', 'equipos.gestionar');
select test.debe_fallar(
  $$select public.equipo_cambiar_a_cargo(pg_temp.id('eq1'), 'VENTAS')$$,
  'Ventas no asigna', 'equipos.asignar');
select test.debe_fallar(
  $$insert into public.equipos (codigo, descripcion, categoria_id) values ('VV-01', 'De Ventas', pg_temp.id('otros'))$$,
  'Ventas no da de alta', 'row-level security');
reset role;

-- 6. Ni el administrador borra -------------------------------------------------------
select test.como_usuario(:'admin_id');
select test.debe_fallar(
  $$delete from public.equipos where id = pg_temp.id('eq1')$$,
  'ni el administrador (ni el dueño de la tabla) borra un equipo', 'no se borra');
select test.debe_fallar(
  $$delete from public.equipo_categorias where id = pg_temp.id('otros')$$,
  'ni una categoría', 'no se borra');

-- 7. Las puertas ---------------------------------------------------------------------
select test.afirmar(
  not has_table_privilege('anon', 'public.equipos', 'select')
  and not has_table_privilege('authenticated', 'public.equipos', 'delete')
  and not has_table_privilege('authenticated', 'public.equipo_categorias', 'delete'),
  'el padrón no se lee sin sesión y nadie tiene el privilegio de borrar');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.equipo_codigo_que_sigue(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.equipos_codigos_que_siguen()', 'execute')
  and not has_function_privilege('anon', 'public.equipo_cambiar_a_cargo(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.equipo_reactivar(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.fn_equipo_historia_de_bajas()', 'execute')
  and not has_table_privilege('authenticated', 'public.equipo_bajas', 'insert')
  and not has_table_privilege('authenticated', 'public.equipo_bajas', 'update'),
  'el cálculo interno está cerrado y nada del padrón se ejecuta sin sesión');
select test.afirmar(
  (select count(*) >= 4 from public.audit_log where tabla = 'equipos'),
  'los cambios del padrón quedan en la auditoría');

rollback;
