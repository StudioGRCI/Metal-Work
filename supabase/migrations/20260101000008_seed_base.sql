-- =============================================================================
-- 0008 · DATOS BASE
-- Roles, permisos y catálogos mínimos para que el sistema arranque.
-- Es idempotente: puede volver a ejecutarse sin duplicar nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permisos, con formato modulo.accion
-- -----------------------------------------------------------------------------

insert into public.permisos (codigo, modulo, descripcion) values
  ('ordenes.ver',            'Órdenes de trabajo', 'Ver órdenes de trabajo y su detalle'),
  ('ordenes.crear',          'Órdenes de trabajo', 'Registrar nuevas órdenes de trabajo'),
  ('ordenes.editar',         'Órdenes de trabajo', 'Modificar datos de una orden de trabajo'),
  ('ordenes.aprobar',        'Órdenes de trabajo', 'Aprobar una orden y liberarla a producción'),
  ('ordenes.cambiar_estado', 'Órdenes de trabajo', 'Iniciar, pausar, reanudar o terminar una orden'),
  ('ordenes.anular',         'Órdenes de trabajo', 'Anular una orden de trabajo'),
  ('ordenes.entregar',       'Órdenes de trabajo', 'Registrar la entrega y el acta de conformidad'),

  ('produccion.ver',           'Producción', 'Ver etapas, avances y partes diarios'),
  ('produccion.registrar',     'Producción', 'Registrar avance de etapas y horas trabajadas'),
  ('produccion.aprobar_parte', 'Producción', 'Aprobar el parte diario y cargar las horas a la orden'),
  ('produccion.planificar',    'Producción', 'Programar fechas y asignar personal a las órdenes'),

  ('calidad.ver',          'Calidad', 'Ver inspecciones de calidad'),
  ('calidad.inspeccionar', 'Calidad', 'Registrar inspecciones y levantar observaciones'),

  ('clientes.ver',    'Comercial', 'Ver clientes y unidades'),
  ('clientes.crear',  'Comercial', 'Registrar clientes y unidades'),
  ('clientes.editar', 'Comercial', 'Modificar clientes y unidades'),

  ('cotizaciones.ver',     'Comercial', 'Ver cotizaciones'),
  ('cotizaciones.crear',   'Comercial', 'Elaborar cotizaciones'),
  ('cotizaciones.editar',  'Comercial', 'Modificar cotizaciones en borrador'),
  ('cotizaciones.aprobar', 'Comercial', 'Aprobar o rechazar una cotización'),

  ('almacen.ver',         'Almacén', 'Consultar stock, kardex y movimientos'),
  ('almacen.movimientos', 'Almacén', 'Registrar ingresos, salidas y devoluciones'),
  ('almacen.confirmar',   'Almacén', 'Confirmar movimientos y afectar el kardex'),
  ('almacen.inventario',  'Almacén', 'Realizar inventarios y ajustes de existencias'),
  ('almacen.maestros',    'Almacén', 'Administrar el catálogo de materiales y almacenes'),

  ('requerimientos.ver',     'Almacén', 'Ver requerimientos de material'),
  ('requerimientos.crear',   'Almacén', 'Solicitar material para una orden de trabajo'),
  ('requerimientos.aprobar', 'Almacén', 'Aprobar requerimientos y reservar stock'),

  ('compras.ver',     'Compras', 'Ver órdenes de compra y proveedores'),
  ('compras.crear',   'Compras', 'Generar órdenes de compra'),
  ('compras.aprobar', 'Compras', 'Aprobar órdenes de compra'),
  ('compras.recibir', 'Compras', 'Registrar la recepción de mercadería'),

  ('costos.ver',    'Costos', 'Ver el costeo y el margen de las órdenes'),
  ('costos.editar', 'Costos', 'Registrar presupuestos, servicios de terceros y gastos'),
  ('costos.cerrar', 'Costos', 'Cerrar el costeo de una orden'),

  ('documentos.ver',      'Documentos', 'Ver y descargar documentos'),
  ('documentos.subir',    'Documentos', 'Adjuntar documentos y nuevas versiones'),
  ('documentos.aprobar',  'Documentos', 'Aprobar u observar documentos'),
  ('documentos.eliminar', 'Documentos', 'Anular documentos'),

  ('reportes.ver', 'Reportes', 'Ver reportes e indicadores de gestión'),

  ('configuracion.ver',    'Configuración', 'Ver la configuración del sistema'),
  ('configuracion.editar', 'Configuración', 'Modificar catálogos, series y parámetros'),
  ('usuarios.ver',         'Configuración', 'Ver usuarios'),
  ('usuarios.gestionar',   'Configuración', 'Crear usuarios y asignar roles'),
  ('auditoria.ver',        'Configuración', 'Consultar el historial de auditoría')
on conflict (codigo) do update
  set modulo = excluded.modulo,
      descripcion = excluded.descripcion;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('ADMIN',        'Administrador',      'Acceso total al sistema y a la configuración', 100, true),
  ('GERENTE',      'Gerencia',           'Consulta total, aprobación de cotizaciones y órdenes', 90, true),
  ('JEFE_TALLER',  'Jefe de taller',     'Planifica, libera y controla la ejecución de las órdenes', 70, true),
  ('SUPERVISOR',   'Supervisor',         'Supervisa etapas y aprueba los partes diarios', 60, true),
  ('CALIDAD',      'Control de calidad', 'Inspecciona y levanta observaciones', 55, true),
  ('ALMACENERO',   'Almacenero',         'Administra existencias, ingresos y salidas de material', 50, true),
  ('COMPRADOR',    'Compras',            'Gestiona proveedores y órdenes de compra', 50, true),
  ('VENDEDOR',     'Comercial',          'Atiende clientes y elabora cotizaciones', 45, true),
  ('COSTOS',       'Costos',             'Controla el costeo y el margen de las órdenes', 45, true),
  ('OPERARIO',     'Operario',           'Registra su avance y sus horas de trabajo', 20, true),
  ('CONSULTA',     'Solo consulta',      'Acceso de lectura sin poder modificar nada', 10, true)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      nivel = excluded.nivel;

-- -----------------------------------------------------------------------------
-- Asignación de permisos por rol
-- ADMIN no se lista: public.es_admin() le concede todo sin pasar por esta tabla.
-- -----------------------------------------------------------------------------

with asignaciones(rol, permiso) as (
  values
    -- Gerencia: ve todo y aprueba lo que compromete dinero.
    ('GERENTE', 'ordenes.ver'), ('GERENTE', 'ordenes.aprobar'), ('GERENTE', 'ordenes.anular'),
    ('GERENTE', 'produccion.ver'), ('GERENTE', 'calidad.ver'),
    ('GERENTE', 'clientes.ver'), ('GERENTE', 'cotizaciones.ver'), ('GERENTE', 'cotizaciones.aprobar'),
    ('GERENTE', 'almacen.ver'), ('GERENTE', 'requerimientos.ver'),
    ('GERENTE', 'compras.ver'), ('GERENTE', 'compras.aprobar'),
    ('GERENTE', 'costos.ver'), ('GERENTE', 'costos.cerrar'),
    ('GERENTE', 'documentos.ver'), ('GERENTE', 'documentos.aprobar'),
    ('GERENTE', 'reportes.ver'), ('GERENTE', 'auditoria.ver'),

    -- Jefe de taller: dueño de la ejecución.
    ('JEFE_TALLER', 'ordenes.ver'), ('JEFE_TALLER', 'ordenes.crear'), ('JEFE_TALLER', 'ordenes.editar'),
    ('JEFE_TALLER', 'ordenes.cambiar_estado'), ('JEFE_TALLER', 'ordenes.entregar'),
    ('JEFE_TALLER', 'produccion.ver'), ('JEFE_TALLER', 'produccion.registrar'),
    ('JEFE_TALLER', 'produccion.aprobar_parte'), ('JEFE_TALLER', 'produccion.planificar'),
    ('JEFE_TALLER', 'calidad.ver'),
    ('JEFE_TALLER', 'clientes.ver'), ('JEFE_TALLER', 'cotizaciones.ver'),
    ('JEFE_TALLER', 'almacen.ver'),
    ('JEFE_TALLER', 'requerimientos.ver'), ('JEFE_TALLER', 'requerimientos.crear'),
    ('JEFE_TALLER', 'requerimientos.aprobar'),
    ('JEFE_TALLER', 'costos.ver'),
    ('JEFE_TALLER', 'documentos.ver'), ('JEFE_TALLER', 'documentos.subir'),
    ('JEFE_TALLER', 'reportes.ver'),

    ('SUPERVISOR', 'ordenes.ver'), ('SUPERVISOR', 'ordenes.cambiar_estado'),
    ('SUPERVISOR', 'produccion.ver'), ('SUPERVISOR', 'produccion.registrar'),
    ('SUPERVISOR', 'produccion.aprobar_parte'),
    ('SUPERVISOR', 'calidad.ver'),
    ('SUPERVISOR', 'almacen.ver'),
    ('SUPERVISOR', 'requerimientos.ver'), ('SUPERVISOR', 'requerimientos.crear'),
    ('SUPERVISOR', 'documentos.ver'), ('SUPERVISOR', 'documentos.subir'),

    ('CALIDAD', 'ordenes.ver'), ('CALIDAD', 'produccion.ver'),
    ('CALIDAD', 'calidad.ver'), ('CALIDAD', 'calidad.inspeccionar'),
    ('CALIDAD', 'documentos.ver'), ('CALIDAD', 'documentos.subir'),

    ('ALMACENERO', 'ordenes.ver'),
    ('ALMACENERO', 'almacen.ver'), ('ALMACENERO', 'almacen.movimientos'),
    ('ALMACENERO', 'almacen.confirmar'), ('ALMACENERO', 'almacen.inventario'),
    ('ALMACENERO', 'almacen.maestros'),
    ('ALMACENERO', 'requerimientos.ver'), ('ALMACENERO', 'requerimientos.aprobar'),
    ('ALMACENERO', 'compras.ver'), ('ALMACENERO', 'compras.recibir'),
    ('ALMACENERO', 'documentos.ver'), ('ALMACENERO', 'documentos.subir'),

    ('COMPRADOR', 'almacen.ver'),
    ('COMPRADOR', 'requerimientos.ver'),
    ('COMPRADOR', 'compras.ver'), ('COMPRADOR', 'compras.crear'), ('COMPRADOR', 'compras.recibir'),
    ('COMPRADOR', 'documentos.ver'), ('COMPRADOR', 'documentos.subir'),

    ('VENDEDOR', 'ordenes.ver'),
    ('VENDEDOR', 'clientes.ver'), ('VENDEDOR', 'clientes.crear'), ('VENDEDOR', 'clientes.editar'),
    ('VENDEDOR', 'cotizaciones.ver'), ('VENDEDOR', 'cotizaciones.crear'), ('VENDEDOR', 'cotizaciones.editar'),
    ('VENDEDOR', 'documentos.ver'), ('VENDEDOR', 'documentos.subir'),

    ('COSTOS', 'ordenes.ver'), ('COSTOS', 'produccion.ver'), ('COSTOS', 'almacen.ver'),
    ('COSTOS', 'compras.ver'), ('COSTOS', 'cotizaciones.ver'),
    ('COSTOS', 'costos.ver'), ('COSTOS', 'costos.editar'), ('COSTOS', 'costos.cerrar'),
    ('COSTOS', 'documentos.ver'), ('COSTOS', 'reportes.ver'),

    -- El operario solo ve lo suyo: las políticas RLS acotan además a sus propias órdenes.
    ('OPERARIO', 'ordenes.ver'),
    ('OPERARIO', 'produccion.ver'), ('OPERARIO', 'produccion.registrar'),
    ('OPERARIO', 'requerimientos.crear'),
    ('OPERARIO', 'documentos.ver'),

    ('CONSULTA', 'ordenes.ver'), ('CONSULTA', 'produccion.ver'), ('CONSULTA', 'clientes.ver'),
    ('CONSULTA', 'cotizaciones.ver'), ('CONSULTA', 'almacen.ver'), ('CONSULTA', 'documentos.ver'),
    ('CONSULTA', 'reportes.ver')
)
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, a.permiso
  from asignaciones a
  join public.roles r on r.codigo = a.rol
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Series documentarias
-- -----------------------------------------------------------------------------

insert into public.series_documentarias (tipo, serie, prefijo, longitud) values
  ('COTIZACION',        '001', 'COT',  5),
  ('ORDEN_TRABAJO',     '001', 'OT',   5),
  ('REQUERIMIENTO',     '001', 'REQ',  5),
  ('ORDEN_COMPRA',      '001', 'OC',   5),
  ('INGRESO_ALMACEN',   '001', 'ING',  5),
  ('SALIDA_ALMACEN',    '001', 'SAL',  5),
  ('DEVOLUCION_ALMACEN','001', 'DEV',  5),
  ('AJUSTE_INVENTARIO', '001', 'AJU',  5),
  ('PARTE_DIARIO',      '001', 'PD',   5),
  ('ACTA_CONFORMIDAD',  '001', 'ACT',  5),
  ('INSPECCION_CALIDAD','001', 'INS',  5)
on conflict (tipo, serie, sede_id) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de carrocería que fabrica el taller
-- Los valores de referencia (horas, peso, precio) son puntos de partida para
-- presupuestar; la empresa los ajusta desde Configuración.
-- -----------------------------------------------------------------------------

insert into public.tipos_carroceria
  (codigo, nombre, descripcion, horas_hombre_estandar, peso_estimado_kg, precio_referencial, orden_secuencia) values
  ('TOLVA_VOLQUETE',  'Tolva para volquete',      'Tolva de acero para volquete, con compuerta trasera y sistema de levante', 320, 3800,  42000, 1),
  ('PLATAFORMA',      'Plataforma',               'Plataforma plana para tracto-remolque o camión',                           220, 2600,  28000, 2),
  ('BARANDA',         'Carrocería con barandas',  'Plataforma con barandas laterales abatibles',                              240, 2900,  31000, 3),
  ('FURGON',          'Furgón',                   'Furgón cerrado con estructura metálica y forro',                           280, 3200,  38000, 4),
  ('FURGON_FRIGORIFICO','Furgón frigorífico',     'Furgón aislado con panel térmico para carga refrigerada',                  360, 3600,  62000, 5),
  ('CISTERNA',        'Cisterna',                 'Tanque cisterna para combustible o agua',                                  420, 4500,  75000, 6),
  ('TANQUE',          'Tanque',                   'Tanque estacionario o de transporte',                                      300, 3400,  48000, 7),
  ('CAMA_BAJA',       'Cama baja',                'Semirremolque cama baja para maquinaria pesada',                           520, 6200, 110000, 8),
  ('PORTACONTENEDOR', 'Portacontenedor',          'Chasis portacontenedor con twist locks',                                   380, 4100,  58000, 9),
  ('REPOTENCIACION',  'Repotenciación',           'Reconstrucción y refuerzo de una carrocería existente',                    160, 1200,  18000, 10)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion;

-- -----------------------------------------------------------------------------
-- Etapas estándar de fabricación
-- El orden refleja el flujo real del taller. horas_estandar pondera el avance
-- de la OT: las etapas largas pesan más en el porcentaje total.
-- -----------------------------------------------------------------------------

insert into public.etapas_catalogo
  (codigo, nombre, descripcion, orden_secuencia, horas_estandar, requiere_inspeccion, permite_paralelo, color) values
  ('HABILITADO',   'Habilitado',            'Corte, plegado y habilitado de planchas y perfiles',            1, 40, false, false, '#64748B'),
  ('ARMADO',       'Armado de estructura',  'Armado del chasis y la estructura de la carrocería',            2, 60, false, false, '#0EA5E9'),
  ('SOLDADURA',    'Soldadura',             'Soldadura estructural y de refuerzos',                          3, 70, true,  false, '#F97316'),
  ('ESMERILADO',   'Esmerilado',            'Esmerilado y limpieza de cordones de soldadura',                 4, 25, false, false, '#A3A3A3'),
  ('MASILLADO',    'Masillado',             'Masillado y preparación de superficie',                         5, 30, false, false, '#EAB308'),
  ('ARENADO',      'Arenado',               'Arenado o granallado previo a la pintura',                      6, 20, false, true,  '#78716C'),
  ('PINTURA_BASE', 'Pintura base',          'Aplicación de base anticorrosiva',                              7, 18, false, false, '#3B82F6'),
  ('PINTURA',      'Pintura de acabado',    'Acabado final y logotipos del cliente',                         8, 24, false, false, '#8B5CF6'),
  ('HIDRAULICO',   'Sistema hidráulico',    'Montaje de pistón, bomba, mangueras y tomafuerza',              9, 32, true,  true,  '#EF4444'),
  ('ELECTRICO',    'Sistema eléctrico',     'Instalación de arnés, luces y señalización',                   10, 16, false, true,  '#F59E0B'),
  ('ACCESORIOS',   'Accesorios',            'Montaje de guardafangos, escaleras, tapas y accesorios',       11, 14, false, true,  '#14B8A6'),
  ('CALIDAD',      'Control de calidad',    'Inspección final y pruebas de funcionamiento',                 12, 10, true,  false, '#22C55E'),
  ('ENTREGA',      'Entrega',               'Limpieza, acta de conformidad y entrega al cliente',           13,  6, false, false, '#16A34A')
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      horas_estandar = excluded.horas_estandar,
      requiere_inspeccion = excluded.requiere_inspeccion,
      permite_paralelo = excluded.permite_paralelo,
      color = excluded.color;
