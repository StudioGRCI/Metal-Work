-- El recorrido de la planilla del mes y lo que falta para cerrarla (migración
-- 20261126310000). Todo con el puesto que lo hace —nunca ADMIN— y `set local
-- role authenticated`: RR. HH. arma la planilla, ve su recorrido y lo que falta,
-- y la cierra; Gerencia y Almacén no leen ni lo uno ni lo otro; el administrador
-- no la cierra. Cerrada, ya no se edita. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'GERENTE:GGE', 'ALMACENERO:ALM', 'ADMIN:GGE'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 472', lower(split_part(v, ':', 1)) || '.472@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  -- Ana tiene cuenta; Beto no. «Zeta Sin Ficha» no tiene ficha en Personal.
  insert into public.trabajadores (id, nombres, apellidos, dni, area_id, creado_por) values
    ('47200000-0000-4000-8000-000000000001', 'Ana', 'Prueba Cuatro', '47200001', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.recursos_humanos')::uuid),
    ('47200000-0000-4000-8000-000000000002', 'Beto', 'Prueba Cuatro', '47200002', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.recursos_humanos')::uuid);
  insert into public.trabajador_cuentas (trabajador_id, banco, tipo_cuenta, numero_cuenta)
  values ('47200000-0000-4000-8000-000000000001', 'Banco de Pruebas', 'AHORROS', '000-472-000001');

  -- Los reportes del mes (sin disparadores: solo importa su estado). Uno espera
  -- a RR. HH., uno ya lo tiene, uno está observado y uno está anulado; otro, del
  -- mes anterior, no cuenta.
  set local session_replication_role = replica;
  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por,
                                       visto_rrhh_por, visto_rrhh_en, observado_por, observado_en, observacion_area, observacion,
                                       anulado_por, anulado_en, motivo_anulacion, creado_en)
  select x.id, x.fecha, 'CHK472', x.asunto, 'Reporte del check 472', (select id from public.areas where codigo = 'PRD'),
         current_setting('prueba.gerente')::uuid,
         case when x.visto then current_setting('prueba.recursos_humanos')::uuid end, case when x.visto then now() end,
         case when x.observado then current_setting('prueba.recursos_humanos')::uuid end, case when x.observado then now() end,
         case when x.observado then 'RRHH' end, case when x.observado then 'Faltan las horas del soldador' end,
         case when x.anulado then current_setting('prueba.gerente')::uuid end, case when x.anulado then now() end,
         case when x.anulado then 'Se cargó dos veces el mismo día' end,
         now() - interval '3 days'
    from (values
      ('47200000-0000-4000-8000-0000000000a1'::uuid, date_trunc('month', current_date)::date,     'Espera a RR. HH.', false, false, false),
      ('47200000-0000-4000-8000-0000000000a2'::uuid, date_trunc('month', current_date)::date,     'Ya tiene el visto', true,  false, false),
      ('47200000-0000-4000-8000-0000000000a3'::uuid, date_trunc('month', current_date)::date,     'Observado', false, true, false),
      ('47200000-0000-4000-8000-0000000000a4'::uuid, date_trunc('month', current_date)::date,     'Anulado', false, false, true),
      ('47200000-0000-4000-8000-0000000000a5'::uuid, (date_trunc('month', current_date) - interval '1 day')::date, 'Del mes anterior', false, false, false)
    ) as x(id, fecha, asunto, visto, observado, anulado);
  set local session_replication_role = origin;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- ============================================ 1. Nadie sin sesión las ejecuta
select test.afirmar(
  not has_function_privilege('anon', 'public.recorrido_de_planillas(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.planilla_lo_que_falta(uuid)', 'execute'),
  'anon no ejecuta el recorrido ni lo que falta de la planilla');

-- ============================================ 2. RR. HH. arma la planilla de taller
select pg_temp.como('recursos_humanos');
set local role authenticated;

insert into public.planillas (id, tipo, periodo, registrado_por)
values ('47200000-0000-4000-8000-0000000000b1', 'TALLER', date_trunc('month', current_date)::date, public.usuario_actual());
insert into public.planillas (id, tipo, periodo, registrado_por)
values ('47200000-0000-4000-8000-0000000000b2', 'SUBCONTRATOS', date_trunc('month', current_date)::date, public.usuario_actual());

-- Un Excel con Ana y Beto; Zeta, a mano.
insert into public.planilla_personas (planilla_id, nombre, documento, monto, registrado_por, importacion_id)
values ('47200000-0000-4000-8000-0000000000b1', 'Ana Prueba Cuatro', '47200001', 1500, public.usuario_actual(), '47200000-0000-4000-8000-0000000000c1'),
       ('47200000-0000-4000-8000-0000000000b1', 'Beto Prueba Cuatro', '47200002', 1400, public.usuario_actual(), '47200000-0000-4000-8000-0000000000c1');
insert into public.planilla_personas (planilla_id, nombre, documento, monto, registrado_por)
values ('47200000-0000-4000-8000-0000000000b1', 'Zeta Sin Ficha', null, 900, public.usuario_actual());

-- El recorrido: creada, el Excel con 2, 1 a mano y el cierre que espera a RR. HH.
select test.afirmar(
  (select array_agg(paso || ':' || situacion || ':' || coalesce(detalle, '-') order by orden)
     from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid]))
  = array['CREADA:HECHO:-', 'IMPORTACION:HECHO:2', 'A_MANO:HECHO:1', 'CIERRE:AHORA:-'],
  'el recorrido de la planilla en preparación: creada, el Excel con 2 personas, 1 a mano y el cierre pendiente');
select test.afirmar(
  (select puesto = 'Recursos Humanos' and espera = 'CERRAR' and dias = 0
     from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid]) where situacion = 'AHORA'),
  'el cierre lo tiene Recursos Humanos, con gente adentro, desde hoy');
select test.afirmar(
  (select bool_and(puesto is not null and puesto <> '' and en is not null)
     from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid]) where situacion = 'HECHO'),
  'cada paso hecho dice el puesto de quien lo hizo y cuándo');
select test.afirmar(
  (select espera = 'IMPORTAR' from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b2'::uuid]) where situacion = 'AHORA'),
  'la planilla vacía espera que se importe su Excel');

-- Lo que falta: el reporte sin visto y el observado del mes; Beto sin cuenta y
-- Zeta sin ficha. Ni Ana, ni el reporte con visto, ni el anulado, ni el del mes
-- anterior.
select test.afirmar(
  (select array_agg(clase || ':' || coalesce(nombre, '') order by clase, nombre)
     from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1'))
  = array['REPORTE_OBSERVADO:Observado', 'REPORTE_SIN_VISTO:Espera a RR. HH.', 'SIN_CUENTA:Beto Prueba Cuatro', 'SIN_FICHA:Zeta Sin Ficha'],
  'lo que falta: un reporte sin visto, uno observado, Beto sin cuenta y Zeta sin ficha');
select test.afirmar(
  (select dias = 3 from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1') where clase = 'REPORTE_SIN_VISTO'),
  'el reporte sin visto dice los días que lleva esperando');
select test.afirmar(
  (select documento = '47200000-0000-4000-8000-000000000002'::uuid from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1') where clase = 'SIN_CUENTA'),
  'quien no tiene cuenta se nombra por su ficha, para abrirla');
select test.afirmar(
  not exists (select 1 from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1')
               where detalle ~ '000-472' or nombre ~ '000-472'),
  'lo que falta no trae el número de ninguna cuenta');
select test.afirmar(
  not exists (select 1 from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b2')),
  'a la de subcontratos no se le piden reportes ni cuentas');

reset role;

-- ============================================ 3. Gerencia y Almacén no leen las planillas
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar($$select * from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid])$$,
  'Gerencia no lee el recorrido de la planilla', 'permiso');
select test.debe_fallar($$select * from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1')$$,
  'Gerencia no lee lo que falta de la planilla', 'permiso');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($$select * from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1')$$,
  'Almacén no lee lo que falta de la planilla', 'permiso');
reset role;

-- ============================================ 4. El administrador mira, no cierra
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(
  (select count(*) = 4 from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid])),
  'el administrador mira el recorrido');
select test.debe_fallar($$select public.cerrar_planilla('47200000-0000-4000-8000-0000000000b1')$$,
  'el administrador no cierra la planilla de RR. HH.');
reset role;

-- ============================================ 5. RR. HH. cierra aunque falte algo; cerrada no se edita
select pg_temp.como('recursos_humanos');
set local role authenticated;
select public.cerrar_planilla('47200000-0000-4000-8000-0000000000b1');

select test.afirmar(
  (select array_agg(paso || ':' || situacion order by orden)
     from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid]))
  = array['CREADA:HECHO', 'IMPORTACION:HECHO', 'A_MANO:HECHO', 'CIERRE:HECHO'],
  'cerrada, el recorrido termina en el cierre hecho');
select test.afirmar(
  (select puesto = 'Recursos Humanos' and dias is null
     from public.recorrido_de_planillas(array['47200000-0000-4000-8000-0000000000b1'::uuid]) where paso = 'CIERRE'),
  'el cierre dice que lo hizo Recursos Humanos');
select test.afirmar(
  not exists (select 1 from public.planilla_lo_que_falta('47200000-0000-4000-8000-0000000000b1')),
  'a la planilla cerrada ya no le falta nada');

select test.debe_fallar($$insert into public.planilla_personas (planilla_id, nombre, monto, registrado_por)
  values ('47200000-0000-4000-8000-0000000000b1', 'Otra Persona', 100, public.usuario_actual())$$,
  'a la planilla cerrada no se le agrega nadie', 'borrador');
select test.debe_fallar($$update public.planilla_personas set monto = 1 where planilla_id = '47200000-0000-4000-8000-0000000000b1'$$,
  'en la planilla cerrada no se cambia un monto', 'borrador');
select test.debe_fallar($$delete from public.planilla_personas where planilla_id = '47200000-0000-4000-8000-0000000000b1'$$,
  'de la planilla cerrada no se quita a nadie', 'borrador');

-- Ni siquiera tiene `grant update`: la reapertura cae, no pasa en silencio.
select test.debe_fallar($$update public.planillas set estado = 'BORRADOR', cerrado_por = null, cerrado_en = null
   where id = '47200000-0000-4000-8000-0000000000b1'$$,
  'la planilla cerrada no se reabre por la API', 'permission denied');
reset role;

select test.afirmar(
  (select estado = 'CERRADA' and (select count(*) from public.planilla_personas where planilla_id = p.id) = 3
     from public.planillas p where p.id = '47200000-0000-4000-8000-0000000000b1'),
  'la planilla sigue cerrada con sus tres personas');

rollback;
