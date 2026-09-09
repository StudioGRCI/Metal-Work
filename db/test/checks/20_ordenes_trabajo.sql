-- Reglas de negocio de las órdenes de trabajo y la producción en taller.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000002', 'PRUEBAS OT S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
select test.crear_usuario('Luis', 'Mamani', 'luis@demo.pe', 'OPERARIO',
         (select id from public.sedes limit 1), true, 12.50) \gset operario_
select test.crear_usuario('Rosa', 'Yupanqui', 'rosa@demo.pe', 'JEFE_TALLER',
         (select id from public.sedes limit 1)) \gset jefe_
insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20888888888', 'MINERA LOS ANDES S.A.');
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
  select id, 'D4M-712', 'VOLQUETE', 'SCANIA', 'P410' from public.clientes limit 1;

-- --- alta de la orden -------------------------------------------------------
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, tipo_carroceria_id, descripcion, tipo_trabajo)
  select c.id, u.id, s.id, tc.id, 'Fabricación de tolva de volquete 18 m3 en acero A36', 'FABRICACION'
    from public.clientes c
    join public.unidades u on u.cliente_id = c.id
    cross join public.sedes s
    join public.tipos_carroceria tc on tc.codigo = 'TOLVA_VOLQUETE'
   limit 1;

do $$
declare v public.ordenes_trabajo;
begin
  select * into v from public.ordenes_trabajo limit 1;
  perform test.afirmar(v.numero ~ '^[0-9]{4,}-[0-9]{4}$', 'la OT recibe correlativo con el formato de la empresa (2921-2026): ' || v.numero);
  perform test.afirmar(v.estado = 'BORRADOR', 'la OT nace en borrador');
  perform test.afirmar(v.avance_porcentaje = 0, 'nace sin avance');
  perform test.afirmar(
    exists (select 1 from public.ot_bitacora where orden_id = v.id and tipo_evento = 'CREACION'),
    'la creación queda registrada en la bitácora');
  perform test.afirmar(
    not exists (select 1 from public.ot_etapas where orden_id = v.id),
    'una OT en borrador todavía no tiene etapas');
end $$;

-- --- transiciones de estado -------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.ordenes_trabajo limit 1;

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''TERMINADA'' where id = %L', v_id),
    'una OT en borrador no puede darse por terminada');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''PAUSADA'' where id = %L', v_id),
    'no se puede pausar una OT que no está en proceso');

  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_id;

  -- Los valores esperados se derivan del catálogo en lugar de escribirse a
  -- mano: la empresa ajusta sus etapas y sus días desde Configuración, y la
  -- prueba debe seguir siendo válida cuando lo haga.
  perform test.afirmar(
    (select count(*) from public.ot_etapas where orden_id = v_id)
      = (select count(*) from public.etapas_catalogo where activo),
    'al aprobar se instancian todas las etapas activas del catálogo');
  perform test.afirmar(
    (select horas_estimadas from public.ordenes_trabajo where id = v_id)
      = (select sum(horas_estandar) from public.etapas_catalogo where activo),
    'las horas estimadas de la OT suman las de sus etapas');
end $$;

-- --- pausar exige motivo ----------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.ordenes_trabajo limit 1;
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_id;

  perform test.afirmar(
    (select fecha_inicio_real is not null from public.ordenes_trabajo where id = v_id),
    'al iniciar se sella la fecha real de inicio');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''PAUSADA'' where id = %L', v_id),
    'pausar sin motivo está prohibido');

  update public.ordenes_trabajo
     set estado = 'PAUSADA', motivo_pausa = 'Falta plancha de 6 mm en almacén'
   where id = v_id;
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_id;

  perform test.afirmar(
    exists (select 1 from public.ot_bitacora where orden_id = v_id and tipo_evento = 'PAUSA'),
    'la pausa queda registrada en la bitácora');
end $$;

-- --- avance ponderado por horas ---------------------------------------------
do $$
declare
  v_id             uuid;
  v_avance         numeric;
  v_horas_etapa    numeric;
  v_horas_total    numeric;
  v_horas_omitida  numeric;
begin
  select id into v_id from public.ordenes_trabajo limit 1;

  -- Al terminar el habilitado de materia prima, el avance debe ser exactamente
  -- el peso de esa etapa sobre el total: no una etapa de catorce, sino sus
  -- horas sobre las horas de todas.
  select horas_estandar into v_horas_etapa
    from public.etapas_catalogo where codigo = 'HABILITADO_MP';
  select sum(horas_estandar) into v_horas_total
    from public.etapas_catalogo where activo;

  update public.ot_etapas e
     set avance_porcentaje = 100, estado = 'TERMINADA'
    from public.etapas_catalogo c
   where e.etapa_catalogo_id = c.id and c.codigo = 'HABILITADO_MP' and e.orden_id = v_id;

  select avance_porcentaje into v_avance from public.ordenes_trabajo where id = v_id;
  perform test.afirmar(
    round(v_avance, 1) = round(100 * v_horas_etapa / v_horas_total, 1),
    format('el avance pondera por horas de etapa: %s%% ≈ %s%%',
           round(v_avance, 2), round(100 * v_horas_etapa / v_horas_total, 2)));

  -- Una etapa omitida no debe contar ni en el numerador ni en el peso.
  update public.ot_etapas e
     set estado = 'OMITIDA'
    from public.etapas_catalogo c
   where e.etapa_catalogo_id = c.id and c.codigo = 'ARENADO' and e.orden_id = v_id;

  select horas_estandar into v_horas_omitida
    from public.etapas_catalogo where codigo = 'ARENADO';

  select avance_porcentaje into v_avance from public.ordenes_trabajo where id = v_id;
  perform test.afirmar(
    round(v_avance, 1) = round(100 * v_horas_etapa / (v_horas_total - v_horas_omitida), 1),
    format('las etapas omitidas salen del cálculo: %s%%', round(v_avance, 2)));
end $$;

-- --- la bitácora es inmutable ------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.ot_bitacora limit 1;
  perform test.debe_fallar(
    format('update public.ot_bitacora set descripcion = ''alterado'' where id = %L', v_id),
    'los eventos de la bitácora no se pueden editar');
  perform test.debe_fallar(
    format('delete from public.ot_bitacora where id = %L', v_id),
    'los eventos de la bitácora no se pueden borrar');
end $$;

-- --- cierre y anulación ------------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.ordenes_trabajo order by creado_en limit 1;
  update public.ordenes_trabajo set estado = 'CONTROL_CALIDAD' where id = v_id;

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''TERMINADA'' where id = %L', v_id),
    'no se cierra una OT con etapas sin terminar');

  -- Se cierran todas las etapas, como haría el taller antes de dar por terminada la OT.
  update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA'
   where orden_id = v_id and estado <> 'OMITIDA';

  update public.ordenes_trabajo set estado = 'TERMINADA' where id = v_id;

  perform test.afirmar(
    (select avance_porcentaje from public.ordenes_trabajo where id = v_id) = 100,
    'con todas las etapas cerradas el avance llega a 100%');

  perform test.afirmar(
    (select fecha_fin_real is not null from public.ordenes_trabajo where id = v_id),
    'al terminar se sella la fecha real de fin');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''ENTREGADA'' where id = %L', v_id),
    'no se entrega una OT sin acta de conformidad');

  -- Sin la liberación de tesorería el acta no entra: la regla del
  -- flujograma —la unidad no sale si el cliente tiene deuda— la impone la base.
  perform test.debe_fallar(
    format($sql$insert into public.ot_entregas (orden_id, recibe_nombre, recibe_documento, garantia_meses)
                values (%L, 'Carlos Huamán', '45678912', 12)$sql$, v_id),
    'no se entrega sin la liberación de tesorería');

  insert into public.liberaciones_tesoreria (orden_id, liberado_por, observacion)
  select v_id, u.id, 'Cliente al día según estado de cuenta'
    from public.usuarios u limit 1;

  -- El acta de conformidad es la que pasa la OT a ENTREGADA.
  insert into public.ot_entregas (orden_id, recibe_nombre, recibe_documento, garantia_meses)
    values (v_id, 'Carlos Huamán', '45678912', 12);

  perform test.afirmar(
    (select estado from public.ordenes_trabajo where id = v_id) = 'ENTREGADA',
    'registrar el acta pasa la OT a entregada');
  perform test.afirmar(
    (select garantia_vence from public.ot_entregas where orden_id = v_id)
      = (current_date + interval '12 months')::date,
    'la garantía vence 12 meses después de la entrega');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''EN_PROCESO'' where id = %L', v_id),
    'una OT entregada no vuelve a producción');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''ANULADA'', motivo_anulacion = ''x'' where id = %L', v_id),
    'una OT entregada tampoco se anula');
end $$;

rollback;
