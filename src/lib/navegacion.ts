import {
  BarChart3,
  Camera,
  ClipboardList,
  Factory,
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
      {
        titulo: 'Órdenes de trabajo',
        ruta: '/ordenes',
        icono: ClipboardList,
        permiso: 'ordenes.ver',
        descripcion: 'Todas las OT y su avance',
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
  {
    titulo: 'Comercial',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', disponible: true },
      {
        titulo: 'Cotizaciones',
        ruta: '/cotizaciones',
        icono: Receipt,
        permiso: 'cotizaciones.ver',
        disponible: true,
      },
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
