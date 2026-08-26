-- El avance diario: qué se hizo hoy en la unidad, cómo mueve la etapa y qué
-- ve cada quien.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000010', 'PRUEBAS AVANCE S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Beto',  'Ríos',   'beto@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset
select test.crear_usuario('Elsa',  'Mendoza','elsa@demo.pe',  'OPERARIO', (select id from public.sedes limit 1), true, 14) as ajeno_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20777777772', 'TRANSPORTES DEL VALLE S.A.C.');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  values ((select id from public.clientes limit 1), 'PQR-456', 'VOLQUETE');

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, descripcion, monto_presupuestado)
select (select id from public.clientes limit 1), (select id from public.unidades limit 1),
       (select id from public.sedes limit 1), tc.id, 'FABRICACION', 'Tolva de prueba', 40000
  from public.tipos_carroceria tc where tc.codigo = 'TOLVA_VOLQUETE';

update public.ordenes_trabajo set estado = 'APROBADA';
update public.ordenes_trabajo set estado = 'EN_PROCESO';

insert into public.ot_personal (orden_id, usuario_id, rol)
  values ((select id from public.ordenes_trabajo limit 1), :'operario_id', 'SOLDADOR');

-- La bitácora no acepta anotaciones de nadie: hay que estar identificado y
-- alcanzar la orden. Se trabaja como el jefe de taller, que las ve todas.
select test.como_usuario(:'jefe_id');

-- ------------------------------------------------ el avance mueve la etapa
do $$
declare
  v_orden  uuid;
  v_etapa  uuid;
  v_avance numeric;
  v_ot     numeric;
begin
  select id into v_orden from public.ordenes_trabajo limit 1;
  select id into v_etapa from public.ot_etapas where orden_id = v_orden order by orden_secuencia limit 1;

  insert into public.ot_avances (orden_id, etapa_id, descripcion, avance_porcentaje, registrado_por)
  values (v_orden, v_etapa, 'Se armó el bastidor y se soldaron los travesaños', 40, (select id from public.usuarios where correo = 'diego@demo.pe'));

  select avance_porcentaje into v_avance from public.ot_etapas where id = v_etapa;

  if v_avance <> 40 then
    raise exception 'FALLA: la etapa quedó en % y no en 40', v_avance;
  end if;
  raise notice '  ok · registrar el avance mueve la barra de la etapa';

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
  if r.etapa_actual is null then
    raise exception 'FALLA: el tablero no dice en qué etapa está la unidad';
  end if;
  if r.ultimo_avance not like 'Se armó el bastidor%' then
    raise exception 'FALLA: el tablero no muestra el último avance';
  end if;
  if r.dias_sin_avance <> 0 then
    raise exception 'FALLA: se registró hoy y dice % días sin avance', r.dias_sin_avance;
  end if;
  raise notice '  ok · el tablero dice dónde está la unidad y qué se hizo la última vez';
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
    (select count(*) from public.ot_avances) = 0,
    'el operario que no está en la orden no ve su avance');
  perform test.afirmar(
    (select count(*) from public.unidad_tablero) = 0,
    'ni la unidad en el tablero');
end $$;

reset role;

rollback;
