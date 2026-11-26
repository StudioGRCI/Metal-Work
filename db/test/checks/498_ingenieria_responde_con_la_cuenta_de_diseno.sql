-- Ingeniería responde con la cuenta de Diseño (migración 20261126998500,
-- entrega A.4), cada cosa con el rol que la vive y `set local role authenticated`:
--   * a Ingeniería la lleva Diseño, y ninguna otra área es llevada por otra;
--   * al asignar la cuenta de Diseño, la fila de Ingeniería la recibe sola
--     (`jefe_heredado`), y la sigue cuando cambia; con una propia, no;
--   * quitarle la propia la devuelve a la de Diseño; quitar la de Diseño la
--     deja sin ninguna;
--   * quien responde por herencia abre lo del área: lo leen las funciones que
--     ya había (`responsable_del_area`, `calidad_es_del_area`), sin cambiarlas;
--   * la marca de heredada solo vale si es verdad (la cuenta es la misma del
--     área que la lleva); elegirle a mano esa misma cuenta, como hace la
--     pantalla, la deja propia; no hay cadenas ni un área que se lleve a sí misma;
--   * si la cuenta de Diseño se da de baja, Ingeniería la conserva igual que
--     Diseño y nadie responde; al volver de alta, responden las dos;
--   * quién lleva a quién solo lo cambia el administrador del sistema.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  insert into public.roles (codigo, nombre) values ('PRUEBA_498', 'Puesto de prueba 498');
  insert into public.roles_permisos (rol_id, permiso_codigo)
  select id, 'configuracion.editar' from public.roles where codigo = 'PRUEBA_498';
  foreach v in array array['ADMIN:', 'DISENO:DIS', 'DISENO_COLABORADOR:DIS', 'GERENTE:GGE', 'SUPERVISOR:PRD', 'PRUEBA_498:'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.498@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 498', lower(split_part(v, ':', 1)) || '.498@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['ING', 'DIS', 'PRD', 'MTZ', 'TIC', 'SAP'] loop
    perform set_config('prueba.area_' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  -- Parte sin responsables, pase lo que pase con los datos que traiga la base.
  update public.areas set jefe_id = null where codigo in ('ING', 'DIS', 'PRD');
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Lo que hace la acción de servidor: un UPDATE por la política de `areas`, que
-- manda la cuenta elegida (o ninguna) y `jefe_heredado = false`: lo que se elige
-- a mano es propio, y si no se eligió nada lo decide la base.
create or replace function pg_temp.asignar(p_area text, p_cuenta text) returns integer language plpgsql as $$
declare v integer;
begin
  update public.areas
     set jefe_id = case when p_cuenta is null then null else current_setting('prueba.' || p_cuenta)::uuid end,
         jefe_heredado = false
   where id = current_setting('prueba.area_' || p_area)::uuid;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function pg_temp.llevar(p_area text, p_por text) returns integer language plpgsql as $$
declare v integer;
begin
  update public.areas
     set llevada_por_id = case when p_por is null then null else current_setting('prueba.area_' || p_por)::uuid end
   where id = current_setting('prueba.area_' || p_area)::uuid;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function pg_temp.cuenta(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid
$$;

create or replace function pg_temp.fila(p_area text) returns text language sql as $$
  select coalesce((select u.nombres from public.usuarios u where u.id = a.jefe_id), 'nadie') || case when a.jefe_heredado then ' (heredada)' else '' end
    from public.areas a where a.id = current_setting('prueba.area_' || p_area)::uuid
$$;

-- ============================================ 1. Lo que dejó la migración
select test.afirmar(
  (select b.codigo from public.areas a join public.areas b on b.id = a.llevada_por_id where a.codigo = 'ING') = 'DIS',
  '1. A Ingeniería la lleva Diseño');
select test.afirmar(
  (select count(*) from public.areas where llevada_por_id is not null) = 1,
  '1. y a ninguna otra área la lleva otra');
select test.afirmar(
  (select count(*) from public.areas where jefe_heredado and (jefe_id is null or llevada_por_id is null)) = 0,
  '1. Ninguna fila dice «heredada» sin cuenta o sin quién la lleve');
select test.afirmar(pg_temp.fila('ing') = 'nadie' and pg_temp.fila('dis') = 'nadie', '1. Sin cuenta en Diseño, Ingeniería tampoco tiene');

-- ============================================ 2. Se asigna la de Diseño: Ingeniería la recibe sola
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.asignar('dis', 'diseno') = 1, '2. El administrador asigna la cuenta responsable de Diseño');
select test.afirmar(pg_temp.fila('dis') = 'DISENO', '2. Diseño queda con su cuenta, propia');
select test.afirmar(pg_temp.fila('ing') = 'DISENO (heredada)', '2. e Ingeniería la recibe sola, marcada como heredada');
select test.afirmar(pg_temp.fila('prd') = 'nadie' and pg_temp.fila('mtz') = 'nadie', '2. Un área que nadie lleva no recibe nada');
reset role;
select test.afirmar(
  (select count(*) from public.audit_log l where l.tabla = 'areas' and l.registro_id = current_setting('prueba.area_ing')::uuid
      and l.usuario_id = pg_temp.cuenta('admin')) >= 1,
  '2. El cambio en la fila de Ingeniería queda en la auditoría a nombre del administrador');

-- La lee otro puesto, que es quien avisa «al área».
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(public.responsable_del_area('ING') = pg_temp.cuenta('diseno') and public.responsable_del_area(' ing ') = pg_temp.cuenta('diseno'),
  '2. responsable_del_area(ING) da la cuenta de Diseño, sin haberla reescrito');
select test.afirmar(public.responsable_del_area('DIS') = pg_temp.cuenta('diseno'), '2. y la de Diseño es la misma');
select test.afirmar(not public.calidad_es_del_area(current_setting('prueba.area_ing')::uuid),
  '2. Un supervisor de Producción no es del área Ingeniería');
reset role;
-- Quien responde por herencia abre lo del área: lo dice la función que ya usaba Calidad.
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(public.calidad_es_del_area(current_setting('prueba.area_ing')::uuid),
  '2. La cuenta de Diseño, que responde por Ingeniería, cuenta como del área para lo que se le avisa');
reset role;
select pg_temp.como('diseno_colaborador');
set local role authenticated;
select test.afirmar(not public.calidad_es_del_area(current_setting('prueba.area_ing')::uuid),
  '2. Otra cuenta de Diseño, que no es la responsable, no');
reset role;

-- ============================================ 3. Sigue a la de Diseño; con una propia, no
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.asignar('dis', 'gerente') = 1 and pg_temp.fila('ing') = 'GERENTE (heredada)',
  '3. Al cambiar la cuenta de Diseño, la de Ingeniería cambia con ella');
-- Elegirle a mano la misma cuenta que tiene Diseño, partiendo de la heredada,
-- es ponerle una propia: es lo que hace la pantalla, y deja de seguir a Diseño.
select test.afirmar(pg_temp.asignar('ing', 'gerente') = 1 and pg_temp.fila('ing') = 'GERENTE',
  '3. Elegirle a mano la misma cuenta que heredaba de Diseño se la deja como propia');
select test.afirmar(pg_temp.asignar('dis', 'diseno') = 1 and pg_temp.fila('ing') = 'GERENTE' and pg_temp.fila('dis') = 'DISENO',
  '3. y ya no sigue a la de Diseño cuando esa cambia');
select test.afirmar(pg_temp.asignar('ing', null) = 1 and pg_temp.fila('ing') = 'DISENO (heredada)',
  '3. Quitarle la propia la devuelve a la de Diseño');
select test.afirmar(pg_temp.asignar('ing', null) = 1 and pg_temp.fila('ing') = 'DISENO (heredada)',
  '3. y guardar otra vez «sin cuenta propia» la deja igual');
select test.afirmar(pg_temp.asignar('ing', 'diseno_colaborador') = 1 and pg_temp.fila('ing') = 'DISENO_COLABORADOR',
  '3. El administrador le pone a Ingeniería otra cuenta: propia');
select test.afirmar(pg_temp.asignar('dis', 'gerente') = 1 and pg_temp.fila('ing') = 'DISENO_COLABORADOR' and pg_temp.fila('dis') = 'GERENTE',
  '3. Con cuenta propia, cambiar la de Diseño no toca la de Ingeniería');

-- La marca escrita a mano solo vale si es verdad.
update public.areas set jefe_heredado = true where codigo in ('ING', 'PRD', 'DIS');
select test.afirmar(pg_temp.fila('ing') = 'DISENO_COLABORADOR' and pg_temp.fila('prd') = 'nadie' and pg_temp.fila('dis') = 'GERENTE',
  '3. Decir «heredada» a mano no vale si la cuenta no es la del área que la lleva, ni en un área que nadie lleva');
update public.areas set jefe_id = pg_temp.cuenta('gerente'), jefe_heredado = true where codigo = 'ING';
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)',
  '3. y sí vale cuando es verdad: la misma cuenta de Diseño');
-- Quien guarda la misma cuenta sin decir nada de la marca no cambia nada.
update public.areas set jefe_id = pg_temp.cuenta('gerente') where codigo = 'ING';
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)', '3. Volver a escribir la heredada sin decir que es propia la deja heredada');
-- Corregir otra cosa del área no cambia quién responde.
update public.areas set nombre = nombre where codigo in ('ING', 'DIS');
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)' and pg_temp.fila('dis') = 'GERENTE', '3. Corregir otra cosa del área no cambia quién responde');
select test.afirmar(pg_temp.asignar('dis', null) = 1 and pg_temp.fila('ing') = 'nadie' and pg_temp.fila('dis') = 'nadie',
  '3. Al quitar la de Diseño, Ingeniería queda sin ninguna');
select test.afirmar(
  (select count(*) from public.areas where jefe_heredado and (jefe_id is null or llevada_por_id is null)) = 0,
  '3. Ninguna fila dice «heredada» sin cuenta o sin quién la lleve');
reset role;

-- ============================================ 4. Cuentas dadas de baja
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.asignar('dis', 'diseno') = 1 and pg_temp.asignar('ing', 'diseno_colaborador') = 1, '4. Diseño con su cuenta e Ingeniería con una propia');
reset role;
-- La da de baja el administrador: sin sesión, `fn_usuario_proteger_rol` no deja.
update public.usuarios set activo = false where id = pg_temp.cuenta('diseno_colaborador');
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(public.responsable_del_area('ING') is null and public.responsable_del_area('DIS') = pg_temp.cuenta('diseno'),
  '4. Si la cuenta propia de Ingeniería se da de baja, nadie responde por ella hasta que la cambien: como en cualquier área');
reset role;
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.fila('ing') = 'DISENO_COLABORADOR', '4. La fila conserva la propia dada de baja: no vuelve sola a la de Diseño');
select test.afirmar(pg_temp.asignar('ing', null) = 1 and pg_temp.fila('ing') = 'DISENO (heredada)',
  '4. Al quitarle la dada de baja, vuelve a responder la de Diseño');
select test.debe_fallar($q$select pg_temp.asignar('ing', 'diseno_colaborador')$q$,
  '4. Una cuenta dada de baja no se le pone como propia a Ingeniería', 'tiene que ser una cuenta activa');
-- Ni colándola con la marca de heredada: no es la de Diseño, así que no vale.
select test.debe_fallar(
  format($q$update public.areas set jefe_id = '%s', jefe_heredado = true where codigo = 'ING'$q$, pg_temp.cuenta('diseno_colaborador')),
  '4. ni diciendo a mano que es heredada', 'tiene que ser una cuenta activa');
select test.afirmar(pg_temp.fila('ing') = 'DISENO (heredada)', '4. La fila sigue con la de Diseño');
reset role;

-- La de Diseño se da de baja después: Ingeniería la conserva, igual que Diseño,
-- y nadie responde por ninguna de las dos.
update public.usuarios set activo = false where id = pg_temp.cuenta('diseno');
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(public.responsable_del_area('ING') is null and public.responsable_del_area('DIS') is null,
  '4. Con la cuenta de Diseño dada de baja, ni Diseño ni Ingeniería tienen a quién avisar');
reset role;
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.fila('ing') = 'DISENO (heredada)' and pg_temp.fila('dis') = 'DISENO',
  '4. Las dos filas conservan la cuenta dada de baja: la pantalla lo marca en las dos');
update public.areas set nombre = nombre where codigo in ('ING', 'DIS');
select test.afirmar(pg_temp.fila('ing') = 'DISENO (heredada)', '4. Corregir otra cosa de Ingeniería no falla ni le quita la heredada dada de baja');
-- Ponerle una propia y quitársela mientras la de Diseño está de baja: vuelve a
-- la de Diseño sin error, para que responda sola cuando esa vuelva de alta.
select test.afirmar(pg_temp.asignar('ing', 'gerente') = 1 and pg_temp.fila('ing') = 'GERENTE', '4. Mientras tanto se le puede poner una propia');
select test.afirmar(pg_temp.asignar('ing', null) = 1 and pg_temp.fila('ing') = 'DISENO (heredada)',
  '4. y al quitársela vuelve a la de Diseño, aunque esté de baja, sin error');
reset role;
update public.usuarios set activo = true where id = pg_temp.cuenta('diseno');
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(public.responsable_del_area('ING') = pg_temp.cuenta('diseno') and public.responsable_del_area('DIS') = pg_temp.cuenta('diseno'),
  '4. Cuando la cuenta de Diseño vuelve de alta, responde otra vez por las dos, sin tocar nada');
reset role;
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.asignar('dis', 'gerente') = 1 and pg_temp.fila('ing') = 'GERENTE (heredada)',
  '4. Al cambiar la de Diseño, Ingeniería la recibe');
reset role;
update public.usuarios set activo = true where id = pg_temp.cuenta('diseno_colaborador');

-- Si la fila de Ingeniería no se pudo poner al día, el cambio de Diseño no se
-- guarda: una fila desfasada avisaría a quien ya no responde.
create or replace function pg_temp.traba_ing() returns trigger language plpgsql as $$
begin
  if new.codigo = 'ING' then return null; end if;
  return new;
end $$;
create trigger trg_aaa_traba_498 before update on public.areas for each row execute function pg_temp.traba_ing();
select pg_temp.como('admin');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.asignar('dis', 'diseno')$q$,
  '4. Si no se pudo anotar la cuenta en Ingeniería, el cambio de Diseño no se guarda', 'No se pudo anotar la cuenta');
reset role;
drop trigger trg_aaa_traba_498 on public.areas;
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)' and pg_temp.fila('dis') = 'GERENTE', '4. y las dos filas siguen como estaban');

-- ============================================ 5. Quién lleva a quién
select pg_temp.como('admin');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.llevar('prd', 'prd')$q$,
  '5. Un área no se lleva a sí misma', 'no se puede llevar a sí misma');
select test.debe_fallar($q$select pg_temp.llevar('prd', 'ing')$q$,
  '5. A Producción no la lleva Ingeniería, que ya es llevada por Diseño', 'ya la lleva otra área');
select test.debe_fallar($q$select pg_temp.llevar('dis', 'prd')$q$,
  '5. Diseño, que lleva a Ingeniería, no puede ser llevada por otra', 'ya lleva a otra área');
select test.debe_fallar(
  format($q$update public.areas set llevada_por_id = '%s' where codigo = 'PRD'$q$, gen_random_uuid()),
  '5. Un área que no existe no lleva a nadie', 'no existe o está dada de baja');
update public.areas set activo = false where codigo = 'TIC';
select test.debe_fallar($q$select pg_temp.llevar('sap', 'tic')$q$,
  '5. Un área dada de baja no lleva a otra', 'no existe o está dada de baja');

-- Deja de ser llevada: la heredada no era suya; la propia se conserva.
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)', '5. (Ingeniería parte heredando la de Diseño)');
select test.afirmar(pg_temp.llevar('ing', null) = 1 and pg_temp.fila('ing') = 'nadie',
  '5. Si a Ingeniería deja de llevarla Diseño, la cuenta heredada se va con eso');
select test.afirmar(pg_temp.llevar('ing', 'dis') = 1 and pg_temp.fila('ing') = 'GERENTE (heredada)',
  '5. y al volver a llevarla, la recibe otra vez');
select test.afirmar(pg_temp.asignar('ing', 'supervisor') = 1 and pg_temp.llevar('ing', null) = 1 and pg_temp.fila('ing') = 'SUPERVISOR',
  '5. Con cuenta propia, dejar de ser llevada no se la quita');
select test.afirmar(pg_temp.llevar('ing', 'dis') = 1 and pg_temp.fila('ing') = 'SUPERVISOR',
  '5. ni volver a ser llevada se la cambia');
select test.afirmar(pg_temp.asignar('ing', null) = 1 and pg_temp.fila('ing') = 'GERENTE (heredada)', '5. (vuelve a heredar)');

-- Otra área llevada por una que ya tiene cuenta: la recibe al enlazarla.
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 1 and pg_temp.llevar('mtz', 'prd') = 1 and pg_temp.fila('mtz') = 'SUPERVISOR (heredada)',
  '5. Un área que pasa a ser llevada por otra con cuenta la recibe en ese momento');
select test.afirmar(pg_temp.llevar('mtz', null) = 1 and pg_temp.fila('mtz') = 'nadie' and pg_temp.asignar('prd', null) = 1, '5. y se deshace');

-- Un área nueva que nace llevada por Diseño.
insert into public.areas (codigo, nombre, orden_secuencia, llevada_por_id)
values ('TNE', 'Área de prueba 498', 998, current_setting('prueba.area_dis')::uuid);
select test.afirmar(
  (select a.jefe_id = pg_temp.cuenta('gerente') and a.jefe_heredado from public.areas a where a.codigo = 'TNE'),
  '5. Un área que nace llevada por Diseño recibe su cuenta');
update public.areas set llevada_por_id = null where codigo = 'TNE';
reset role;

-- El área que la lleva se da de baja: deja de repartir su cuenta; al volver, la reparte.
select pg_temp.como('admin');
set local role authenticated;
update public.areas set activo = false where codigo = 'DIS';
select test.afirmar(pg_temp.fila('ing') = 'nadie', '5. Si Diseño se da de baja como área, Ingeniería deja de heredar su cuenta');
update public.areas set activo = true where codigo = 'DIS';
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)', '5. y al darla de alta otra vez, la recibe');
reset role;

-- ============================================ 6. Solo el administrador
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(pg_temp.llevar('ing', null) = 0, '6. Diseño, que ve Configuración, no cambia quién lleva a Ingeniería: cero filas');
select test.afirmar(pg_temp.asignar('ing', 'diseno') = 0, '6. ni se pone de responsable de Ingeniería: cero filas');
select test.afirmar(pg_temp.asignar('dis', 'diseno') = 0, '6. ni de Diseño, que la repartiría: cero filas');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.llevar('ing', null) = 0 and pg_temp.asignar('dis', null) = 0, '6. Gerencia tampoco: cero filas');
reset role;
select test.afirmar(pg_temp.fila('ing') = 'GERENTE (heredada)' and pg_temp.fila('dis') = 'GERENTE', '6. Las dos filas siguen como estaban');
select pg_temp.como('prueba_498');
set local role authenticated;
select test.afirmar(pg_temp.asignar('dis', 'diseno') = 1 and pg_temp.fila('ing') = 'DISENO (heredada)',
  '6. Con configuracion.editar, sin ser ADMIN, asigna la de Diseño y la de Ingeniería la sigue: la política pide el mismo permiso que la pantalla');
reset role;

-- ============================================ 7. Las puertas
select test.afirmar(
  not has_function_privilege('authenticated', 'public.fn_area_llevada_por()', 'execute')
  and not has_function_privilege('anon', 'public.fn_area_llevada_por()', 'execute')
  and not has_function_privilege('authenticated', 'public.fn_area_reparte_su_responsable()', 'execute')
  and not has_function_privilege('anon', 'public.fn_area_reparte_su_responsable()', 'execute'),
  '7. Las funciones de los disparadores no las llama la gente');
select test.afirmar(
  (select md5(replace(p.prosrc, E'\r', '')) from pg_proc p where p.oid = 'public.responsable_del_area(text)'::regprocedure) = 'a924e5a4e1b8886107e64e51e5d6b9a7',
  '7. responsable_del_area sigue siendo la de la entrega A.0: esta entrega no la reescribe');
select test.afirmar(
  (select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t
    where t.tgrelid = 'public.areas'::regclass and not t.tgisinternal and t.tgtype & 2 = 2
      and t.tgname in ('trg_area_llevada_por', 'trg_area_responsable_activo')) = 'trg_area_llevada_por,trg_area_responsable_activo',
  '7. La regla de quién la lleva corre antes que la de la cuenta activa (por orden alfabético)');

rollback;
