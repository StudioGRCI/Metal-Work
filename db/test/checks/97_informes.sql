-- Los informes: que las cifras cuadren y que cada quien vea solo lo suyo.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000012', 'PRUEBAS INFORMES S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',       (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Beto',  'Ríos',   'beto@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO',    (select id from public.sedes limit 1), true, 14) as operario_id \gset
select test.crear_usuario('Sara',  'Loayza', 'sara@demo.pe',  'CONSULTA',    (select id from public.sedes limit 1)) as consulta_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20777777773', 'CANTERAS DEL SUR S.A.');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  values ((select id from public.clientes limit 1), 'INF-001', 'VOLQUETE');

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, tipo_trabajo, descripcion, monto_presupuestado,
   fecha_entrega_comprometida)
values ((select id from public.clientes limit 1), (select id from public.unidades limit 1),
        (select id from public.sedes limit 1), 'FABRICACION', 'Tolva para informe', 30000,
        current_date - 2);

update public.ordenes_trabajo set estado = 'APROBADA';

insert into public.proveedores (numero_documento, razon_social)
  values ('20999999992', 'ARENADOS DEL ESTE S.A.C.');

insert into public.servicios_terceros
  (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, moneda, monto, tipo_cambio, estado)
values ((select id from public.ordenes_trabajo limit 1),
        (select id from public.proveedores limit 1),
        'ARENADO', 'Arenado de la tolva', current_date - 5, 'PEN', 1500, 1, 'SOLICITADO');

select test.como_usuario(:'admin_id');

-- ---------------------------------------------------------- las cifras cuadran
do $$
declare r record;
begin
  select * into r from public.informe_resumen(current_date - 30, current_date);

  if r.ordenes_abiertas <> 1 then
    raise exception 'FALLA: el resumen cuenta % unidades en taller y hay 1', r.ordenes_abiertas;
  end if;
  raise notice '  ok · el resumen cuenta las unidades vivas del taller';

  if r.unidades_atrasadas <> 1 then
    raise exception 'FALLA: la unidad pasada de fecha no figura como atrasada';
  end if;
  raise notice '  ok · y las que ya pasaron su fecha comprometida';
end $$;

-- ------------------------------------------------------ el subcontrato cuenta
do $$
declare r record;
begin
  select * into r from public.informe_subcontratos(current_date - 30, current_date) limit 1;

  if r.proveedor is null or r.monto <> 1500 then
    raise exception 'FALLA: el informe de subcontratos no trajo el monto pedido';
  end if;
  if r.conformes <> 0 then
    raise exception 'FALLA: contó como conforme algo que todavía está afuera';
  end if;
  raise notice '  ok · el trabajo mandado afuera figura con su monto y sin conformidad';
end $$;

-- --------------------------------------------- la plata pide permiso de costos
-- El perfil de consulta ve la producción y las entregas, pero no el margen ni
-- lo que se le paga a los proveedores. La jefatura de taller sí, porque la
-- empresa le dio costos.ver: la decisión vive en el permiso, no en la pantalla.
select test.como_usuario(:'consulta_id');

do $$
begin
  perform * from public.informe_produccion(current_date - 30, current_date);
  raise notice '  ok · el perfil de consulta sí puede ver la producción';

  begin
    perform * from public.informe_rentabilidad(current_date - 30, current_date);
    raise exception 'FALLA: vio el margen sin tener el permiso de costos';
  exception when insufficient_privilege then
    raise notice '  ok · el margen exige además el permiso de costos';
  end;

  begin
    perform * from public.informe_subcontratos(current_date - 30, current_date);
    raise exception 'FALLA: vio lo que se le paga a los proveedores sin permiso de costos';
  exception when insufficient_privilege then
    raise notice '  ok · lo que se paga afuera también';
  end;
end $$;

-- Y la jefatura de taller, que sí tiene costos.ver, lo ve sin problema.
select test.como_usuario(:'jefe_id');

do $$
declare v_filas int;
begin
  select count(*) into v_filas from public.informe_rentabilidad(current_date - 30, current_date);
  if v_filas < 1 then
    raise exception 'FALLA: la jefatura no vio ninguna unidad en el margen';
  end if;
  raise notice '  ok · quien tiene el permiso de costos sí ve el margen';
end $$;

-- El resumen no falla, pero calla las cifras de plata a quien no puede verlas.
select test.como_usuario(:'consulta_id');
do $$
declare r record;
begin
  select * into r from public.informe_resumen(current_date - 30, current_date);

  if r.ordenes_abiertas is null then
    raise exception 'FALLA: el resumen debería seguir contando unidades';
  end if;
  if r.utilidad_periodo is not null then
    raise exception 'FALLA: el resumen le mostró la utilidad a quien no puede verla';
  end if;
  raise notice '  ok · el resumen sigue contando unidades y deja en blanco la plata';
end $$;

-- ------------------------------------------------- sin permiso, ningún informe
select test.como_usuario(:'operario_id');

do $$
begin
  begin
    perform * from public.informe_produccion(current_date - 30, current_date);
    raise exception 'FALLA: un operario abrió el informe de producción';
  exception when insufficient_privilege then
    raise notice '  ok · un operario no abre los informes de gestión';
  end;
end $$;

rollback;
