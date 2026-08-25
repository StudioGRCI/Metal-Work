import {
  ClipboardList,
  Factory,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'

export type ItemNavegacion = {
  titulo: string
  ruta: string
  icono: typeof LayoutDashboard
  permiso?: string
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
      { titulo: 'Costos', ruta: '/costos', icono: Wallet, permiso: 'costos.ver', disponible: true },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
      { titulo: 'Documentos', ruta: '/documentos', icono: FileText, permiso: 'documentos.ver' },
      { titulo: 'Configuración', ruta: '/configuracion', icono: Settings, permiso: 'configuracion.ver' },
    ],
  },
]
