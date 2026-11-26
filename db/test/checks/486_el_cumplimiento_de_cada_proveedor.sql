-- El cumplimiento de cada proveedor (migración 20261126463000, Plan 4.3). Con la
-- cuenta de cada puesto —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
--
-- Un proveedor nuevo. Logística le emite diez OC y tres OS:
--   a. OC prometida en 3 días que llega hoy, entera: a tiempo. Almacén le
--      devuelve un disco que se repone: «con devolución», y sigue a tiempo.
--   b. OC prometida hace 2 días; Logística corrige la fecha a mañana y llega
--      hoy, sin validar: la lista de OC dice 0 días (contra la corregida), pero
--      el proveedor no llegó a tiempo contra lo que prometió al emitirla.
--   c. OC aprobada, prometida para ayer, que no llega: cuenta como compra, no se
--      mide y sale «atrasada sin llegar».
--   d. OC que espera a Gerencia: no cuenta.
--   e. OC sin fecha prometida que llega: cuenta como llegada, no se mide.
--   f. OC prometida hace 2 días que no llega; Logística anota primero
--      «Proveedor» y después «Transporte»: vale el último, el atraso es nuestro
--      y no cuenta contra él («por causa nuestra»).
--   g. OC prometida hace 2 días; Logística anota «Pago» y después llega: se
--      atrasó por causa nuestra, llegó, y no se mide.
--   h. OC prometida en 3 días, con la fecha corregida por «Pago» a 5 días, que
--      llega hoy: no se atrasó, se mide y llegó a tiempo.
--   i. OC emitida hace 10 días, prometida hace 5, con la fecha corregida por
--      «Pago» a hace 2, que tampoco llega: la corrección nuestra perdonaba solo
--      hasta la fecha nueva; pasada esa, el atraso es del proveedor.
--   j. OC prometida hace 2 días que llega hoy, y después Logística le anota
--      «Pago»: la enmienda cuenta (20261126945000), no se mide y es nuestra.
--   OS 1, que vuelve conforme antes de su fin: a tiempo. OS 2, anulada: no
--   cuenta. OS 3, en ejecución con su fin ayer: atrasada sin llegar.
-- Total: 11 compras (a, b, c, e, f, g, h, i, j, OS 1, OS 3), 7 llegaron (a, b, e, g, h, j, OS 1),
-- 4 medidas (a, b, h, OS 1), 3 a tiempo (a, h, OS 1), 1 con devolución,
-- 3 atrasadas (c, i, OS 3), 1 sin fecha (e), 3 por causa nuestra (f, g, j).
-- Todo el check corre en una transacción y `now()` es el mismo para todo: la
-- hora del motivo de la g y del de la j se fija a mano para que quede antes y
-- después de la llegada, como pasa en dos días distintos.
-- La OC que llega a medias y vencida no tiene caso aquí: cuenta como sin llegar
-- por `plazos_de_compras_calculados`, que prueba el check 484.
-- Lo leen Logística, Almacén y Requerimientos (proveedores.ver), con las mismas cifras
-- aunque Requerimientos vea compras de otra manera; Ventas no; sin sesión, nadie.
-- Y la lista de OC sigue dando lo mismo por el envoltorio nuevo.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONDUCTOR:LOG', 'ALMACENERO:ALM', 'VENDEDOR:VEN', 'REQUERIMIENTOS:ACB'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.486@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 486', lower(replace(v, ':', '.')) || '.486@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 486') = 6,
    'se crearon los seis usuarios del check, uno por puesto');
  foreach v in array array['oca', 'ocb', 'occ', 'ocd', 'oce', 'ocf', 'ocg', 'och', 'oci', 'ocj', 'os1', 'os2', 'os3', 'mova', 'deva', 'motg', 'motb'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select current_setting('prueba.' || p)::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;

-- Armazón, como dueño: un material y un proveedor con un RUC inventado.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK486-1', 'Disco de corte de prueba 486', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.disco', v_m::text, true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 486'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(486000, 486200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 486'), true);
end $$;

-- Sin compras todavía: el proveedor sale con ceros, no desaparece.
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select compras = 0 and medidas = 0 and a_tiempo = 0 and devueltas = 0 and atrasadas = 0
                       from public.cumplimiento_de_proveedores(array[pg_temp.id('proveedor')])),
  'el proveedor sin compras sale con todo en cero');

do $$
declare v text;
begin
  foreach v in array array['oca', 'ocb', 'occ', 'ocd', 'ocf', 'ocg', 'och', 'oci', 'ocj'] loop
    perform public.emitir_compra_directa(pg_temp.id(v), pg_temp.id('proveedor'), 'COT-486-' || v, 'Discos para el almacén',
      jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('disco'), 'cantidad', 5, 'precio', 8)),
      pg_temp.hoy() + 3, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  end loop;
  perform public.emitir_compra_directa(pg_temp.id('oce'), pg_temp.id('proveedor'), 'COT-486-oce', 'Discos sin fecha prometida',
    jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('disco'), 'cantidad', 5, 'precio', 8)),
    null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  perform public.emitir_orden_servicio(pg_temp.id('os1'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Torneado de ejes, prueba 486', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
  perform public.emitir_orden_servicio(pg_temp.id('os2'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Pintura de la tolva, prueba 486', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 700, 'CONTADO', 0, '025', null);
  perform public.emitir_orden_servicio(pg_temp.id('os3'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Soldadura de soportes, prueba 486', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 300, 'CONTADO', 0, '025', null);
end $$;
reset role;
-- La regla de aprobación corre al cerrar la transacción: aquí se adelanta.
set constraints all immediate;
set constraints all deferred;

-- La b se emitió prometida para hace 2 días: como dueño se corre hacia atrás.
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 2 where id = pg_temp.id('ocb');
-- La c, para ayer: no llega y queda atrasada.
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 1 where id = pg_temp.id('occ');
-- La f, para hace 2 días: no llega, por el transporte.
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 2 where id = pg_temp.id('ocf');
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 2 where id in (pg_temp.id('ocg'), pg_temp.id('ocj'));
-- La i se emitió hace 10 días (sin disparadores: la fecha de emisión no se cambia por la aplicación).
set local session_replication_role = replica;
update public.ordenes_compra_materiales set creado_en = now() - interval '10 days', fecha_estimada = pg_temp.hoy() - 5
 where id = pg_temp.id('oci');
set local session_replication_role = origin;
-- La OS 3 empezó hace 5 días y debía terminar ayer.
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 5, fecha_fin = pg_temp.hoy() - 1 where id = pg_temp.id('os3');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oca'));
select public.aprobar_compra(pg_temp.id('ocb'));
select public.aprobar_compra(pg_temp.id('occ'));
select public.aprobar_compra(pg_temp.id('oce'));
select public.aprobar_compra(pg_temp.id('ocf'));
select public.aprobar_compra(pg_temp.id('ocg'));
select public.aprobar_compra(pg_temp.id('och'));
select public.aprobar_compra(pg_temp.id('oci'));
select public.aprobar_compra(pg_temp.id('ocj'));
select public.aprobar_orden_servicio(pg_temp.id('os3'));
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_fecha_esperada(gen_random_uuid(), 'OC', pg_temp.id('ocb'), pg_temp.hoy() + 1, 'PROVEEDOR', 'Avisó que llega mañana');
select public.programar_recojo(pg_temp.id('oca'), 10, null);
select public.programar_recojo(pg_temp.id('ocb'), 10, null);
select public.programar_recojo(pg_temp.id('oce'), 10, null);
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'CONFORME', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'ANULADA', 'El proveedor no puede hacer el trabajo');
select public.avanzar_orden_servicio(pg_temp.id('os3'), 'EN_EJECUCION', null);
select public.anotar_motivo_atraso(gen_random_uuid(), 'OC', pg_temp.id('ocf'), 'PROVEEDOR', 'No contesta el teléfono');
select public.anotar_motivo_atraso(gen_random_uuid(), 'OC', pg_temp.id('ocf'), 'TRANSPORTE', 'La camioneta está en el taller');
select public.anotar_motivo_atraso(pg_temp.id('motg'), 'OC', pg_temp.id('ocg'), 'PAGO', 'Tesorería pagó tarde');
select public.corregir_fecha_esperada(gen_random_uuid(), 'OC', pg_temp.id('och'), pg_temp.hoy() + 5, 'PAGO', 'El adelanto sale el lunes');
select public.corregir_fecha_esperada(gen_random_uuid(), 'OC', pg_temp.id('oci'), pg_temp.hoy() - 2, 'PAGO', 'El adelanto salió tarde');
select public.programar_recojo(pg_temp.id('ocg'), 10, null);
select public.programar_recojo(pg_temp.id('och'), 10, null);
select public.programar_recojo(pg_temp.id('ocj'), 10, null);
reset role;
-- El motivo de la g se anotó antes de que llegara.
set local session_replication_role = replica;
update public.seguimiento_de_compras set registrado_en = now() - interval '1 hour' where id = pg_temp.id('motg');
set local session_replication_role = origin;

select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(pg_temp.id('oca'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oca'));
select public.marcar_compra_recogida(pg_temp.id('ocb'));
select public.marcar_compra_dejada_almacen(pg_temp.id('ocb'));
select public.marcar_compra_recogida(pg_temp.id('oce'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oce'));
select public.marcar_compra_recogida(pg_temp.id('ocg'));
select public.marcar_compra_dejada_almacen(pg_temp.id('ocg'));
select public.marcar_compra_recogida(pg_temp.id('och'));
select public.marcar_compra_dejada_almacen(pg_temp.id('och'));
select public.marcar_compra_recogida(pg_temp.id('ocj'));
select public.marcar_compra_dejada_almacen(pg_temp.id('ocj'));
reset role;

-- La j ya llegó tarde; después Logística le anota «Pago». Queda después de la llegada, y cuenta.
select pg_temp.como('comprador');
set local role authenticated;
select public.anotar_motivo_atraso(pg_temp.id('motb'), 'OC', pg_temp.id('ocj'), 'PAGO', 'Se pagó tarde');
reset role;
set local session_replication_role = replica;
update public.seguimiento_de_compras set registrado_en = now() + interval '1 hour' where id = pg_temp.id('motb');
set local session_replication_role = origin;

-- Almacén valida la a entera y le devuelve un disco que se repone. La b queda sin validar.
select set_config('prueba.ingresosa', (
  select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', pg_temp.id('mova'), 'cantidad', i.cantidad))
    from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oca'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oca'), current_setting('prueba.ingresosa')::jsonb, null);
select public.devolver_al_proveedor(pg_temp.id('deva'), pg_temp.id('mova'), 1, 'GR-486', 'Un disco llegó rajado de fábrica', true);
reset role;

-- ============================================ Lo que ve Logística
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.cumplimiento_de_proveedores(array[pg_temp.id('proveedor')]);
  perform test.afirmar(r.compras = 11,
    format('cuentan las OC aprobadas y las OS no anuladas; no la que espera a Gerencia ni la anulada (dice %s)', r.compras));
  perform test.afirmar(r.llegaron = 7, format('llegaron a, b, e, g, h, j y la OS 1 (dice %s)', r.llegaron));
  perform test.afirmar(r.medidas = 4,
    format('se miden a, b, h y la OS 1: no la e, sin fecha, ni la g ni la j, atrasadas por el pago (dice %s)', r.medidas));
  perform test.afirmar(r.a_tiempo = 3,
    format('a tiempo la a, la h (su fecha corregida no la saca) y la OS 1; la b no (dice %s)', r.a_tiempo));
  perform test.afirmar(r.devueltas = 1, format('una OC con devolución (dice %s)', r.devueltas));
  perform test.afirmar(r.atrasadas = 3,
    format('la c, la i (pasó también la fecha corregida) y la OS 3; la b llegó, la f es nuestra (dice %s)', r.atrasadas));
  perform test.afirmar(r.sin_fecha = 1, format('la e llegó sin fecha prometida (dice %s)', r.sin_fecha));
  perform test.afirmar(r.nuestras = 3,
    format('la f (transporte, su último motivo), la g (pago, antes de llegar) y la j (pago, enmendado después) no cuentan contra el proveedor (dice %s)', r.nuestras));

  select * into r from public.cumplimiento_de_proveedores(array[pg_temp.id('proveedor'), pg_temp.id('proveedor')]);
  perform test.afirmar(r.compras = 11, format('el mismo proveedor pedido dos veces no duplica las cifras (dice %s)', r.compras));

  -- La lista de OC, contra la fecha corregida, no la ve atrasada: son dos preguntas distintas.
  select * into r from public.plazos_de_compras(array[pg_temp.id('ocb')]);
  perform test.afirmar(r.esperada = pg_temp.hoy() + 1 and r.dias_atraso = 0 and not r.atrasada and r.por_validar,
    format('la lista de OC mide la b contra la fecha corregida (esperada %s, días %s)', r.esperada, r.dias_atraso));
  select * into r from public.plazos_de_compras(array[pg_temp.id('oca')]);
  perform test.afirmar(r.completa_en is not null and r.dias_atraso = 0 and not r.atrasada,
    'la a sigue completa y a tiempo en la lista de OC tras la devolución');
end $$;
select test.debe_fallar(
  'select * from public.cumplimiento_de_proveedores(array(select gen_random_uuid() from generate_series(1, 101)))',
  'más de 100 proveedores a la vez lo dice', 'hasta 100');
select test.afirmar((select count(*) from public.cumplimiento_de_proveedores(array[]::uuid[])) = 0, 'sin proveedores no devuelve nada');
select test.debe_fallar('select * from public.plazos_de_compras_calculados(array[''' || pg_temp.id('oca') || '''::uuid])',
  'el cálculo interno no lo llama nadie directo', 'permission denied');
reset role;

-- ============================================ Quién lo lee
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select a_tiempo = 3 and devueltas = 1 from public.cumplimiento_de_proveedores(array[pg_temp.id('proveedor')])),
  'Almacén, que ve el padrón, lee las mismas cifras');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select compras = 11 and a_tiempo = 3 and atrasadas = 3 and nuestras = 3
                       from public.cumplimiento_de_proveedores(array[pg_temp.id('proveedor')])),
  'Requerimientos, que ve el padrón, lee las mismas cifras: el cumplimiento no depende de qué compras ve cada uno');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.cumplimiento_de_proveedores(array[''' || pg_temp.id('proveedor') || '''::uuid])',
  'Ventas, que no ve el padrón, no lee el cumplimiento', 'permiso');
reset role;
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.cumplimiento_de_proveedores(uuid[])', 'execute')
                   and not has_function_privilege('anon', 'public.plazos_de_compras_calculados(uuid[])', 'execute')
                   and not has_function_privilege('authenticated', 'public.plazos_de_compras_calculados(uuid[])', 'execute'),
    'sin sesión no se ejecuta, y el cálculo interno no lo ejecuta nadie');
end $$;

rollback;
