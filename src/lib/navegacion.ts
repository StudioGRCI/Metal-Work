import {
  BarChart3,
  Camera,
  CalendarClock,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  FileText,
  Handshake,
  LayoutDashboard,
  Package,
  PenLine,
  Receipt,
  Settings,
  Truck,
  UserCog,
  Users,
  ShieldCheck,
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

export const NAVEGACION: GrupoNavegacion[] = [
  {
    titulo: 'Operación',
    items: [
      {
        titulo: 'Tablero',
        ruta: '/',
        icono: LayoutDashboard,
        descripcion: 'Estado general del taller',
        disponible: true,
      },
      // El control de plazos es de todas las áreas y lo mira cualquiera: que
      // Maestranza vea que Diseño la tiene trabada es el punto.
      {
        titulo: 'Control de plazos',
        ruta: '/plazos',
        icono: CalendarClock,
        permiso: ['ordenes.ver', 'produccion.ver'],
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
      {
        titulo: 'Producción',
        ruta: '/produccion',
        icono: Factory,
        permiso: 'produccion.ver',
        descripcion: 'Partes diarios y horas de taller',
        disponible: true,
      },
    ],
  },
  // Cotizar son dos actos de dos áreas y por eso son dos grupos, no dos
  // entradas seguidas dentro de «Comercial»: puestas una debajo de la otra con
  // nombres parecidos, cualquiera entraba a la que no era. El menú dice de quién
  // es cada cosa antes de decir cómo se llama.
  //
  // Cada grupo se muestra solo a quien tiene su permiso, así que el vendedor no
  // ve «Administrador» y a quien costea no le aparece «Vendedor» si no vende.
  {
    titulo: 'Vendedor',
    items: [
      {
        titulo: 'Cotización de venta',
        ruta: '/cotizaciones',
        icono: Receipt,
        permiso: 'cotizaciones.ver',
        descripcion: 'Lo que se le ofrece al cliente y a qué precio',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Administrador',
    items: [
      {
        titulo: 'Cotización de trabajo',
        ruta: '/cotizaciones/trabajo',
        icono: ClipboardList,
        permiso: 'cotizaciones.costear',
        descripcion: 'El costo, la ficha técnica y el tiempo por área',
        disponible: true,
      },
      // La orden la emite Administración —lo dice su propio flujograma: «Gerencia
      // aprueba → Administración emite la orden de trabajo»— así que vive con lo
      // suyo y no en Operación, donde quedaba suelta entre el tablero y el
      // avance de taller.
      {
        titulo: 'Órdenes de trabajo',
        ruta: '/ordenes',
        icono: FileSpreadsheet,
        permiso: 'ordenes.ver',
        descripcion: 'Todas las OT y su avance',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', disponible: true },
    ],
  },
  {
    titulo: 'Logística',
    items: [
      { titulo: 'Almacén', ruta: '/almacen', icono: Package, permiso: 'almacen.ver', disponible: true },
      {
        titulo: 'Servicios',
        ruta: '/servicios',
        icono: Handshake,
        permiso: ['compras.ver', 'costos.ver', 'calidad.ver'],
        descripcion: 'Trabajos que se mandan a hacer afuera',
        disponible: true,
      },
      { titulo: 'Costos', ruta: '/costos', icono: Wallet, permiso: 'costos.ver', disponible: true },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
      {
        titulo: 'Documentos',
        ruta: '/documentos',
        icono: FileText,
        permiso: 'documentos.ver',
        disponible: true,
      },
      {
        titulo: 'Garantías',
        ruta: '/garantias',
        icono: ShieldCheck,
        permiso: 'garantias.ver',
        descripcion: 'Unidades en garantía y sus reclamos',
        disponible: true,
      },
      {
        titulo: 'Informes',
        ruta: '/informes',
        icono: BarChart3,
        permiso: 'reportes.ver',
        descripcion: 'Producción, entregas, márgenes y consumo',
        disponible: true,
      },
      {
        titulo: 'Firmas',
        ruta: '/firmas',
        icono: PenLine,
        descripcion: 'Documentos que esperan tu firma',
        disponible: true,
      },
      {
        titulo: 'Personal',
        ruta: '/personal',
        icono: UserCog,
        permiso: 'usuarios.ver',
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
