-- Atender una avería (migración 20261126950000, Plan 16.3). Cada paso con su
-- cuenta y `set local role authenticated`: Mantenimiento la toma con su
-- diagnóstico, enlaza el RQ de los repuestos, la cierra con el trabajo hecho y
-- las horas parado, y el equipo vuelve a operativo; quien la reportó dice que no
-- quedó bien (vuelve a Mantenimiento y el equipo, a parado) y después confirma.
-- Quien no es de Mantenimiento no atiende ni cierra, Gerencia consulta, otra
-- área no ve nada, y nadie confirma por quien reportó. La bandeja va por
-- gravedad. Nada se borra. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA466', 'Taller prueba 466') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA466' \gset
select test.crear_usuario('Ada', 'Admin', 'admin466@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Manu', 'Mantenimiento', 'mnt466@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger466@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Jaime', 'Jefe', 'jefe466@demo.pe', 'SUPERVISOR', :'sede_id') as jefe_id \gset
select test.crear_usuario('Remo', 'Reporta', 'rep466@demo.pe', 'VENDEDOR', :'sede_id') as rep_id \gset
select test.crear_usuario('Ajo', 'Ajeno', 'ajeno466@demo.pe', 'VENDEDOR', :'sede_id') as ajeno_id \gset

-- El equipo es de Maestranza; su jefe trabaja ahí. Quien reporta es de Gerencia
-- Comercial y el ajeno, de Logística.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'jefe_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'GCO') where id = :'rep_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'LOG') where id = :'ajeno_id';

select set_config('prueba.mnt', :'mnt_id', true);
select set_config('prueba.ger', :'ger_id', true);
select set_config('prueba.jefe', :'jefe_id', true);
select set_config('prueba.rep', :'rep_id', true);
select set_config('prueba.ajeno', :'ajeno_id', true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

select test.como_usuario(:'mnt_id');
insert into public.equipos (codigo, descripcion, categoria_id, area_id, ubicacion, estado, estado_nota)
select v.codigo, v.descripcion, c.id, (select id from public.areas where codigo = 'MTZ'), 'Nave 3', v.estado, v.nota
  from (values ('AM-04-81', 'Amoladora de prueba 466 uno', 'OPERATIVO', null),
               ('AM-04-82', 'Amoladora de prueba 466 dos', 'CON_OBSERVACION', 'El cable está pelado.')) v(codigo, descripcion, estado, nota)
  cross join public.equipo_categorias c where c.prefijo = 'AM-04';
select set_config('prueba.e1', (select id::text from public.equipos where codigo = 'AM-04-81'), true);
select set_config('prueba.e2', (select id::text from public.equipos where codigo = 'AM-04-82'), true);

-- Dos RQ: uno vivo y uno anulado. Los registra Requerimientos; aquí, por debajo.
select test.como_usuario(:'admin_id');
select set_config('prueba.rq1', gen_random_uuid()::text, true);
select set_config('prueba.rq2', gen_random_uuid()::text, true);
insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
values (pg_temp.id('rq1'), 'RQ-CHK466-1', (select id from public.areas where codigo = 'MTZ'), 'PLANTA',
        'Carbones y rodamiento para la amoladora de prueba', :'admin_id');
insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por, estado, anulado_por, anulado_en, motivo_anulacion)
values (pg_temp.id('rq2'), 'RQ-CHK466-2', (select id from public.areas where codigo = 'MTZ'), 'PLANTA',
        'Pedido repetido de la prueba', :'admin_id', 'ANULADO', :'admin_id', now(), 'Se pidió dos veces lo mismo');

do $$ begin
  perform set_config('prueba.av' || n, gen_random_uuid()::text, true) from generate_series(1, 9) n;
  perform set_config('prueba.enlace' || n, gen_random_uuid()::text, true) from generate_series(1, 4) n;
end $$;

-- 0. Lo que la migración dejó --------------------------------------------------------
select test.afirmar(
  (select relrowsecurity from pg_class where oid = 'public.averia_pasos'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.averia_requerimientos'::regclass),
  'los pasos y los RQ enlazados tienen RLS');
select test.afirmar(
  not has_table_privilege('authenticated', 'public.averia_pasos', 'insert')
  and not has_table_privilege('authenticated', 'public.averia_requerimientos', 'insert')
  and not has_table_privilege('authenticated', 'public.averia_requerimientos', 'update')
  and not has_table_privilege('anon', 'public.averia_pasos', 'select')
  and not has_table_privilege('anon', 'public.averia_requerimientos', 'select'),
  'se escriben solo por sus funciones, y anon no los lee');
select test.afirmar(
  not has_function_privilege('anon', 'public.averias_atender(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.averias_cerrar(uuid, text, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.averias_confirmar(uuid, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.averias_soltar_el_equipo(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.averia_la_ve(uuid)', 'execute'),
  'anon no atiende ni confirma, y los ayudantes internos no se llaman desde fuera');

-- 1. Se reporta: detiene el trabajo y el equipo queda parado ---------------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av1'), pg_temp.id('e1'), 'AVERIA', true, false,
    'Se apaga sola a los cinco minutos de uso.', '[]');
  perform set_config('prueba.numero1', r.numero_averia, true);
  perform test.afirmar(r.equipo_parado, 'la avería que detiene deja el equipo parado');
  perform test.afirmar(
    (select paro_al_reportar and paro_el_equipo and gravedad = 2 and espera_de = 'MANTENIMIENTO' and dias_en_espera = 0 and es_mia
       from public.averias_visibles(pg_temp.id('av1'))),
    'la lista dice que la dejó parada, gravedad 2 (detiene), que espera a Mantenimiento desde hoy y que es suya');
end $$;

-- 2. Quien no es de Mantenimiento no la atiende -----------------------------------------
do $$ begin
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Le falla el interruptor de encendido.'')', current_setting('prueba.av1')),
    'quien la reportó no la atiende', 'la atiende Mantenimiento');
  perform test.debe_fallar(format('select * from public.averias_cerrar(%L, ''Se cambió el interruptor de encendido.'', 2)', current_setting('prueba.av1')),
    'ni la cierra', 'la atiende Mantenimiento');
  perform test.debe_fallar('select * from public.averias_rq_para_enlazar()',
    'ni lee los RQ para enlazar', 'la atiende Mantenimiento');
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, true, null)', current_setting('prueba.av1')),
    'y no confirma lo que no se cerró', 'todavía no lo atiende');
  perform test.debe_fallar(format('update public.averias set estado = ''EN_ATENCION'' where id = %L', current_setting('prueba.av1')),
    'por la tabla, tampoco', 'permission denied');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias_visibles(pg_temp.id('av1'))) = 1, 'Gerencia la ve');
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Le falla el interruptor de encendido.'')', current_setting('prueba.av1')),
    'pero no la atiende', 'la atiende Mantenimiento');
end $$;
reset role;
select test.como_usuario(:'jefe_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias_visibles(pg_temp.id('av1'))) = 1, 'el jefe del área la ve');
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Le falla el interruptor de encendido.'')', current_setting('prueba.av1')),
    'y tampoco la atiende', 'la atiende Mantenimiento');
end $$;
reset role;

-- 3. Mantenimiento la toma con su diagnóstico ----------------------------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.debe_fallar(format('select * from public.averias_cerrar(%L, ''Se cambió el interruptor de encendido.'', 2)', current_setting('prueba.av1')),
    'no se cierra sin diagnóstico', 'anota el diagnóstico');
  perform test.debe_fallar(format('select * from public.averias_enlazar_rq(%L, %L, %L, ''Interruptor'')',
      current_setting('prueba.enlace1'), current_setting('prueba.av1'), current_setting('prueba.rq1')),
    'ni se enlaza un RQ antes del diagnóstico', 'primero anota el diagnóstico');
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Falla'')', current_setting('prueba.av1')),
    'el diagnóstico dice algo', '10 a 2000');
  select * into r from public.averias_atender(pg_temp.id('av1'), 'Le falla el interruptor de encendido.');
  perform test.afirmar(r.estado = 'EN_ATENCION', 'la toma: queda en atención');
  select * into r from public.averias_atender(pg_temp.id('av1'), 'Le falla el interruptor de encendido.');
  perform test.afirmar(r.estado = 'EN_ATENCION', 'el mismo envío otra vez no hace nada nuevo');
  select * into r from public.averias_atender(pg_temp.id('av1'), 'Interruptor quemado y carbones gastados.');
  perform test.afirmar(
    (select diagnostico = 'Interruptor quemado y carbones gastados.' and atendio = 'Manu Mantenimiento'
            and espera_de = 'MANTENIMIENTO' and dias_en_espera = 0
       from public.averias_visibles(pg_temp.id('av1'))),
    'mientras la atiende corrige el diagnóstico; la lista dice quién la atiende');
end $$;
reset role;
select test.afirmar(
  (select count(*) = 1 from public.averia_pasos where averia_id = pg_temp.id('av1') and paso = 'ATENCION'
                                                  and hecho_por = pg_temp.id('mnt') and texto = 'Le falla el interruptor de encendido.'),
  'la atención queda anotada una vez, con quién y el primer diagnóstico');

-- 4. El RQ de los repuestos ------------------------------------------------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar(
    exists (select 1 from public.averias_rq_para_enlazar() where numero = 'RQ-CHK466-1' and estado = 'POR_ATENDER')
    and not exists (select 1 from public.averias_rq_para_enlazar() where numero = 'RQ-CHK466-2'),
    'Mantenimiento elige entre los RQ vivos, sin los anulados');
  perform test.afirmar((select count(*) from public.requerimientos where id = pg_temp.id('rq1')) = 0,
    'sin leer la tabla de RQ por su cuenta');
  perform test.debe_fallar(format('select * from public.averias_enlazar_rq(%L, %L, %L, ''Interruptor'')',
      current_setting('prueba.enlace1'), current_setting('prueba.av1'), current_setting('prueba.rq2')),
    'un RQ anulado no se enlaza', 'anulado');
  perform test.debe_fallar(format('select * from public.averias_enlazar_rq(%L, %L, %L, ''x'')',
      current_setting('prueba.enlace1'), current_setting('prueba.av1'), current_setting('prueba.rq1')),
    'el enlace dice qué repuesto', '3 a 300');
  select * into r from public.averias_enlazar_rq(pg_temp.id('enlace1'), pg_temp.id('av1'), pg_temp.id('rq1'), 'Interruptor y carbones');
  perform test.afirmar(r.numero_rq = 'RQ-CHK466-1', 'enlaza el RQ');
  select * into r from public.averias_enlazar_rq(pg_temp.id('enlace1'), pg_temp.id('av1'), pg_temp.id('rq1'), 'Interruptor y carbones');
  perform test.afirmar((select count(*) from public.averia_requerimientos where averia_id = pg_temp.id('av1')) = 1,
    'el mismo envío otra vez no lo enlaza dos veces');
  perform test.debe_fallar(format('select * from public.averias_enlazar_rq(%L, %L, %L, ''Otra vez'')',
      current_setting('prueba.enlace2'), current_setting('prueba.av1'), current_setting('prueba.rq1')),
    'otro envío con el mismo RQ dice que ya está', 'ya está enlazado');
  -- Quitado por error y enlazado de nuevo.
  select * into r from public.averias_quitar_rq(pg_temp.id('enlace1'));
  select * into r from public.averias_quitar_rq(pg_temp.id('enlace1'));
  perform test.afirmar((select count(*) from public.averias_rq_enlazados(array[pg_temp.id('av1')])) = 0,
    'quitado (dos veces, sin error), ya no se muestra');
  select * into r from public.averias_enlazar_rq(pg_temp.id('enlace2'), pg_temp.id('av1'), pg_temp.id('rq1'), 'Interruptor y carbones');
  perform test.afirmar((select count(*) from public.averia_requerimientos where averia_id = pg_temp.id('av1')) = 2
                       and (select rq_enlazados from public.averias_visibles(pg_temp.id('av1'))) = 1,
    'se enlaza de nuevo; el quitado queda, con quién y cuándo, y la lista cuenta uno');
end $$;
reset role;
select test.afirmar(
  (select quitado_por = pg_temp.id('mnt') and quitado_en is not null from public.averia_requerimientos where id = pg_temp.id('enlace1')),
  'el enlace quitado guarda quién lo quitó');

-- Quien reportó ve el RQ y cómo va, sin abrirlo; otra área no ve nada.
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select numero = 'RQ-CHK466-1' and estado = 'POR_ATENDER' and nota = 'Interruptor y carbones' and not puede_abrir
       from public.averias_rq_enlazados(array[pg_temp.id('av1')])),
    'quien la reportó ve el número del RQ y cómo va, sin pasar a la pantalla de RQ');
  perform test.afirmar((select count(*) from public.averia_requerimientos where quitado_en is null) = 1
                       and (select count(*) from public.averia_pasos) = 1,
    'y lee los enlaces y los pasos de su reporte');
end $$;
reset role;
select test.como_usuario(:'ajeno_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.averias_rq_enlazados(array[pg_temp.id('av1')])) = 0
                       and (select count(*) from public.averia_requerimientos) = 0
                       and (select count(*) from public.averia_pasos) = 0
                       and (select count(*) from public.recorrido_de_averias(array[pg_temp.id('av1')])) = 0,
    'otra área no ve ni los RQ, ni los pasos, ni el recorrido');
  perform test.debe_fallar(format('select * from public.averias_quitar_rq(%L)', current_setting('prueba.enlace2')),
    'ni quita un RQ', 'la atiende Mantenimiento');
end $$;
reset role;

-- 5. Mantenimiento la cierra: el equipo vuelve a operativo --------------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.debe_fallar(format('select * from public.averias_cerrar(%L, ''Se cambió el interruptor.'', -1)', current_setting('prueba.av1')),
    'las horas parado no son negativas', 'horas');
  perform test.debe_fallar(format('select * from public.averias_cerrar(%L, ''Listo'', 2)', current_setting('prueba.av1')),
    'el trabajo hecho dice algo', '10 a 2000');
  select * into r from public.averias_cerrar(pg_temp.id('av1'), 'Se cambió el interruptor y los carbones.', 26.5);
  perform test.afirmar(r.equipo_vuelve_a = 'OPERATIVO' and r.sigue_parado_por is null and r.avisada,
    'al cerrar, el equipo vuelve a operativo y se avisa a quien la reportó');
  select * into r from public.averias_cerrar(pg_temp.id('av1'), 'Se cambió el interruptor y los carbones.', 26.5);
  perform test.afirmar(r.averia = pg_temp.id('av1'), 'el mismo cierre otra vez no falla');
  perform test.afirmar(
    (select estado = 'CERRADA' and horas_parado = 26.5 and cerro = 'Manu Mantenimiento' and espera_de = 'QUIEN_REPORTO'
            and not paro_el_equipo and paro_al_reportar
       from public.averias_visibles(pg_temp.id('av1'))),
    'queda cerrada con sus horas, esperando a quien la reportó; ya no tiene el equipo parado, pero se sabe que lo paró');
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Otro diagnóstico para la cerrada.'')', current_setting('prueba.av1')),
    'cerrada, el diagnóstico ya no cambia', 'ya no se cambia');
  perform test.debe_fallar(format('select * from public.averias_enlazar_rq(%L, %L, %L, ''Otro repuesto'')',
      current_setting('prueba.enlace3'), current_setting('prueba.av1'), current_setting('prueba.rq1')),
    'ni se enlazan RQ', 'ya no está en atención');
  perform test.debe_fallar(format('select * from public.averias_quitar_rq(%L)', current_setting('prueba.enlace2')),
    'ni se quitan', 'ya no está en atención');
  perform test.debe_fallar(format('select * from public.averias_anular(%L, ''Mantenimiento la quiere anular después.'')', current_setting('prueba.av1')),
    'ni se anula: queda como evidencia', 'ya se cerró');
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, true, null)', current_setting('prueba.av1')),
    'Mantenimiento no confirma por quien la reportó', 'lo confirma quien reportó');
end $$;
reset role;
select test.afirmar(
  (select estado = 'OPERATIVO' and estado_nota is null from public.equipos where id = pg_temp.id('e1')),
  'el padrón dice operativo');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('rep')
                                                    and titulo like 'Mantenimiento cerró tu reporte AV-%: confirma si quedó bien'),
  'a quien la reportó le llega el aviso para confirmar');

select test.como_usuario(:'jefe_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, true, null)', current_setting('prueba.av1')),
    'el jefe del área no confirma por quien la reportó', 'lo confirma quien reportó');
end $$;
reset role;

-- 6. No quedó bien: vuelve a Mantenimiento y el equipo, a parado ---------------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar(
    (select espera_de = 'QUIEN_REPORTO' and dias_en_espera = 0 from public.averias_visibles(pg_temp.id('av1'))),
    'quien la reportó la ve esperándolo');
  perform test.debe_fallar(format('select * from public.averias_confirmar(%L, false, ''mal'')', current_setting('prueba.av1')),
    'para devolverla dice qué sigue fallando', 'qué sigue fallando');
  select * into r from public.averias_confirmar(pg_temp.id('av1'), false, 'Se volvió a apagar a la media hora.');
  perform test.afirmar(r.estado = 'EN_ATENCION' and r.equipo_parado and r.avisado_a = 'MANTENIMIENTO',
    'no quedó bien: vuelve a Mantenimiento (y le llega el aviso) y el equipo, a parado');
  select * into r from public.averias_confirmar(pg_temp.id('av1'), false, 'Se volvió a apagar a la media hora.');
  perform test.afirmar(r.estado = 'EN_ATENCION' and r.avisado_a = 'MANTENIMIENTO', 'el mismo envío otra vez no falla y dice lo mismo');
  perform test.afirmar(
    (select veces_reabierta = 1 and nota_de_quien_reporto = 'Se volvió a apagar a la media hora.' and diagnostico is not null
            and trabajo_hecho is null and horas_parado is null and espera_de = 'MANTENIMIENTO' and paro_el_equipo
       from public.averias_visibles(pg_temp.id('av1'))),
    'vuelve con lo que dijo, el diagnóstico de antes y sin el cierre (que queda en sus pasos)');
end $$;
reset role;
select test.afirmar(
  (select estado = 'PARADO' and estado_nota like 'Avería %: sigue fallando.%' from public.equipos where id = pg_temp.id('e1')),
  'el padrón lo dice parado, porque sigue fallando');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones where origen_id = pg_temp.id('av1') and usuario_id = pg_temp.id('mnt')
                                                    and titulo like 'No quedó bien: AV-%'),
  'a Mantenimiento le llega que no quedó bien');

-- 7. Se cierra otra vez y quien la reportó confirma ------------------------------------------
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_cerrar(pg_temp.id('av1'), 'Se cambió el relé térmico, que cortaba la corriente.', 3);
  perform test.afirmar(r.equipo_vuelve_a = 'OPERATIVO', 'el segundo cierre lo deja operativo otra vez');
end $$;
reset role;
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_confirmar(pg_temp.id('av1'), true, null);
  perform test.afirmar(r.estado = 'CONFIRMADA', 'quien la reportó confirma que quedó bien');
  select * into r from public.averias_confirmar(pg_temp.id('av1'), true, null);
  perform test.afirmar(r.estado = 'CONFIRMADA', 'y el mismo envío otra vez no falla');
  perform test.afirmar(
    (select string_agg(paso || ':' || situacion || coalesce(':' || detalle, ''), ' ' order by orden)
       from public.recorrido_de_averias(array[pg_temp.id('av1')]))
    = 'REPORTE:HECHO:PARADO ATENCION:HECHO CIERRE:HECHO:26.5|Se cambió el interruptor y los carbones. '
      || 'REAPERTURA:HECHO:Se volvió a apagar a la media hora. CIERRE:HECHO:3.0|Se cambió el relé térmico, que cortaba la corriente. CONFIRMACION:HECHO',
    'el recorrido cuenta todo, en orden: reportada, atendida, cerrada (26.5 h), no quedó bien (con lo que dijo), cerrada (3 h) y confirmada');
  perform test.afirmar(
    not exists (select 1 from public.recorrido_de_averias(array[pg_temp.id('av1')]) where puesto is null),
    'cada paso dice el puesto de quien lo hizo');
  perform test.afirmar(
    (select espera_de is null and dias_en_espera is null from public.averias_visibles(pg_temp.id('av1'))),
    'confirmada, ya no espera a nadie');
end $$;
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format('select * from public.averias_atender(%L, ''Diagnóstico tardío para la confirmada.'')', current_setting('prueba.av1')),
    'confirmada, ya no cambia', 'ya no se cambia');
end $$;
reset role;
select test.debe_fallar(format('update public.averias set horas_parado = 1 where id = %L', current_setting('prueba.av1')),
  'confirmada queda como evidencia, también por debajo', 'queda como evidencia');

-- 8. La bandeja va por gravedad ----------------------------------------------------------------
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_reportar(pg_temp.id('av2'), pg_temp.id('e2'), 'POSIBLE_AVERIA', false, false,
    'Hace un ruido raro al arrancar la amoladora.', '[]');
  select * into r from public.averias_reportar(pg_temp.id('av3'), pg_temp.id('e2'), 'AVERIA', true, true,
    'El cable pelado da corriente al tocar la carcasa.', '[]');
  select * into r from public.averias_reportar(pg_temp.id('av4'), pg_temp.id('e2'), 'AVERIA', false, true,
    'La guarda se suelta y puede salir volando.', '[]');
  select * into r from public.averias_reportar(pg_temp.id('av5'), pg_temp.id('e2'), 'AVERIA', false, false,
    'Se calienta más de lo normal al usarla.', '[]');
end $$;
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
select test.afirmar(
  (select array_agg(gravedad order by gravedad) from public.averias_visibles(null)
    where id in (pg_temp.id('av2'), pg_temp.id('av3'), pg_temp.id('av4'), pg_temp.id('av5')))
  = array[1, 3, 4, 5],
  'gravedad: detiene y es un riesgo (1), es un riesgo (3), avería (4), posible avería (5)');
reset role;

-- 9. El paro pasa al otro reporte que detiene el trabajo --------------------------------------
-- av3 dejó parado el equipo 2; av6 dice que también lo detiene. Al cerrar av3,
-- el equipo sigue parado por av6; al anular av6, vuelve a como estaba antes.
select test.como_usuario(:'rep_id');
set local role authenticated;
select * from public.averias_reportar(pg_temp.id('av6'), pg_temp.id('e2'), 'AVERIA', true, false,
  'Otra falla: el disco no gira aunque el motor suena.', '[]') \gset r6_
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform public.averias_atender(pg_temp.id('av3'), 'Cable de alimentación dañado y carcasa con fuga.');
  select * into r from public.averias_cerrar(pg_temp.id('av3'), 'Se cambió el cable de alimentación completo.', 4);
  perform test.afirmar(r.equipo_vuelve_a is null and r.sigue_parado_por = (select numero from public.averias where id = pg_temp.id('av6')),
    'cerrada una, el equipo sigue parado por la otra que detiene el trabajo, y lo dice');
  perform test.afirmar(
    (select paro_el_equipo from public.averias_visibles(pg_temp.id('av6'))) and not (select paro_el_equipo from public.averias_visibles(pg_temp.id('av3'))),
    'el paro pasó a la otra');
  -- La que se atiende también se anula; el equipo vuelve a como estaba antes del primer paro.
  perform public.averias_atender(pg_temp.id('av6'), 'El disco no gira por el eje trabado.');
  select * into r from public.averias_anular(pg_temp.id('av6'), 'Era la misma falla que el reporte anterior.');
  perform test.afirmar(r.equipo_vuelve_a = 'CON_OBSERVACION', 'anulada en atención, el equipo vuelve a como estaba antes');
end $$;
reset role;
select test.afirmar(
  (select estado = 'CON_OBSERVACION' and estado_nota = 'El cable está pelado.' from public.equipos where id = pg_temp.id('e2')),
  'con su nota de antes');
select test.afirmar(
  (select count(*) = 2 from public.averia_pasos where averia_id = pg_temp.id('av6') and paso in ('ATENCION', 'ANULACION')),
  'la anulación de la que se atendía queda en sus pasos');

-- 11. Los casos de borde que vio la auditoría ---------------------------------------------------
-- Otra persona de Mantenimiento corrige el diagnóstico: la ficha la nombra a ella.
-- Quien reportó ya no tiene cuenta activa: el cierre no dice «le avisamos».
-- Sin nadie de Mantenimiento activo, «no quedó bien» le llega a Gerencia.
-- El equipo que Mantenimiento paró a mano sigue parado al cerrar, y se dice.
select test.crear_usuario('Mara', 'Mantenimiento', 'mnt466b@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt2_id \gset
select set_config('prueba.mnt2', :'mnt2_id', true);
select test.como_usuario(:'mnt_id');
set local role authenticated;
select public.averias_atender(pg_temp.id('av4'), 'La guarda tiene los pernos sueltos.');
reset role;
select test.como_usuario(:'mnt2_id');
set local role authenticated;
do $$ begin
  perform public.averias_atender(pg_temp.id('av4'), 'La guarda tiene los pernos sueltos y la rosca barrida.');
  perform test.afirmar(
    (select atendio = 'Manu Mantenimiento' and diagnostico_de = 'Mara Mantenimiento' and diagnostico_en is not null
       from public.averias_visibles(pg_temp.id('av4'))),
    'el diagnóstico corregido lleva el nombre de quien lo corrigió; la atención, el de quien la tomó');
end $$;
reset role;
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = :'rep_id';
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_cerrar(pg_temp.id('av4'), 'Se cambiaron los pernos y se repasó la rosca.', 0);
  perform test.afirmar(not r.avisada, 'quien la reportó ya no tiene cuenta activa: el cierre no dice que le avisó');
end $$;
reset role;
select test.afirmar(
  not exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av4') and titulo like 'Mantenimiento cerró tu reporte%'),
  'y no le deja un aviso que nadie va a leer');
-- Vuelve la cuenta; Mantenimiento se queda sin nadie activo (también las cuentas que traiga la base).
select test.como_usuario(:'admin_id');
update public.usuarios set activo = true where id = :'rep_id';
create temp table mnt_activos as
  select u.id from public.usuarios u join public.roles ro on ro.id = u.rol_id where ro.codigo = 'MANTENIMIENTO' and u.activo;
update public.usuarios set activo = false where id in (select id from mnt_activos);
select test.como_usuario(:'rep_id');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.averias_confirmar(pg_temp.id('av4'), false, 'La guarda se volvió a soltar al usarla.');
  perform test.afirmar(r.estado = 'EN_ATENCION' and r.avisado_a = 'GERENCIA', 'sin Mantenimiento activo, «no quedó bien» le llega a Gerencia, y lo dice');
end $$;
reset role;
select test.afirmar(
  exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av4') and usuario_id = pg_temp.id('ger')
                                                and titulo like 'No quedó bien: %(no hay cuenta de Mantenimiento que la reciba)'),
  'a Gerencia le llega con el porqué');
select test.como_usuario(:'admin_id');
update public.usuarios set activo = true where id in (select id from mnt_activos);
-- El equipo 2 lo para Mantenimiento a mano; la avería av5 no lo detenía.
select test.como_usuario(:'mnt_id');
set local role authenticated;
update public.equipos set estado = 'PARADO', estado_nota = 'Parado para revisarlo entero.' where id = pg_temp.id('e2');
do $$
declare r record;
begin
  perform public.averias_atender(pg_temp.id('av5'), 'El motor recalienta por el ventilador sucio.');
  select * into r from public.averias_cerrar(pg_temp.id('av5'), 'Se limpió el ventilador y se cambiaron los carbones.', 1);
  perform test.afirmar(r.equipo_vuelve_a is null and r.sigue_parado_por is null and r.equipo_estado = 'PARADO',
    'el equipo que Mantenimiento paró a mano sigue parado al cerrar, y el cierre lo dice para que lo cambie en Equipos');
end $$;
reset role;

-- 12. El paro lo tiene otro reporte abierto: el cierre lo dice --------------------------------------
-- av7 detiene el trabajo en el equipo 1; av8, una posible avería del mismo
-- equipo, se cierra: el equipo sigue parado por av7, y el cierre dice cuál.
select test.como_usuario(:'rep_id');
set local role authenticated;
select * from public.averias_reportar(pg_temp.id('av7'), pg_temp.id('e1'), 'AVERIA', true, false,
  'Otra vez se apaga sola, ahora al encenderla.', '[]') \gset r7_
select * from public.averias_reportar(pg_temp.id('av8'), pg_temp.id('e1'), 'POSIBLE_AVERIA', false, false,
  'El cable hace un chasquido al moverlo.', '[]') \gset r8_
reset role;
select test.como_usuario(:'mnt_id');
set local role authenticated;
do $$
declare r record;
begin
  perform public.averias_atender(pg_temp.id('av8'), 'Prensacable flojo en la entrada del cable.');
  select * into r from public.averias_cerrar(pg_temp.id('av8'), 'Se ajustó el prensacable de la entrada.', 0);
  perform test.afirmar(r.equipo_vuelve_a is null and r.sigue_parado_por = (select numero from public.averias where id = pg_temp.id('av7')),
    'cerrada la que no tenía el paro, dice qué otro reporte abierto tiene el equipo parado');
  perform public.averias_anular(pg_temp.id('av7'), 'Prueba: se reportó para ver el cierre de la otra.');
end $$;
reset role;

-- 13. Mantenimiento devuelve la suya: vuelve a su bandeja, sin alarmar a Gerencia ------------------
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id in (select id from mnt_activos) or id = :'mnt2_id';
update public.usuarios set activo = true where id = :'mnt_id';
select test.como_usuario(:'mnt_id');
set local role authenticated;
select * from public.averias_reportar(pg_temp.id('av9'), pg_temp.id('e1'), 'POSIBLE_AVERIA', false, false,
  'Vibra un poco más de lo normal al cortar.', '[]') \gset r9_
do $$
declare r record;
begin
  perform public.averias_atender(pg_temp.id('av9'), 'Disco desbalanceado por el desgaste.');
  perform public.averias_cerrar(pg_temp.id('av9'), 'Se cambió el disco por uno nuevo.', 0);
  select * into r from public.averias_confirmar(pg_temp.id('av9'), false, 'Sigue vibrando con el disco nuevo.');
  perform test.afirmar(r.estado = 'EN_ATENCION' and r.avisado_a = 'SU_BANDEJA', 'la de Mantenimiento que no quedó bien vuelve a su bandeja');
  select * into r from public.averias_confirmar(pg_temp.id('av9'), false, 'Sigue vibrando con el disco nuevo.');
  perform test.afirmar(r.avisado_a = 'SU_BANDEJA', 'y el mismo envío dice lo mismo');
end $$;
reset role;
select test.afirmar(
  not exists (select 1 from public.notificaciones where origen_id = pg_temp.id('av9') and titulo like '%no hay cuenta de Mantenimiento%'),
  'sin avisarle a Gerencia que falta Mantenimiento');
select test.como_usuario(:'admin_id');
update public.usuarios set activo = true where id in (select id from mnt_activos) or id = :'mnt2_id';

-- 10. Nadie borra ni corrige por debajo ----------------------------------------------------------
select test.como_usuario(:'admin_id');
select test.debe_fallar(format('update public.averias set estado = ''CONFIRMADA'' where id = %L', current_setting('prueba.av2')),
  'no se salta pasos', 'no pasa a');
select test.debe_fallar(format('update public.averias set diagnostico = ''Diagnóstico sin atenderla.'' where id = %L', current_setting('prueba.av2')),
  'ni se pone diagnóstico sin atenderla', 'no se cambia así');
select test.debe_fallar('delete from public.averia_pasos', 'los pasos no se borran', 'quedan como evidencia');
select test.debe_fallar('update public.averia_pasos set texto = ''Otro''', 'ni se corrigen', 'quedan como evidencia');
select test.debe_fallar('delete from public.averia_requerimientos', 'un enlace no se borra', 'no se borra');
select test.debe_fallar(format('update public.averia_requerimientos set nota = ''Otra'' where id = %L', current_setting('prueba.enlace2')),
  'ni se corrige', 'no se corrige');

rollback;
