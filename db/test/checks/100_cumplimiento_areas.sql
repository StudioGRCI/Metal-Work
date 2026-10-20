-- El MW-FOR-ING-8: Diseño reparte los planos con su peso y las áreas del
-- taller reciben la versión aprobada de cada uno.
--
-- Hasta el 28/09 Maestranza y Producción reportaban pieza por pieza y el
-- porcentaje salía de los vistos. La migración 20260928133200 dejó las piezas
-- como historial de solo lectura (el detalle físico va en Materiales, el avance
-- en las tareas con foto), y la 20260929110100 reemplazó la jefatura de taller
-- por una Supervisión por área. El check prueba la regla de hoy: las piezas no
-- se escriben, y cada supervisor recibe solo la versión de su área.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000014', 'PRUEBAS CUMPLIMIENTO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',    'ADMIN',       (select id from public.sedes limit 1)) as admin_id  \gset
select test.crear_usuario('Lucía', 'Rojas',  'lucia@demo.pe',  'DISENO',      (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Jorge', 'Paz',    'jorge@demo.pe',  'SUPERVISOR',  (select id from public.sedes limit 1)) as jefe_id   \gset
select test.crear_usuario('Pilar', 'Soto',   'pilar@demo.pe',  'SUPERVISOR',  (select id from public.sedes limit 1)) as prd_id    \gset

-- El área de cada supervisor la pone ADMIN (trigger de personal).
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'jefe_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'prd_id';

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20526331762', 'MENBER INGENIERIA S.A.C.');

select set_config('prueba.admin',  :'admin_id',  false);
select set_config('prueba.diseno', :'diseno_id', false);
select set_config('prueba.jefe',   :'jefe_id',   false);
select set_config('prueba.prd',    :'prd_id',    false);

-- ------------------------------------------------- el rol de Diseño prepara los planos
do $$
begin
  perform test.afirmar(
    exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
             where r.codigo = 'DISENO' and rp.permiso_codigo = 'diseno.planos'),
    'Diseño reparte los planos: tiene diseno.planos');
  raise notice '  ok · Diseño prepara y reparte planos';
end $$;

-- ------------------------------------------------- la hoja se arma y se recibe
select test.como_usuario(:'admin_id');

do $$
declare
  v_ot  uuid;
  v_p1  uuid;
  v_p2  uuid;
  v_version_mtz uuid;
  v_version_mtz_p2 uuid;
  v_version_prd_p1 uuid;
  v_version_prd_p2 uuid;
  v_autor uuid;
  v_etapa uuid;
  r record;
begin
  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), 'TOLVA DE PRUEBA')
  returning id into v_ot;
  perform set_config('prueba.ot', v_ot::text, false);

  -- En borrador todavía no hay a quién repartirle nada.
  begin
    insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct) values (v_ot, '1', 'HABILITADO', 60);
    raise exception 'FALLA: aceptó un plano en una orden en borrador';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · en borrador no se reparten planos';
  end;

  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_ot;

  -- Desde la migración 20260929100003 cada plano nuevo dice quién de Diseño lo
  -- elaboró: un integrante del equipo de la OT.
  insert into public.ot_equipo_diseno (id, orden_id, nombre, funcion)
  values (gen_random_uuid(), v_ot, 'Lucía Rojas', 'RESPONSABLE') returning id into v_autor;
  perform set_config('prueba.autor', v_autor::text, false);

  -- Y desde la migración 20260928141000 cada plano cuelga de una etapa de la
  -- OT, que Diseño define antes (etapas libres, migración 20260928135000).
  v_etapa := gen_random_uuid();
  perform public.guardar_etapas_libres(v_ot, jsonb_build_array(
    jsonb_build_object('id', v_etapa, 'nombre', 'Planos de la unidad',
      'area_id', (select id from public.areas where codigo = 'DIS'), 'peso_pct', 20),
    jsonb_build_object('id', gen_random_uuid(), 'nombre', 'Habilitado',
      'area_id', (select id from public.areas where codigo = 'MTZ'), 'peso_pct', 30),
    jsonb_build_object('id', gen_random_uuid(), 'nombre', 'Armado',
      'area_id', (select id from public.areas where codigo = 'PRD'), 'peso_pct', 50)), null);

  insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct, integrante_diseno_id, etapa_id) values (v_ot, '1', 'HABILITADO', 60, v_autor, v_etapa) returning id into v_p1;
  insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct, integrante_diseno_id, etapa_id) values (v_ot, '2', 'COMPUERTA',  40, v_autor, v_etapa) returning id into v_p2;
  perform set_config('prueba.p1', v_p1::text, false);

  -- Entre todos los planos no pasan de cien.
  begin
    insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct, integrante_diseno_id, etapa_id) values (v_ot, '3', 'DE MÁS', 10, v_autor, v_etapa);
    raise exception 'FALLA: dejó que los planos sumaran 110';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · los pesos no pasan de cien';
  end;

  -- Desde la migración 20260928133200 las piezas son historial de solo
  -- lectura: no se agregan, ni dentro de la orden ni cruzando a otra.
  perform test.debe_fallar(
    format('insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad) values (%L, %L, %L, %L, 3)', v_p1, v_ot, '1', 'Durmiente'),
    'las piezas ya no se agregan: el detalle va en Materiales',
    'Las piezas se consultan en Planos');
  perform test.debe_fallar(
    format('insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre) values (%L, gen_random_uuid(), %L, %L)', v_p1, 'X', 'Cruzada'),
    'una pieza no apunta a un plano de otra orden',
    'Las piezas se consultan en Planos');

  -- Diseño entrega (solo con la fecha de hoy) y no reporta por el taller.
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  update public.ot_planos set fecha_entrega = current_date where id in (v_p1, v_p2);
  perform test.debe_fallar(
    format('update public.ot_planos set fecha_entrega = current_date - 1 where id = %L', v_p1),
    'la fecha de entrega del plano no se reescribe',
    'no se puede cambiar');

  -- Diseño carga la versión aprobada de cada plano para cada área.
  insert into public.ot_plano_versiones
    (id, plano_id, area_id, revision, nombre_archivo, ruta_storage, estado, vigente,
     creado_por, revisado_por, revisado_en)
  values
    (gen_random_uuid(), v_p1, (select id from public.areas where codigo = 'MTZ'), 1,
     'HABILITADO-MTZ.pdf', 'pruebas/' || gen_random_uuid() || '.pdf', 'APROBADO', true,
     current_setting('prueba.diseno')::uuid, current_setting('prueba.admin')::uuid, now())
  returning id into v_version_mtz;
  insert into public.ot_plano_versiones
    (id, plano_id, area_id, revision, nombre_archivo, ruta_storage, estado, vigente,
     creado_por, revisado_por, revisado_en)
  values
    (gen_random_uuid(), v_p2, (select id from public.areas where codigo = 'MTZ'), 1,
     'COMPUERTA-MTZ.pdf', 'pruebas/' || gen_random_uuid() || '.pdf', 'APROBADO', true,
     current_setting('prueba.diseno')::uuid, current_setting('prueba.admin')::uuid, now())
  returning id into v_version_mtz_p2;
  insert into public.ot_plano_versiones
    (id, plano_id, area_id, revision, nombre_archivo, ruta_storage, estado, vigente,
     creado_por, revisado_por, revisado_en)
  values
    (gen_random_uuid(), v_p2, (select id from public.areas where codigo = 'PRD'), 1,
     'COMPUERTA-PRD.pdf', 'pruebas/' || gen_random_uuid() || '.pdf', 'APROBADO', true,
     current_setting('prueba.diseno')::uuid, current_setting('prueba.admin')::uuid, now())
  returning id into v_version_prd_p2;
  insert into public.ot_plano_versiones
    (id, plano_id, area_id, revision, nombre_archivo, ruta_storage, estado, vigente,
     creado_por, revisado_por, revisado_en)
  values
    (gen_random_uuid(), v_p1, (select id from public.areas where codigo = 'PRD'), 1,
     'HABILITADO-PRD.pdf', 'pruebas/' || gen_random_uuid() || '.pdf', 'APROBADO', true,
     current_setting('prueba.diseno')::uuid, current_setting('prueba.admin')::uuid, now())
  returning id into v_version_prd_p1;

  -- Diseño no confirma la recepción por el taller.
  perform test.debe_fallar(
    format('select public.recibir_version_plano(%L)', v_version_mtz),
    'Diseño no recibe el plano por el taller',
    'responsable del área destinataria');

  -- Cada supervisor recibe la versión de su área, y solo la de su área.
  perform test.como_usuario(current_setting('prueba.jefe')::uuid);
  -- Desde la migración 20261016120000 el supervisor no lee la OT y la
  -- recepción del plano exige verla. Como el check 317, la prueba le devuelve
  -- `ordenes.ver` solo mientras dure para seguir cuidando el circuito.
  insert into public.roles_permisos (rol_id, permiso_codigo)
  select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
  on conflict do nothing;
  perform public.recibir_version_plano(v_version_mtz);
  perform public.recibir_version_plano(v_version_mtz_p2);
  perform test.debe_fallar(
    format('select public.recibir_version_plano(%L)', v_version_prd_p1),
    'Maestranza no recibe por Producción',
    'responsable del área destinataria');
  perform test.como_usuario(current_setting('prueba.prd')::uuid);
  perform public.recibir_version_plano(v_version_prd_p1);
  perform public.recibir_version_plano(v_version_prd_p2);
  delete from public.roles_permisos rp using public.roles ro
   where ro.id = rp.rol_id and ro.codigo = 'SUPERVISOR' and rp.permiso_codigo = 'ordenes.ver';

  perform test.afirmar(
    (select count(*) from public.ot_plano_versiones
      where plano_id in (v_p1, v_p2) and estado = 'RECIBIDO' and recibido_por is not null) = 4,
    'las cuatro versiones quedan recibidas, cada una con quién la recibió');

  -- Ni el taller ni Diseño tocan las piezas: son historial. Se siembra una
  -- pieza histórica saltando los disparadores (como las de antes del 28/09)
  -- para comprobar que ya nadie la marca.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad)
  values (v_p2, v_ot, '1', 'Marco histórico', 1);
  perform set_config('session_replication_role', 'origin', true);
  perform test.debe_fallar(
    format('update public.ot_piezas set mtz_inicio = current_date, mtz_habilitado = true where plano_id = %L', v_p2),
    'el taller ya no marca piezas',
    'Las piezas se consultan en Planos');

  -- El resumen de la unidad cuenta los planos entregados y su peso.
  select * into r from public.v_cumplimiento_ot where orden_id = v_ot;
  perform test.afirmar(r.planos = 2 and r.planos_entregados = 2,
    format('el resumen cuenta los dos planos entregados (dio %s de %s)', r.planos_entregados, r.planos));
  perform test.afirmar(r.peso_total = 100.00, format('los planos pesan 100 (dio %s)', r.peso_total));
  raise notice '  ok · el resumen de la unidad cuenta los planos entregados';
end $$;

-- ------------------------------------------------- lo recibido no se borra
select test.como_usuario(:'diseno_id');

do $$
begin
  begin
    delete from public.ot_planos where id = current_setting('prueba.p1')::uuid;
    raise exception 'FALLA: se borró un plano con versiones recibidas por el taller';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · un plano con versiones recibidas no se quita (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------- las rejas
select test.como_usuario(:'jefe_id');
set role authenticated;

do $$
begin
  -- Desde la migración 20261016120000 Supervisión no lee la OT ni lo que
  -- cuelga de ella: recibe el plano por su versión, no por la orden.
  perform test.afirmar(
    (select count(*) from public.ot_planos where orden_id = current_setting('prueba.ot')::uuid) = 0,
    'Supervisión ya no lee los planos de la OT');
  begin
    insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct, integrante_diseno_id, etapa_id)
    values (current_setting('prueba.ot')::uuid, '9', 'INTRUSO', 0, current_setting('prueba.autor')::uuid,
            (select id from public.ot_etapas where orden_id = current_setting('prueba.ot')::uuid order by orden_secuencia limit 1));
    raise exception 'FALLA: la política dejó al taller repartir planos';
  exception when insufficient_privilege then
    raise notice '  ok · repartir planos es de Diseño, no del taller';
  end;
end $$;

reset role;
-- ------------------------------------------- HALLAZGO: el cronograma de la OT
-- La orden se ve como cronograma, una fila por etapa. Desde la migración
-- 20260928135000 las etapas las define Diseño como etapas libres (sin fila en
-- `etapas_catalogo`), y `v_cronograma_ot` todavía hace INNER JOIN al catálogo:
-- para toda OT nueva sale vacío. Es el mismo fallo que el check 311 encontró en
-- el control de plazos. Falla hasta que se arregle la vista.
do $$
declare v_ot uuid := current_setting('prueba.ot')::uuid;
begin
  if (select count(*) from public.v_cronograma_ot where orden_id = v_ot)
     <> (select count(*) from public.ot_etapas where orden_id = v_ot) then
    raise exception 'FALLA (hallazgo): el cronograma no tiene una fila por etapa: v_cronograma_ot da % de % etapas, ignora las etapas libres que define Diseño',
      (select count(*) from public.v_cronograma_ot where orden_id = v_ot),
      (select count(*) from public.ot_etapas where orden_id = v_ot);
  end if;
  raise notice '  ok · la orden se ve como cronograma, una fila por etapa';
end $$;

rollback;
