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
 * El menú es el circuito de la empresa y nada más: cotización de venta →
 * cotización de trabajo → Gerencia aprueba → Administración abre la orden →
 * Diseño desglosa → el taller reporta. Lo que no está en ese circuito (almacén,
 * servicios, partes diarios, costos, calidad, documentos, garantías, informes)
 * se retiró el 2026-09-09 porque no se iba a usar y costaba entender.
 */
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
      // El camino corto y el que se usa: la cotización se arma en Excel y se
      // manda en PDF, así que el sistema guarda ese papel con lo poco que
      // necesita —cliente, qué se fabrica y su número— y le sigue el rastro
      // hasta la orden. Va primero porque es por donde entra el trabajo.
      {
        titulo: 'Cotización en PDF',
        ruta: '/cotizaciones/pdf',
        icono: FileText,
        permiso: 'cotizaciones.ver',
        descripcion: 'El PDF que se le mandó al cliente, y su visto de Gerencia',
        disponible: true,
      },
      {
        titulo: 'Cotización de venta',
        ruta: '/cotizaciones',
        icono: Receipt,
        permiso: 'cotizaciones.ver',
        descripcion: 'La que se arma dentro del sistema, con sus partidas',
        disponible: true,
      },
    ],
  },
  // Las partidas pasaron a Diseño: Administración no crea partidas —lo dijo
  // Gerencia— y quien sabe qué lleva la unidad es quien la dibuja. El grupo se
  // ve para quien costea, sea de Diseño o de Administración, que conserva el
  // permiso porque sigue emitiendo la orden.
  {
    titulo: 'Diseño e ingeniería',
    items: [
      {
        titulo: 'Cotización de trabajo',
        ruta: '/cotizaciones/trabajo',
        icono: ClipboardList,
        permiso: 'cotizaciones.costear',
        descripcion: 'Las partidas, la ficha técnica y el tiempo por área',
        disponible: true,
      },
      {
        titulo: 'Carrocerías',
        ruta: '/carrocerias',
        icono: Layers,
        permiso: ['cotizaciones.costear', 'cotizaciones.ver', 'configuracion.ver'],
        descripcion: 'Lo que la casa ya fabricó, con su ficha técnica lista',
        disponible: true,
      },
      // El catálogo chico del que Diseño elige al desglosar los materiales de
      // la orden: nombre, unidad y especificación. Sin stock ni almacén.
      {
        titulo: 'Materiales',
        ruta: '/materiales',
        icono: Boxes,
        permiso: ['diseno.planos', 'cotizaciones.costear'],
        descripcion: 'El catálogo del que Diseño arma el desglose',
        disponible: true,
      },
    ],
  },
  {
    titulo: 'Administrador',
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
    titulo: 'Comercial',
    items: [
      { titulo: 'Clientes', ruta: '/clientes', icono: Users, permiso: 'clientes.ver', disponible: true },
      { titulo: 'Unidades', ruta: '/unidades', icono: Truck, permiso: 'clientes.ver', disponible: true },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
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

/** Si una persona ve un módulo del menú: sin permiso declarado lo ve todo el mundo. */
export function puedeVer(item: ItemNavegacion, permisos: string[], esAdmin: boolean) {
  if (!item.permiso || esAdmin) return true
  return (Array.isArray(item.permiso) ? item.permiso : [item.permiso]).some((p) => permisos.includes(p))
}

/**
 * Cuál de los módulos es el que se está mirando: gana el de ruta más larga que
 * encaje, comparando por segmento. Dentro de `/cotizaciones/trabajo/…` se
 * marca «Cotización de trabajo» y no también la de venta; `/cotizaciones-viejas`
 * no encaja en `/cotizaciones`.
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
 * El día y Plazos; a Diseño y Administración, sus dos cotizaciones primero; a
 * Ventas, Cotizaciones, Clientes y el tablero. El nombre va corto porque la
 * pestaña es angosta.
 */
export const PESTANAS_TELEFONO: { ruta: string; corto: string }[] = [
  { ruta: '/cotizaciones/pdf', corto: 'Cotizar' },
  { ruta: '/cotizaciones/trabajo', corto: 'Trabajo' },
  { ruta: '/cotizaciones', corto: 'Cotizaciones' },
  { ruta: '/avance', corto: 'Taller' },
  { ruta: '/ordenes', corto: 'Órdenes' },
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
