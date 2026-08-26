-- El calendario laboral: qué días hay taller y cómo se cuentan los plazos.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000009', 'PRUEBAS CALENDARIO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

-- --------------------------------------------------------------- la pascua
do $$
begin
  -- Fechas comprobadas contra el calendario litúrgico.
  if public.pascua(2024) <> date '2024-03-31' then
    raise exception 'FALLA: la Pascua de 2024 salió %', public.pascua(2024);
  end if;
  if public.pascua(2025) <> date '2025-04-20' then
    raise exception 'FALLA: la Pascua de 2025 salió %', public.pascua(2025);
  end if;
  if public.pascua(2026) <> date '2026-04-05' then
    raise exception 'FALLA: la Pascua de 2026 salió %', public.pascua(2026);
  end if;
  raise notice '  ok · la Pascua se calcula bien y con ella el Jueves y el Viernes Santo';
end $$;

-- ------------------------------------------------------------- los feriados
do $$
declare v_cuantos int;
begin
  perform public.sembrar_feriados(2026);
  select count(*) into v_cuantos from public.feriados
   where extract(year from fecha) = 2026;

  -- Dieciséis fijos más Jueves y Viernes Santo; el 28 y el 29 de julio son dos.
  if v_cuantos < 16 then
    raise exception 'FALLA: 2026 quedó con solo % feriados', v_cuantos;
  end if;
  if not exists (select 1 from public.feriados where fecha = date '2026-07-28') then
    raise exception 'FALLA: falta Fiestas Patrias';
  end if;
  if not exists (select 1 from public.feriados where fecha = date '2026-04-03' and nombre = 'Viernes Santo') then
    raise exception 'FALLA: el Viernes Santo de 2026 no quedó cargado';
  end if;
  raise notice '  ok · el año quedó con sus % feriados, movibles incluidos', v_cuantos;

  -- Volver a sembrar no duplica ni pisa.
  perform public.sembrar_feriados(2026);
  if (select count(*) from public.feriados where extract(year from fecha) = 2026) <> v_cuantos then
    raise exception 'FALLA: sembrar dos veces duplicó feriados';
  end if;
  raise notice '  ok · sembrar el mismo año dos veces no duplica nada';
end $$;

-- --------------------------------------------------------- el domingo no cuenta
do $$
begin
  -- El 2026-08-28 es viernes. Sumarle 2 días de taller da el lunes 31, porque
  -- el sábado sí se trabaja y el domingo no.
  if public.sumar_dias_habiles(date '2026-08-28', 2) <> date '2026-08-31' then
    raise exception 'FALLA: viernes + 2 dio %', public.sumar_dias_habiles(date '2026-08-28', 2);
  end if;
  raise notice '  ok · el sábado cuenta y el domingo se salta';

  -- El 2026-07-25 es sábado. Con 28 y 29 feriados, sumarle 2 días lleva al
  -- jueves 30: lunes 27 cuenta, martes y miércoles no.
  if public.sumar_dias_habiles(date '2026-07-25', 2) <> date '2026-07-30' then
    raise exception 'FALLA: el plazo no saltó Fiestas Patrias, dio %',
      public.sumar_dias_habiles(date '2026-07-25', 2);
  end if;
  raise notice '  ok · los feriados tampoco cuentan para el plazo';

  -- Plazo cero: el primer día en que haya taller.
  if public.sumar_dias_habiles(date '2026-07-26', 0) <> date '2026-07-27' then
    raise exception 'FALLA: plazo cero en domingo dio %', public.sumar_dias_habiles(date '2026-07-26', 0);
  end if;
  raise notice '  ok · un plazo de cero días cae en el primer día de taller';
end $$;

-- ------------------------------------------------------ la empresa decide
do $$
begin
  update public.empresa set dias_laborables = '{1,2,3,4,5}';

  -- Sin sábado, del viernes 28 de agosto se pasa al lunes 31 con un solo día.
  if public.sumar_dias_habiles(date '2026-08-28', 1) <> date '2026-08-31' then
    raise exception 'FALLA: sin sábado, viernes + 1 dio %',
      public.sumar_dias_habiles(date '2026-08-28', 1);
  end if;
  raise notice '  ok · si la empresa cierra los sábados, los plazos se corren solos';

  update public.empresa set dias_laborables = '{1,2,3,4,5,6}';
end $$;

-- --------------------------------------------------------- contar entre dos
do $$
declare v_dias int;
begin
  -- Del lunes 24 al viernes 28 de agosto de 2026 hay cuatro días de taller.
  v_dias := public.dias_habiles_entre(date '2026-08-24', date '2026-08-28');
  if v_dias <> 4 then
    raise exception 'FALLA: se contaron % días de taller en vez de 4', v_dias;
  end if;
  raise notice '  ok · se cuentan los días de taller entre dos fechas';

  -- Al revés queda negativo: es un plazo vencido.
  if public.dias_habiles_entre(date '2026-08-28', date '2026-08-24') >= 0 then
    raise exception 'FALLA: un plazo vencido debería contarse en negativo';
  end if;
  raise notice '  ok · un plazo ya vencido se cuenta en negativo';
end $$;

-- ------------------------------------- el plazo de la orden de servicio
do $$
declare
  v_entrega date;
  v_os      uuid;
begin
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
    values ('RUC', '20777777771', 'MINERA DEL SUR S.A.');
  insert into public.unidades (cliente_id, placa, tipo_vehiculo)
    values ((select id from public.clientes limit 1), 'XYZ-987', 'VOLQUETE');
  insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion)
    values ((select id from public.clientes limit 1), (select id from public.unidades limit 1),
            (select id from public.sedes limit 1), 'Tolva de prueba');
  insert into public.proveedores (numero_documento, razon_social)
    values ('20999999991', 'ARENADOS DEL SUR E.I.R.L.');

  -- Se manda a arenar el viernes 28 con plazo de 2 días: vuelve el lunes 31.
  insert into public.servicios_terceros
    (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, plazo_dias, moneda, monto, tipo_cambio, estado)
  values ((select id from public.ordenes_trabajo limit 1),
          (select id from public.proveedores limit 1),
          'ARENADO', 'Arenado de la tolva', date '2026-08-28', 2, 'PEN', 1000, 1, 'SOLICITADO')
  returning id, fecha_entrega into v_os, v_entrega;

  if v_entrega <> date '2026-08-31' then
    raise exception 'FALLA: la orden de servicio quedó con entrega el %', v_entrega;
  end if;
  raise notice '  ok · la orden de servicio calcula su entrega en días de taller';

  -- Cambiar el plazo recalcula la fecha; no hace falta tocarla a mano.
  update public.servicios_terceros set plazo_dias = 5 where id = v_os;
  select fecha_entrega into v_entrega from public.servicios_terceros where id = v_os;
  if v_entrega <> date '2026-09-03' then
    raise exception 'FALLA: al ampliar el plazo la entrega quedó en %', v_entrega;
  end if;
  raise notice '  ok · al cambiar el plazo la fecha de entrega se recalcula sola';
end $$;



-- --- la siembra exige el permiso de configuración ----------------------------
do $$
declare v_operario uuid;
begin
  select u.id into v_operario
    from public.usuarios u join public.roles r on r.id = u.rol_id
   where r.codigo = 'OPERARIO' limit 1;

  if v_operario is null then
    v_operario := test.crear_usuario('Justo', 'Prueba', 'justo@demo.pe', 'OPERARIO');
  end if;

  perform test.como_usuario(v_operario);
  begin
    perform public.sembrar_feriados(2031);
    raise exception 'FALLA: un operario pudo sembrar feriados';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · sembrar feriados exige configuracion.editar (%)', sqlerrm;
  end;
end $$;

rollback;
