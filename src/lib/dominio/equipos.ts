import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * El estado de un equipo de la planta, como lo guarda `equipos.estado`. Lo usan
 * la pantalla (servidor) y sus formularios (navegador): por eso vive aquí y no
 * junto a un componente de cliente.
 */
export const ESTADOS_EQUIPO = ['OPERATIVO', 'CON_OBSERVACION', 'PARADO'] as const
export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number]

export const ESTADO_EQUIPO: Record<EstadoEquipo, { etiqueta: string; tono: Tono; descripcion: string }> = {
  OPERATIVO: { etiqueta: 'Operativo', tono: 'exito', descripcion: 'Se puede usar con normalidad.' },
  CON_OBSERVACION: { etiqueta: 'Con observación', tono: 'aviso', descripcion: 'Trabaja, pero hay que verlo.' },
  PARADO: { etiqueta: 'Parado', tono: 'peligro', descripcion: 'No se puede usar.' },
}

export function esEstadoEquipo(valor: unknown): valor is EstadoEquipo {
  return typeof valor === 'string' && (ESTADOS_EQUIPO as readonly string[]).includes(valor)
}

/** El filtro de la lista por estado, como va en la URL (`?estado=`). */
export const FILTRO_DE_ESTADO: Record<string, EstadoEquipo> = {
  operativos: 'OPERATIVO',
  'con-observacion': 'CON_OBSERVACION',
  parados: 'PARADO',
}

/** La forma del código que la base acepta (`ck_equipos_codigo`): AM-04-06, TRO-14-03, MS-01. */
export const FORMA_DEL_CODIGO = /^[A-Z0-9]+(-[A-Z0-9]+)*$/

/** Los rechazos que son del campo «Código»: el formulario los dice ahí, no al pie. */
export const CODIGO_REPETIDO = 'Ya hay un equipo con ese código en el padrón (puede estar dado de baja). Usa otro.'
export const CODIGO_MAL_ESCRITO = 'El código va con letras, números y guiones, como AM-04-06.'
export const CODIGO_VACIO = 'El código del equipo no puede quedar vacío.'
export const esErrorDelCodigo = (error: string | null) =>
  error === CODIGO_REPETIDO || error === CODIGO_MAL_ESCRITO || error === CODIGO_VACIO || Boolean(error?.startsWith('Escribe el código del equipo'))

/** El código como lo guarda la base: en mayúsculas y sin espacios. */
export function limpiarCodigo(valor: string) {
  return valor.replace(/\s/g, '').toUpperCase()
}

/** «1 equipo», «12 equipos». */
export function cuantosEquipos(n: number) {
  return n === 1 ? '1 equipo' : `${n} equipos`
}
