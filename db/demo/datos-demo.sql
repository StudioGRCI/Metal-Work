-- =============================================================================
-- DATOS DE DEMOSTRACIÓN
-- -----------------------------------------------------------------------------
-- Carga un taller de ejemplo con clientes, unidades, materiales con existencia
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
  v_almacen   uuid;
  v_cliente   uuid;
  v_unidad    uuid;
  v_orden     uuid;
  v_mov       uuid;
  v_parte     uuid;
  v_operario  uuid;
begin
  select id into v_sede from public.sedes where activo order by creado_en limit 1;
  select id into v_usuario from public.usuarios where activo order by creado_en limit 1;

  if v_sede is null or v_usuario is null then
    raise exception 'Antes de cargar la demostración hay que registrar la empresa, una sede y un usuario. Ver el README.';
  end if;

  -- ---------------------------------------------------------------- almacén
  insert into public.almacenes (codigo, nombre, sede_id, tipo)
  values ('ALM01', 'Almacén central', v_sede, 'PRINCIPAL')
  on conflict (codigo) do nothing;

  select id into v_almacen from public.almacenes where codigo = 'ALM01';

  insert into public.materiales
    (codigo, descripcion, categoria_id, unidad_medida_id, espesor_mm, calidad_acero, stock_minimo, es_critico)
  select v.codigo, v.descripcion, c.id, u.id, v.espesor, v.calidad, v.minimo, v.critico
    from (values
      ('PL-A36-6',   'Plancha LAC ASTM A36 6 mm 1.20 x 2.40 m',  'ACERO_LAC',  'KG',  6.0,  'ASTM A36',  500.0, true),
      ('PL-A36-4',   'Plancha LAC ASTM A36 4 mm 1.20 x 2.40 m',  'ACERO_LAC',  'KG',  4.0,  'ASTM A36',  400.0, true),
      ('PL-HRD-8',   'Plancha antidesgaste Hardox 450 de 8 mm',  'ACERO_ANTIDESG', 'KG', 8.0, 'HARDOX 450', 300.0, true),
      ('TUB-100x50', 'Tubo estructural 100 x 50 x 3 mm',         'ACERO_TUBO', 'M',   3.0,  'ASTM A500',  120.0, false),
      ('ANG-2X2',    'Ángulo estructural 2" x 2" x 1/4"',        'ACERO_PERFIL','M',  6.35, 'ASTM A36',   100.0, false),
      ('ELE-7018',   'Electrodo 7018 de 1/8"',                   'SOLDADURA',  'KG',  null, null,          50.0, true),
      ('ALA-MIG',    'Alambre MIG ER70S-6 de 1.2 mm',            'SOLDADURA',  'KG',  null, null,          40.0, true),
      ('PIN-BASE',   'Base anticorrosiva epóxica gris',          'PINTURA',    'GAL', null, null,          20.0, false),
      ('PIN-ESM',    'Esmalte poliuretano acabado',              'PINTURA',    'GAL', null, null,          20.0, false),
      ('THI-ACR',    'Thinner acrílico',                         'PINTURA',    'GAL', null, null,          15.0, false),
      ('DIS-CORTE',  'Disco de corte 7" x 1/8"',                 'CONSUMIBLES','UND', null, null,         100.0, false),
      ('DIS-DESB',   'Disco de desbaste 7" x 1/4"',              'CONSUMIBLES','UND', null, null,          80.0, false),
      ('PIS-HID-5',  'Pistón hidráulico telescópico de 5 etapas','HIDRAULICO', 'UND', null, null,           2.0, true),
      ('BOM-HID',    'Bomba hidráulica de engranajes',           'HIDRAULICO', 'UND', null, null,           2.0, true),
      ('MAN-HID',    'Manguera hidráulica de alta presión 1/2"', 'HIDRAULICO', 'M',  null, null,          30.0, false),
      ('ARN-ELE',    'Arnés eléctrico completo para carrocería', 'ELECTRICO',  'JGO', null, null,           3.0, false),
      ('LUZ-LED',    'Faro LED de posición 24 V',                'ELECTRICO',  'UND', null, null,          20.0, false),
      ('PER-58',     'Perno hexagonal grado 8.8 de 5/8" x 2"',   'FERRETERIA', 'UND', null, null,         200.0, false)
    ) as v(codigo, descripcion, cat, um, espesor, calidad, minimo, critico)
    join public.categorias_material c on c.codigo = v.cat
    join public.unidades_medida u     on u.codigo = v.um
  on conflict (codigo) do nothing;

  -- Ingreso inicial de existencias, para que el almacén no arranque vacío.
  if not exists (select 1 from public.kardex) then
    insert into public.movimientos_almacen (tipo, almacen_id, documento_referencia, responsable_id, motivo)
    values ('INGRESO', v_almacen, 'Carga inicial de demostración', v_usuario, null)
    returning id into v_mov;

    insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, m.id, v.cantidad, v.costo
      from (values
        ('PL-A36-6',   2400.0,   4.85),
        ('PL-A36-4',   1600.0,   4.90),
        ('PL-HRD-8',    900.0,  12.40),
        ('TUB-100x50',  480.0,  28.50),
        ('ANG-2X2',     360.0,  22.80),
        ('ELE-7018',    180.0,  11.90),
        ('ALA-MIG',     120.0,  14.60),
        ('PIN-BASE',     45.0,  98.00),
        ('PIN-ESM',      40.0, 142.00),
        ('THI-ACR',      60.0,  38.00),
        ('DIS-CORTE',   240.0,   4.20),
        ('DIS-DESB',    180.0,   6.80),
        ('PIS-HID-5',     6.0, 4850.00),
        ('BOM-HID',       5.0, 1980.00),
        ('MAN-HID',      90.0,  46.00),
        ('ARN-ELE',       8.0, 720.00),
        ('LUZ-LED',      60.0,  34.00),
        ('PER-58',      900.0,   2.60)
      ) as v(codigo, cantidad, costo)
      join public.materiales m on m.codigo = v.codigo;

    perform public.confirmar_movimiento_almacen(v_mov);
  end if;

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

    -- 1) Orden en pleno proceso, con material consumido y horas registradas.
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

    -- Avance real de taller: las primeras etapas terminadas, soldadura en curso.
    update public.ot_etapas e set avance_porcentaje = 100, estado = 'TERMINADA'
      from public.etapas_catalogo c
     where e.etapa_catalogo_id = c.id and e.orden_id = v_orden
       and c.codigo in ('HABILITADO', 'ARMADO');

    update public.ot_etapas e set avance_porcentaje = 60, estado = 'EN_PROCESO'
      from public.etapas_catalogo c
     where e.etapa_catalogo_id = c.id and e.orden_id = v_orden and c.codigo = 'SOLDADURA';

    -- Consumo de material contra la orden.
    insert into public.movimientos_almacen (tipo, almacen_id, orden_id, responsable_id)
    values ('SALIDA_OT', v_almacen, v_orden, v_usuario)
    returning id into v_mov;

    insert into public.movimiento_detalle (movimiento_id, material_id, cantidad)
    select v_mov, m.id, v.cantidad
      from (values ('PL-A36-6', 820.0), ('PL-HRD-8', 460.0), ('TUB-100x50', 96.0),
                   ('ELE-7018', 34.0), ('DIS-CORTE', 28.0)) as v(codigo, cantidad)
      join public.materiales m on m.codigo = v.codigo;

    perform public.confirmar_movimiento_almacen(v_mov);

    -- Horas de taller de los últimos días.
    select id into v_operario from public.usuarios where es_operario and activo limit 1;

    if v_operario is not null then
      for i in 1..3 loop
        insert into public.partes_diarios (fecha, sede_id, responsable_id)
        values (current_date - i, v_sede, v_usuario)
        on conflict (sede_id, fecha) do nothing
        returning id into v_parte;

        if v_parte is not null then
          insert into public.parte_detalle (parte_id, orden_id, etapa_id, usuario_id, horas, descripcion)
          select v_parte, v_orden, e.id, v_operario, 8,
                 'Soldadura de refuerzos y cordones estructurales'
            from public.ot_etapas e
            join public.etapas_catalogo c on c.id = e.etapa_catalogo_id
           where e.orden_id = v_orden and c.codigo = 'SOLDADURA';

          update public.partes_diarios set estado = 'CERRADO'  where id = v_parte;
          update public.partes_diarios set estado = 'APROBADO' where id = v_parte;
        end if;
      end loop;
    end if;

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

    insert into public.ot_inspecciones (orden_id, etapa_id, resultado, inspector_id, observaciones)
    select v_orden, e.id, 'CONFORME', v_usuario, null
      from public.ot_etapas e where e.orden_id = v_orden and e.requiere_inspeccion;

    update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA'
     where orden_id = v_orden;

    -- Documentación obligatoria de la orden: sin ella la base no deja entregar.
    insert into public.documentos (tipo_documento_id, titulo, entidad_tabla, entidad_id, orden_id, fecha_documento)
    select td.id, td.nombre || ' — plataforma con barandas', 'ordenes_trabajo', v_orden, v_orden, current_date - 6
      from public.tipos_documento td
     where td.obligatorio_para_cierre and td.activo;

    insert into public.documento_versiones
      (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes, subido_por)
    select d.id,
           'ot/' || v_orden || '/' || d.id || '.pdf',
           lower(replace(d.titulo, ' ', '-')) || '.pdf',
           'pdf', 186000, v_usuario
      from public.documentos d where d.orden_id = v_orden;

    -- Y un par de fotos del avance, que es lo que el taller sube a diario.
    insert into public.documentos (tipo_documento_id, titulo, entidad_tabla, entidad_id, orden_id, fecha_documento)
    select td.id, 'Avance de estructura', 'ordenes_trabajo', v_orden, v_orden, current_date - 10
      from public.tipos_documento td where td.codigo = 'FOTO_AVANCE';

    update public.ordenes_trabajo set estado = 'CONTROL_CALIDAD' where id = v_orden;
    update public.ordenes_trabajo set estado = 'TERMINADA'       where id = v_orden;

    insert into public.ot_entregas
      (orden_id, fecha_entrega, recibe_nombre, recibe_documento, recibe_cargo, garantia_meses, entregado_por)
    values (v_orden, current_date - 5, 'Julio Ramírez Soto', '41255678', 'Jefe de flota', 12, v_usuario);

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

  raise notice 'Datos de demostración cargados: % clientes, % unidades, % órdenes, % materiales',
    (select count(*) from public.clientes),
    (select count(*) from public.unidades),
    (select count(*) from public.ordenes_trabajo),
    (select count(*) from public.materiales);
end;
$$;
