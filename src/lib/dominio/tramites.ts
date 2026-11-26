import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * Los trámites (plan «El puesto de Tramitador», entrega 1, migración
 * 20261126997100). El Tramitador registra y lleva los de cada unidad (tarjeta
 * de propiedad, placas, certificados) y los de la empresa (licencias, SOAT,
 * permisos); Gerencia y Administración los consultan, Ventas solo los de una
 * unidad, y Gerencia aprueba la anulación. Lo que la pantalla y las acciones
 * comparten con la base.
 */

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** Los permisos de la pantalla: con alguno se entra; qué se ve lo decide la base (`tramites_visibles`). */
export const PERMISOS_TRAMITES = ['tramites.gestionar', 'tramites.ver', 'tramites.ver_de_unidades', 'tramites.aprobar_anulacion'] as const

/** De una unidad de un cliente o de la empresa, como `tramite_tipos.ambito`. */
export const AMBITOS_TRAMITE = ['UNIDAD', 'EMPRESA'] as const
export type AmbitoTramite = (typeof AMBITOS_TRAMITE)[number]

export const AMBITO_TRAMITE: Record<string, { etiqueta: string; descripcion: string }> = {
  UNIDAD: { etiqueta: 'De una unidad', descripcion: 'La tarjeta de propiedad, las placas o los certificados de la unidad de un cliente.' },
  EMPRESA: { etiqueta: 'De la empresa', descripcion: 'Las licencias, el SOAT y los permisos de Metal Work.' },
}

/** En qué va el trámite, como lo lleva `tramites_actualizar`. */
export const ESTADOS_QUE_SE_LLEVAN = ['POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO'] as const
export type EstadoQueSeLleva = (typeof ESTADOS_QUE_SE_LLEVAN)[number]

/**
 * En qué está el trámite, como lo cuenta `tramites_visibles.situacion`: su
 * estado, o «Por anular» mientras espera el visto de Gerencia.
 */
export const SITUACION_TRAMITE: Record<string, Def> = {
  POR_INICIAR: { etiqueta: 'Por iniciar', tono: 'neutro', descripcion: 'Registrado, todavía no se presenta ante la entidad.' },
  EN_TRAMITE: { etiqueta: 'En trámite', tono: 'info', descripcion: 'Presentado: la entidad lo tiene.' },
  OBSERVADO: { etiqueta: 'Observado', tono: 'aviso', descripcion: 'La entidad lo observó: hay algo que subsanar, y la nota dice qué.' },
  POR_ANULAR: { etiqueta: 'Espera el visto para anularse', tono: 'aviso', descripcion: 'Quien lo lleva pidió anularlo: no se cambia hasta que Gerencia responda.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro', descripcion: 'Quedó sin efecto, con su motivo y el visto de Gerencia.' },
}

/** Cuántas unidades trae la lista para elegir como mucho: el tope de filas de la API. La ventana lo dice si se llega. */
export const MAXIMO_UNIDADES_PARA_ELEGIR = 1000

/** Los avisos antes del vencimiento que admite un tipo, como `ck_tramite_tipo_datos`. */
export const MAXIMO_AVISOS_DEL_TIPO = 5
export const MAXIMO_DIAS_DE_AVISO = 120

/**
 * «30, 15 y 7» escrito por la persona, a la lista que guarda el tipo: enteros
 * de 0 a 120, de más a menos y sin repetir. `null` si algo no es un número de
 * esos, o si no quedan de uno a cinco.
 */
export function diasDeAvisoDesdeTexto(texto: string): number[] | null {
  const partes = texto
    .split(/[\s,;y]+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (partes.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > MAXIMO_DIAS_DE_AVISO)) return null
  const dias = [...new Set(partes.map(Number))].sort((a, b) => b - a)
  return dias.length >= 1 && dias.length <= MAXIMO_AVISOS_DEL_TIPO ? dias : null
}

/** «30, 15 y 7 días antes», «el mismo día». */
export function diasDeAvisoEnTexto(dias: number[]): string {
  if (dias.length === 0) return 'Sin avisos'
  if (dias.length === 1) return dias[0] === 0 ? 'El mismo día' : `${dias[0]} ${dias[0] === 1 ? 'día' : 'días'} antes`
  return `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]} días antes`
}

/**
 * Cómo va el plazo, con los días que cuenta la base con la fecha de Lima:
 * «Venció hace 3 días», «Vence hoy», «Vence en 5 días». `null` sin fecha límite
 * o con el trámite anulado.
 */
export function plazoDelTramite(dias: number | null): { texto: string; tono: Tono } | null {
  if (dias === null) return null
  if (dias < 0) return { texto: `Venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, tono: 'peligro' }
  if (dias === 0) return { texto: 'Vence hoy', tono: 'peligro' }
  if (dias === 1) return { texto: 'Vence mañana', tono: 'aviso' }
  return { texto: `Vence en ${dias} días`, tono: dias <= 7 ? 'aviso' : 'neutro' }
}

/** «ABC-123 · M-0045 · Furgón». */
export function nombreDeLaUnidad(u: { placa: string | null; codigo_interno: string | null; carroceria: string | null }): string {
  return [u.placa ?? 'Sin placa', u.codigo_interno, u.carroceria].filter(Boolean).join(' · ')
}
