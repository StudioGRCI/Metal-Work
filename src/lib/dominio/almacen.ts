import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

export const TIPO_MOVIMIENTO: Record<string, Def> = {
  INGRESO: { etiqueta: 'Ingreso', tono: 'exito', descripcion: 'Entrada de material al almacén' },
  SALIDA_OT: { etiqueta: 'Vale de consumo', tono: 'acento', descripcion: 'Material que se entrega a una orden' },
  DEVOLUCION_OT: { etiqueta: 'Devolución', tono: 'info', descripcion: 'El taller devuelve lo que no consumió' },
  TRANSFERENCIA: { etiqueta: 'Transferencia', tono: 'info', descripcion: 'Traslado entre almacenes' },
  AJUSTE: { etiqueta: 'Ajuste', tono: 'aviso', descripcion: 'Corrección por inventario físico' },
  SALIDA_MERMA: { etiqueta: 'Merma', tono: 'peligro', descripcion: 'Baja por recorte o material inservible' },
}

export const ESTADO_MOVIMIENTO: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' },
  CONFIRMADO: { etiqueta: 'Confirmado', tono: 'exito' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro' },
}

export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  SOLICITADO: { etiqueta: 'Solicitado', tono: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', tono: 'info' },
  ATENDIDO_PARCIAL: { etiqueta: 'Atendido parcial', tono: 'info' },
  ATENDIDO: { etiqueta: 'Atendido', tono: 'exito' },
  RECHAZADO: { etiqueta: 'Rechazado', tono: 'peligro' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro' },
}

export const ESTADO_ORDEN_COMPRA: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'info' },
  ENVIADA: { etiqueta: 'Enviada', tono: 'info' },
  RECIBIDA_PARCIAL: { etiqueta: 'Recibida parcial', tono: 'aviso' },
  RECIBIDA: { etiqueta: 'Recibida', tono: 'exito' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** Cómo se lee cada fila del kardex: si entró, salió o se corrigió por conteo. */
export const MOVIMIENTO_KARDEX: Record<string, Def> = {
  INGRESO: { etiqueta: 'Ingreso', tono: 'exito' },
  DESPACHO: { etiqueta: 'Despacho a OT', tono: 'acento', descripcion: 'Entrega de una solicitud de material de la OT' },
  SALIDA: { etiqueta: 'Salida', tono: 'aviso', descripcion: 'Retiro sin solicitud, vinculado a una unidad' },
  AJUSTE: { etiqueta: 'Ajuste', tono: 'info', descripcion: 'Corrección por conteo físico' },
}

/** De dónde vino cada movimiento. */
export const ORIGEN_KARDEX: Record<string, string> = {
  COMPRA: 'Compra recibida',
  SALDO_INICIAL: 'Saldo inicial',
  INGRESO_GENERAL: 'Ingreso general',
  DEVOLUCION: 'Devolución',
  DESPACHO: 'Solicitud de OT',
  SALIDA_GENERAL: 'Salida por unidad',
  CONTEO: 'Conteo físico',
}

/** Los cuatro almacenes de la empresa. Cada uno sale con su propia regla. */
export type Almacen = 'EPP' | 'CONSUMIBLES' | 'ACCESORIOS' | 'MATERIA_PRIMA'

export const ALMACENES: Record<Almacen, Def & { regla: string; formato: string | null }> = {
  CONSUMIBLES: {
    etiqueta: 'Consumibles', tono: 'exito',
    descripcion: 'Discos, lijas, soldadura, pintura y ferretería: lo que más rota.',
    regla: 'Sale con la unidad a la que va, quién recibe y la foto.',
    formato: null,
  },
  ACCESORIOS: {
    etiqueta: 'Accesorios', tono: 'info',
    descripcion: 'Sistemas y accesorios de la unidad: hidráulico, eléctrico, frenos, suspensión.',
    regla: 'Sale solo para una unidad con código interno. Lo que entró para una unidad no sale para otra.',
    formato: null,
  },
  MATERIA_PRIMA: {
    etiqueta: 'Materia prima', tono: 'aviso',
    descripcion: 'Planchas, perfiles y tubos de acero: el almacén más costoso.',
    regla: 'La salida queda abierta hasta adjuntar el formato de recepción firmado por Almacén y por quien recibe.',
    formato: 'Formato de recepción de materia prima',
  },
  EPP: {
    etiqueta: 'EPP', tono: 'acento',
    descripcion: 'Cascos, guantes, lentes, caretas y arneses.',
    regla: 'La salida queda abierta hasta adjuntar el formato de entrega de EPP firmado.',
    formato: 'Formato de entrega de EPP',
  },
}

export const ORDEN_ALMACENES: Almacen[] = ['CONSUMIBLES', 'ACCESORIOS', 'MATERIA_PRIMA', 'EPP']

export function esAlmacen(valor: string | null | undefined): valor is Almacen {
  return valor === 'EPP' || valor === 'CONSUMIBLES' || valor === 'ACCESORIOS' || valor === 'MATERIA_PRIMA'
}

/** El nombre del almacén dentro de una frase («Historial de consumibles»); EPP es sigla y no se baja. */
export function almacenEnFrase(almacen: Almacen) {
  return almacen === 'EPP' ? 'EPP' : ALMACENES[almacen].etiqueta.toLowerCase()
}

/** Un almacén cuya salida se cierra con un formato firmado. */
export function exigeFormato(almacen: string | null | undefined) {
  return almacen === 'MATERIA_PRIMA' || almacen === 'EPP'
}
