-- Calidad inspecciona por código interno y etapa (migración 20261126520000,
-- plan «Las demás áreas», entrega A.1):
--   * Calidad elige el código y la etapa, marca conforme o no conforme; lo no
--     conforme lleva su observación y fotos, y le llega al área de la etapa: a
--     su cuenta responsable, o a sus cuentas si no tiene, o a Gerencia si el
--     área no tiene a nadie;
--   * el área marca «corregido» con nota o foto; Calidad levanta o vuelve a
--     observar; nadie más;
--   * Calidad ve todo, Gerencia consulta sin registrar, cada área ve lo suyo y
--     el resto nada;
--   * no se borra ni se corrige por debajo: se anula con su motivo;
--   * no toca las etapas (no bloquea la siguiente).
-- Cada cosa con el rol que la vive y `set local role authenticated`, nunca
-- como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid; v_cli uuid; v_uni uuid;
begin
  foreach v in array array['CALIDAD:CAL:calidad', 'GERENTE:GGE:gerente', 'SUPERVISOR:PRD:sup_prd', 'OPERARIO:PRD:operario_prd',
                           'SUPERVISOR:MTZ:sup_mtz', 'DISENO:DIS:diseno', 'ADMIN::admin'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 3) || '.491@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 3), 'Check 491', split_part(v, ':', 3) || '.491@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) = 7 from public.usuarios where apellidos = 'Check 491'),
    'los siete puestos de la prueba existen');
  -- Producción y Maestranza parten sin cuenta responsable, traiga lo que traiga la base.
  update public.areas set jefe_id = null where codigo in ('PRD', 'MTZ', 'MKT');
  -- Marketing sin cuentas activas, para probar que el aviso no se pierde.
  perform test.afirmar(not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
                                    where a.codigo = 'MKT' and u.activo),
    'Marketing no tiene cuentas activas en la base de prueba');
  foreach v in array array['PRD', 'MTZ', 'MKT', 'CAL', 'ACB'] loop
    perform set_config('prueba.area_' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;

  -- Código A: tres etapas de tres áreas, y una OT abierta.
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_real, creado_por)
  values ('CHK491_A', 1, 'Ensamblado', current_setting('prueba.area_prd')::uuid, current_date - 5, current_setting('prueba.diseno')::uuid),
         ('CHK491_A', 2, 'Habilitado', current_setting('prueba.area_mtz')::uuid, null, current_setting('prueba.diseno')::uuid),
         ('CHK491_A', 3, 'Rotulado', current_setting('prueba.area_mkt')::uuid, null, current_setting('prueba.diseno')::uuid),
         -- Como «Trámites» y «Entrega» de las etapas de siempre: sin área a cargo.
         ('CHK491_A', 4, 'Entrega', null, null, current_setting('prueba.diseno')::uuid);
  perform set_config('prueba.etapa_sin_area', (select id::text from public.codigo_etapas where codigo_interno = 'CHK491_A' and orden = 4), true);
  perform set_config('prueba.etapa_prd', (select id::text from public.codigo_etapas where codigo_interno = 'CHK491_A' and orden = 1), true);
  perform set_config('prueba.etapa_mtz', (select id::text from public.codigo_etapas where codigo_interno = 'CHK491_A' and orden = 2), true);
  perform set_config('prueba.etapa_mkt', (select id::text from public.codigo_etapas where codigo_interno = 'CHK491_A' and orden = 3), true);
  -- Una etapa de otro código, para probar que no se cuela.
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, creado_por)
  values ('CHK491_Z', 1, 'De otro código', current_setting('prueba.area_prd')::uuid, current_setting('prueba.diseno')::uuid);
  perform set_config('prueba.etapa_otra', (select id::text from public.codigo_etapas where codigo_interno = 'CHK491_Z'), true);

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999491011', 'CLIENTE DE PRUEBA 491 S.A.C.') returning id into v_cli;
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK491_A', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 491 · A');
  -- Código B: OT abierta y sin etapas.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK491_B', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 491 · B');
  -- Código C: ya entregado.
  insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'CHK491_C', 'Prueba') returning id into v_uni;
  insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
  values (v_cli, v_uni, true, (select id from public.sedes order by creado_en limit 1), 'Check 491 · C');
  -- Entregarla por el camino real pide todo el circuito: se salta como en el check 461.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'ENTREGADA' where descripcion = 'Check 491 · C';
  perform set_config('session_replication_role', 'origin', true);

  perform set_config('prueba.i1', gen_random_uuid()::text, true);
  perform set_config('prueba.i2', gen_random_uuid()::text, true);
  perform set_config('prueba.i3', gen_random_uuid()::text, true);
  perform set_config('prueba.i4', gen_random_uuid()::text, true);
  perform set_config('prueba.i5', gen_random_uuid()::text, true);
  perform set_config('prueba.f1', current_setting('prueba.calidad') || '/' || current_setting('prueba.i1') || '/' || gen_random_uuid() || '.jpg', true);
  perform set_config('prueba.f2', current_setting('prueba.operario_prd') || '/' || current_setting('prueba.i1') || '/' || gen_random_uuid() || '.webp', true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.avisos(p_clave text, p_inspeccion text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid
     and origen_tabla = 'calidad_inspecciones' and origen_id = current_setting('prueba.' || p_inspeccion)::uuid;
$$;

create or replace function pg_temp.inspeccionar(p_id text, p_codigo text, p_etapa text, p_area text, p_resultado text, p_obs text, p_fotos text)
returns text language sql as $$
  select format('select * from public.calidad_inspeccionar(%L, %L, %L, %L, %L, %L, %L::jsonb)',
                current_setting('prueba.' || p_id, true), p_codigo,
                case when p_etapa is null then null else current_setting('prueba.' || p_etapa) end,
                case when p_area is null then null else current_setting('prueba.' || p_area) end,
                p_resultado, p_obs, coalesce(p_fotos, '[]'));
$$;

create or replace function pg_temp.paso(p_inspeccion text, p_tipo text, p_nota text, p_fotos text)
returns text language sql as $$
  select format('select * from public.calidad_registrar_paso(%L, %L, %L, %L, %L::jsonb)',
                gen_random_uuid(), current_setting('prueba.' || p_inspeccion), p_tipo, p_nota, coalesce(p_fotos, '[]'));
$$;

-- ============================================ 0. Puertas
do $$ begin
  perform test.afirmar(
    not has_function_privilege('anon', 'public.calidad_inspeccionar(uuid, text, uuid, uuid, text, text, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.calidad_registrar_paso(uuid, uuid, text, text, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.calidad_inspecciones_visibles(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.calidad_anotar_fotos(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.calidad_avisar_al_area(uuid, text, text)', 'execute')
    and not has_table_privilege('authenticated', 'public.calidad_inspecciones', 'insert')
    and not has_table_privilege('authenticated', 'public.calidad_inspecciones', 'update')
    and not has_table_privilege('authenticated', 'public.calidad_inspecciones', 'delete')
    and not has_table_privilege('anon', 'public.calidad_inspecciones', 'select'),
    'las tablas se escriben solo por sus funciones y nada es del anónimo');
  perform test.afirmar(
    exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
             where r.codigo = 'CALIDAD' and rp.permiso_codigo = 'calidad.inspeccionar')
    and exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                 where r.codigo = 'CALIDAD' and rp.permiso_codigo = 'codigos_internos.seguimiento')
    and exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                 where r.codigo = 'GERENTE' and rp.permiso_codigo = 'calidad.ver')
    and not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                     where r.codigo = 'GERENTE' and rp.permiso_codigo = 'calidad.inspeccionar'),
    'Calidad inspecciona y ve los códigos en lectura; Gerencia solo consulta');
end $$;

-- ============================================ 1. Qué se inspecciona
select pg_temp.como('calidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.calidad_codigos_para_inspeccionar() where codigo in ('CHK491_A', 'CHK491_B')) = 2,
    'Calidad ve los dos códigos con OT abierta');
  perform test.afirmar(not exists (select 1 from public.calidad_codigos_para_inspeccionar() where codigo = 'CHK491_C'),
    'el código ya entregado no se ofrece');
  perform test.afirmar((select etapas from public.calidad_codigos_para_inspeccionar() where codigo = 'CHK491_A') = 4
    and (select etapas from public.calidad_codigos_para_inspeccionar() where codigo = 'CHK491_B') = 0,
    'cada código dice cuántas etapas tiene');
  perform test.afirmar((select count(*) from public.calidad_etapas_del_codigo('chk491_a')) = 4
    and (select area from public.calidad_etapas_del_codigo('CHK491_A') where orden = 1) = (select nombre from public.areas where codigo = 'PRD'),
    'las etapas del código salen con su área, escriba el código como lo escriba');
end $$;
reset role;

select pg_temp.como('diseno');
set local role authenticated;
select test.debe_fallar('select * from public.calidad_codigos_para_inspeccionar()', 'Diseño no lista lo que se inspecciona', 'permiso');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_prd', null, 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'Diseño no inspecciona', 'permiso');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_prd', null, 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'Gerencia consulta, no inspecciona', 'permiso');
reset role;

-- ============================================ 2. Las fotos en Storage
-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
select pg_temp.como('calidad');
set local role authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-calidad', current_setting('prueba.f1'), current_setting('prueba.calidad'), '{"mimetype": "image/jpeg", "size": 240000}');
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-calidad'', %L, %L, ''{}'')',
      current_setting('prueba.sup_prd') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.calidad')),
    'nadie sube a la carpeta de otra cuenta', 'row-level security');
end $$;
reset role;

-- ============================================ 3. Inspeccionar
select pg_temp.como('calidad');
set local role authenticated;
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_prd', null, 'NO_CONFORME', 'mal', null),
  'lo no conforme sin observación no entra', 'al menos 10');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_otra', null, 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'una etapa de otro código no entra', 'ya no es de');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', null, 'area_prd', 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'un código con etapas pide la etapa', 'Elige la etapa');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_prd', 'area_mtz', 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'la observación va al área de la etapa, no a otra', 'otra área');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_C', null, 'area_prd', 'CONFORME', null, null),
  'un código ya entregado no se inspecciona', 'Elige un código');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_B', null, null, 'CONFORME', null, null),
  'un código sin etapas pide el área', 'Elige el área');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_B', null, 'area_mkt', 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'elegida a mano, un área de oficina no entra (el aviso iría a quien no hizo el trabajo)', 'Elige el área de la planta');
select test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_B', null, 'area_cal', 'NO_CONFORME', 'Soldadura con poros en el larguero', null),
  'elegida a mano, Calidad no se observa a sí misma', 'Elige el área de la planta');
select test.debe_fallar(pg_temp.inspeccionar('i5', 'CHK491_A', 'etapa_sin_area', null, 'CONFORME', null, null),
  'una etapa sin área a cargo pide el área', 'Elige el área que hizo');
select test.debe_fallar(pg_temp.inspeccionar('i5', 'CHK491_A', 'etapa_sin_area', 'area_mkt', 'CONFORME', null, null),
  'en la etapa sin área, la elegida también es de la planta', 'Elige el área de la planta');

do $$
declare r record;
begin
  select * into r from public.calidad_inspeccionar(current_setting('prueba.i1')::uuid, 'chk491_a', current_setting('prueba.etapa_prd')::uuid, null,
    'NO_CONFORME', '  Soldadura con poros en el larguero  ', jsonb_build_array(current_setting('prueba.f1')));
  perform test.afirmar(r.inspeccion = current_setting('prueba.i1')::uuid and r.avisado = 'AREA',
    'lo no conforme entra y, sin responsable, le llega a las cuentas del área');
  -- Lo mismo otra vez (se perdió la respuesta): la misma, sin otro aviso.
  select * into r from public.calidad_inspeccionar(current_setting('prueba.i1')::uuid, 'chk491_a', current_setting('prueba.etapa_prd')::uuid, null,
    'NO_CONFORME', '  Soldadura con poros en el larguero  ', jsonb_build_array(current_setting('prueba.f1')));
  perform test.afirmar(r.inspeccion = current_setting('prueba.i1')::uuid, 'el mismo envío repetido da la misma inspección');
  perform test.debe_fallar(pg_temp.inspeccionar('i1', 'CHK491_A', 'etapa_prd', null, 'NO_CONFORME', 'Otra cosa distinta que se cambió', null),
    'el reenvío con otra cosa dice que ya quedó', 'ya quedó registrada');
  -- Conforme, en un código sin etapas: va al área elegida y no avisa.
  select * into r from public.calidad_inspeccionar(current_setting('prueba.i2')::uuid, 'CHK491_B', null, current_setting('prueba.area_mtz')::uuid,
    'CONFORME', '', '[]');
  perform test.afirmar(r.avisado = 'NADIE', 'lo conforme no avisa a nadie');
  -- La etapa sin área, con el área que eligió Calidad: entra con esa área.
  select * into r from public.calidad_inspeccionar(current_setting('prueba.i5')::uuid, 'CHK491_A',
    current_setting('prueba.etapa_sin_area')::uuid, current_setting('prueba.area_acb')::uuid, 'CONFORME', '', '[]');
  perform test.afirmar(r.inspeccion = current_setting('prueba.i5')::uuid
    and (select area_codigo from public.calidad_inspecciones_visibles(current_setting('prueba.i5')::uuid)) = 'ACB'
    and (select etapa from public.calidad_inspecciones_visibles(current_setting('prueba.i5')::uuid)) = 'Entrega',
    'la etapa sin área entra con el área que eligió Calidad');
end $$;
reset role;

do $$ begin
  perform test.afirmar((select estado from public.calidad_inspecciones where id = current_setting('prueba.i1')::uuid) = 'OBSERVADA'
    and (select observacion from public.calidad_inspecciones where id = current_setting('prueba.i1')::uuid) = 'Soldadura con poros en el larguero'
    and (select codigo_interno from public.calidad_inspecciones where id = current_setting('prueba.i1')::uuid) = 'CHK491_A'
    and (select count(*) from public.calidad_fotos where inspeccion_id = current_setting('prueba.i1')::uuid and paso_id is null) = 1,
    'la inspección queda observada, con su código normalizado, su observación limpia y su foto');
  perform test.afirmar((select estado from public.calidad_inspecciones where id = current_setting('prueba.i2')::uuid) = 'CONFORME'
    and (select observacion from public.calidad_inspecciones where id = current_setting('prueba.i2')::uuid) is null,
    'la conforme queda conforme y sin observación');
  perform test.afirmar(pg_temp.avisos('sup_prd', 'i1') = 1 and pg_temp.avisos('operario_prd', 'i1') = 1
    and pg_temp.avisos('sup_mtz', 'i1') = 0 and pg_temp.avisos('calidad', 'i1') = 0 and pg_temp.avisos('gerente', 'i1') = 0,
    'el aviso llegó una vez a cada cuenta de Producción, y a nadie más');
  perform test.afirmar((select count(*) from public.notificaciones where origen_id = current_setting('prueba.i2')::uuid) = 0,
    'la conforme no dejó avisos');
  perform test.afirmar((select inicio_real from public.codigo_etapas where id = current_setting('prueba.etapa_prd')::uuid) = current_date - 5
    and (select fin_real from public.codigo_etapas where id = current_setting('prueba.etapa_prd')::uuid) is null,
    'la observación no toca la etapa: no bloquea la siguiente');
end $$;

-- ============================================ 4. Quién ve qué
select pg_temp.como('sup_prd');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.calidad_inspecciones) = 1
    and (select count(*) from public.calidad_inspecciones_visibles(null)) = 1
    and (select alcance from public.calidad_inspecciones_visibles(null)) = 'AREA'
    and (select puede_corregir from public.calidad_inspecciones_visibles(null))
    and not (select puede_revisar from public.calidad_inspecciones_visibles(null)),
    'Producción ve solo la suya, y le toca corregirla');
  perform test.afirmar((select etapa from public.calidad_inspecciones_visibles(current_setting('prueba.i1')::uuid)) = 'Ensamblado'
    and (select registro_puesto from public.calidad_inspecciones_visibles(current_setting('prueba.i1')::uuid)) is not null
    and (select fotos from public.calidad_inspecciones_visibles(current_setting('prueba.i1')::uuid)) = 1,
    'con la etapa, el puesto de quien inspeccionó y su foto');
  perform test.afirmar((select count(*) from public.calidad_fotos) = 1
    and (select count(*) from storage.objects where bucket_id = 'fotos-calidad') = 1,
    'Producción ve la foto de su observación, en la tabla y en Storage');
end $$;
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.calidad_inspecciones) = 1
  and (select codigo_interno from public.calidad_inspecciones_visibles(null)) = 'CHK491_B'
  and (select count(*) from public.calidad_fotos) = 0
  and (select count(*) from storage.objects where bucket_id = 'fotos-calidad') = 0,
  'Maestranza ve solo la suya, sin la foto de Producción');
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar((select count(*) from public.calidad_inspecciones) = 0
  and (select count(*) from public.calidad_inspecciones_visibles(null)) = 0
  and (select count(*) from public.calidad_pasos_de_la_inspeccion(current_setting('prueba.i1')::uuid)) = 0
  and (select count(*) from public.calidad_fotos) = 0
  and (select count(*) from storage.objects where bucket_id = 'fotos-calidad') = 0,
  'Diseño, que no es de ninguna de las dos áreas, no ve nada');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.calidad_inspecciones_visibles(null)) = 3
  and (select count(*) from public.calidad_fotos) = 1
  and not (select bool_or(puede_revisar or puede_corregir) from public.calidad_inspecciones_visibles(null)),
  'Gerencia ve las tres con su foto, sin botones');
reset role;

-- ============================================ 5. Corregir, volver a observar, levantar
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.debe_fallar(pg_temp.paso('i1', 'CORREGIDA', 'Se volvió a soldar', null), 'otra área no marca corregido', 'solo el área');
reset role;
select pg_temp.como('calidad');
set local role authenticated;
select test.debe_fallar(pg_temp.paso('i1', 'CORREGIDA', 'Se volvió a soldar', null), 'Calidad no marca corregido por el área', 'solo el área');
select test.debe_fallar(pg_temp.paso('i1', 'OBSERVADA_DE_NUEVO', 'Sigue con poros', null), 'no se vuelve a observar lo que el área no corrigió', 'marcó corregido');
reset role;
select pg_temp.como('operario_prd');
set local role authenticated;
select test.debe_fallar(pg_temp.paso('i1', 'CORREGIDA', '', null), 'corregido sin nota ni foto no entra', 'pon una foto');
select test.debe_fallar(pg_temp.paso('i1', 'LEVANTADA', null, null), 'el área no levanta su propia observación', 'Solo Calidad');
do $$
declare r record;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-calidad', current_setting('prueba.f2'), current_setting('prueba.operario_prd'), '{"mimetype": "image/webp", "size": 90000}');
  select * into r from public.calidad_registrar_paso(gen_random_uuid(), current_setting('prueba.i1')::uuid, 'CORREGIDA', null,
    jsonb_build_array(current_setting('prueba.f2')));
  perform test.afirmar(r.estado = 'CORREGIDA' and r.avisado = 'CALIDAD', 'Producción la marca corregida con una foto, y le llega a Calidad');
end $$;
select test.debe_fallar(pg_temp.paso('i1', 'CORREGIDA', 'Otra vez corregido', null), 'no se marca corregido dos veces', 'ya no espera');
reset role;
select test.afirmar(pg_temp.avisos('calidad', 'i1') = 1, 'a Calidad le llegó un aviso de la corrección');

select pg_temp.como('calidad');
set local role authenticated;
select test.debe_fallar(pg_temp.paso('i1', 'OBSERVADA_DE_NUEVO', 'poros', null), 'volver a observar pide qué sigue mal', 'al menos 10');
do $$
declare r record;
begin
  select * into r from public.calidad_registrar_paso(gen_random_uuid(), current_setting('prueba.i1')::uuid, 'OBSERVADA_DE_NUEVO',
    'Siguen dos poros en la unión trasera', '[]');
  perform test.afirmar(r.estado = 'OBSERVADA' and r.avisado = 'AREA', 'Calidad la vuelve a observar y le llega al área');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('sup_prd', 'i1') = 2, 'Producción recibió la segunda observación');

select pg_temp.como('sup_prd');
set local role authenticated;
select * from public.calidad_registrar_paso(gen_random_uuid(), current_setting('prueba.i1')::uuid, 'CORREGIDA', 'Se esmerilaron y soldaron los dos poros', '[]') \gset paso_
reset role;
select pg_temp.como('calidad');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.calidad_registrar_paso(gen_random_uuid(), current_setting('prueba.i1')::uuid, 'LEVANTADA', null, '[]');
  perform test.afirmar(r.estado = 'LEVANTADA', 'Calidad la levanta');
end $$;
reset role;
select pg_temp.como('operario_prd');
set local role authenticated;
select test.debe_fallar(pg_temp.paso('i1', 'CORREGIDA', 'Se corrigió de nuevo', null), 'una levantada no se vuelve a corregir', 'levantada');
select test.afirmar((select string_agg(tipo, ',' order by creado_en) from public.calidad_pasos_de_la_inspeccion(current_setting('prueba.i1')::uuid))
  = 'CORREGIDA,OBSERVADA_DE_NUEVO,CORREGIDA,LEVANTADA'
  and (select fotos from public.calidad_pasos_de_la_inspeccion(current_setting('prueba.i1')::uuid) order by creado_en limit 1) = 1,
  'el área ve el recorrido entero, con la foto de su corrección');
reset role;

-- ============================================ 6. Con responsable, el aviso va a su cuenta
update public.areas set jefe_id = current_setting('prueba.sup_prd')::uuid where codigo = 'PRD';
select pg_temp.como('calidad');
set local role authenticated;
select test.afirmar((select avisado from public.calidad_inspeccionar(current_setting('prueba.i3')::uuid, 'CHK491_A',
  current_setting('prueba.etapa_prd')::uuid, null, 'NO_CONFORME', 'Falta el refuerzo del travesaño', '[]')) = 'RESPONSABLE',
  'con cuenta responsable, el aviso va a ella');
-- Un área sin nadie: el aviso le llega a Gerencia.
select test.afirmar((select avisado from public.calidad_inspeccionar(current_setting('prueba.i4')::uuid, 'CHK491_A',
  current_setting('prueba.etapa_mkt')::uuid, null, 'NO_CONFORME', 'El rotulado no sigue el diseño', '[]')) = 'GERENCIA',
  'si el área no tiene cuenta activa, el aviso le llega a Gerencia');
-- El mismo envío otra vez (se perdió la respuesta) dice a quién llegó de verdad.
select test.afirmar((select avisado from public.calidad_inspeccionar(current_setting('prueba.i3')::uuid, 'CHK491_A',
  current_setting('prueba.etapa_prd')::uuid, null, 'NO_CONFORME', 'Falta el refuerzo del travesaño', '[]')) = 'RESPONSABLE'
  and (select avisado from public.calidad_inspeccionar(current_setting('prueba.i4')::uuid, 'CHK491_A',
  current_setting('prueba.etapa_mkt')::uuid, null, 'NO_CONFORME', 'El rotulado no sigue el diseño', '[]')) = 'GERENCIA',
  'el reenvío idéntico repite a quién llegó (responsable o Gerencia), sin otro aviso');
reset role;
select test.afirmar(pg_temp.avisos('sup_prd', 'i3') = 1 and pg_temp.avisos('operario_prd', 'i3') = 0,
  'solo el responsable recibió la observación con responsable');
select test.afirmar(pg_temp.avisos('gerente', 'i4') = 1, 'Gerencia recibió la del área sin nadie');

-- ============================================ 7. No se borra ni se corrige por debajo
select test.debe_fallar(format('delete from public.calidad_inspecciones where id = %L', current_setting('prueba.i3')),
  'una inspección no se borra, ni como dueño de la tabla', 'no se borra');
select test.debe_fallar(format('update public.calidad_inspecciones set observacion = ''Otra observación cualquiera'' where id = %L', current_setting('prueba.i3')),
  'lo que dice la inspección no se corrige', 'no se corrige');
select test.debe_fallar(format('delete from public.calidad_inspeccion_pasos where inspeccion_id = %L', current_setting('prueba.i1')),
  'el recorrido no se borra', 'evidencia');
select test.debe_fallar(format('delete from public.calidad_fotos where inspeccion_id = %L', current_setting('prueba.i1')),
  'las fotos no se borran', 'evidencia');
select pg_temp.como('calidad');
set local role authenticated;
do $$
declare v integer;
begin
  -- La política no la deja ver para borrar: cero filas, sin error.
  delete from storage.objects where name = current_setting('prueba.f1');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'quien la subió no quita de Storage la foto que una inspección nombra');
end $$;
reset role;
select test.afirmar((select count(*) from storage.objects where name = current_setting('prueba.f1')) = 1,
  'la foto anotada sigue en Storage');

-- ============================================ 8. Anular
select pg_temp.como('sup_prd');
set local role authenticated;
select test.debe_fallar(format('select public.calidad_anular_inspeccion(%L, ''Se registró por error en Producción'')', current_setting('prueba.i3')),
  'el área no anula', 'permiso');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar(format('select public.calidad_anular_inspeccion(%L, ''Se registró por error en Producción'')', current_setting('prueba.i3')),
  'Gerencia no anula', 'permiso');
reset role;
select pg_temp.como('calidad');
set local role authenticated;
select test.debe_fallar(format('select public.calidad_anular_inspeccion(%L, ''error'')', current_setting('prueba.i3')),
  'anular pide el motivo', '10 a 500');
select public.calidad_anular_inspeccion(current_setting('prueba.i3')::uuid, 'Se registró en el código equivocado');
select public.calidad_anular_inspeccion(current_setting('prueba.i3')::uuid, 'Se registró en el código equivocado');
select test.debe_fallar(format('select public.calidad_anular_inspeccion(%L, ''Otro motivo distinto del primero'')', current_setting('prueba.i3')),
  'una anulada no se anula con otro motivo', 'ya estaba anulada');
select test.debe_fallar(pg_temp.paso('i3', 'LEVANTADA', null, null), 'una anulada no se levanta', 'anulada');
reset role;
select test.afirmar((select estado from public.calidad_inspecciones where id = current_setting('prueba.i3')::uuid) = 'ANULADA'
  and (select anulado_por from public.calidad_inspecciones where id = current_setting('prueba.i3')::uuid) = current_setting('prueba.calidad')::uuid
  and pg_temp.avisos('sup_prd', 'i3') = 2,
  'queda anulada con quién y cuándo, y al responsable le llegó que quedó sin efecto');
select test.debe_fallar(format('update public.calidad_inspecciones set motivo_anulacion = ''Otro motivo cualquiera'' where id = %L', current_setting('prueba.i3')),
  'una anulada queda congelada', 'anulada');
select pg_temp.como('sup_prd');
set local role authenticated;
-- El aviso de la anulación lleva a la ficha: el área la ve, anulada y sin botones.
select test.afirmar((select estado from public.calidad_inspecciones_visibles(null) where id = current_setting('prueba.i3')::uuid) = 'ANULADA'
  and (select not puede_corregir and not puede_revisar and motivo_anulacion is not null
         from public.calidad_inspecciones_visibles(current_setting('prueba.i3')::uuid))
  and exists (select 1 from public.calidad_inspecciones where id = current_setting('prueba.i3')::uuid),
  'el área ve la anulada, con su motivo y sin botones (el aviso no lleva a una ficha vacía)');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select anulo_puesto is not null and motivo_anulacion = 'Se registró en el código equivocado'
                       from public.calidad_inspecciones_visibles(current_setting('prueba.i3')::uuid)),
  'Gerencia la ve anulada, con el puesto de quien la anuló y su motivo');
reset role;

rollback;
