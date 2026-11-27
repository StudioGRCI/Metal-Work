-- =============================================================================
-- DATOS DE DEMOSTRACIÓN
-- -----------------------------------------------------------------------------
-- Carga un taller de ejemplo con clientes, unidades, el catálogo de materiales
-- y órdenes de trabajo en distintos estados, para poder recorrer el sistema
-- antes de cargar la información real.
--
--   PGOPTIONS='-c demo.base_de_prueba=si' psql "$URL_DE_LA_BASE_DE_PRUEBA" -f db/demo/datos-demo.sql
--
-- Requisitos previos: la empresa, una sede y al menos un usuario administrador
-- creados (ver el README). No borra nada: solo agrega lo que falte.
--
-- Solo en una base de prueba. Las OT, los RQ, las OC y las OS toman números de
-- las series reales, y un documento numerado no se borra nunca: cargados en la
-- base de la empresa, dejarían huecos que nadie podría explicar. Por eso el
-- archivo se detiene si no se le dice a propósito que la base es de prueba.
-- =============================================================================

\set ON_ERROR_STOP on
do $$
begin
  if coalesce(current_setting('demo.base_de_prueba', true), '') <> 'si' then
    raise exception 'Los datos de demostración van solo en una base de prueba: toman números de las series reales y no se borran. Si esta es una base de prueba, cárgalos con PGOPTIONS=''-c demo.base_de_prueba=si''.';
  end if;
end $$;

-- Desde la migración 20260928130000 Diseño define las etapas de cada OT, con su
-- peso, y Administración les pone inicio y fin, antes de que el taller empiece.
-- La demostración no tiene sesión para llamar a definir_etapas_ponderadas, así
-- que copia aquí lo que esa función deja: todas las etapas del catálogo, el peso
-- repartido por sus días estándar (suma exactamente 100) y las fechas seguidas
-- entre el inicio y el fin de la orden.
create or replace function pg_temp.demo_plan_etapas(p_orden uuid, p_inicio date, p_fin date)
returns void language plpgsql as $f$
declare
  v_total numeric;
  v_dias integer := greatest(p_fin - p_inicio, 1);
begin
  select sum(greatest(dias_estandar, 1)) into v_total from public.etapas_catalogo where activo;
  insert into public.ot_etapas
    (orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion,
     area_id, peso_pct, fecha_inicio_programada, fecha_fin_programada)
  -- Solo Administración, Diseño, Producción, Maestranza y Acabados llevan
  -- etapas (migración 20260929100004): las de Logística o Almacén van a
  -- Administración, como las reparte Diseño.
  select p_orden, c.id, row_number() over w, c.horas_estandar, c.requiere_inspeccion,
         case when a.codigo in ('ADM', 'DIS', 'PRD', 'MTZ', 'ACB') then a.id
              else (select id from public.areas where codigo = 'ADM') end,
         round(100 * greatest(c.dias_estandar, 1) / v_total, 2),
         p_inicio + floor(v_dias * (sum(greatest(c.dias_estandar, 1)) over w - greatest(c.dias_estandar, 1)) / v_total)::integer,
         p_inicio + floor(v_dias * (sum(greatest(c.dias_estandar, 1)) over w) / v_total)::integer
    from public.etapas_catalogo c
    left join public.areas a on a.id = c.area_id
   where c.activo
  window w as (order by c.orden_secuencia)
  on conflict (orden_id, etapa_catalogo_id) do nothing;
  -- El redondeo deja unas centésimas sueltas: van a la etapa más larga.
  update public.ot_etapas e
     set peso_pct = e.peso_pct + 100 - (select sum(peso_pct) from public.ot_etapas where orden_id = p_orden)
   where e.id = (select id from public.ot_etapas where orden_id = p_orden order by peso_pct desc limit 1);
end;
$f$;

do $$
declare
  v_sede      uuid;
  v_usuario   uuid;
  v_cliente   uuid;
  v_unidad    uuid;
  v_orden     uuid;
  v_cuenta    uuid;
  v_persona   record;
  v_jefe          uuid;
  v_plantilla     uuid;
begin
  select id into v_sede from public.sedes where activo order by creado_en limit 1;
  -- El administrador del sistema, no la primera cuenta: la migración 042 crea
  -- antes la de Administración, que no aprueba órdenes.
  select u.id into v_usuario from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and r.codigo = 'ADMIN' order by u.creado_en limit 1;

  if v_sede is null or v_usuario is null then
    raise exception 'Antes de cargar la demostración hay que registrar la empresa, una sede y un usuario. Ver el README.';
  end if;

  -- Los disparadores de la OT anotan quién hizo cada cambio y exigen que lo
  -- vea (`ot_registrar_evento`, migración 013): la carga va con la sesión del
  -- administrador.
  perform set_config('request.jwt.claim.sub', v_usuario::text, true);

  -- --------------------------------------------------------------- personal
  -- Se crean como fichas de personal, no como accesos: la cuenta queda sin
  -- contraseña, así que ninguna de estas personas puede entrar hasta que
  -- administración le asigne una. Los roles de almacén, compras, calidad y
  -- costos siguen en el catálogo aunque sus módulos se fueron: son gente del
  -- organigrama, no del sistema.
  if to_regclass('auth.users') is not null then
    -- El costo por hora lo pone Recursos Humanos (migración 20261020165000):
    -- la carga de las fichas va sin la sesión del administrador, como dueño de
    -- la base, y la recupera al terminar.
    perform set_config('request.jwt.claim.sub', '', true);
    for v_persona in
      select * from (values
        ('gerencia@metalworkperusac.com',     'Aníbal',   'Sologuren','GERENTE',     'GGE', false,  0.0, 'Gerente general'),
        ('ventas@metalworkperusac.com',       'Karina',   'Bardales', 'VENDEDOR',    'GCO', false,  0.0, 'Ejecutiva comercial'),
        ('supervisor.maestranza@metalworkperusac.com', 'Aurelio', 'Ramírez', 'SUPERVISOR', 'MTZ', false, 22.0, 'Supervisor de maestranza'),
        ('supervisor@metalworkperusac.com',   'Teodoro',  'Alva',     'SUPERVISOR',  'PRD', false, 18.0, 'Supervisor de producción'),
        ('soldador1@metalworkperusac.com',    'Elmer',    'Chávez',   'OPERARIO',    'PRD', true,  14.0, 'Soldador estructural'),
        ('soldador2@metalworkperusac.com',    'Máximo',   'Vargas',   'OPERARIO',    'PRD', true,  14.0, 'Soldador estructural'),
        ('almacen@metalworkperusac.com',      'Rosa',     'Yupanqui', 'ALMACENERO',  'ALM', false, 12.0, 'Almacenera'),
        ('compras@metalworkperusac.com',      'Nelson',   'Ibáñez',   'COMPRADOR',   'LOG', false,  0.0, 'Comprador'),
        ('calidad@metalworkperusac.com',      'Lucía',    'Ferrer',   'CALIDAD',     'CAL', false,  0.0, 'Inspectora de calidad'),
        ('costos@metalworkperusac.com',       'Gabriel',  'Ponce',    'COSTOS',      'CON', false,  0.0, 'Analista de costos')
      ) as p(correo, nombres, apellidos, rol, area, operario, costo, cargo)
    loop
      -- La supervisión es una por área: el banco local le cambia el correo a la
      -- de la demostración (`preparar.sh`), y al volver a cargar no se crea otra.
      if not exists (select 1 from public.usuarios where correo = v_persona.correo)
         and not (v_persona.rol = 'SUPERVISOR' and exists (
               select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
                 join public.areas a on a.id = u.area_id
                where u.activo and r.codigo = 'SUPERVISOR' and a.codigo = v_persona.area)) then
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
    perform set_config('request.jwt.claim.sub', v_usuario::text, true);
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
       fecha_entrega_comprometida, responsable_id)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION', 'ALTA',
      'Fabricación de tolva de volquete de 18 m3 en acero A36 con piso Hardox',
      E'Largo 5.60 m, ancho 2.40 m, alto 1.55 m.\nPiso en Hardox 450 de 8 mm, laterales en A36 de 6 mm.\nCompuerta trasera con seguros hidráulicos.\nPistón telescópico de 5 etapas.\nPintura: base epóxica y acabado poliuretano color del cliente.',
      current_date - 20, current_date + 10, current_date + 12, v_usuario
      from public.tipos_carroceria tc where tc.codigo = 'TOLVA_VOLQUETE'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    perform pg_temp.demo_plan_etapas(v_orden, current_date - 20, current_date + 10);
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
       fecha_entrega_comprometida, responsable_id)
    select v_cliente, v_unidad, v_sede, tc.id, 'REPOTENCIACION', 'NORMAL',
      'Repotenciación de tolva: cambio de piso y refuerzo de laterales',
      current_date - 3, v_usuario
      from public.tipos_carroceria tc where tc.codigo = 'REPOTENCIACION'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    perform pg_temp.demo_plan_etapas(v_orden, current_date - 30, current_date - 3);
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
       responsable_id)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION', 'URGENTE',
      'Fabricación de furgón cerrado de 6.20 m con puerta lateral',
      current_date + 2, current_date + 25, current_date + 28, v_usuario
      from public.tipos_carroceria tc where tc.codigo = 'FURGON'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    perform pg_temp.demo_plan_etapas(v_orden, current_date + 2, current_date + 25);
    update public.ordenes_trabajo set estado = 'PROGRAMADA' where id = v_orden;

    -- 4) Orden ya entregada, con su acta de conformidad.
    select c.id, u.id into v_cliente, v_unidad
      from public.clientes c join public.unidades u on u.cliente_id = c.id
     where c.numero_documento = '20512345674' and u.placa = 'G9K-284';

    insert into public.ordenes_trabajo
      (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, descripcion,
       fecha_entrega_comprometida, responsable_id)
    select v_cliente, v_unidad, v_sede, tc.id, 'FABRICACION',
      'Fabricación de plataforma con barandas abatibles de 5.00 m',
      current_date - 5, v_usuario
      from public.tipos_carroceria tc where tc.codigo = 'BARANDA'
    returning id into v_orden;

    update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_orden;
    perform pg_temp.demo_plan_etapas(v_orden, current_date - 40, current_date - 5);
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
       responsable_id)
    select v_cliente, v_unidad, v_sede, tc.id, 'REPARACION', 'BAJA',
      'Reparación de estructura y cambio de barandas del remolque',
      v_usuario
      from public.tipos_carroceria tc where tc.codigo = 'BARANDA';
  end if;

  -- ------------------------------------------------------------ avance diario
  -- Lo que se hizo cada día en la unidad. Sin fotos, porque el archivo vive en
  -- Storage y la demostración solo carga base de datos; el texto igual arma el
  -- tablero del taller y la línea de tiempo de la orden.
  -- Desde la migración 20260928130000 una OT con plan de Diseño reporta su
  -- avance en Avance de Taller, con tarea y foto, y `ot_avances` la rechaza:
  -- este diario solo se carga si las órdenes de la demostración son del plan
  -- histórico. La supervisión de cada área es hoy quien reporta.
  select u.id into v_jefe from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and r.codigo = 'SUPERVISOR' order by u.creado_en limit 1;
  v_jefe := coalesce(v_jefe, v_usuario);

  if not exists (select 1 from public.ot_avances)
     and not exists (select 1 from public.ordenes_trabajo where plan_etapas_manual) then

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

  -- ------------------------------------------------ la ficha de taller de la OT
  -- Los accesorios de la cotización recién existen unas líneas más arriba, así
  -- que las órdenes que ya se aprobaron todavía no los tienen. Se arma la ficha
  -- ahora y se deja a medio llenar, que es como se ve una unidad en planta.
  if not exists (select 1 from public.ot_repuestos) then
    for v_orden in
      select id from public.ordenes_trabajo
       where estado not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')
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

-- ------------------------------------------------------------------- SSOMA
-- Tres reportes de seguridad (Plan 15, migración 20261125150100), cada uno con
-- la sesión de quien lo reporta: la función da el número RI y anota quién fue.
-- Sin fotos, porque el archivo vive en Storage. El primero se hizo hace tres
-- días, para que la lista muestre desde cuándo espera.
do $$
declare
  v_quien uuid;
  v_id    uuid;
begin
  if exists (select 1 from public.ssoma_reportes) then
    return;
  end if;

  select u.id into v_quien from public.usuarios u where u.correo = 'supervisor@metalworkperusac.com' and u.activo;
  if v_quien is not null then
    perform set_config('request.jwt.claim.sub', v_quien::text, true);
    v_id := gen_random_uuid();
    perform public.ssoma_reportar(v_id, 'INCIDENTE', (select id from public.areas where codigo = 'PRD'),
      'Nave 2, zona de soldadura',
      'Se soltó la manguera del compresor al cambiar de herramienta y golpeó la mesa de trabajo. No había nadie al lado. Se cerró la llave y se retiró la manguera.',
      now() - interval '3 days 2 hours', null, null, '[]'::jsonb);
    -- Solo en la demostración: la fecha del reporte se corre a mano.
    perform set_config('session_replication_role', 'replica', true);
    update public.ssoma_reportes set creado_en = now() - interval '3 days' where id = v_id;
    perform set_config('session_replication_role', 'origin', true);
  end if;

  select u.id into v_quien from public.usuarios u where u.correo = 'almacen@metalworkperusac.com' and u.activo;
  if v_quien is not null then
    perform set_config('request.jwt.claim.sub', v_quien::text, true);
    perform public.ssoma_reportar(gen_random_uuid(), 'CONDICION_INSEGURA', (select id from public.areas where codigo = 'ALM'),
      'Pasillo de planchas, junto al estante 3',
      'Hay aceite derramado en el piso desde la mañana y las planchas apiladas pasan la altura del estante. Se puso un cono, falta limpiar y reacomodar.',
      now() - interval '1 day 4 hours', null, null, '[]'::jsonb);
  end if;

  select u.id into v_quien from public.usuarios u where u.correo = 'supervisor.maestranza@metalworkperusac.com' and u.activo;
  if v_quien is not null then
    perform set_config('request.jwt.claim.sub', v_quien::text, true);
    perform public.ssoma_reportar(gen_random_uuid(), 'ACCIDENTE', (select id from public.areas where codigo = 'MTZ'),
      'Plegadora hidráulica',
      'Al retirar una plancha recién cortada, la rebaba alcanzó al operario. Tenía guantes de badana, no los de corte. Se le llevó al tópico y se paró la plegadora hasta revisar las planchas.',
      now() - interval '5 hours', true, null, '[]'::jsonb);
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- SSOMA 15.2 (migración 20261126151500): la condición insegura de Almacén ya
-- clasificada, con su causa y dos acciones correctivas a cargo de Almacén, una
-- de ellas vencida, para que la lista las ponga arriba. Las encarga la cuenta
-- de administrador de la demostración: aquí todavía no están las del banco.
do $$
declare
  v_admin uuid;
  v_alm   uuid;
  v_rep   uuid;
  v_acc   uuid := gen_random_uuid();
  v_hoy   date := (now() at time zone 'America/Lima')::date;
begin
  if exists (select 1 from public.ssoma_acciones) then
    return;
  end if;
  select u.id into v_admin from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' and u.activo limit 1;
  select u.id into v_alm from public.usuarios u where u.correo = 'almacen@metalworkperusac.com' and u.activo;
  select id into v_rep from public.ssoma_reportes where tipo = 'CONDICION_INSEGURA' and estado = 'REPORTADO' order by creado_en limit 1;
  if v_admin is null or v_alm is null or v_rep is null then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.ssoma_clasificar(v_rep, 'CONDICION_INSEGURA', null, null,
    'Las planchas se apilan sobre la altura del estante porque falta espacio, y nadie revisa el piso al empezar el turno.');
  perform public.ssoma_crear_accion(gen_random_uuid(), v_rep,
    'Limpiar el aceite del pasillo de planchas y dejar arena absorbente junto al estante 3.', v_alm, v_hoy);
  perform public.ssoma_crear_accion(v_acc, v_rep,
    'Reacomodar las planchas para que no pasen la altura del estante y marcar en el piso el límite de apilado.', v_alm, v_hoy + 5);
  -- Solo en la demostración: la primera acción quedó vencida hace dos días.
  perform set_config('session_replication_role', 'replica', true);
  update public.ssoma_acciones set fecha_limite = v_hoy - 2 where reporte_id = v_rep and id <> v_acc;
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- El padrón de equipos de la planta (Plan 16). Códigos con la forma de la hoja
-- de máquinas del taller y personas inventadas: unos operativos, uno con
-- observación, dos parados y uno dado de baja, para que Mantenimiento, Almacén
-- y Gerencia tengan qué mirar. El código lo pone la base cuando va vacío.
-- -----------------------------------------------------------------------------
do $$
declare
  e record;
begin
  if exists (select 1 from public.equipos) then
    return;
  end if;
  for e in select * from (values
    ('Máquina de soldar',   'MIG 350 trifásica',            'MILLER',    'MK120455Y', 'MK118820W', 'PRD', 'Nave 1, puesto 3',   'JORGE QUISPE',     'OPERATIVO',       null),
    ('Máquina de soldar',   'MIG 350 trifásica',            'MILLER',    'MK120461Y', 'MK118827W', 'PRD', 'Nave 1, puesto 5',   'LUIS TORRES',      'PARADO',          'No arrastra el alambre: el cabezal se traba.'),
    ('Máquina de soldar',   'Inversora de arco 250 A',      'LINCOLN',   'U1190833',  null,        'MTZ', 'Banco de trabajo 2', null,               'OPERATIVO',       null),
    ('Tronzadora de 14"',   'Tronzadora de disco de 14"',   'DEWALT',    null,        null,        'MTZ', 'Zona de corte',      null,               'OPERATIVO',       null),
    ('Tronzadora de 14"',   'Tronzadora de disco de 14"',   'DEWALT',    null,        null,        'MTZ', 'Zona de corte',      null,               'CON_OBSERVACION', 'La guarda del disco está floja.'),
    ('Rectificadora',       'Rectificadora recta',          'BOSCH',     null,        null,        'ACB', 'Cabina de pintura',  'PEDRO CCAMA',      'OPERATIVO',       null),
    ('Amoladora de 4 1/2"', 'Amoladora angular de 4 1/2"',  'BOSCH',     null,        null,        'PRD', 'Nave 1',             'JORGE QUISPE',     'OPERATIVO',       null),
    ('Amoladora de 4 1/2"', 'Amoladora angular de 4 1/2"',  'BOSCH',     null,        null,        'PRD', 'Nave 1',             'LUIS TORRES',      'OPERATIVO',       null),
    ('Amoladora de 4 1/2"', 'Amoladora angular de 4 1/2"',  'DEWALT',    null,        null,        'PRD', 'Nave 2',             'CONTRATISTA RAMOS','PARADO',          'Se quemó el motor.'),
    ('Amoladora de 4 1/2"', 'Amoladora angular de 4 1/2"',  'DEWALT',    null,        null,        'ALM', 'Estante de herramientas', null,          'OPERATIVO',       null),
    ('Amoladora de 7"',     'Amoladora angular de 7"',      'BOSCH',     null,        null,        'PRD', 'Nave 2',             'CONTRATISTA RAMOS','OPERATIVO',       null),
    ('Amoladora de 7"',     'Amoladora angular de 7"',      'MAKITA',    null,        null,        'ACB', 'Zona de masillado',  'PEDRO CCAMA',      'OPERATIVO',       null),
    ('Taladro',             'Taladro percutor de 1/2"',     'BOSCH',     null,        null,        'PRD', 'Nave 1',             null,               'OPERATIVO',       null),
    ('Taladro',             'Taladro atornillador a batería','BOSCH',    null,        null,        'ALM', 'Estante de herramientas', null,          'OPERATIVO',       null),
    ('Equipo de cómputo',   'Laptop de Diseño',             'LENOVO',    'PF3K7Q2M',  null,        'DIS', 'Oficina de Diseño',  'DISEÑO',           'OPERATIVO',       null)
  ) as t(categoria, descripcion, marca, serie, cabezal, area, ubicacion, a_cargo, estado, nota)
  loop
    insert into public.equipos
      (codigo, descripcion, categoria_id, marca, serie_maquina, serie_cabezal, area_id, ubicacion, a_cargo_de, estado, estado_nota)
    values
      ('', e.descripcion,
       (select id from public.equipo_categorias where nombre = e.categoria),
       e.marca, e.serie, e.cabezal,
       (select id from public.areas where codigo = e.area),
       e.ubicacion, e.a_cargo, e.estado, e.nota);
  end loop;

  -- Uno que ya no existe: no se borra, queda dado de baja con su motivo.
  insert into public.equipos (codigo, descripcion, categoria_id, marca, area_id, ubicacion)
  values ('', 'Amoladora angular de 7"',
          (select id from public.equipo_categorias where nombre = 'Amoladora de 7"'),
          'DEWALT', (select id from public.areas where codigo = 'PRD'), 'Nave 2');
  update public.equipos
     set activo = false, baja_motivo = 'Carcasa rota, no tiene arreglo.'
   where codigo = 'AM-07-03';
end;
$$;

-- -----------------------------------------------------------------------------
-- SSOMA 15.3 (migración 20261126985000): el personal de la planta que lista
-- RR. HH., con nombres y DNI inventados, y dos charlas para que la lista y «No
-- asistieron» tengan qué mostrar: una de este mes con seis de las diez
-- personas y una inducción del mes pasado. Se insertan a mano y no con
-- `ssoma_registrar_charla`, que exige fotos ya subidas a Storage: aquí no hay.
-- -----------------------------------------------------------------------------
do $$
declare
  v_quien uuid;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_charla uuid := gen_random_uuid();
  v_induccion uuid := gen_random_uuid();
begin
  if exists (select 1 from public.ssoma_charlas) then
    return;
  end if;
  select u.id into v_quien
    from public.usuarios u join public.roles r on r.id = u.rol_id
   where r.codigo in ('SSOMA', 'ADMIN') and u.activo
   order by r.codigo = 'SSOMA' desc, u.creado_en
   limit 1;
  if v_quien is null then
    return;
  end if;
  perform set_config('request.jwt.claim.sub', v_quien::text, true);

  if not exists (select 1 from public.trabajadores) then
    insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
    select t.nombres, t.apellidos, t.dni, t.cargo, (select id from public.areas where codigo = t.area)
      from (values
        ('JORGE',   'QUISPE MAMANI',   '70000001', 'Soldador',             'PRD'),
        ('LUIS',    'TORRES CHÁVEZ',   '70000002', 'Soldador',             'PRD'),
        ('MARCO',   'HUAMÁN ROJAS',    '70000003', 'Armador',              'PRD'),
        ('PEDRO',   'CCAMA FLORES',    '70000004', 'Pintor',               'ACB'),
        ('RAÚL',    'MENDOZA SALAS',   '70000005', 'Masillador',           'ACB'),
        ('ÓSCAR',   'NÚÑEZ PAREDES',   '70000006', 'Operario de plegadora','MTZ'),
        ('CARLOS',  'VARGAS LEÓN',     '70000007', 'Cortador',             'MTZ'),
        ('ANA',     'RAMOS QUISPE',    '70000008', 'Auxiliar de almacén',  'ALM'),
        ('WILMER',  'CHOQUE APAZA',    '70000009', 'Electricista',         'MNT'),
        ('JULIO',   'PARI CONDORI',    '70000010', 'Ayudante',             'PRD')
      ) as t(nombres, apellidos, dni, cargo, area);
    -- Alguien que se fue hace veinte días: en la lista para marcar va aparte, y
    -- cuenta en «No asistieron» del mes en que estuvo.
    insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo, fecha_ingreso, fecha_baja)
    values ('ELSA', 'ROJAS VERA', '70000011', 'Ayudante', (select id from public.areas where codigo = 'PRD'),
            false, v_hoy - 400, v_hoy - 20);
  end if;

  insert into public.ssoma_charlas (id, tipo, tema, expositor, fecha, creado_por)
  values (v_charla, 'CHARLA', 'Uso correcto de la amoladora y sus guardas', 'Supervisión de SSOMA',
          greatest(date_trunc('month', v_hoy)::date, v_hoy - 3), v_quien),
         (v_induccion, 'INDUCCION', 'Inducción de seguridad para personal nuevo', 'Supervisión de SSOMA',
          (date_trunc('month', v_hoy) - interval '10 days')::date, v_quien);
  insert into public.ssoma_charla_asistentes (charla_id, trabajador_id)
  select v_charla, t.id from public.trabajadores t where t.activo and t.dni in
    ('70000001', '70000002', '70000003', '70000004', '70000006', '70000008');
  insert into public.ssoma_charla_asistentes (charla_id, trabajador_id)
  select v_induccion, t.id from public.trabajadores t where t.activo and t.dni in ('70000009', '70000010');

  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- SSOMA 15.4 (migración 20261126997500): dos puntos propios de un área y dos
-- inspecciones, para que la lista, «Por área» y la ficha tengan qué mostrar:
-- una de Producción con dos hallazgos (una acción vencida y otra en plazo) y
-- una de Almacén con todo conforme. Maestranza queda sin inspeccionar. Con la
-- cuenta de administrador de la demostración: las del banco todavía no están.
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin uuid;
  v_alm   uuid;
  v_prd   uuid := (select id from public.areas where codigo = 'PRD');
  v_almac uuid := (select id from public.areas where codigo = 'ALM');
  v_mtz   uuid := (select id from public.areas where codigo = 'MTZ');
  v_ins   uuid := gen_random_uuid();
  v_hoy   date := (now() at time zone 'America/Lima')::date;
begin
  if exists (select 1 from public.ssoma_inspecciones) then
    return;
  end if;
  select u.id into v_admin from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' and u.activo limit 1;
  select u.id into v_alm from public.usuarios u where u.correo = 'almacen@metalworkperusac.com' and u.activo;
  if v_admin is null or v_alm is null or v_prd is null or v_almac is null or v_mtz is null then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.ssoma_agregar_punto(gen_random_uuid(), v_prd, 'Máquinas de soldar con su cable de tierra y su pinza en buen estado');
  perform public.ssoma_agregar_punto(gen_random_uuid(), v_mtz, 'Plegadora y guillotina con su parada de emergencia probada');

  perform public.ssoma_registrar_inspeccion(v_ins, v_prd, v_hoy - 6, 'PLANEADA', 'Recorrido con el supervisor del turno.',
    (select jsonb_agg(
       case p.id
         when '5a150001-0000-4000-8000-000000000001' then jsonb_build_object('punto', p.id, 'resultado', 'NO_CONFORME',
           'hallazgo', 'Dos soldadores trabajando sin lentes en la nave 1.',
           'accion', jsonb_build_object('que', 'Entregar lentes a los soldadores de la nave 1 y recordar su uso antes de empezar el turno.',
                                        'responsable', v_alm, 'fecha_limite', v_hoy))
         when '5a150001-0000-4000-8000-000000000004' then jsonb_build_object('punto', p.id, 'resultado', 'NO_CONFORME',
           'hallazgo', 'El extintor de la columna 4 está tapado por parihuelas y con la carga vencida.',
           'accion', jsonb_build_object('que', 'Despejar el acceso al extintor de la columna 4 y mandarlo a recargar.',
                                        'responsable', v_alm, 'fecha_limite', v_hoy + 4))
         when '5a150001-0000-4000-8000-000000000009' then jsonb_build_object('punto', p.id, 'resultado', 'NO_APLICA')
         else jsonb_build_object('punto', p.id, 'resultado', 'CONFORME')
       end)
       from public.ssoma_lista_puntos p where p.activo and (p.area_id is null or p.area_id = v_prd)));
  perform public.ssoma_registrar_inspeccion(gen_random_uuid(), v_almac, v_hoy - 20, 'NO_PLANEADA', null,
    (select jsonb_agg(jsonb_build_object('punto', p.id, 'resultado', 'CONFORME'))
       from public.ssoma_lista_puntos p where p.activo and (p.area_id is null or p.area_id = v_almac)));

  -- Solo en la demostración: la primera acción quedó vencida hace dos días.
  perform set_config('session_replication_role', 'replica', true);
  update public.ssoma_acciones a set fecha_limite = v_hoy - 2
    from public.ssoma_inspeccion_respuestas r
   where r.id = a.respuesta_id and r.inspeccion_id = v_ins and r.punto_id = '5a150001-0000-4000-8000-000000000001';
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- SSOMA 15.5 (migración 20261126999100): salidas del almacén de EPP y a quién
-- le tocó cada equipo, para que «Por renovar», «Por persona», «Salidas de
-- Almacén» y la hoja de una persona tengan qué mostrar: cascos vencidos y uno
-- ya renovado, guantes por vencer, lentes a medio repartir, respiradores sin
-- repartir y unas lunas que no van por persona. Las salidas se insertan a mano
-- y no con `registrar_salida_material`, que exige una foto ya subida a Storage.
-- Con la cuenta de administrador de la demostración: las del banco todavía no están.
-- -----------------------------------------------------------------------------
do $$
declare
  v_admin  uuid;
  v_alm    uuid;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_casco  uuid := (select id from public.materiales where codigo = 'EP-PC-CA-PO-00021');
  v_guante uuid := (select id from public.materiales where codigo = 'EP-PM-GU-CU-00002');
  v_lente  uuid := (select id from public.materiales where codigo = 'EP-PV-LE-PO-00023');
  v_resp   uuid := (select id from public.materiales where codigo = 'EP-PR-RE-FS-00027');
  v_luna   uuid := (select id from public.materiales where codigo = 'EP-PF-LU-VI-00035');
  v_s1 uuid := gen_random_uuid();
  v_s2 uuid := gen_random_uuid();
  v_s3 uuid := gen_random_uuid();
  v_s4 uuid := gen_random_uuid();
  v_s5 uuid := gen_random_uuid();
  v_s6 uuid := gen_random_uuid();
  v_e4 uuid := gen_random_uuid();
begin
  if exists (select 1 from public.ssoma_epp_entregas) then
    return;
  end if;
  select u.id into v_admin from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' and u.activo limit 1;
  select u.id into v_alm from public.usuarios u where u.correo = 'almacen@metalworkperusac.com' and u.activo;
  if v_admin is null or v_alm is null or v_casco is null or v_guante is null or v_lente is null or v_resp is null or v_luna is null
     or (select count(*) from public.trabajadores where dni between '70000001' and '70000011') < 11 then
    return;
  end if;

  -- Lo que Almacén tenía y lo que entregó. Los números de salida los da la base.
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, registrado_por, registrado_en)
  select gen_random_uuid(), 'INGRESO', 'INGRESO_GENERAL', m, 60, 'Ingreso de la demostración', v_alm, now() - interval '420 days'
    from unnest(array[v_casco, v_guante, v_lente, v_resp, v_luna]) as m;
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por, registrado_en)
  values (v_s1, 'SALIDA', 'SALIDA_GENERAL', v_casco,  3,  'Vale de EPP 0101', 'Jorge Quispe',  'PLANTA', v_alm, now() - interval '400 days'),
         (v_s3, 'SALIDA', 'SALIDA_GENERAL', v_guante, 5,  'Vale de EPP 0188', 'Luis Torres',   'PLANTA', v_alm, now() - interval '80 days'),
         (v_s2, 'SALIDA', 'SALIDA_GENERAL', v_casco,  1,  'Vale de EPP 0240', 'Jorge Quispe',  'PLANTA', v_alm, now() - interval '5 days'),
         (v_s6, 'SALIDA', 'SALIDA_GENERAL', v_luna,   10, 'Vale de EPP 0241', 'Luis Torres',   'PLANTA', v_alm, now() - interval '3 days'),
         (v_s4, 'SALIDA', 'SALIDA_GENERAL', v_lente,  6,  'Vale de EPP 0242', 'Pedro Ccama',   'PLANTA', v_alm, now() - interval '2 days'),
         (v_s5, 'SALIDA', 'SALIDA_GENERAL', v_resp,   2,  'Vale de EPP 0243', 'Raúl Mendoza',  'PLANTA', v_alm, now() - interval '3 hours');
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, devolucion_de, registrado_por, registrado_en)
  values (gen_random_uuid(), 'INGRESO', 'DEVOLUCION', v_lente, 1, 'Devolución: un lente rayado', v_s4, v_alm, now() - interval '1 day');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  -- Cascos de hace más de un año, por un año: vencidos. A Jorge ya se le dio otro.
  perform public.ssoma_registrar_entregas_epp(gen_random_uuid(), v_s1, ((now() - interval '400 days') at time zone 'America/Lima')::date + 365,
    (select jsonb_agg(jsonb_build_object('trabajador', id, 'cantidad', 1)) from public.trabajadores where dni in ('70000001', '70000002', '70000003')));
  perform public.ssoma_registrar_entregas_epp(gen_random_uuid(), v_s2, v_hoy - 5 + 365,
    (select jsonb_agg(jsonb_build_object('trabajador', id, 'cantidad', 1)) from public.trabajadores where dni = '70000001'));
  -- Guantes de hace 80 días, por 90: vencen en 10. Elsa ya dejó la planta; Óscar pasó a otra máquina.
  perform public.ssoma_registrar_entregas_epp(gen_random_uuid(), v_s3, v_hoy - 80 + 90,
    (select jsonb_agg(jsonb_build_object('trabajador', id, 'cantidad', 1)) from public.trabajadores
      where dni in ('70000001', '70000002', '70000010', '70000011', '70000006')));
  perform public.ssoma_epp_no_se_renueva(
    (select e.id from public.ssoma_epp_entregas e join public.trabajadores t on t.id = e.trabajador_id where e.movimiento_id = v_s3 and t.dni = '70000006'),
    'Pasó a la plegadora y ya no suelda.');
  -- Lentes de anteayer: dos repartidos y uno anotado a quien no era; quedan tres por asignar.
  perform public.ssoma_registrar_entregas_epp(v_e4, v_s4, v_hoy - 2 + 180,
    (select jsonb_agg(jsonb_build_object('trabajador', id, 'cantidad', 1)) from public.trabajadores where dni in ('70000004', '70000005', '70000008')));
  perform public.ssoma_anular_entrega_epp(
    (select e.id from public.ssoma_epp_entregas e join public.trabajadores t on t.id = e.trabajador_id where e.envio_id = v_e4 and t.dni = '70000008'),
    'Se anotó a Ana por error: esos lentes siguen en la caseta.');
  -- Las lunas son del área, no de una persona.
  perform public.ssoma_epp_salida_sin_reparto(v_s6, 'Lunas de repuesto del área de soldadura.');
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- ------------------------------------------------- compras y almacén
-- Un circuito de requerimientos para que Atención, Por comprar, las órdenes de
-- compra y de servicio, Aprobación, Gestión de compras, Recojos, el kardex,
-- Reposición, Control de compras, Proveedores y Subcontratos salgan llenos, con
-- dos o tres documentos en cada estado: RQ por revisar, por comprar, en compra,
-- listos, entregados (uno con faltante) y anulados; OC por aprobar, rechazadas,
-- anuladas, por recoger, en recojo, recogidas y dejadas en almacén (por
-- validar, recibidas en parte y enteras); OS por aprobar, rechazadas,
-- aprobadas, en ejecución, conformes y anuladas; subcontratos vigentes,
-- terminados y anulados. Todo con las funciones reales y la sesión del puesto
-- que da cada paso, así que cada número sale de su serie y cada regla se cumple.
-- Lo que va a Contabilidad y Tesorería (la factura registrada, el pago) es de la
-- sección de plata y personal.
-- Los números salen de las series reales y un documento numerado no se borra
-- nunca: esta sección corre solo donde se pide a propósito, con
-- `PGOPTIONS='-c demo.base_de_prueba=si'` (lo pone `herramientas/banco/preparar.sh`).
-- Centinela: los requerimientos, que solo llena esta sección.
create or replace function pg_temp.demo_como(p_usuario uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
end;
$f$;

-- La ficha del puesto que da cada paso: la de la demostración
-- (@metalworkperusac.com) antes que cualquier otra del mismo puesto.
create or replace function pg_temp.demo_puesto(p_rol text, p_area text) returns uuid language sql as $f$
  select u.id from public.usuarios u
    join public.roles r on r.id = u.rol_id
    left join public.areas a on a.id = u.area_id
   where u.activo and r.codigo = p_rol and a.codigo is not distinct from p_area
   order by (u.correo like '%@metalworkperusac.com') desc, u.creado_en
   limit 1;
$f$;

-- Un RUC inventado que pasa el dígito verificador. Los de empresa llevan el
-- prefijo 2099, que la SUNAT no ha llegado a asignar; el de persona natural
-- lleva dentro el DNI 99999990, que el RENIEC tampoco (va por los 80 millones).
-- Así no se escribe el número de nadie.
create or replace function pg_temp.demo_ruc(p_base text) returns text language plpgsql as $f$
declare d int;
begin
  for d in 0..9 loop
    if public.ruc_es_valido(p_base || d) then return p_base || d; end if;
  end loop;
  raise exception 'No hay dígito verificador para %', p_base;
end;
$f$;

-- El material del catálogo por su código.
create or replace function pg_temp.demo_mat(p_codigo text) returns uuid language sql as $f$
  select id from public.materiales where codigo = p_codigo;
$f$;

-- Una línea de RQ con un material del catálogo.
create or replace function pg_temp.demo_linea(p_codigo text, p_cantidad numeric) returns jsonb language sql as $f$
  select jsonb_build_object('material_id', pg_temp.demo_mat(p_codigo), 'cantidad', p_cantidad);
$f$;

-- Una línea de RQ de Administración con algo que no está en el catálogo.
create or replace function pg_temp.demo_linea_nueva(p_nombre text, p_cantidad numeric) returns jsonb language sql as $f$
  select jsonb_build_object('descripcion', p_nombre, 'cantidad', p_cantidad,
    'unidad_medida_id', (select id from public.unidades_medida where codigo = 'UND'),
    'categoria_id', (select id from public.categorias_material where codigo = 'ALM_CONSUMIBLES_E_INSUMOS'));
$f$;

-- La salida del kardex de lo pendiente de un RQ, como Almacén, con su foto.
-- La foto es una fila de Storage: el banco local le pone la imagen de muestra
-- (`herramientas/banco/preparar.sh`); fuera del banco no se ve.
create or replace function pg_temp.demo_sacar(p_rq uuid, p_alm uuid, p_recibe text, p_hasta numeric default null)
returns void language plpgsql as $f$
declare
  l record;
  v_id uuid;
  v_cant numeric;
begin
  for l in
    select x.linea_id, x.pendiente, coalesce(x.material_comprado, d.material_id, x.material_id) as material
      from public.v_rq_lineas_para_salida x
      join public.requerimiento_lineas rl on rl.id = x.linea_id
      left join public.orden_compra_material_detalles d on d.id = rl.orden_compra_detalle_id
     where x.requerimiento_id = p_rq and x.pendiente > 0
     order by rl.item
  loop
    v_cant := least(l.pendiente, coalesce(p_hasta, l.pendiente));
    v_id := gen_random_uuid();
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', p_alm || '/' || v_id || '.jpg', p_alm::text,
            '{"mimetype": "image/jpeg", "size": 2048}');
    perform pg_temp.demo_como(p_alm);
    perform public.registrar_salida_material(v_id, l.material, v_cant, null, null,
      'Entrega del requerimiento', p_recibe, p_alm || '/' || v_id || '.jpg', l.linea_id);
  end loop;
end;
$f$;

-- La factura de una compra, como la anexa Logística: el PDF en Storage (el
-- banco le pone el de muestra) y su fila con el número y la fecha. Va a mano
-- porque la pantalla sube el archivo antes de anotarlo y desde SQL no hay
-- archivo que subir; los disparadores de la tabla revisan lo mismo.
create or replace function pg_temp.demo_factura(p_compra uuid, p_log uuid, p_numero text) returns void language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.demo_como(p_log);
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('documentos-compras', 'compra/' || p_compra || '/' || v_id || '.pdf', p_log::text,
          '{"mimetype": "application/pdf", "size": 4096}');
  insert into public.documentos_compra_material
    (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por,
     numero_documento, fecha_emision)
  values (v_id, p_compra, 'FACTURA', p_numero || '.pdf', 'compra/' || p_compra || '/' || v_id || '.pdf',
          'application/pdf', 4096, p_log, p_numero, current_date);
end;
$f$;

do $$
declare
  v_ger     uuid;
  v_log     uuid;
  v_alm     uuid;
  v_adm     uuid;
  v_cond    uuid;
  v_sup_prd uuid;
  v_sup_mtz uuid;
  v_prd     uuid := (select id from public.areas where codigo = 'PRD');
  v_mtz     uuid := (select id from public.areas where codigo = 'MTZ');
  v_area_adm uuid := (select id from public.areas where codigo = 'ADM');
  v_ot1     uuid;
  v_ot3     uuid;
  v_cod1    text;
  v_cod3    text;
  v_aceros  uuid;
  v_ferre   uuid;
  v_pintu   uuid;
  v_hidra   uuid;
  v_arenado uuid;
  v_torno   uuid;
  v_sub     uuid;
  v_sub2    uuid;
  -- Los RQ en el orden en que se emiten, que es el de su número y su fecha.
  v_rq      uuid[] := array(select gen_random_uuid() from generate_series(1, 11));
  v_rqa     uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  -- Los dos que su supervisor anula.
  v_rqn     uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  v_pint    uuid;
  v_plan    uuid;
  v_disc    uuid;
  v_mig     uuid;
  v_guan    uuid;
  -- Las directas que siguen el resto de los pasos de la compra.
  v_esm     uuid;
  v_hard    uuid;
  v_desb    uuid;
  v_per     uuid;
  v_thi     uuid;
  v_ele     uuid;
  v_pl4     uuid;
  v_base    uuid;
  v_rech    uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  v_anu     uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  -- Las doce OS en el orden en que se emiten.
  v_os      uuid[] := array(select gen_random_uuid() from generate_series(1, 12));
  v_sc      uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_id      uuid;
begin
  if exists (select 1 from public.requerimientos) then
    return;
  end if;
  v_ger     := pg_temp.demo_puesto('GERENTE', 'GGE');
  v_log     := pg_temp.demo_puesto('COMPRADOR', 'LOG');
  v_alm     := pg_temp.demo_puesto('ALMACENERO', 'ALM');
  v_adm     := pg_temp.demo_puesto('ADMINISTRACION', 'ADM');
  v_cond    := pg_temp.demo_puesto('CONDUCTOR', 'LOG');
  v_sup_prd := pg_temp.demo_puesto('SUPERVISOR', 'PRD');
  v_sup_mtz := pg_temp.demo_puesto('SUPERVISOR', 'MTZ');
  if v_log is null or v_alm is null or v_cond is null or v_sup_prd is null or v_sup_mtz is null
     or v_adm is null or v_ger is null then
    raise notice 'Compras y almacén: faltan las fichas del personal de la demostración; no se cargan.';
    return;
  end if;
  -- Si una compra necesita el visto de Gerencia lo decide un disparador
  -- diferido, que sin esto correría recién al terminar la carga: la compra ya
  -- recibida quedaba «no requerida» sin que Gerencia la viera. Aquí se decide
  -- en cada paso, como cuando Logística la emite desde su pantalla.
  set constraints all immediate;

  -- El código interno de cada unidad que tiene OT: es la llave con la que el
  -- RQ, la compra y la salida le cargan el costo. En la empresa se lo da
  -- Administración al cargar la OT desde la cotización aprobada; las OT de la
  -- demostración nacen sin cotización, así que se escribe aquí. Va en las cuatro
  -- unidades con OT, aunque esta sección cargue documentos solo a dos: así
  -- ninguna OT de la demostración queda sin la llave del costo.
  update public.unidades u
     set codigo_interno = v.codigo
    from (values ('V2G-841', 'VOL_TA_O4_1_26/18'), ('C4L-118', 'VOL_MC_O4_2_26/15'),
                 ('F3P-772', 'FUR_CS_N3_3_26/12'), ('G9K-284', 'FUR_AJ_N3_4_26/08')) as v(placa, codigo)
   where u.placa = v.placa and u.codigo_interno is null;
  select o.id, u.codigo_interno into v_ot1, v_cod1
    from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where u.placa = 'V2G-841';
  select o.id, u.codigo_interno into v_ot3, v_cod3
    from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where u.placa = 'F3P-772';

  -- ------------------------------------------------------- proveedores
  -- Logística los da de alta; razón social en mayúsculas, como en la empresa.
  -- Teléfonos de la serie 000 y correos .example: no son de nadie.
  perform pg_temp.demo_como(v_log);
  insert into public.proveedores
    (numero_documento, razon_social, nombre_comercial, rubro, contacto, telefono, correo, direccion,
     condicion_pago, dias_credito, creado_por)
  values
    (pg_temp.demo_ruc('2099100001'), 'ACEROS DEL PACÍFICO S.A.C.', 'Aceros del Pacífico', 'Planchas, tubos y perfiles',
     'Julio Cárdenas', '(01) 000-0101', 'ventas@acerosdelpacifico.example', 'Av. Argentina 2450, Cercado de Lima', 'CREDITO', 30, v_log),
    (pg_temp.demo_ruc('2099100002'), 'FERRETERÍA INDUSTRIAL SAN JORGE E.I.R.L.', 'Ferretería San Jorge', 'Pernos, discos y consumibles',
     'Milagros Paz', '(01) 000-0102', 'pedidos@sanjorge.example', 'Jr. Paruro 1180, Cercado de Lima', 'CONTADO', 0, v_log),
    (pg_temp.demo_ruc('2099100003'), 'PINTURAS Y RECUBRIMIENTOS DEL NORTE S.A.', 'Recubrimientos del Norte', 'Pinturas y solventes',
     'Óscar Lazo', '(01) 000-0103', 'comercial@recunorte.example', 'Av. Industrial 655, Independencia', 'CREDITO', 15, v_log),
    (pg_temp.demo_ruc('2099100004'), 'HIDRÁULICA ANDINA S.A.C.', 'Hidráulica Andina', 'Pistones, bombas y mangueras',
     'Renzo Villar', '(01) 000-0104', 'ventas@hidraulicaandina.example', 'Av. Los Ingenieros 310, Ate', 'CREDITO', 30, v_log),
    (pg_temp.demo_ruc('2099100005'), 'ARENADOS Y PINTURA INDUSTRIAL CHAVÍN S.A.C.', 'Arenados Chavín', 'Servicio de arenado y pintado',
     'Edwin Rojas', '(01) 000-0105', 'servicios@arenadoschavin.example', 'Calle Los Hornos 220, Lurín', 'CONTADO', 0, v_log),
    (pg_temp.demo_ruc('2099100006'), 'MAESTRANZA Y TORNO SANTA ROSA S.A.C.', 'Torno Santa Rosa', 'Torno, fresado, doblado y corte',
     'Wilmer Cáceres', '(01) 000-0107', 'taller@tornosantarosa.example', 'Av. Separadora Industrial 1820, Ate', 'CREDITO', 15, v_log)
  on conflict do nothing;
  select id into v_aceros  from public.proveedores where razon_social = 'ACEROS DEL PACÍFICO S.A.C.';
  select id into v_ferre   from public.proveedores where razon_social = 'FERRETERÍA INDUSTRIAL SAN JORGE E.I.R.L.';
  select id into v_pintu   from public.proveedores where razon_social = 'PINTURAS Y RECUBRIMIENTOS DEL NORTE S.A.';
  select id into v_hidra   from public.proveedores where razon_social = 'HIDRÁULICA ANDINA S.A.C.';
  select id into v_arenado from public.proveedores where razon_social = 'ARENADOS Y PINTURA INDUSTRIAL CHAVÍN S.A.C.';
  select id into v_torno   from public.proveedores where razon_social = 'MAESTRANZA Y TORNO SANTA ROSA S.A.C.';

  -- ------------------------------------------- lo que Almacén ya tenía
  -- El saldo con que arranca el kardex, un ingreso general por material, y el
  -- stock mínimo que dispara Reposición.
  perform pg_temp.demo_como(v_alm);
  perform public.registrar_ingreso_almacen(gen_random_uuid(), pg_temp.demo_mat(v.codigo), v.cantidad,
            'INGRESO_GENERAL', 'Inventario inicial', v.precio, 'PEN')
     from (values ('ELE-7018', 40, 18.50), ('DIS-CORTE', 60, 6.80), ('DIS-DESB', 35, 9.20),
                  ('PER-58', 12, 3.10), ('PL-A36-4', 480, 4.60)) as v(codigo, cantidad, precio);
  perform public.fijar_stock_minimo(pg_temp.demo_mat(v.codigo), v.minimo)
     from (values ('ELE-7018', 50), ('DIS-DESB', 40), ('DIS-CORTE', 50), ('PL-A36-6', 300),
                  ('ALA-MIG', 20), ('PER-58', 30)) as v(codigo, minimo);

  -- ------------------------------------------------- los requerimientos
  -- Trece RQ de las supervisiones y dos de Administración, emitidos del más
  -- antiguo al más nuevo. Lo que pasa con cada uno (los anulados no cuentan en
  -- esta lista: van después del 4 y del 9):
  --   1, 4    entregados (la pintura se compró; el electrodo había)
  --   3       entregado con faltante: de veinte pernos había doce
  --   2, 5    en compra: la OC del pistón espera a Gerencia; la de planchas,
  --           al conductor
  --   6, 7    por comprar, y el RQA 1
  --   8, 9    listos en almacén
  --   10, 11  por revisar, y el RQA 2
  --   los dos anulados por su supervisor: uno se pidió dos veces, el otro lo
  --           trae el cliente
  perform pg_temp.demo_como(v_sup_prd);
  perform public.emitir_requerimiento(v_rq[1], 'OPERACION', v_prd, v_cod1,
    'Base anticorrosiva y thinner para el fondeado de la tolva', null,
    jsonb_build_array(pg_temp.demo_linea('PIN-BASE', 8), pg_temp.demo_linea('THI-ACR', 6)));
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.emitir_requerimiento(v_rq[2], 'OPERACION', v_mtz, v_cod3,
    'Sistema de volteo del furgón: pistón y bomba', null,
    jsonb_build_array(pg_temp.demo_linea('PIS-HID-5', 1), pg_temp.demo_linea('BOM-HID', 1)));
  perform public.emitir_requerimiento(v_rq[3], 'OPERACION', v_mtz, v_cod3,
    'Pernos para el anclaje de la estructura del furgón al chasis', null,
    jsonb_build_array(pg_temp.demo_linea('PER-58', 20)));
  perform pg_temp.demo_como(v_sup_prd);
  perform public.emitir_requerimiento(v_rq[4], 'OPERACION', v_prd, v_cod3,
    'Electrodo para el armado de los parantes del furgón', null,
    jsonb_build_array(pg_temp.demo_linea('ELE-7018', 10)));
  perform public.emitir_requerimiento(v_rqn[1], 'OPERACION', v_prd, v_cod3,
    'Esmalte para el acabado de las puertas del furgón', null,
    jsonb_build_array(pg_temp.demo_linea('PIN-ESM', 4)));
  perform public.anular_requerimiento(v_rqn[1],
    'Se pidió dos veces: el esmalte de las puertas va con el del acabado del furgón');
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.emitir_requerimiento(v_rq[5], 'OPERACION', v_mtz, v_cod1,
    'Planchas de 6 mm para el piso de la tolva', null,
    jsonb_build_array(pg_temp.demo_linea('PL-A36-6', 180)));
  perform public.emitir_requerimiento(v_rq[6], 'OPERACION', v_mtz, v_cod3,
    'Mangueras del volteo y faros de posición del furgón', null,
    jsonb_build_array(pg_temp.demo_linea('MAN-HID', 12), pg_temp.demo_linea('LUZ-LED', 6)));
  perform pg_temp.demo_como(v_adm);
  perform public.emitir_requerimiento(v_rqa[1], 'ADMINISTRACION', v_area_adm, 'PLANTA',
    'Tóner para la impresora de las órdenes de trabajo', null,
    jsonb_build_array(pg_temp.demo_linea_nueva('Tóner para impresora láser de oficina', 2)));
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.emitir_requerimiento(v_rq[7], 'OPERACION', v_mtz, v_cod1,
    'Bastidor del chasis: tubos y ángulos para las vigas transversales', null,
    jsonb_build_array(pg_temp.demo_linea('TUB-100x50', 36), pg_temp.demo_linea('ANG-2X2', 24)));
  perform pg_temp.demo_como(v_sup_prd);
  perform public.emitir_requerimiento(v_rq[8], 'OPERACION', v_prd, v_cod1,
    'Discos para el esmerilado de los cordones del piso', null,
    jsonb_build_array(pg_temp.demo_linea('DIS-DESB', 12)));
  perform public.emitir_requerimiento(v_rq[9], 'OPERACION', v_prd, v_cod3,
    'Discos para el corte de los perfiles del techo del furgón', null,
    jsonb_build_array(pg_temp.demo_linea('DIS-CORTE', 8)));
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.emitir_requerimiento(v_rqn[2], 'OPERACION', v_mtz, v_cod1,
    'Plancha antidesgaste para el piso de la tolva', null,
    jsonb_build_array(pg_temp.demo_linea('PL-HRD-8', 6)));
  perform pg_temp.demo_como(v_alm);
  perform public.rq_marcar_sin_stock(v_rqn[2], 'No se tiene Hardox de 8 mm');
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.anular_requerimiento(v_rqn[2],
    'El cliente trae su propia plancha antidesgaste para el piso de la tolva');
  perform pg_temp.demo_como(v_adm);
  perform public.emitir_requerimiento(v_rqa[2], 'ADMINISTRACION', v_area_adm, 'PLANTA',
    'Útiles para el archivo de las órdenes de trabajo del año', null,
    jsonb_build_array(pg_temp.demo_linea_nueva('Archivador de palanca lomo ancho', 12)));
  perform pg_temp.demo_como(v_sup_prd);
  perform public.emitir_requerimiento(v_rq[10], 'OPERACION', v_prd, v_cod1,
    'Soldadura del tolvín y del faldón trasero de la tolva', null,
    jsonb_build_array(pg_temp.demo_linea('ELE-7018', 15), pg_temp.demo_linea('DIS-CORTE', 10)));
  perform pg_temp.demo_como(v_sup_mtz);
  perform public.emitir_requerimiento(v_rq[11], 'OPERACION', v_mtz, v_cod3,
    'Arnés eléctrico para la instalación de luces del furgón', null,
    jsonb_build_array(pg_temp.demo_linea('ARN-ELE', 1)));

  -- Almacén revisa el stock de los que no están por revisar.
  perform pg_temp.demo_como(v_alm);
  perform public.rq_marcar_sin_stock(v_rq[1], 'No queda base epóxica ni thinner');
  perform public.rq_marcar_sin_stock(v_rq[2], 'El pistón y la bomba no se tienen en stock');
  perform public.rq_marcar_listo_en_almacen(v_rq[3], 'Hay doce pernos; el resto se pide');
  perform public.rq_marcar_listo_en_almacen(v_rq[4], 'En el estante A, con la soldadura');
  perform public.rq_marcar_sin_stock(v_rq[5], 'No hay plancha de 6 mm');
  perform public.rq_marcar_sin_stock(v_rq[6], 'No hay manguera de 1/2" ni faros LED');
  perform public.rq_marcar_sin_stock(v_rqa[1], 'No se guarda tóner en el almacén');
  perform public.rq_marcar_sin_stock(v_rq[7], 'No hay tubo de 100 x 50 ni ángulo de 2"');
  perform public.rq_marcar_listo_en_almacen(v_rq[8], 'En el estante C, junto a los discos de corte');
  perform public.rq_marcar_listo_en_almacen(v_rq[9], 'En el estante C');

  -- ------------------------------------------------ órdenes de compra
  -- Toda OC de Logística pasa por el visto de Gerencia y, aprobada, sale sola a
  -- la lista del conductor (`fn_compra_recojo`): él la recoge, la deja en
  -- almacén y Almacén valida lo que llegó. Se emiten en el orden de su fecha,
  -- cada una con la fecha que prometió el proveedor (tres ya vencidas, para que
  -- Control de compras muestre atrasos).
  perform pg_temp.demo_como(v_log);
  -- RQ 1: llega entera y sale al área.
  v_pint := public.emitir_compra_del_requerimiento(gen_random_uuid(), v_rq[1], null, v_pintu, 'PROF-2207',
    jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PIN-BASE'), 'cantidad', 8, 'precio', 96),
      jsonb_build_object('material_id', pg_temp.demo_mat('THI-ACR'), 'cantidad', 6, 'precio', 38)),
    current_date, 'CREDITO', 15, 'PEN', true);
  -- RQ 2: espera la aprobación de Gerencia.
  perform public.emitir_compra_del_requerimiento(gen_random_uuid(), v_rq[2], null, v_hidra, 'COT-HA-0412',
    jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PIS-HID-5'), 'cantidad', 1, 'precio', 6850),
      jsonb_build_object('material_id', pg_temp.demo_mat('BOM-HID'), 'cantidad', 1, 'precio', 2380)),
    current_date + 10, 'CREDITO', 30, 'PEN', true);
  -- Las directas, sin RQ, para el stock de planta.
  v_desb := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-104',
    'Reposición del stock mínimo de discos de desbaste', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('DIS-DESB'), 'cantidad', 50, 'precio', 8.90)),
    current_date - 2, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  v_pl4 := public.emitir_compra_directa(gen_random_uuid(), v_aceros, 'COT-AP-2281',
    'Planchas de 4 mm para el stock de forros', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PL-A36-4'), 'cantidad', 200, 'precio', 4.55)),
    current_date - 1, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  v_hard := public.emitir_compra_directa(gen_random_uuid(), v_aceros, 'COT-AP-2285',
    'Plancha antidesgaste para los pisos de las tolvas del mes', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PL-HRD-8'), 'cantidad', 12, 'precio', 610)),
    current_date, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  -- RQ 5: aprobada, en la lista del conductor y con la fecha ya vencida.
  v_plan := public.emitir_compra_del_requerimiento(gen_random_uuid(), v_rq[5], null, v_aceros, 'COT-AP-2290',
    jsonb_build_array(jsonb_build_object('material_id', pg_temp.demo_mat('PL-A36-6'), 'cantidad', 180, 'precio', 4.75)),
    current_date - 1, 'CREDITO', 30, 'PEN', true);
  v_ele := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-109',
    'Reposición del stock mínimo de electrodo 7018', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('ELE-7018'), 'cantidad', 40, 'precio', 18.20)),
    current_date, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  v_anu[1] := public.emitir_compra_directa(v_anu[1], v_aceros, 'COT-AP-2287',
    'Tubos para el stock de bastidores', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('TUB-100x50'), 'cantidad', 30, 'precio', 92)),
    current_date + 3, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  -- Discos: de cien llegaron sesenta.
  v_disc := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-118',
    'Reposición del stock mínimo de discos de corte', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('DIS-CORTE'), 'cantidad', 100, 'precio', 6.50)),
    current_date - 1, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  v_per := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-121',
    'Reposición del stock mínimo de pernos de 5/8"', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PER-58'), 'cantidad', 60, 'precio', 3.05)),
    current_date, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  v_anu[2] := public.emitir_compra_directa(v_anu[2], v_hidra, 'COT-HA-0418',
    'Mangueras hidráulicas de repuesto para los volteos', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('MAN-HID'), 'cantidad', 20, 'precio', 48)),
    current_date + 4, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  v_esm := public.emitir_compra_directa(gen_random_uuid(), v_pintu, 'PROF-2231',
    'Esmalte de acabado para el stock de pintura', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PIN-ESM'), 'cantidad', 12, 'precio', 118)),
    current_date + 2, 'CREDITO', 15, 'PEN', true, 'PLANTA');
  v_thi := public.emitir_compra_directa(gen_random_uuid(), v_pintu, 'PROF-2234',
    'Thinner para la limpieza de las pistolas de pintura', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('THI-ACR'), 'cantidad', 20, 'precio', 36)),
    current_date + 1, 'CREDITO', 15, 'PEN', true, 'PLANTA');
  v_rech[1] := public.emitir_compra_directa(v_rech[1], v_aceros, 'COT-AP-2296',
    'Plancha antidesgaste de reserva para el próximo trimestre', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PL-HRD-8'), 'cantidad', 30, 'precio', 690)),
    current_date + 7, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  -- Alambre MIG: el conductor la dejó y Almacén todavía no la valida.
  v_mig := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-131',
    'Alambre para la soldadora MIG del área de producción', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('ALA-MIG'), 'cantidad', 25, 'precio', 14.20)),
    current_date, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  v_base := public.emitir_compra_directa(gen_random_uuid(), v_pintu, 'PROF-2240',
    'Base anticorrosiva para el stock de pintura', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('PIN-BASE'), 'cantidad', 10, 'precio', 95)),
    current_date, 'CREDITO', 15, 'PEN', true, 'PLANTA');
  v_rech[2] := public.emitir_compra_directa(v_rech[2], v_hidra, 'COT-HA-0425',
    'Bomba hidráulica de repuesto para el almacén', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('BOM-HID'), 'cantidad', 1, 'precio', 2650)),
    current_date + 5, 'CREDITO', 30, 'PEN', true, 'PLANTA');
  -- Guantes: espera la aprobación de Gerencia.
  v_guan := public.emitir_compra_directa(gen_random_uuid(), v_ferre, 'COT-SJ-140',
    'Guantes de soldador para el cambio de mes del personal', jsonb_build_array(
      jsonb_build_object('material_id', pg_temp.demo_mat('EP-PM-GU-CU-00002'), 'cantidad', 24, 'precio', 18.90)),
    current_date + 5, 'CONTADO', 0, 'PEN', true, 'PLANTA');

  -- Gerencia aprueba casi todas, rechaza dos con su motivo y deja en su bandeja
  -- la del pistón y la de los guantes. Después anula dos que ya había
  -- aprobado, antes de que el conductor las recoja.
  perform pg_temp.demo_como(v_ger);
  foreach v_id in array array[v_pint, v_desb, v_pl4, v_hard, v_plan, v_ele, v_anu[1], v_disc, v_per,
                              v_anu[2], v_esm, v_thi, v_mig, v_base] loop
    perform public.aprobar_compra(v_id);
  end loop;
  perform public.rechazar_compra(v_rech[1],
    'Todavía hay Hardox del mes: se vuelve a pedir cuando baje del mínimo');
  perform public.rechazar_compra(v_rech[2],
    'No se compra una bomba de repuesto: la del volteo se cambia cuando falle');
  perform public.anular_orden_compra(v_anu[1],
    'El proveedor no tiene el tubo hasta fin de mes: se compra con el RQ del bastidor');
  perform public.anular_orden_compra(v_anu[2],
    'Se duplicó con las mangueras del RQ del volteo, que se compran aparte');

  -- Logística anexa la factura de las que llegan, y a cada una le pone su peso
  -- y su lugar en la lista del conductor.
  perform pg_temp.demo_factura(v_pint, v_log, 'F002-004518');
  perform pg_temp.demo_factura(v_pl4, v_log, 'F001-008842');
  perform pg_temp.demo_factura(v_ele, v_log, 'F001-011254');
  perform pg_temp.demo_factura(v_disc, v_log, 'F001-011273');
  perform pg_temp.demo_factura(v_mig, v_log, 'F001-011390');
  perform pg_temp.demo_factura(v_base, v_log, 'F002-004602');
  perform pg_temp.demo_como(v_log);
  perform public.programar_recojo(v.id, v.peso)
     from (values (v_pint, 62), (v_pl4, 450), (v_ele, 20), (v_disc, 35), (v_mig, 25), (v_base, 40),
                  (v_per, 8), (v_thi, 70), (v_hard, 760), (v_desb, 18), (v_plan, 180), (v_esm, 50))
          as v(id, peso);

  -- El conductor: seis dejadas en almacén, dos recogidas que todavía lleva en
  -- el camión y dos en camino a recogerlas. La de planchas y la de esmalte
  -- siguen por recoger.
  perform pg_temp.demo_como(v_cond);
  foreach v_id in array array[v_pint, v_pl4, v_ele, v_disc, v_mig, v_base, v_per, v_thi, v_hard, v_desb] loop
    perform public.marcar_compra_en_recojo(v_id);
    if v_id not in (v_hard, v_desb) then
      perform public.marcar_compra_recogida(v_id);
    end if;
    if v_id not in (v_hard, v_desb, v_per, v_thi) then
      perform public.marcar_compra_dejada_almacen(v_id);
    end if;
  end loop;

  -- Almacén valida enteras la de pintura y la de electrodo, y en parte la de
  -- discos (sesenta de cien) y la de planchas (ciento cincuenta de doscientas).
  -- La de alambre MIG y la de base siguen por validar.
  perform pg_temp.demo_como(v_alm);
  perform public.validar_ingresos_compra(v.id,
    (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', gen_random_uuid(),
              'cantidad', coalesce(v.llego, i.cantidad), 'observacion', v.nota))
       from public.ingresos_pendientes_almacen i where i.orden_compra_id = v.id and i.estado = 'PENDIENTE'),
    v.guia)
     from (values (v_pint, null::numeric, null::text, 'GR 0003-001245'),
                  (v_ele, null, null, 'GR 0001-000869'),
                  (v_disc, 60, 'Llegaron 60 discos; el proveedor manda los 40 que faltan la próxima semana', 'GR 0001-000877'),
                  (v_pl4, 150, 'Llegaron 150 planchas; las 50 restantes salen en el próximo despacho', 'GR 0002-003318'))
          as v(id, llego, nota, guia);
  perform public.rq_marcar_listo_en_almacen(v_rq[1], 'Llegó la base y el thinner');

  -- Las entregas, con su salida del kardex: el RQ 1 y el 4 enteros, el 3 con
  -- doce pernos de veinte.
  perform pg_temp.demo_sacar(v_rq[1], v_alm, 'Teodoro Alva');
  perform pg_temp.demo_sacar(v_rq[4], v_alm, 'Teodoro Alva');
  perform pg_temp.demo_sacar(v_rq[3], v_alm, 'Aurelio Ramírez', 12);
  perform pg_temp.demo_como(v_alm);
  perform public.rq_marcar_entregado(v_rq[1], 'Teodoro Alva');
  perform public.rq_marcar_entregado(v_rq[4], 'Teodoro Alva');
  perform public.rq_entregar_con_faltante(v_rq[3], 'Aurelio Ramírez',
    'Los ocho pernos que faltan se compran con la próxima reposición');

  -- El conteo del mes: de los discos de desbaste se contaron dos menos.
  perform public.registrar_conteo_almacen(gen_random_uuid(), pg_temp.demo_mat('DIS-DESB'), 33,
    'Conteo mensual del estante C: faltan dos discos');

  -- ------------------------------------------------ órdenes de servicio
  -- Doce servicios del arenador y del torno para las dos OT, emitidos del más
  -- antiguo al más nuevo: dos conformes, dos en ejecución, dos aprobados por
  -- empezar, dos rechazados, dos anulados y dos que esperan a Gerencia.
  perform pg_temp.demo_como(v_log);
  perform public.emitir_orden_servicio(v.id, v.prov, v.ot, v.area, v.cod, v.descripcion, v.ref,
            current_date - v.dias + 2, current_date - v.dias + 6, 'PEN', v.monto,
            v.condicion, v.plazo, v.detraccion, v.motivo)
     from (values
       (v_os[1],  v_torno,   v_ot1, v_prd, v_cod1, 'Corte de las cartelas y planchas de refuerzo de la tolva', 'COT-TSR-311', 13, 1850, 'CREDITO', 15, '025', null::text),
       (v_os[2],  v_torno,   v_ot1, v_prd, v_cod1, 'Mecanizado de las bocinas y pines de la compuerta de la tolva', 'COT-TSR-318', 11, 1320, 'CREDITO', 15, '025', null),
       (v_os[3],  v_arenado, v_ot1, v_prd, v_cod1, 'Arenado comercial y fondeado de la tolva', 'COT-ACH-093', 9, 3200, 'CONTADO', 0, '025', null),
       (v_os[4],  v_arenado, v_ot3, v_mtz, v_cod3, 'Arenado del chasis del furgón antes del montaje', 'COT-ACH-096', 8, 4100, 'CONTADO', 0, '025', null),
       (v_os[5],  v_arenado, v_ot3, v_mtz, v_cod3, 'Pintado al horno de los guardafangos del furgón', 'COT-ACH-098', 7, 2600, 'CONTADO', 0, '025', null),
       (v_os[6],  v_torno,   v_ot1, v_prd, v_cod1, 'Doblado de los perfiles laterales de la tolva', 'COT-TSR-322', 7, 780, 'CREDITO', 15, '025', null),
       (v_os[7],  v_torno,   v_ot1, v_prd, v_cod1, 'Rolado de los tubos del parachoques de la tolva', 'COT-TSR-327', 5, 1150, 'CREDITO', 15, '025', null),
       (v_os[8],  v_torno,   v_ot3, v_mtz, v_cod3, 'Torneado de los bujes de las bisagras del furgón', 'COT-TSR-330', 4, 640, 'CREDITO', 15, 'NO_SUJETA', 'El servicio no llega a S/ 700, el mínimo de la detracción'),
       (v_os[9],  v_arenado, v_ot3, v_mtz, v_cod3, 'Arenado de las puertas traseras del furgón', 'COT-ACH-099', 4, 900, 'CONTADO', 0, '025', null),
       (v_os[10], v_torno,   v_ot1, v_prd, v_cod1, 'Fresado de las placas de apoyo de la tolva', 'COT-TSR-334', 3, 2950, 'CREDITO', 15, '025', null),
       (v_os[11], v_arenado, v_ot3, v_mtz, v_cod3, 'Doblado de las planchas del techo del furgón', 'COT-ACH-101', 2, 950, 'CONTADO', 0, '025', null),
       (v_os[12], v_torno,   v_ot3, v_mtz, v_cod3, 'Corte de las planchas del piso del furgón', 'COT-TSR-339', 1, 1480, 'CREDITO', 15, '025', null))
       as v(id, prov, ot, area, cod, descripcion, ref, dias, monto, condicion, plazo, detraccion, motivo);
  perform pg_temp.demo_como(v_ger);
  foreach v_id in array v_os[1:9] loop
    if v_id <> v_os[4] then
      perform public.aprobar_orden_servicio(v_id);
    end if;
  end loop;
  perform public.rechazar_orden_servicio(v_os[4],
    'El chasis se arena en el taller, con el equipo propio');
  perform public.rechazar_orden_servicio(v_os[10],
    'Cotiza con otro proveedor: el precio dobla el de la última placa');
  -- Logística los inicia, da la conformidad de los terminados y anula los que
  -- ya no van.
  perform pg_temp.demo_como(v_log);
  foreach v_id in array array[v_os[1], v_os[2], v_os[3], v_os[5]] loop
    perform public.avanzar_orden_servicio(v_id, 'EN_EJECUCION', null);
  end loop;
  perform public.avanzar_orden_servicio(v_os[1], 'CONFORME', 'Cartelas recibidas completas y a medida');
  perform public.avanzar_orden_servicio(v_os[2], 'CONFORME', null);
  perform public.avanzar_orden_servicio(v_os[6], 'ANULADA',
    'El taller dobló los perfiles con la plegadora nueva: ya no hace falta el servicio');
  perform public.avanzar_orden_servicio(v_os[9], 'ANULADA',
    'Las puertas se arenan con el chasis, en el taller');

  -- ------------------------------------------------------ subcontratos
  -- Dos personas naturales con recibo por honorarios: dos encargos vigentes,
  -- dos terminados y dos anulados, del más antiguo al más nuevo. Los de la tolva
  -- son de Producción y los del furgón de Maestranza, como sus RQ: cada
  -- supervisión ve los suyos.
  perform pg_temp.demo_como(v_adm);
  v_sub := gen_random_uuid();
  v_sub2 := gen_random_uuid();
  perform public.guardar_subcontratista(v_sub, pg_temp.demo_ruc('1099999990'), 'RICARDO HUAMÁN QUISPE',
    '(01) 000-0106', 'BCP', '0000000000000', '00000000000000000000', true);
  perform public.guardar_subcontratista(v_sub2, pg_temp.demo_ruc('1099999989'), 'JULIO MAMANI TICONA',
    '(01) 000-0108', 'BBVA', '0000000000000000', '00000000000000000000', true);
  perform public.registrar_subcontrato(v.id, v.persona, v.cod, v.descripcion, 'PEN', v.monto,
            current_date - v.dias, current_date - v.dias + v.plazo, v.area)
     from (values
       (v_sc[1], v_sub2, v_cod1, 'Soldadura de las cartelas de refuerzo de la tolva', 1800, 12, 5, 'PRD'),
       (v_sc[2], v_sub,  v_cod3, 'Instalación de la alarma de retroceso del furgón', 450, 10, 3, 'MTZ'),
       (v_sc[3], v_sub2, v_cod3, 'Pintado de los logos del cliente en el furgón', 600, 8, 4, 'MTZ'),
       (v_sc[4], v_sub2, v_cod1, 'Armado del tolvín de la tolva', 950, 6, 4, 'PRD'),
       (v_sc[5], v_sub,  v_cod3, 'Instalación del sistema eléctrico y luces del furgón', 2400, 2, 10, 'MTZ'),
       (v_sc[6], v_sub,  v_cod1, 'Cableado de las luces de la tolva', 1100, 1, 6, 'PRD'))
       as v(id, persona, cod, descripcion, monto, dias, plazo, area);
  perform public.cambiar_estado_subcontrato(v_sc[1], 'TERMINADO');
  perform public.cambiar_estado_subcontrato(v_sc[2], 'TERMINADO');
  perform public.anular_subcontrato(v_sc[3], 'El cliente pidió los logos en vinil: ya no se pintan');
  perform public.anular_subcontrato(v_sc[4], 'El tolvín lo armó el personal del área de producción');

  -- Solo en la demostración: los documentos no nacieron todos hoy. Se corre
  -- hacia atrás cuándo se emitió cada RQ, cuándo lo revisó Almacén (un día
  -- después) y cuándo lo tomó Logística (dos días después, el día de su OC),
  -- para que Atención y Control de compras muestren días de espera; la fecha de
  -- la OC sigue a la de su RQ, y las directas van por la suya; las OS y los
  -- subcontratos, por la suya. Con `session_replication_role = replica` no
  -- corren los disparadores, ni el que congela un RQ entregado
  -- (`fn_rq_guardia`): por eso va al final y solo toca fechas.
  perform set_config('session_replication_role', 'replica', true);
  with d(id, dias) as (
    select v_rq[i], (array[14, 11, 10, 9, 8, 6, 5, 4, 3, 1, 0])[i] from generate_subscripts(v_rq, 1) i
    union all values (v_rqa[1], 6), (v_rqa[2], 2), (v_rqn[1], 9), (v_rqn[2], 3)
  )
  update public.requerimientos q
     set creado_en           = now() - make_interval(days => d.dias),
         revision_stock_en   = case when q.revision_stock_en is not null then now() - make_interval(days => d.dias - 1) end,
         en_atencion_en      = case when q.en_atencion_en is not null then now() - make_interval(days => d.dias - 2) end,
         listo_en_almacen_en = case when q.listo_en_almacen_en is not null and q.en_atencion_en is null
                                    then now() - make_interval(days => d.dias - 1) else q.listo_en_almacen_en end,
         anulado_en          = case when q.anulado_en is not null
                                    then now() - make_interval(days => d.dias - 1) end
    from d
   where q.id = d.id;
  update public.requerimiento_lineas l
     set creado_en = q.creado_en,
         stock_revisado_en = case when l.stock_revisado_en is not null then q.revision_stock_en end
    from public.requerimientos q
   where q.id = l.requerimiento_id;
  with f(id, creado) as (
    select l.orden_compra_id, min(q.en_atencion_en)
      from public.requerimiento_lineas l join public.requerimientos q on q.id = l.requerimiento_id
     where l.orden_compra_id is not null group by 1
    union all
    select v.id, now() - make_interval(days => v.dias)
      from (values (v_desb, 7), (v_pl4, 7), (v_hard, 6), (v_ele, 6), (v_anu[1], 6), (v_disc, 5), (v_per, 5),
                   (v_anu[2], 5), (v_esm, 4), (v_thi, 4), (v_rech[1], 4), (v_mig, 3), (v_base, 3),
                   (v_rech[2], 2), (v_guan, 1)) as v(id, dias)
  )
  update public.ordenes_compra_materiales c
     set creado_en = f.creado,
         aprobacion_pedida_en = case when c.aprobacion_pedida_en is not null then f.creado end,
         aprobado_en  = case when c.aprobado_en is not null then f.creado + interval '1 day' end,
         rechazado_en = case when c.rechazado_en is not null then f.creado + interval '1 day' end,
         anulada_en   = case when c.anulada_en is not null then f.creado + interval '2 days' end
    from f
   where c.id = f.id;
  update public.ordenes_servicio s
     set creado_en       = now() - make_interval(days => v.dias),
         aprobado_en     = case when s.aprobado_en is not null then now() - make_interval(days => v.dias - 1) end,
         rechazado_en    = case when s.rechazado_en is not null then now() - make_interval(days => v.dias - 1) end,
         iniciado_en     = case when s.iniciado_en is not null then now() - make_interval(days => v.dias - 2) end,
         conformidad_en  = case when s.conformidad_en is not null then now() - make_interval(days => v.dias - 6) end,
         anulado_en      = case when s.anulado_en is not null then now() - make_interval(days => v.dias - 2) end
    from (select v_os[i] as id, (array[13, 11, 9, 8, 7, 7, 5, 4, 4, 3, 2, 1])[i] as dias
            from generate_subscripts(v_os, 1) i) v
   where s.id = v.id;
  update public.subcontratos s
     set creado_en   = now() - make_interval(days => v.dias),
         terminado_en = case when s.terminado_en is not null then now() - make_interval(days => v.dias - v.plazo) end,
         anulado_en   = case when s.anulado_en is not null then now() - make_interval(days => v.dias - 2) end
    from (values (v_sc[1], 12, 5), (v_sc[2], 10, 3), (v_sc[3], 8, 4), (v_sc[4], 6, 4), (v_sc[5], 2, 10),
                 (v_sc[6], 1, 6)) as v(id, dias, plazo)
   where s.id = v.id;
  -- La compra sale a la lista del conductor cuando Gerencia la aprueba
  -- (`fn_compra_recojo`), así que su pedido de recojo lleva esa fecha. Lo de
  -- hoy va en el orden en que pasó, en horas: Logística programa los recojos y
  -- anexa las facturas, el conductor sale, recoge y deja en almacén,
  -- Almacén valida lo que llegó (el ingreso al kardex), deja listo el RQ 1 y
  -- entrega, y al final cuenta. En una sola carga todo tendría la misma hora: el
  -- kardex ordena por ella, y la salida podía salir antes que su ingreso y
  -- dejar el saldo en negativo. El inventario inicial va dos semanas atrás.
  update public.programacion_recojo set programado_en = now() - interval '9 hours' where programado_en = now();
  update public.documentos_compra_material set creado_en = now() - interval '9 hours' where creado_en = now();
  update public.ordenes_compra_materiales
     set recojo_pedido_en = case when recojo_pedido_en = now() then coalesce(aprobado_en, now() - interval '9 hours')
                                 else recojo_pedido_en end,
         en_recojo_en     = case when en_recojo_en = now() then now() - interval '8 hours' else en_recojo_en end,
         recogido_en      = case when recogido_en = now() then now() - interval '6 hours' else recogido_en end,
         dejado_en        = case when dejado_en = now() then now() - interval '5 hours' else dejado_en end,
         entregado_almacen_en = case when entregado_almacen_en = now() then now() - interval '3 hours'
                                     else entregado_almacen_en end
   where now() in (recojo_pedido_en, en_recojo_en, recogido_en, dejado_en, entregado_almacen_en);
  update public.ingresos_pendientes_almacen
     set creado_en   = case when creado_en = now() then now() - interval '5 hours' else creado_en end,
         dejado_en   = case when dejado_en = now() then now() - interval '5 hours' else dejado_en end,
         validado_en = case when validado_en = now() then now() - interval '3 hours' else validado_en end
   where now() in (creado_en, dejado_en, validado_en);
  update public.movimientos_materiales m
     set registrado_en = case
           when m.origen = 'INGRESO_GENERAL' then now() - interval '15 days'
           when m.tipo = 'INGRESO' then now() - interval '3 hours'
           else now() - interval '2 hours' end
   where m.registrado_en = now();
  update public.requerimientos
     set listo_en_almacen_en = case when listo_en_almacen_en = now() then now() - interval '2 hours 30 minutes'
                                    else listo_en_almacen_en end,
         entregado_en        = case when entregado_en = now() then now() - interval '2 hours' else entregado_en end
   where now() in (listo_en_almacen_en, entregado_en);
  update public.conteos_inventario c set registrado_en = now() - interval '1 hour'
   where c.registrado_en = now();
  perform set_config('session_replication_role', 'origin', true);

  if exists (select 1 from public.v_kardex_almacen where saldo < 0) then
    raise exception 'La demostración deja un saldo negativo en el kardex: revisa el orden de los movimientos.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
