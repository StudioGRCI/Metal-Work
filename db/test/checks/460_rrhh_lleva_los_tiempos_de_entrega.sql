-- Los tiempos de entrega por código interno que lleva Recursos Humanos
-- (migración 20261125100000): el permiso rrhh.tiempos_entrega, el semáforo por
-- días hábiles y el tablero. Cada lectura con el puesto que la hace —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Las fechas salen de hoy y del calendario laboral, no escritas a mano, para
-- que la prueba valga cualquier día del año.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid; v_cli uuid; v_uni uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'GERENTE:GGE', 'DISENO:DIS', 'ALMACENERO:ALM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.460@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 460', lower(split_part(v, ':', 1)) || '.460@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar(
    (select count(*) = 4 from public.usuarios where apellidos = 'Check 460'),
    'los cuatro puestos de la prueba existen (RR. HH., Gerencia, Diseño y Almacén)');

  -- Código A: una etapa de cada color, armadas por Diseño.
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por)
  select 'CHK460_A', x.orden, x.nombre, (select id from public.areas where codigo = 'PRD'),
         null, x.fin_plan, x.inicio_real, x.fin_real, current_setting('prueba.diseno')::uuid
    from (values
      (1::smallint, 'Terminada tarde', current_date - 10, current_date - 12, current_date - 5),
      (2::smallint, 'Vencida ayer',    current_date - 1,  current_date - 3,  null::date),
      (3::smallint, 'Vence hoy',       current_date,      null::date,        null::date),
      (4::smallint, 'En el limite',    public.sumar_dias_habiles(current_date, 3), null::date, null::date),
      (5::smallint, 'Con holgura',     public.sumar_dias_habiles(current_date, 4), null::date, null::date),
      (6::smallint, 'Sin fecha',       null::date,        null::date,        null::date)
    ) as x(orden, nombre, fin_plan, inicio_real, fin_real);

  -- Una subetapa vencida debajo de la vencida: la etapa cuenta una sola vez.
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, padre_id, de_area, creado_por)
  select 'CHK460_A', 7, 'Subetapa vencida', e.area_id, current_date - 2, e.id, true, current_setting('prueba.diseno')::uuid
    from public.codigo_etapas e where e.codigo_interno = 'CHK460_A' and e.nombre = 'Vencida ayer';

  -- Código B: solo etapas con holgura, y una OT con su fecha de entrega lejos.
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, creado_por)
  values ('CHK460_B', 1, 'Con holgura', (select id from public.areas where codigo = 'MTZ'),
          public.sumar_dias_habiles(current_date, 10), current_setting('prueba.diseno')::uuid);

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999460011', 'CLIENTE DE PRUEBA 460 S.A.C.') returning id into v_cli;
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK460_B', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 460 · con holgura',
          public.sumar_dias_habiles(current_date, 20));

  -- Código C: sin etapas, y su OT se entrega mañana o pasado (por vencer).
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK460_C', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 460 · por vencer',
          public.sumar_dias_habiles(current_date, 1));

  -- Código D: sin etapas y sin fecha de entrega.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK460_D', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 460 · sin fecha');
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- ============================================ 1. El permiso tiene dueño
select test.afirmar(
  (select count(*) = 2 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'rrhh.tiempos_entrega' and r.codigo in ('RECURSOS_HUMANOS', 'GERENTE')),
  'rrhh.tiempos_entrega lo tienen Recursos Humanos y Gerencia');
select test.afirmar(
  not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
               where rp.permiso_codigo = 'rrhh.tiempos_entrega'
                 and r.codigo not in ('RECURSOS_HUMANOS', 'GERENTE', 'GERENTE_PRODUCCION')),
  'ningún otro puesto tiene rrhh.tiempos_entrega');
select test.afirmar(public.dias_por_vencer() = 3, 'por vencer son 3 días hábiles');

-- ============================================ 2. RR. HH. lee las etapas con su semáforo
select pg_temp.como('recursos_humanos');
set local role authenticated;

select test.afirmar(
  (select count(*) = 7 from public.tiempos_de_entrega_etapas('chk460_a')),
  'RR. HH. lee las seis etapas del código A, escrito en minúsculas');
select test.afirmar(
  (select string_agg(e.semaforo, ',' order by e.orden) from public.tiempos_de_entrega_etapas('CHK460_A') e)
    = 'TERMINADA,ROJO,AMBAR,AMBAR,VERDE,SIN_FECHA,ROJO',
  'terminada, vencida ayer, vence hoy, a 3 días hábiles, a 4 días hábiles y sin fecha: cada una con su color');
select test.afirmar(
  (select e.dias_habiles = 0 from public.tiempos_de_entrega_etapas('CHK460_A') e where e.nombre = 'Vence hoy'),
  'a la que vence hoy le faltan 0 días hábiles');
select test.afirmar(
  (select e.dias_habiles = 3 from public.tiempos_de_entrega_etapas('CHK460_A') e where e.nombre = 'En el limite'),
  'a la del límite le faltan 3 días hábiles');
select test.afirmar(
  (select e.dias_habiles < 0 from public.tiempos_de_entrega_etapas('CHK460_A') e where e.nombre = 'Vencida ayer'),
  'la vencida lleva los días en negativo');
select test.afirmar(
  (select e.dias_habiles is null from public.tiempos_de_entrega_etapas('CHK460_A') e where e.nombre = 'Terminada tarde'),
  'la terminada ya no cuenta días');

-- ============================================ 3. El tablero
select test.afirmar(
  (select t.semaforo = 'ROJO' and t.etapas = 6 and t.etapas_terminadas = 1 and t.etapas_vencidas = 1
          and t.etapas_por_vencer = 2 and t.etapas_sin_fecha = 1 and t.etapa_en_curso = 'Vencida ayer'
          and t.proxima_fecha = current_date - 2 and t.ot_numero is null and t.semaforo_entrega = 'SIN_FECHA'
     from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_A'),
  'el código A sale en rojo: 1 de 6 terminada, 1 vencida (ella y su subetapa cuentan una vez), 2 por vencer, 1 sin fecha, va en la empezada, y entra sin OT abierta');
select test.afirmar(
  (select t.semaforo = 'VERDE' and t.semaforo_entrega = 'VERDE' and t.ot_numero is not null and t.cliente = 'CLIENTE DE PRUEBA 460 S.A.C.'
          and t.fecha_entrega = public.sumar_dias_habiles(current_date, 20) and t.dias_habiles_entrega = 20
          and t.etapa_en_curso = 'Con holgura' and t.area_en_curso is not null
     from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_B'),
  'el código B sale en verde, con su OT, su cliente y la fecha de entrega de la OT a 20 días hábiles');
select test.afirmar(
  (select t.semaforo = 'AMBAR' and t.semaforo_entrega = 'AMBAR' and t.etapas = 0 and t.etapa_en_curso is null
     from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_C'),
  'el código C, sin etapas y con la entrega a un día hábil, sale en ámbar por su fecha de entrega');
select test.afirmar(
  (select t.semaforo = 'SIN_FECHA' and t.fecha_entrega is null
     from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_D'),
  'el código D, sin etapas ni fecha de entrega, sale sin fecha');
select test.afirmar(
  (select count(*) = count(distinct t.codigo) from public.tiempos_de_entrega_codigos() t),
  'cada código sale una sola vez');

select test.afirmar(
  (select count(*) = 1 and bool_and(t.codigo = 'CHK460_B') from public.tiempos_de_entrega_codigos('chk460_b') t),
  'pedido por código, el tablero da solo ese código');
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_codigos_calculado()$q$,
  'el cálculo del tablero, sin permiso adentro, está cerrado a la gente');
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_etapas_calculado('CHK460_A')$q$,
  'el cálculo de las etapas, sin permiso adentro, está cerrado a la gente');

-- Una actividad nace con su primer reporte diario: el código A no tiene ninguno.
select test.afirmar(
  (select count(*) = 0 from public.tiempos_de_entrega_actividades('chk460_a')),
  'RR. HH. entra a las actividades del código A, que todavía no tiene reportes');

-- Lo que el permiso NO abre: las tablas de Diseño siguen cerradas para RR. HH.
select test.afirmar(
  (select count(*) = 0 from public.codigo_etapas where codigo_interno like 'CHK460%'),
  'RR. HH. no lee la tabla de etapas directo: solo por la función');
select test.debe_fallar(
  $q$select * from public.codigo_interno_etapas('CHK460_A')$q$,
  'RR. HH. no entra a la función de Diseño, que también abre planos y materiales');
select test.debe_fallar(
  $q$update public.codigo_etapas set fin_plan = current_date + 30 where codigo_interno = 'CHK460_A'$q$,
  'RR. HH. no mueve las fechas de las etapas');
reset role;
select test.afirmar(
  (select fin_plan = current_date - 1 from public.codigo_etapas where codigo_interno = 'CHK460_A' and nombre = 'Vencida ayer'),
  'la fecha comprometida sigue como la puso Diseño');

-- ============================================ 4. Gerencia consulta
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) = 4 from public.tiempos_de_entrega_codigos() t where t.codigo like 'CHK460%'),
  'Gerencia ve los cuatro códigos de la prueba en el tablero');
reset role;

-- ============================================ 5. Quien no tiene el permiso no entra
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_codigos()$q$,
  'Almacén no ve el tablero', 'No tienes permiso para ver los tiempos de entrega');
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_etapas('CHK460_A')$q$,
  'Almacén no ve las etapas', 'No tienes permiso para ver los tiempos de entrega');
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_actividades('CHK460_A')$q$,
  'Almacén no ve las actividades', 'No tienes permiso para ver los tiempos de entrega');
reset role;

-- Diseño arma las etapas, pero el tablero no es suyo.
select pg_temp.como('diseno');
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_codigos()$q$,
  'Diseño no ve el tablero de RR. HH.', 'No tienes permiso para ver los tiempos de entrega');
reset role;

-- ============================================ 6. Una OT entregada sale del tablero
do $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'ENTREGADA' where descripcion in ('Check 460 · sin fecha', 'Check 460 · con holgura');
  perform set_config('session_replication_role', 'origin', true);
end $$;
select pg_temp.como('recursos_humanos');
set local role authenticated;
select test.afirmar(
  not exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_D'),
  'el código cuya OT ya se entregó, y sin etapas pendientes, sale del tablero');
select test.afirmar(
  not exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_B'),
  'el que ya se entregó sale del tablero aunque le quedaran etapas sin marcar');
select test.afirmar(
  exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK460_A'),
  'el que tiene etapas pendientes y ninguna OT sigue');
reset role;

rollback;
