-- Las observaciones de Diseño (migración 20261106100000): el colaborador pide
-- material por requerimiento y ya no sube planos; los DXF comprimidos son solo
-- de Diseño y Maestranza; Diseño arma el par Habilitado (Maestranza) y
-- Ensamblaje (Producción); cada área agrega sus subetapas o sus etapas, y el
-- avance cuenta las etapas de arriba con el promedio de sus subetapas. Cada
-- paso con el rol que lo da —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Cada área tiene una sola Supervisión activa: si la base ya la tiene, se usa esa.
  foreach v in array array['DISENO:DIS', 'DISENO_COLABORADOR:DIS', 'SUPERVISOR:MTZ', 'SUPERVISOR:PRD', 'SUPERVISOR:ACB',
                           'GERENTE:GGE', 'COMPRADOR:LOG'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.451@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 451', lower(replace(v, ':', '.')) || '.451@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD', 'ACB', 'DIS'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  foreach v in array array['dxf1', 'dxf2', 'dxf3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK451_SR_O4_1_26/51', true);
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
-- Lo que hace Storage al subir, con la sesión del que sube y su política.
create or replace function pg_temp.subir_dxf(p_clave text, p_ext text, p_dueno text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('dxf-codigo', current_setting('prueba.' || p_clave) || '.' || p_ext, pg_temp.id(p_dueno), current_setting('prueba.' || p_dueno),
          jsonb_build_object('mimetype', 'application/zip', 'size', 512000));
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and titulo like p_titulo || '%' and creado_en >= now();
$$;
create or replace function pg_temp.etapa(p_nombre text) returns uuid language sql as $$
  select id from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo') and nombre = p_nombre and quitada_en is null;
$$;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 1. El colaborador pide material y no sube planos
select test.afirmar(
  (select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo = 'DISENO_COLABORADOR' and rp.permiso_codigo in ('requerimientos.emitir', 'requerimientos.ver', 'almacen.stock')) = 3,
  'el colaborador de Diseño emite requerimientos, los ve y mira el stock antes de pedir');

select pg_temp.como('diseno_colaborador_dis');
set local role authenticated;
select test.afirmar((select public.tiene_permiso('requerimientos.emitir')) and not (select public.tiene_permiso('compras.crear'))
  and not (select public.tiene_permiso('almacen.ver')),
  'con su sesión: pide por requerimiento, pero no compra ni abre el kardex');
select test.afirmar((select count(*) from public.codigos_internos_para_elegir()) >= 0,
  'y elige el código interno de la lista, como todo el que emite un RQ');
-- El PDF de un plano en la OT: el bucket ya no se lo recibe.
select test.debe_fallar($q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('planos-privados', current_setting('prueba.diseno_colaborador_dis') || '/' || gen_random_uuid() || '.pdf',
          pg_temp.id('diseno_colaborador_dis'), current_setting('prueba.diseno_colaborador_dis'),
          '{"mimetype":"application/pdf","size":1000}')$q$,
  'el colaborador ya no sube el PDF de un plano a la OT', 'row-level security');
-- Ni los DXF.
select test.debe_fallar($q$select pg_temp.subir_dxf('dxf3', 'zip', 'diseno_colaborador_dis')$q$,
  'ni sube DXF', 'row-level security');
select test.afirmar((select count(*) from public.codigo_dxf) = 0, 'ni los ve');
reset role;

-- Y aunque llegue por la función de la OT, la tabla lo rechaza antes de mirar nada más.
select pg_temp.como('diseno_colaborador_dis');
select test.debe_fallar($q$insert into public.ot_plano_versiones (id) values (gen_random_uuid())$q$,
  'la versión de un plano en la OT no entra con la sesión del colaborador', 'encargado de Diseño');

-- Corrige y anula solo los RQ que registró él: los de los demás son del puesto Requerimientos.
insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
values ('45100000-0000-4000-8000-000000000001', 'RQ-9451-2026', pg_temp.id('mtz'), 'CHK451_SR_O4_1_26/51', 'De otra persona, para el check', pg_temp.id('comprador_log')),
       ('45100000-0000-4000-8000-000000000002', 'RQ-9452-2026', pg_temp.id('mtz'), 'CHK451_SR_O4_1_26/51', 'Del colaborador, para el check', pg_temp.id('diseno_colaborador_dis'));
select pg_temp.como('diseno_colaborador_dis');
select test.debe_fallar($q$update public.requerimientos set justificacion = 'La cambia el colaborador' where id = '45100000-0000-4000-8000-000000000001'$q$,
  'el colaborador no corrige ni anula el RQ de otra persona', 'registró otra persona');
select test.debe_fallar($q$insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad) values ('45100000-0000-4000-8000-000000000001', 9, 'Algo más', 1)$q$,
  'ni le agrega insumos', 'registró otra persona');
-- Con el suyo pasa esta regla y llega a la de siempre: se corrige con su justificante.
select test.debe_fallar($q$update public.requerimientos set justificacion = 'La corrige el colaborador' where id = '45100000-0000-4000-8000-000000000002'$q$,
  'el suyo pasa esta regla (lo frena la de siempre: se corrige con justificante)', 'corrígelo con su justificante');
select pg_temp.como('comprador_log');
select test.debe_fallar($q$update public.requerimientos set justificacion = 'Otro puesto' where id = '45100000-0000-4000-8000-000000000001'$q$,
  'a los demás puestos esta regla no los toca (los frena la de siempre)', 'corrígelo con su justificante');
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ============================================ 2. Los DXF: Diseño los sube, Maestranza y Producción los ven
select pg_temp.como('diseno_dis');
set local role authenticated;
select pg_temp.subir_dxf('dxf1', 'zip', 'diseno_dis');
select public.registrar_dxf_codigo(pg_temp.id('dxf1'), lower(current_setting('prueba.codigo')), ' Corte  de planchas del chasis ', 'chasis-dxf.zip');
-- El mismo pedido otra vez contesta con el mismo id y no duplica ni vuelve a avisar.
select test.afirmar(public.registrar_dxf_codigo(pg_temp.id('dxf1'), current_setting('prueba.codigo'), 'Corte de planchas del chasis', 'chasis-dxf.zip')
  = pg_temp.id('dxf1'), 'el reintento contesta con el mismo id');
select test.debe_fallar($q$select public.registrar_dxf_codigo(pg_temp.id('dxf2'), current_setting('prueba.codigo'), 'Sin archivo', 'x.zip')$q$,
  'sin el archivo subido no se registra', 'no terminó de subir');
select test.debe_fallar($q$select public.registrar_dxf_codigo(pg_temp.id('dxf2'), current_setting('prueba.codigo'), 'Un DXF suelto', 'x.dxf')$q$,
  'el DXF va comprimido', '.zip, .rar o .7z');
select test.debe_fallar($q$select pg_temp.subir_dxf('dxf2', 'pdf', 'diseno_dis')$q$,
  'el bucket solo recibe el comprimido', 'row-level security');
select test.debe_fallar($q$select public.registrar_dxf_codigo(gen_random_uuid(), 'PLANTA', 'Algo', 'x.zip')$q$,
  'PLANTA no es una unidad', 'PLANTA no es una unidad');
reset role;
select test.afirmar(
  (select count(*) from public.codigo_dxf where id = pg_temp.id('dxf1') and codigo_interno = current_setting('prueba.codigo')
      and descripcion = 'Corte de planchas del chasis' and tamano_bytes = 512000 and ruta = current_setting('prueba.dxf1') || '.zip') = 1
  and pg_temp.avisos('supervisor_mtz', 'DXF nuevos') = 1
  and pg_temp.avisos('supervisor_prd', 'DXF nuevos') = 1 and pg_temp.avisos('diseno_dis', 'DXF nuevos') = 0,
  'queda una vez, con el código escrito siempre igual, y les avisa a Maestranza y a Producción');

select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_dxf where codigo_interno = current_setting('prueba.codigo')) = 1
  and (select count(*) from storage.objects where bucket_id = 'dxf-codigo' and name = current_setting('prueba.dxf1') || '.zip') = 1,
  'el supervisor de Maestranza ve el DXF y su archivo');
select test.debe_fallar($q$select public.quitar_dxf_codigo(pg_temp.id('dxf1'))$q$, 'pero no lo quita', 'diseno.codigos');
select test.debe_fallar($q$select pg_temp.subir_dxf('dxf2', 'zip', 'supervisor_mtz')$q$, 'ni sube DXF', 'row-level security');
reset role;
select pg_temp.como('supervisor_prd');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_dxf where codigo_interno = current_setting('prueba.codigo')) = 1
  and (select count(*) from storage.objects where bucket_id = 'dxf-codigo' and name = current_setting('prueba.dxf1') || '.zip') = 1,
  'el supervisor de Producción también ve el DXF y su archivo');
select test.debe_fallar($q$select public.quitar_dxf_codigo(pg_temp.id('dxf1'))$q$, 'pero no lo quita', 'diseno.codigos');
reset role;
select pg_temp.como('supervisor_acb');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_dxf) = 0
  and (select count(*) from storage.objects where bucket_id = 'dxf-codigo') = 0, 'Acabados no ve los DXF');
reset role;
select pg_temp.como('gerente_gge');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_dxf) = 0
  and (select count(*) from storage.objects where bucket_id = 'dxf-codigo') = 0, 'Gerencia no: son de Diseño, Maestranza y Producción');
reset role;

select pg_temp.como('diseno_dis');
set local role authenticated;
select public.quitar_dxf_codigo(pg_temp.id('dxf1'));
select test.debe_fallar($q$delete from public.codigo_dxf where id = pg_temp.id('dxf1')$q$, 'nadie borra la fila', 'permission denied');
reset role;
select test.afirmar((select quitado_por from public.codigo_dxf where id = pg_temp.id('dxf1')) = pg_temp.id('diseno_dis'),
  'quitado, queda con quién lo quitó');
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'dxf-codigo' and name = current_setting('prueba.dxf1') || '.zip') = 0,
  'y el archivo quitado ya no lo abre Maestranza');
reset role;

-- ============================================ 3. Diseño arma el par de etapas
select pg_temp.como('diseno_dis');
set local role authenticated;
select test.afirmar(public.etapas_de_siempre_codigo(current_setting('prueba.codigo')) = 2, 'el botón de siempre arma dos etapas');
select test.debe_fallar($q$select public.etapas_de_siempre_codigo(current_setting('prueba.codigo'))$q$,
  'el mismo par no se arma dos veces', 'ya tiene las etapas de ese juego');
select test.afirmar(public.par_de_etapas_codigo(current_setting('prueba.codigo'), ' Caja ') = 2, 'otro juego de planos, otro par');
select test.debe_fallar($q$select public.guardar_etapa_codigo(null, current_setting('prueba.codigo'), 'Arenado y pintura', pg_temp.id('acb'), null, null)$q$,
  'Diseño no pone etapas sueltas: solo el par de cada juego', 'dos etapas por juego de planos');
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.etapa('Habilitado'), null, 'Habilitado', pg_temp.id('acb'), null, null)$q$,
  'ni pasa una suya a Acabados', 'Las demás las agrega cada área');
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.etapa('Habilitado'), null, 'Habilitado', null, null, null)$q$,
  'ni la deja sin área', 'Maestranza (habilitado) o de Producción');
reset role;
select test.afirmar(
  (select string_agg(e.nombre || '>' || a.codigo, ', ' order by e.orden) from public.codigo_etapas e join public.areas a on a.id = e.area_id
    where e.codigo_interno = current_setting('prueba.codigo') and e.quitada_en is null)
  = 'Habilitado>MTZ, Ensamblaje>PRD, Habilitado: Caja>MTZ, Ensamblaje: Caja>PRD',
  'Habilitado de Maestranza y Ensamblaje de Producción, por cada juego, en orden');

-- ============================================ 4. Cada área agrega lo suyo
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select public.guardar_etapa_de_area(null, null, pg_temp.etapa('Habilitado'), null, 'Corte de planchas', null, null);
select public.guardar_etapa_de_area(null, null, pg_temp.etapa('Habilitado'), null, 'Plegado  y rolado', null, null);
select test.debe_fallar($q$select public.guardar_etapa_de_area(null, null, pg_temp.etapa('Ensamblaje'), null, 'Algo', null, null)$q$,
  'Maestranza no agrega subetapas a la etapa de Producción', 'es de otra área');
select test.debe_fallar($q$select public.guardar_etapa_de_area(null, null, pg_temp.etapa('Corte de planchas'), null, 'Algo', null, null)$q$,
  'una subetapa no lleva subetapas', 'no lleva subetapas');
select test.debe_fallar($q$select public.guardar_etapa_de_area(pg_temp.etapa('Habilitado'), null, null, null, 'Otro nombre', null, null)$q$,
  'la etapa de Diseño la corrige Diseño', 'la corrige Diseño');
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.etapa('Habilitado'), null, 'Otro', pg_temp.id('mtz'), null, null)$q$,
  'ni por la función de Diseño', 'diseno.codigos');
reset role;

select pg_temp.como('supervisor_acb');
set local role authenticated;
select public.guardar_etapa_de_area(null, current_setting('prueba.codigo'), null, pg_temp.id('acb'), 'Arenado y pintura', null, null);
select test.debe_fallar($q$select public.guardar_etapa_de_area(null, current_setting('prueba.codigo'), null, pg_temp.id('mtz'), 'Algo', null, null)$q$,
  'Acabados solo agrega etapas de su área', 'Solo agregas etapas de tu área');
select test.debe_fallar($q$select public.quitar_etapa_codigo(pg_temp.etapa('Corte de planchas'))$q$,
  'ni quita las de Maestranza', 'el supervisor de su área');
reset role;

select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select public.guardar_etapa_de_area(null, current_setting('prueba.codigo'), null, pg_temp.id('acb'), 'Algo', null, null)$q$,
  'Logística no agrega etapas', 'supervisor de esa área');
reset role;

select test.afirmar(
  (select count(*) from public.codigo_etapas e where e.padre_id = pg_temp.etapa('Habilitado') and e.de_area and e.area_id = pg_temp.id('mtz')) = 2
  and (select de_area and padre_id is null from public.codigo_etapas where id = pg_temp.etapa('Arenado y pintura'))
  and (select count(*) from public.codigo_etapas where id = pg_temp.etapa('Plegado y rolado')) = 1,
  'las subetapas de Maestranza quedan debajo de su Habilitado, y la de Acabados arriba, como etapa propia');

-- Diseño no quita su etapa con subetapas, ni las del área.
select pg_temp.como('diseno_dis');
set local role authenticated;
select test.debe_fallar($q$select public.quitar_etapa_codigo(pg_temp.etapa('Habilitado'))$q$,
  'Diseño no quita el Habilitado con subetapas', 'primero las quita su supervisor');
select test.debe_fallar($q$select public.quitar_etapa_codigo(pg_temp.etapa('Arenado y pintura'))$q$,
  'ni la etapa de Acabados', 'el supervisor de su área');
select test.debe_fallar($q$select public.guardar_etapa_codigo(pg_temp.etapa('Habilitado'), null, 'Habilitado', pg_temp.id('prd'), null, null)$q$,
  'ni le cambia el área con subetapas', 'no se cambia de área');
-- Mover entre hermanas: el Ensamblaje sube sobre el Habilitado.
select public.mover_etapa_codigo(pg_temp.etapa('Ensamblaje'), true);
reset role;
select test.afirmar(
  (select orden from public.codigo_etapas where id = pg_temp.etapa('Ensamblaje'))
    < (select orden from public.codigo_etapas where id = pg_temp.etapa('Habilitado')),
  'Diseño mueve sus etapas de arriba');

select pg_temp.como('supervisor_mtz');
set local role authenticated;
select public.mover_etapa_codigo(pg_temp.etapa('Plegado y rolado'), true);
reset role;
select test.afirmar(
  (select orden from public.codigo_etapas where id = pg_temp.etapa('Plegado y rolado'))
    < (select orden from public.codigo_etapas where id = pg_temp.etapa('Corte de planchas')),
  'y Maestranza sube su subetapa sobre su hermana');

-- ============================================ 5. El avance, a mano
-- Etapas de arriba: Ensamblaje (0), Habilitado con 2 subetapas (una terminada:
-- 50), Habilitado: Caja (0), Ensamblaje: Caja (0), Arenado y pintura terminada
-- (100). Sin reportes. Resto = (0 + 50 + 0 + 0 + 100) / 5 = 30; 5 etapas, 1 terminada.
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select public.marcar_etapa_codigo(pg_temp.etapa('Corte de planchas'), 'FIN', (now() at time zone 'America/Lima')::date, null);
reset role;
select pg_temp.como('supervisor_acb');
set local role authenticated;
select public.marcar_etapa_codigo(pg_temp.etapa('Arenado y pintura'), 'FIN', (now() at time zone 'America/Lima')::date, null);
reset role;
select test.afirmar(
  (select round(resto, 2) = 30 and etapas = 5 and etapas_terminadas = 1 and resto_por = 'ETAPAS'
     from public.codigo_interno_avance_calculado(current_setting('prueba.codigo'))),
  'el avance cuenta las 5 etapas de arriba; el Habilitado vale el promedio de sus subetapas (50)');

select pg_temp.como('diseno_dis');
set local role authenticated;
select test.afirmar(
  (select etapas = 5 and etapas_terminadas = 1 from public.codigos_internos_de_diseno() where codigo = current_setting('prueba.codigo')),
  'la lista de Diseño cuenta las mismas etapas de arriba');
reset role;

-- Maestranza quita su subetapa; ahí Diseño ya puede quitar el Habilitado si quiere.
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select public.quitar_etapa_codigo(pg_temp.etapa('Corte de planchas'));
select public.quitar_etapa_codigo(pg_temp.etapa('Plegado y rolado'));
reset role;
select pg_temp.como('diseno_dis');
set local role authenticated;
select public.quitar_etapa_codigo(pg_temp.etapa('Habilitado'));
select test.debe_fallar($q$delete from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo')$q$,
  'nadie borra etapas', 'permission denied');
reset role;
select test.afirmar(
  (select count(*) from public.codigo_etapas where codigo_interno = current_setting('prueba.codigo') and quitada_en is null) = 4,
  'quitadas, no borradas: quedan Ensamblaje, el par de la caja y Arenado y pintura');

rollback;
