-- SSOMA, entrega 15.3 (migración 20261126985000): charlas e inducciones.
--
-- SSOMA registra cada charla o inducción con tema, expositor, fecha, fotos y
-- quiénes asistieron de la lista de RR. HH. (solo nombre, cargo y área). No se
-- corrige ni se borra: se anula con motivo. SSOMA y Gerencia ven quién no asistió
-- en el mes. Nadie más ve las charlas.
--
-- Probado con el rol real de cada puesto y `set local role authenticated`,
-- nunca como ADMIN. Termina en rollback.

begin;

insert into public.empresa (ruc, razon_social)
select '20100000476', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T476', 'Taller de pruebas de charlas') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma476@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia476@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh476@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas476@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Saúl', 'Supervisor', 'supervisor476@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup_id \gset
-- El Supervisor General lee `audit_log` (`auditoria.ver`): las charlas no pasan por ahí.
select test.crear_usuario('Gino', 'General', 'supgeneral476@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset
-- El armazón (la lista de RR. HH.) lo monta el administrador; lo que se prueba, nunca.
select test.crear_usuario('Ada', 'Administradora', 'admin476@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
select set_config('prueba.c1', gen_random_uuid()::text, true);
select set_config('prueba.c2', gen_random_uuid()::text, true);
select set_config('prueba.f1', :'ssoma_id' || '/' || current_setting('prueba.c1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.f2', :'ssoma_id' || '/' || current_setting('prueba.c2') || '/' || gen_random_uuid() || '.webp', true);
select set_config('prueba.ajena', :'sup_id' || '/' || current_setting('prueba.c2') || '/' || gen_random_uuid() || '.jpg', true);

-- Tres personas en la lista de RR. HH., y una dada de baja.
select test.como_usuario(:'admin_id');
do $$
declare v uuid;
begin
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Óscar', 'Operario Charla', '47647601', 'Soldador', (select id from public.areas where codigo = 'MTZ')) returning id into v;
  perform set_config('prueba.t1', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Pía', 'Pintora Charla', '47647602', 'Pintora', (select id from public.areas where codigo = 'PRD')) returning id into v;
  perform set_config('prueba.t2', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Abel', 'Almacén Charla', '47647603', 'Almacenero', (select id from public.areas where codigo = 'ALM')) returning id into v;
  perform set_config('prueba.t3', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo)
  values ('Iván', 'Inactivo Charla', '47647604', 'Ayudante', (select id from public.areas where codigo = 'MTZ'), false) returning id into v;
  perform set_config('prueba.t4', v::text, true);
end $$;
select set_config('request.jwt.claim.sub', '', true);

-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

create or replace function pg_temp.registrar(p_id text, p_tipo text, p_tema text, p_expositor text, p_fecha text, p_asistentes text, p_fotos text)
returns text language sql as $$
  select format('select public.ssoma_registrar_charla(%L, %L, %L, %L, %L::date, %L::uuid[], %L::jsonb)',
                p_id, p_tipo, p_tema, p_expositor, p_fecha, p_asistentes, p_fotos);
$$;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    (select bool_and(c.relrowsecurity) from pg_class c
      where c.relname in ('ssoma_charlas', 'ssoma_charla_asistentes', 'ssoma_charla_fotos')) is true,
    'las tres tablas de charlas tienen RLS');
  perform test.afirmar(
    not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 where c.relname in ('ssoma_charlas', 'ssoma_charla_asistentes', 'ssoma_charla_fotos') and t.tgname = 'trg_auditoria'),
    'ninguna se copia a audit_log (el Supervisor General la leería sin ver SSOMA)');
  perform test.afirmar(
    not has_table_privilege('authenticated', 'public.ssoma_charlas', 'insert')
    and not has_table_privilege('authenticated', 'public.ssoma_charla_asistentes', 'delete'),
    'nadie escribe las tablas directo: solo por las funciones');
end $$;

-- ============================================================ 1. Quién registra
do $$
begin
  -- SSOMA sube la foto de la charla 1 a su carpeta.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-ssoma', current_setting('prueba.f1'), current_setting('prueba.ssoma'), '{"mimetype": "image/jpeg", "size": 210000}'),
    ('fotos-ssoma', current_setting('prueba.f2'), current_setting('prueba.ssoma'), '{"mimetype": "image/webp", "size": 90000}');
  reset role;

  -- Gerencia, RR. HH. y Supervisión no registran.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f1'))),
    'Gerencia consulta, no registra', 'la registra SSOMA');
  perform test.debe_fallar('select * from public.ssoma_personal_para_charla()', 'Gerencia no recibe la lista para marcar', 'la registra SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f1'))),
    'RR. HH. tiene la lista pero no registra charlas', 'la registra SSOMA');
  reset role;

  -- SSOMA: la lista trae solo nombre, cargo y área, de los activos (y de quien se fue hace poco, en 3b).
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_personal_para_charla() p
      where p.id in (current_setting('prueba.t1')::uuid, current_setting('prueba.t2')::uuid, current_setting('prueba.t3')::uuid)) = 3
    and not exists (select 1 from public.ssoma_personal_para_charla() p where p.id = current_setting('prueba.t4')::uuid),
    'la lista para marcar trae a los activos y no al dado de baja');
  perform test.afirmar(
    (select string_agg(x, ',') from unnest((select proargnames from pg_proc where proname = 'ssoma_personal_para_charla')) as x) = 'id,nombre,cargo,area,en_planta',
    'de RR. HH. sale solo id, nombre, cargo, área y si sigue en la planta (nunca el DNI)');
  perform test.debe_fallar('select dni from public.trabajadores limit 1', 'SSOMA no lee el DNI de la tabla de RR. HH.', 'permission denied');

  -- Lo que falta se dice.
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), '{}', format('["%s"]', current_setting('prueba.f1'))),
    'sin asistentes no entra', 'Marca quiénes asistieron');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t1')), '[]'),
    'sin foto no entra', 'al menos una foto');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      (current_setting('prueba.hoy')::date + 1)::text, format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f1'))),
    'una charla de mañana no entra', 'posterior a hoy');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      (current_setting('prueba.hoy')::date - 61)::text, format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f1'))),
    'una de hace más de 60 días no entra', 'últimos 60 días');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t4')), format('["%s"]', current_setting('prueba.f1'))),
    'alguien dado de baja sin fecha no se marca, y se dice quién', 'Inactivo Charla Iván no estaba en la planta el');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Uso de guantes de corte', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f2'))),
    'la foto de otra carpeta no entra', 'Vuelve a poner las fotos');

  -- La charla 1 entra: dos asistentes (uno repetido se cuenta una vez) y una foto.
  perform public.ssoma_registrar_charla(current_setting('prueba.c1')::uuid, 'CHARLA', '  Uso de   guantes de corte ', 'Sara Seguridad',
    current_setting('prueba.hoy')::date,
    array[current_setting('prueba.t1')::uuid, current_setting('prueba.t2')::uuid, current_setting('prueba.t1')::uuid],
    jsonb_build_array(current_setting('prueba.f1')));
  perform test.afirmar(
    (select tema from public.ssoma_charlas where id = current_setting('prueba.c1')::uuid) = 'Uso de guantes de corte'
    and (select count(*) from public.ssoma_charla_asistentes where charla_id = current_setting('prueba.c1')::uuid) = 2
    and (select count(*) from public.ssoma_charla_fotos where charla_id = current_setting('prueba.c1')::uuid) = 1,
    'la charla entra con su tema limpio, dos asistentes y su foto');

  -- El reintento con lo mismo devuelve la misma; con otra cosa, dice que quedó la primera.
  perform test.afirmar(
    public.ssoma_registrar_charla(current_setting('prueba.c1')::uuid, 'CHARLA', '  Uso de   guantes de corte ', 'Sara Seguridad',
      current_setting('prueba.hoy')::date,
      array[current_setting('prueba.t1')::uuid, current_setting('prueba.t2')::uuid, current_setting('prueba.t1')::uuid],
      jsonb_build_array(current_setting('prueba.f1'))) = current_setting('prueba.c1')::uuid
    and (select count(*) from public.ssoma_charla_asistentes where charla_id = current_setting('prueba.c1')::uuid) = 2,
    'el mismo envío repetido no duplica nada');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c1'), 'CHARLA', 'Otro tema distinto', 'Sara Seguridad',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t1')), format('["%s"]', current_setting('prueba.f1'))),
    'con otra cosa, dice que quedó la primera', 'ya quedó registrada');
  -- La foto ya anotada no se reusa en otra charla.
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c2'), 'INDUCCION', 'Inducción de ingreso', 'RR. HH. y SSOMA',
      current_setting('prueba.hoy'), format('{%s}', current_setting('prueba.t3')), format('["%s"]', current_setting('prueba.f1'))),
    'la foto de otra charla no se reusa', 'Vuelve a poner las fotos');
  -- La inducción 2 entra.
  perform public.ssoma_registrar_charla(current_setting('prueba.c2')::uuid, 'INDUCCION', 'Inducción de ingreso a planta', 'Sara Seguridad',
    current_setting('prueba.hoy')::date, array[current_setting('prueba.t3')::uuid], jsonb_build_array(current_setting('prueba.f2')));
  perform test.afirmar((select count(*) from public.ssoma_charlas_del_mes(current_setting('prueba.hoy')::date)
                          where id in (current_setting('prueba.c1')::uuid, current_setting('prueba.c2')::uuid)) = 2,
    'SSOMA ve las dos del mes');
  reset role;
end $$;

-- ============================================================ 2. Quién ve
do $$
declare
  -- Quienes estaban en la planta este mes, con la misma regla de la base.
  v_activos integer := (select count(*)::integer from public.trabajadores t
     where public.ssoma_estuvo_en_la_planta(t.id, t.activo, t.fecha_ingreso, t.fecha_baja,
             date_trunc('month', current_setting('prueba.hoy')::date)::date,
             (date_trunc('month', current_setting('prueba.hoy')::date) + interval '1 month')::date));
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select asistentes from public.ssoma_charlas_del_mes(current_setting('prueba.hoy')::date) where id = current_setting('prueba.c1')::uuid) = 2,
    'Gerencia consulta la charla con sus asistentes');
  perform test.afirmar((select count(*) from public.ssoma_asistentes_de_charla(current_setting('prueba.c1')::uuid)) = 2,
    'y ve quiénes asistieron');
  perform test.afirmar((select count(*) from public.ssoma_charla_fotos where charla_id = current_setting('prueba.c1')::uuid) = 1
    and (select count(*) from storage.objects where name = current_setting('prueba.f1')) = 1,
    'y la foto, en la tabla y en Storage');
  perform test.afirmar(public.ssoma_personal_del_mes(current_setting('prueba.hoy')::date) = v_activos, 'y cuántas personas estaban en la planta este mes');
  reset role;

  -- RR. HH., Ventas y Supervisión no ven nada de las charlas.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_charlas_del_mes(current_setting('prueba.hoy')::date)) = 0
    and (select count(*) from public.ssoma_charlas) = 0
    and (select count(*) from public.ssoma_charla_asistentes) = 0
    and (select count(*) from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date)) = 0
    and public.ssoma_personal_del_mes(current_setting('prueba.hoy')::date) = 0,
    'RR. HH. no ve las charlas ni quién faltó');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_charla(current_setting('prueba.c1')::uuid)) = 0
    and (select count(*) from public.ssoma_asistentes_de_charla(current_setting('prueba.c1')::uuid)) = 0
    and (select count(*) from public.ssoma_charla_fotos) = 0
    and (select count(*) from storage.objects where name = current_setting('prueba.f1')) = 0,
    'Ventas no ve la charla, sus asistentes ni su foto');
  reset role;
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_charlas) = 0, 'Supervisión tampoco');
  perform test.debe_fallar(format('update public.ssoma_charlas set tema = %L where id = %L', 'Otro tema', current_setting('prueba.c1')),
    'nadie la cambia directo', 'permission denied');
  reset role;
  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar(public.tiene_permiso('auditoria.ver'), 'el Supervisor General sí lee la auditoría');
  perform test.afirmar(
    (select count(*) from public.ssoma_charlas) = 0
    and (select count(*) from public.ssoma_charla_asistentes) = 0
    and (select count(*) from public.audit_log where tabla in ('ssoma_charlas', 'ssoma_charla_asistentes', 'ssoma_charla_fotos')) = 0,
    'y aun así no ve las charlas, ni en sus tablas ni en la auditoría');
  reset role;
end $$;

-- ============================================================ 3. Quién no asistió en el mes
do $$
declare
  -- Quienes estaban en la planta este mes, con la misma regla de la base.
  v_activos integer := (select count(*)::integer from public.trabajadores t
     where public.ssoma_estuvo_en_la_planta(t.id, t.activo, t.fecha_ingreso, t.fecha_baja,
             date_trunc('month', current_setting('prueba.hoy')::date)::date,
             (date_trunc('month', current_setting('prueba.hoy')::date) + interval '1 month')::date));
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date)) = v_activos - 3
    and not exists (select 1 from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date)
                     where id in (current_setting('prueba.t1')::uuid, current_setting('prueba.t2')::uuid, current_setting('prueba.t3')::uuid, current_setting('prueba.t4')::uuid)),
    'faltaron los activos que no estuvieron en ninguna; el dado de baja no cuenta');
  -- El mes que viene, los tres faltan, con la fecha de la última vez.
  perform test.afirmar(
    (select ultima from public.ssoma_no_asistieron((date_trunc('month', current_setting('prueba.hoy')::date) + interval '1 month')::date)
      where id = current_setting('prueba.t1')::uuid) = current_setting('prueba.hoy')::date,
    'el mes siguiente falta, con la última vez que asistió');

  -- Anular: con motivo. La anulada deja de contar.
  perform test.debe_fallar(format('select public.ssoma_anular_charla(%L, %L)', current_setting('prueba.c1'), 'corto'),
    'sin motivo no se anula', 'Cuenta por qué');
  perform public.ssoma_anular_charla(current_setting('prueba.c1')::uuid, 'Se registró en la fecha equivocada');
  perform test.afirmar(
    (select anulado_por = current_setting('prueba.ssoma')::uuid and anulado_en is not null from public.ssoma_charlas where id = current_setting('prueba.c1')::uuid),
    'la anulación queda con quién y cuándo');
  perform test.afirmar(
    exists (select 1 from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date) where id = current_setting('prueba.t1')::uuid)
    and not exists (select 1 from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date) where id = current_setting('prueba.t3')::uuid),
    'con la charla anulada, sus asistentes vuelven a faltar');
  perform test.afirmar(public.ssoma_anular_charla(current_setting('prueba.c1')::uuid, 'Se registró en la fecha equivocada') = current_setting('prueba.c1')::uuid,
    'el mismo pedido repetido (se perdió la respuesta) entra sin error');
  perform test.debe_fallar(format('select public.ssoma_anular_charla(%L, %L)', current_setting('prueba.c1'), 'Otra vez la misma charla'),
    'otro motivo de quien ya la anuló dice que quedó la primera vez, con el motivo que quedó',
    'la primera vez que la enviaste, con este motivo: «Se registró en la fecha equivocada»');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_charla(%L, %L)', current_setting('prueba.c2'), 'Gerencia no anula charlas'),
    'Gerencia no anula', 'la anula SSOMA');
  perform test.afirmar(exists (select 1 from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date) where id = current_setting('prueba.t1')::uuid),
    'Gerencia ve quién no asistió');
  reset role;
end $$;

-- ============================================================ 3b. Un mes pasado, con quien estaba ese mes
-- Quien entró este mes no faltó el mes pasado; quien se fue el mes pasado sí
-- cuenta en él y ya no en este; el inactivo sin fecha de baja no cuenta en ninguno.
select test.como_usuario(:'admin_id');
do $$
declare
  v       uuid;
  v_este  date := date_trunc('month', current_setting('prueba.hoy')::date)::date;
  v_antes date := (date_trunc('month', current_setting('prueba.hoy')::date) - interval '1 month')::date;
begin
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, fecha_ingreso)
  values ('Nora', 'Nueva Charla', '47647605', 'Ayudante', (select id from public.areas where codigo = 'PRD'), v_este) returning id into v;
  perform set_config('prueba.t5', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo, fecha_ingreso, fecha_baja)
  values ('Bruno', 'Baja Charla', '47647606', 'Ayudante', (select id from public.areas where codigo = 'PRD'), false, v_antes - 200, v_antes + 14)
  returning id into v;
  perform set_config('prueba.t6', v::text, true);
  -- Rita trabajó hasta el día 10 del mes pasado y volvió este mes, por las funciones de RR. HH.
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, fecha_ingreso)
  values ('Rita', 'Reingreso Charla', '47647607', 'Ayudante', (select id from public.areas where codigo = 'PRD'), v_antes - 300)
  returning id into v;
  -- RR. HH. lo da de baja y de alta: el administrador ve, pero no cambia.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  perform public.rrhh_dar_de_baja_trabajador(v, v_antes + 10);
  perform public.rrhh_dar_de_alta_trabajador(v, v_este);
  perform set_config('prueba.t7', v::text, true);
  perform set_config('prueba.antes', v_antes::text, true);
  perform set_config('prueba.c3', gen_random_uuid()::text, true);
  perform set_config('prueba.f3', current_setting('prueba.ssoma') || '/' || current_setting('prueba.c3') || '/' || gen_random_uuid() || '.jpg', true);
end $$;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_antes date := current_setting('prueba.antes')::date;
  v_hoy   date := current_setting('prueba.hoy')::date;
  v_t4    uuid := current_setting('prueba.t4')::uuid;
  v_t5    uuid := current_setting('prueba.t5')::uuid;
  v_t6    uuid := current_setting('prueba.t6')::uuid;
  v_t7    uuid := current_setting('prueba.t7')::uuid;
  -- Se cuenta antes de cambiar de rol: el ayudante no lo ejecuta `authenticated`.
  v_esperado integer := (select count(*) from public.trabajadores t
    where public.ssoma_estuvo_en_la_planta(t.id, t.activo, t.fecha_ingreso, t.fecha_baja, current_setting('prueba.antes')::date,
            (current_setting('prueba.antes')::date + interval '1 month')::date));
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    not exists (select 1 from public.ssoma_no_asistieron(v_antes) where id = v_t5)
    and exists (select 1 from public.ssoma_no_asistieron(v_hoy) where id = v_t5),
    'quien entró este mes no faltó el mes pasado, y este sí cuenta');
  perform test.afirmar(
    exists (select 1 from public.ssoma_no_asistieron(v_antes) where id = v_t6)
    and not exists (select 1 from public.ssoma_no_asistieron(v_hoy) where id = v_t6),
    'quien se fue el mes pasado cuenta en ese mes y ya no en este');
  perform test.afirmar(
    not exists (select 1 from public.ssoma_no_asistieron(v_antes) where id = v_t4)
    and not exists (select 1 from public.ssoma_no_asistieron(v_hoy) where id = v_t4),
    'el inactivo sin fecha de baja no cuenta en ningún mes');
  perform test.afirmar(
    exists (select 1 from public.ssoma_no_asistieron(v_antes) where id = v_t7)
    and exists (select 1 from public.ssoma_no_asistieron(v_hoy) where id = v_t7),
    'quien volvió a entrar cuenta en el mes de su periodo anterior, y en este');
  perform test.afirmar(
    public.ssoma_personal_del_mes(v_antes) = v_esperado
    and public.ssoma_personal_del_mes(v_antes) >= 1,
    'el «de cuántos» del mes pasado cuenta a quien estaba entonces');

  -- Se marca a quien estaba en la planta el día de la charla, con la misma regla.
  perform test.afirmar(
    (select not en_planta from public.ssoma_personal_para_charla() where id = v_t6),
    'quien se fue hace menos de 60 días sigue en la lista para marcar, dicho que ya no está');
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-ssoma', current_setting('prueba.f3'), current_setting('prueba.ssoma'), '{"mimetype": "image/jpeg", "size": 120000}');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.c3'), 'CHARLA', 'Orden y limpieza en la zona de corte', 'Sara Seguridad',
      (v_antes + 5)::text, format('{%s,%s}', v_t6, v_t5), format('["%s"]', current_setting('prueba.f3'))),
    'quien entró después de la charla no se marca en ella, y se dice quién', 'Nueva Charla Nora no estaba en la planta el');
  perform public.ssoma_registrar_charla(current_setting('prueba.c3')::uuid, 'CHARLA', 'Orden y limpieza en la zona de corte', 'Sara Seguridad',
    v_antes + 5, array[v_t6, v_t7], jsonb_build_array(current_setting('prueba.f3')));
  perform test.afirmar(
    not exists (select 1 from public.ssoma_no_asistieron(v_antes) where id in (v_t6, v_t7)),
    'quien se fue después de la charla, o volvió a entrar después, se marca en ella y deja de faltar ese mes');
  reset role;
end $$;

-- ============================================================ 4. Nada se borra ni se corrige por debajo
do $$
begin
  perform test.debe_fallar(format('delete from public.ssoma_charlas where id = %L', current_setting('prueba.c2')),
    'una charla no se borra, ni el dueño de la base', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_charlas set tema = %L where id = %L', 'Otro tema escrito después', current_setting('prueba.c2')),
    'lo registrado no se corrige', 'no se corrige');
  perform test.debe_fallar(format('update public.ssoma_charlas set motivo_anulacion = null, anulado_por = null, anulado_en = null where id = %L', current_setting('prueba.c1')),
    'la anulada no se desanula', 'está anulada');
  perform test.debe_fallar(format('delete from public.ssoma_charla_asistentes where charla_id = %L', current_setting('prueba.c2')),
    'la asistencia no se borra', 'no se cambia');
  perform test.debe_fallar(format('delete from public.ssoma_charla_fotos where charla_id = %L', current_setting('prueba.c2')),
    'la foto no se borra', 'no se cambia');
end $$;

-- ============================================================ 5. La foto anotada no se quita de Storage
do $$
declare v integer;
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'fotos-ssoma' and name = current_setting('prueba.f2');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'la foto de una charla registrada no se quita de Storage');
  reset role;
end $$;

-- ============================================================ 6. Un lote de prueba se limpia entero
-- Los asistentes llevan `id` y `activar_registro_de_prueba`: sin eso,
-- `pruebas_limpiar` los tomaba por datos ajenos y se negaba a limpiar la charla.
select test.crear_usuario('Lote', 'Prueba', 'lote476@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as lote_usuario \gset
insert into public.pruebas_cuentas (usuario_id, motivo) values (:'lote_usuario', 'check 476');
select public.pruebas_abrir('check 476: una charla de prueba', array[:'lote_usuario'::uuid]) as lote \gset
select set_config('request.jwt.claim.sub', :'lote_usuario', true);
insert into public.ssoma_charlas (tipo, tema, expositor, fecha, creado_por)
values ('CHARLA', 'Charla del lote de prueba', 'SSOMA', current_date, :'lote_usuario') returning id as lote_charla \gset
insert into public.ssoma_charla_asistentes (charla_id, trabajador_id) values (:'lote_charla', current_setting('prueba.t2')::uuid);
select set_config('request.jwt.claim.sub', '', true);
select set_config('prueba.lote', :'lote', true);
select set_config('prueba.lote_charla', :'lote_charla', true);
do $$
begin
  perform public.pruebas_limpiar(current_setting('prueba.lote')::uuid);
  perform test.afirmar(
    not exists (select 1 from public.ssoma_charlas where id = current_setting('prueba.lote_charla')::uuid)
    and not exists (select 1 from public.ssoma_charla_asistentes where charla_id = current_setting('prueba.lote_charla')::uuid)
    and exists (select 1 from public.trabajadores where id = current_setting('prueba.t2')::uuid),
    'el lote de prueba se lleva la charla y sus asistentes, y deja a la persona real');
end $$;

rollback;
