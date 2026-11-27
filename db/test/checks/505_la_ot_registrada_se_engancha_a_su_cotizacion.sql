-- La OT ya registrada se engancha a su cotización (migración 20261127210000;
-- StudioGRCI, 2026-11-27: «Sí, hazlo»).
-- La OT que Administración registró sin cotización (llegó antes que la venta) se
-- cuelga de la cotización aprobada de su mismo cliente, en una unidad libre, con
-- su motivo en la bitácora. Hasta aquí no había camino: con sesión, la
-- cotización de una OT cambiaba solo con «Editar OT», y solo hacia otro cliente.
-- Se comprueba:
--   * Ventas, Almacén y Gerencia no enganchan; Administración sí, y elige la unidad;
--   * la OT queda como esa unidad: la cotización cuenta una OT menos por cargar,
--     la carga que sigue toma otra unidad, la bitácora lo dice y Ventas recibe el aviso;
--   * lo que no entra: otra cotización, otro cliente, otra carrocería, la OT
--     anulada, la de garantía o mantenimiento, la del taller por revisar, la
--     que espera el visto de Gerencia, la
--     unidad ocupada, la cotización llena, la versión vieja, sin motivo;
--   * el reenvío de la misma dice «la primera vez», y el que cambió la unidad o
--     el motivo dice en qué unidad quedó y que lo cambiado no se guardó;
--   * la OT sin unidad no entra, y la del vehículo que ya es de otra OT de la
--     cotización ni se ofrece;
--   * el UPDATE directo sigue cerrado;
--   * la lista `ots_para_enganchar` ofrece solo lo que entra, y solo a Administración.
-- Cada paso con la cuenta del puesto y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000504', 'PRUEBAS 504 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA504E', 'Taller prueba 504 enganche') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA504E' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente504e@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas504e@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina504e@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen504e@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset
select test.crear_usuario('Admi', 'Sistema', 'admin504e@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000504', 'QA CLIENTE DEL ENGANCHE 504');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001504', 'QA OTRO CLIENTE 504');

select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.cliente', (select id::text from public.clientes where numero_documento = '20990000504'), true);
select set_config('prueba.otro', (select id::text from public.clientes where numero_documento = '20990001504'), true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia, id limit 1), true);
select set_config('prueba.carroceria2', (select id::text from public.tipos_carroceria where activo order by orden_secuencia, id offset 1 limit 1), true);
select set_config('prueba.cot', gen_random_uuid()::text, true);     -- 3 unidades, del cliente
select set_config('prueba.cot1', gen_random_uuid()::text, true);    -- 1 unidad, del cliente, ya con su OT
select set_config('prueba.cot_otro', gen_random_uuid()::text, true);-- 1 unidad, del otro cliente
select set_config('prueba.cot_rev', gen_random_uuid()::text, true); -- del cliente, por revisar

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Las unidades del cliente: una por OT, cada una con su código.
do $$
declare
  k text;
begin
  foreach k in array array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'x1'] loop
    insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
    values (case when k = 'x1' then current_setting('prueba.otro') else current_setting('prueba.cliente') end::uuid,
            'QA-504 ' || upper(k), 'Q5' || lpad(upper(k), 4, '0'), 'SEMIRREMOLQUE');
    perform set_config('prueba.u_' || k, (select id::text from public.unidades where codigo_interno = 'QA-504 ' || upper(k)), true);
    perform set_config('prueba.ot_' || k, gen_random_uuid()::text, true);
  end loop;
end $$;

-- Administración registra la OT sin cotización, con su PDF, como en «Nueva OT».
create function pg_temp.registrar(p_k text, p_numero text, p_tipo text, p_carroceria text, p_cliente text) returns void
language plpgsql as $$
declare
  v_ot   constant text := current_setting('prueba.ot_' || p_k);
  v_ruta constant text := 'ot/' || v_ot || '/orden.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', v_ruta, current_setting('prueba.oficina'), '{"mimetype": "application/pdf", "size": 100}');
  perform public.registrar_orden_sin_cotizacion(
    v_ot::uuid, p_numero, p_cliente::uuid, current_setting('prueba.u_' || p_k)::uuid,
    current_setting('prueba.sede')::uuid, p_carroceria::uuid, p_tipo::public.tipo_trabajo_ot, 'NORMAL',
    'Furgón que el taller empezó antes de la cotización (prueba 504)', null, null, null, null, null, null,
    v_ruta, 'orden.pdf', 100);
end $$;

-- La carga de una OT nueva desde la cotización, como lo hace Administración.
create function pg_temp.cargar(p_cot text, p_ot text, p_codigo text, p_numero text) returns uuid
language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || p_ot || '/orden.pdf', current_setting('prueba.oficina'), '{"mimetype": "application/pdf", "size": 100}');
  return public.cargar_codigo_y_ot_de_cotizacion(
    p_cot::uuid, p_ot::uuid, p_codigo, p_numero, 'SEMIRREMOLQUE',
    (now() at time zone 'America/Lima')::date + 30, 'ot/' || p_ot || '/orden.pdf', 'orden.pdf', 100);
end $$;

-- El enganche, con la versión que tiene la OT ahora.
create function pg_temp.enganchar(p_k text, p_cot text, p_unidad integer, p_motivo text default 'La OT llegó antes que su cotización (prueba 504)')
returns uuid language plpgsql as $$
begin
  return public.enganchar_ot_a_su_cotizacion(
    current_setting('prueba.ot_' || p_k)::uuid, p_cot::uuid, p_unidad,
    (select actualizado_en from public.ordenes_trabajo where id = current_setting('prueba.ot_' || p_k)::uuid), p_motivo);
end $$;

create function pg_temp.sql_enganchar(p_k text, p_cot text, p_unidad integer, p_motivo text default 'La OT llegó antes que su cotización (prueba 504)')
returns text language sql as $$
  select format('select pg_temp.enganchar(%L, %L, %s, %L)', p_k, p_cot, coalesce(p_unidad::text, 'null'), p_motivo)
$$;

create function pg_temp.ot(p_k text) returns public.ordenes_trabajo
language sql as $$ select * from public.ordenes_trabajo where id = current_setting('prueba.ot_' || p_k)::uuid $$;

-- 1. Ventas sube las cotizaciones, Gerencia aprueba, Administración registra las OT --
do $$
declare
  c record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cot'),      'QA-504-A', current_setting('prueba.cliente'), 3),
      (current_setting('prueba.cot1'),     'QA-504-B', current_setting('prueba.cliente'), 1),
      (current_setting('prueba.cot_otro'), 'QA-504-C', current_setting('prueba.otro'),   1),
      (current_setting('prueba.cot_rev'),  'QA-504-D', current_setting('prueba.cliente'), 1)) as t(id, numero, cliente, unidades)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', c.unidades);
  end loop;
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot')::uuid, current_setting('prueba.cot1')::uuid, current_setting('prueba.cot_otro')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.registrar('e1', '50401', 'FABRICACION', null, current_setting('prueba.cliente'));                      -- la que se engancha
  perform pg_temp.registrar('e2', '50402', 'REPARACION', current_setting('prueba.carroceria'), current_setting('prueba.cliente'));  -- también entra
  perform pg_temp.registrar('e3', '50403', 'FABRICACION', current_setting('prueba.carroceria2'), current_setting('prueba.cliente')); -- otra carrocería
  perform pg_temp.registrar('e4', '50404', 'MANTENIMIENTO', null, current_setting('prueba.cliente'));                    -- no es venta
  perform pg_temp.registrar('e5', '50405', 'FABRICACION', null, current_setting('prueba.cliente'));                      -- se anula
  perform pg_temp.registrar('e6', '50406', 'FABRICACION', null, current_setting('prueba.cliente'));                      -- a la llena
  perform pg_temp.registrar('x1', '50409', 'FABRICACION', null, current_setting('prueba.otro'));                         -- otro cliente
  perform pg_temp.registrar('e8', '50411', 'FABRICACION', null, current_setting('prueba.cliente'));                      -- pasa a garantía
  perform pg_temp.registrar('e9', '50412', 'FABRICACION', null, current_setting('prueba.cliente'));                      -- del taller, por revisar
  perform pg_temp.registrar('e10', '50413', 'FABRICACION', null, current_setting('prueba.cliente'));                     -- sin unidad
  -- La de una unidad ya tiene su OT, cargada desde la cotización.
  perform pg_temp.cargar(current_setting('prueba.cot1'), current_setting('prueba.ot_e7'), 'QA-504 E7', '50407');
  reset role;

  -- Gerencia aprueba la 1 (la 2 sigue esperando su visto) y anula la 5, con su motivo.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  -- Las demás también, para que cada rechazo de abajo sea por su motivo y no por el visto.
  update public.ordenes_trabajo set estado = 'APROBADA'
   where id in (select current_setting('prueba.ot_' || k)::uuid from unnest(array['e1', 'e3', 'e4', 'e6', 'e8', 'e10', 'x1']) k);
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se registró dos veces (prueba 504)'
   where id = current_setting('prueba.ot_e5')::uuid;
  reset role;

  -- Las tres raras se dejan como llegarían por otros caminos (la garantía, el
  -- taller, una OT vieja sin vehículo), sin pasar por sus disparadores.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set tipo_trabajo = 'GARANTIA' where id = current_setting('prueba.ot_e8')::uuid;
  update public.ordenes_trabajo set abierta_en_taller = true where id = current_setting('prueba.ot_e9')::uuid;
  update public.ordenes_trabajo set unidad_id = null where id = current_setting('prueba.ot_e10')::uuid;
  -- La 1 se registró diez días antes que su cotización, y el taller ya la empezó.
  update public.ordenes_trabajo set creado_en = now() - interval '10 days', estado = 'EN_PROCESO', avance_porcentaje = 40
   where id = current_setting('prueba.ot_e1')::uuid;
  perform set_config('session_replication_role', 'origin', true);

  perform test.afirmar((pg_temp.ot('e1')).cotizacion_pdf_id is null and (pg_temp.ot('e1')).estado = 'EN_PROCESO'
                       and (pg_temp.ot('e2')).estado = 'BORRADOR' and (pg_temp.ot('e5')).estado = 'ANULADA',
    'La OT registrada sin cotización: la 1 en proceso, la 2 esperando el visto de Gerencia, la 5 anulada');
end $$;

-- 2. La lista: solo a Administración, y solo lo que entra ----------------------------
do $$
declare
  v text;
  n integer;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  select string_agg(numero, ',' order by numero) into v
    from public.ots_para_enganchar(array[current_setting('prueba.cot')::uuid])
   where cotizacion_id = current_setting('prueba.cot')::uuid;
  perform test.afirmar(v = format('50401-%1$s,50406-%1$s', to_char((now() at time zone 'America/Lima')::date, 'YYYY')),
    'Administración ve para la cotización las dos OT del cliente que entran (ni la que espera el visto de Gerencia, ni la de otra carrocería, ni la de mantenimiento o garantía, ni la del taller por revisar, ni la sin unidad, ni la anulada, ni la del otro cliente, ni la que ya tiene cotización): ' || coalesce(v, 'ninguna'));
  select count(*) into n from public.ots_para_enganchar(array[current_setting('prueba.cot_rev')::uuid]);
  perform test.afirmar(n = 0, 'A la cotización por revisar no se le ofrece ninguna');
  reset role;

  foreach v in array array['ventas', 'almacen', 'gerente'] loop
    perform test.como_usuario(current_setting('prueba.' || v)::uuid);
    set local role authenticated;
    select count(*) into n from public.ots_para_enganchar(array[current_setting('prueba.cot')::uuid]);
    reset role;
    perform test.afirmar(n = 0, format('A %s no se le ofrece ninguna (%s)', v, n));
  end loop;
end $$;

-- 3. Ventas, Almacén y Gerencia no enganchan ---------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array['ventas', 'almacen', 'gerente'] loop
    perform test.como_usuario(current_setting('prueba.' || v)::uuid);
    set local role authenticated;
    perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 2),
      format('%s no engancha una OT a la cotización', v), 'la engancha a su cotización Administración');
    reset role;
  end loop;
  perform test.afirmar((pg_temp.ot('e1')).cotizacion_pdf_id is null, 'Y la OT sigue sin cotización');
end $$;

-- 4. Lo que no entra, con su motivo, como Administración ----------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 2, 'nada'),
    'sin motivo no entra', 'Explica por qué');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot_rev'), null),
    'a la cotización por revisar no', 'todavía no está aprobada');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot_otro'), null),
    'a la cotización de otro cliente no: eso va por «Editar OT»', 'es de otro cliente');
  perform test.debe_fallar(pg_temp.sql_enganchar('x1', current_setting('prueba.cot'), null),
    'la OT del otro cliente tampoco', 'es de otro cliente');
  perform test.debe_fallar(pg_temp.sql_enganchar('e3', current_setting('prueba.cot'), null),
    'la de otra carrocería no', 'otra carrocería');
  perform test.debe_fallar(pg_temp.sql_enganchar('e4', current_setting('prueba.cot'), null),
    'la de mantenimiento no es una venta', 'no es una venta');
  perform test.debe_fallar(pg_temp.sql_enganchar('e5', current_setting('prueba.cot'), null),
    'la anulada no', 'está anulada');
  perform test.debe_fallar(pg_temp.sql_enganchar('e2', current_setting('prueba.cot'), null),
    'la que espera el visto de Gerencia no: la cargada nace aprobada', 'todavía espera el visto de Gerencia');
  perform test.debe_fallar(pg_temp.sql_enganchar('e8', current_setting('prueba.cot'), null),
    'la de garantía no es una venta', 'es de garantía');
  perform test.debe_fallar(pg_temp.sql_enganchar('e9', current_setting('prueba.cot'), null),
    'la del taller que espera su revisión no', 'todavía espera su revisión');
  perform test.debe_fallar(pg_temp.sql_enganchar('e10', current_setting('prueba.cot'), null),
    'la que no tiene unidad no', 'no tiene unidad');
  perform test.debe_fallar(pg_temp.sql_enganchar('e6', current_setting('prueba.cot1'), null),
    'a la cotización llena no', 'ya tiene su OT');
  perform test.debe_fallar(pg_temp.sql_enganchar('e7', current_setting('prueba.cot'), null),
    'la que ya es de una cotización no se engancha a otra', 'ya es de otra cotización');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 4),
    'una unidad que la cotización no tiene', 'elige una de la 1 a la 3');
  perform test.debe_fallar(format('select public.enganchar_ot_a_su_cotizacion(%L, %L, 2, %L, %L)',
      current_setting('prueba.ot_e1'), current_setting('prueba.cot'), now() - interval '1 day', 'La OT llegó antes (prueba 504)'),
    'con la versión vieja de la OT no', 'cambió mientras la enganchabas');
  -- El UPDATE directo sigue cerrado: la cotización cambia solo por sus caminos.
  perform test.debe_fallar(format('update public.ordenes_trabajo set cotizacion_pdf_id = %L where id = %L',
      current_setting('prueba.cot'), current_setting('prueba.ot_e1')),
    'el UPDATE directo de la cotización sigue rechazado', 'cambia de cotización solo con');
  reset role;
  perform test.afirmar((pg_temp.ot('e1')).cotizacion_pdf_id is null, 'Nada de eso la movió');
end $$;

-- 5. Administración engancha la OT como la unidad 2 de 3 ---------------------------
do $$
declare
  v record;
  n integer;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.enganchar('e1', current_setting('prueba.cot'), 2);
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 1 and v.ordenes_faltantes = 2,
    format('La cotización, como la lee Administración: 1 OT y faltan 2 (%s y %s)', v.ordenes_vigentes, v.ordenes_faltantes));
  -- El recorrido la da por cargada hoy, cuando se enganchó, no hace diez días
  -- cuando se registró (20261127211000).
  select r.en into v from public.recorrido_de_cotizaciones(array[current_setting('prueba.cot')::uuid]) r
   where r.paso = 'CODIGO_Y_OT' and r.situacion = 'HECHO' and r.unidad = 2;
  perform test.afirmar(v.en >= now() - interval '1 hour',
    format('El recorrido da la unidad 2 por cargada cuando se enganchó, no cuando se registró la OT (%s)', v.en));
  -- Desde el enganche, las listas muestran el avance de su código interno, como
  -- toda OT de una cotización: el 40 % de sus etapas pasa al 0 % del código sin
  -- etapas de Diseño. Es lo que hace hoy con la que nace de la carga; se le dice a DKS.
  select a.avance, a.del_codigo into v from public.avance_de_ordenes(array[current_setting('prueba.ot_e1')::uuid]) a;
  perform test.afirmar(v.del_codigo and v.avance = 0,
    format('La OT en proceso enganchada lleva en las listas el avance de su código (%s %%, del código: %s)', v.avance, v.del_codigo));
  -- Ya no se ofrece, y la otra sí.
  select count(*) into n from public.ots_para_enganchar(array[current_setting('prueba.cot')::uuid]) where orden_id = current_setting('prueba.ot_e1')::uuid;
  perform test.afirmar(n = 0, 'La OT enganchada ya no sale en la lista');
  reset role;

  select o.cotizacion_pdf_id, o.numero_de_unidad, o.tipo_carroceria_id, o.cliente_id, o.descripcion, o.unidad_id into v
    from public.ordenes_trabajo o where o.id = current_setting('prueba.ot_e1')::uuid;
  perform test.afirmar(v.cotizacion_pdf_id = current_setting('prueba.cot')::uuid and v.numero_de_unidad = 2,
    format('La OT es la unidad 2 de la cotización (es la %s)', v.numero_de_unidad));
  perform test.afirmar(v.tipo_carroceria_id = current_setting('prueba.carroceria')::uuid,
    'La OT sin carrocería toma la de su cotización');
  perform test.afirmar(v.cliente_id = current_setting('prueba.cliente')::uuid and v.unidad_id = current_setting('prueba.u_e1')::uuid
                       and v.descripcion = 'Furgón que el taller empezó antes de la cotización (prueba 504)',
    'Su cliente, su vehículo y su descripción quedan como estaban');
  perform test.afirmar(not exists (select 1 from public.ot_ventas_anteriores where orden_id = current_setting('prueba.ot_e1')::uuid),
    'No es un traspaso: no deja venta anterior');
  perform test.afirmar(exists (select 1 from public.ot_bitacora b
                                where b.orden_id = current_setting('prueba.ot_e1')::uuid
                                  and b.usuario_id = current_setting('prueba.oficina')::uuid
                                  and (b.datos->>'enganche_a_cotizacion')::boolean
                                  and (b.datos->>'unidad')::integer = 2
                                  and b.descripcion like 'Enganchada a su cotización QA-504-A (unidad 2 de 3). Motivo: La OT llegó antes%'),
    'La bitácora de la OT dice la cotización, la unidad, el motivo y quién');
  perform test.afirmar(exists (select 1 from public.notificaciones x
                                where x.usuario_id = current_setting('prueba.ventas')::uuid
                                  and x.origen_id = current_setting('prueba.cot')::uuid
                                  and x.titulo = 'Tu cotización ya tiene su OT'
                                  and x.cuerpo like '%OT 50401-%, que ya estaba registrada, como la unidad 2 de 3. Faltan 2.'),
    'Ventas recibe el aviso de su cotización');
end $$;

-- 6. El reenvío, la unidad ocupada y la carga que sigue ------------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 2),
    'la misma otra vez dice que quedó la primera vez', 'la primera vez que la enviaste');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), null),
    'la misma sin elegir unidad también es el mismo envío', 'la primera vez que la enviaste');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 3),
    'reenviada con otra unidad dice en cuál quedó y que lo cambiado no se guardó',
    'ya había quedado enganchada a la cotización QA-504-A como la unidad 2 de 3 la primera vez que la enviaste: lo que cambiaste al reenviar no se guardó');
  perform test.debe_fallar(pg_temp.sql_enganchar('e1', current_setting('prueba.cot'), 2, 'Otro motivo para la misma (prueba 504)'),
    'reenviada con otro motivo tampoco es el mismo envío', 'lo que cambiaste al reenviar no se guardó');
  -- Otra OT del mismo vehículo que ya es la unidad 2: ni se ofrece.
  perform set_config('prueba.ot_e11', gen_random_uuid()::text, true);
  perform set_config('prueba.u_e11', current_setting('prueba.u_e1'), true);
  perform pg_temp.registrar('e11', '50414', 'FABRICACION', null, current_setting('prueba.cliente'));
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'APROBADA' where id = current_setting('prueba.ot_e11')::uuid;
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(not exists (select 1 from public.ots_para_enganchar(array[current_setting('prueba.cot')::uuid])
                                    where orden_id = current_setting('prueba.ot_e11')::uuid),
    'La OT de un vehículo que ya es el de otra OT de la cotización no se ofrece');
  perform test.debe_fallar(pg_temp.sql_enganchar('e6', current_setting('prueba.cot'), 2),
    'la unidad 2 ya está tomada', 'La unidad 2 de la cotización QA-504-A ya tiene su OT');
  perform test.debe_fallar(pg_temp.sql_enganchar('e7', current_setting('prueba.cot1'), null),
    'la que se cargó desde su cotización no dice «la primera vez»: dice que ya es de ella', 'ya es de la cotización QA-504-B.');
  -- La carga de una OT nueva salta la unidad 2.
  perform set_config('prueba.ot_nueva', gen_random_uuid()::text, true);
  perform pg_temp.cargar(current_setting('prueba.cot'), current_setting('prueba.ot_nueva'), 'QA-504 N1', '50410');
  reset role;
  -- Gerencia le da su visto a la 2, y entonces entra.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'APROBADA' where id = current_setting('prueba.ot_e2')::uuid;
  reset role;
  -- Y la otra OT ya registrada, sin elegir, va a la que queda: la 3.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.enganchar('e2', current_setting('prueba.cot'), null);
  reset role;
  perform test.afirmar((select numero_de_unidad from public.ordenes_trabajo where id = current_setting('prueba.ot_nueva')::uuid) = 1,
    'La carga que sigue toma la unidad 1, no la 2');
  perform test.afirmar((pg_temp.ot('e2')).numero_de_unidad = 3,
    format('La segunda, ya aprobada y sin elegir, va a la unidad que queda: la 3 (es la %s)', (pg_temp.ot('e2')).numero_de_unidad));
end $$;

-- 7. Con la cotización llena, ya no se ofrece ni entra -------------------------------
do $$
declare
  n integer;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.sql_enganchar('e6', current_setting('prueba.cot'), null),
    'la cotización con sus 3 OT no recibe otra', 'ya tiene sus 3 OT');
  select count(*) into n from public.v_cotizaciones_pdf where id = current_setting('prueba.cot')::uuid and ordenes_faltantes = 0;
  reset role;
  perform test.afirmar(n = 1, 'La cotización ya no espera ninguna OT');
end $$;

-- 8. Las marcas no quedan puestas -----------------------------------------------------
do $$
begin
  perform test.afirmar(coalesce(current_setting('metalwork.enganche_de_ot', true), '') = ''
                       and coalesce(current_setting('metalwork.enganche_unidad', true), '') = '',
    'El enganche no deja su marca puesta para el UPDATE que siga');
end $$;

rollback;
