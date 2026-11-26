-- SSOMA, entrega 15.1 (migraciones 20261125150000 y 20261125150100).
--
-- Cualquier cuenta reporta un accidente, un incidente o una condición insegura,
-- con número de la casa (RI-…) y hasta cuatro fotos. Quién lo reportó lo ven
-- SSOMA, Gerencia y su autor; el área donde pasó ve el hecho sin el nombre, sin
-- el puesto y sin las fotos; el resto, nada. Por un operario sin cuenta reporta
-- su supervisor, y de RR. HH. sale solo nombre, cargo y área. No se borra ni se
-- corrige: SSOMA lo anula con su motivo.
--
-- Probado con el rol real de cada puesto y `set local role authenticated`,
-- nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000460', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T460', 'Taller de pruebas de SSOMA') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma460@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia460@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Abel', 'Almacén', 'almacen460@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Alma', 'Almacén Dos', 'almacen2.460@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen2_id \gset
select test.crear_usuario('Saúl', 'Supervisor', 'supervisor460@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas460@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh460@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
-- El armazón (el área de cada cuenta) lo monta el administrador; lo que se prueba, nunca.
select test.crear_usuario('Ada', 'Administradora', 'admin460@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.almacen2', :'almacen2_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.alm', (select id::text from public.areas where codigo = 'ALM'), true);
select set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
select set_config('prueba.r1', gen_random_uuid()::text, true);
select set_config('prueba.r2', gen_random_uuid()::text, true);
select set_config('prueba.r3', gen_random_uuid()::text, true);
select set_config('prueba.f1', :'almacen_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.f2', :'almacen_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.webp', true);
select set_config('prueba.suelta', :'almacen_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.falta', :'almacen_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);

-- Las dos cuentas de Almacén trabajan en el área de Almacén; el supervisor, en Producción.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = current_setting('prueba.alm')::uuid
 where id in (current_setting('prueba.almacen')::uuid, current_setting('prueba.almacen2')::uuid);
update public.usuarios set area_id = current_setting('prueba.prd')::uuid where id = current_setting('prueba.sup')::uuid;
-- La cuenta de SSOMA que traen las migraciones (la de producción, 20261126600000) se
-- apaga: el check prueba que el aviso le llega a la suya, una vez.
update public.usuarios u set activo = false
 where u.id <> current_setting('prueba.ssoma')::uuid and u.activo and u.rol_id = (select id from public.roles where codigo = 'SSOMA');
select set_config('request.jwt.claim.sub', '', true);

-- Un operario sin cuenta, de la lista de RR. HH.
do $$
declare v_t uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Óscar', 'Operario Check', '46046046', 'Soldador', current_setting('prueba.prd')::uuid)
  returning id into v_t;
  perform set_config('prueba.trabajador', v_t::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    (select count(*) = 3 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
      where r.codigo = 'SSOMA' and rp.permiso_codigo in ('ssoma.gestionar', 'ssoma.ver', 'ssoma.reportar_por_otro')),
    'el puesto de SSOMA existe con sus tres permisos');
  perform test.afirmar(
    not exists (select 1 from public.permisos p where p.codigo like 'ssoma.%'
                   and not exists (select 1 from public.roles_permisos rp where rp.permiso_codigo = p.codigo)),
    'ningún permiso de SSOMA quedó sin puesto que lo tenga');
  perform test.afirmar(
    (select formato = 'RI-{numero}-{anio}' and correlativo_actual = 0 from public.series_documentarias
      where tipo = 'REPORTE_INCIDENTE' and serie = '001'),
    'la serie del reporte es RI-0001-año y empieza en cero');
  perform test.afirmar(
    not exists (select 1 from pg_trigger where tgrelid in ('public.ssoma_reportes'::regclass, 'public.ssoma_reporte_fotos'::regclass)
                   and tgname ilike '%audit%'),
    'las tablas de SSOMA no copian al autor a la auditoría genérica');
  perform test.afirmar(
    not has_table_privilege('authenticated', 'public.ssoma_reportes', 'insert')
    and not has_table_privilege('authenticated', 'public.ssoma_reportes', 'update')
    and not has_table_privilege('authenticated', 'public.ssoma_reportes', 'delete')
    and not has_table_privilege('anon', 'public.ssoma_reportes', 'select')
    and not has_function_privilege('anon', 'public.ssoma_reportar(uuid, text, uuid, text, text, timestamptz, boolean, uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_reportes_visibles(uuid)', 'execute'),
    'la tabla se escribe solo por sus funciones y nada es del anónimo');
end $$;

-- ============================================================ 1. Las fotos en Storage
-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
begin
  -- Almacén (cualquier cuenta) sube las fotos a su carpeta.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-ssoma', current_setting('prueba.f1'), current_setting('prueba.almacen'), '{"mimetype": "image/jpeg", "size": 240000}'),
    ('fotos-ssoma', current_setting('prueba.f2'), current_setting('prueba.almacen'), '{"mimetype": "image/webp", "size": 180000}'),
    ('fotos-ssoma', current_setting('prueba.suelta'), current_setting('prueba.almacen'), '{"mimetype": "image/jpeg", "size": 1000}');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-ssoma') = 3,
    'quien reporta ve las fotos que acaba de subir');
  reset role;

  -- Otra cuenta no sube a una carpeta ajena ni ve las fotos sueltas de otra.
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-ssoma'', %L, %L, ''{}'')',
      current_setting('prueba.almacen') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.almacen2')),
    'nadie sube a la carpeta de otra cuenta', 'row-level security');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-ssoma') = 0,
    'las fotos sueltas de otra cuenta no se ven');
  reset role;
end $$;

-- ============================================================ 2. Reportar
create or replace function pg_temp.reportar(p_id text, p_tipo text, p_area text, p_lugar text, p_que text, p_cuando text,
                                           p_atencion text, p_trabajador text, p_fotos jsonb)
returns text language sql as $$
  select format('select * from public.ssoma_reportar(%L, %L, %L, %L, %L, %L, %s, %L, %L::jsonb)',
                p_id, p_tipo, p_area, p_lugar, p_que, p_cuando, coalesce(p_atencion, 'null'), p_trabajador, p_fotos);
$$;

do $$
declare
  v_numero text;
  v_avisos int;
begin
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;

  -- Lo que no entra, y por qué.
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'OTRO', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null, '[]'), 'el tipo es uno de los tres', 'Elige qué reportas');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', null, 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null, '[]'), 'sin área no entra', 'Elige el área');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'P2',
      'Una caja cayó del estante alto', null, null, null, '[]'), 'el lugar se escribe', 'lugar exacto');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Cayó', null, null, null, '[]'), 'la descripción cuenta qué pasó', 'al menos 10');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', (now() + interval '2 hours')::text, null, null, '[]'), 'no pasó en el futuro', 'futuras');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', (now() - interval '31 days')::text, null, null, '[]'), 'ni hace más de 30 días', '30 días');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, 'true', null, '[]'), 'la atención médica es solo del accidente', 'solo en un accidente');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, current_setting('prueba.trabajador'), '[]'),
    'Almacén no reporta a nombre de otro', 'a nombre de otra persona');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null,
      (select jsonb_agg(current_setting('prueba.f1')) from generate_series(1, 5))), 'van hasta 4 fotos', 'hasta 4');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null,
      jsonb_build_array(replace(current_setting('prueba.f1'), current_setting('prueba.almacen'), current_setting('prueba.almacen2')))),
    'ni una foto de otra cuenta', 'Vuelve a poner');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.falta'))),
    'una foto que no terminó de subir no se anota', 'no terminó de subir');
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f1'))), 'la misma foto dos veces no', 'repetida');
  reset role;
  perform test.afirmar(
    (select count(*) from public.ssoma_reportes) = 0
    and (select correlativo_actual from public.series_documentarias where tipo = 'REPORTE_INCIDENTE') = 0,
    'ningún intento fallido dejó un reporte a medias ni gastó un número');

  -- Entra con sus dos fotos, y el mismo envío repetido no entra dos veces.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  execute pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), '  Pasillo   2 ',
      'Una caja cayó del estante alto', null, null, null,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2'))) into v_numero;
  execute pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), '  Pasillo   2 ',
      'Una caja cayó del estante alto', null, null, null,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2')));
  -- El mismo id con otra cosa: dice que ya quedó, no lo da por guardado.
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'ACCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto y golpeó a alguien', null, 'true', null,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2'))),
    'el reenvío con otros datos dice que ya quedó la primera vez', 'la primera vez que lo enviaste');
  reset role;

  perform test.afirmar(
    (select count(*) = 1 and min(numero) = 'RI-0001-' || to_char(now() at time zone 'America/Lima', 'YYYY')
            and min(lugar) = 'Pasillo 2' and min(estado) = 'REPORTADO' and bool_and(registrado_por = current_setting('prueba.almacen')::uuid)
       from public.ssoma_reportes),
    'el reporte quedó una sola vez, con el número RI-0001 del año, el lugar limpio y su autor');
  perform test.afirmar(
    (select count(*) = 2 and min(orden) = 1 and max(orden) = 2 and sum(tamano_bytes) = 420000
       from public.ssoma_reporte_fotos where reporte_id = current_setting('prueba.r1')::uuid),
    'con sus dos fotos en orden, con su peso; el reintento no las duplicó');

  -- El aviso por la campana llegó a SSOMA y a nadie más.
  select count(*) into v_avisos from public.notificaciones
   where origen_tabla = 'ssoma_reportes' and origen_id = current_setting('prueba.r1')::uuid;
  perform test.afirmar(
    v_avisos = 1
    and exists (select 1 from public.notificaciones where origen_id = current_setting('prueba.r1')::uuid
                   and usuario_id = current_setting('prueba.ssoma')::uuid and ruta = '/ssoma/' || current_setting('prueba.r1')
                   and titulo like 'Incidente reportado en Almacén: RI-0001-%'),
    'el aviso le llegó a SSOMA, una vez, con su número y su enlace');

  -- Otra cuenta con el id de un reporte ajeno no lo pisa ni lo lee.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.reportar(current_setting('prueba.r1'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 2',
      'Una caja cayó del estante alto', null, null, null, '[]'),
    'el id de un reporte ajeno no se reusa', 'ya existe con otros datos');
  reset role;
end $$;

-- El supervisor reporta un accidente a nombre de su operario sin cuenta.
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 1 and min(nombre) = 'Operario Check Óscar' and min(cargo) = 'Soldador' and min(area) = 'Producción'
       from public.ssoma_personal_para_elegir() where id = current_setting('prueba.trabajador')::uuid),
    'el supervisor elige al operario de la lista de RR. HH.: nombre, cargo y área, nada más');
  execute pg_temp.reportar(current_setting('prueba.r2'), 'ACCIDENTE', current_setting('prueba.prd'), 'Nave 1, zona de soldadura',
      'Se soltó el disco de la amoladora al cambiarlo y alcanzó al operario', (now() - interval '2 hours')::text, 'true',
      current_setting('prueba.trabajador'), '[]');
  reset role;
  perform test.afirmar(
    (select numero like 'RI-0002-%' and hubo_atencion and trabajador_id = current_setting('prueba.trabajador')::uuid
       from public.ssoma_reportes where id = current_setting('prueba.r2')::uuid),
    'el accidente quedó con el número siguiente, a nombre del operario y con que hubo atención');

  -- Quien no reporta por otros no lee la lista de RR. HH.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.ssoma_personal_para_elegir()',
    'Almacén no lee la lista de RR. HH.', 'a nombre de otra persona');
  reset role;
end $$;

-- ============================================================ 3. Quién ve qué
do $$
declare v record;
begin
  -- SSOMA: todo, con quién reportó.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 2 and bool_and(alcance = 'TODOS') and bool_and(reporto is not null) and bool_and(dias_en_espera = 0)
       from public.ssoma_reportes_visibles(null)),
    'SSOMA ve los dos reportes, con quién los reportó y los días en espera');
  select * into v from public.ssoma_reportes_visibles(current_setting('prueba.r2')::uuid);
  perform test.afirmar(v.reporto = 'Saúl Supervisor' and v.reporto_puesto = 'Supervisor' and v.a_nombre_de = 'Óscar Operario Check'
                       and v.a_nombre_de_cargo = 'Soldador' and v.area_codigo = 'PRD',
    'del accidente ve quién lo reportó, su puesto y a nombre de quién');
  perform test.afirmar((select count(*) from public.ssoma_reportes) = 2 and (select count(*) from public.ssoma_reporte_fotos) = 2,
    'y lee la tabla y las fotos directo');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-ssoma') = 2,
    'en Storage ve las dos fotos anotadas, no la suelta de otro');
  reset role;

  -- Gerencia consulta: lo mismo.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 2 and bool_and(alcance = 'TODOS') and bool_and(reporto is not null) from public.ssoma_reportes_visibles(null))
    and (select count(*) from public.ssoma_reportes) = 2
    and (select count(*) from storage.objects where bucket_id = 'fotos-ssoma') = 2,
    'Gerencia ve los dos reportes con quién los reportó, y sus fotos');
  perform test.debe_fallar(format('select public.ssoma_anular_reporte(%L, %L)', current_setting('prueba.r1'), 'Gerencia intenta anularlo'),
    'Gerencia consulta: no anula', 'No tienes permiso para anular');
  reset role;

  -- Quien reportó: lo suyo completo, y lo de su área (ninguno más aquí).
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 1 and bool_and(alcance = 'PROPIO') and bool_and(reporto = 'Abel Almacén') and bool_and(fotos = 2)
       from public.ssoma_reportes_visibles(null)),
    'quien reportó ve su reporte completo, con sus dos fotos, y no el accidente de Producción');
  perform test.afirmar((select count(*) from public.ssoma_reportes) = 1 and (select count(*) from public.ssoma_reporte_fotos) = 2,
    'en la tabla lee solo el suyo');
  reset role;

  -- La otra cuenta de Almacén: el hecho de su área, sin nombre, sin puesto y sin fotos.
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  select * into v from public.ssoma_reportes_visibles(null);
  perform test.afirmar(
    (select count(*) = 1 from public.ssoma_reportes_visibles(null))
    and v.id = current_setting('prueba.r1')::uuid and v.alcance = 'AREA' and v.descripcion = 'Una caja cayó del estante alto'
    and v.reporto is null and v.reporto_puesto is null and v.a_nombre_de is null and v.fotos = 0 and v.anulo is null,
    'el área ve el hecho sin quién lo reportó, sin su puesto y sin fotos');
  perform test.afirmar(
    (select count(*) from public.ssoma_reportes) = 0 and (select count(*) from public.ssoma_reporte_fotos) = 0
    and (select count(*) from storage.objects where bucket_id = 'fotos-ssoma') = 0,
    'y por la tabla y por Storage no lee nada: el nombre no sale por otra puerta');
  reset role;

  -- Ventas, que no es del área ni reportó: nada.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_reportes_visibles(null)) = 0 and (select count(*) from public.ssoma_reportes) = 0,
    'quien no es del área ni lo reportó no ve ninguno');
  reset role;

  -- El autor no sale por la auditoría.
  perform test.afirmar(
    not exists (select 1 from public.audit_log where tabla in ('ssoma_reportes', 'ssoma_reporte_fotos')),
    'la auditoría genérica no tiene copia de los reportes');
end $$;

-- ============================================================ 4. No se borra ni se corrige: se anula
do $$
declare
  v_r record;
begin
  -- Ni por debajo, sin sesión.
  perform test.debe_fallar(format('delete from public.ssoma_reportes where id = %L', current_setting('prueba.r1')),
    'un reporte no se borra', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_reportes set descripcion = ''Otra cosa distinta'' where id = %L', current_setting('prueba.r1')),
    'ni se corrige lo que dice', 'no se corrige');
  perform test.debe_fallar(format('delete from public.ssoma_reporte_fotos where reporte_id = %L', current_setting('prueba.r1')),
    'sus fotos tampoco se borran', 'quedan como evidencia');

  -- Quien reportó no quita de Storage la foto anotada, y sí la suelta.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'fotos-ssoma';
  perform test.afirmar(
    (select count(*) = 2 and bool_and(name in (current_setting('prueba.f1'), current_setting('prueba.f2')))
       from storage.objects where bucket_id = 'fotos-ssoma'),
    'de Storage se va solo la foto suelta: las dos anotadas se quedan');
  -- Quien reportó no anula.
  perform test.debe_fallar(format('select public.ssoma_anular_reporte(%L, %L)', current_setting('prueba.r1'), 'Me equivoqué de área al reportar'),
    'quien reportó no anula: lo pide a SSOMA', 'No tienes permiso para anular');
  reset role;

  -- SSOMA anula con motivo.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_reporte(%L, %L)', current_setting('prueba.r1'), 'corto'),
    'sin motivo no se anula', 'por qué se anula');
  perform public.ssoma_anular_reporte(current_setting('prueba.r1')::uuid, '  Se reportó dos veces el mismo hecho  ');
  -- El mismo pedido repetido (la respuesta se perdió) entra; con otro motivo se dice, no se finge.
  perform public.ssoma_anular_reporte(current_setting('prueba.r1')::uuid, 'Se reportó dos veces el mismo hecho');
  perform test.debe_fallar(format('select public.ssoma_anular_reporte(%L, %L)', current_setting('prueba.r1'), 'Otro motivo que ya no entra'),
    'anularlo otra vez con otro motivo no finge que se guardó', 'ya estaba anulado');
  reset role;
  perform test.afirmar(
    (select estado = 'ANULADO' and anulado_por = current_setting('prueba.ssoma')::uuid and anulado_en is not null
            and motivo_anulacion = 'Se reportó dos veces el mismo hecho' and numero like 'RI-0001-%'
       from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid),
    'quedó anulado con su motivo, quién y cuándo, y conserva su número; repetir el pedido no cambia nada');
  perform test.afirmar(
    exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacen')::uuid
               and origen_id = current_setting('prueba.r1')::uuid and titulo like 'SSOMA anuló tu reporte RI-0001-%'),
    'a quien lo reportó le llegó el aviso de la anulación');
  perform test.debe_fallar(format('update public.ssoma_reportes set estado = ''REPORTADO'', anulado_por = null, anulado_en = null, motivo_anulacion = null where id = %L',
      current_setting('prueba.r1')), 'el anulado queda congelado', 'queda como evidencia');

  -- El anulado: su autor lo sigue viendo con el motivo; el área ya no.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 1 and bool_and(estado = 'ANULADO') and bool_and(motivo_anulacion is not null) and bool_and(anulo = 'Sara Seguridad')
            and bool_and(dias_en_espera is null)
       from public.ssoma_reportes_visibles(null)),
    'quien reportó ve que SSOMA lo anuló y por qué');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_reportes_visibles(null)) = 0, 'el área ya no ve el anulado');
  reset role;

  -- El número anulado no se vuelve a dar.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  execute pg_temp.reportar(current_setting('prueba.r3'), 'CONDICION_INSEGURA', current_setting('prueba.alm'), 'Puerta de despacho',
      'Cable pelado junto a la puerta de despacho', null, null, null, '[]');
  reset role;
  perform test.afirmar(
    (select numero like 'RI-0003-%' from public.ssoma_reportes where id = current_setting('prueba.r3')::uuid),
    'Ventas, que no es de Almacén, reporta igual; el número sigue en 3, sin reusar el anulado');

  -- El camino de todos los días: con SSOMA activa, la función dice que el aviso le llegó a SSOMA.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  perform test.afirmar(public.ssoma_a_quien_se_aviso(current_setting('prueba.r3')::uuid) = 'SSOMA',
    'con SSOMA activa, el aviso le llegó a SSOMA y la función lo dice');

  -- Sin nadie de SSOMA con cuenta activa, el aviso le llega a Gerencia y la
  -- función lo dice: la pantalla no puede decir «ya le avisamos a SSOMA».
  -- El armazón (apagar la cuenta de SSOMA) lo hace el administrador.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set activo = false where id = current_setting('prueba.ssoma')::uuid;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform set_config('prueba.r4', gen_random_uuid()::text, true);
  execute pg_temp.reportar(current_setting('prueba.r4'), 'CONDICION_INSEGURA', current_setting('prueba.alm'), 'Puerta de despacho',
      'Extintor vencido junto a la puerta de despacho', null, null, null, '[]') into v_r;
  reset role;
  perform test.afirmar(v_r.avisado = 'GERENCIA'
      and exists (select 1 from public.notificaciones where origen_id = current_setting('prueba.r4')::uuid
                     and usuario_id = current_setting('prueba.gerente')::uuid and titulo like 'Condición insegura reportada en Almacén: RI-%'),
    'sin SSOMA con cuenta, le avisa a Gerencia, con «reportada» en femenino, y dice a quién avisó');
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set activo = true where id = current_setting('prueba.ssoma')::uuid;

  -- El plazo de 30 días es para la gente: SSOMA registra lo que le contaron tarde.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform set_config('prueba.r5', gen_random_uuid()::text, true);
  execute pg_temp.reportar(current_setting('prueba.r5'), 'INCIDENTE', current_setting('prueba.alm'), 'Pasillo 3',
      'Se cayó una plancha del estante; nos lo contaron hoy', (now() - interval '35 days')::text, null, null, '[]') into v_r;
  reset role;
  perform test.afirmar(v_r.avisado = 'TU' and v_r.numero_reporte like 'RI-%', 'SSOMA registra un hecho de hace 35 días, y la función sabe que es de SSOMA');

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  -- La anulación la sella el disparador, no solo la función: por debajo de ella
  -- (una migración, el administrador en el editor) no entra sin motivo, ni con
  -- quién y cuándo inventados, ni se anota un motivo a un reporte vigente.
  perform test.debe_fallar(format('update public.ssoma_reportes set estado = ''ANULADO'', anulado_por = %L, anulado_en = now() where id = %L',
      current_setting('prueba.vendedor'), current_setting('prueba.r3')), 'sin motivo no se anula, ni por debajo', 'escribe el motivo');
  perform test.debe_fallar(format('update public.ssoma_reportes set motivo_anulacion = ''Un motivo suelto sin anular'' where id = %L',
      current_setting('prueba.r3')), 'a un reporte vigente no se le anota motivo', 'se anotan solo al anularlo');
  update public.ssoma_reportes
     set estado = 'ANULADO', anulado_por = current_setting('prueba.almacen')::uuid, anulado_en = '2020-01-01', motivo_anulacion = '  Prueba del sello por debajo  '
   where id = current_setting('prueba.r3')::uuid;
  perform test.afirmar(
    (select anulado_en = now() and anulado_por = current_setting('prueba.vendedor')::uuid and motivo_anulacion = 'Prueba del sello por debajo'
       from public.ssoma_reportes where id = current_setting('prueba.r3')::uuid),
    'quién y cuándo de la anulación los pone la base: la cuenta de la sesión y la hora, no los que vienen en el UPDATE');
end $$;

rollback;
