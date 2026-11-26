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

  -- SSOMA: la lista trae solo nombre, cargo y área, de los activos.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_personal_para_charla() p
      where p.id in (current_setting('prueba.t1')::uuid, current_setting('prueba.t2')::uuid, current_setting('prueba.t3')::uuid)) = 3
    and not exists (select 1 from public.ssoma_personal_para_charla() p where p.id = current_setting('prueba.t4')::uuid),
    'la lista para marcar trae a los activos y no al dado de baja');
  perform test.afirmar(
    (select string_agg(x, ',') from unnest((select proargnames from pg_proc where proname = 'ssoma_personal_para_charla')) as x) = 'id,nombre,cargo,area',
    'de RR. HH. sale solo id, nombre, cargo y área (nunca el DNI)');
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
    'alguien dado de baja no se marca', 'ya no está activo');
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
  v_activos integer := (select count(*) from public.trabajadores where activo);
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
  perform test.afirmar(public.ssoma_personal_activo() = v_activos, 'y cuántas personas tiene la lista');
  reset role;

  -- RR. HH., Ventas y Supervisión no ven nada de las charlas.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_charlas_del_mes(current_setting('prueba.hoy')::date)) = 0
    and (select count(*) from public.ssoma_charlas) = 0
    and (select count(*) from public.ssoma_charla_asistentes) = 0
    and (select count(*) from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date)) = 0
    and public.ssoma_personal_activo() = 0,
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
  v_activos integer := (select count(*) from public.trabajadores where activo);
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
  perform test.debe_fallar(format('select public.ssoma_anular_charla(%L, %L)', current_setting('prueba.c1'), 'Otra vez la misma charla'),
    'no se anula dos veces', 'ya está anulada');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_charla(%L, %L)', current_setting('prueba.c2'), 'Gerencia no anula charlas'),
    'Gerencia no anula', 'la anula SSOMA');
  perform test.afirmar(exists (select 1 from public.ssoma_no_asistieron(current_setting('prueba.hoy')::date) where id = current_setting('prueba.t1')::uuid),
    'Gerencia ve quién no asistió');
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

rollback;
