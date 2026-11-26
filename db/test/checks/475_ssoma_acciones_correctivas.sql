-- SSOMA, entrega 15.2 (migración 20261126150000).
--
-- SSOMA clasifica el reporte (R.M. 050-2013-TR), anota la causa y encarga
-- acciones correctivas a una cuenta, con fecha límite. El responsable las ve y
-- las cierra con evidencia (qué se hizo y fotos). SSOMA reabre, reasigna o
-- anula con motivo. El reporte se cierra solo cuando todas sus acciones lo
-- están. La clasificación y la causa las ven solo SSOMA y Gerencia; quien
-- reportó y el área ven qué se corrige; el responsable ve el hecho sin quién lo
-- reportó.
--
-- Probado con el rol real de cada puesto y `set local role authenticated`,
-- nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000475', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T475', 'Taller de pruebas de SSOMA') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma475@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Sixto', 'Seguridad Dos', 'ssoma2.475@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma2_id \gset
select test.crear_usuario('Gilda', 'General', 'supgeneral475@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia475@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Abel', 'Almacén', 'almacen475@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Alma', 'Almacén Dos', 'almacen2.475@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen2_id \gset
select test.crear_usuario('Saúl', 'Supervisor', 'supervisor475@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas475@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Iván', 'Inactivo', 'inactivo475@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as inactivo_id \gset
-- El armazón (áreas, cuenta inactiva, una fecha vencida) lo monta el administrador o
-- el dueño de la base; lo que se prueba, nunca.
select test.crear_usuario('Ada', 'Administradora', 'admin475@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ssoma2', :'ssoma2_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.almacen2', :'almacen2_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.inactivo', :'inactivo_id', true);
select set_config('prueba.alm', (select id::text from public.areas where codigo = 'ALM'), true);
select set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
select set_config('prueba.r1', gen_random_uuid()::text, true);
select set_config('prueba.r2', gen_random_uuid()::text, true);
select set_config('prueba.a1', gen_random_uuid()::text, true);
select set_config('prueba.a2', gen_random_uuid()::text, true);
select set_config('prueba.a3', gen_random_uuid()::text, true);
select set_config('prueba.c1', gen_random_uuid()::text, true);
select set_config('prueba.c2', gen_random_uuid()::text, true);
select set_config('prueba.c3', gen_random_uuid()::text, true);
select set_config('prueba.e1', :'sup_id' || '/' || current_setting('prueba.c1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.e2', :'sup_id' || '/' || current_setting('prueba.c2') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.e3', :'sup_id' || '/' || current_setting('prueba.c3') || '/' || gen_random_uuid() || '.webp', true);

-- Las cuentas de Almacén trabajan en Almacén; el supervisor, en Producción. Una cuenta inactiva.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = current_setting('prueba.alm')::uuid
 where id in (current_setting('prueba.almacen')::uuid, current_setting('prueba.almacen2')::uuid);
update public.usuarios set area_id = current_setting('prueba.prd')::uuid where id = current_setting('prueba.sup')::uuid;
update public.usuarios set activo = false where id = current_setting('prueba.inactivo')::uuid;
select set_config('request.jwt.claim.sub', '', true);

-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    (select bool_and(c.relrowsecurity) from pg_class c
      where c.oid in ('public.ssoma_clasificaciones'::regclass, 'public.ssoma_acciones'::regclass,
                      'public.ssoma_accion_eventos'::regclass, 'public.ssoma_accion_fotos'::regclass)),
    'las cuatro tablas nuevas tienen RLS');
  perform test.afirmar(
    not exists (select 1 from unnest(array['public.ssoma_clasificaciones', 'public.ssoma_acciones',
                                           'public.ssoma_accion_eventos', 'public.ssoma_accion_fotos']) t
                 where has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update')
                    or has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')),
    'se escriben solo por sus funciones y el anónimo no las lee');
  perform test.afirmar(
    not exists (select 1 from pg_trigger where tgrelid = 'public.ssoma_clasificaciones'::regclass and tgname ilike '%audit%'),
    'la causa no se copia a la auditoría genérica');
  perform test.afirmar(
    not exists (select 1 from pg_trigger
                 where tgrelid in ('public.ssoma_acciones'::regclass, 'public.ssoma_accion_eventos'::regclass,
                                   'public.ssoma_accion_fotos'::regclass)
                   and tgname ilike '%audit%'),
    'las acciones tampoco: su copia la leería quien tiene auditoria.ver sin ver SSOMA');
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.ssoma_recalcular_reporte(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.ssoma_anotar_evidencia(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.ssoma_avisar_a(uuid, text, text, text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_cerrar_accion(uuid, uuid, text, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_acciones_visibles(uuid, uuid)', 'execute'),
    'los ayudantes internos no los llama la gente y nada es del anónimo');
end $$;

-- ============================================================ 1. Dos reportes de Almacén
do $$
begin
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform public.ssoma_reportar(current_setting('prueba.r1')::uuid, 'CONDICION_INSEGURA', current_setting('prueba.alm')::uuid,
    'Pasillo 3, estante alto', 'El estante alto no tiene tope y las cajas se deslizan', null, null, null, '[]'::jsonb);
  perform public.ssoma_reportar(current_setting('prueba.r2')::uuid, 'INCIDENTE', current_setting('prueba.alm')::uuid,
    'Puerta de carga', 'La puerta de carga bajó sola casi hasta el piso', null, null, null, '[]'::jsonb);
  reset role;
end $$;

-- ============================================================ 2. Clasificar
create or replace function pg_temp.clasificar(p_rep text, p_clase text, p_atencion text, p_dias text, p_causa text)
returns text language sql as $$
  select format('select public.ssoma_clasificar(%L, %L, %s, %s, %L)',
                p_rep, p_clase, coalesce(p_atencion, 'null'), coalesce(p_dias, 'null'), p_causa);
$$;
create or replace function pg_temp.crear(p_id text, p_rep text, p_que text, p_resp text, p_fecha text)
returns text language sql as $$
  select format('select public.ssoma_crear_accion(%L, %L, %L, %L, %L)', p_id, p_rep, p_que, p_resp, p_fecha);
$$;

do $$
declare
  v_causa constant text := 'El estante se armó sin el tope que trae de fábrica';
begin
  -- Quien reportó y Gerencia no clasifican; nadie que no sea SSOMA encarga acciones.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, null, v_causa),
    'quien reportó no clasifica', 'lo clasifica SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, null, v_causa),
    'Gerencia consulta, no clasifica', 'lo clasifica SSOMA');
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.sup'), current_setting('prueba.hoy')),
    'Gerencia no encarga acciones', 'la encarga SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.sup'), current_setting('prueba.hoy')),
    'sin clasificar no lleva acciones: primero la causa', 'Primero clasifica');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'OTRA', null, null, v_causa),
    'la clasificación es una de la lista', 'Elige la clasificación');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'ACCIDENTE_LEVE', null, null, v_causa),
    'del accidente se marca la atención médica', 'atención médica');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'ACCIDENTE_INCAPACITANTE', 'true', null, v_causa),
    'el incapacitante lleva sus días perdidos', 'días de descanso');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, '3', v_causa),
    'los días perdidos son solo del incapacitante', 'solo en un accidente incapacitante');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', 'false', null, v_causa),
    'la atención médica es solo del accidente', 'solo en un accidente');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, null, 'Descuido'),
    'la causa se escribe', 'Anota la causa');

  execute pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, null, v_causa);
  -- La misma otra vez (se perdió la respuesta) no suma otra fila.
  execute pg_temp.clasificar(current_setting('prueba.r1'), 'CONDICION_INSEGURA', null, null, v_causa);
  reset role;
  perform test.afirmar(
    (select count(*) from public.ssoma_clasificaciones where reporte_id = current_setting('prueba.r1')::uuid) = 1
    and (select estado from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid) = 'CLASIFICADO',
    'clasificado una vez, y el reporte pasa a CLASIFICADO');

  -- Se corrige: queda la historia, vale la última.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  execute pg_temp.clasificar(current_setting('prueba.r1'), 'INCIDENTE_PELIGROSO', null, null, v_causa || ', y nadie lo revisó');
  perform test.afirmar(
    (select clasificacion = 'INCIDENTE_PELIGROSO' and causa like '%nadie lo revisó' and clasifico = 'Sara Seguridad'
       from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid])),
    'SSOMA ve la última clasificación, con su causa y quién la puso');
  reset role;
  perform test.afirmar((select count(*) from public.ssoma_clasificaciones where reporte_id = current_setting('prueba.r1')::uuid) = 2,
    'la clasificación anterior queda guardada');

  -- Quien reportó y su área no ven la clasificación ni la causa; Gerencia sí.
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select clasificacion is null and causa is null and clasifico is null
       from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid])),
    'el área ve el reporte sin la clasificación ni la causa');
  perform test.afirmar((select count(*) from public.ssoma_clasificaciones) = 0,
    'y la tabla de la clasificación no se la deja leer');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select clasificacion = 'INCIDENTE_PELIGROSO' from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid]))
    and (select count(*) from public.ssoma_clasificaciones) = 2,
    'Gerencia ve la clasificación');
  reset role;
end $$;

-- ============================================================ 3. Encargar acciones
do $$
declare
  v_aviso public.notificaciones%rowtype;
begin
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.sup'), current_setting('prueba.hoy')),
    'quien reportó no encarga acciones', 'la encarga SSOMA');
  perform test.debe_fallar('select * from public.ssoma_cuentas_para_asignar()',
    'ni lee la lista de cuentas para encargar', 'la encarga SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.ssoma_cuentas_para_asignar() where id = current_setting('prueba.sup')::uuid and area = 'Producción')
    and not exists (select 1 from public.ssoma_cuentas_para_asignar() where id = current_setting('prueba.inactivo')::uuid),
    'SSOMA elige entre las cuentas activas, con su área');
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Tope',
      current_setting('prueba.sup'), current_setting('prueba.hoy')),
    'la acción dice qué se hace', 'qué se tiene que hacer');
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.inactivo'), current_setting('prueba.hoy')),
    'no se encarga a una cuenta inactiva', 'cuentas activas');
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date - 1)::text),
    'la fecha límite no es de ayer', 'anterior a hoy');
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope al estante alto',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date + 400)::text),
    'ni de dentro de más de un año', 'un año');

  execute pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), '  Poner   el tope al estante alto ',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date + 3)::text);
  -- El mismo envío repetido devuelve la misma; el mismo id con otra cosa dice que ya quedó.
  execute pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), '  Poner   el tope al estante alto ',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date + 3)::text);
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), 'Poner el tope y revisar los demás',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date + 3)::text),
    'el mismo id con otra cosa dice que ya quedó', 'la primera vez');
  execute pg_temp.crear(current_setting('prueba.a2'), current_setting('prueba.r1'), 'Revisar los demás estantes del almacén',
      current_setting('prueba.almacen2'), current_setting('prueba.hoy'));
  reset role;

  -- El id del formulario es de quien lo abrió: otra cuenta de SSOMA con el mismo id no recibe «ok».
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.crear(current_setting('prueba.a1'), current_setting('prueba.r1'), '  Poner   el tope al estante alto ',
      current_setting('prueba.sup'), (current_setting('prueba.hoy')::date + 3)::text),
    'otra cuenta con el mismo id no recibe la acción de otro como suya', 'Vuelve a abrir el formulario');
  reset role;

  perform test.afirmar(
    (select count(*) from public.ssoma_acciones where reporte_id = current_setting('prueba.r1')::uuid) = 2
    and (select descripcion = 'Poner el tope al estante alto' and area_id = current_setting('prueba.alm')::uuid and estado = 'ABIERTA'
           and creado_por = current_setting('prueba.ssoma')::uuid
           from public.ssoma_acciones where id = current_setting('prueba.a1')::uuid)
    and (select count(*) from public.ssoma_accion_eventos where accion_id = current_setting('prueba.a1')::uuid and tipo = 'ASIGNADA') = 1,
    'la acción quedó una vez, con el área del reporte, abierta y con su asignación en la historia');
  select * into v_aviso from public.notificaciones
   where usuario_id = current_setting('prueba.sup')::uuid and origen_id = current_setting('prueba.a1')::uuid;
  perform test.afirmar(
    v_aviso.titulo like 'Acción correctiva a tu cargo (RI-%): vence el %'
    and v_aviso.ruta = '/ssoma/' || current_setting('prueba.r1') || '#accion-' || current_setting('prueba.a1'),
    'al responsable le llega el aviso, que lleva a la acción: ' || coalesce(v_aviso.titulo, 'sin aviso'));
end $$;

-- ============================================================ 4. Quién ve las acciones
do $$
declare
  v record;
begin
  -- El responsable ve el hecho como el área: sin quién lo reportó ni las fotos.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  select * into v from public.ssoma_reportes_visibles(current_setting('prueba.r1')::uuid);
  perform test.afirmar(v.alcance = 'ACCION' and v.reporto is null and v.reporto_puesto is null and v.fotos = 0,
    'el responsable ve el reporte sin quién lo reportó (alcance ' || coalesce(v.alcance, 'ninguno') || ')');
  perform test.afirmar(
    (select count(*) from public.ssoma_reportes_visibles(current_setting('prueba.r2')::uuid)) = 0,
    'y no ve otro reporte que no tiene a cargo ni es de su área');
  perform test.afirmar(
    (select count(*) = 1 and bool_and(alcance = 'RESPONSABLE' and id = current_setting('prueba.a1')::uuid)
       from public.ssoma_acciones_visibles(null, null)),
    've su acción y no la de otra persona del mismo reporte');
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones) = 1 and (select count(*) from public.ssoma_accion_eventos) = 1,
    'en la tabla lee su acción y su historia, nada más');
  perform test.afirmar((select count(*) from public.ssoma_historia_de_accion(current_setting('prueba.a2')::uuid)) = 0,
    'la historia de una acción ajena le sale vacía');
  reset role;

  -- Quien reportó ve qué se corrige, a cargo de quién y hasta cuándo, sin la evidencia.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 2 and bool_and(alcance = 'REPORTE' and fotos = 0 and responsable is not null)
       from public.ssoma_acciones_visibles(current_setting('prueba.r1')::uuid, null)),
    'quien reportó ve las dos acciones de su reporte');
  perform test.afirmar((select count(*) from public.ssoma_acciones) = 0,
    'pero no la tabla de acciones');
  perform test.afirmar(
    (select acciones = 2 and abiertas = 2 and vencidas = 0
       from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid])),
    'y cuántas van abiertas');
  reset role;

  -- Ventas, que no reportó ni es del área ni tiene acciones, no ve nada.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones_visibles(null, null)) = 0
    and (select count(*) from public.ssoma_acciones) = 0
    and (select count(*) from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid, current_setting('prueba.r2')::uuid])) = 0,
    'Ventas no ve acciones ajenas');
  reset role;

  -- Gerencia, todas.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) = 2 and bool_and(alcance = 'TODOS') from public.ssoma_acciones_visibles(null, null)),
    'Gerencia ve todas las acciones');
  reset role;
end $$;

-- ============================================================ 4b. auditoria.ver no abre SSOMA
do $$
begin
  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    public.tiene_permiso('auditoria.ver') and not public.puede_ver_reportes_ssoma(),
    'el Supervisor General lee la auditoría y no ve SSOMA (si no, esta prueba no prueba nada)');
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones_visibles(null, null)) = 0
    and (select count(*) from public.ssoma_acciones) = 0
    and (select count(*) from public.audit_log
          where tabla in ('ssoma_acciones', 'ssoma_accion_eventos', 'ssoma_accion_fotos', 'ssoma_clasificaciones')) = 0,
    'ni por la función, ni por la tabla, ni por la auditoría');
  reset role;
end $$;

-- ============================================================ 5. La vencida
-- El dueño de la base la pone con fecha de anteayer: así queda una que pasó su fecha.
update public.ssoma_acciones set fecha_limite = current_setting('prueba.hoy')::date - 2 where id = current_setting('prueba.a2')::uuid;
do $$
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select dias_para_vencer = -2 from public.ssoma_acciones_visibles(null, current_setting('prueba.a2')::uuid))
    and (select dias_para_vencer = 3 from public.ssoma_acciones_visibles(null, current_setting('prueba.a1')::uuid))
    and (select vencidas = 1 and abiertas = 2 from public.ssoma_seguimiento_de_reportes(array[current_setting('prueba.r1')::uuid])),
    'la que pasó su fecha cuenta como vencida, con los días en negativo');
  reset role;
end $$;

-- ============================================================ 6. Cerrar con evidencia
create or replace function pg_temp.cerrar(p_acc text, p_evento text, p_nota text, p_fotos jsonb)
returns text language sql as $$
  select format('select public.ssoma_cerrar_accion(%L, %L, %L, %L::jsonb)', p_acc, p_evento, p_nota, p_fotos);
$$;

do $$
declare
  v_nota constant text := 'Se puso el tope de fábrica y se ajustaron los pernos';
begin
  -- El supervisor sube la foto a su carpeta.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-ssoma', current_setting('prueba.e1'), current_setting('prueba.sup'), '{"mimetype": "image/jpeg", "size": 210000}'),
    ('fotos-ssoma', current_setting('prueba.e2'), current_setting('prueba.sup'), '{"mimetype": "image/jpeg", "size": 190000}'),
    ('fotos-ssoma', current_setting('prueba.e3'), current_setting('prueba.sup'), '{"mimetype": "image/webp", "size": 90000}');
  reset role;

  -- Quien no es el responsable ni SSOMA no la cierra.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota,
      jsonb_build_array(current_setting('prueba.e1'))), 'Ventas no cierra una acción ajena', 'su responsable o SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota,
      jsonb_build_array(current_setting('prueba.e1'))), 'la responsable de otra acción no cierra esta', 'su responsable o SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota,
      jsonb_build_array(current_setting('prueba.e1'))), 'Gerencia consulta, no cierra', 'su responsable o SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota, '[]'),
    'sin foto no se cierra', 'al menos una foto');
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), 'Listo',
      jsonb_build_array(current_setting('prueba.e1'))), 'se cuenta qué se hizo', 'qué se hizo');
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota,
      jsonb_build_array(current_setting('prueba.e2'))), 'ni con la foto de la carpeta de otro cierre', 'Vuelve a poner');
  reset role;
  perform test.afirmar(
    (select estado from public.ssoma_acciones where id = current_setting('prueba.a1')::uuid) = 'ABIERTA'
    and not exists (select 1 from public.ssoma_accion_eventos where id = current_setting('prueba.c1')::uuid),
    'ningún intento fallido dejó el cierre a medias');

  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  execute pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota, jsonb_build_array(current_setting('prueba.e1')));
  -- El mismo cierre repetido entra; uno nuevo dice quién la cerró.
  execute pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota, jsonb_build_array(current_setting('prueba.e1')));
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c1'), v_nota || ' y se limpió',
      jsonb_build_array(current_setting('prueba.e1'))), 'el mismo cierre con otra nota dice que quedó el primero', 'la primera vez');
  perform test.debe_fallar(pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c2'), v_nota,
      jsonb_build_array(current_setting('prueba.e2'))), 'cerrada, otro cierre dice quién la cerró', 'ya la cerró Saúl Supervisor');
  perform test.afirmar(
    (select fotos = 1 and nota_cierre = v_nota and cerro = 'Saúl Supervisor'
       from public.ssoma_acciones_visibles(null, current_setting('prueba.a1')::uuid)),
    'el responsable ve su cierre con su foto');
  perform test.afirmar(
    (select count(*) from storage.objects where bucket_id = 'fotos-ssoma' and name = current_setting('prueba.e1')) = 1,
    'y ve la foto de la evidencia en Storage');
  delete from storage.objects where bucket_id = 'fotos-ssoma' and name = current_setting('prueba.e1');
  reset role;
  perform test.afirmar(
    (select count(*) from storage.objects where name = current_setting('prueba.e1')) = 1,
    'la foto anotada como evidencia no la quita ni quien la subió');
  perform test.afirmar(
    (select estado = 'CERRADA' and cerrado_por = current_setting('prueba.sup')::uuid and cerrado_en is not null
       from public.ssoma_acciones where id = current_setting('prueba.a1')::uuid)
    and (select count(*) from public.ssoma_accion_fotos where evento_id = current_setting('prueba.c1')::uuid) = 1
    and (select estado from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid) = 'CLASIFICADO',
    'la acción quedó cerrada con su evidencia; el reporte sigue abierto por la otra');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.ssoma')::uuid
               and n.origen_id = current_setting('prueba.a1')::uuid and n.titulo like 'Acción cerrada con evidencia (RI-%'),
    'a SSOMA le llega el aviso del cierre');

  -- Quien reportó no ve la foto de la evidencia; Gerencia sí.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from storage.objects where bucket_id = 'fotos-ssoma' and name = current_setting('prueba.e1')) = 0
    and (select nota_cierre = v_nota and fotos = 0 from public.ssoma_acciones_visibles(null, current_setting('prueba.a1')::uuid)),
    'quien reportó lee qué se hizo, sin la foto');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from storage.objects where bucket_id = 'fotos-ssoma' and name = current_setting('prueba.e1')) = 1,
    'Gerencia ve la foto de la evidencia');
  reset role;
end $$;

-- ============================================================ 7. Reabrir
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_reabrir_accion(%L, %L, %L)', current_setting('prueba.a1'),
      'No me parece suficiente', (current_setting('prueba.hoy')::date + 2)::text),
    'el responsable no se reabre su acción', 'la reabre SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_reabrir_accion(%L, %L, %L)', current_setting('prueba.a1'),
      'Falta el tope del lado derecho', (current_setting('prueba.hoy')::date - 1)::text),
    'reabrir pide una fecha nueva desde hoy', 'nueva fecha límite');
  perform public.ssoma_reabrir_accion(current_setting('prueba.a1')::uuid, 'Falta el tope del lado derecho', current_setting('prueba.hoy')::date + 2);
  -- El mismo pedido repetido entra.
  perform public.ssoma_reabrir_accion(current_setting('prueba.a1')::uuid, 'Falta el tope del lado derecho', current_setting('prueba.hoy')::date + 2);
  reset role;
  perform test.afirmar(
    (select estado = 'ABIERTA' and cerrado_por is null and nota_cierre is null and fecha_limite = current_setting('prueba.hoy')::date + 2
       from public.ssoma_acciones where id = current_setting('prueba.a1')::uuid)
    and (select count(*) from public.ssoma_accion_eventos where accion_id = current_setting('prueba.a1')::uuid) = 3
    and (select count(*) from public.ssoma_accion_fotos where evento_id = current_setting('prueba.c1')::uuid) = 1,
    'reabierta con su fecha nueva; el cierre anterior y su foto quedan en la historia');
  perform test.afirmar(
    exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.sup')::uuid
               and origen_id = current_setting('prueba.a1')::uuid and titulo like 'SSOMA reabrió tu acción correctiva%'),
    'al responsable le llega el aviso de la reapertura');

  -- La vuelve a cerrar, con otra foto en otra carpeta.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  execute pg_temp.cerrar(current_setting('prueba.a1'), current_setting('prueba.c2'), 'Se puso también el tope del lado derecho',
      jsonb_build_array(current_setting('prueba.e2')));
  perform test.afirmar(
    (select count(*) = 4 and count(*) filter (where tipo = 'CERRADA') = 2 and sum(fotos) = 2
       from public.ssoma_historia_de_accion(current_setting('prueba.a1')::uuid)),
    'el responsable ve la historia entera: asignada, cerrada, reabierta y cerrada otra vez');
  reset role;
end $$;

-- ============================================================ 8. Reasignar y el cierre del reporte
do $$
begin
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_reasignar_accion(%L, %L, %L)', current_setting('prueba.a2'),
      current_setting('prueba.sup'), current_setting('prueba.hoy')), 'la responsable no se la pasa a otro', 'la reasigna SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_reasignar_accion(%L, %L, %L)', current_setting('prueba.a2'),
      current_setting('prueba.inactivo'), current_setting('prueba.hoy')), 'ni a una cuenta inactiva', 'cuentas activas');
  perform test.debe_fallar(format('select public.ssoma_reasignar_accion(%L, %L, %L)', current_setting('prueba.a1'),
      current_setting('prueba.almacen2'), current_setting('prueba.hoy')), 'una acción cerrada no se reasigna', 'Solo se reasigna');
  perform public.ssoma_reasignar_accion(current_setting('prueba.a2')::uuid, current_setting('prueba.sup')::uuid, current_setting('prueba.hoy')::date + 5);
  reset role;
  perform test.afirmar(
    (select responsable_id = current_setting('prueba.sup')::uuid and fecha_limite = current_setting('prueba.hoy')::date + 5
       from public.ssoma_acciones where id = current_setting('prueba.a2')::uuid)
    and exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.sup')::uuid
                   and origen_id = current_setting('prueba.a2')::uuid and titulo like 'Acción correctiva a tu cargo%')
    and exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacen2')::uuid
                   and origen_id = current_setting('prueba.a2')::uuid and titulo like 'SSOMA le pasó a otra persona%'
                   and ruta = '/ssoma'),
    'reasignada: el nuevo responsable recibe el aviso y la anterior se entera, con un enlace que se le abre');

  -- La anterior la sigue viendo, porque el reporte es de su área, pero ya no como suya.
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select alcance = 'REPORTE' and fotos = 0 from public.ssoma_acciones_visibles(null, current_setting('prueba.a2')::uuid)),
    'la anterior responsable la ve como el área, ya no como suya');
  reset role;

  -- El supervisor cierra la última: el reporte se cierra y a quien lo reportó le llega el aviso.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  execute pg_temp.cerrar(current_setting('prueba.a2'), current_setting('prueba.c3'), 'Se revisaron los doce estantes y se ajustaron dos',
      jsonb_build_array(current_setting('prueba.e3')));
  reset role;
  perform test.afirmar(
    (select estado = 'CERRADO' and cerrado_en is not null from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid)
    and exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacen')::uuid
                   and origen_id = current_setting('prueba.r1')::uuid and titulo like 'Tu reporte RI-% quedó corregido'),
    'con todas sus acciones cerradas el reporte se cierra, y quien lo reportó se entera');

  -- Una acción nueva lo vuelve a abrir; anularla lo cierra otra vez.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  execute pg_temp.crear(current_setting('prueba.a3'), current_setting('prueba.r1'), 'Charla sobre el apilado en estantes altos',
      current_setting('prueba.almacen'), (current_setting('prueba.hoy')::date + 7)::text);
  reset role;
  perform test.afirmar(
    (select estado = 'CLASIFICADO' and cerrado_en is null from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid)
    and exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacen')::uuid
                   and origen_id = current_setting('prueba.r1')::uuid and titulo like 'Tu reporte RI-% volvió a corrección'),
    'una acción nueva vuelve a abrir el reporte, y quien lo reportó se entera');

  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_accion(%L, %L)', current_setting('prueba.a3'), 'No hace falta la charla'),
    'el responsable no anula su acción', 'la anula SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_accion(%L, %L)', current_setting('prueba.a1'), 'Ya no hace falta esta acción'),
    'una acción cerrada no se anula: se reabre', 'reábrela');
  perform test.debe_fallar(format('select public.ssoma_anular_reporte(%L, %L)', current_setting('prueba.r1'), 'Se reportó dos veces el mismo hecho'),
    'un reporte con acciones no se anula', 'tiene acciones correctivas');
  perform public.ssoma_anular_accion(current_setting('prueba.a3')::uuid, 'La charla ya se dio en la inducción del lunes');
  perform public.ssoma_anular_accion(current_setting('prueba.a3')::uuid, 'La charla ya se dio en la inducción del lunes');
  perform test.debe_fallar(format('select public.ssoma_anular_accion(%L, %L)', current_setting('prueba.a3'), 'Otro motivo distinto al primero'),
    'otro motivo sobre una anulada dice el que quedó', 'ya estaba anulada');
  reset role;
  perform test.afirmar(
    (select estado = 'ANULADA' and anulado_por = current_setting('prueba.ssoma')::uuid from public.ssoma_acciones where id = current_setting('prueba.a3')::uuid)
    and (select estado from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid) = 'CERRADO'
    and exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacen')::uuid
                   and origen_id = current_setting('prueba.a3')::uuid and titulo like 'SSOMA anuló tu acción%' and ruta = '/ssoma'),
    'anulada con su motivo, el reporte vuelve a cerrarse y el aviso al responsable lleva a una pantalla que se le abre');

  -- Reabrir una acción de un reporte corregido lo vuelve a abrir, y quien lo reportó se entera otra vez.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_reabrir_accion(current_setting('prueba.a2')::uuid, 'Faltan los dos estantes del fondo', current_setting('prueba.hoy')::date + 4);
  reset role;
  perform test.afirmar(
    (select estado = 'CLASIFICADO' from public.ssoma_reportes where id = current_setting('prueba.r1')::uuid)
    and (select count(*) from public.notificaciones where usuario_id = current_setting('prueba.almacen')::uuid
            and origen_id = current_setting('prueba.r1')::uuid and titulo like 'Tu reporte RI-% volvió a corrección') = 2,
    'reabrir en un reporte corregido lo devuelve a corrección y quien lo reportó se entera');

  -- El área ya no ve la anulada; SSOMA sí.
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones_visibles(current_setting('prueba.r1')::uuid, null)) = 2,
    'el área no ve la acción anulada');
  reset role;

  -- Un reporte sin acciones vigentes sí se anula; uno anulado no se clasifica.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_anular_reporte(current_setting('prueba.r2')::uuid, 'Era la misma puerta del reporte de ayer');
  perform test.debe_fallar(pg_temp.clasificar(current_setting('prueba.r2'), 'INCIDENTE', null, null, 'La puerta no tiene freno'),
    'un reporte anulado no se clasifica', 'está anulado');
  reset role;
end $$;

-- ============================================================ 9. Nada se borra ni se corrige por debajo
do $$
begin
  perform test.debe_fallar(format('delete from public.ssoma_acciones where id = %L', current_setting('prueba.a1')),
    'una acción no se borra, ni el dueño de la base', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_acciones set descripcion = %L where id = %L', 'Otra cosa que pedir', current_setting('prueba.a1')),
    'lo que pide una acción no se corrige', 'no se corrige');
  perform test.debe_fallar(format('update public.ssoma_acciones set fecha_limite = now()::date where id = %L', current_setting('prueba.a3')),
    'una anulada queda congelada', 'está anulada');
  perform test.debe_fallar(format('update public.ssoma_clasificaciones set causa = %L where reporte_id = %L', 'Otra causa escrita después', current_setting('prueba.r1')),
    'la clasificación no se corrige por debajo', 'no se cambia');
  perform test.debe_fallar(format('delete from public.ssoma_accion_eventos where accion_id = %L', current_setting('prueba.a1')),
    'la historia no se borra', 'no se cambia');
  perform test.debe_fallar(format('delete from public.ssoma_accion_fotos where evento_id = %L', current_setting('prueba.c1')),
    'la evidencia no se borra', 'no se cambia');
end $$;

-- ============================================================ 10. Lo que espera por SSOMA y quién recibe el cierre
-- `ssoma_por_atender` (cifra del Dashboard y globo) y `ssoma_hay_quien_reciba_el_cierre`
-- (el texto de «Cerrar») corren con privilegios de dueño: se prueban con el rol real.
select set_config('prueba.r3', gen_random_uuid()::text, true);
do $$
declare
  v_antes record;
  v_ahora record;
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  select * into v_antes from public.ssoma_por_atender();
  reset role;

  -- Un reporte nuevo espera su clasificación: la cifra sube en uno.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform public.ssoma_reportar(current_setting('prueba.r3')::uuid, 'INCIDENTE', current_setting('prueba.alm')::uuid,
    'Rampa de descarga', 'Una caja cayó de la rampa sin golpear a nadie', null, null, null, '[]'::jsonb);
  perform test.afirmar((select por_clasificar = 0 and sin_accion = 0 from public.ssoma_por_atender()),
    'a quien no es SSOMA ni Gerencia, ssoma_por_atender le da ceros');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  select * into v_ahora from public.ssoma_por_atender();
  perform test.afirmar(v_ahora.por_clasificar = v_antes.por_clasificar + 1 and v_ahora.sin_accion = v_antes.sin_accion,
    'un reporte nuevo suma uno a «por clasificar»');
  -- Clasificado y sin acción: pasa de una cifra a la otra.
  perform public.ssoma_clasificar(current_setting('prueba.r3')::uuid, 'INCIDENTE', null, null, 'La rampa no tiene borde de contención');
  select * into v_ahora from public.ssoma_por_atender();
  perform test.afirmar(v_ahora.por_clasificar = v_antes.por_clasificar and v_ahora.sin_accion = v_antes.sin_accion + 1,
    'clasificado sin acción: sale de «por clasificar» y entra en «sin acción»');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select por_clasificar = v_antes.por_clasificar and sin_accion = v_antes.sin_accion + 1 from public.ssoma_por_atender()),
    'Gerencia ve las mismas cifras que SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select por_clasificar = 0 and sin_accion = 0 from public.ssoma_por_atender()),
    'Ventas recibe ceros');
  reset role;

  -- Con otra cuenta de SSOMA activa, el cierre le llega a alguien.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(public.ssoma_hay_quien_reciba_el_cierre(), 'con otra cuenta de SSOMA activa, el cierre le llega a alguien');
  reset role;
end $$;

-- Sin ninguna otra cuenta de SSOMA activa (se apagan dentro de la transacción).
select test.como_usuario(:'admin_id');
update public.usuarios u set activo = false
 where u.id <> current_setting('prueba.ssoma')::uuid and u.activo
   and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'ssoma.gestionar');
do $$
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(not public.ssoma_hay_quien_reciba_el_cierre(),
    'si la única cuenta de SSOMA es quien cierra, no hay a quién avisarle');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen2')::uuid);
  set local role authenticated;
  perform test.afirmar(public.ssoma_hay_quien_reciba_el_cierre(), 'si cierra otra persona, la cuenta de SSOMA recibe el aviso');
  reset role;
end $$;

rollback;
