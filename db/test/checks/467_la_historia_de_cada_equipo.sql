-- La historia de cada equipo (migración 20261126995000, Plan 16.4). Cada paso con
-- su cuenta y `set local role authenticated`: las cifras de cada equipo
-- (averías sin las anuladas, repetidas, «no quedó bien», horas parado, lo de
-- los últimos 90 días y el reporte que lo tiene parado hoy) para quien ve el
-- padrón, y nada para quien no lo ve. Y lo que DKS decidió: si quien reportó ya
-- no tiene cuenta, la confirma el responsable del área o Mantenimiento; Gerencia
-- y los demás, no. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA467', 'Taller prueba 467') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA467' \gset
select test.crear_usuario('Ada', 'Admin', 'admin467@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Manu', 'Mantenimiento', 'mnt467@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger467@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Alma', 'Almacén', 'alm467@demo.pe', 'ALMACENERO', :'sede_id') as alm_id \gset
select test.crear_usuario('Jaime', 'Jefe', 'jefe467@demo.pe', 'SUPERVISOR', :'sede_id') as jefe_id \gset
select test.crear_usuario('Remo', 'Reporta', 'rep467@demo.pe', 'VENDEDOR', :'sede_id') as rep_id \gset
select test.crear_usuario('Rita', 'Reporta', 'rep2467@demo.pe', 'VENDEDOR', :'sede_id') as rep2_id \gset
select test.crear_usuario('Ajo', 'Ajeno', 'ajeno467@demo.pe', 'VENDEDOR', :'sede_id') as ajeno_id \gset

-- Los equipos 1, 2 y 4 son de Maestranza, que tiene responsable (Jaime); el 3, de
-- Logística, sin responsable. Quien reporta es de Gerencia Comercial; el ajeno, de Logística.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'jefe_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'GCO') where id in (:'rep_id', :'rep2_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'LOG') where id = :'ajeno_id';
update public.areas set jefe_id = :'jefe_id' where codigo = 'MTZ';
update public.areas set jefe_id = null where codigo = 'LOG';

select set_config('prueba.mnt', :'mnt_id', true);
select set_config('prueba.ger', :'ger_id', true);
select set_config('prueba.jefe', :'jefe_id', true);
select set_config('prueba.rep', :'rep_id', true);
select set_config('prueba.rep2', :'rep2_id', true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

select test.como_usuario(:'mnt_id');
insert into public.equipos (codigo, descripcion, categoria_id, area_id, ubicacion, estado)
select v.codigo, v.descripcion, c.id, (select id from public.areas where codigo = v.area), 'Nave 3', 'OPERATIVO'
  from (values ('AM-04-71', 'Amoladora de prueba 467 uno', 'MTZ'),
               ('AM-04-72', 'Amoladora de prueba 467 dos', 'MTZ'),
               ('AM-04-73', 'Amoladora de prueba 467 tres', 'LOG'),
               ('AM-04-74', 'Amoladora de prueba 467 cuatro', 'MTZ')) v(codigo, descripcion, area)
  cross join public.equipo_categorias c where c.prefijo = 'AM-04';
do $$ begin
  perform set_config('prueba.e' || n, (select id::text from public.equipos where codigo = 'AM-04-7' || n), true) from generate_series(1, 4) n;
  perform set_config('prueba.av' || n, gen_random_uuid()::text, true) from generate_series(1, 7) n;
end $$;

-- 0. Lo que la migración dejó --------------------------------------------------------
select test.afirmar(
  not has_function_privilege('authenticated', 'public.averias_puede_confirmar(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.averia_que_repite(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.equipos_historia(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.equipos_historia(uuid)', 'execute'),
  'los ayudantes no se llaman desde fuera; la historia, solo con cuenta');

-- Ayudantes del check: reportar, atender, cerrar y confirmar con la cuenta de cada uno.
create or replace function pg_temp.reportar(p_av text, p_eq text, p_quien text, p_detiene boolean) returns void language plpgsql as $$
begin
  perform test.como_usuario(pg_temp.id(p_quien));
  set local role authenticated;
  perform public.averias_reportar(pg_temp.id(p_av), pg_temp.id(p_eq), 'AVERIA', p_detiene, false, 'Se apaga sola a los cinco minutos de uso.', '[]');
  reset role;
end $$;
create or replace function pg_temp.atender_y_cerrar(p_av text, p_horas numeric) returns record language plpgsql as $$
declare r record;
begin
  perform test.como_usuario(pg_temp.id('mnt'));
  set local role authenticated;
  if (select estado from public.averias_visibles(pg_temp.id(p_av))) = 'REPORTADA' then
    perform public.averias_atender(pg_temp.id(p_av), 'El interruptor de encendido está gastado.');
  end if;
  select * into r from public.averias_cerrar(pg_temp.id(p_av), 'Se cambió el interruptor de encendido.', p_horas);
  reset role;
  return r;
end $$;

-- 1. La primera avería del equipo 1: se cierra con 5 horas y queda bien ---------------------------
select pg_temp.reportar('av1', 'e1', 'rep', true);
select pg_temp.atender_y_cerrar('av1', 5) ;
select test.como_usuario(:'rep_id');
set local role authenticated;
select public.averias_confirmar(pg_temp.id('av1'), true, null);
reset role;
-- Todo el check corre en una transacción, con un solo «ahora»: la primera avería
-- se corre diez días atrás, como si se hubiera reportado y cerrado antes.
set local session_replication_role = replica;
update public.averias set creado_en = creado_en - interval '11 days' where id = pg_temp.id('av1');
update public.averia_pasos set hecho_en = hecho_en - interval '10 days' where averia_id = pg_temp.id('av1');
set local session_replication_role = origin;

-- 2. Vuelve a fallar antes de 30 días: es repetida --------------------------------------------
select pg_temp.reportar('av2', 'e1', 'rep', true);
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select repite_a = (select numero from public.averias_visibles(pg_temp.id('av1'))) from public.averias_visibles(pg_temp.id('av2'))),
    'la lista dice qué avería repite');
  perform test.afirmar((select repite_a is null from public.averias_visibles(pg_temp.id('av1'))), 'la primera no repite a nadie');
end $$;
reset role;
select pg_temp.atender_y_cerrar('av2', 3);
-- No quedó bien, y se vuelve a cerrar con 2 horas más.
select test.como_usuario(:'rep_id');
set local role authenticated;
select public.averias_confirmar(pg_temp.id('av2'), false, 'Se volvió a apagar a la media hora.');
reset role;
select pg_temp.atender_y_cerrar('av2', 2);

-- 3. Quien la reportó se va: la confirma el responsable del área o Mantenimiento ----------------
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = :'rep_id';
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select not puede_confirmar and not reporto_activo from public.averias_visibles(pg_temp.id('av2'))),
    'Gerencia la ve, sabe que quien la reportó ya no tiene cuenta, y no le toca confirmarla');
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, true, null)', current_setting('prueba.av2')),
    'Gerencia no la confirma', 'el responsable del área o Mantenimiento');
end $$;
reset role;
select test.como_usuario(:'ajeno_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias_visibles(pg_temp.id('av2'))) = 0, 'otra área no la ve');
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, true, null)', current_setting('prueba.av2')),
    'ni la confirma', 'el responsable del área o Mantenimiento');
end $$;
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare v text;
begin
  perform test.afirmar((select puede_confirmar from public.averias_visibles(pg_temp.id('av2'))), 'a Mantenimiento le toca');
  select string_agg(paso || ':' || situacion || ':' || coalesce(puesto, '-') || ':' || coalesce(detalle, '-'), ' ' order by orden) into v
    from public.recorrido_de_averias(array[pg_temp.id('av2')]) where situacion = 'AHORA';
  perform test.afirmar(v = 'CONFIRMACION:AHORA:Responsable del área o Mantenimiento:SIN_CUENTA',
    'el recorrido dice quién la confirma ahora: ' || coalesce(v, 'nada'));
end $$;
reset role;
select test.como_usuario(:'jefe_id');
set local role authenticated;
do $$
declare r record; v text;
begin
  perform test.afirmar((select puede_confirmar from public.averias_visibles(pg_temp.id('av2'))), 'y al responsable del área también');
  select * into r from public.averias_confirmar(pg_temp.id('av2'), true, 'Lo probé yo: arranca y no se apaga.');
  perform test.afirmar(r.estado = 'CONFIRMADA', 'el responsable del área la confirma');
  perform test.afirmar((select confirmo_en_lugar = 'Jaime Jefe' and not puede_confirmar from public.averias_visibles(pg_temp.id('av2'))),
    'la lista dice quién la confirmó en lugar de quien la reportó');
  select string_agg(paso || ':' || coalesce(detalle, '-'), ' ' order by orden) into v
    from public.recorrido_de_averias(array[pg_temp.id('av2')]) where paso = 'CONFIRMACION';
  perform test.afirmar(v = 'CONFIRMACION:EN_LUGAR', 'y el recorrido, que fue en su lugar: ' || coalesce(v, 'nada'));
end $$;
reset role;

-- 4. Al cerrar sin la cuenta de quien reportó: se le avisa al responsable, o confirma Mantenimiento --
select pg_temp.reportar('av3', 'e2', 'rep2', false);
select pg_temp.reportar('av4', 'e3', 'rep2', false);
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = :'rep2_id';
do $$
declare r record;
begin
  select * into r from pg_temp.atender_y_cerrar('av3', 1) as t(averia uuid, equipo_vuelve_a text, sigue_parado_por text, avisada boolean, equipo_estado text, confirma text);
  perform test.afirmar(not r.avisada and r.confirma = 'RESPONSABLE', 'con responsable en el área, el cierre dice que lo confirma él');
  select * into r from pg_temp.atender_y_cerrar('av4', 1) as t(averia uuid, equipo_vuelve_a text, sigue_parado_por text, avisada boolean, equipo_estado text, confirma text);
  perform test.afirmar(not r.avisada and r.confirma = 'MANTENIMIENTO', 'sin responsable, que lo confirma Mantenimiento');
end $$;
select test.afirmar(
  exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av3') and usuario_id = pg_temp.id('jefe')
                                                and titulo like 'Mantenimiento cerró el reporte % de tu área: quien lo reportó ya no tiene cuenta%'),
  'al responsable le llega el aviso para confirmar');
select test.afirmar(
  not exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av4') and titulo like 'Mantenimiento cerró%'),
  'sin responsable no se avisa a nadie: está en la bandeja de Mantenimiento');
-- Mantenimiento la prueba y no quedó bien: vuelve a su bandeja.
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_confirmar(pg_temp.id('av4'), false, 'Al probarla se volvió a apagar sola.');
  perform test.afirmar(r.estado = 'EN_ATENCION' and r.avisado_a in ('SU_BANDEJA', 'MANTENIMIENTO'), 'Mantenimiento la devuelve: vuelve a la bandeja de Mantenimiento');
  perform test.afirmar((select devolvio_en_lugar = 'Manu Mantenimiento' from public.averias_visibles(pg_temp.id('av4'))),
    'y la lista dice quién la devolvió en lugar de quien la reportó');
end $$;
reset role;

-- 5. Un reporte anulado no cuenta; uno abierto deja el equipo parado hoy ---------------------
select test.como_usuario(:'admin_id');
update public.usuarios set activo = true where id in (:'rep_id', :'rep2_id');
select pg_temp.reportar('av5', 'e1', 'rep', false);
select test.como_usuario(:'mnt_id');
set local role authenticated;
select public.averias_anular(pg_temp.id('av5'), 'Es la misma falla del reporte anterior.');
reset role;
select pg_temp.reportar('av6', 'e2', 'rep', true);

-- 6. Una avería de hace cuatro meses: cuenta en el total, no en los últimos 90 días ------------
select pg_temp.reportar('av7', 'e4', 'rep', false);
select pg_temp.atender_y_cerrar('av7', 1.5);
set local session_replication_role = replica;
update public.averias set creado_en = creado_en - interval '120 days' where id = pg_temp.id('av7');
update public.averia_pasos set hecho_en = hecho_en - interval '120 days' where averia_id = pg_temp.id('av7');
set local session_replication_role = origin;

-- 7. La historia, con los ojos de cada quien --------------------------------------------------
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$
declare h record;
begin
  select * into h from public.equipos_historia(pg_temp.id('e1'));
  perform test.afirmar(h.averias = 2 and h.averias_90 = 2, 'equipo 1: dos averías, sin la anulada: ' || h.averias);
  perform test.afirmar(h.repetidas = 1 and h.repetidas_90 = 1, 'una repetida');
  perform test.afirmar(h.no_quedo_bien = 1, 'una vez no quedó bien');
  perform test.afirmar(h.horas_parado = 10 and h.horas_parado_90 = 10, 'horas parado: 5 + 3 + 2, también el cierre que no quedó bien: ' || h.horas_parado);
  perform test.afirmar(h.abiertas = 0 and h.parado_por is null and h.parado_desde is null, 'nada abierto ni parado');

  select * into h from public.equipos_historia(pg_temp.id('e2'));
  perform test.afirmar(h.averias = 2 and h.abiertas = 2, 'equipo 2: dos averías abiertas (una por confirmar y una por atender)');
  perform test.afirmar(h.parado_por = (select numero from public.averias_visibles(pg_temp.id('av6'))) and h.parado_desde is not null,
    'parado hoy por el reporte que detiene el trabajo, y desde cuándo');

  select * into h from public.equipos_historia(pg_temp.id('e4'));
  perform test.afirmar(h.averias = 1 and h.averias_90 = 0 and h.horas_parado = 1.5 and h.horas_parado_90 = 0,
    'equipo 4: la de hace cuatro meses cuenta en el total, no en los últimos 90 días');

  perform test.afirmar((select count(*) from public.equipos_historia(null) where equipo_id in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('e3'), pg_temp.id('e4'))) = 4,
    'sin equipo, trae todos los del padrón');
end $$;
reset role;
-- Almacén ve el padrón: ve las mismas cifras, aunque no vea los reportes.
select test.como_usuario(:'alm_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select averias = 2 and horas_parado = 10 from public.equipos_historia(pg_temp.id('e1'))), 'Almacén ve las cifras del equipo');
  perform test.afirmar((select count(*) from public.averias_visibles(pg_temp.id('av1'))) = 0, 'pero no lo que dice cada reporte de otra área');
end $$;
reset role;
-- Quien no ve el padrón no ve la historia.
select test.como_usuario(:'ajeno_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format('select * from public.equipos_historia(%L)', current_setting('prueba.e1')),
    'quien no ve el padrón no ve la historia', 'quien ve el padrón');
end $$;
reset role;

rollback;
