-- La OT que se pausa o se reanuda avisa a la supervisión del taller
-- (migración 20261126338000; DKS eligió «Avisar a los supervisores», 2026-11-26).
--
--   1. Administración pausa la OT con su motivo: le llega un aviso a la
--      supervisión de cada área con una etapa abierta en el código (Maestranza
--      y Acabados), con el motivo, quién pausó y que el código ya no le pide el
--      reporte. No a la de Producción, cuya etapa ya terminó, ni a quien pausó.
--   2. Al reanudar, otro aviso a los mismos, que dice que vuelve a pedirlo.
--   3. Con otra OT abierta en el código, el aviso no dice que deja de pedir el
--      reporte: lo sigue pidiendo.
--   4. Lo que no es pausar ni reanudar no avisa (cambiar la descripción).
--   5. La OT sin código interno no avisa a nadie.
--   6. La función del disparador no la ejecuta authenticated.
--
-- Cada escritura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA496', 'Taller prueba del aviso de pausa') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:ADM:adm', 'SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR:ACB:sup_acb', 'SUPERVISOR:PRD:sup_prd'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 3), 'Apellido496', split_part(v, ':', 3) || '.496@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA496'));
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
    perform set_config('prueba.area_' || split_part(v, ':', 3), split_part(v, ':', 2), true);
  end loop;
end $$;

set local session_replication_role = replica;
update public.usuarios u set area_id = a.id
  from public.areas a
 where u.correo like '%.496@prueba.local'
   and a.codigo = current_setting('prueba.area_' || split_part(u.correo, '.496@', 1));

-- QA496-A: una OT en proceso; etapas abiertas de Maestranza y Acabados, la de Producción terminada.
-- QA496-B: dos OT, una en proceso y otra programada; etapa abierta de Maestranza.
-- QA496-SIN: OT en proceso sin unidad ni código.
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por, de_area)
select x.codigo, x.orden, x.nombre, a.id, current_date - 6, current_date + 4, current_date - 5, x.fin_real,
       current_setting('prueba.sup_mtz')::uuid, true
  from (values ('QA496-A', 1, 'Armado (prueba 496)', 'MTZ', null::date),
               ('QA496-A', 2, 'Pintura (prueba 496)', 'ACB', null::date),
               ('QA496-A', 3, 'Corte (prueba 496)', 'PRD', current_date - 1),
               ('QA496-B', 1, 'Chasis (prueba 496)', 'MTZ', null::date)) x(codigo, orden, nombre, area, fin_real)
  join public.areas a on a.codigo = x.area;
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20999496011', 'CLIENTE DE PRUEBA 496 S.A.C.');
insert into public.unidades (cliente_id, codigo_interno, marca)
select c.id, x.codigo, 'Prueba'
  from public.clientes c, (values ('QA496-A'), ('QA496-B')) x(codigo)
 where c.numero_documento = '20999496011';
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, descripcion, estado, fecha_inicio_real, fecha_entrega_comprometida)
select x.numero, c.id, u.id, (select id from public.sedes where codigo = 'QA496'), 'Check 496 · ' || x.numero,
       x.estado::public.estado_ot, current_date - 3, current_date + x.entrega
  from public.clientes c
  cross join (values ('QA496-A', 'QA496-A1', 'EN_PROCESO', 5),
                     ('QA496-B', 'QA496-B1', 'EN_PROCESO', 5),
                     ('QA496-B', 'QA496-B2', 'PROGRAMADA', 9),
                     (null, 'QA496-SIN1', 'EN_PROCESO', 5)) x(codigo, numero, estado, entrega)
  left join public.unidades u on u.codigo_interno = x.codigo
 where c.numero_documento = '20999496011';
set local session_replication_role = origin;

create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
-- Los avisos de una OT, contados como postgres: quién los recibió, en orden.
create or replace function pg_temp.avisados(p_numero text, p_titulo text) returns text language sql as $$
  select coalesce(string_agg(split_part(u.correo, '.496@', 1), ' ' order by u.correo), '(nadie)')
    from public.notificaciones n
    join public.usuarios u on u.id = n.usuario_id
    join public.ordenes_trabajo o on o.id = n.origen_id
   where o.numero = p_numero and n.titulo like p_titulo;
$$;
create or replace function pg_temp.cuerpo(p_numero text, p_titulo text, p_quien text) returns text language sql as $$
  select n.cuerpo
    from public.notificaciones n
    join public.ordenes_trabajo o on o.id = n.origen_id
   where o.numero = p_numero and n.titulo like p_titulo
     and n.usuario_id = current_setting('prueba.' || p_quien)::uuid;
$$;
create or replace function pg_temp.cuantos(p_numero text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones n join public.ordenes_trabajo o on o.id = n.origen_id where o.numero = p_numero;
$$;

-- 1. Administración pausa QA496-A1.
select pg_temp.como('adm');
set local role authenticated;
do $$
declare v integer;
begin
  update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'El cliente no envió el chasis (prueba 496)'
   where numero = 'QA496-A1';
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Administración pausa la OT en proceso: una fila, no cero');
end $$;
reset role;
select test.afirmar(pg_temp.avisados('QA496-A1', 'Orden QA496-A1 pausada · QA496-A') = 'sup_acb sup_mtz',
  'la pausa avisa a Maestranza y Acabados, con etapa abierta; no a Producción ni a quien pausó: ' || pg_temp.avisados('QA496-A1', 'Orden QA496-A1 pausada%'));
select test.afirmar(
  pg_temp.cuerpo('QA496-A1', '%pausada%', 'sup_mtz') = 'La pausó Administración. Motivo: El cliente no envió el chasis (prueba 496). Mientras siga pausada, el código QA496-A no te pide el reporte diario.',
  'el aviso dice quién pausó, el motivo y que ya no pide el reporte: ' || coalesce(pg_temp.cuerpo('QA496-A1', '%pausada%', 'sup_mtz'), '(sin aviso)'));
select test.afirmar(
  (select n.ruta from public.notificaciones n join public.ordenes_trabajo o on o.id = n.origen_id
    where o.numero = 'QA496-A1' and n.usuario_id = current_setting('prueba.sup_mtz')::uuid limit 1) = '/planos?q=QA496-A',
  'el aviso lleva a Planos y etapas con el código buscado');

-- El supervisor lee su aviso con su cuenta.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.notificaciones n where n.titulo = 'Orden QA496-A1 pausada · QA496-A') = 1,
  'el supervisor de Maestranza ve su aviso, y solo el suyo');
reset role;

-- 2. Administración la reanuda.
select pg_temp.como('adm');
set local role authenticated;
update public.ordenes_trabajo set estado = 'EN_PROCESO' where numero = 'QA496-A1';
reset role;
select test.afirmar(pg_temp.avisados('QA496-A1', 'Orden QA496-A1 reanudada · QA496-A') = 'sup_acb sup_mtz',
  'reanudar avisa a los mismos: ' || pg_temp.avisados('QA496-A1', '%reanudada%'));
select test.afirmar(
  pg_temp.cuerpo('QA496-A1', '%reanudada%', 'sup_acb') = 'La reanudó Administración. El trabajo sigue y el código QA496-A vuelve a pedir tu reporte diario.',
  'el aviso de reanudar dice que vuelve a pedir el reporte: ' || coalesce(pg_temp.cuerpo('QA496-A1', '%reanudada%', 'sup_acb'), '(sin aviso)'));

-- 3. Con otra OT abierta en el código, no promete que deja de pedirlo.
select pg_temp.como('adm');
set local role authenticated;
update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'Falta la plancha (prueba 496)' where numero = 'QA496-B1';
reset role;
select test.afirmar(pg_temp.avisados('QA496-B1', 'Orden QA496-B1 pausada · QA496-B') = 'sup_mtz', 'la pausa de QA496-B1 avisa a Maestranza');
select test.afirmar(
  pg_temp.cuerpo('QA496-B1', '%pausada%', 'sup_mtz') = 'La pausó Administración. Motivo: Falta la plancha (prueba 496).',
  'con otra OT abierta, el aviso no dice que deja de pedir el reporte: ' || coalesce(pg_temp.cuerpo('QA496-B1', '%pausada%', 'sup_mtz'), '(sin aviso)'));

-- 4. Lo que no es pausar ni reanudar no avisa.
select pg_temp.como('adm');
set local role authenticated;
update public.ordenes_trabajo set descripcion = 'Check 496 · corregida' where numero = 'QA496-A1';
reset role;
select test.afirmar(pg_temp.cuantos('QA496-A1') = 4, 'corregir la descripción no avisa: siguen los 4 avisos de pausar y reanudar');

-- 5. La OT sin código no avisa a nadie.
select pg_temp.como('adm');
set local role authenticated;
update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'Sin unidad (prueba 496)' where numero = 'QA496-SIN1';
reset role;
select test.afirmar(
  (select estado::text from public.ordenes_trabajo where numero = 'QA496-SIN1') = 'PAUSADA' and pg_temp.cuantos('QA496-SIN1') = 0,
  'la OT sin código se pausa y no avisa a nadie');

-- 6. La función del disparador no se llama a mano.
select test.afirmar(not has_function_privilege('authenticated', 'public.fn_ot_avisa_la_pausa()', 'execute'),
  'fn_ot_avisa_la_pausa no la ejecuta authenticated');

rollback;
