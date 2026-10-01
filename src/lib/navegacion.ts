import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Layers,
  LayoutDashboard,
  ListOrdered,
  Receipt,
  Settings,
  Tag,
  Truck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

export type ItemNavegacion = {
  titulo: string
  ruta: string
  icono: typeof LayoutDashboard
  /** Con varios permisos basta con tener uno para que el módulo se vea. */
  permiso?: string | string[]
  descripcion?: string
  /** Los módulos aún no construidos se muestran atenuados y sin enlace. */
  disponible?: boolean
}

export type GrupoNavegacion = { titulo: string; items: ItemNavegacion[] }

/**
 * El menú es el circuito de la empresa y nada más: cotización PDF →
 * Gerencia aprueba → Administración carga la orden →
 * Diseño desglosa → almacén y logística atienden → el taller reporta.
 * Cada grupo aparece solo a quien tiene el permiso correspondiente.
 */
export const NAVEGACION: GrupoNavegacion[] = [
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
        permiso: ['diseno.planos', 'diseno.subir_pdf', 'supervision.general','administracion.recibir_informe'],
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
  {
    titulo: 'Abastecimiento',
    items: [
      {titulo:'Compras',ruta:'/compras',icono:Receipt,permiso:'compras.crear',descripcion:'Órdenes de compra agrupadas, facturas y entregas',disponible:true},
      {
        titulo: 'Kardex de Almacén',
        ruta: '/almacen/kardex',
        icono: ListOrdered,
        permiso: 'almacen.ver',
        descripcion: 'Saldos, ingresos, egresos por unidad y conteo físico',
        disponible: true,
      },
      // Logística fija el precio de lo que nunca se compró por el sistema.
      // Costos la consulta; Almacén también puede, pero no la necesita en su menú.
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
      { titulo: 'Cuentas de Tesorería', ruta: '/tesoreria/cuentas', icono: FileSpreadsheet, permiso: 'tesoreria.ver_documentos', descripcion: 'Cobros por OT y pagos de compras', disponible: true },
      { titulo: 'Gastos del mes', ruta: '/costos/gastos-generales', icono: Wallet, permiso: ['costos.gastos_generales', 'costos.ver'], descripcion: 'Servicios del local y gastos de operación', disponible: true },
      { titulo: 'Tipo de cambio', ruta: '/tesoreria/tipo-de-cambio', icono: ArrowLeftRight, permiso: 'tesoreria.tipo_cambio', descripcion: 'El cambio del dólar de cada día, para el costo en soles', disponible: true },
      { titulo: 'Recursos Humanos', ruta: '/rrhh', icono: UserCog, permiso: 'rrhh.ver_planillas', descripcion: 'Planillas y distribución por unidad', disponible: true },
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
]

/** Permisos amplios permiten consultar detalles; el menú prioriza cada puesto. */
const RUTAS_POR_PUESTO: Record<string, readonly string[]> = {
  GERENTE: ['/', '/cotizaciones/pdf', '/ordenes'],
  TESORERIA: ['/', '/ordenes', '/tesoreria', '/tesoreria/cuentas', '/tesoreria/tipo-de-cambio', '/adquisiciones'],
}

export function puedeVer(item: ItemNavegacion, permisos: string[], esAdmin: boolean, rolCodigo: string) {
  if (rolCodigo === 'DISENO' && item.ruta === '/configuracion') return false
  if (RUTAS_POR_PUESTO[rolCodigo] && !RUTAS_POR_PUESTO[rolCodigo].includes(item.ruta)) return false
  if (!item.permiso || esAdmin) return true
  return (Array.isArray(item.permiso) ? item.permiso : [item.permiso]).some((p) => permisos.includes(p))
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
 * Las pestañas de abajo en el teléfono: las cuatro primeras de esta lista que
 * la persona ve, y después «Más». El orden está pensado para que a cada puesto
 * le queden las suyas sin escribir un rol a mano: al taller, Órdenes;
 * a Diseño y Administración, su entrada de cotizaciones primero; a
 * Ventas, Cotizaciones, Clientes y el tablero. El nombre va corto porque la
 * pestaña es angosta.
 */
// El orden deja primero el flujo PDF para Ventas, Gerencia y Administración.
export const PESTANAS_TELEFONO: { ruta: string; corto: string }[] = [
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
]
