-- La ficha del cliente dice cómo va cada unidad (migración 20261126210000, Plan 9 · 9.2).
--
--   1. De cada unidad con OT vigente: el número de la OT, su estado en una
--      palabra y la fecha de entrega comprometida. La unidad sin OT, o con la
--      OT anulada, no sale.
--   2. El estado: ENTREGADA (salió con su acta, o la OT entregada o facturada),
--      TERMINADA, PAUSADA, EN_FABRICACION (en proceso, o la OT sin código con
--      avance) y APROBADA (todavía no empieza). La OT de una cotización se mira
--      por su código interno: recién cargada, APROBADA.
--   3. Solo eso: cuatro columnas, sin costo, margen, avance ni el id de la OT.
--   4. La lee quien lee la ficha del cliente: Ventas sí; Almacén, que no tiene
--      `clientes.ver`, no. Ventas no gana nada sobre la OT: sin `ordenes.ver`
--      sigue sin leerla, y la función le dice igual cómo va.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Las OT de prueba se siembran con los disparadores apagados
-- (`session_replication_role = replica`): lo que se prueba es la lectura.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000473', 'PRUEBAS 473 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA473', 'Taller prueba de la ficha') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR:GCO', 'GERENTE:GGE', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.473@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id, documento)
    select v_id, initcap(split_part(v, ':', 1)), 'Check 473', lower(replace(v, ':', '.')) || '.473@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2)),
           (select id from public.sedes where codigo = 'QA473'), '7347' || lpad((row_number() over ())::text, 4, '0')
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['cot', 'ot_cot', 'otra'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000473', 'QA TRANSPORTES DE LA FICHA S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990001473', 'QA OTRO CLIENTE S.A.C.') returning id::text into v;
  perform set_config('prueba.otro_cliente', v, true);
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
-- Lo que dice la función de una unidad, en una línea: «OT 9473-2026 · APROBADA · 2026-12-26».
create or replace function pg_temp.de(p_placa text) returns text language sql as $$
  select coalesce(string_agg(coalesce(e.ot_numero, '-') || ' · ' || e.estado || ' · ' || coalesce(e.fecha_entrega::text, '-'), ' | '), 'nada')
    from public.unidades_del_cliente_con_su_entrega(current_setting('prueba.cliente')::uuid) e
    join public.unidades u on u.id = e.unidad_id
   where u.placa = p_placa;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ Las unidades y sus OT
-- Ocho unidades del cliente, cada una en un estado; una sin OT; una con la OT
-- anulada; y una de otro cliente, que no debe salir.
set local session_replication_role = replica;
do $$
declare
  v_sede uuid := (select id from public.sedes where codigo = 'QA473');
  v_cli uuid := pg_temp.id('cliente');
  v record;
  v_u uuid;
  v_o uuid;
begin
  for v in select * from (values
      ('QAA-001', 'APROBADA', 0, false),
      ('QAA-002', 'EN_PROCESO', 0, false),
      ('QAA-003', 'APROBADA', 35, false),
      ('QAA-004', 'PAUSADA', 40, false),
      ('QAA-005', 'TERMINADA', 100, false),
      ('QAA-006', 'ENTREGADA', 100, false),
      ('QAA-007', 'TERMINADA', 100, true),
      ('QAA-009', 'ANULADA', 0, false),
      ('QAA-010', 'BORRADOR', 0, false),
      ('QAA-011', 'APROBADA', 0, false),
      ('QAA-012', 'APROBADA', 0, false),
      ('QAA-013', 'APROBADA', 0, false)) as t(placa, estado, avance, con_acta) loop
    insert into public.unidades (cliente_id, placa, tipo_vehiculo) values (v_cli, v.placa, 'CAMION') returning id into v_u;
    insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, estado, descripcion, avance_porcentaje, motivo_pausa, motivo_anulacion, fecha_entrega_comprometida)
    values ('9' || right(v.placa, 3) || '-2026', v_cli, v_u, v_sede, v.estado::public.estado_ot, 'Carrocería de prueba 473', v.avance,
            case when v.estado = 'PAUSADA' then 'Falta el chasis' end, case when v.estado = 'ANULADA' then 'El cliente desistió' end,
            current_setting('prueba.hoy')::date + right(v.placa, 1)::int)
    returning id into v_o;
    if v.con_acta then
      insert into public.ot_entregas (orden_id, fecha_entrega, recibe_nombre) values (v_o, current_setting('prueba.hoy')::date, 'Chofer del cliente');
    end if;
  end loop;
  insert into public.unidades (cliente_id, placa, tipo_vehiculo) values (v_cli, 'QAA-008', 'CAMION');
  -- Una OT nueva en borrador no tapa a la vigente de la unidad.
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, estado, descripcion, fecha_entrega_comprometida, creado_en)
  select '9101-2026', v_cli, u.id, v_sede, 'BORRADOR', 'Otra carrocería, sin aprobar', current_setting('prueba.hoy')::date + 60, now() + interval '1 hour'
    from public.unidades u where u.placa = 'QAA-001';
  -- Portería: la 011 salió después de abrirse su OT (entró antes); la 012 salió al
  -- arenado; la 013 salió y volvió a entrar.
  insert into public.registro_vehiculos (placa, unidad, empresa, motivo, ingreso_en, ingreso_por, salida_en, salida_por, sale_al_arenado, unidad_id)
  select u.placa, 'Camión', 'Cliente de prueba', 'FABRICACION', now() - r.entro, pg_temp.id('administracion'),
         now() + r.salio, case when r.salio is not null then pg_temp.id('administracion') end, r.arenado, u.id
    from (values ('QAA-011', interval '1 day', interval '1 hour', false),
                 ('QAA-012', interval '1 day', interval '1 hour', true),
                 ('QAA-013', interval '2 days', interval '1 hour', false),
                 ('QAA-013', interval '-2 hours', null::interval, false)) as r(placa, entro, salio, arenado)
    join public.unidades u on u.placa = r.placa and u.cliente_id = v_cli;
  insert into public.unidades (cliente_id, placa, tipo_vehiculo) values (pg_temp.id('otro_cliente'), 'QAA-OTR', 'CAMION') returning id into v_u;
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, estado, descripcion, fecha_entrega_comprometida)
  values ('9999-2026', pg_temp.id('otro_cliente'), v_u, v_sede, 'EN_PROCESO', 'Del otro cliente', current_setting('prueba.hoy')::date + 9);
end $$;
set local session_replication_role = origin;

-- La de una cotización: Ventas la sube, Gerencia la aprueba y Administración
-- carga su código y su OT. Recién cargada, su código no tiene avance.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', 'cot/' || current_setting('prueba.cot') || '/v1.pdf', current_setting('prueba.vendedor'),
        '{"mimetype": "application/pdf", "size": 120}'::jsonb);
select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
values (pg_temp.id('cot'), 'QA-473-1', pg_temp.id('cliente'), pg_temp.id('carroceria'), 'v1.pdf',
        'cot/' || current_setting('prueba.cot') || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), 47300, 'PEN');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('cot');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select public.cargar_codigo_y_ot_de_cotizacion(pg_temp.id('cot'), pg_temp.id('ot_cot'), 'qa-ci 473', '8473', 'SEMIRREMOLQUE',
  current_setting('prueba.hoy')::date + 45, 'ot/' || current_setting('prueba.ot_cot') || '/orden.pdf', 'orden.pdf', 100);
reset role;
select set_config('prueba.placa_cot', (select coalesce(u.placa, '') from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = pg_temp.id('ot_cot')), true);
select set_config('prueba.unidad_cot', (select o.unidad_id::text from public.ordenes_trabajo o where o.id = pg_temp.id('ot_cot')), true);

-- ============================================ 1 y 2. Ventas lee cómo va cada una
select pg_temp.como('vendedor');
set local role authenticated;
do $$
declare v_hoy date := current_setting('prueba.hoy')::date;
begin
  perform test.afirmar(pg_temp.de('QAA-001') = '9001-2026 · APROBADA · ' || (v_hoy + 1), 'aprobada sin empezar: APROBADA, con su fecha (' || pg_temp.de('QAA-001') || ')');
  perform test.afirmar(pg_temp.de('QAA-002') = '9002-2026 · EN_FABRICACION · ' || (v_hoy + 2), 'en proceso: EN_FABRICACION (' || pg_temp.de('QAA-002') || ')');
  perform test.afirmar(pg_temp.de('QAA-003') like '9003-2026 · EN_FABRICACION · %', 'la OT sin código con avance: EN_FABRICACION (' || pg_temp.de('QAA-003') || ')');
  perform test.afirmar(pg_temp.de('QAA-004') like '9004-2026 · PAUSADA · %', 'pausada: PAUSADA (' || pg_temp.de('QAA-004') || ')');
  perform test.afirmar(pg_temp.de('QAA-005') like '9005-2026 · TERMINADA · %', 'terminada: TERMINADA (' || pg_temp.de('QAA-005') || ')');
  perform test.afirmar(pg_temp.de('QAA-006') like '9006-2026 · ENTREGADA · %', 'entregada: ENTREGADA (' || pg_temp.de('QAA-006') || ')');
  perform test.afirmar(pg_temp.de('QAA-007') like '9007-2026 · ENTREGADA · %', 'terminada que salió con su acta: ENTREGADA (' || pg_temp.de('QAA-007') || ')');
  perform test.afirmar(pg_temp.de('QAA-008') = 'nada', 'la unidad sin OT no sale');
  perform test.afirmar(pg_temp.de('QAA-009') = 'nada', 'la de la OT anulada no sale');
  perform test.afirmar(pg_temp.de('QAA-010') = 'nada', 'la de la OT en borrador no sale: su fecha no se le prometió a nadie');
  perform test.afirmar(pg_temp.de('QAA-001') like '9001-%', 'una OT nueva en borrador no tapa a la vigente (' || pg_temp.de('QAA-001') || ')');
  perform test.afirmar(pg_temp.de('QAA-011') like '9011-2026 · ENTREGADA · %', 'Portería anotó su salida, con la OT todavía APROBADA: ENTREGADA (' || pg_temp.de('QAA-011') || ')');
  perform test.afirmar(pg_temp.de('QAA-012') like '9012-2026 · APROBADA · %', 'salió al arenado: no está entregada (' || pg_temp.de('QAA-012') || ')');
  perform test.afirmar(pg_temp.de('QAA-013') like '9013-2026 · APROBADA · %', 'salió y volvió a entrar: no está entregada (' || pg_temp.de('QAA-013') || ')');
  perform test.afirmar(
    (select e.ot_numero like '8473-%' and e.estado = 'APROBADA' and e.fecha_entrega = v_hoy + 45
       from public.unidades_del_cliente_con_su_entrega(pg_temp.id('cliente')) e where e.unidad_id = current_setting('prueba.unidad_cot')::uuid),
    'la OT de la cotización, recién cargada: APROBADA, con la fecha que puso Administración');
  perform test.afirmar(
    not exists (select 1 from public.unidades_del_cliente_con_su_entrega(pg_temp.id('cliente')) e
                  join public.unidades u on u.id = e.unidad_id where u.cliente_id <> pg_temp.id('cliente')),
    'solo las unidades de ese cliente');
  perform test.afirmar((select count(*) from public.unidades_del_cliente_con_su_entrega(pg_temp.id('cliente'))) = 11,
    'una fila por unidad con OT vigente: diez y la de la cotización');
end $$;
reset role;

-- ============================================ 3. Solo eso
select test.afirmar(
  pg_get_function_result('public.unidades_del_cliente_con_su_entrega(uuid)'::regprocedure)
    = 'TABLE(unidad_id uuid, ot_numero text, estado text, fecha_entrega date)',
  'cuatro columnas: ni costo, ni margen, ni avance, ni el id de la OT');
select test.afirmar(not has_function_privilege('anon', 'public.unidades_del_cliente_con_su_entrega(uuid)', 'execute'),
  'quien no tiene sesión no la ejecuta');

-- ============================================ 4. Quién la lee
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format('select * from public.unidades_del_cliente_con_su_entrega(%L::uuid)', current_setting('prueba.cliente')),
  'Almacén, sin clientes.ver, no la lee', 'No tienes permiso para ver los clientes');
reset role;

-- Sin `ordenes.ver`, Ventas no lee la OT, y la función le dice igual cómo va:
-- no le abre la orden.
delete from public.roles_permisos
 where permiso_codigo = 'ordenes.ver' and rol_id = (select id from public.roles where codigo = 'VENDEDOR');
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_trabajo where cliente_id = pg_temp.id('cliente')) = 0
                    and pg_temp.de('QAA-002') like '9002-2026 · EN_FABRICACION · %',
  'sin ordenes.ver no lee ninguna OT, y la ficha le dice igual en qué va su unidad');
reset role;

rollback;
