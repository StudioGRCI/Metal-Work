-- El responsable de cada área es una cuenta (migración 20261125205000), cada
-- cosa con el rol que la vive y `set local role authenticated`:
--   * el administrador del sistema asigna, cambia y quita la cuenta responsable;
--   * ningún otro puesto la cambia: ni Diseño, que ve Configuración, ni
--     Gerencia, ni Administración. El UPDATE no falla: afecta cero filas, y por
--     eso se mira la fila después;
--   * una cuenta dada de baja no se asigna;
--   * `responsable_del_area` la lee cualquier cuenta activa, y deja de dar la
--     cuenta que se dio de baja después de asignarla;
--   * el texto del organigrama no se toca.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Un puesto de prueba que no es ADMIN y tiene `configuracion.editar`: así se
  -- prueba que la política acepta el mismo permiso que exige la acción, y no
  -- solo el atajo de `es_admin()`.
  insert into public.roles (codigo, nombre) values ('PRUEBA_460', 'Puesto de prueba 460');
  insert into public.roles_permisos (rol_id, permiso_codigo)
  select id, 'configuracion.editar' from public.roles where codigo = 'PRUEBA_460';
  foreach v in array array['ADMIN:', 'DISENO:DIS', 'GERENTE:GGE', 'ADMINISTRACION:ADM', 'SUPERVISOR:PRD', 'CALIDAD:CAL', 'PRUEBA_460:'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.460@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 460', lower(split_part(v, ':', 1)) || '.460@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  -- Una cuenta dada de baja, para probar que no se asigna. La da de baja el
  -- administrador: sin sesión, `fn_usuario_proteger_rol` no deja.
  perform set_config('request.jwt.claim.sub', current_setting('prueba.admin'), true);
  update public.usuarios set activo = false where id = current_setting('prueba.calidad')::uuid;
  perform set_config('prueba.area_cal', (select id::text from public.areas where codigo = 'CAL'), true);
  perform set_config('prueba.area_prd', (select id::text from public.areas where codigo = 'PRD'), true);
  -- El texto del organigrama de Producción, para comprobar al final que sigue igual.
  perform set_config('prueba.texto_prd', coalesce((select encargado from public.areas where codigo = 'PRD'), '(sin texto)'), true);
  -- Parte sin responsable, pase lo que pase con los datos que traiga la base.
  update public.areas set jefe_id = null where codigo in ('CAL', 'PRD');
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Lo que hace la acción de servidor: un UPDATE por la política de `areas`.
create or replace function pg_temp.asignar(p_area text, p_cuenta text) returns integer language plpgsql as $$
declare v integer;
begin
  update public.areas
     set jefe_id = case when p_cuenta is null then null else current_setting('prueba.' || p_cuenta)::uuid end
   where id = current_setting('prueba.area_' || p_area)::uuid;
  get diagnostics v = row_count;
  return v;
end $$;

-- ============================================ 1. Quien no es el administrador no asigna
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 0, 'Diseño, que ve Configuración, no asigna el responsable de un área: cero filas');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 0, 'Gerencia no asigna el responsable de un área: cero filas');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 0, 'Administración no asigna el responsable de un área: cero filas');
select test.afirmar(public.responsable_del_area('PRD') is null, 'Producción sigue sin cuenta responsable');
reset role;

-- Quien tiene `configuracion.editar` sin ser ADMIN entra por la misma puerta que la acción.
select pg_temp.como('prueba_460');
set local role authenticated;
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 1, 'Con configuracion.editar, sin ser ADMIN, se asigna: la política pide el mismo permiso que la acción');
select test.afirmar(pg_temp.asignar('prd', null) = 1, 'Y se quita');
reset role;

-- ============================================ 2. El administrador asigna, cambia y quita
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(pg_temp.asignar('prd', 'supervisor') = 1, 'El administrador asigna la cuenta responsable de Producción');
select test.debe_fallar($q$select pg_temp.asignar('cal', 'calidad')$q$,
  'Una cuenta dada de baja no se asigna como responsable', 'tiene que ser una cuenta activa');
select test.debe_fallar(
  format($q$update public.areas set jefe_id = '%s' where codigo = 'CAL'$q$, gen_random_uuid()),
  'Una cuenta que no existe no se asigna como responsable');
-- Corregir otra cosa del área no vuelve a juzgar a su responsable.
update public.areas set nombre = nombre where codigo = 'PRD';
reset role;

-- ============================================ 3. A quién se le avisa del área
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(public.responsable_del_area('PRD') = current_setting('prueba.supervisor')::uuid,
  'Cualquier cuenta activa lee quién responde por Producción');
select test.afirmar(public.responsable_del_area(' prd ') = current_setting('prueba.supervisor')::uuid,
  'El código vale en minúsculas y con espacios');
select test.afirmar(public.responsable_del_area('CAL') is null, 'Calidad no tiene cuenta responsable: no da nada');
select test.afirmar(public.responsable_del_area('XXX') is null and public.responsable_del_area(null) is null,
  'Un área que no existe no da nada');
reset role;
-- La lee también quien no es de esa área ni la asigna: si solo la viera su
-- propio responsable, el aviso «al área» de otro puesto no tendría a quién ir.
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(public.responsable_del_area('PRD') = current_setting('prueba.supervisor')::uuid,
  'Otro puesto lee quién responde por Producción');
reset role;
-- La cuenta dada de baja ya no lee nada del sistema, tampoco esto.
select pg_temp.como('calidad');
set local role authenticated;
select test.afirmar(public.responsable_del_area('PRD') is null, 'Una cuenta dada de baja no lee quién responde por un área');
reset role;

select test.afirmar((select encargado from public.areas where codigo = 'PRD') is not distinct from nullif(current_setting('prueba.texto_prd'), '(sin texto)'),
  'El texto del organigrama no se toca al asignar la cuenta');

-- La cuenta se da de baja después de asignarla: la fila no la pierde (la
-- pantalla lo dice), pero ya no se le avisa, y el área se sigue corrigiendo.
select pg_temp.como('admin');
set local role authenticated;
update public.usuarios set activo = false where id = current_setting('prueba.supervisor')::uuid;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(public.responsable_del_area('PRD') is null, 'A la cuenta dada de baja ya no se le avisa');
reset role;
select pg_temp.como('admin');
set local role authenticated;
update public.areas set nombre = nombre where codigo = 'PRD';
select test.afirmar((select jefe_id from public.areas where codigo = 'PRD') = current_setting('prueba.supervisor')::uuid,
  'El área conserva su responsable dado de baja hasta que el administrador lo cambie');
select test.afirmar(pg_temp.asignar('prd', 'gerente') = 1, 'El administrador cambia el responsable por otra cuenta activa');
select test.afirmar(pg_temp.asignar('prd', null) = 1, 'El administrador quita el responsable');
select test.afirmar((select jefe_id from public.areas where codigo = 'PRD') is null, 'Producción queda sin cuenta responsable');
reset role;

-- ============================================ 4. Las puertas
select test.afirmar(not has_function_privilege('anon', 'public.responsable_del_area(text)', 'execute'),
  'responsable_del_area no la ejecuta quien no entró');
select test.afirmar(not has_function_privilege('authenticated', 'public.fn_area_responsable_activo()', 'execute'),
  'La función del disparador no la llama la gente');

rollback;
