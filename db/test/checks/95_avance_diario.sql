-- El avance diario: qué se hizo hoy en la unidad, cómo mueve la etapa y qué
-- ve cada quien.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000010', 'PRUEBAS AVANCE S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset
select test.crear_usuario('Elsa',  'Mendoza','elsa@demo.pe',  'OPERARIO', (select id from public.sedes limit 1), true, 14) as ajeno_id \gset
-- Supervisión de Producción reporta las tareas con foto (la jefatura de taller
-- se fue en la migración 20260929110100). El área la pone ADMIN.
select test.crear_usuario('Beto',  'Ríos',   'beto@demo.pe',  'SUPERVISOR', (select id from public.sedes limit 1)) as supervisor_id \gset
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'supervisor_id';
-- Desde la migración 20261016120000 el supervisor ya no lee la OT y reporta por
-- código en su reporte diario. El circuito de las tareas con foto sigue en la
-- base: como en el check 317, la prueba le devuelve `ordenes.ver` solo
-- mientras dure, para seguir cuidándolo.
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
on conflict do nothing;

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20777777772', 'TRANSPORTES DEL VALLE S.A.C.');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  values ((select id from public.clientes limit 1), 'PQR-456', 'VOLQUETE');

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, descripcion)
select (select id from public.clientes limit 1), (select id from public.unidades limit 1),
       (select id from public.sedes limit 1), tc.id, 'FABRICACION', 'Tolva de prueba'
  from public.tipos_carroceria tc where tc.codigo = 'TOLVA_VOLQUETE';

-- La aprobación dispara etapas y bitácora: monta la OT con ADMIN.
select test.como_usuario(:'admin_id');
update public.ordenes_trabajo set estado = 'APROBADA';
-- Desde la migración 20260928130000 la OT entra al taller con las etapas que
-- eligió Diseño y las fechas de Administración; el armazón las pone a mano.
insert into public.ot_etapas (orden_id, nombre, orden_secuencia, area_id, peso_pct,
                              fecha_inicio_programada, fecha_fin_programada)
select o.id, x.nombre, x.n, (select id from public.areas where codigo = x.area), x.peso,
       current_date, current_date + 7
  from public.ordenes_trabajo o
 cross join (values (1, 'Armado de bastidor', 'PRD', 60), (2, 'Pintura', 'ACB', 40)) x(n, nombre, area, peso);
update public.ordenes_trabajo set estado = 'EN_PROCESO';

-- La bitácora no acepta anotaciones de nadie: hay que estar identificado y
-- alcanzar la orden. La jefatura de taller que las veía todas ya no existe
-- (migración 20260929110100) y Supervisión dejó de leer la OT (migración
-- 20261016120000): se trabaja como el operario, que tiene `ordenes.ver`.
select test.como_usuario(:'operario_id');

-- ------------------------------------------------ el avance mueve la etapa
do $$
declare
  v_orden  uuid;
  v_etapa  uuid;
  v_avance numeric;
  v_ot     numeric;
  v_act    uuid;
begin
  select id into v_orden from public.ordenes_trabajo limit 1;
  select id into v_etapa from public.ot_etapas where orden_id = v_orden order by orden_secuencia limit 1;

  -- Desde la migración 20260928133000 el porcentaje de una etapa de Diseño no
  -- lo escribe el avance narrativo: lo mueven las tareas reportadas con foto.
  perform test.debe_fallar(
    format($sql$insert into public.ot_avances (orden_id, etapa_id, descripcion, avance_porcentaje)
                values (%L, %L, 'Avance con porcentaje a mano', 40)$sql$, v_orden, v_etapa),
    'el avance narrativo ya no fija el porcentaje de la etapa',
    'Avance de Taller con tarea y foto');

  insert into public.ot_avances (orden_id, etapa_id, descripcion, registrado_por)
  values (v_orden, v_etapa, 'Se armó el bastidor y se soldaron los travesaños', (select id from public.usuarios where correo = 'diego@demo.pe'));

  -- La tarea con foto la arma y la reporta Supervisión de Producción (el
  -- circuito completo con `set role` está en el check 317).
  perform test.como_usuario((select id from public.usuarios where correo = 'beto@demo.pe'));
  insert into storage.objects (bucket_id, name, metadata)
  values ('fotos-avance', 'ot/' || v_orden || '/taller/qa-95.jpg', '{"mimetype":"image/jpeg","size":100}');
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, (select area_id from public.ot_etapas where id = v_etapa), v_etapa, 1, 'Bastidor y travesaños', 100)
  returning id into v_act;
  insert into public.ot_actividad_avances (actividad_id, orden_id, avance_pct, nota, foto_ruta)
  values (v_act, v_orden, 40, 'Bastidor armado', 'ot/' || v_orden || '/taller/qa-95.jpg');
  perform test.como_usuario((select id from public.usuarios where correo = 'diego@demo.pe'));

  select avance_porcentaje into v_avance from public.ot_etapas where id = v_etapa;

  if v_avance <> 40 then
    raise exception 'FALLA: la etapa quedó en % y no en 40', v_avance;
  end if;
  raise notice '  ok · reportar la tarea mueve la barra de la etapa';

  if (select estado from public.ot_etapas where id = v_etapa) <> 'EN_PROCESO' then
    raise exception 'FALLA: la etapa siguió pendiente después de un avance';
  end if;
  raise notice '  ok · y una etapa pendiente se pone en proceso sola';

  select avance_porcentaje into v_ot from public.ordenes_trabajo where id = v_orden;
  if v_ot = 0 then
    raise exception 'FALLA: el avance de la etapa no subió al de la orden';
  end if;
  raise notice '  ok · el avance de la etapa sube al de la orden: % por ciento', v_ot;

  -- Y queda en la línea de tiempo, que es lo que después se le muestra al cliente.
  if not exists (
    select 1 from public.ot_bitacora
     where orden_id = v_orden and tipo_evento = 'AVANCE'
       and descripcion like 'Se armó el bastidor%'
  ) then
    raise exception 'FALLA: el avance no quedó en la bitácora de la OT';
  end if;
  raise notice '  ok · el avance queda en la línea de tiempo de la orden';
end $$;

-- ------------------------------------------------------- lo que no se acepta
do $$
declare v_orden uuid;
begin
  select id into v_orden from public.ordenes_trabajo limit 1;

  begin
    insert into public.ot_avances (orden_id, descripcion) values (v_orden, 'ok');
    raise exception 'FALLA: aceptó un avance sin descripción de verdad';
  exception when check_violation then
    raise notice '  ok · un avance necesita decir qué se hizo';
  end;

  begin
    insert into public.ot_avances (orden_id, descripcion, fecha)
      values (v_orden, 'Trabajo del futuro', current_date + 5);
    raise exception 'FALLA: aceptó un avance con fecha futura';
  exception when check_violation then
    raise notice '  ok · no se puede registrar el avance de un día que no llegó';
  end;
end $$;

-- --------------------------------------------------------- tablero por unidad
do $$
declare r record;
begin
  select * into r from public.unidad_tablero limit 1;

  if r.placa <> 'PQR-456' then
    raise exception 'FALLA: el tablero no trae la unidad, trae %', r.placa;
  end if;
  if r.ultimo_avance not like 'Se armó el bastidor%' then
    raise exception 'FALLA: el tablero no muestra el último avance';
  end if;
  if r.dias_sin_avance <> 0 then
    raise exception 'FALLA: se registró hoy y dice % días sin avance', r.dias_sin_avance;
  end if;
  raise notice '  ok · el tablero dice qué se hizo la última vez';
end $$;

-- ---------------------------------------------------- lo que traba el trabajo
do $$
declare v_orden uuid;
begin
  select id into v_orden from public.ordenes_trabajo limit 1;

  insert into public.ot_avances (orden_id, descripcion, impedimento)
  values (v_orden, 'Se paró el armado de la compuerta',
          'Falta la plancha Hardox de 8 mm; el proveedor la entrega el jueves');

  if (select impedimento from public.unidad_tablero limit 1) not like 'Falta la plancha%' then
    raise exception 'FALLA: el impedimento no salió en el tablero';
  end if;
  raise notice '  ok · lo que traba la unidad aparece en el tablero';
end $$;

-- ------------------------------------------------------------- quién ve qué
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
declare v_orden uuid;
begin
  select id into v_orden from public.ordenes_trabajo limit 1;

  perform test.afirmar(
    (select count(*) from public.ot_avances) = 2,
    'el operario ve el avance de la orden en la que trabaja');

  insert into public.ot_avances (orden_id, descripcion)
  values (v_orden, 'Se dejó lista la compuerta trasera para pintura');

  perform test.afirmar(
    (select count(*) from public.ot_avances) = 3,
    'y puede registrar el suyo');
end $$;

reset role;

select test.como_usuario(:'ajeno_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ot_avances) = 3,
    'el operario con permiso de ver órdenes ve los avances de la orden');
  perform test.afirmar(
    (select count(*) from public.unidad_tablero) = 1,
    'el tablero incluye la unidad visible para el operario');
end $$;

reset role;

-- ------------------------------------------- HALLAZGO: la etapa del tablero
-- El tablero tiene que decir en qué etapa está la unidad. La vista
-- `unidad_tablero` todavía hace INNER JOIN a `etapas_catalogo`, y desde la
-- migración 20260928135000 toda OT nueva lleva etapas libres (sin fila en el
-- catálogo): `etapa_actual` sale vacía para todas. Es el mismo fallo que el
-- check 311 encontró en el control de plazos. Se deja al final para que el
-- resto del check corra; falla hasta que se arregle la vista.
do $$
declare r record;
begin
  select * into r from public.unidad_tablero limit 1;
  if r.etapa_actual is null then
    raise exception 'FALLA (hallazgo): el tablero no dice en qué etapa está la unidad: unidad_tablero ignora las etapas libres que define Diseño';
  end if;
  raise notice '  ok · el tablero dice dónde está la unidad: %', r.etapa_actual;
end $$;

rollback;
