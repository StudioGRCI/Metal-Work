-- El supervisor registra el RQ de cada unidad de su área (migración
-- 20261120300000), pedido de supervisión de Acabados el 20/11/2026.
--
--   1. El supervisor de Acabados registra un RQ de operación para su área,
--      y le llega a Almacén como cualquier otro.
--   2. No registra para otra área, ni un RQ de Administración.
--   3. Corrige y anula los suyos; no los que registró Requerimientos para su
--      área, ni los del supervisor de otra área.
--   4. Requerimientos sigue registrando para cualquier área de operación.
--   5. Un puesto sin el permiso (Ventas) no registra.
--   6. Almacén lo atiende como a cualquiera, y al supervisor le llega un
--      solo aviso de «Listo en almacén» (es quien lo pidió y el del área).
--   7. El supervisor no toca un RQ de Administración, y sin área no registra.
--
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000456', 'PRUEBAS 456 S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  -- Una sola supervisión activa por área: la que ya hubiera se aparta mientras dura la prueba
  -- (sin sus disparadores: es el armazón de la prueba, no lo que se prueba).
  set local session_replication_role = replica;
  update public.usuarios u set activo = false
   where u.activo and u.rol_id = (select id from public.roles where codigo = 'SUPERVISOR')
     and u.area_id in (select id from public.areas where codigo in ('ACB', 'MTZ'));
  set local session_replication_role = origin;
  foreach v in array array['SUPERVISOR:ACB:acb', 'SUPERVISOR:MTZ:mtz', 'REQUERIMIENTOS:REQ:req', 'VENDEDOR:VEN:ven',
                           'ALMACENERO:ALM:alm', 'ADMINISTRACION:ADM:adm', 'SUPERVISOR:-:sin'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 3) || '.456@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 456', split_part(v, ':', 3) || '.456@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  perform set_config('prueba.area_acb', (select id::text from public.areas where codigo = 'ACB'), true);
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.area_rrh', (select id::text from public.areas where codigo = 'RRH'), true);
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rq6', 'rq7', 'rq8', 'rq9', 'c1', 'c2', 'c3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK456-PIN', 'Pintura de prueba 456',
     (select id from public.categorias_material where activo order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.pin', (select id::text from public.materiales where codigo = 'CHK456-PIN'), true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.lineas(p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.pin'), 'cantidad', p_cantidad));
$$;
grant execute on function pg_temp.como(text), pg_temp.id(text), pg_temp.lineas(numeric) to authenticated;

-- ======================================== 1. El supervisor de Acabados registra
select pg_temp.como('acb');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.id('area_acb'), 'CHK456-U1',
  'Pintura para el acabado de la unidad de prueba', null, pg_temp.lineas(4));
-- El mismo envío repetido (la respuesta se perdió) no da otro RQ.
select public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.id('area_acb'), 'CHK456-U1',
  'Pintura para el acabado de la unidad de prueba', null, pg_temp.lineas(4));
select public.emitir_requerimiento(pg_temp.id('rq2'), 'OPERACION', pg_temp.id('area_acb'), 'PLANTA',
  'Pintura para retoques generales del área', null, pg_temp.lineas(1));
select test.afirmar((select count(*) = 2 and bool_and(estado = 'POR_ATENDER' and creado_por = pg_temp.id('acb'))
                       from public.requerimientos where id in (pg_temp.id('rq1'), pg_temp.id('rq2'))),
                    '1. el supervisor de Acabados registró dos RQ de su área y quedaron por atender en Almacén');
select test.afirmar((select numero like 'RQ-%' or numero ~ '^[0-9]' from public.requerimientos where id = pg_temp.id('rq1')),
                    '1. el RQ del supervisor lleva número de la serie de operación');

-- ======================================== 2. Solo su área y solo de operación
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'OPERACION', %L, 'CHK456-U1', 'Pintura para Maestranza desde Acabados', null, %L)$q$,
                               pg_temp.id('rq3'), pg_temp.id('area_mtz'), pg_temp.lineas(2)),
                        '2. el supervisor de Acabados no registra un RQ para Maestranza', 'de otra área');
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'ADMINISTRACION', %L, 'OFICINA', 'Pintura para la oficina desde Acabados', null, %L)$q$,
                               pg_temp.id('rq3'), pg_temp.id('area_rrh'), pg_temp.lineas(2)),
                        '2. el supervisor no registra un RQ de Administración', 'requerimiento de Administración');
reset role;
select test.afirmar(not exists (select 1 from public.requerimientos where id = pg_temp.id('rq3')),
                    '2. los dos rechazados no dejaron RQ');

-- ======================================== 4. Requerimientos sigue para cualquier área
select pg_temp.como('req');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq4'), 'OPERACION', pg_temp.id('area_acb'), 'CHK456-U1',
  'Pintura que pidió Acabados por teléfono', null, pg_temp.lineas(2));
select public.emitir_requerimiento(pg_temp.id('rq5'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK456-U2',
  'Pintura para el chasis en Maestranza', null, pg_temp.lineas(2));
reset role;

select pg_temp.como('mtz');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq6'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK456-U2',
  'Pintura de fondo para el chasis de la unidad', null, pg_temp.lineas(3));
reset role;

-- ======================================== 3. Corrige y anula solo los suyos
select pg_temp.como('acb');
set local role authenticated;
-- El justificante lo sube el supervisor con su sesión: la política de Storage lo deja.
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'justificantes-correccion', pg_temp.id(r)::text || '/' || pg_temp.id(c)::text || '.pdf', pg_temp.id('acb')::text,
       '{"mimetype": "application/pdf", "size": 3072}'
  from (values ('rq1', 'c1'), ('rq4', 'c2')) v(r, c);
select public.corregir_requerimiento(pg_temp.id('c1'), pg_temp.id('rq1'), 'Basta con tres galones para la unidad',
  pg_temp.id('rq1')::text || '/' || pg_temp.id('c1')::text || '.pdf', 'chk456.pdf', '{"justificacion": "Pintura para el acabado: tres galones bastan"}');
select test.debe_fallar(format($q$select public.corregir_requerimiento(%L, %L, 'Corrijo el de Requerimientos', %L, 'chk456b.pdf', '{"justificacion": "Otra justificación del supervisor"}')$q$,
                               pg_temp.id('c2'), pg_temp.id('rq4'), pg_temp.id('rq4')::text || '/' || pg_temp.id('c2')::text || '.pdf'),
                        '3. no corrige el RQ que Requerimientos registró para su área', 'que registró otra persona');
select test.debe_fallar(format($q$select public.anular_requerimiento(%L, 'Ya no hace falta esta pintura')$q$, pg_temp.id('rq4')),
                        '3. no anula el RQ que Requerimientos registró para su área', 'que registró otra persona');
select test.debe_fallar(format($q$select public.anular_requerimiento(%L, 'Ya no hace falta esta pintura')$q$, pg_temp.id('rq6')),
                        '3. no anula el RQ del supervisor de Maestranza', 'de otra área');
select public.anular_requerimiento(pg_temp.id('rq2'), 'Se usó lo que sobró de otra unidad');
reset role;
select test.afirmar((select justificacion = 'Pintura para el acabado: tres galones bastan' from public.requerimientos where id = pg_temp.id('rq1')),
                    '3. el supervisor corrigió su RQ');
select test.afirmar((select estado = 'ANULADO' and anulado_por = pg_temp.id('acb') from public.requerimientos where id = pg_temp.id('rq2')),
                    '3. el supervisor anuló su RQ, con quién y motivo');
select test.afirmar((select estado = 'POR_ATENDER' and justificacion = 'Pintura que pidió Acabados por teléfono'
                       from public.requerimientos where id = pg_temp.id('rq4')),
                    '3. el RQ de Requerimientos quedó como estaba');
select test.afirmar((select estado = 'POR_ATENDER' from public.requerimientos where id = pg_temp.id('rq6')),
                    '3. el RQ del supervisor de Maestranza quedó como estaba');

-- Requerimientos sí anula el del supervisor: lleva todos los de operación.
select pg_temp.como('req');
set local role authenticated;
select public.anular_requerimiento(pg_temp.id('rq6'), 'Maestranza lo pidió dos veces');
reset role;
select test.afirmar((select estado = 'ANULADO' from public.requerimientos where id = pg_temp.id('rq6')),
                    '4. Requerimientos anula el RQ que registró un supervisor');

-- ======================================== 5. Sin el permiso, no
select pg_temp.como('ven');
set local role authenticated;
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'OPERACION', %L, 'CHK456-U1', 'Pintura pedida desde Ventas', null, %L)$q$,
                               pg_temp.id('rq7'), pg_temp.id('area_acb'), pg_temp.lineas(1)),
                        '5. Ventas no registra un RQ', 'No tienes permiso');
select test.debe_fallar($q$select public.rq_exigir_del_area('OPERACION', 'REGISTRAR', null, null)$q$,
                        '5. la regla del área no se llama desde la API', 'permission denied');
reset role;

-- ======================================== 6. Almacén lo atiende, un solo aviso
select pg_temp.como('alm');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(pg_temp.id('rq1'), null);
reset role;
select test.afirmar((select estado = 'LISTO_EN_ALMACEN' from public.requerimientos where id = pg_temp.id('rq1')),
                    '6. Almacén deja listo el RQ del supervisor como cualquier otro');
select test.afirmar((select count(*) = 1 from public.notificaciones
                      where usuario_id = pg_temp.id('acb') and origen_id = pg_temp.id('rq1') and titulo like 'Listo en almacén:%'),
                    '6. al supervisor que lo pidió le llega un solo «Listo en almacén», no dos');

-- ======================================== 7. Ni el RQ de Administración, ni sin área
select pg_temp.como('adm');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq8'), 'ADMINISTRACION', (select id from public.areas where codigo = 'ADM'), 'OFICINA',
  'Útiles para la oficina de Administración', null, pg_temp.lineas(1));
reset role;
select pg_temp.como('acb');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento(%L, 'Ya no hace falta en la oficina')$q$, pg_temp.id('rq8')),
                        '7. el supervisor no anula un RQ de Administración', 'requerimiento de Administración');
reset role;
select pg_temp.como('sin');
set local role authenticated;
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'OPERACION', %L, 'CHK456-U1', 'Pintura sin área en la cuenta', null, %L)$q$,
                               pg_temp.id('rq9'), pg_temp.id('area_acb'), pg_temp.lineas(1)),
                        '7. el supervisor sin área en su cuenta no registra', 'no tiene área');
reset role;
select test.afirmar((select estado <> 'ANULADO' from public.requerimientos where id = pg_temp.id('rq8'))
                    and not exists (select 1 from public.requerimientos where id = pg_temp.id('rq9')),
                    '7. el RQ de Administración quedó como estaba y el sin área no dejó RQ');

do $$ begin raise notice 'check 456 (el supervisor pide por unidad): todo en verde'; end $$;
rollback;
