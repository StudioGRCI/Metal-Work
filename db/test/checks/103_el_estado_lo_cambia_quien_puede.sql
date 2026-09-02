-- El estado lo cambia quien puede, también por la puerta de atrás.
--
-- La pantalla exigía `produccion.aprobar_parte` para aprobar un parte diario y
-- `ordenes.aprobar` / `.anular` para mover una OT, pero la base no exigía
-- ninguno de los dos: sus políticas aceptaban `produccion.registrar` y
-- `ordenes.cambiar_estado` para cualquier columna. Como la clave anónima viaja
-- al navegador y el repositorio es público, la regla que vive solo en la
-- pantalla no es una regla. La migración 077 la bajó a la base, y este check
-- vigila que siga ahí, junto con las otras cuatro puertas que esa migración
-- cerró.
--
-- Todo lo que tiene que pasar por RLS va con `set local role authenticated`.
-- Sin esa línea la sentencia corre como `postgres`, que es dueño de las tablas
-- y se salta las políticas: la prueba saldría verde sin haber probado nada.
--
-- Y todo lo que tiene que fallar se comprueba con el tercer argumento de
-- `test.debe_fallar`, el texto que el error debe contener. Sin él, «falló» y
-- «falló por lo que queríamos» son la misma cosa: una columna mal escrita
-- también hace pasar la prueba.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000015', 'PRUEBAS DE ESTADO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

-- El administrador no prueba ningún botón: solo monta el armazón que las demás
-- pruebas necesitan, sin pedirle a nadie un permiso que no tiene.
select test.crear_usuario('Aldo',   'Bravo',   'aldo@demo.pe',   'ADMIN',       (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diego',  'Quispe',  'diego@demo.pe',  'OPERARIO',    (select id from public.sedes limit 1), true, 14) as operario_id \gset
select test.crear_usuario('Silvia', 'Ramos',   'silvia@demo.pe', 'SUPERVISOR',  (select id from public.sedes limit 1)) as supervisor_id \gset
select test.crear_usuario('Rosa',   'Yupanqui','rosa@demo.pe',   'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Gabriel','Rojas',   'gabriel@demo.pe','GERENTE',     (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Nadia',  'Pinto',   'nadia@demo.pe',  'DISENO',      (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Carla',  'Vidal',   'carla@demo.pe',  'COSTOS',      (select id from public.sedes limit 1)) as costos_id \gset
select test.crear_usuario('Jesús',  'Campos',  'jesus@demo.pe',  'ALMACENERO',  (select id from public.sedes limit 1)) as almacenero_id \gset
select test.crear_usuario('Lucía',  'Ferrer',  'lucia@demo.pe',  'CALIDAD',     (select id from public.sedes limit 1)) as calidad_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20601010109', 'TRANSPORTES SAN BORJA S.A.C.');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  values ((select id from public.clientes limit 1), 'AAA-111', 'VOLQUETE'),
         ((select id from public.clientes limit 1), 'BBB-222', 'VOLQUETE');

-- La OT del estado se queda en BORRADOR: desde ahí solo se puede APROBAR o
-- ANULAR, que es justo lo que se quiere probar.
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo)
  select c.id, u.id, s.id, 'Tolva para probar quién cambia el estado', 'FABRICACION'
    from public.clientes c cross join public.sedes s
    join public.unidades u on u.cliente_id = c.id and u.placa = 'AAA-111'
   limit 1;

-- La OT del taller se aprueba con el administrador, porque al aprobar es
-- cuando la base instancia sus etapas del catálogo. Sin sesión no sirve: desde
-- el blindaje (migración 013) la bitácora exige `puede_ver_orden`, que sin
-- usuario es falsa, y el alta de etapas se cae. De aquí sale el tablero de
-- etapas y el parte diario.
select test.como_usuario(:'admin_id');
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo)
  select c.id, u.id, s.id, 'Furgón en taller con sus etapas', 'FABRICACION'
    from public.clientes c cross join public.sedes s
    join public.unidades u on u.cliente_id = c.id and u.placa = 'BBB-222'
   limit 1;

update public.ordenes_trabajo set estado = 'APROBADA'
 where descripcion = 'Furgón en taller con sus etapas';

-- Los identificadores viajan por parámetros de sesión: psql no sustituye sus
-- variables dentro de un bloque entre dólares, y un `insert … select` que se
-- queda sin filas «pasa» sin evaluar ninguna política.
select set_config('prueba.operario',   :'operario_id',   false);
select set_config('prueba.supervisor', :'supervisor_id', false);
select set_config('prueba.ot_estado',
  (select id::text from public.ordenes_trabajo
    where descripcion = 'Tolva para probar quién cambia el estado'), false);
select set_config('prueba.ot_taller',
  (select id::text from public.ordenes_trabajo
    where descripcion = 'Furgón en taller con sus etapas'), false);

-- El parte diario del turno, ya cerrado y esperando firma. Se arma desde la
-- conexión administrativa; lo que se prueba después es quién lo aprueba.
do $$
declare
  v_ot    uuid := current_setting('prueba.ot_taller')::uuid;
  v_etapa uuid;
  v_parte uuid;
  v_etapas int;
begin
  select count(*) into v_etapas from public.ot_etapas where orden_id = v_ot;
  if v_etapas = 0 then
    raise exception 'FALLA: aprobar la OT no le creó ninguna etapa; sin etapas este check no prueba nada';
  end if;

  select id into v_etapa
    from public.ot_etapas where orden_id = v_ot order by orden_secuencia limit 1;

  insert into public.partes_diarios (fecha, sede_id, responsable_id)
    select current_date, s.id, current_setting('prueba.supervisor')::uuid
      from public.sedes s limit 1
    returning id into v_parte;

  insert into public.parte_detalle (parte_id, orden_id, etapa_id, usuario_id, horas, descripcion)
    values (v_parte, v_ot, v_etapa, current_setting('prueba.operario')::uuid, 8,
            'Armado de laterales');

  update public.partes_diarios set estado = 'CERRADO' where id = v_parte;

  perform set_config('prueba.parte', v_parte::text, false);
  perform set_config('prueba.etapa', v_etapa::text, false);
end $$;

-- ===========================================================================
-- 1. EL PARTE DIARIO NO SE APRUEBA SOLO
-- ===========================================================================
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
declare
  v_parte uuid := current_setting('prueba.parte')::uuid;
  v_filas int;
begin
  -- Primero se demuestra que el operario alcanza la fila y que la política de
  -- escritura le deja tocarla. Sin esto, el fallo de abajo podría ser un
  -- «cero filas» del RLS disfrazado de guardia, que es el falso verde más
  -- caro de este proyecto.
  perform test.afirmar(
    (select count(*) from public.partes_diarios where id = v_parte) = 1,
    'el operario ve el parte de su turno');

  update public.partes_diarios set observaciones = 'Turno de tarde' where id = v_parte;
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 1,
    'y la política le deja escribir en él: lo que falle después será la guardia, no el RLS');

  perform test.debe_fallar(
    format('update public.partes_diarios set estado = ''APROBADO'' where id = %L', v_parte),
    'un operario no aprueba su propio parte',
    'produccion.aprobar_parte');
end $$;

reset role;

-- --------------------------------------- el supervisor sí, y firma él
select test.como_usuario(:'supervisor_id');
set local role authenticated;

do $$
declare
  v_parte uuid := current_setting('prueba.parte')::uuid;
  v_filas int;
  v_firma uuid;
begin
  -- El formulario manda la firma del operario. La base la ignora: firma quien
  -- aprueba, no quien lo pide.
  update public.partes_diarios
     set estado = 'APROBADO',
         aprobado_por = current_setting('prueba.operario')::uuid
   where id = v_parte;
  get diagnostics v_filas = row_count;

  perform test.afirmar(v_filas = 1, 'el supervisor sí aprueba el parte');

  select aprobado_por into v_firma from public.partes_diarios where id = v_parte;
  perform test.afirmar(v_firma = current_setting('prueba.supervisor')::uuid,
    'y la firma queda a nombre del supervisor aunque el formulario mandara otra');
end $$;

reset role;

-- ===========================================================================
-- 2. LA ORDEN LA APRUEBA Y LA ANULA QUIEN PUEDE
-- ===========================================================================
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_ot    uuid := current_setting('prueba.ot_estado')::uuid;
  v_filas int;
begin
  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo where id = v_ot) = 1,
    'el jefe de taller ve la orden');

  -- Lo suyo sí lo puede hacer: la política de escritura le deja. El fallo de
  -- abajo, entonces, es la guardia de estado y no el RLS.
  update public.ordenes_trabajo set descripcion = descripcion || ' (revisada)' where id = v_ot;
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 1, 'y puede editarla, que es lo suyo');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''APROBADA'' where id = %L', v_ot),
    'el jefe de taller no aprueba una orden',
    'ordenes.aprobar');

  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''ANULADA'',
                   motivo_anulacion = ''Prueba'' where id = %L', v_ot),
    'ni la anula',
    'ordenes.anular');
end $$;

reset role;

-- --------------------------------------- el gerente sí, las dos cosas
select test.como_usuario(:'gerente_id');
set local role authenticated;

do $$
declare
  v_ot    uuid := current_setting('prueba.ot_estado')::uuid;
  v_filas int;
begin
  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_ot;
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 1 and
    (select estado from public.ordenes_trabajo where id = v_ot) = 'APROBADA',
    'el gerente aprueba la orden');

  update public.ordenes_trabajo
     set estado = 'ANULADA',
         motivo_anulacion = 'El cliente desistió del pedido'
   where id = v_ot;
  perform test.afirmar(
    (select estado from public.ordenes_trabajo where id = v_ot) = 'ANULADA',
    'y la anula, con su motivo');
end $$;

reset role;

-- ===========================================================================
-- 3. LAS ETAPAS NO DEPENDEN DE PODER VER AL CLIENTE
-- ===========================================================================
-- La vista cruzaba con `clientes` por dentro y corre con el permiso de quien
-- pregunta: al supervisor, que no tiene `clientes.ver`, la fila se le caía en
-- el cruce y el tablero le salía vacío, sin ningún error que lo explicara.
select test.como_usuario(:'supervisor_id');
set local role authenticated;

do $$
declare
  v_ot     uuid := current_setting('prueba.ot_taller')::uuid;
  v_filas  int;
  v_cliente text;
begin
  perform test.afirmar(not public.tiene_permiso('clientes.ver'),
    'el supervisor no puede ver clientes: es la condición que hacía fallar esto');

  select count(*) into v_filas from public.ot_tablero_etapas where orden_id = v_ot;
  perform test.afirmar(v_filas > 0,
    format('y aun así ve las %s etapas de la orden en el tablero', v_filas));

  select cliente into v_cliente from public.ot_tablero_etapas where orden_id = v_ot limit 1;
  perform test.afirmar(v_cliente is null,
    'con el nombre del cliente en blanco, que es exactamente lo que dice su permiso');
end $$;

reset role;

-- ===========================================================================
-- 4. LA FICHA LA APLICA QUIEN LA ARMA
-- ===========================================================================
-- La plantilla y la cotización las monta el administrador —la sesión anterior
-- es la del supervisor, que no puede emitir una cotización—; lo que se prueba
-- es quién puede aplicar la ficha.
select test.como_usuario(:'admin_id');

insert into public.plantillas_ficha (nombre, descripcion)
  values ('Plantilla de prueba', 'Dos líneas para comprobar quién la aplica');

insert into public.plantilla_ficha_lineas (plantilla_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  select p.id, 'ESTRUCTURA', 1, 1, 'Bastidor', 'Viga IPE 200'   from public.plantillas_ficha p where p.nombre = 'Plantilla de prueba'
  union all
  select p.id, 'ESTRUCTURA', 1, 2, 'Piso',     'Plancha estriada 3/16"' from public.plantillas_ficha p where p.nombre = 'Plantilla de prueba';

insert into public.cotizaciones (cliente_id, unidad_id, fecha_emision)
  select c.id, u.id, current_date
    from public.clientes c join public.unidades u on u.cliente_id = c.id and u.placa = 'AAA-111'
   limit 1;

select set_config('prueba.plantilla',
  (select id::text from public.plantillas_ficha where nombre = 'Plantilla de prueba'), false);
select set_config('prueba.cotizacion',
  (select id::text from public.cotizaciones order by creado_en desc limit 1), false);

select test.como_usuario(:'diseno_id');
set local role authenticated;

do $$
declare
  v_cot   uuid := current_setting('prueba.cotizacion')::uuid;
  v_plan  uuid := current_setting('prueba.plantilla')::uuid;
  v_lineas int;
begin
  perform test.afirmar(
    public.tiene_permiso('cotizaciones.costear')
      and not public.tiene_permiso('cotizaciones.editar'),
    'Diseño costea pero no edita: es el caso que la guardia vieja dejaba fuera');

  v_lineas := public.aplicar_plantilla_ficha(v_cot, v_plan);

  perform test.afirmar(
    v_lineas = (select count(*) from public.plantilla_ficha_lineas where plantilla_id = v_plan),
    format('y con solo cotizaciones.costear aplica la ficha entera: %s líneas', v_lineas));
end $$;

reset role;

select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
begin
  perform test.debe_fallar(
    format('select public.aplicar_plantilla_ficha(%L, %L)',
           current_setting('prueba.cotizacion'), current_setting('prueba.plantilla')),
    'quien solo ve órdenes no aplica una ficha técnica',
    'No tiene permiso para aplicar una ficha');
end $$;

reset role;

-- ===========================================================================
-- 5. EL PROVEEDOR LO DA DE ALTA QUIEN LO NECESITA
-- ===========================================================================
-- El proveedor nuevo se da de alta justo cuando hace falta emitirle algo, así
-- que Almacén y Costos ven el botón. La política solo aceptaba `compras.crear`
-- y les devolvía un error siempre.
select test.como_usuario(:'costos_id');
set local role authenticated;

do $$
declare v_filas int;
begin
  insert into public.proveedores (numero_documento, razon_social)
    values ('20100000200', 'SUMINISTROS DEL NORTE S.A.C.');
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 1, 'Costos da de alta un proveedor');
end $$;

reset role;

select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
declare v_filas int;
begin
  insert into public.proveedores (numero_documento, razon_social)
    values ('20100000201', 'ACEROS DEL SUR S.A.C.');
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 1, 'y Almacén también');
end $$;

reset role;

select test.como_usuario(:'calidad_id');
set local role authenticated;

do $$
begin
  perform test.debe_fallar(
    'insert into public.proveedores (numero_documento, razon_social)
       values (''20100000202'', ''PINTURAS DEL ESTE S.A.C.'')',
    'Calidad no da de alta proveedores',
    'row-level security');
end $$;

reset role;

rollback;
