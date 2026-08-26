-- =============================================================================
-- LAS FICHAS TÉCNICAS QUE LA EMPRESA YA ESCRIBE
-- -----------------------------------------------------------------------------
-- Transcritas de dos cotizaciones reales:
--
--   COT N° 3675 – 2026 · TOLVA DE 10 M3 PARA MONTAR EN CHASIS FUSO
--   COT N° 3659 – 2026 · PLATAFORMA SEMIRREMOLQUE, SUSPENSIÓN NEUMÁTICA
--
-- Están tal como salen firmadas, con sus espesores, sus marcas y sus normas.
-- La idea es que cotizar deje de ser volver a escribir la ficha: se elige el
-- tipo de carrocería, la ficha viene puesta, y solo se ajusta lo que cambia
-- —las medidas, algún espesor, los accesorios que este cliente pidió—.
--
-- Los datos que cambian en cada cotización (largo, ancho, alto, capacidad) NO
-- van en la plantilla: viven en la cabecera de la cotización, que es donde se
-- llenan una sola vez.
-- =============================================================================

do $$
declare
  v_plantilla uuid;
  v_tipo      uuid;
begin

-- ============================================================== TOLVA VOLQUETE
select id into v_tipo from public.tipos_carroceria where codigo = 'TOLVA_VOLQUETE';

if v_tipo is not null then
  insert into public.plantillas_ficha (tipo_carroceria_id, nombre, descripcion)
  values (v_tipo, 'Tolva volquete estándar',
          'Ficha de la COT N° 3675 – 2026, tolva de 10 m3 para montar en chasis.')
  on conflict (tipo_carroceria_id, nombre) do update set descripcion = excluded.descripcion
  returning id into v_plantilla;

  delete from public.plantilla_ficha_lineas     where plantilla_id = v_plantilla;
  delete from public.plantilla_ficha_accesorios where plantilla_id = v_plantilla;

  insert into public.plantilla_ficha_lineas
    (plantilla_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  values
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 1, 'Marca',      'METAL WORK'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 2, 'Modelo',     'VASCULANTE'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 3, 'Carrocería', 'TOLVA'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 4, 'Materiales',
       'Acero estructural ASTM A-36. La fabricación de la estructura se realiza bajo las normas AWS T1.1'),

    (v_plantilla, 'SOLDADURA', 2, 1, null,
       'Todo el proceso de soldadura se realiza en GMAW (Mig Mag), lo cual garantiza una excelente unión soldada y un buen acabado'),

    (v_plantilla, 'ESTRUCTURA', 3, 1, 'Durmientes', 'Plancha ASTM A-36 de 6 mm'),
    (v_plantilla, 'ESTRUCTURA', 3, 2, 'Postes',     'Plancha ASTM A-36 de 4.5 mm'),

    (v_plantilla, 'FORROS', 4, 1, 'Piso',                'Plancha estructural ASTM A-36 de 6 mm'),
    (v_plantilla, 'FORROS', 4, 2, 'Lateral',             'Plancha estructural ASTM A-36 de 4.5 mm'),
    (v_plantilla, 'FORROS', 4, 3, 'Frontal y compuerta', 'Plancha estructural ASTM A-36 de 3 mm'),
    (v_plantilla, 'FORROS', 4, 4, 'Visera protectora',   'De cabina, en plancha ASTM A-36 de 2.5 mm'),

    (v_plantilla, 'ESTRUCTURAS COMPLEMENTARIAS', 5, 1, 'Laterales', 'Canal estructural en U 6" importado'),
    (v_plantilla, 'ESTRUCTURAS COMPLEMENTARIAS', 5, 2, 'Mamparón',  'Plegado en frío con plancha estructural ASTM A-36 de 1/8"'),
    (v_plantilla, 'ESTRUCTURAS COMPLEMENTARIAS', 5, 3, 'Carteras',  'Plegado en frío con plancha estructural ASTM A-36'),
    (v_plantilla, 'ESTRUCTURAS COMPLEMENTARIAS', 5, 4, 'Ganchos',   'Plegado en frío con plancha estructural ASTM A-36'),

    (v_plantilla, 'PUERTA', 6, 1, null, 'Compuerta posterior con apertura mecánica automática'),

    (v_plantilla, 'SISTEMA HIDRÁULICO', 7, 1, 'Tanque',  'De almacenamiento, con capacidad de 85 litros'),
    (v_plantilla, 'SISTEMA HIDRÁULICO', 7, 2, 'Válvula', 'De distribución'),
    (v_plantilla, 'SISTEMA HIDRÁULICO', 7, 3, 'Pistón',  'Telescópico de cuatro (4) cuerpos cromados'),
    (v_plantilla, 'SISTEMA HIDRÁULICO', 7, 4, 'Kit',     'De instalación hidráulica'),
    (v_plantilla, 'SISTEMA HIDRÁULICO', 7, 5, null,      'Toma fuerza'),

    (v_plantilla, 'SISTEMA ELÉCTRICO', 8, 1, null, 'Todos los cables eléctricos vulcanizados'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 8, 2, null, 'Cinco (5) faros laterales por lado'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 8, 3, null, 'Dos (2) faros piratas posteriores'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 8, 4, null, 'Faros posteriores originales del chasis'),

    (v_plantilla, 'PINTURA', 9, 1, null, 'Arenado industrial'),
    (v_plantilla, 'PINTURA', 9, 2, null, 'Dos (02) capas de pintura epóxica'),
    (v_plantilla, 'PINTURA', 9, 3, null,
       'Acabado con SHERWIN WILLIAMS; se pinta con los colores que elija el cliente'),

    (v_plantilla, 'MONTAJE', 10, 1, null, 'Al chasis mediante anclajes unidos con pernos de 5/8" - 8°'),

    (v_plantilla, 'OTROS', 11, 1, null, 'Incluye correr transmisión y recorte de cardán');

  insert into public.plantilla_ficha_accesorios
    (plantilla_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
  values
    (v_plantilla,  1, 2, 'unid', 'Caucho',                                true),
    (v_plantilla,  2, 1, 'unid', 'Parachoque posterior',                  true),
    (v_plantilla,  3, 1, 'unid', 'Porta llanta para llanta',              true),
    (v_plantilla,  4, 1, 'unid', 'Porta conos de seguridad',              false),
    (v_plantilla,  5, 1, 'unid', 'Porta tacos',                           false),
    (v_plantilla,  6, 1, 'unid', 'Caja porta extintor',                   false),
    (v_plantilla,  7, 1, 'unid', 'Accesorio porta palana y porta pico',   true),
    (v_plantilla,  8, 1, 'unid', 'Cinta reflectiva',                      true);
end if;

-- ======================================================= PLATAFORMA SEMIRREMOLQUE
select id into v_tipo from public.tipos_carroceria where codigo = 'PLATAFORMA';

if v_tipo is not null then
  insert into public.plantillas_ficha (tipo_carroceria_id, nombre, descripcion)
  values (v_tipo, 'Plataforma semirremolque con suspensión neumática',
          'Ficha de la COT N° 3659 – 2026, plataforma reforzada de 13.50 m con tres ejes.')
  on conflict (tipo_carroceria_id, nombre) do update set descripcion = excluded.descripcion
  returning id into v_plantilla;

  delete from public.plantilla_ficha_lineas     where plantilla_id = v_plantilla;
  delete from public.plantilla_ficha_accesorios where plantilla_id = v_plantilla;

  insert into public.plantilla_ficha_lineas
    (plantilla_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  values
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 1, 'Marca',      'METAL WORK'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 2, 'Modelo',     'SEMIRREMOLQUE'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 3, 'Tipo',       'PLATAFORMA REFORZADA'),
    (v_plantilla, 'ESPECIFICACIONES TÉCNICAS', 1, 4, 'Materiales',
       'Acero estructural ASTM A-36. La fabricación de la estructura se realiza bajo las normas AWS T1.1'),

    (v_plantilla, 'SOLDADURA', 2, 1, null, 'Todo el proceso de soldadura se realiza en GMAW (Mig Mag)'),

    (v_plantilla, 'VIGA PRINCIPAL', 3, 1, null,      'Conformada por alma, cuello y platina en "I" reforzada'),
    (v_plantilla, 'VIGA PRINCIPAL', 3, 2, 'Cuello',  'Altura de 28 cm, en plancha estructural ASTM A-36 de 1/2"'),
    (v_plantilla, 'VIGA PRINCIPAL', 3, 3, 'Alma',    'Altura de 50 cm, en plancha estructural ASTM A-36 de 1/4"'),
    (v_plantilla, 'VIGA PRINCIPAL', 3, 4, 'Platinas','Platina importada de 5/8" en la parte inferior y superior de la viga'),

    (v_plantilla, 'PUENTES', 4, 1, 'Centrales',     'Plegado en frío, canal en "C" con plancha estructural ASTM A-36 de 1/4"'),
    (v_plantilla, 'PUENTES', 4, 2, 'De suspensión', 'Plegado en frío, canal en "C" entubado, plancha estructural ASTM A-36 de 1/4"'),
    (v_plantilla, 'PUENTES', 4, 3, 'Travesaño',     'Plegado en frío, canal en "C" con plancha estructural ASTM A-36 de 3/16"'),

    (v_plantilla, 'PLATAFORMA', 5, 1, 'Laterales', 'Canal estructural de 1/4" x 6" importado'),
    (v_plantilla, 'PLATAFORMA', 5, 2, 'Mamparón',  'Plegado en frío con plancha estructural ASTM A-36 de 1/8", de 3.00 m'),
    (v_plantilla, 'PLATAFORMA', 5, 3, 'Visera',    'Plegado en frío con plancha estructural ASTM A-36 de 1/8"'),
    (v_plantilla, 'PLATAFORMA', 5, 4, 'Carteras',  'Plegado en frío con plancha estructural ASTM A-36 de 3/16" — 42 unidades'),
    (v_plantilla, 'PLATAFORMA', 5, 5, 'Ganchos',   'Plegado en frío con plancha estructural ASTM A-36 de 1/2" — 22 unidades'),

    (v_plantilla, 'COMPUERTA POSTERIOR', 6, 1, 'Compuerta', 'Plegado en frío con plancha estructural ASTM A-36 de 1.5 mm'),
    (v_plantilla, 'COMPUERTA POSTERIOR', 6, 2, 'Púas',      'Movibles, en fierro liso de 1/2" con los filos puntiagudos'),

    (v_plantilla, 'PISO', 7, 1, null, 'Piso reforzado, constituido en plancha estriada de 1/8"'),

    (v_plantilla, 'EJES', 8, 1, null, '03 ejes importados marca SUNTECH de 77.5" de trocha extra ancha, para estabilidad de la carga'),
    (v_plantilla, 'EJES', 8, 2, null, 'De 30,000 lbs de capacidad (13 Tn por eje, para mayor resistencia de la carga)'),
    (v_plantilla, 'EJES', 8, 3, null, 'Rodamiento 518445/518410 Propar o paralelos, con bocamazas para aro plato 22.5" americanos'),

    (v_plantilla, 'EJE RETRÁCTIL', 9, 1, null, '01 eje retráctil neumático con su respectiva instalación'),
    (v_plantilla, 'EJE RETRÁCTIL', 9, 2, null, '01 válvula switch Push Pull de accionamiento'),

    (v_plantilla, 'PATA DE APOYO', 10, 1, null,
       'Patas delanteras marca JOST / AMPRO importadas, de 80 Tn de carga vertical, con mecanismo de dos velocidades'),

    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 1, null, 'TA 300T tipo Watson de 30,000 lbs, marca SUNTECH original importada'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 2, null, '06 bolsas de aire marca GOODYEAR'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 3, null, '06 brazos originales'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 4, null, '06 perchas de sujeción de viga y brazos'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 5, null, '06 amortiguadores'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 6, null, '06 fajas limitadoras de carrera'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 7, null, '12 abrazaderas'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 8, null, '01 tanque de aire individual'),
    (v_plantilla, 'SUSPENSIÓN NEUMÁTICA', 11, 9, null, 'Válvula niveladora marca HADLEY y accesorios completos'),

    (v_plantilla, 'SISTEMA DE FRENOS', 12, 1, null, 'Sistema completo y reglamentario'),
    (v_plantilla, 'SISTEMA DE FRENOS', 12, 2, null, '02 cámaras de aire simple'),
    (v_plantilla, 'SISTEMA DE FRENOS', 12, 3, null, '04 cámaras de aire doble o machimbre'),
    (v_plantilla, 'SISTEMA DE FRENOS', 12, 4, null, '01 tanque de aire individual para frenos'),
    (v_plantilla, 'SISTEMA DE FRENOS', 12, 5, null, '02 manitos de aire y 02 válvulas de desfogue rápido de 3/8"'),
    (v_plantilla, 'SISTEMA DE FRENOS', 12, 6, null, '01 válvula pulpo marca Sealco, válvulas de protección marca Sealco y accesorios completos'),

    (v_plantilla, 'SISTEMA ELÉCTRICO', 13, 1, null, 'Ramal eléctrico vulcanizado, protegido con aislador de calor para evitar cortocircuito'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 13, 2, null, '02 focos LED bivoltaje de 2" en el mamparón'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 13, 3, null, '08 focos LED bivoltaje de 2" en los laterales'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 13, 4, null, '08 focos LED de 4" posteriores'),
    (v_plantilla, 'SISTEMA ELÉCTRICO', 13, 5, null, '02 focos piratas y 01 enchufe heptafásico delantero, según reglamento'),

    (v_plantilla, 'KING PIN', 14, 1, null, 'Perno rey estándar soldable de 2" x 1/2" marca JOST original'),
    (v_plantilla, 'KING PIN', 14, 2, null, 'Plancha de king pin en plancha estructural ASTM A-36 de 1/2", debajo de platina'),

    (v_plantilla, 'PINTURA', 15, 1, null, 'Proceso de arenado industrial'),
    (v_plantilla, 'PINTURA', 15, 2, null, '02 capas de pintura epóxica'),
    (v_plantilla, 'PINTURA', 15, 3, null, 'Acabado de pintado en GLOSS, en los colores que el cliente elija');

  insert into public.plantilla_ficha_accesorios
    (plantilla_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
  values
    (v_plantilla,  1, 10, 'unid', 'Winches soldables de 4" para sujeción de carga', true),
    (v_plantilla,  2,  8, 'unid', 'Enganches de contenedor',                        true),
    (v_plantilla,  3,  1, 'unid', 'Porta triplay, en la parte central',             true),
    (v_plantilla,  4,  1, 'unid', 'Porta palos, en la parte posterior',             true),
    (v_plantilla,  5,  2, 'unid', 'Porta llantas para llanta balón',                true),
    (v_plantilla,  6,  1, 'unid', 'Porta conos',                                    false),
    (v_plantilla,  7,  1, 'unid', 'Porta tacos',                                    false),
    (v_plantilla,  8,  1, 'unid', 'Caja porta extintor, en la pata',                false),
    (v_plantilla,  9,  1, 'unid', 'Tanque de agua plástico',                        true),
    (v_plantilla, 10,  2, 'unid', 'Caja de herramientas',                           true),
    (v_plantilla, 11,  1, 'unid', 'Alarma de retroceso, luz de placa y focos piratas', true),
    (v_plantilla, 12,  2, 'unid', 'Escarpines de caucho',                           true),
    (v_plantilla, 13,  2, 'unid', 'Jebes posteriores, protección de parachoques',   true),
    (v_plantilla, 14,  2, 'unid', 'Protectores de focos posteriores',               true),
    (v_plantilla, 15,  1, 'juego','Cinta reflectiva y las respectivas señalizaciones', true);
end if;

end;
$$;

-- La nota que la empresa pone al pie, según el producto, queda como valor por
-- defecto de la cotización para no volver a escribirla.
update public.cotizaciones
   set nota = coalesce(nota, 'Incluye certificado de montaje y expediente para registros públicos.')
 where nota is null and estado = 'BORRADOR';
