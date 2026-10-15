import type { Json } from '@/types/database'

/**
 * La ficha única de ingreso y salida (SIG-FCLIV-001) de cada ingreso de un
 * vehículo a la planta, y la revisión de Tesorería para su salida (migración
 * 20261016110000). Antes vivían en la OT; desde el 2026-10-15 cuelgan del
 * registro de vehículos, que ya lleva el código interno. Puro, sin consultas.
 */

/** El bucket privado del escaneo firmado: `{registro}/{archivo}.pdf`. */
export const BUCKET_FICHAS_VEHICULO = 'fichas-vehiculos'
export const MAXIMO_MB_FICHA = 15

export function rutaFichaVehiculo(registro: string, archivo: string) {
  return `${registro}/${archivo}.pdf`
}

export const ACCIONES_FICHA = ['GUARDAR', 'CERRAR_INGRESO', 'CERRAR_SALIDA'] as const
export type AccionFicha = (typeof ACCIONES_FICHA)[number]

/** Cómo se marca cada punto de inspección, como en el formato impreso. */
export const ESTADOS_PUNTO = [
  { valor: 'CONFORME', etiqueta: 'Conforme', corto: 'C' },
  { valor: 'NO_TIENE', etiqueta: 'No tiene', corto: 'N' },
  { valor: 'OBSERVADO', etiqueta: 'Observado', corto: 'O' },
] as const
export type EstadoPunto = (typeof ESTADOS_PUNTO)[number]['valor']

export function esEstadoPunto(valor: unknown): valor is EstadoPunto {
  return ESTADOS_PUNTO.some((e) => e.valor === valor)
}

/** Los grupos del formato, en su orden. */
export const CATEGORIAS_FICHA: { valor: string; etiqueta: string }[] = [
  { valor: 'CABINA_EXTERIOR', etiqueta: 'Cabina exterior' },
  { valor: 'ACCESORIOS', etiqueta: 'Accesorios' },
  { valor: 'CABINA_INTERIOR', etiqueta: 'Cabina interior' },
  { valor: 'HERRAMIENTAS', etiqueta: 'Herramientas' },
]

/** Lo marcado de un punto al entrar o al salir, leído del JSON de la ficha. */
export function estadoDePunto(items: Json | null | undefined, codigo: string, fase: 'ingreso' | 'salida'): EstadoPunto | null {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return null
  const punto = (items as Record<string, Json | undefined>)[codigo]
  if (!punto || typeof punto !== 'object' || Array.isArray(punto)) return null
  const valor = (punto as Record<string, Json | undefined>)[fase]
  return esEstadoPunto(valor) ? valor : null
}

/** Cuántos puntos faltan marcar en una fase: con alguno sin marcar no se cierra. */
export function puntosSinMarcar(items: Json | null | undefined, codigos: readonly string[], fase: 'ingreso' | 'salida'): number {
  return codigos.filter((c) => estadoDePunto(items, c, fase) === null).length
}

/** El pedido de revisión de la salida a Tesorería. */
export const ESTADO_REVISION_SALIDA = {
  PENDIENTE: { etiqueta: 'Esperando a Tesorería', tono: 'aviso' },
  ATENDIDA: { etiqueta: 'Revisada: puede salir', tono: 'exito' },
  OBSERVADA: { etiqueta: 'Observada', tono: 'peligro' },
} as const satisfies Record<string, { etiqueta: string; tono: 'aviso' | 'exito' | 'peligro' }>

export type EstadoRevisionSalida = keyof typeof ESTADO_REVISION_SALIDA

export function definirRevisionSalida(estado: string) {
  return ESTADO_REVISION_SALIDA[estado as EstadoRevisionSalida] ?? { etiqueta: estado, tono: 'neutro' as const }
}
