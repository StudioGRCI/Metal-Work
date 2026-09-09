-- =============================================================================
-- DATOS DE DEMOSTRACIÓN
-- -----------------------------------------------------------------------------
-- Carga un taller de ejemplo con clientes, unidades, el catálogo de materiales
-- y órdenes de trabajo en distintos estados, para poder recorrer el sistema
-- antes de cargar la información real.
--
--   psql "$DATABASE_URL" -f db/demo/datos-demo.sql
--
-- Requisitos previos: la empresa, una sede y al menos un usuario administrador
-- creados (ver el README). No borra nada: solo agrega lo que falte.
-- =============================================================================

do $$
declare
  v_sede      uuid;
  v_usuario   uuid;
  v_cliente   uuid;
  v_unidad    uuid;
  v_orden     uuid;
  v_cuenta    uuid;
  v_persona   record;
  v_cotizacion    uuid;
  v_jefe          uuid;
  v_plantilla     uuid;
begin
  select id into v_sede from public.sedes where activo order by creado_en limit 1;
  select id into v_usuario from public.usuarios where activo order by creado_en limit 1;

  if v_sede is null or v_usuario is null then
    raise exception 'Antes de cargar la demostración hay que registrar la empresa, una sede y un usuario. Ver el README.';
  end if;

  -- --------------------------------------------------------------- personal
  -- Se crean como fichas de personal, no como accesos: la cuenta queda sin
  -- contraseña, así que ninguna de estas personas puede entrar hasta que
  -- administración le asigne una. Los roles de almacén, compras, calidad y
  -- costos siguen en el catálogo aunque sus módulos se fueron: son gente del
  -- organigrama, no del sistema.
  if to_regclass('auth.users') is not null then
    for v_persona in
      select * from (values
        ('gerencia@metalworkperusac.com',     'Aníbal',   'Sologuren','GERENTE',     'GGE', false,  0.0, 'Gerente general'),
        ('ventas@metalworkperusac.com',       'Karina',   'Bardales', 'VENDEDOR',    'GCO', false,  0.0, 'Ejecutiva comercial'),
        ('jefe.taller@metalworkperusac.com',  'Aurelio',  'Ramírez',  'JEFE_TALLER', 'MTZ', false, 22.0, 'Jefe de maestranza'),
        ('supervisor@metalworkperusac.com',   'Teodoro',  'Alva',     'SUPERVISOR',  'PRD', false, 18.0, 'Supervisor de producción'),
        ('soldador1@metalworkperusac.com',    'Elmer',    'Chávez',   'OPERARIO',    'PRD', true,  14.0, 'Soldador estructural'),
        ('soldador2@metalworkperusac.com',    'Máximo',   'Vargas',   'OPERARIO',    'PRD', true,  14.0, 'Soldador estructural'),
        ('almacen@metalworkperusac.com',      'Rosa',     'Yupanqui', 'ALMACENERO',  'ALM', false, 12.0, 'Almacenera'),
        ('compras@metalworkperusac.com',      'Nelson',   'Ibáñez',   'COMPRADOR',   'LOG', false,  0.0, 'Comprador'),
        ('calidad@metalworkperusac.com',      'Lucía',    'Ferrer',   'CALIDAD',     'CAL', false,  0.0, 'Inspectora de calidad'),
        ('costos@metalworkperusac.com',       'Gabriel',  'Ponce',    'COSTOS',      'CON', false,  0.0, 'Analista de costos')
      ) as p(correo, nombres, apellidos, rol, area, operario, costo, cargo)
    loop
      if not exists (select 1 from public.usuarios where correo = v_persona.correo) then
        v_cuenta := gen_random_uuid();

        insert into auth.users (id, email, raw_user_meta_data)
        values (v_cuenta, v_persona.correo,
                jsonb_build_object('nombres', v_persona.nombres, 'apellidos', v_persona.apellidos))
        on conflict do nothing;

        insert into public.usuarios
          (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id, es_operario, costo_hora)
        values (v_cuenta, v_persona.nombres, v_persona.apellidos, v_persona.correo, v_persona.cargo,
                (select id from public.roles where codigo = v_persona.rol),
                v_sede,
                (select id from public.areas where codigo = v_persona.area),
                v_persona.operario, v_persona.costo);
      end if;
    end loop;
  end if;

  -- ------------------------------------------------------------- materiales
  -- El catálogo chico del que Diseño elige al desglosar una unidad.
  insert into public.materiales
    (codigo, descripcion, categoria_id, unidad_medida_id, espesor_mm, calidad_acero)
  select v.codigo, v.descripcion, c.id, u.id, v.espesor, v.calidad
    from (values
      ('PL-A36-6',   'Plancha LAC ASTM A36 6 mm 1.20 x 2.40 m',  'ACERO_LAC',  'KG',  6.0,  'ASTM A36'),
      ('PL-A36-4',   'Plancha LAC ASTM A36 4 mm 1.20 x 2.40 m',  'ACERO_LAC',  'KG',  4.0,  'ASTM A36'),
      ('PL-HRD-8',   'Plancha antidesgaste Hardox 450 de 8 mm',  'ACERO_ANTIDESG', 'KG', 8.0, 'HARDOX 450'),
      ('TUB-100x50', 'Tubo estructural 100 x 50 x 3 mm',         'ACERO_TUBO', 'M',   3.0,  'ASTM A500'),
      ('ANG-2X2',    'Ángulo estructural 2" x 2" x 1/4"',        'ACERO_PERFIL','M',  6.35, 'ASTM A36'),
      ('ELE-7018',   'Electrodo 7018 de 1/8"',                   'SOLDADURA',  'KG',  null, null),
      ('ALA-MIG',    'Alambre MIG ER70S-6 de 1.2 mm',            'SOLDADURA',  'KG',  null, null),
      ('PIN-BASE',   'Base anticorrosiva epóxica gris',          'PINTURA',    'GAL', null, null),
      ('PIN-ESM',    'Esmalte poliuretano acabado',              'PINTURA',    'GAL', null, null),
      ('THI-ACR',    'Thinner acrílico',                         'PINTURA',    'GAL', null, null),
      ('DIS-CORTE',  'Disco de corte 7" x 1/8"',                 'CONSUMIBLES','UND', null, null),
      ('DIS-DESB',   'Disco de desbaste 7" x 1/4"',              'CONSUMIBLES','UND', null, null),
      ('PIS-HID-5',  'Pistón hidráulico telescópico de 5 etapas','HIDRAULICO', 'UND', null, null),
      ('BOM-HID',    'Bomba hidráulica de engranajes',           'HIDRAULICO', 'UND', null, null),
      ('MAN-HID',    'Manguera hidráulica de alta presión 1/2"', 'HIDRAULICO', 'M',  null, null),
      ('ARN-ELE',    'Arnés eléctrico completo para carrocería', 'ELECTRICO',  'JGO', null, null),
      ('LUZ-LED',    'Faro LED de posición 24 V',                'ELECTRICO',  'UND', null, null),
      ('PER-58',     'Perno hexagonal grado 8.8 de 5/8" x 2"',   'FERRETERIA', 'UND', null, null)
    ) as v(codigo, descripcion, cat, um, espesor, calidad)
    join public.categorias_material c on c.codigo = v.cat
    join public.unidades_medida u     on u.codigo = v.um
  on conflict (codigo) do nothing;

  -- --------------------------------------------------------------- clientes
  insert into public.clientes
    (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito, provincia, departamento, telefono, correo)
  values
    ('RUC', '20512345671', 'TRANSPORTES ANDINOS S.A.C.',      'Av. Néstor Gambetta 1450', 'Callao',      'Callao',   'Callao',    '014521200', 'logistica@transandinos.pe'),
    ('RUC', '20512345672', 'MINERA CERRO VERDE CONTRATISTAS', 'Carretera Variante 12',    'Uchumayo',    'Arequipa', 'Arequipa',  '054387100', 'compras@mcvcontratistas.pe'),
    ('RUC', '20512345673', 'CONSTRUCTORA DEL SUR E.I.R.L.',   'Av. Los Constructores 890','Ate',         'Lima',     'Lima',      '013489900', 'admin@construsur.pe'),
    ('RUC', '20512345674', 'AGROINDUSTRIAS LA JOYA S.A.',     'Fundo La Joya s/n',        'La Joya',     'Arequipa', 'Arequipa',  '054290030', 'operaciones@agrolajoya.pe'),
    ('DNI', '45678912',    'CARLOS MENDOZA QUISPE',           'Jr. Los Olivos 235',       'San Martín',  'Lima',     'Lima',      '987654321', 'cmendoza@gmail.com')
  on conflict (tipo_documento, numero_documento) do nothing;

  -- --------------------------------------------------------------- unidades
  insert into public.unidades
    (cliente_id, placa, tipo_vehiculo, marca, modelo, anio, numero_chasis, capacidad_m3, capacidad_toneladas)
  select c.id, v.placa, v.tipo::public.tipo_vehiculo, v.marca, v.modelo, v.anio, v.chasis, v.m3, v.ton
    from (values
      ('20512345671', 'V2G-841', 'VOLQUETE',      'VOLVO',      'FMX 440',   2021, '9BVRW40A8MEXXXX01', 18.0, 30.0),
      ('20512345671', 'B7T-329', 'TRACTO',        'SCANIA',     'R450',      2020, 'YS2R4X20005XXXX02', null, 40.0),
      ('20512345672', 'C4L-118', 'VOLQUETE',      'MERCEDES',   'AXOR 3344', 2019, 'WDB9583211LXXXX03', 15.0, 25.0),
      ('20512345672', 'D8M-506', 'SEMIRREMOLQUE', 'RANDON',     'SR CA',     2022, '9AJSR3428NBXXXX04', null, 35.0),
      ('20512345673', 'F3P-772', 'CAMION',        'HINO',       'GH 500',    2021, 'JHDGH8JMT1XXXXX05', null, 12.0),
      ('20512345674', 'G9K-284', 'CAMION',        'HYUNDAI',    'HD 120',    2023, 'KMFGA17JPPCXXXX06', null,  8.0),
      ('45678912',    'H5R-903', 'REMOLQUE',      'FAMECO',     'RC 3E',     2018, '9AFRC3E00JBXXXX07', null, 28.0)
    ) as v(doc, placa, tipo, marca, modelo, anio, chasis, m3, ton)
    join public.clientes c on c.numero_documento = v.doc
  on conflict do nothing;

  -- ----------------------------------------------------------------- órdenes
  -- Se crean solo si el taller aún no tiene ninguna, para no duplicar.
  if not exists (select 1 from public.ordenes_trabajo) then

    -- 1) Orden en pleno proceso.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c
      join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345671' and u.placa = 'V2G-841';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad, descripcion,
       especificaciones_tecnicas, fecha_inicio_programada, fecha_fin_programada,
       fecha_entrega_comprometida, responsable_id, monto_presupuestado)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION', 'ALTA',
      'Fabricación de tolva de volquete de 18 m3 en acero A36 con piso Hardox',
      E'Largo 5.60 m, ancho 2.40 m, alto 1.55 m.\nPiso en Hardox 450 de 8 mm, laterales en A36 de 6 mm.\nCompuerta trasera con seguros hidráulicos.\nPistón telescópico de 5 etapas.\nPintura: base epóxica y acabado poliuretano color del cliente.',
      current_date - 20, current_date + 10, current_date + 12, v_usuario, 52000
      from public.tipos_carroceria tc where tc.codigo = 'TOLVA_VOLQUETE'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_orden;

    -- Avance real de taller: las primeras etapas terminadas, producción en curso.
    update public.ot_etapas e set avance_porcentaje = 100, estado = 'TERMINADA'
      from public.etapas_catalogo c
     where e.etapa_catalogo_id = c.id and e.orden_id = v_orden
       and c.codigo in ('HABILITADO_MP', 'DISENO');

    update public.ot_etapas e set avance_porcentaje = 60, estado = 'EN_PROCESO'
      from public.etapas_catalogo c
     where e.etapa_catalogo_id = c.id and e.orden_id = v_orden and c.codigo = 'PRODUCCION';

    -- 2) Orden pausada por falta de material.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345672' and u.placa = 'C4L-118';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad, descripcion,
       fecha_entrega_comprometida, responsable_id, monto_presupuestado)
    select v_cliente, v_unidad, v_sede, tc.id, 'REPOTENCIACION', 'NORMAL',
      'Repotenciación de tolva: cambio de piso y refuerzo de laterales',
      current_date - 3, v_usuario, 18500
      from public.tipos_carroceria tc where tc.codigo = 'REPOTENCIACION'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_orden;
    update public.ordenes_trabajo
       set estado = 'PAUSADA',
           motivo_pausa = 'Se agotó la plancha Hardox de 8 mm; el proveedor confirma entrega en 5 días'
     where id = v_orden;

    -- 3) Orden urgente recién programada.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345673' and u.placa = 'F3P-772';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad, descripcion,
       fecha_inicio_programada, fecha_fin_programada, fecha_entrega_comprometida,
       responsable_id, monto_presupuestado)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION', 'URGENTE',
      'Fabricación de furgón cerrado de 6.20 m con puerta lateral',
      current_date + 2, current_date + 25, current_date + 28, v_usuario, 38000
      from public.tipos_carroceria tc where tc.codigo = 'FURGON'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    update public.ordenes_trabajo set estado = 'PROGRAMADA' where id = v_orden;

    -- 4) Orden ya entregada, con su acta de conformidad.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345674' and u.placa = 'G9K-284';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, descripcion,
       fecha_entrega_comprometida, responsable_id, monto_presupuestado)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION',
      'Fabricación de plataforma con barandas abatibles de 5.00 m',
      current_date - 5, v_usuario, 26000
      from public.tipos_carroceria tc where tc.codigo = 'BARANDA'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_orden;

    update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA'
     where orden_id = v_orden;

    update public.ordenes_trabajo set estado = 'TERMINADA' where id = v_orden;

    -- Tesorería confirma que el cliente está al día; sin esto el acta no entra.
    insert into public.liberaciones_tesoreria (orden_id, liberado_por, observacion)
    values (v_orden, v_usuario, 'Cliente al día: canceló el saldo con la factura F001-2210.');

    insert into public.ot_entregas
      (orden_id, fecha_entrega, recibe_nombre, recibe_documento, recibe_cargo, garantia_meses,
       entregado_por, salida_confirmada_por, salida_confirmada_en)
    values (v_orden, current_date - 5, 'Julio Ramírez Soto', '41255678', 'Jefe de flota', 12,
            v_usuario, v_usuario, now() - interval '5 days');

    -- 5) Orden en borrador, todavía sin liberar a taller.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '45678912' and u.placa = 'H5R-903';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, prioridad, descripcion,
       responsable_id, monto_presupuestado)
    select v_cliente, v_unidad, v_sede, tc.id, 'REPARACION', 'BAJA',
      'Reparación de estructura y cambio de barandas del remolque',
      v_usuario, 7800
      from public.tipos_carroceria tc where tc.codigo = 'BARANDA';
  end if;

  -- ------------------------------------------------------------ cotización
  -- El recorrido de una carrocería empieza acá, no en la orden. Se deja una
  -- cotización aprobada del mismo cliente y la misma unidad de la orden que
  -- está en taller, para poder seguir el hilo completo.
  if not exists (select 1 from public.cotizaciones) then
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345671' and u.placa = 'V2G-841';

    insert into public.cotizaciones
      (cliente_id, unidad_id, tipo_carroceria_id, sede_id, fecha_emision, validez_dias,
       plazo_entrega_dias, forma_pago, condiciones, vendedor_id,
       concepto, concepto_cantidad, concepto_unidad)
    select v_cliente, v_unidad, tc.id, v_sede, current_date - 30, 20,
           45, '50 % adelanto, saldo contra entrega',
           'Precios en soles, no incluyen traslado fuera de la ciudad.',
           v_usuario,
           -- Lo que sale impreso: el trabajo entero, sin abrir las partidas.
           'Fabricación de tolva de volquete de 18 m3 en acero A36 con piso Hardox 450, sistema hidráulico y acabado',
           1, 'UND'
      from public.tipos_carroceria tc where tc.codigo = 'TOLVA_VOLQUETE'
    returning id into v_cotizacion;

    insert into public.cotizacion_partidas
      (cotizacion_id, orden_secuencia, descripcion, unidad_medida, cantidad, precio_unitario, tipo_costo)
    select v_cotizacion, v.secuencia, v.descripcion, v.unidad, v.cantidad, v.precio, v.tipo::public.tipo_costo_partida
      from (values
        (1, 'Fabricación de tolva de volquete de 18 m3 en acero A36 con piso Hardox 450',
            'UND', 1.0, 42000.0, 'MATERIAL'),
        (2, 'Sistema hidráulico: pistón telescópico de 5 etapas, bomba y mando',
            'JGO', 1.0,  8600.0, 'MATERIAL'),
        (3, 'Arenado y pintura: base epóxica y acabado poliuretano al color del cliente',
            'UND', 1.0,  1900.0, 'SERVICIO')
      ) as v(secuencia, descripcion, unidad, cantidad, precio, tipo);

    -- Las partidas solo se pueden cargar mientras la cotización está en
    -- borrador; recién entonces se envía y se aprueba, como en la realidad.
    update public.cotizaciones set estado = 'ENVIADA' where id = v_cotizacion;
    update public.cotizaciones
       set estado = 'APROBADA', fecha_aprobacion = current_date - 24, aprobada_por = v_usuario
     where id = v_cotizacion;

    -- La orden en taller queda colgada de su cotización.
    update public.ordenes_trabajo o
       set cotizacion_id = v_cotizacion
      from public.unidades u
     where u.id = o.unidad_id and u.placa = 'V2G-841' and o.cotizacion_id is null;
  end if;

  -- ------------------------------------------------------------ avance diario
  -- Lo que se hizo cada día en la unidad. Sin fotos, porque el archivo vive en
  -- Storage y la demostración solo carga base de datos; el texto igual arma el
  -- tablero del taller y la línea de tiempo de la orden.
  if not exists (select 1 from public.ot_avances) then
    select id into v_jefe from public.usuarios
     where correo like '%jefe%' or cargo ilike '%jefe%' limit 1;
    v_jefe := coalesce(v_jefe, v_usuario);

    -- Quien registra el avance tiene que estar identificado: la bitácora de la
    -- OT no acepta anotaciones anónimas.
    perform set_config('request.jwt.claim.sub', v_jefe::text, true);

    select o.id into v_orden
      from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
     where u.placa = 'V2G-841';

    insert into public.ot_avances (orden_id, etapa_id, fecha, descripcion, avance_porcentaje, registrado_por)
    select v_orden, e.id, current_date - 6,
      'Se trazó y cortó la plancha del piso en Hardox 450 y se armó el bastidor sobre la mesa.',
      100, v_jefe
      from public.ot_etapas e
      join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
     where e.orden_id = v_orden and ec.codigo in ('HABILITADO_MP', 'HABILITADO')
     order by e.orden_secuencia limit 1;

    insert into public.ot_avances (orden_id, etapa_id, fecha, descripcion, avance_porcentaje, registrado_por)
    select v_orden, e.id, current_date - 3,
      'Se soldaron los travesaños del piso y se levantaron los laterales. Falta el frontal.',
      55, v_jefe
      from public.ot_etapas e
      join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
     where e.orden_id = v_orden and ec.codigo in ('PRODUCCION', 'ARMADO')
     order by e.orden_secuencia limit 1;

    insert into public.ot_avances (orden_id, fecha, descripcion, impedimento, registrado_por)
    values (v_orden, current_date - 1,
      'La tolva salió al arenado. Se aprovechó para adelantar los seguros de la compuerta.',
      'Falta la plancha Hardox de 8 mm del refuerzo trasero; el proveedor la entrega el jueves.',
      v_jefe);

    -- Una unidad que hace días que nadie toca: es lo que el tablero resalta.
    select o.id into v_orden
      from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
     where u.placa = 'C4L-118';

    if v_orden is not null then
      insert into public.ot_avances (orden_id, fecha, descripcion, impedimento, registrado_por)
      values (v_orden, current_date - 9,
        'Se desmontó la tolva vieja y se revisó el estado del chasis.',
        'El cliente todavía no aprueba el cambio de compuerta; sin eso no se puede seguir.',
        v_jefe);
    end if;

    perform set_config('request.jwt.claim.sub', '', true);
  end if;

  -- ------------------------------------------------ la ficha de la cotización
  -- La cotización de esta empresa es una ficha técnica: declara espesores,
  -- normas y accesorios. Se aplica la plantilla del producto para que la
  -- pantalla muestre lo que el cliente realmente recibe.
  if not exists (select 1 from public.cotizacion_especificaciones) then
    select c.id into v_cotizacion
      from public.cotizaciones c
      join public.tipos_carroceria t on t.id = c.tipo_carroceria_id
     where t.codigo = 'TOLVA_VOLQUETE'
     limit 1;

    select p.id into v_plantilla
      from public.plantillas_ficha p
      join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
     where t.codigo = 'TOLVA_VOLQUETE' and p.activa
     limit 1;

    if v_cotizacion is not null and v_plantilla is not null then
      -- Se copia a mano y no con aplicar_plantilla_ficha() porque esa función
      -- exige permiso y acá no hay sesión iniciada.
      insert into public.cotizacion_especificaciones
        (cotizacion_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
      select v_cotizacion, l.seccion, l.orden_seccion, l.orden_linea, l.etiqueta, l.detalle
        from public.plantilla_ficha_lineas l where l.plantilla_id = v_plantilla;

      insert into public.cotizacion_accesorios
        (cotizacion_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
      select v_cotizacion, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
        from public.plantilla_ficha_accesorios a where a.plantilla_id = v_plantilla;

      update public.cotizaciones
         set modelo = 'VASCULANTE', tipo = 'TOLVA',
             largo_m = 5.60, ancho_m = 2.40, alto_m = 1.55,
             capacidad = '18 M3', garantia_meses = 12, incluye_igv = true,
             nota = 'Incluye certificado de montaje y expediente para registros públicos.'
       where id = v_cotizacion;
    end if;
  end if;

  -- ------------------------------------------------ la ficha de taller de la OT
  -- Los accesorios de la cotización recién existen unas líneas más arriba, así
  -- que las órdenes que ya se aprobaron todavía no los tienen. Se arma la ficha
  -- ahora y se deja a medio llenar, que es como se ve una unidad en planta.
  if not exists (select 1 from public.ot_repuestos) then
    for v_orden in
      select id from public.ordenes_trabajo where estado not in ('BORRADOR', 'ANULADA')
    loop
      perform public.armar_ficha_ot(v_orden);
    end loop;

    -- La unidad que está en proceso: medidas tomadas y media lista marcada.
    select o.id into v_orden
      from public.ordenes_trabajo o
     where o.estado = 'EN_PROCESO'
     order by o.creado_en
     limit 1;

    if v_orden is not null then
      update public.ordenes_trabajo
         set largo_m = 5.60, ancho_m = 2.40, alto_m = 1.55,
             capacidad_carga = '18 M3', ruedas = '10 ruedas',
             tipo_llantas = '295/80 R22.5', cantidad_ejes = 3,
             tipo_suspension = 'Muelles reforzados',
             colores = 'Cabina blanca, tolva rojo institucional',
             caracteristicas_especiales =
               'Compuerta posterior con apertura mecánica automática. '
               || 'Visera protectora de cabina en plancha de 2.5 mm.',
             encargado_produccion_id = v_jefe
       where id = v_orden;

      insert into public.ot_repuestos (orden_id, orden, cantidad, descripcion, marca)
      values (v_orden, 1, 2, 'Pistón hidráulico telescópico de repuesto', 'HYVA'),
             (v_orden, 2, 4, 'Faro lateral LED 24V',                     'HELLA'),
             (v_orden, 3, 1, 'Kit de mangueras hidráulicas',             'PARKER');

      -- Los primeros pasos ya pasaron las dos revisiones; los del medio, solo
      -- la primera. Lo que sigue está sin tocar.
      update public.ot_verificaciones
         set avance_1 = true, avance_1_en = now() - interval '9 days',
             avance_2 = true, avance_2_en = now() - interval '7 days',
             responsable_id = v_jefe
       where orden_id = v_orden and numero <= 5;

      update public.ot_verificaciones
         set avance_1 = true, avance_1_en = now() - interval '3 days',
             responsable_id = v_jefe
       where orden_id = v_orden and numero between 6 and 8;

      update public.ot_verificaciones
         set observaciones = 'Falta el sello de la válvula; se pidió al proveedor.'
       where orden_id = v_orden and numero = 9;

      -- El V°B° de los accesorios ya montados.
      update public.ot_accesorios
         set verificado = true, verificado_en = now() - interval '2 days',
             verificado_por = v_jefe
       where orden_id = v_orden
         and id in (select id from public.ot_accesorios
                     where orden_id = v_orden order by orden limit 3);
    end if;
  end if;

  raise notice 'Datos de demostración cargados: % clientes, % unidades, % órdenes, % materiales',
    (select count(*) from public.clientes),
    (select count(*) from public.unidades),
    (select count(*) from public.ordenes_trabajo),
    (select count(*) from public.materiales);
end;
$$;
