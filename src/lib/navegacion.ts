import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Calculator,
  Building2,
  CalendarClock,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ClockAlert,
  Cog,
  Coins,
  FileSpreadsheet,
  FileText,
  HardHat,
  Hash,
  Layers,
  LayoutDashboard,
  ListOrdered,
  MessageSquareWarning,
  NotebookPen,
  Package,
  Receipt,
  Settings,
  Tag,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'

export type ItemNavegacion = {
  titulo: string
  ruta: string
  icono: typeof LayoutDashboard
  /** Con varios permisos basta con tener uno para que el módulo se vea. */
  permiso?: string | readonly string[]
  descripcion?: string
  /** Los módulos aún no construidos se muestran atenuados y sin enlace. */
  disponible?: boolean
}

export type GrupoNavegacion = { titulo: string; items: readonly ItemNavegacion[] }

/**
 * El catálogo de módulos, agrupado por el área que los lleva: cotización PDF →
 * Gerencia aprueba → Administración carga la orden → Diseño desglosa →
 * almacén y logística atienden → el taller reporta.
 *
 * No es el menú de nadie en particular: cada puesto ve el suyo, en el orden de
 * su trabajo (`MENU_POR_PUESTO`, más abajo). Este catálogo completo, filtrado
 * por permiso, es solo el menú de ADMIN y de los puestos que todavía no tienen
 * uno propio.
 */
export const NAVEGACION = [
  {
    titulo: 'Principal',
    items: [
      {
        titulo: 'Tablero',
        ruta: '/',
        icono: LayoutDashboard,
        descripcion: 'Estado general del taller',
        disponible: true,
      },
      {
        titulo: 'Órdenes de trabajo',
        ruta: '/ordenes',
        icono: FileSpreadsheet,
        permiso: 'ordenes.listar',
        descripcion: 'Todas las OT y su avance',
        disponible: true,
      },
      // Lo que se trabaja hoy va por código interno, no por OT: Gerencia ve cada
      // código con sus reportes de avance y su costeo (migración 20261014220000).
      {
        titulo: 'Códigos internos',
        ruta: '/codigos-internos',
        icono: Hash,
        permiso: 'codigos_internos.ver',
        descripcion: 'Cada código con su avance y lo que lleva costado: mano de obra, materiales y compras',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Agente de Ventas',
    items: [
      {
        titulo: 'Cotización',
        ruta: '/cotizaciones/pdf',
        icono: FileText,
        permiso: ['cotizaciones.ver_pdf_comercial', 'cotizaciones.liberar_tesoreria', 'tesoreria.ver_documentos'],
        descripcion: 'El PDF que se le mandó al cliente, y su visto de Gerencia',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Preparación técnica',
    items: [
      // El catálogo chico del que Diseño elige al desglosar los materiales de
      // la orden: nombre, unidad y especificación. Sin stock ni almacén.
      {
        titulo: 'Materiales',
        ruta: '/materiales',
        icono: Boxes,
        permiso: 'diseno.planos',
        descripcion: 'El catálogo del que Diseño arma el desglose',
        disponible: true,
      },
      {
        titulo: 'Informe semanal de Diseño',
        ruta: '/diseno/informe-semanal',
        icono: FileText,
        // Lo llena el colaborador y lo aprueba Diseño; ahí termina (migración
        // 20261001213000). Administración ya no lo recibe.
        permiso: ['diseno.planos', 'diseno.subir_pdf', 'supervision.general'],
        descripcion: 'Tareas de colaboradores y planos aprobados en Word',
        disponible: true,
      },
      // La hace la jefatura de Diseño y la recibe Administración; nadie más la
      // ve, ni Recursos Humanos (migración 20261001190000).
      {
        titulo: 'Evaluación de desempeño',
        ruta: '/diseno/evaluaciones',
        icono: ClipboardList,
        permiso: ['diseno.evaluar', 'administracion.recibir_evaluacion'],
        descripcion: 'La evaluación del personal de Diseño e Ingeniería, enviada a Administración',
        disponible: true,
      },
    ],
  },
  // El menú va por área, en el orden del circuito de materiales: Requerimientos
  // pide → Almacén revisa el stock → Logística compra → el conductor recoge →
  // Almacén recepciona y entrega. «Atención de requerimiento» es la misma
  // bandeja para Logística y Almacén, y por eso cuelga de las dos.
  {
    titulo: 'Requerimientos',
    items: [
      {
        titulo: 'Requerimientos',
        ruta: '/requerimientos',
        icono: ClipboardList,
        permiso: ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.ver'],
        descripcion: 'Lo que cada área necesita, con su número RQ, y por dónde va',
        disponible: true,
      },
      {
        titulo: 'Vehículos',
        ruta: '/vehiculos',
        icono: CarFront,
        permiso: ['vehiculos.registrar', 'vehiculos.ver'],
        descripcion: 'Ingreso y salida de vehículos de la planta, con sus fotos',
        disponible: true,
      },
      // Requerimientos pide por código interno y ve lo que se lleva gastado en
      // cada uno, sin la mano de obra (migración 20261015160000).
      {
        titulo: 'Gasto por código interno',
        ruta: '/requerimientos/gasto-por-codigo',
        icono: Coins,
        permiso: 'codigos_internos.gasto',
        descripcion: 'Lo que salió del almacén y lo que se compró para cada código interno',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Logística',
    items: [
      {
        titulo: 'Atención de requerimiento',
        ruta: '/requerimientos/atencion',
        icono: ClipboardList,
        permiso: 'compras.crear',
        descripcion: 'Lo que Almacén no tiene de cada RQ, para comprarlo, y en qué va',
        disponible: true,
      },
      {
        titulo: 'Órdenes de compra',
        ruta: '/compras/ordenes',
        icono: FileText,
        permiso: 'compras.crear',
        descripcion: 'Cada OC con su número: directas o de requerimiento, recojo y factura',
        disponible: true,
      },
      {
        titulo: 'Órdenes de servicio',
        ruta: '/compras/servicios',
        icono: Wrench,
        permiso: 'compras.crear',
        descripcion: 'Trabajos de terceros con su número OS, aprobación y conformidad',
        disponible: true,
      },
      // Quien aprueba es un puesto que Gerencia elige, no un permiso: si elige
      // otro, a ese puesto le llega el aviso con el enlace aunque no lo tenga
      // en el menú.
      {
        titulo: 'Aprobación de compras',
        ruta: '/compras/aprobacion',
        icono: BadgeCheck,
        permiso: ['compras.configurar_aprobacion', 'compras.crear'],
        descripcion: 'La regla de montos y las órdenes de compra y de servicio que esperan visto',
        disponible: true,
      },
      // El conductor de Logística: lo que tiene que recoger y dejar en almacén.
      // Logística lo sigue desde la misma pantalla, que ya la acepta.
      {
        titulo: 'Recojos',
        ruta: '/recojos',
        icono: Truck,
        permiso: ['compras.recojo', 'compras.crear'],
        descripcion: 'Compras aprobadas por recoger y dejar en almacén',
        disponible: true,
      },
      // Lo ven también Almacén, Costos y Supervisión (`proveedores.ver`), pero
      // en el menú solo de quienes llevan el padrón: Logística, Contabilidad y
      // Gerencia.
      {
        titulo: 'Proveedores',
        ruta: '/proveedores',
        icono: Building2,
        permiso: 'proveedores.editar',
        descripcion: 'El padrón del que se elige en la orden de compra',
        disponible: true,
      },
      {
        titulo: 'Compras agrupadas',
        ruta: '/compras',
        icono: Receipt,
        permiso: 'compras.crear',
        descripcion: 'Las compras por OT agrupadas por proveedor, con facturas y entregas',
        disponible: true,
      },
      // Logística fija el precio de lo que nunca se compró por el sistema.
      // Costos la consulta; Almacén también puede, pero no la necesita en su
      // menú. Administración ya no la ve (ver MENU_POR_PUESTO).
      {
        titulo: 'Valorización del almacén',
        ruta: '/compras/valorizacion',
        icono: Tag,
        permiso: ['almacen.valorizar', 'costos.ver'],
        descripcion: 'Precio de los consumibles y saldos sin compra',
        disponible: true,
      },
    ],
  },
  // Almacén: primero lo que espera por él, después su kardex y, debajo, los
  // cuatro almacenes que maneja (EPP, consumibles, accesorios y materia
  // prima): son el mismo kardex filtrado por `?almacen=`, con el valor en
  // mayúsculas que lee la pantalla de Almacén.
  {
    titulo: 'Almacén',
    items: [
      {
        titulo: 'Atención de requerimiento',
        ruta: '/requerimientos/atencion',
        icono: ClipboardList,
        permiso: ['almacen.recibir', 'almacen.despachar'],
        descripcion: 'Los RQ por revisar insumo por insumo, por recepcionar y por entregar al área',
        disponible: true,
      },
      {
        titulo: 'Kardex',
        ruta: '/almacen/kardex',
        icono: ListOrdered,
        permiso: 'almacen.ver',
        descripcion: 'Saldos, ingresos, egresos por unidad y conteo físico',
        disponible: true,
      },
      { titulo: 'EPP', ruta: '/almacen/kardex?almacen=EPP', icono: HardHat, permiso: 'almacen.ver', descripcion: 'Equipos de protección: salen con el formato de entrega firmado', disponible: true },
      { titulo: 'Consumibles', ruta: '/almacen/kardex?almacen=CONSUMIBLES', icono: Package, permiso: 'almacen.ver', descripcion: 'Discos, soldadura, pintura: salen sin más trámite', disponible: true },
      { titulo: 'Accesorios', ruta: '/almacen/kardex?almacen=ACCESORIOS', icono: Cog, permiso: 'almacen.ver', descripcion: 'Atados a un código interno: solo salen para esa unidad', disponible: true },
      { titulo: 'Materia prima', ruta: '/almacen/kardex?almacen=MATERIA_PRIMA', icono: Layers, permiso: 'almacen.ver', descripcion: 'Planchas, perfiles y tubos: salen con el formato de recepción firmado', disponible: true },
    ],
  },
  // El taller reporta: mientras la OT no está del todo en el sistema, cada
  // supervisor sube su día por código interno y sus horas van al costeo.
  {
    titulo: 'Supervisión',
    items: [
      {
        titulo: 'Reporte diario',
        ruta: '/reportes-diarios',
        icono: NotebookPen,
        permiso: ['reporte_diario.registrar', 'reporte_diario.ver'],
        descripcion: 'Trabajos del día con su avance, el personal con sus horas y fotos; Gerencia y RR. HH. lo validan',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Finanzas',
    items: [
      { titulo: 'Adquisiciones', ruta: '/adquisiciones', icono: Receipt, permiso: 'adquisiciones.ver', descripcion: 'Facturas, recibos y documentos de compras', disponible: true },
      {
        titulo: 'Tesorería',
        ruta: '/tesoreria',
        icono: Receipt,
        permiso: 'tesoreria.ver_documentos',
        descripcion: 'Cotizaciones liberadas y documentos de compras',
        disponible: true,
      },
      // La paga Tesorería; la arma RR. HH. (está también en su grupo, con su permiso).
      { titulo: 'Planilla diaria', ruta: '/planilla-diaria', icono: Banknote, permiso: 'planilla_diaria.pagar', descripcion: 'Pagar a cada persona a su cuenta, con comprobante y boleta', disponible: true },
      { titulo: 'Cuentas de Tesorería', ruta: '/tesoreria/cuentas', icono: FileSpreadsheet, permiso: 'tesoreria.ver_documentos', descripcion: 'Cobros por OT y pagos de compras', disponible: true },
      { titulo: 'Gastos del mes', ruta: '/costos/gastos-generales', icono: Wallet, permiso: ['costos.gastos_generales', 'costos.ver'], descripcion: 'Servicios del local y gastos de operación', disponible: true },
      { titulo: 'Tipo de cambio', ruta: '/tesoreria/tipo-de-cambio', icono: ArrowLeftRight, permiso: 'tesoreria.tipo_cambio', descripcion: 'El cambio del dólar de cada día, para el costo en soles', disponible: true },
    ],
  },
  // Recursos Humanos lleva la ficha del personal y su horario; la portería, con
  // una subcuenta de RR. HH., marca la asistencia desde el celular y de ahí
  // salen las tardanzas, que descuentan cada tres en el mes. Los permisos que
  // pide la gente se registran aquí y se justifican con sus horas extras
  // reservadas. Las planillas son suyas también: antes colgaban de Finanzas
  // con el nombre del área, y en el menú de RR. HH. se leía «Recursos
  // Humanos» dentro de «Recursos Humanos».
  {
    titulo: 'Recursos Humanos',
    items: [
      { titulo: 'Personal', ruta: '/rrhh/personal', icono: Users, permiso: ['rrhh.personal', 'asistencia.ver'], descripcion: 'La ficha de cada persona: datos, cuenta de pago y horario', disponible: true },
      { titulo: 'Asistencia', ruta: '/rrhh/asistencia', icono: ClipboardCheck, permiso: ['asistencia.marcar', 'asistencia.ver'], descripcion: 'Ingreso y salida de cada persona, marcados en portería', disponible: true },
      { titulo: 'Tardanzas', ruta: '/rrhh/tardanzas', icono: Clock, permiso: ['asistencia.ver', 'rrhh.personal'], descripcion: 'Tardanzas del mes: cada tres, un descuento del sueldo', disponible: true },
      { titulo: 'Permisos', ruta: '/rrhh/permisos', icono: CalendarClock, permiso: ['rrhh.permisos', 'asistencia.ver'], descripcion: 'Las horas de permiso de cada persona, justificadas con sus horas extras', disponible: true },
      { titulo: 'Horas extras', ruta: '/rrhh/horas-extras', icono: ClockAlert, permiso: ['planilla_diaria.preparar', 'planilla_diaria.ver'], descripcion: 'Lo que pasa de 8 horas al día: pagarlo o reservarlo', disponible: true },
      { titulo: 'Planilla diaria', ruta: '/planilla-diaria', icono: Banknote, permiso: ['planilla_diaria.preparar', 'planilla_diaria.ver'], descripcion: 'Las horas validadas que se pagan, enviadas a Tesorería', disponible: true },
      { titulo: 'Costeo por código', ruta: '/rrhh/costeo', icono: Calculator, permiso: 'rrhh.personal', descripcion: 'Horas de cada persona por código interno y lo que cuestan', disponible: true },
      { titulo: 'Observaciones', ruta: '/rrhh/observaciones', icono: MessageSquareWarning, permiso: ['rrhh.personal', 'asistencia.ver'], descripcion: 'Observaciones, amonestaciones y suspensiones del personal', disponible: true },
      { titulo: 'Planillas', ruta: '/rrhh', icono: UserCog, permiso: 'rrhh.ver_planillas', descripcion: 'Planillas del mes y su distribución por unidad', disponible: true },
    ],
  },
  {
    titulo: 'Ventas',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', descripcion: 'Empresas y personas, con sus contactos y sus órdenes', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', descripcion: 'Los vehículos de los clientes que pasan por el taller', disponible: true },
      { titulo: 'Carrocerías', ruta: '/carrocerias', icono: Layers, permiso: ['diseno.planos', 'configuracion.ver', 'cotizaciones.crear'], descripcion: 'Los tipos de carrocería que se cotizan, con su ficha técnica', disponible: true },
    ],
  },
  {
    titulo: 'Administración del sistema',
    items: [
      {
        titulo: 'Personal',
        ruta: '/personal',
        icono: UserCog,
        permiso: ['usuarios.gestionar', 'usuarios.ver'],
        descripcion: 'Altas, puestos y accesos',
        disponible: true,
      },
      {
        titulo: 'Configuración',
        ruta: '/configuracion',
        icono: Settings,
        permiso: 'configuracion.ver',
        descripcion: 'Calendario laboral y catálogos del taller',
        disponible: true,
      },
    ],
  },
] as const satisfies readonly GrupoNavegacion[]

/** El catálogo tal cual, para recorrerlo sin los tipos literales de `as const`. */
const GRUPOS: readonly GrupoNavegacion[] = NAVEGACION
const CATALOGO: readonly ItemNavegacion[] = GRUPOS.flatMap((g) => g.items)

/** Las rutas que el catálogo conoce: un menú que nombre otra no compila. */
type RutaDeModulo = (typeof NAVEGACION)[number]['items'][number]['ruta']

type MenuDePuesto = {
  grupos: readonly { titulo: string; rutas: readonly RutaDeModulo[] }[]
  /** Las pestañas de abajo en el teléfono, en orden: van las cuatro primeras que la persona ve. */
  telefono: readonly RutaDeModulo[]
}

/**
 * El menú de cada puesto: primero lo que espera por él, en el orden en que lo
 * trabaja, y al final lo que solo consulta. El tablero va siempre arriba.
 *
 * Salió de entrar con cada cuenta de producción el 2026-10-14. Hasta entonces
 * el menú era el catálogo filtrado por permiso, y cada permiso de lectura
 * colgaba una pantalla ajena bajo el nombre del área que la lleva: a
 * Requerimientos le salían los cuatro almacenes de Almacén y «Logística ›
 * Valorización», a Contabilidad «Logística › Proveedores». En el teléfono las
 * pestañas salían de un mismo orden para todos, y a Requerimientos le tocaban
 * Kardex, Gastos y Precios en vez de su lista de RQ.
 *
 * Cada entrada se sigue mostrando solo si el permiso del catálogo la deja ver:
 * si la base le quita el permiso a un puesto, la entrada desaparece en lugar de
 * llevar a «Sin permiso». Y el menú no es el límite de acceso: lo que un puesto
 * no tiene aquí lo abre por su dirección si su permiso lo deja, y lo que su
 * permiso no deja lo rechazan la pantalla y el RLS.
 *
 * **Pantalla nueva: sumarla aquí al menú del puesto que la usa.** No entra
 * sola; solo ADMIN y los puestos sin menú propio ven el catálogo completo.
 */
const MENU_POR_PUESTO: Record<string, MenuDePuesto> = {
  // El circuito del requerimiento: Requerimientos pide → Almacén revisa el
  // stock → Logística compra → Gerencia aprueba → el conductor recoge →
  // Almacén recepciona y entrega → Supervisión lo recoge.
  // Desde el 2026-10-15 ya no ve el kardex, los gastos del mes ni la
  // valorización del almacén (la base le quitó almacen.ver y costos.ver): ve lo
  // gastado en cada código interno. La OT la consulta porque de ahí manda la
  // ficha vehicular y el pedido de pago a Tesorería.
  REQUERIMIENTOS: {
    grupos: [
      { titulo: 'Requerimientos', rutas: ['/requerimientos', '/vehiculos', '/requerimientos/gasto-por-codigo'] },
      { titulo: 'Consultas', rutas: ['/ordenes'] },
    ],
    telefono: ['/requerimientos', '/vehiculos', '/requerimientos/gasto-por-codigo', '/ordenes'],
  },
  // Trabaja los RQ desde su bandeja de atención, no desde la lista de
  // Requerimientos, aunque `requerimientos.ver` le deje leerla. Las órdenes de
  // trabajo también esperan por él: los materiales de cada OT los revisa,
  // recibe y despacha ahí. Debajo del kardex, sus cuatro almacenes.
  ALMACENERO: {
    grupos: [
      {
        titulo: 'Almacén',
        rutas: [
          '/requerimientos/atencion',
          '/ordenes',
          '/almacen/kardex',
          '/almacen/kardex?almacen=EPP',
          '/almacen/kardex?almacen=CONSUMIBLES',
          '/almacen/kardex?almacen=ACCESORIOS',
          '/almacen/kardex?almacen=MATERIA_PRIMA',
        ],
      },
    ],
    telefono: ['/requerimientos/atencion', '/ordenes', '/almacen/kardex', '/'],
  },
  // Del RQ sin stock a la OC, su visto de Gerencia y el recojo del conductor,
  // que Logística sigue desde «Recojos» (la pantalla ya le mostraba lo que el
  // conductor tiene por recoger, pero no estaba en su menú).
  COMPRADOR: {
    grupos: [
      {
        titulo: 'Logística',
        rutas: [
          '/requerimientos/atencion',
          '/compras/ordenes',
          '/compras/aprobacion',
          '/recojos',
          '/compras/servicios',
          '/compras',
          '/proveedores',
          '/compras/valorizacion',
        ],
      },
      { titulo: 'Consultas', rutas: ['/ordenes'] },
    ],
    telefono: ['/requerimientos/atencion', '/compras/ordenes', '/compras/aprobacion', '/recojos'],
  },
  CONDUCTOR: {
    grupos: [{ titulo: 'Logística', rutas: ['/recojos'] }],
    telefono: ['/recojos', '/'],
  },
  // Cerrado desde #28: lo que Gerencia decide y poco más. Lo demás que su
  // permiso le deja ver (Requerimientos, el kardex, Personal) lo abre desde el
  // enlace del aviso o por su dirección.
  // Los reportes diarios esperan su visto bueno: pasaron de Consultas a su trabajo.
  // Los códigos internos van junto a ellos y, en el teléfono, en lugar de las OT:
  // el taller trabaja por código mientras la OT no está del todo en el sistema.
  GERENTE: {
    grupos: [
      { titulo: 'Gerencia', rutas: ['/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios', '/codigos-internos', '/ordenes'] },
      { titulo: 'Consultas', rutas: ['/planilla-diaria', '/rrhh/horas-extras', '/proveedores', '/rrhh/tardanzas', '/rrhh/observaciones'] },
    ],
    telefono: ['/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios', '/codigos-internos'],
  },
  // Cerrado desde #28, como Gerencia.
  // La planilla diaria espera su pago: va primero.
  TESORERIA: {
    grupos: [
      { titulo: 'Finanzas', rutas: ['/planilla-diaria', '/tesoreria', '/tesoreria/cuentas', '/tesoreria/tipo-de-cambio', '/adquisiciones'] },
      { titulo: 'Consultas', rutas: ['/ordenes'] },
    ],
    telefono: ['/planilla-diaria', '/tesoreria', '/tesoreria/cuentas', '/adquisiciones'],
  },
  CONTABILIDAD: {
    grupos: [
      { titulo: 'Contabilidad', rutas: ['/adquisiciones', '/proveedores', '/tesoreria/tipo-de-cambio'] },
      { titulo: 'Consultas', rutas: ['/ordenes', '/requerimientos'] },
    ],
    telefono: ['/adquisiciones', '/proveedores', '/tesoreria/tipo-de-cambio', '/ordenes'],
  },
  // Unidades y Carrocerías las lleva Diseño e Ingeniería (pedido de la
  // empresa, 2026-10-01). Configuración la alcanza por `configuracion.ver`,
  // pero es de Administración.
  DISENO: {
    grupos: [
      {
        titulo: 'Diseño e Ingeniería',
        rutas: ['/ordenes', '/materiales', '/carrocerias', '/unidades', '/diseno/informe-semanal', '/diseno/evaluaciones'],
      },
      { titulo: 'Consultas', rutas: ['/clientes', '/requerimientos'] },
    ],
    telefono: ['/ordenes', '/diseno/informe-semanal', '/materiales', '/carrocerias'],
  },
  DISENO_COLABORADOR: {
    grupos: [{ titulo: 'Diseño e Ingeniería', rutas: ['/diseno/informe-semanal', '/ordenes'] }],
    telefono: ['/diseno/informe-semanal', '/ordenes', '/'],
  },
  // Administración lee clientes, unidades, catálogos y costos porque carga la
  // OT y ve su costo; pero la valorización es de Logística (la pantalla
  // también la rechaza) y Unidades y Carrocerías las lleva Diseño. De RR. HH.
  // le toca el resumen de tardanzas, como a Gerencia: la ficha y la asistencia
  // las abre por su dirección, y así no tiene dos «Personal» en el menú.
  // Desde el 2026-10-15 lleva el requerimiento de Administración (lo de
  // oficina): lo registra, Almacén lo revisa y ella hace la OC de lo que falta.
  ADMINISTRACION: {
    grupos: [
      {
        titulo: 'Administración',
        rutas: ['/cotizaciones/pdf', '/ordenes', '/costos/gastos-generales', '/tesoreria/tipo-de-cambio', '/diseno/evaluaciones', '/clientes'],
      },
      { titulo: 'Requerimiento de Administración', rutas: ['/requerimientos', '/requerimientos/atencion', '/compras/ordenes'] },
      { titulo: 'Consultas', rutas: ['/rrhh/tardanzas', '/rrhh/observaciones', '/vehiculos'] },
      { titulo: 'Administración del sistema', rutas: ['/personal', '/configuracion'] },
    ],
    telefono: ['/cotizaciones/pdf', '/ordenes', '/costos/gastos-generales', '/diseno/evaluaciones'],
  },
  // Primero lo que espera por RR. HH.: los reportes diarios por validar, las
  // horas extras por decidir y la planilla diaria por enviar.
  RECURSOS_HUMANOS: {
    grupos: [
      {
        titulo: 'Recursos Humanos',
        rutas: [
          '/reportes-diarios',
          '/rrhh/horas-extras',
          '/planilla-diaria',
          '/rrhh/personal',
          '/rrhh/asistencia',
          '/rrhh/tardanzas',
          '/rrhh/permisos',
          '/rrhh/costeo',
          '/rrhh/observaciones',
          '/rrhh',
        ],
      },
      { titulo: 'Consultas', rutas: ['/ordenes'] },
    ],
    telefono: ['/reportes-diarios', '/planilla-diaria', '/rrhh/personal', '/rrhh/asistencia'],
  },
  PORTERO: {
    grupos: [{ titulo: 'Portería', rutas: ['/rrhh/asistencia'] }],
    telefono: ['/rrhh/asistencia', '/'],
  },
  // Sube su reporte diario (mientras la OT no está del todo en el sistema, es
  // su trabajo de cada día), reporta el avance de las OT de su área y recoge de
  // Almacén lo que su área pidió: el RQ «Listo en almacén», al que también lo
  // lleva el aviso.
  SUPERVISOR: {
    grupos: [{ titulo: 'Supervisión', rutas: ['/reportes-diarios', '/ordenes', '/requerimientos'] }],
    telefono: ['/reportes-diarios', '/ordenes', '/requerimientos', '/'],
  },
  // Mira todas las áreas sin trabajar en ninguna: cada una con su nombre.
  SUPERVISOR_GENERAL: {
    grupos: [
      { titulo: 'Supervisión general', rutas: ['/ordenes', '/diseno/informe-semanal'] },
      { titulo: 'Requerimientos', rutas: ['/requerimientos', '/vehiculos'] },
      {
        titulo: 'Almacén',
        rutas: [
          '/almacen/kardex',
          '/almacen/kardex?almacen=EPP',
          '/almacen/kardex?almacen=CONSUMIBLES',
          '/almacen/kardex?almacen=ACCESORIOS',
          '/almacen/kardex?almacen=MATERIA_PRIMA',
          '/compras/valorizacion',
        ],
      },
      { titulo: 'Ventas', rutas: ['/cotizaciones/pdf', '/clientes', '/unidades'] },
      { titulo: 'Finanzas', rutas: ['/costos/gastos-generales'] },
    ],
    telefono: ['/ordenes', '/requerimientos', '/almacen/kardex', '/cotizaciones/pdf'],
  },
  VENDEDOR: {
    grupos: [{ titulo: 'Ventas', rutas: ['/cotizaciones/pdf', '/clientes', '/unidades', '/carrocerias'] }],
    telefono: ['/cotizaciones/pdf', '/clientes', '/unidades', '/'],
  },
}

function lePermite(item: ItemNavegacion, permisos: readonly string[], esAdmin: boolean) {
  if (!item.permiso || esAdmin) return true
  const pide: readonly string[] = typeof item.permiso === 'string' ? [item.permiso] : item.permiso
  return pide.some((p) => permisos.includes(p))
}

/**
 * El menú de esta persona, por grupos: el de su puesto si lo tiene; si no, el
 * catálogo entero filtrado por su permiso. Lo usan la barra del monitor, el
 * cajón del teléfono y «Tus módulos» del tablero, así que los tres dicen lo
 * mismo.
 */
export function menuDe(permisos: readonly string[], esAdmin: boolean, rolCodigo: string): GrupoNavegacion[] {
  const propio = esAdmin ? undefined : MENU_POR_PUESTO[rolCodigo]
  const grupos: GrupoNavegacion[] = propio
    ? [{ titulo: 'Principal', rutas: ['/'] }, ...propio.grupos].map((g) => ({
        titulo: g.titulo,
        // Una pantalla compartida está en el catálogo una vez por cada área que
        // la usa, con el permiso de esa área: vale la que esta persona ve.
        items: g.rutas.flatMap((r) => CATALOGO.find((i) => i.ruta === r && i.disponible && lePermite(i, permisos, esAdmin)) ?? []),
      }))
    : GRUPOS.map((g) => ({ titulo: g.titulo, items: g.items.filter((i) => i.disponible && lePermite(i, permisos, esAdmin)) }))
  return grupos.filter((g) => g.items.length > 0)
}

/**
 * Las pestañas de abajo en el teléfono: hasta cuatro, sacadas del menú de esta
 * persona en el orden que fija su puesto, y después «Más».
 */
export function pestanasDe(permisos: readonly string[], esAdmin: boolean, rolCodigo: string) {
  const visibles = menuDe(permisos, esAdmin, rolCodigo).flatMap((g) => g.items)
  const propio = esAdmin ? undefined : MENU_POR_PUESTO[rolCodigo]
  const orden: readonly string[] = propio ? propio.telefono : PESTANAS_TELEFONO.map((p) => p.ruta)
  return orden
    .flatMap((ruta) => {
      const item = visibles.find((i) => i.ruta === ruta)
      if (!item) return []
      return [{ ruta, corto: PESTANAS_TELEFONO.find((p) => p.ruta === ruta)?.corto ?? item.titulo, icono: item.icono }]
    })
    .slice(0, 4)
}

/**
 * Cuál de los módulos es el que se está mirando: gana el de ruta más larga que
 * encaje y comparando por segmento, así `/cotizaciones-viejas` no encaja en
 * `/cotizaciones`.
 */
export function rutaActiva(ruta: string, rutas: string[]) {
  const encaja = (base: string) =>
    base === '/' ? ruta === '/' : ruta === base || ruta.startsWith(`${base}/`)
  return rutas.filter(encaja).sort((a, b) => b.length - a.length)[0]
}

/**
 * El nombre corto de cada pestaña del teléfono, que es angosta. Para ADMIN y
 * los puestos sin menú propio, también el orden: las cuatro primeras de esta
 * lista que la persona ve, y después «Más». Los puestos con menú propio llevan
 * su orden en `MENU_POR_PUESTO`.
 */
export const PESTANAS_TELEFONO: { ruta: RutaDeModulo; corto: string }[] = [
  { ruta: '/cotizaciones/pdf', corto: 'Cotizar' },
  { ruta: '/ordenes', corto: 'Órdenes' },
  { ruta: '/almacen/kardex', corto: 'Kardex' },
  { ruta: '/diseno/informe-semanal', corto: 'Informe' },
  { ruta: '/diseno/evaluaciones', corto: 'Evaluación' },
  { ruta: '/tesoreria', corto: 'Tesorería' },
  { ruta: '/tesoreria/cuentas', corto: 'Cuentas' },
  { ruta: '/adquisiciones', corto: 'Facturas' },
  { ruta: '/rrhh', corto: 'Planillas' },
  { ruta: '/costos/gastos-generales', corto: 'Gastos' },
  { ruta: '/compras/valorizacion', corto: 'Precios' },
  { ruta: '/clientes', corto: 'Clientes' },
  { ruta: '/', corto: 'Tablero' },
  { ruta: '/unidades', corto: 'Unidades' },
  { ruta: '/carrocerias', corto: 'Carrocerías' },
  { ruta: '/materiales', corto: 'Materiales' },
  { ruta: '/configuracion', corto: 'Ajustes' },
  { ruta: '/personal', corto: 'Personal' },
  { ruta: '/recojos', corto: 'Recojos' },
  { ruta: '/compras/ordenes', corto: 'OC' },
  { ruta: '/compras/aprobacion', corto: 'Aprobar' },
  { ruta: '/requerimientos', corto: 'RQ' },
  { ruta: '/requerimientos/atencion', corto: 'Atención' },
  { ruta: '/vehiculos', corto: 'Vehículos' },
  { ruta: '/requerimientos/gasto-por-codigo', corto: 'Gasto' },
  { ruta: '/rrhh/asistencia', corto: 'Asistencia' },
  { ruta: '/rrhh/personal', corto: 'Personal' },
  { ruta: '/rrhh/tardanzas', corto: 'Tardanzas' },
  { ruta: '/rrhh/permisos', corto: 'Permisos' },
  { ruta: '/rrhh/costeo', corto: 'Costeo' },
  { ruta: '/rrhh/observaciones', corto: 'Observaciones' },
  { ruta: '/reportes-diarios', corto: 'Reporte' },
  { ruta: '/codigos-internos', corto: 'Códigos' },
  { ruta: '/planilla-diaria', corto: 'Planilla' },
  { ruta: '/rrhh/horas-extras', corto: 'Extras' },
  { ruta: '/tesoreria/tipo-de-cambio', corto: 'Cambio' },
  { ruta: '/proveedores', corto: 'Proveedores' },
]
