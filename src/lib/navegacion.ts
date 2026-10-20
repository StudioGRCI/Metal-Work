import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Calculator,
  Building2,
  CalendarClock,
  CalendarRange,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ClockAlert,
  Coins,
  CreditCard,
  DraftingCompass,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Handshake,
  Hash,
  Landmark,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  MessageSquareWarning,
  NotebookPen,
  Receipt,
  ReceiptText,
  Route,
  Settings,
  Tag,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
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
 * El catálogo de módulos, agrupado por el área que los lleva y con las áreas en
 * el orden del circuito: Ventas cotiza → Gerencia aprueba → Diseño desglosa →
 * Requerimientos pide → Almacén revisa → Logística compra → el taller reporta →
 * Finanzas y RR. HH. pagan.
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
        titulo: 'Dashboard',
        ruta: '/',
        icono: LayoutDashboard,
        descripcion: 'Las cifras de tu área y tus módulos a un toque',
        disponible: true,
      },
      // Lo que se trabaja hoy va por código interno, no por OT: Gerencia ve cada
      // código con sus reportes de avance y su costeo (migración 20261014220000).
      // Por eso va antes que la OT.
      {
        titulo: 'Códigos internos',
        ruta: '/codigos-internos',
        icono: Hash,
        permiso: 'codigos_internos.ver',
        descripcion: 'Cada código con sus etapas, planos, materiales, avance y lo que lleva costado',
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
    ],
  },
  // Ventas abre el circuito: la cotización y, con ella, el cliente, su unidad y
  // la carrocería que se le cotiza. Antes eran dos grupos, «Agente de Ventas»
  // arriba y «Ventas» casi al final.
  {
    titulo: 'Ventas',
    items: [
      {
        titulo: 'Cotización',
        ruta: '/cotizaciones/pdf',
        icono: FileText,
        permiso: ['cotizaciones.ver_pdf_comercial', 'cotizaciones.ver_aprobadas', 'tesoreria.ver_documentos'],
        descripcion: 'El PDF que se le mandó al cliente, y su visto de Gerencia',
        disponible: true,
      },
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', descripcion: 'Empresas y personas, con sus contactos y sus órdenes', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', descripcion: 'Los vehículos de los clientes que pasan por el taller', disponible: true },
      { titulo: 'Carrocerías', ruta: '/carrocerias', icono: Layers, permiso: ['diseno.planos', 'configuracion.ver', 'cotizaciones.crear'], descripcion: 'Los tipos de carrocería que se cotizan, con su ficha técnica', disponible: true },
    ],
  },
  {
    titulo: 'Diseño e Ingeniería',
    items: [
      // Sin módulo de OT, Diseño carga por el código interno de la unidad lo
      // que cargaba en la orden (migración 20261015200000): los planos de cada
      // área, la lista de materiales y las etapas. Gerencia lo ve en Códigos
      // internos; el supervisor, en «Planos y etapas».
      {
        titulo: 'Planos',
        ruta: '/diseno/planos',
        icono: DraftingCompass,
        permiso: 'diseno.codigos',
        descripcion: 'Los planos de cada unidad por código interno, con el área de producción a la que va cada uno',
        disponible: true,
      },
      {
        titulo: 'Gestión de materiales',
        ruta: '/diseno/materiales',
        icono: ListChecks,
        permiso: 'diseno.codigos',
        descripcion: 'Lo que lleva cada unidad según Diseño, contra lo comprado y lo salido del almacén',
        disponible: true,
      },
      {
        titulo: 'Control de etapas',
        ruta: '/diseno/etapas',
        icono: CalendarRange,
        permiso: 'diseno.codigos',
        descripcion: 'Las etapas de cada unidad con su fecha comprometida y cómo van',
        disponible: true,
      },
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
  // bandeja para Logística y Almacén, y por eso cuelga de las dos; a ADMIN, que
  // ve el catálogo entero, le sale una vez, en Almacén, que la revisa primero.
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
  // Almacén: primero lo que espera por él y después su kardex. Los cuatro
  // almacenes (EPP, consumibles, accesorios y materia prima) ya no van en el
  // menú desde el 2026-10-15, a pedido de DKS: se abren desde el tablero de
  // arriba del kardex, que es el mismo kardex filtrado por `?almacen=`.
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
      // Sin la OT desde el 2026-10-15 (migración 20261016110000): lo que lleva
      // cada unidad según Diseño contra lo pedido y lo salido, para tener a
      // tiempo su material. Es «Seguimiento por código» abierto en Materiales.
      {
        titulo: 'Materiales por código',
        ruta: '/seguimiento?vista=materiales',
        icono: ListChecks,
        permiso: 'codigos_internos.seguimiento',
        descripcion: 'Lo que lleva cada unidad según Diseño, contra lo pedido por RQ, lo comprado y lo salido del almacén',
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
        descripcion: 'Trabajos de terceros con su número OS, código interno, detracción, aprobación y conformidad',
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
      // Logística decide qué OC recoge el conductor, en qué orden y con qué
      // peso; Contabilidad emite con ese peso la guía de remisión y la carga en
      // la misma pantalla (está también en Finanzas, con su permiso).
      {
        titulo: 'Gestión de compras',
        ruta: '/compras/gestion',
        icono: Route,
        permiso: 'compras.crear',
        descripcion: 'Qué órdenes de compra recoge el conductor, en qué orden y con qué peso',
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
      // en el menú solo de quienes llevan el padrón: Logística y Contabilidad.
      // Gerencia también lo edita, pero desde el 2026-10-15 no lo tiene en su
      // menú: lo abre por su dirección.
      {
        titulo: 'Proveedores',
        ruta: '/proveedores',
        icono: Building2,
        permiso: 'proveedores.editar',
        descripcion: 'El padrón del que se elige en la orden de compra',
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
      {
        titulo: 'Planos y etapas',
        ruta: '/planos',
        icono: DraftingCompass,
        permiso: 'codigos_internos.area',
        descripcion: 'Los planos que Diseño cargó para tu área, para marcarlos recibidos, y las etapas de tu área',
        disponible: true,
      },
      // Maestranza pidió el 2026-10-15 ver lo que Almacén tiene antes de
      // pedirlo: el stock de cada material, sin precios ni el kardex
      // (migración 20261016950000). Almacén también la abre, pero lo suyo es el
      // kardex.
      {
        titulo: 'Stock en almacén',
        ruta: '/almacen/stock',
        icono: Warehouse,
        permiso: 'almacen.stock',
        descripcion: 'Cuánto hay de cada material en los cuatro almacenes, y de qué código interno es cada accesorio',
        disponible: true,
      },
      // Los subcontratos que Administración registró para Maestranza, Producción o
      // Acabados (migraciones 20261017100000 y 20261020160000): el supervisor de esa
      // área los ve sin montos, con su inicio, su fin y el avance que reporta.
      {
        titulo: 'Subcontratos',
        ruta: '/subcontratos/area',
        icono: Handshake,
        permiso: 'subcontratos.area',
        descripcion: 'Los trabajos de terceros para tu área, por código interno: su inicio, su fin y el avance que reportas; sin montos',
        disponible: true,
      },
      // Supervisión general sigue todas las áreas sin la OT (2026-10-15): lo que
      // Diseño lleva en cada código, en solo lectura.
      {
        titulo: 'Seguimiento por código',
        ruta: '/seguimiento',
        icono: Hash,
        permiso: 'codigos_internos.seguimiento',
        descripcion: 'Cada unidad por su código interno: etapas con su avance, materiales contra lo pedido y lo salido, y planos de cada área',
        disponible: true,
      },
    ],
  },
  // Los trabajos que se le encargan a una persona de fuera, por código interno:
  // Administración los registra y sube sus recibos por honorarios, que paga
  // Tesorería (está en Finanzas, con su permiso).
  {
    titulo: 'Administración',
    items: [
      {
        titulo: 'Subcontratos',
        ruta: '/subcontratos',
        icono: Handshake,
        permiso: ['subcontratos.gestionar', 'subcontratos.ver'],
        descripcion: 'Trabajos encargados a terceros por código interno, con sus recibos por honorarios y su pago',
        disponible: true,
      },
    ],
  },
  // La factura de venta cuelga del código interno (migración 20261015124000):
  // Contabilidad registra la factura de la cotización aprobada y Tesorería la
  // cobra con su voucher. Tesorería trabaja en cuatro: Adquisiciones (todo lo
  // comprado, por factura), Cuentas por cobrar, Cuentas por pagar y Pagos de
  // servicio.
  {
    titulo: 'Finanzas',
    items: [
      { titulo: 'Facturación', ruta: '/contabilidad/facturacion', icono: ReceiptText, permiso: 'contabilidad.facturar', descripcion: 'Las cotizaciones aprobadas, por código interno: registrar su factura', disponible: true },
      {
        titulo: 'Gestión de compras',
        ruta: '/compras/gestion',
        icono: Route,
        permiso: 'compras.guia_remision',
        descripcion: 'Las OC que recoge el conductor, con su peso: cargar su guía de remisión',
        disponible: true,
      },
      // Contabilidad responde por la detracción de cada orden de servicio.
      {
        titulo: 'Órdenes de servicio',
        ruta: '/compras/servicios',
        icono: Wrench,
        permiso: 'compras.detraccion',
        descripcion: 'Si cada orden de servicio lleva detracción y de qué tipo según SUNAT',
        disponible: true,
      },
      { titulo: 'Adquisiciones', ruta: '/adquisiciones', icono: Receipt, permiso: 'adquisiciones.ver', descripcion: 'Todo lo comprado, por factura: cada factura con sus OC y si calza con ellas', disponible: true },
      { titulo: 'Cuentas por cobrar', ruta: '/tesoreria/por-cobrar', icono: HandCoins, permiso: 'tesoreria.ver_documentos', descripcion: 'Las facturas de venta por código interno, cobradas con su voucher', disponible: true },
      { titulo: 'Cuentas por pagar', ruta: '/tesoreria/por-pagar', icono: CreditCard, permiso: 'tesoreria.ver_documentos', descripcion: 'Las facturas de compra, al contado o a crédito, pagadas con su voucher', disponible: true },
      { titulo: 'Pagos de servicio', ruta: '/tesoreria/pagos-de-servicio', icono: Wrench, permiso: ['tesoreria.pagar_servicios', 'tesoreria.ver_documentos'], descripcion: 'Las órdenes de servicio aprobadas, pagadas al proveedor con su voucher', disponible: true },
      // La paga Tesorería; la arma RR. HH. (está también en su grupo, con su permiso).
      { titulo: 'Planilla diaria', ruta: '/planilla-diaria', icono: Banknote, permiso: 'planilla_diaria.pagar', descripcion: 'Pagar a cada persona a su cuenta, con comprobante y boleta', disponible: true },
      // Los sube Administración contra cada subcontrato; Contabilidad los consulta por la retención.
      {
        titulo: 'Recibos por honorarios',
        ruta: '/tesoreria/recibos-por-honorarios',
        icono: ReceiptText,
        permiso: ['subcontratos.pagar', 'subcontratos.ver'],
        descripcion: 'Pagar los recibos de los subcontratos a la cuenta del subcontratista, con su voucher',
        disponible: true,
      },
      // Donde termina cada pago y cada cobro: el saldo de cada cuenta día por día,
      // con el cierre contra el estado de cuenta (migración 20261017200000).
      {
        titulo: 'Caja diaria',
        ruta: '/tesoreria/caja-diaria',
        icono: Landmark,
        permiso: 'tesoreria.caja',
        descripcion: 'El saldo de cada cuenta día por día: ingresos, egresos y el cierre contra el estado de cuenta',
        disponible: true,
      },
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
      { titulo: 'Pagos de la oficina', ruta: '/rrhh/pagos-oficina', icono: Wallet, permiso: 'rrhh.personal', descripcion: 'Lo que se le paga a cada persona de la oficina, semana, quincena o mes', disponible: true },
      { titulo: 'Observaciones', ruta: '/rrhh/observaciones', icono: MessageSquareWarning, permiso: ['rrhh.personal', 'asistencia.ver'], descripcion: 'Observaciones, amonestaciones y suspensiones del personal', disponible: true },
      { titulo: 'Planillas', ruta: '/rrhh', icono: UserCog, permiso: 'rrhh.ver_planillas', descripcion: 'Planillas del mes y su distribución por unidad', disponible: true },
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
  /** Lo que va arriba de todo, junto al dashboard y en su mismo grupo. */
  principal?: readonly RutaDeModulo[]
  grupos: readonly { titulo: string; rutas: readonly RutaDeModulo[] }[]
  /** Las pestañas de abajo en el teléfono, en orden: van las cuatro primeras que la persona ve. */
  telefono: readonly RutaDeModulo[]
}

/**
 * El menú de cada puesto, por importancia: arriba lo que espera por él cada
 * día (lo que, si no lo hace, traba a otra área), en el orden en que lo
 * trabaja; después lo que lleva o registra sin apuro; al final lo que solo
 * consulta. El dashboard va siempre arriba. Un puesto con muchas pantallas las
 * reparte en grupos con nombre, para no leer una lista de diez.
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
  // gastado en cada código interno. Sin la OT desde el 2026-10-15: la ficha de
  // ingreso y salida del vehículo y la revisión de Tesorería para la salida van
  // en Vehículos.
  REQUERIMIENTOS: {
    grupos: [
      { titulo: 'Requerimientos', rutas: ['/requerimientos', '/vehiculos'] },
      { titulo: 'Consultas', rutas: ['/requerimientos/gasto-por-codigo'] },
    ],
    telefono: ['/requerimientos', '/vehiculos', '/requerimientos/gasto-por-codigo', '/'],
  },
  // Trabaja los RQ desde su bandeja de atención, no desde la lista de
  // Requerimientos, aunque `requerimientos.ver` le deje leerla. Sin la OT desde
  // el 2026-10-15: lo que lleva cada unidad lo ve por código, para tenerlo a
  // tiempo. Aparte, el kardex: sus cuatro almacenes se abren desde su tablero,
  // no desde el menú (2026-10-15).
  ALMACENERO: {
    grupos: [
      { titulo: 'Por atender', rutas: ['/requerimientos/atencion', '/seguimiento?vista=materiales'] },
      { titulo: 'Almacén', rutas: ['/almacen/kardex'] },
    ],
    telefono: ['/requerimientos/atencion', '/seguimiento?vista=materiales', '/almacen/kardex', '/'],
  },
  // En el orden que DKS fijó el 2026-10-15: después del dashboard, la atención
  // del RQ sin stock, la gestión de compras (qué recoge el conductor, en qué
  // orden y con qué peso) y las órdenes de compra y de servicio. Lo demás lo
  // consulta. «Recojos» la abre por su dirección: la gestión ya muestra todo lo
  // que el conductor lleva. Sin «Compras agrupadas» desde el 2026-10-15: eran
  // las compras por OT, y la OT ya no se usa.
  COMPRADOR: {
    grupos: [
      {
        titulo: 'Logística',
        rutas: ['/requerimientos/atencion', '/compras/gestion', '/compras/ordenes', '/compras/servicios'],
      },
      // Las tres que DKS nombró el 2026-10-15, en su orden. Adquisiciones, en
      // lectura: qué OC ya tienen su factura y si calza. «Aprobación de
      // compras» sale del menú: el visto de cada OC se ve en Órdenes de compra.
      { titulo: 'Consultas', rutas: ['/adquisiciones', '/proveedores', '/compras/valorizacion'] },
    ],
    telefono: ['/requerimientos/atencion', '/compras/gestion', '/compras/ordenes', '/compras/servicios'],
  },
  CONDUCTOR: {
    grupos: [{ titulo: 'Logística', rutas: ['/recojos'] }],
    telefono: ['/recojos', '/'],
  },
  // Cerrado desde #28: lo que Gerencia decide y poco más. Lo demás que su
  // permiso le deja ver (Requerimientos, el kardex, Personal) lo abre desde el
  // enlace del aviso o por su dirección.
  // Como lo pidió Gerencia el 2026-10-15: Códigos internos va segundo, justo
  // después del dashboard (el código es el centro de todo lo que se hace para
  // una unidad; la OT ya no está). Después lo que espera su visto, en el orden
  // del circuito, y lo que consulta de Tesorería: lo que se cobra y lo que se
  // paga, sin registrar cobros ni pagos. La planilla diaria, las horas extras,
  // los subcontratos, las tardanzas, las observaciones y los proveedores
  // salieron de su menú ese día: su permiso sigue, y los abre por su dirección.
  GERENTE: {
    principal: ['/codigos-internos'],
    grupos: [
      { titulo: 'Por aprobar', rutas: ['/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios'] },
      { titulo: 'Consultas', rutas: ['/tesoreria/por-cobrar', '/tesoreria/por-pagar', '/costos/gastos-generales'] },
    ],
    telefono: ['/codigos-internos', '/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios'],
  },
  // Cerrado desde #28, como Gerencia.
  // Primero la caja diaria, con la que abre y cierra cada día (2026-10-16).
  // Después sus cuatro, en el orden en que Gerencia las nombró el 2026-10-14:
  // Adquisiciones, Cuentas por cobrar, Cuentas por pagar y Pagos de servicio.
  // Después los otros pagos que esperan por ella (los recibos por honorarios de
  // los subcontratos y la planilla diaria) y el tipo de cambio. Consulta la
  // cotización aprobada; la OT ya no (2026-10-15).
  TESORERIA: {
    grupos: [
      {
        titulo: 'Tesorería',
        rutas: [
          '/tesoreria/caja-diaria',
          '/adquisiciones',
          '/tesoreria/por-cobrar',
          '/tesoreria/por-pagar',
          '/tesoreria/pagos-de-servicio',
          '/tesoreria/recibos-por-honorarios',
          '/planilla-diaria',
          '/tesoreria/tipo-de-cambio',
        ],
      },
      { titulo: 'Consultas', rutas: ['/cotizaciones/pdf'] },
    ],
    // En el teléfono también va primero la caja, con la que abre y cierra el día; los pagos de servicio pasan a «Más» (2026-10-17).
    telefono: ['/tesoreria/caja-diaria', '/adquisiciones', '/tesoreria/por-cobrar', '/tesoreria/por-pagar'],
  },
  // Primero lo que espera por ella: las cotizaciones por facturar. Después las
  // compras en su orden: la guía de remisión de cada OC que recoge el conductor,
  // la detracción de las órdenes de servicio y la factura de compra. El kardex
  // lo consulta en lectura: ingresos con su guía, atenciones y egresos. También
  // la cotización aprobada; la OT ya no (2026-10-15).
  CONTABILIDAD: {
    grupos: [
      {
        titulo: 'Contabilidad',
        rutas: ['/contabilidad/facturacion', '/compras/gestion', '/compras/servicios', '/adquisiciones', '/proveedores', '/tesoreria/tipo-de-cambio'],
      },
      // Los recibos por honorarios, por la retención de cuarta categoría que declara cada mes.
      { titulo: 'Consultas', rutas: ['/almacen/kardex', '/cotizaciones/pdf', '/requerimientos', '/tesoreria/recibos-por-honorarios'] },
    ],
    telefono: ['/contabilidad/facturacion', '/compras/gestion', '/adquisiciones', '/almacen/kardex'],
  },
  // Unidades y Carrocerías las lleva Diseño e Ingeniería (pedido de la
  // empresa, 2026-10-01). Configuración la alcanza por `configuracion.ver`,
  // pero es del administrador del sistema.
  // Desde el 2026-10-15 su trabajo va por código interno: los planos de cada
  // área, la lista de materiales y las etapas, primero. Después la OT, que la
  // ve solo Diseño, y el informe de su equipo; luego los catálogos que
  // mantiene. La evaluación es de cada cierto tiempo: al final de su grupo.
  DISENO: {
    grupos: [
      { titulo: 'Por código interno', rutas: ['/diseno/planos', '/diseno/materiales', '/diseno/etapas'] },
      { titulo: 'Diseño e Ingeniería', rutas: ['/ordenes', '/materiales', '/diseno/informe-semanal', '/diseno/evaluaciones'] },
      { titulo: 'Catálogos', rutas: ['/carrocerias', '/unidades'] },
      { titulo: 'Consultas', rutas: ['/requerimientos', '/clientes'] },
    ],
    telefono: ['/diseno/planos', '/diseno/etapas', '/diseno/materiales', '/ordenes'],
  },
  DISENO_COLABORADOR: {
    grupos: [{ titulo: 'Diseño e Ingeniería', rutas: ['/diseno/informe-semanal', '/ordenes'] }],
    telefono: ['/diseno/informe-semanal', '/ordenes', '/'],
  },
  // Administración lee clientes, unidades, catálogos y costos porque carga la
  // OT y ve su costo; pero la valorización es de Logística (la pantalla
  // también la rechaza) y Unidades y Carrocerías las lleva Diseño. De RR. HH.
  // le tocan las tardanzas y las observaciones: la ficha y la asistencia
  // las abre por su dirección, y así no tiene dos «Personal» en el menú.
  // Desde el 2026-10-15 lleva el requerimiento de Administración (lo de
  // oficina): lo registra, Almacén lo revisa y ella hace la OC de lo que falta.
  // La evaluación de desempeño la recibe de Diseño: es consulta. Los
  // subcontratos son suyos: registra cada uno y sube sus recibos por honorarios.
  // Desde el 2026-10-19 ve los códigos internos en lectura (cerrar el costeo es
  // de Gerencia), Clientes pasa al final de Consultas, y Personal y
  // Configuración son del administrador del sistema: ya no los tiene ni en el
  // menú ni en la base (migración 20261017400000).
  ADMINISTRACION: {
    principal: ['/codigos-internos'],
    grupos: [
      {
        titulo: 'Administración',
        rutas: ['/cotizaciones/pdf', '/ordenes', '/subcontratos', '/costos/gastos-generales', '/tesoreria/tipo-de-cambio'],
      },
      { titulo: 'Requerimiento de Administración', rutas: ['/requerimientos', '/requerimientos/atencion', '/compras/ordenes'] },
      { titulo: 'Consultas', rutas: ['/diseno/evaluaciones', '/rrhh/tardanzas', '/rrhh/observaciones', '/vehiculos', '/clientes'] },
    ],
    telefono: ['/cotizaciones/pdf', '/ordenes', '/subcontratos', '/requerimientos'],
  },
  // Primero lo que espera por RR. HH. cada día: los reportes diarios por
  // validar, las horas extras por decidir y la planilla diaria por enviar.
  // Después el control del personal y, al final, lo del mes: las planillas y
  // el costeo por código. La OT ya no está en su menú: solo la consultaba
  // (2026-10-15).
  RECURSOS_HUMANOS: {
    grupos: [
      { titulo: 'Recursos Humanos', rutas: ['/reportes-diarios', '/rrhh/horas-extras', '/planilla-diaria'] },
      {
        titulo: 'Control del personal',
        rutas: ['/rrhh/personal', '/rrhh/asistencia', '/rrhh/tardanzas', '/rrhh/permisos', '/rrhh/observaciones'],
      },
      { titulo: 'Planillas y costeo', rutas: ['/rrhh', '/rrhh/costeo', '/rrhh/pagos-oficina'] },
    ],
    telefono: ['/reportes-diarios', '/planilla-diaria', '/rrhh/personal', '/rrhh/asistencia'],
  },
  PORTERO: {
    grupos: [{ titulo: 'Portería', rutas: ['/rrhh/asistencia'] }],
    telefono: ['/rrhh/asistencia', '/'],
  },
  // Sube su reporte diario, que es su trabajo de cada día. Desde el 2026-10-15,
  // los planos que Diseño carga para su área y las etapas que hace su área van
  // justo después de su reporte, y ya no abre la OT: su reporte diario
  // reemplaza las tareas con foto. Desde el 2026-10-20, en el orden que pidió
  // DKS: reporte diario, planos y etapas, los subcontratos de su área (su
  // inicio, su fin y su progreso, sin montos), sus requerimientos (el RQ
  // «Listo en almacén», al que también lo lleva el aviso) y al final el stock
  // de Almacén, que consulta para saber qué hay.
  SUPERVISOR: {
    grupos: [{ titulo: 'Supervisión', rutas: ['/reportes-diarios', '/planos', '/subcontratos/area', '/requerimientos', '/almacen/stock'] }],
    telefono: ['/reportes-diarios', '/planos', '/subcontratos/area', '/requerimientos'],
  },
  // Mira todas las áreas sin trabajar en ninguna: cada una con su nombre y en
  // el orden del circuito, después de lo suyo. La cotización ya no: desde el
  // 2026-10-15 la ven solo Administración, Gerencia, Tesorería y Contabilidad
  // (y Ventas, que la hace). La OT tampoco: sigue cada unidad por su código.
  SUPERVISOR_GENERAL: {
    grupos: [
      { titulo: 'Supervisión general', rutas: ['/seguimiento', '/diseno/informe-semanal'] },
      { titulo: 'Ventas', rutas: ['/clientes', '/unidades'] },
      { titulo: 'Requerimientos', rutas: ['/requerimientos', '/vehiculos'] },
      {
        titulo: 'Almacén',
        rutas: ['/almacen/kardex', '/compras/valorizacion'],
      },
      { titulo: 'Finanzas', rutas: ['/costos/gastos-generales'] },
    ],
    telefono: ['/seguimiento', '/requerimientos', '/almacen/kardex', '/'],
  },
  VENDEDOR: {
    grupos: [{ titulo: 'Ventas', rutas: ['/cotizaciones/pdf', '/clientes', '/unidades', '/carrocerias'] }],
    telefono: ['/cotizaciones/pdf', '/clientes', '/unidades', '/'],
  },
}
// El líder de Diseño hace el trabajo de Diseño y además revisa el de su equipo
// (`docs/PERMISOS.md`): lleva su mismo menú. Sin esta línea le salía el
// catálogo completo, con Configuración, y en el teléfono sin Planos ni Etapas.
MENU_POR_PUESTO.DISENO_LIDER = MENU_POR_PUESTO.DISENO

function lePermite(item: ItemNavegacion, permisos: readonly string[], esAdmin: boolean) {
  if (!item.permiso || esAdmin) return true
  const pide: readonly string[] = typeof item.permiso === 'string' ? [item.permiso] : item.permiso
  return pide.some((p) => permisos.includes(p))
}

/**
 * El menú de esta persona, por grupos: el de su puesto si lo tiene; si no, el
 * catálogo entero filtrado por su permiso. Lo usan la barra del monitor, el
 * cajón del teléfono y «Tus módulos» del dashboard, así que los tres dicen lo
 * mismo.
 */
export function menuDe(permisos: readonly string[], esAdmin: boolean, rolCodigo: string): GrupoNavegacion[] {
  const propio = esAdmin ? undefined : MENU_POR_PUESTO[rolCodigo]
  const grupos: GrupoNavegacion[] = propio
    ? [{ titulo: 'Principal', rutas: ['/', ...(propio.principal ?? [])] }, ...propio.grupos].map((g) => ({
        titulo: g.titulo,
        // Una pantalla compartida está en el catálogo una vez por cada área que
        // la usa, con el permiso de esa área: vale la que esta persona ve.
        items: g.rutas.flatMap((r) => CATALOGO.find((i) => i.ruta === r && i.disponible && lePermite(i, permisos, esAdmin)) ?? []),
      }))
    : GRUPOS.map((g) => ({ titulo: g.titulo, items: g.items.filter((i) => i.disponible && lePermite(i, permisos, esAdmin)) }))
  // Una pantalla compartida sale una sola vez, en el primer grupo que la
  // muestra: a ADMIN, que lo ve todo, le salían dos «Atención de
  // requerimiento», dos «Gestión de compras» y dos «Planilla diaria».
  const vistas = new Set<string>()
  return grupos
    .map((g) => ({
      titulo: g.titulo,
      items: g.items.filter((i) => {
        if (vistas.has(i.ruta)) return false
        vistas.add(i.ruta)
        return true
      }),
    }))
    .filter((g) => g.items.length > 0)
}

/** «1 pendiente», «3 pendientes»: la etiqueta de los globos del menú, para el lector de pantalla. */
export function pendientesEnPalabras(n: number) {
  return `${n} ${n === 1 ? 'pendiente' : 'pendientes'}`
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
  { ruta: '/contabilidad/facturacion', corto: 'Facturar' },
  { ruta: '/adquisiciones', corto: 'Compras' },
  { ruta: '/tesoreria/por-cobrar', corto: 'Por cobrar' },
  { ruta: '/tesoreria/por-pagar', corto: 'Por pagar' },
  { ruta: '/tesoreria/pagos-de-servicio', corto: 'Servicios' },
  { ruta: '/rrhh', corto: 'Planillas' },
  { ruta: '/costos/gastos-generales', corto: 'Gastos' },
  { ruta: '/compras/valorizacion', corto: 'Precios' },
  { ruta: '/clientes', corto: 'Clientes' },
  { ruta: '/', corto: 'Dashboard' },
  { ruta: '/unidades', corto: 'Unidades' },
  { ruta: '/carrocerias', corto: 'Carrocerías' },
  { ruta: '/materiales', corto: 'Materiales' },
  { ruta: '/configuracion', corto: 'Ajustes' },
  { ruta: '/personal', corto: 'Personal' },
  { ruta: '/recojos', corto: 'Recojos' },
  { ruta: '/compras/ordenes', corto: 'OC' },
  { ruta: '/compras/aprobacion', corto: 'Aprobar' },
  { ruta: '/compras/gestion', corto: 'Gestión' },
  { ruta: '/compras/servicios', corto: 'OS' },
  { ruta: '/requerimientos', corto: 'RQ' },
  { ruta: '/requerimientos/atencion', corto: 'Atención' },
  { ruta: '/vehiculos', corto: 'Vehículos' },
  { ruta: '/requerimientos/gasto-por-codigo', corto: 'Gasto' },
  { ruta: '/rrhh/asistencia', corto: 'Asistencia' },
  { ruta: '/rrhh/personal', corto: 'Personal' },
  { ruta: '/rrhh/tardanzas', corto: 'Tardanzas' },
  { ruta: '/rrhh/permisos', corto: 'Permisos' },
  { ruta: '/rrhh/costeo', corto: 'Costeo' },
  { ruta: '/rrhh/pagos-oficina', corto: 'Pagos' },
  { ruta: '/rrhh/observaciones', corto: 'Observaciones' },
  { ruta: '/reportes-diarios', corto: 'Reporte' },
  { ruta: '/codigos-internos', corto: 'Códigos' },
  { ruta: '/diseno/planos', corto: 'Planos' },
  { ruta: '/diseno/materiales', corto: 'Materiales' },
  { ruta: '/diseno/etapas', corto: 'Etapas' },
  { ruta: '/planos', corto: 'Planos' },
  { ruta: '/seguimiento', corto: 'Seguimiento' },
  { ruta: '/seguimiento?vista=materiales', corto: 'Materiales' },
  { ruta: '/planilla-diaria', corto: 'Planilla' },
  { ruta: '/rrhh/horas-extras', corto: 'Extras' },
  { ruta: '/tesoreria/tipo-de-cambio', corto: 'Cambio' },
  { ruta: '/proveedores', corto: 'Proveedores' },
  { ruta: '/subcontratos', corto: 'Subcontratos' },
  { ruta: '/subcontratos/area', corto: 'Subcontratos' },
  { ruta: '/tesoreria/recibos-por-honorarios', corto: 'Honorarios' },
  { ruta: '/tesoreria/caja-diaria', corto: 'Caja' },
  // Al final: así no le quita la pestaña a nadie que no tenga menú propio.
  { ruta: '/almacen/stock', corto: 'Stock' },
]
