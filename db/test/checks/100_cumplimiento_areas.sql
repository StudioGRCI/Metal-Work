-- El MW-FOR-ING-8: Diseño reparte los planos con su peso, Maestranza y
-- Producción reportan pieza por pieza, y el porcentaje sale de los vistos.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000014', 'PRUEBAS CUMPLIMIENTO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',    'ADMIN',       (select id from public.sedes limit 1)) as admin_id  \gset
select test.crear_usuario('Lucía', 'Rojas',  'lucia@demo.pe',  'DISENO',      (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Jorge', 'Paz',    'jorge@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id   \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20526331762', 'MENBER INGENIERIA S.A.C.');

select set_config('prueba.admin',  :'admin_id',  false);
select set_config('prueba.diseno', :'diseno_id', false);
select set_config('prueba.jefe',   :'jefe_id',   false);

-- ------------------------------------------------- el rol de Diseño existe y costea
do $$
begin
  perform test.afirmar(
    exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
             where r.codigo = 'DISENO' and rp.permiso_codigo = 'cotizaciones.costear'),
    'Diseño arma las partidas: tiene cotizaciones.costear');
  perform test.afirmar(
    exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
             where r.codigo = 'DISENO' and rp.permiso_codigo = 'diseno.planos'),
    'Diseño reparte los planos: tiene diseno.planos');
  raise notice '  ok · Diseño costea y reparte planos';
end $$;

-- ------------------------------------------------- la hoja se arma y se reporta
select test.como_usuario(:'admin_id');

do $$
declare
  v_ot  uuid;
  v_p1  uuid;
  v_p2  uuid;
  v_a   uuid;
  v_e   uuid;
  v_c   uuid;
  v_pct numeric;
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

  insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct) values (v_ot, '1', 'HABILITADO', 60) returning id into v_p1;
  insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct) values (v_ot, '2', 'COMPUERTA',  40) returning id into v_p2;
  perform set_config('prueba.p1', v_p1::text, false);

  -- Entre todos los planos no pasan de cien.
  begin
    insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct) values (v_ot, '3', 'DE MÁS', 10);
    raise exception 'FALLA: dejó que los planos sumaran 110';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · los pesos no pasan de cien';
  end;

  insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad) values (v_p1, v_ot, '1', 'Durmiente', 3) returning id into v_a;
  insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad) values (v_p1, v_ot, '2', 'Poste', 2);
  insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad, es_ensamble) values (v_p1, v_ot, 'ENS', 'Ensamble', 1, true) returning id into v_e;
  insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre, cantidad) values (v_p2, v_ot, '1', 'Marco', 1) returning id into v_c;
  perform set_config('prueba.a', v_a::text, false);

  -- Una pieza no cruza de orden: la llave compuesta lo impide.
  perform test.debe_fallar(
    format('insert into public.ot_piezas (plano_id, orden_id, numero_pieza, nombre) values (%L, gen_random_uuid(), %L, %L)', v_p1, 'X', 'Cruzada'),
    'una pieza no apunta a un plano de otra orden');

  -- Maestranza no empieza sin plano entregado.
  perform test.como_usuario(current_setting('prueba.jefe')::uuid);
  begin
    update public.ot_piezas set mtz_inicio = current_date where id = v_a;
    raise exception 'FALLA: Maestranza habilitó sin que Diseño entregara el plano';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · sin plano entregado no hay habilitado';
  end;

  -- Diseño entrega, y no puede marcar lo del taller.
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  update public.ot_planos set fecha_entrega = current_date where id in (v_p1, v_p2);
  begin
    update public.ot_piezas set mtz_inicio = current_date, mtz_habilitado = true where id = v_a;
    raise exception 'FALLA: Diseño marcó un habilitado';
  exception when insufficient_privilege then
    raise notice '  ok · Diseño no reporta por el taller';
  end;

  -- El taller reporta lo suyo y no toca lo de Diseño.
  perform test.como_usuario(current_setting('prueba.jefe')::uuid);
  update public.ot_piezas set mtz_inicio = current_date, mtz_habilitado = true where id = v_a;
  begin
    update public.ot_piezas set cantidad = 9 where id = v_a;
    raise exception 'FALLA: el taller cambió una cantidad';
  exception when insufficient_privilege then
    raise notice '  ok · el taller no dibuja';
  end;
  perform test.debe_fallar(
    format('update public.ot_piezas set prd_recibido = true, prd_recepcion = current_date where id = %L', v_a),
    'recibido exige entregado por Maestranza');
  perform test.debe_fallar(
    format('update public.ot_piezas set mtz_inicio = current_date, mtz_habilitado = true where id = %L', v_e),
    'un ensamble no pasa por Maestranza');

  -- El porcentaje sale solo: habilitada 25, entregada 50, ensamble empezado 50, la del plano 2 al 100.
  update public.ot_piezas set mtz_culminacion = current_date, mtz_entregado = true where id = v_a;
  update public.ot_piezas set prd_inicio = current_date where id = v_e;
  update public.ot_piezas
     set mtz_inicio = current_date, mtz_habilitado = true, mtz_culminacion = current_date, mtz_entregado = true,
         prd_recepcion = current_date, prd_recibido = true, prd_inicio = current_date, prd_armado = true
   where id = v_c;

  select avance_pct into v_pct from public.v_cumplimiento_planos where plano_id = v_p1;
  perform test.afirmar(v_pct = 33.33, format('el plano 1 va al 33.33 ponderado por cantidad (dio %s)', v_pct));
  select avance_pct into v_pct from public.v_cumplimiento_ot where orden_id = v_ot;
  perform test.afirmar(v_pct = 60.00, format('la unidad va al 60 ponderada por peso (dio %s)', v_pct));
  raise notice '  ok · el porcentaje sale de los vistos: plano 33.33, unidad 60';

  perform test.afirmar(
    (select count(*) from public.v_cronograma_ot where orden_id = v_ot) > 0,
    'el cronograma tiene una fila por etapa');
  raise notice '  ok · la orden se ve como cronograma';
end $$;

-- ------------------------------------------------- lo reportado no se borra
select test.como_usuario(:'diseno_id');

do $$
begin
  begin
    delete from public.ot_planos where id = current_setting('prueba.p1')::uuid;
    raise exception 'FALLA: se borró un plano con trabajo reportado';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · un plano con trabajo reportado no se quita';
  end;
end $$;

-- ------------------------------------------------- las rejas
select test.como_usuario(:'jefe_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.ot_planos where orden_id = current_setting('prueba.ot')::uuid) = 2,
    'el jefe de taller ve los planos de la orden');
  begin
    insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct)
    values (current_setting('prueba.ot')::uuid, '9', 'INTRUSO', 0);
    raise exception 'FALLA: la política dejó al taller repartir planos';
  exception when insufficient_privilege then
    raise notice '  ok · repartir planos es de Diseño, no del taller';
  end;
end $$;

reset role;
rollback;
