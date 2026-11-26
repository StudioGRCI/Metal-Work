-- Quién subió cada versión de un plano o un DXF y si el taller leyó su aviso
-- (plan 6, entrega 6.3; migración 20261126930000). El visto sale del aviso
-- leído: aquí lo marca el supervisor con su propia sesión, como la campana. Lo
-- lee Diseño con su sesión (`set local role authenticated`); el supervisor,
-- Administración, Logística y anon no. Nunca como ADMIN. Lo que NO debe
-- contar: el aviso de la anulación y el de la revisión siguiente (el mismo
-- plano), el de quien ve todas las áreas desde otra, y el envío quitado.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- El supervisor de cada área (uno por área: si la base ya lo tiene, es ese)
  -- y una cuenta de otra área (Gerencia) a la que le llega el aviso, como le
  -- llegaba a la jefatura que veía todas las áreas.
  foreach v in array array['DISENO:DIS:diseno', 'SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR:PRD:sup_prd',
                           'GERENTE:GGE:jefe', 'ADMINISTRACION:ADM:administracion', 'COMPRADOR:LOG:logistica'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 3) || '.478@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 478', split_part(v, ':', 3) || '.478@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    if not found then
      raise exception 'Falta el rol %', split_part(v, ':', 1);
    end if;
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  foreach v in array array['p1', 'r1', 'r1b', 'p2', 'r2', 'd1', 'd2', 'd3', 'env', 'p9', 'r9'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK478-SR-01', true);
  perform set_config('prueba.otro', 'CHK478-SR-02', true);
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
-- La fila de una versión en un área, como la lee la pantalla.
create or replace function pg_temp.fila(p_clave text, p_area text)
returns table (tipo text, subido_por text, destinatarios int, leidos int, primera_lectura timestamptz, ultima_lectura timestamptz)
language sql as $$
  select tipo, subido_por, destinatarios, leidos, primera_lectura, ultima_lectura
    from public.quien_subio_y_quien_leyo(current_setting('prueba.codigo'))
   where clave = current_setting('prueba.' || p_clave)::uuid and area = p_area;
$$;
-- A cuántas cuentas de esa área les llega el aviso: las activas del área que
-- reciben los avisos de planos (el catálogo dice cuántas hay, no se escribe a mano).
create or replace function pg_temp.del_area(p_area text) returns int language sql as $$
  select count(*)::int from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'codigos_internos.area'
    join public.areas a on a.id = u.area_id and a.codigo = p_area
   where u.activo;
$$;
-- El supervisor abre su aviso, como la campana: un UPDATE con su sesión y su RLS.
create or replace function pg_temp.leer(p_quien text, p_origen text, p_ids uuid[]) returns int language plpgsql as $$
declare v int;
begin
  update public.notificaciones set leida_en = now()
   where usuario_id = public.usuario_actual() and origen_tabla = p_origen and origen_id = any (p_ids) and leida_en is null;
  get diagnostics v = row_count;
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 1. Diseño carga los planos de las dos áreas y un envío de DXF
select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('planos-codigo', current_setting('prueba.p1') || '/' || current_setting('prueba.r1') || '.pdf', pg_temp.id('diseno'),
   current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":81234}'),
  ('planos-codigo', current_setting('prueba.p2') || '/' || current_setting('prueba.r2') || '.pdf', pg_temp.id('diseno'),
   current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":64000}'),
  ('dxf-codigo', current_setting('prueba.d1') || '.dxf', pg_temp.id('diseno'), current_setting('prueba.diseno'), '{"size":5000}'),
  ('dxf-codigo', current_setting('prueba.d2') || '.dxf', pg_temp.id('diseno'), current_setting('prueba.diseno'), '{"size":6000}');
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), current_setting('prueba.codigo'), 'P-01', 'Habilitado',
                                     pg_temp.id('mtz'), null, 'p01.pdf', 30);
select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), current_setting('prueba.codigo'), 'P-02', 'Ensamblaje',
                                     pg_temp.id('prd'), null, 'p02.pdf', 30);
select public.registrar_dxf_codigo(pg_temp.id('d1'), current_setting('prueba.codigo'), 'Corte del chasis', 'a.dxf', pg_temp.id('env'));
select public.registrar_dxf_codigo(pg_temp.id('d2'), current_setting('prueba.codigo'), 'Corte del chasis', 'b.dxf', pg_temp.id('env'));

select test.afirmar(
  (select count(*) = 4 from public.quien_subio_y_quien_leyo(' ' || lower(current_setting('prueba.codigo')) || ' ')),
  'dos revisiones (una fila cada una, su área) y un envío de DXF (dos filas, Maestranza y Producción), con el código normalizado');
select test.afirmar(
  (select subido_por = public.puesto_de(pg_temp.id('diseno')) and subido_por not like '%Check 478%'
          and destinatarios = pg_temp.del_area('MTZ') and leidos = 0 and primera_lectura is null
     from pg_temp.fila('r1', 'MTZ')),
  'la R1 de P-01: la subió Diseño (su puesto, no su nombre) y el aviso llegó a los supervisores de Maestranza, sin leer');
select test.afirmar(
  (select destinatarios = pg_temp.del_area('PRD') and leidos = 0 from pg_temp.fila('r2', 'PRD'))
  and not exists (select 1 from pg_temp.fila('r2', 'MTZ')),
  'el plano de Producción se mide solo en Producción');
select test.afirmar(
  (select destinatarios = pg_temp.del_area('MTZ') from pg_temp.fila('env', 'MTZ'))
  and (select destinatarios = pg_temp.del_area('PRD') from pg_temp.fila('env', 'PRD')),
  'el envío de dos DXF es una versión con un aviso por cuenta, en Maestranza y en Producción');
reset role;
select test.afirmar(pg_temp.del_area('MTZ') >= 1 and pg_temp.del_area('PRD') >= 1, 'cada área tiene a quién avisar');
-- Un aviso de la R1 a una cuenta de otra área, del mismo momento: como el que
-- recibía la jefatura que veía todas las áreas (`produccion.cualquier_area`).
insert into public.notificaciones (usuario_id, titulo, ruta, origen_tabla, origen_id, creado_en)
select pg_temp.id('jefe'), 'Plano nuevo', '/planos', 'codigo_planos', pg_temp.id('p1'), r.subido_en
  from public.codigo_plano_revisiones r where r.id = pg_temp.id('r1');

-- ============================================ 2. Un supervisor de Maestranza abre su aviso; el jefe abre el suyo
select pg_temp.como('jefe');
set local role authenticated;
select test.afirmar(pg_temp.leer('jefe', 'codigo_planos', array[pg_temp.id('p1')]) = 1, 'la cuenta de otra área abre su aviso de P-01');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.leer('sup_mtz', 'codigo_planos', array[pg_temp.id('p1')]) = 1, 'el supervisor de Maestranza abre su aviso de P-01');
select test.afirmar(pg_temp.leer('sup_mtz', 'codigo_dxf', array[pg_temp.id('d1'), pg_temp.id('d2')]) = 1,
  'y el de los DXF: uno por envío');
select test.debe_fallar($q$select * from public.quien_subio_y_quien_leyo(current_setting('prueba.codigo'))$q$,
  'el supervisor no lee quién leyó los avisos: es de Diseño');
reset role;

select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(
  (select leidos = 1 and destinatarios = pg_temp.del_area('MTZ') and primera_lectura is not null and primera_lectura = ultima_lectura
     from pg_temp.fila('r1', 'MTZ')),
  'Diseño ve que Maestranza leyó la R1; el aviso que abrió la cuenta de otra área no cuenta');
select test.afirmar(
  (select leidos = 1 from pg_temp.fila('env', 'MTZ')) and (select leidos = 0 from pg_temp.fila('env', 'PRD')),
  'el envío de DXF: Maestranza lo leyó, Producción todavía no');
reset role;

-- ============================================ 3. La R2 tiene su propio aviso; la R1 conserva el suyo
-- La R1 y su aviso, una hora antes: en uso real son de otra transacción.
set local session_replication_role = replica;
update public.codigo_plano_revisiones set subido_en = subido_en - interval '1 hour' where id = pg_temp.id('r1');
update public.notificaciones set creado_en = creado_en - interval '1 hour'
 where origen_tabla = 'codigo_planos' and origen_id = pg_temp.id('p1');
update public.codigo_plano_revisiones set subido_en = subido_en - interval '2 hours' where id = pg_temp.id('r2');
update public.notificaciones set creado_en = creado_en - interval '2 hours'
 where origen_tabla = 'codigo_planos' and origen_id = pg_temp.id('p2');
set local session_replication_role = origin;

select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('planos-codigo', current_setting('prueba.p1') || '/' || current_setting('prueba.r1b') || '.pdf', pg_temp.id('diseno'),
   current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":82000}');
select public.subir_revision_plano(pg_temp.id('p1'), pg_temp.id('r1b'), 'Se alargaron los travesaños', 'p01-r2.pdf');
select test.afirmar(
  (select leidos = 0 and destinatarios = pg_temp.del_area('MTZ') from pg_temp.fila('r1b', 'MTZ'))
  and (select leidos = 1 and destinatarios = pg_temp.del_area('MTZ') from pg_temp.fila('r1', 'MTZ')),
  'la R2 tiene su aviso, sin leer; la R1 sigue con el suyo leído (el mismo plano no los mezcla)');

-- La anulación de P-02 también avisa, con el mismo plano: no es el aviso de su R1.
select public.anular_plano_codigo(pg_temp.id('p2'), 'Se cargó para el área equivocada');
select test.afirmar(
  (select destinatarios = pg_temp.del_area('PRD') and leidos = 0 from pg_temp.fila('r2', 'PRD')),
  'el aviso de la anulación no se cuenta como otro aviso de la R1 (sigue uno por cuenta)');
reset role;

-- ============================================ 4. Maestranza lee la R2; un DXF más vuelve el aviso a sin leer
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.leer('sup_mtz', 'codigo_planos', array[pg_temp.id('p1')]) = 1,
  'el supervisor de Maestranza abre el aviso de la R2 (el de la R1 ya estaba leído)');
reset role;
select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar(pg_temp.leer('sup_prd', 'codigo_dxf', array[pg_temp.id('d1'), pg_temp.id('d2')]) = 1,
  'el supervisor de Producción abre el aviso de los DXF');
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(
  (select leidos = 1 and destinatarios = pg_temp.del_area('MTZ') and ultima_lectura is not null from pg_temp.fila('r1b', 'MTZ'))
  and (select leidos = 1 from pg_temp.fila('r1', 'MTZ')),
  'la R2 ya sale leída por Maestranza, y la R1 sigue leída una sola vez');
select test.afirmar((select leidos = 1 from pg_temp.fila('env', 'PRD')), 'Producción ya leyó el aviso de los DXF');

insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('dxf-codigo', current_setting('prueba.d3') || '.dxf', pg_temp.id('diseno'), current_setting('prueba.diseno'), '{"size":7000}');
select public.registrar_dxf_codigo(pg_temp.id('d3'), current_setting('prueba.codigo'), 'Corte del chasis', 'c.dxf', pg_temp.id('env'));
select test.afirmar(
  (select leidos = 0 from pg_temp.fila('env', 'MTZ')) and (select leidos = 0 from pg_temp.fila('env', 'PRD'))
  and (select destinatarios = pg_temp.del_area('PRD') from pg_temp.fila('env', 'PRD')),
  'un archivo más en el mismo envío vuelve el aviso a sin leer: lo que se ve es lo de ahora, sin un aviso de más');

-- ============================================ 5. El envío quitado ya no es una versión; otro código no se mezcla
select public.quitar_dxf_codigo(pg_temp.id('d1'));
select public.quitar_dxf_codigo(pg_temp.id('d2'));
select public.quitar_dxf_codigo(pg_temp.id('d3'));
select test.afirmar(not exists (select 1 from pg_temp.fila('env', 'MTZ')), 'el envío al que no le queda ningún DXF ya no sale');
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('planos-codigo', current_setting('prueba.p9') || '/' || current_setting('prueba.r9') || '.pdf', pg_temp.id('diseno'),
   current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":1000}');
select public.registrar_plano_codigo(pg_temp.id('p9'), pg_temp.id('r9'), current_setting('prueba.otro'), 'P-01', 'Otro',
                                     pg_temp.id('mtz'), null, 'otro.pdf', 10);
select test.afirmar(
  not exists (select 1 from public.quien_subio_y_quien_leyo(current_setting('prueba.codigo')) where clave = pg_temp.id('r9'))
  and (select count(*) = 1 from public.quien_subio_y_quien_leyo(current_setting('prueba.otro'))),
  'cada código da solo sus versiones');
select test.afirmar((select count(*) = 0 from public.quien_subio_y_quien_leyo(null)), 'sin código no devuelve nada');
reset role;

-- ============================================ 6. Quien no es de Diseño no entra
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar($q$select * from public.quien_subio_y_quien_leyo(current_setting('prueba.codigo'))$q$,
  'Administración no lo lee');
reset role;
select pg_temp.como('logistica');
set local role authenticated;
select test.debe_fallar($q$select * from public.quien_subio_y_quien_leyo(current_setting('prueba.codigo'))$q$,
  'Logística no lo lee');
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.quien_subio_y_quien_leyo(text)', 'execute'), 'anon no la ejecuta');

rollback;
