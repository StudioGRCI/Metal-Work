import {
  Boxes,
  Camera,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Layers,
  LayoutDashboard,
  Receipt,
  Settings,
  Truck,
  UserCog,
  Users,
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
    titulo: 'Seguimiento',
    items: [
      {
        titulo: 'Tablero',
        ruta: '/',
        icono: LayoutDashboard,
        descripcion: 'Estado general del taller',
        disponible: true,
      },
      // El control de plazos es de todas las áreas del taller y lo mira
      // cualquiera de ellas: que Maestranza vea que Diseño la tiene trabada es
      // el punto. Del taller, no de ventas: por eso cuelga de `ordenes.listar`
      // —entrar al módulo— y no de `ordenes.ver`, que es la llave de lectura
      // que ventas necesita.
      {
        titulo: 'Control de plazos',
        ruta: '/plazos',
        icono: CalendarClock,
        permiso: ['ordenes.listar', 'produccion.ver'],
        descripcion: 'En qué va cada área y qué la trabó',
        disponible: true,
      },
      {
        titulo: 'Avance en taller',
        ruta: '/avance',
        icono: Camera,
        permiso: 'produccion.ver',
        descripcion: 'Dónde está cada unidad y qué la traba',
        disponible: true,
      },
      // El parte de la jornada del jefe de producción. Va pegado al avance de
      // taller: es el mismo módulo, visto por día en vez de por unidad.
      {
        titulo: 'El día en el taller',
        ruta: '/avance/diario',
        icono: ClipboardList,
        permiso: 'produccion.ver',
        descripcion: 'Lo que reportó cada área hoy, y quién no reportó',
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
    ],
  },
  {
    titulo: 'Órdenes',
    items: [
      // La orden la emite Administración —lo dice su propio flujograma: «Gerencia
      // aprueba → Administración emite la orden de trabajo»— así que vive con lo
      // suyo y no en Operación, donde quedaba suelta entre el tablero y el
      // avance de taller.
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
    titulo: 'Abastecimiento',
    items: [
      {
        titulo: 'Atención de materiales',
        ruta: '/materiales/atencion',
        icono: Boxes,
        permiso: ['requerimientos.ver', 'compras.ver', 'compras.crear', 'almacen.ver', 'almacen.recibir', 'almacen.despachar'],
        descripcion: 'Solicitudes, compras, recepción y entrega por área',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Finanzas',
    items: [
      {
        titulo: 'Tesorería',
        ruta: '/tesoreria',
        icono: Receipt,
        permiso: 'tesoreria.ver_documentos',
        descripcion: 'Cotizaciones liberadas y documentos de compras',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Ventas',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', disponible: true },
      { titulo: 'Carrocerías', ruta: '/carrocerias', icono: Layers, permiso: ['diseno.planos', 'configuracion.ver', 'cotizaciones.crear'], disponible: true },
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

/** Si una persona ve un módulo del menú: sin permiso declarado lo ve todo el mundo. */
export function puedeVer(item: ItemNavegacion, permisos: string[], esAdmin: boolean) {
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
 * le queden las suyas sin escribir un rol a mano: al taller, Taller, Órdenes,
 * El día y Plazos; a Diseño y Administración, su entrada de cotizaciones primero; a
 * Ventas, Cotizaciones, Clientes y el tablero. El nombre va corto porque la
 * pestaña es angosta.
 */
// El orden deja primero el flujo PDF para Ventas, Gerencia y Administración.
export const PESTANAS_TELEFONO: { ruta: string; corto: string }[] = [
  { ruta: '/cotizaciones/pdf', corto: 'Cotizar' },
  { ruta: '/ordenes', corto: 'Órdenes' },
  { ruta: '/materiales/atencion', corto: 'Materiales' },
  { ruta: '/tesoreria', corto: 'Tesorería' },
  { ruta: '/avance', corto: 'Taller' },
  { ruta: '/avance/diario', corto: 'El día' },
  { ruta: '/plazos', corto: 'Plazos' },
  { ruta: '/clientes', corto: 'Clientes' },
  { ruta: '/', corto: 'Tablero' },
  { ruta: '/unidades', corto: 'Unidades' },
  { ruta: '/carrocerias', corto: 'Carrocerías' },
  { ruta: '/materiales', corto: 'Materiales' },
  { ruta: '/configuracion', corto: 'Ajustes' },
  { ruta: '/personal', corto: 'Personal' },
]
