-- La fecha de entrega al cliente también avisa, y el código cuya única OT está
-- anulada sale del tablero (migración 20261126520000, DKS 2026-11-26). La
-- revisión se corre sin sesión, como pg_cron; los avisos y el tablero se leen
-- con la cuenta de cada puesto y `set local role authenticated` —nunca ADMIN—.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Que solo cuenten los avisos de esta prueba.
delete from public.notificaciones;

do $$
declare v text; v_id uuid; v_cli uuid; v_uni uuid; v_sede uuid := (select id from public.sedes order by creado_en limit 1);
        v_prd uuid := (select id from public.areas where codigo = 'PRD'); v_ot uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'GERENTE:GGE', 'SUPERVISOR:PRD', 'TESORERIA:TES', 'DISENO:DIS'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.477@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 477', lower(replace(v, ':', '.')) || '.477@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999477011', 'CLIENTE DE PRUEBA 477 S.A.C.') returning id into v_cli;

  -- V: la entrega venció ayer. P: vence en 2 días hábiles. H: con holgura.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_V', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · vencida', current_date - 1) returning id into v_ot;
  perform set_config('prueba.ot_v', v_ot::text, true);
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_P', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · por vencer', public.sumar_dias_habiles(current_date, 2));
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_H', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · con holgura', public.sumar_dias_habiles(current_date, 10));

  -- T: vencida, pero la OT es de un lote de prueba: no avisa.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_T', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · de la prueba', current_date - 1) returning id into v_ot;
  insert into public.pruebas_lotes (id, motivo) values ('47700000-0000-4000-8000-00000000a0a0', 'Check 477');
  insert into public.pruebas_filas (lote_id, tabla, fila_id) values ('47700000-0000-4000-8000-00000000a0a0', 'ordenes_trabajo', v_ot);

  -- X: su única OT está anulada, con una etapa vencida. Y: una OT anulada y otra
  -- viva, con una etapa vencida. Z: una etapa vencida y todavía sin OT.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_X', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · anulada sola', current_date - 1);
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK477_Y', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
  values (v_cli, v_uni, true, v_sede, 'Check 477 · anulada con otra', current_date - 1),
         (v_cli, v_uni, true, v_sede, 'Check 477 · la otra', public.sumar_dias_habiles(current_date, 10));
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Check 477'
   where descripcion in ('Check 477 · anulada sola', 'Check 477 · anulada con otra');
  perform set_config('session_replication_role', 'origin', true);

  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, creado_por)
  select x.codigo, 1, 'Armado', v_prd, current_date - 2, current_date - 5, current_setting('prueba.diseno')::uuid
    from unnest(array['CHK477_X', 'CHK477_Y', 'CHK477_Z']) x(codigo);

  -- El día de la revisión: el laborable de hoy o el siguiente, que no sea lunes.
  perform set_config('prueba.hoy', (
    select min(d)::text from generate_series(current_date::timestamp, current_date + 14, interval '1 day') d
     where public.es_laborable(d::date) and extract(isodow from d::date) <> 1), true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Los avisos de entrega que lee una cuenta, con su propia sesión.
create or replace function pg_temp.entregas_de(p_clave text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como(p_clave);
  set local role authenticated;
  select string_agg(n.titulo || ' → ' || n.ruta, ' | ' order by n.titulo) into v
    from public.notificaciones n where n.titulo like '%ntrega%CHK477%' or n.titulo like '%entregas';
  reset role;
  return coalesce(v, '');
end $$;

-- ============================================ 1. La primera revisión
select set_config('prueba.r1', (
  select string_agg(r.tipo || '=' || r.avisos, ',' order by r.tipo)
    from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r where r.tipo like 'ENTREGA%'), true);
select test.afirmar(current_setting('prueba.r1') = 'ENTREGA_POR_VENCER=1,ENTREGA_RECORDATORIO=0,ENTREGA_VENCIDA=1',
  'avisa la entrega por vencer y la vencida; ni la de holgura, ni la del lote de prueba, ni la de la OT anulada (' || current_setting('prueba.r1') || ')');

select test.afirmar(
  pg_temp.entregas_de('recursos_humanos') =
    'Entrega por vencer: CHK477_P → /rrhh/tiempos-de-entrega/codigo?codigo=CHK477_P | Entrega vencida: CHK477_V → /rrhh/tiempos-de-entrega/codigo?codigo=CHK477_V',
  'RR. HH. recibe las dos, con el detalle del código');
select test.afirmar(
  pg_temp.entregas_de('gerente') = 'Entrega vencida: CHK477_V → /rrhh/tiempos-de-entrega/codigo?codigo=CHK477_V',
  'Gerencia recibe solo la vencida');
select test.afirmar(pg_temp.entregas_de('supervisor') = '' and pg_temp.entregas_de('tesoreria') = '' and pg_temp.entregas_de('diseno') = '',
  'el supervisor, Tesorería y Diseño no reciben avisos de la entrega al cliente');
select test.afirmar(
  exists (select 1 from public.notificaciones n join public.ordenes_trabajo o on o.id = current_setting('prueba.ot_v')::uuid
           where n.titulo = 'Entrega vencida: CHK477_V'
             and n.cuerpo = 'La entrega a CLIENTE DE PRUEBA 477 S.A.C. (OT ' || o.numero || ') venció el '
                            || to_char(current_date - 1, 'DD/MM/YYYY') || ' y la unidad no se ha entregado.'
             and n.origen_tabla = 'ordenes_trabajo' and n.origen_id = o.id),
  'el aviso dice el cliente, la OT y la fecha, y apunta a la OT');
select test.afirmar(
  exists (select 1 from public.notificaciones n where n.titulo = 'Entrega por vencer: CHK477_P'
             and n.cuerpo like 'La entrega a CLIENTE DE PRUEBA 477 S.A.C. (OT %) es %'),
  'el de por vencer dice cuándo es');

-- ============================================ 2. No repite; recuerda cada 2 días hábiles
select set_config('prueba.r2', (select sum(r.avisos)::text from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r where r.tipo like 'ENTREGA%'), true);
select test.afirmar(current_setting('prueba.r2') = '0', 'correrla otra vez el mismo día no repite');
select set_config('prueba.r3', (select r.avisos::text from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 1)) r where r.tipo = 'ENTREGA_RECORDATORIO'), true);
select test.afirmar(current_setting('prueba.r3') = '0', 'al día hábil siguiente todavía no toca recordar');
select set_config('prueba.r4', (select r.avisos::text from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r where r.tipo = 'ENTREGA_RECORDATORIO'), true);
select test.afirmar(current_setting('prueba.r4') = '1', 'a los 2 días hábiles se recuerda la entrega que sigue vencida');
select test.afirmar(
  (select count(*) = 1 and bool_and(n.ruta = '/rrhh/tiempos-de-entrega?ver=vencidos' and n.cuerpo like 'La entrega al cliente de CHK477_V sigue vencida.%')
     from public.notificaciones n where n.titulo = 'Sigue vencida la entrega: CHK477_V'
      and n.usuario_id = current_setting('prueba.recursos_humanos')::uuid)
  and not exists (select 1 from public.notificaciones n where n.titulo like 'Sigue vencida la entrega%'
      and n.usuario_id = current_setting('prueba.gerente')::uuid),
  'el recordatorio le llega a RR. HH. con el tablero en «Vencidos», y no a Gerencia');

-- Si cambia la fecha comprometida y vuelve a vencer, avisa de nuevo.
do $$ begin
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set fecha_entrega_comprometida = current_date - 2 where id = current_setting('prueba.ot_v')::uuid;
  perform set_config('session_replication_role', 'origin', true);
end $$;
select set_config('prueba.r5', (select r.avisos::text from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r where r.tipo = 'ENTREGA_VENCIDA'), true);
select test.afirmar(current_setting('prueba.r5') = '1', 'con la fecha comprometida cambiada, la entrega vencida avisa de nuevo');

-- ============================================ 3. La OT anulada sale del tablero
select pg_temp.como('recursos_humanos');
set local role authenticated;
select test.afirmar(
  not exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK477_X'),
  'el código cuya única OT está anulada sale del tablero, aunque le quede una etapa vencida');
select test.afirmar(
  exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK477_Y' and t.fecha_entrega = public.sumar_dias_habiles(current_date, 10)),
  'el que tiene una OT anulada y otra viva sigue, con la fecha de la viva');
select test.afirmar(
  exists (select 1 from public.tiempos_de_entrega_codigos() t where t.codigo = 'CHK477_Z'),
  'el que tiene etapas y todavía no tiene OT sigue');
reset role;
select test.afirmar(
  not exists (select 1 from public.notificaciones n where n.titulo like '%CHK477_X%')
  and exists (select 1 from public.notificaciones n where n.titulo = 'Vencida: CHK477_Y · Armado')
  and exists (select 1 from public.notificaciones n where n.titulo = 'Vencida: CHK477_Z · Armado'),
  'la etapa del código anulado no avisa; las de los otros dos, sí');
select test.afirmar(
  not exists (select 1 from public.notificaciones n where n.titulo like '%CHK477_T%' or n.titulo like '%CHK477_H%'),
  'ni la OT del lote de prueba ni la de holgura avisan');

-- ============================================ 4. Nadie anota a mano un aviso de entrega
select pg_temp.como('recursos_humanos');
set local role authenticated;
select test.debe_fallar($q$select * from public.revisar_entregas_al_cliente(current_date)$q$,
  'la revisión de entregas está cerrada a la gente, también a RR. HH.');
select test.debe_fallar($q$insert into public.tiempos_entrega_avisos (codigo, tipo, fin_plan, fecha) values ('CHK477_V', 'ENTREGA_VENCIDA', current_date, current_date)$q$,
  'nadie anota avisos de entrega a mano');
reset role;

rollback;
