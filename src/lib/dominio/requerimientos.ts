import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/**
 * En qué va el requerimiento. Primero lo revisa Almacén; si no hay stock lo
 * compra Logística; cuando está en almacén, Supervisión lo recoge y Almacén lo
 * entrega (migración 20261013100000).
 */
export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  POR_ATENDER: { etiqueta: 'Por revisar', tono: 'aviso', descripcion: 'Almacén revisa si hay stock.' },
  SIN_STOCK: { etiqueta: 'Sin stock', tono: 'peligro', descripcion: 'Almacén no lo tiene; Logística lo compra.' },
  EN_ATENCION: { etiqueta: 'En compra', tono: 'info', descripcion: 'Logística lo está comprando.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro', descripcion: 'Anulado con su motivo.' },
}

/** Los que todavía esperan a alguien: lo que la bandeja de atención muestra primero. */
export const ESTADOS_RQ_ABIERTOS = ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN'] as const

/**
 * En qué etapa va cada insumo del RQ, con su porcentaje. Lo calcula la base
 * (`avance_de_requerimientos`, migración 20261013121000) a partir del estado
 * del RQ, de la OC del insumo y de su recojo: el RQ va en el promedio de sus
 * insumos y su etapa es la del más atrasado. Las etiquetas viven aquí.
 */
export const ETAPA_AVANCE_RQ: Record<string, Def> = {
  POR_REVISAR: { etiqueta: 'Almacén revisa el stock', tono: 'aviso', descripcion: 'Almacén todavía no dice si lo tiene.' },
  POR_COMPRAR: { etiqueta: 'Por comprar', tono: 'aviso', descripcion: 'Sin stock y sin orden de compra viva.' },
  OC_POR_APROBAR: { etiqueta: 'OC por aprobar', tono: 'aviso', descripcion: 'La orden de compra espera a Gerencia.' },
  PENDIENTE_RECOJO: { etiqueta: 'Pendiente de recojo', tono: 'aviso', descripcion: 'Aprobada: el conductor todavía no sale a recogerla.' },
  EN_RECOJO: { etiqueta: 'En recojo', tono: 'info', descripcion: 'El conductor salió a recogerla.' },
  RECOGIDO: { etiqueta: 'Recogido, va al almacén', tono: 'info', descripcion: 'El conductor la tiene y la lleva al almacén.' },
  POR_VALIDAR: { etiqueta: 'En almacén, por validar', tono: 'info', descripcion: 'El conductor la dejó; Almacén valida el ingreso.' },
  OBSERVADO: { etiqueta: 'Observado en almacén', tono: 'peligro', descripcion: 'Almacén no la recibió completa.' },
  EN_KARDEX: { etiqueta: 'Ingresó al kardex', tono: 'exito', descripcion: 'Almacén validó el ingreso.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
}

/** Las dos etapas del recojo que Gerencia quiere distinguir de un vistazo. */
export const ETAPAS_DE_RECOJO = ['PENDIENTE_RECOJO', 'EN_RECOJO'] as const

/**
 * Cuántos insumos hay en cada etapa, en el orden del circuito, cuando no van
 * todos juntos: «Pendiente de recojo: 2 · En recojo: 1». Vacío si van parejos.
 */
export function resumenDeEtapas(etapas: (string | null)[]): string {
  const cuenta = new Map<string, number>()
  for (const e of etapas) if (e) cuenta.set(e, (cuenta.get(e) ?? 0) + 1)
  if (cuenta.size < 2) return ''
  const orden = Object.keys(ETAPA_AVANCE_RQ)
  return [...cuenta.entries()]
    .sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0]))
    .map(([e, n]) => `${ETAPA_AVANCE_RQ[e]?.etiqueta ?? e}: ${n}`)
    .join(' · ')
}

/** Por qué entra un vehículo a la planta (los formatos MW/JM/CON-FOR-VIG de portería). */
export const MOTIVO_VEHICULO: Record<string, Def> = {
  FABRICACION: { etiqueta: 'Fabricación', tono: 'acento', descripcion: 'Chasis o unidad para fabricarle la carrocería.' },
  MANTENIMIENTO: { etiqueta: 'Mantenimiento', tono: 'info', descripcion: 'Unidad de un cliente para mantenimiento.' },
  GARANTIA: { etiqueta: 'Garantía', tono: 'aviso', descripcion: 'Unidad que vuelve por garantía.' },
  ARENADO: { etiqueta: 'Retorno de arenado', tono: 'neutro', descripcion: 'Vuelve del arenado externo.' },
  COCHERA: { etiqueta: 'Cochera', tono: 'neutro', descripcion: 'Vehículo de un tercero que se guarda en la cochera.' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro', descripcion: 'Cualquier otro motivo; se cuenta en la observación.' },
}

export const MOTIVOS_VEHICULO = Object.keys(MOTIVO_VEHICULO) as [string, ...string[]]

/**
 * La hora que se escribe en un `datetime-local` es la del taller. Perú no
 * cambia de hora, así que se le pega su desfase y la base la guarda bien.
 */
export function horaDeLima(valor: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) ? `${valor}:00-05:00` : null
}
