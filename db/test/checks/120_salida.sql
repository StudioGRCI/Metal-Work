-- Las reglas de salida del flujograma: liberación de tesorería, acta de
-- entrega y confirmación a portería. (Los reclamos de garantía y el check list
-- documental se fueron con sus módulos.)
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000016', 'PRUEBAS SALIDA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',    'Torres',  'ana@demo.pe',    'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Marga',  'Rojas',   'marga@demo.pe',  'COSTOS',   (select id from public.sedes limit 1)) as tesoreria_id \gset
select test.crear_usuario('Diego',  'Quispe',  'diego@demo.pe',  'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
  select id, 'F3K-101', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes limit 1;

select test.como_usuario(:'admin_id');

-- Una cotización con garantía de 12 meses, que es lo que se le prometió.
insert into public.cotizaciones (cliente_id, unidad_id, fecha_emision, garantia_meses)
  select c.id, u.id, current_date, 12
    from public.clientes c join public.unidades u on u.cliente_id = c.id limit 1;

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, cotizacion_id, descripcion, tipo_trabajo, estado)
  select c.id, u.id, s.id, q.id, 'Tolva de 15 m3 con compuerta hidráulica', 'FABRICACION', 'APROBADA'
    from public.clientes c
    join public.unidades u on u.cliente_id = c.id
    join public.cotizaciones q on q.cliente_id = c.id
    cross join public.sedes s
   limit 1;

do $$
declare v_id uuid;
begin
  select id into v_id from public.ordenes_trabajo limit 1;
  perform set_config('prueba.ot', v_id::text, true);

  -- Se recorre el camino completo hasta terminada.
  update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA'
   where orden_id = v_id and estado <> 'OMITIDA';
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_id;
  update public.ordenes_trabajo set estado = 'TERMINADA'  where id = v_id;

end $$;

-- Sin liberación, la entrega no entra.
select test.debe_fallar($$
  insert into public.ot_entregas (orden_id, recibe_nombre)
  values (current_setting('prueba.ot')::uuid, 'Chofer de flota')
$, 'sin liberación de tesorería no hay salida');

-- Un operario no puede liberar.
select test.como_usuario(:'operario_id');
set local role authenticated;
select test.debe_fallar($$
  insert into public.liberaciones_tesoreria (orden_id)
  values (current_setting('prueba.ot')::uuid)
$$, 'liberar la salida es de tesorería, no del taller');
reset role;

-- Tesorería sí.
select test.como_usuario(:'tesoreria_id');
set local role authenticated;
insert into public.liberaciones_tesoreria (orden_id, observacion)
values (current_setting('prueba.ot')::uuid, 'Al día');
reset role;

select test.como_usuario(:'admin_id');

do $$
declare
  v_id      uuid := current_setting('prueba.ot')::uuid;
  v_entrega uuid;
begin
  raise notice '  ok · tesorería liberó la salida con su permiso';

  -- La entrega entra con la garantía que se escribe en el acta; ya no se
  -- hereda de la cotización, que era un disparador del módulo de garantías.
  insert into public.ot_entregas (orden_id, recibe_nombre, recibe_documento, garantia_meses)
  values (v_id, 'Julio Ramírez', '41255678', 12)
  returning id into v_entrega;

  perform set_config('prueba.entrega', v_entrega::text, true);

  perform test.afirmar(
    (select garantia_meses from public.ot_entregas where id = v_entrega) = 12,
    'la entrega guarda los meses de garantía del acta');
  perform test.afirmar(
    (select estado from public.ordenes_trabajo where id = v_id) = 'ENTREGADA',
    'y la orden queda entregada');
end $$;

-- Con la unidad ya entregada, la cotización que la originó todavía se puede
-- anular: la guarda solo debe frenar a las órdenes que siguen en curso. Una
-- ENTREGADA no se puede anular por diseño, así que exigirlo primero dejaba a
-- toda cotización antigua sin salida, con un mensaje que mandaba a una puerta
-- tapiada.
do $$
declare v_cot uuid;
begin
  select cotizacion_id into v_cot
    from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid;

  update public.cotizaciones
     set estado = 'ANULADA', motivo_anulacion = 'Se emitió por duplicado; la unidad salió con la otra'
   where id = v_cot;

  perform test.afirmar(
    (select estado = 'ANULADA' from public.cotizaciones where id = v_cot),
    'una cotización cuya orden ya se entregó sí se puede anular');
end $$;

-- La confirmación a portería queda sellada con quién y cuándo, o no queda.
select test.debe_fallar($$
  update public.ot_entregas
     set salida_confirmada_por = (select id from public.usuarios limit 1)
   where id = current_setting('prueba.entrega')::uuid
$$, 'la confirmación a portería lleva quién y cuándo, juntos');

-- Confirmar la salida dos veces, no.
do $$
begin
  perform public.confirmar_salida_porteria(current_setting('prueba.entrega')::uuid);
  begin
    perform public.confirmar_salida_porteria(current_setting('prueba.entrega')::uuid);
    raise exception 'FALLA: se confirmó la salida dos veces';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · la salida se confirma una sola vez (%)', sqlerrm;
  end;
  perform test.afirmar(
    (select salida_confirmada_en is not null from public.ot_entregas
      where id = current_setting('prueba.entrega')::uuid),
    'y quedó sellada con fecha');
end $$;

-- --------------------------------------------------------- las fechas clave
select test.como_usuario(:'admin_id');
do $$
declare
  v_id uuid := current_setting('prueba.ot')::uuid;
  v_limite date;
begin
  select limite_os_produccion into v_limite from public.ot_fechas_clave where orden_id = v_id;

  perform test.afirmar(v_limite is not null, 'la OT tiene fecha límite para su OS de producción');
  perform test.afirmar(
    v_limite = public.sumar_dias_habiles(
      (select fecha_registro from public.ordenes_trabajo where id = v_id), 3),
    'y es a los 3 días hábiles de emitida, como dice la regla escrita');
  perform test.afirmar(
    (select limite_diseno from public.ot_fechas_clave where orden_id = v_id)
      >= v_limite,
    'el diseño vence después que la OS de producción (4 días contra 3)');

  -- Restar días hábiles es el espejo de sumar: ida y vuelta cae donde empezó.
  perform test.afirmar(
    public.restar_dias_habiles(public.sumar_dias_habiles(date '2026-03-02', 5), 5)
      = public.sumar_dias_habiles(date '2026-03-02', 0),
    'restar días hábiles deshace lo que sumar hizo');
end $$;

rollback;
