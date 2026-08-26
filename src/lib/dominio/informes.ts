/**
 * El catálogo de informes. Cada uno declara qué función de la base lo calcula,
 * qué permisos hacen falta y cómo se muestran sus columnas. Con eso, agregar un
 * informe nuevo es agregar una entrada acá y su función en la base.
 */

export type Formato =
  | 'texto'
  | 'numero'
  | 'moneda'
  | 'horas'
  | 'fecha'
  | 'porcentaje'
  | 'si_no'
  /** El estado de una OT, con la etiqueta que usa el resto del sistema. */
  | 'estado_ot'

export type Columna = {
  clave: string
  titulo: string
  formato?: Formato
  /** Se suma al pie de la tabla. */
  totaliza?: boolean
}

export type Informe = {
  clave: string
  titulo: string
  descripcion: string
  /** La pregunta que contesta, en una línea. */
  pregunta: string
  funcion: string
  permisos: string[]
  columnas: Columna[]
  /** Comentario al pie, para que el número no se lea al revés. */
  nota?: string
}

export const INFORMES: Informe[] = [
  {
    clave: 'produccion',
    titulo: 'Producción del período',
    descripcion: 'Horas de taller por persona y especialidad, con su costo.',
    pregunta: '¿Quién sostuvo la producción y cuánto costó esa mano de obra?',
    funcion: 'informe_produccion',
    permisos: ['reportes.ver'],
    columnas: [
      { clave: 'operario', titulo: 'Persona' },
      { clave: 'especialidad', titulo: 'Especialidad' },
      { clave: 'dias_trabajados', titulo: 'Días', formato: 'numero' },
      { clave: 'ordenes', titulo: 'Unidades', formato: 'numero' },
      { clave: 'horas_normales', titulo: 'Horas', formato: 'horas', totaliza: true },
      { clave: 'horas_extra', titulo: 'Extra', formato: 'horas', totaliza: true },
      { clave: 'horas_totales', titulo: 'Total', formato: 'horas', totaliza: true },
      { clave: 'costo', titulo: 'Costo', formato: 'moneda', totaliza: true },
    ],
    nota: 'Solo cuenta lo que está en partes diarios aprobados, igual que el costeo de la orden.',
  },
  {
    clave: 'cumplimiento',
    titulo: 'Cumplimiento de entregas',
    descripcion: 'Unidades entregadas y si salieron dentro del plazo prometido.',
    pregunta: '¿El taller entrega cuando promete?',
    funcion: 'informe_cumplimiento',
    permisos: ['reportes.ver'],
    columnas: [
      { clave: 'numero', titulo: 'Orden' },
      { clave: 'cliente', titulo: 'Cliente' },
      { clave: 'placa', titulo: 'Unidad' },
      { clave: 'comprometida', titulo: 'Comprometida', formato: 'fecha' },
      { clave: 'entregada', titulo: 'Entregada', formato: 'fecha' },
      { clave: 'dias_atraso', titulo: 'Atraso', formato: 'numero' },
      { clave: 'a_tiempo', titulo: 'A tiempo', formato: 'si_no' },
      { clave: 'dias_en_taller', titulo: 'Días en taller', formato: 'numero' },
    ],
    nota: 'El atraso se mide contra la fecha comprometida al cliente, en días de calendario.',
  },
  {
    clave: 'rentabilidad',
    titulo: 'Rentabilidad por unidad',
    descripcion: 'Costo, venta y margen de cada carrocería.',
    pregunta: '¿Qué unidades dejan plata y cuáles se comieron el presupuesto?',
    funcion: 'informe_rentabilidad',
    permisos: ['reportes.ver', 'costos.ver'],
    columnas: [
      { clave: 'numero', titulo: 'Orden' },
      { clave: 'cliente', titulo: 'Cliente' },
      { clave: 'estado', titulo: 'Estado', formato: 'estado_ot' },
      { clave: 'presupuesto', titulo: 'Presupuesto', formato: 'moneda', totaliza: true },
      { clave: 'costo_materiales', titulo: 'Materiales', formato: 'moneda', totaliza: true },
      { clave: 'costo_mano_obra', titulo: 'Mano de obra', formato: 'moneda', totaliza: true },
      { clave: 'costo_servicios', titulo: 'Servicios', formato: 'moneda', totaliza: true },
      { clave: 'costo_total', titulo: 'Costo', formato: 'moneda', totaliza: true },
      { clave: 'valor_venta', titulo: 'Venta', formato: 'moneda', totaliza: true },
      { clave: 'utilidad', titulo: 'Utilidad', formato: 'moneda', totaliza: true },
      { clave: 'margen_porcentaje', titulo: 'Margen', formato: 'porcentaje' },
    ],
    nota: 'Las órdenes todavía en taller aparecen con el costo acumulado hasta hoy, no con el final.',
  },
  {
    clave: 'comercial',
    titulo: 'Cotizaciones y cierre',
    descripcion: 'Cuánto se ofreció, cuánto se cerró y en cuántos días decidió el cliente.',
    pregunta: '¿El problema es que no llegan trabajos o que no se cierran?',
    funcion: 'informe_comercial',
    permisos: ['reportes.ver', 'cotizaciones.ver'],
    columnas: [
      { clave: 'vendedor', titulo: 'Vendedor' },
      { clave: 'cotizaciones', titulo: 'Cotizaciones', formato: 'numero', totaliza: true },
      { clave: 'monto_cotizado', titulo: 'Monto ofrecido', formato: 'moneda', totaliza: true },
      { clave: 'aprobadas', titulo: 'Cerradas', formato: 'numero', totaliza: true },
      { clave: 'monto_aprobado', titulo: 'Monto cerrado', formato: 'moneda', totaliza: true },
      { clave: 'rechazadas', titulo: 'Perdidas', formato: 'numero', totaliza: true },
      { clave: 'pendientes', titulo: 'Sin respuesta', formato: 'numero', totaliza: true },
      { clave: 'tasa_cierre', titulo: 'Cierre', formato: 'porcentaje' },
      { clave: 'dias_a_decision', titulo: 'Días a decidir', formato: 'numero' },
    ],
    nota: 'La tasa de cierre compara aprobadas contra decididas: las que siguen sin respuesta no cuentan.',
  },
  {
    clave: 'materiales',
    titulo: 'Consumo de material',
    descripcion: 'Lo que salió del almacén, del que más plata representa al que menos.',
    pregunta: '¿En qué se va el acero?',
    funcion: 'informe_consumo_materiales',
    permisos: ['reportes.ver'],
    columnas: [
      { clave: 'codigo', titulo: 'Código' },
      { clave: 'descripcion', titulo: 'Material' },
      { clave: 'categoria', titulo: 'Categoría' },
      { clave: 'unidad', titulo: 'Unidad' },
      { clave: 'cantidad', titulo: 'Cantidad', formato: 'numero', totaliza: false },
      { clave: 'costo', titulo: 'Costo', formato: 'moneda', totaliza: true },
      { clave: 'ordenes', titulo: 'Unidades', formato: 'numero' },
      { clave: 'salidas', titulo: 'Salidas', formato: 'numero', totaliza: true },
    ],
    nota: 'Cuenta las salidas a orden de trabajo y las mermas; las devoluciones al almacén no restan acá.',
  },
  {
    clave: 'subcontratos',
    titulo: 'Trabajo mandado afuera',
    descripcion: 'Lo subcontratado por proveedor, con lo que se le pagó y cómo cumplió.',
    pregunta: '¿Cuánto se manda a hacer afuera y quién cumple?',
    funcion: 'informe_subcontratos',
    permisos: ['reportes.ver', 'costos.ver'],
    columnas: [
      { clave: 'proveedor', titulo: 'Proveedor' },
      { clave: 'ordenes', titulo: 'Órdenes', formato: 'numero', totaliza: true },
      { clave: 'monto', titulo: 'Monto', formato: 'moneda', totaliza: true },
      { clave: 'conformes', titulo: 'Conformes', formato: 'numero', totaliza: true },
      { clave: 'atrasadas', titulo: 'Fuera de plazo', formato: 'numero', totaliza: true },
      { clave: 'dias_promedio', titulo: 'Días promedio', formato: 'numero' },
    ],
    nota: 'Los días promedio van del pedido a la conformidad; las anuladas no cuentan.',
  },
]

export function informePorClave(clave: string) {
  return INFORMES.find((i) => i.clave === clave)
}
