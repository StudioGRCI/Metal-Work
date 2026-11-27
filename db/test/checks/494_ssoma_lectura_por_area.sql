-- SSOMA, entrega 15.6 (migración 20261127150600): la lectura de Gerencia, con los
-- días sin accidentes, los reportes abiertos y las acciones vencidas, de toda la
-- planta y por área.
--
-- Los reportes, las clasificaciones y las acciones los hace SSOMA con sus
-- funciones, como en la pantalla. Lo que se lee, se lee con el rol real de cada
-- puesto y `set local role authenticated`, nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000494', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T494', 'Taller de pruebas de la lectura de SSOMA') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma494@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia494@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
-- Ventas tiene acciones a su cargo y aun así no lee la lectura de Gerencia.
select test.crear_usuario('Vera', 'Ventas', 'ventas494@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Rosa', 'Recursos', 'rrhh494@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- Cinco áreas de prueba: A, B y C con reportes; D dada de baja sin nada; E activa sin nada.
insert into public.areas (codigo, nombre, orden_secuencia) values
  ('TQA', 'Área A del check 494', 9941), ('TQB', 'Área B del check 494', 9942),
  ('TQC', 'Área C del check 494', 9943), ('TQE', 'Área E del check 494', 9945);
insert into public.areas (codigo, nombre, orden_secuencia, activo) values ('TQD', 'Área D del check 494', 9944, false);

-- Lo que lee cada quien: la fila de la planta y la de un área, como texto para comparar.
create or replace function pg_temp.planta()
returns text language sql as $$
  select format('%s|%s|%s|%s|%s|%s|%s|%s', p.ultimo_accidente, p.area_del_ultimo, p.registro_desde, p.dias_sin_accidentes,
                p.reportes_abiertos, p.por_clasificar, p.acciones_abiertas, p.acciones_vencidas)
    from public.ssoma_seguridad_de_la_planta() p;
$$;
create or replace function pg_temp.area(p_codigo text)
returns text language sql as $$
  select format('%s|%s|%s|%s|%s|%s|%s|%s', a.activa, a.ultimo_accidente, a.dias_sin_accidentes, a.reportes_abiertos,
                a.por_clasificar, a.acciones_abiertas, a.acciones_vencidas, a.vencida_mas_antigua)
    from public.ssoma_seguridad_por_area() a
   where a.area_id = (select id from public.areas where codigo = p_codigo);
$$;
-- Un día de Lima a una hora de Lima, como timestamptz.
create or replace function pg_temp.en_lima(p_dias_atras integer, p_hora text default '12:00')
returns timestamptz language sql as $$
  select ((current_setting('prueba.hoy')::date - p_dias_atras)::text || ' ' || p_hora)::timestamp at time zone 'America/Lima';
$$;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    has_function_privilege('authenticated', 'public.ssoma_seguridad_de_la_planta()', 'execute')
    and has_function_privilege('authenticated', 'public.ssoma_seguridad_por_area()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_seguridad_de_la_planta()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_seguridad_por_area()', 'execute'),
    'las dos lecturas son de las cuentas con sesión, nunca del anónimo');
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.ssoma_accidentes()', 'execute')
    and not has_function_privilege('authenticated', 'public.ssoma_registro_desde()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_accidentes()', 'execute'),
    'los ayudantes internos no se abren a la gente');
  perform test.afirmar(
    (select bool_and(p.prosecdef) from pg_proc p
      where p.oid in ('public.ssoma_seguridad_de_la_planta()'::regprocedure, 'public.ssoma_seguridad_por_area()'::regprocedure))
    and (select bool_and(p.proconfig @> array['search_path=public']) from pg_proc p
      where p.oid in ('public.ssoma_seguridad_de_la_planta()'::regprocedure, 'public.ssoma_seguridad_por_area()'::regprocedure,
                      'public.ssoma_accidentes()'::regprocedure, 'public.ssoma_registro_desde()'::regprocedure)),
    'las lecturas leen por encima del RLS y todas fijan su search_path');
  -- Lo que sigue supone que los únicos reportes son los de este check.
  perform test.afirmar(not exists (select 1 from public.ssoma_reportes), 'la base de prueba empieza sin reportes de seguridad');
end $$;

-- ============================================================ 1. Sin ningún reporte
select test.como_usuario(:'gerente_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(pg_temp.planta() = '||||0|0|0|0',
    'sin ningún reporte, no hay último accidente ni desde cuándo contar, y todo en cero: ' || coalesce(pg_temp.planta(), '(sin fila)'));
  perform test.afirmar(pg_temp.area('TQE') = 't|||0|0|0|0|',
    'un área activa sin nada sale con todo en cero y sin días que contar: ' || coalesce(pg_temp.area('TQE'), '(sin fila)'));
end $$;
reset role;

-- ============================================================ 2. SSOMA registra lo que pasó
select test.como_usuario(:'ssoma_id');
set local role authenticated;
do $$
declare
  v_resp  constant uuid := current_setting('prueba.vendedor')::uuid;
  v_hoy   constant date := current_setting('prueba.hoy')::date;
  v_a     constant uuid := (select id from public.areas where codigo = 'TQA');
  v_b     constant uuid := (select id from public.areas where codigo = 'TQB');
  v_c     constant uuid := (select id from public.areas where codigo = 'TQC');
  v       uuid;
begin
  -- A: un accidente de hace 40 días, clasificado leve, con su acción (que vencerá).
  v := gen_random_uuid(); perform set_config('prueba.r1', v::text, true);
  perform public.ssoma_reportar(v, 'ACCIDENTE', v_a, 'Mesa de corte', 'Corte en la mano al mover una plancha sin guantes.', pg_temp.en_lima(40), true, null, '[]'::jsonb);
  perform public.ssoma_clasificar(v, 'ACCIDENTE_LEVE', true, null, 'La plancha se movió sin los guantes de corte.');
  perform set_config('prueba.a1', gen_random_uuid()::text, true);
  perform public.ssoma_crear_accion(current_setting('prueba.a1')::uuid, v, 'Poner guantes de corte junto a la mesa', v_resp, v_hoy + 5);
  -- A: reportado como accidente hace 10 días, SSOMA vio que fue un incidente.
  v := gen_random_uuid(); perform set_config('prueba.r2', v::text, true);
  perform public.ssoma_reportar(v, 'ACCIDENTE', v_a, 'Pasillo central', 'Se cayó una caja de pernos cerca de un operario.', pg_temp.en_lima(10), false, null, '[]'::jsonb);
  perform public.ssoma_clasificar(v, 'INCIDENTE', null, null, 'La caja estaba al borde del estante.');
  -- A: un accidente de hace 20 días que se anuló: no cuenta.
  v := gen_random_uuid(); perform set_config('prueba.r3', v::text, true);
  perform public.ssoma_reportar(v, 'ACCIDENTE', v_a, 'Prensa', 'Golpe en el brazo con la puerta de la prensa.', pg_temp.en_lima(20), false, null, '[]'::jsonb);
  perform public.ssoma_anular_reporte(v, 'Se reportó dos veces el mismo hecho');

  -- B: un accidente de hace siete días a las 23:30 de Lima (en UTC ya es el día siguiente), sin clasificar.
  v := gen_random_uuid(); perform set_config('prueba.r4', v::text, true);
  perform public.ssoma_reportar(v, 'ACCIDENTE', v_b, 'Cabina de pintura', 'Salpicadura de solvente en el antebrazo.', pg_temp.en_lima(7, '23:30'), true, null, '[]'::jsonb);
  -- B: una condición insegura con cuatro acciones: abierta, por vencer hoy, por correrse a ayer y una anulada.
  v := gen_random_uuid(); perform set_config('prueba.r5', v::text, true);
  perform public.ssoma_reportar(v, 'CONDICION_INSEGURA', v_b, 'Almacén de pinturas', 'Latas apiladas sobre la salida de emergencia.', pg_temp.en_lima(1), null, null, '[]'::jsonb);
  perform public.ssoma_clasificar(v, 'CONDICION_INSEGURA', null, null, 'No hay un lugar marcado para las latas.');
  perform public.ssoma_crear_accion(gen_random_uuid(), v, 'Marcar en el piso el lugar de las latas', v_resp, v_hoy + 10);
  perform public.ssoma_crear_accion(gen_random_uuid(), v, 'Despejar hoy la salida de emergencia', v_resp, v_hoy);
  perform set_config('prueba.a3', gen_random_uuid()::text, true);
  perform public.ssoma_crear_accion(current_setting('prueba.a3')::uuid, v, 'Comprar un estante para las latas', v_resp, v_hoy + 3);
  perform set_config('prueba.a5', gen_random_uuid()::text, true);
  perform public.ssoma_crear_accion(current_setting('prueba.a5')::uuid, v, 'Una acción que se encargó por error', v_resp, v_hoy + 4);
  perform public.ssoma_anular_accion(current_setting('prueba.a5')::uuid, 'Se encargó dos veces la misma cosa');

  -- C: un incidente con su acción (que vencerá); después el área se da de baja.
  v := gen_random_uuid(); perform set_config('prueba.r6', v::text, true);
  perform public.ssoma_reportar(v, 'INCIDENTE', v_c, 'Patio de maniobras', 'Un montacargas retrocedió sin alarma.', pg_temp.en_lima(2), null, null, '[]'::jsonb);
  perform public.ssoma_clasificar(v, 'INCIDENTE', null, null, 'La alarma de retroceso no funcionaba.');
  perform set_config('prueba.a6', gen_random_uuid()::text, true);
  perform public.ssoma_crear_accion(current_setting('prueba.a6')::uuid, v, 'Reparar la alarma de retroceso', v_resp, v_hoy + 2);
end $$;
reset role;

-- El paso del tiempo: tres acciones pasan su fecha límite (sin tocar el resto) y C se da de baja.
select set_config('session_replication_role', 'replica', true);
update public.ssoma_acciones set fecha_limite = current_setting('prueba.hoy')::date - 3 where id = current_setting('prueba.a1')::uuid;
update public.ssoma_acciones set fecha_limite = current_setting('prueba.hoy')::date - 1 where id = current_setting('prueba.a3')::uuid;
update public.ssoma_acciones set fecha_limite = current_setting('prueba.hoy')::date - 9 where id = current_setting('prueba.a6')::uuid;
select set_config('session_replication_role', 'origin', true);
update public.areas set activo = false where codigo = 'TQC';

-- ============================================================ 3. Lo que lee Gerencia
select test.como_usuario(:'gerente_id');
set local role authenticated;
do $$
declare
  v_hoy constant date := current_setting('prueba.hoy')::date;
begin
  -- El último accidente es el de B, de hace siete días en Lima aunque en UTC ya fuera el sexto.
  perform test.afirmar(pg_temp.planta() = format('%s|Área B del check 494|%s|7|5|1|5|3', v_hoy - 7, v_hoy - 40),
    'la planta: último accidente el de B, hace 7 días; registro desde el hecho más viejo; 5 reportes abiertos, 1 por clasificar, 5 acciones abiertas y 3 vencidas: ' || coalesce(pg_temp.planta(), '(sin fila)'));
  -- A: el reclasificado como incidente y el anulado no cuentan; el de hace 40 días sí.
  perform test.afirmar(pg_temp.area('TQA') = format('t|%s|40|2|0|1|1|%s', v_hoy - 40, v_hoy - 3),
    'A: 40 días sin accidentes (el reclasificado y el anulado no cuentan), 2 reportes abiertos y su acción vencida hace 3 días: ' || coalesce(pg_temp.area('TQA'), '(sin fila)'));
  -- B: la de hoy no está vencida, la anulada no cuenta.
  perform test.afirmar(pg_temp.area('TQB') = format('t|%s|7|2|1|3|1|%s', v_hoy - 7, v_hoy - 1),
    'B: 7 días, el accidente sin clasificar cuenta; 3 acciones abiertas (la anulada no), 1 vencida (la que vence hoy no): ' || coalesce(pg_temp.area('TQB'), '(sin fila)'));
  -- C: dada de baja, sigue a la vista porque le queda una acción vencida; nunca tuvo accidentes.
  perform test.afirmar(pg_temp.area('TQC') = format('f||40|1|0|1|1|%s', v_hoy - 9),
    'C: dada de baja, sale porque le queda algo abierto, y sin accidentes cuenta desde el primer registro: ' || coalesce(pg_temp.area('TQC'), '(sin fila)'));
  perform test.afirmar(pg_temp.area('TQD') is null, 'D: dada de baja sin nada abierto, no sale');
  perform test.afirmar(pg_temp.area('TQE') = 't||40|0|0|0|0|', 'E: activa sin nada, 40 días desde el primer registro: ' || coalesce(pg_temp.area('TQE'), '(sin fila)'));
  -- Las cuentas por área suman la planta.
  perform test.afirmar(
    (select format('%s|%s|%s|%s', sum(reportes_abiertos), sum(por_clasificar), sum(acciones_abiertas), sum(acciones_vencidas))
       from public.ssoma_seguridad_por_area()) = '5|1|5|3',
    'lo de cada área suma lo de la planta');
  -- Las áreas salen en el orden de la empresa.
  perform test.afirmar(
    (select string_agg(a.area, ',' order by o) from public.ssoma_seguridad_por_area() with ordinality as a(area_id, area, activa, ua, d, ra, pc, aa, av, vm, o)
      where a.area like '%check 494') = 'Área A del check 494,Área B del check 494,Área C del check 494,Área E del check 494',
    'las áreas, en el orden de la empresa');
end $$;
reset role;

-- ============================================================ 4. SSOMA lee lo mismo, y la última clasificación vale
select test.como_usuario(:'ssoma_id');
set local role authenticated;
do $$
declare
  v_hoy constant date := current_setting('prueba.hoy')::date;
  v_ger text;
begin
  perform test.afirmar(pg_temp.area('TQA') = format('t|%s|40|2|0|1|1|%s', v_hoy - 40, v_hoy - 3), 'SSOMA lee lo mismo que Gerencia en A');
  -- SSOMA corrige: el de hace 10 días sí fue un accidente incapacitante.
  perform public.ssoma_clasificar(current_setting('prueba.r2')::uuid, 'ACCIDENTE_INCAPACITANTE', true, 3, 'La caja le cayó en el pie y tuvo descanso médico.');
  perform test.afirmar(pg_temp.area('TQA') like format('t|%s|10|%%', v_hoy - 10), 'reclasificado como accidente, A cuenta desde hace 10 días: ' || pg_temp.area('TQA'));
  perform test.afirmar(pg_temp.planta() like format('%s|Área B del check 494|%%|7|%%', v_hoy - 7), 'la planta sigue con el de B, que es más nuevo');
  -- Y lo vuelve a corregir: la última clasificación es la que vale.
  perform public.ssoma_clasificar(current_setting('prueba.r2')::uuid, 'INCIDENTE', null, null, 'Revisado: la caja no lo tocó.');
  perform test.afirmar(pg_temp.area('TQA') like format('t|%s|40|%%', v_hoy - 40), 'vuelto a incidente, A vuelve a 40 días');
  -- El de B, clasificado como incidente, deja de ser el último accidente: queda el de A.
  perform public.ssoma_clasificar(current_setting('prueba.r4')::uuid, 'INCIDENTE', null, null, 'El solvente no llegó a la piel.');
  perform test.afirmar(pg_temp.planta() = format('%s|Área A del check 494|%s|40|5|0|5|3', v_hoy - 40, v_hoy - 40),
    'sin el de B, el último accidente de la planta es el de A y B deja de tener por clasificar: ' || pg_temp.planta());
  perform test.afirmar(pg_temp.area('TQB') = format('t||40|2|0|3|1|%s', v_hoy - 1), 'B sin accidentes cuenta desde el primer registro: ' || pg_temp.area('TQB'));
end $$;
reset role;

-- ============================================================ 5. Quien no es SSOMA ni Gerencia no lee nada
do $$
declare
  v_quien text;
begin
  foreach v_quien in array array['vendedor', 'rrhh'] loop
    perform test.como_usuario(current_setting('prueba.' || v_quien)::uuid);
    set local role authenticated;
    perform test.afirmar(not exists (select 1 from public.ssoma_seguridad_de_la_planta()), v_quien || ' no recibe la fila de la planta');
    perform test.afirmar(not exists (select 1 from public.ssoma_seguridad_por_area()), v_quien || ' no recibe ninguna área');
    perform test.debe_fallar('select * from public.ssoma_accidentes()', v_quien || ' no llama al ayudante de los accidentes', 'permission denied');
    reset role;
  end loop;
end $$;

-- Ventas, aunque las tenga a su cargo, sigue viendo sus acciones donde siempre.
select test.como_usuario(:'vendedor_id');
set local role authenticated;
select test.afirmar((select count(*) from public.ssoma_acciones_a_la_vista(null, null, null) where estado = 'ABIERTA') = 5,
  'el responsable sigue viendo sus cinco acciones abiertas en su lista');
reset role;

rollback;
