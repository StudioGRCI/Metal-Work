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
}

export type GrupoNavegacion = { titulo: string; items: ItemNavegacion[] }

export const NAVEGACION: GrupoNavegacion[] = [
  {
    titulo: 'Operación',
    items: [
      { titulo: 'Tablero', ruta: '/', icono: LayoutDashboard, descripcion: 'Estado general del taller' },
      {
        titulo: 'Órdenes de trabajo',
        ruta: '/ordenes',
        icono: ClipboardList,
        permiso: 'ordenes.ver',
        descripcion: 'Todas las OT y su avance',
      },
      {
        titulo: 'Producción',
        ruta: '/produccion',
        icono: Factory,
        permiso: 'produccion.ver',
        descripcion: 'Partes diarios y horas de taller',
      },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver' },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver' },
      { titulo: 'Cotizaciones', ruta: '/cotizaciones', icono: Receipt, permiso: 'cotizaciones.ver' },
    ],
  },
  {
    titulo: 'Logística',
    items: [
      { titulo: 'Almacén', ruta: '/almacen', icono: Package, permiso: 'almacen.ver' },
      { titulo: 'Costos', ruta: '/costos', icono: Wallet, permiso: 'costos.ver' },
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
