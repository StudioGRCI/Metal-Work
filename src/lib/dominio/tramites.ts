import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * Los trámites (plan «El puesto de Tramitador», entrega 1, migración
 * 20261126997100). El Tramitador registra y lleva los de cada unidad (tarjeta
 * de propiedad, placas, certificados) y los de la empresa (licencias, SOAT,
 * permisos); Gerencia y Administración los consultan, Ventas solo los de una
 * unidad, y Gerencia aprueba la anulación. Lo que la pantalla y las acciones
 * comparten con la base. La entrega 2 (migración 20261127002000) suma el
 * expediente: sus archivos, sus gestiones y el cierre con el documento final.
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
  CONCLUIDO: { etiqueta: 'Concluido', tono: 'exito', descripcion: 'La entidad entregó el documento: está en el expediente.' },
  POR_ANULAR: { etiqueta: 'Espera el visto para anularse', tono: 'aviso', descripcion: 'Quien lo lleva pidió anularlo: no se cambia hasta que Gerencia responda.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro', descripcion: 'Quedó sin efecto, con su motivo y el visto de Gerencia.' },
}

/**
 * De dónde viene el trámite (`tramites.origen`, entrega 4, migración
 * 20261127160000): lo registró alguien, lo abrió la base al terminar la OT, o
 * es la renovación de uno concluido.
 */
export const ORIGEN_TRAMITE: Record<string, { etiqueta: string; descripcion: string }> = {
  MANUAL: { etiqueta: 'Registrado', descripcion: 'Lo registró quien lleva los trámites.' },
  OT: { etiqueta: 'Abierto por la OT', descripcion: 'Lo abrió el sistema al terminar la unidad de la OT, con su fecha límite.' },
  RENOVACION: { etiqueta: 'Renovación', descripcion: 'Renueva el documento de un trámite concluido.' },
}

/** Los días hábiles desde el término de la OT que admite un tipo, como `ck_tramite_tipo_ot`. */
export const MINIMO_DIAS_DESDE_TERMINO_OT = 1
export const MAXIMO_DIAS_DESDE_TERMINO_OT = 60

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
export function plazoDelTramite(dias: number | null, porVencer?: boolean): { texto: string; tono: Tono } | null {
  if (dias === null) return null
  if (dias < 0) return { texto: `Venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, tono: 'peligro' }
  if (dias === 0) return { texto: 'Vence hoy', tono: 'peligro' }
  // Con `por_vencer` de la base, el ámbar es el mismo de la vista «Por vencer»:
  // los días de aviso de su tipo (30 en un SOAT, 5 en la tarjeta), no un tope fijo.
  const enAviso = porVencer ?? dias <= 7
  if (dias === 1) return { texto: 'Vence mañana', tono: porVencer === false ? 'neutro' : 'aviso' }
  return { texto: `Vence en ${dias} días`, tono: enAviso ? 'aviso' : 'neutro' }
}

/** «ABC-123 · M-0045 · Furgón». */
export function nombreDeLaUnidad(u: { placa: string | null; codigo_interno: string | null; carroceria: string | null }): string {
  return [u.placa ?? 'Sin placa', u.codigo_interno, u.carroceria].filter(Boolean).join(' · ')
}

/** El bucket privado del expediente (migración 20261127002000): la ruta es `{trámite}/{archivo}`. */
export const BUCKET_TRAMITES = 'tramites'

/** El tope de cada archivo del expediente, como el del bucket. */
export const MAXIMO_MB_TRAMITES = 20

/** Lo que admite el expediente y con qué extensión se guarda, como `tramite_archivo_subido`. */
export const TIPOS_ARCHIVO_TRAMITES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Qué es cada archivo del expediente, como `ck_tramite_archivo_datos`. El documento final es el que cierra el trámite. */
export const CLASE_DE_ARCHIVO: Record<string, { etiqueta: string; tono: Tono; descripcion: string }> = {
  CARGO: { etiqueta: 'Cargo', tono: 'info', descripcion: 'El cargo de presentación que sella la entidad.' },
  RECIBO: { etiqueta: 'Recibo', tono: 'neutro', descripcion: 'El recibo o el voucher de una tasa.' },
  OTRO: { etiqueta: 'Otro documento', tono: 'neutro', descripcion: 'Una esquela, una carta, lo que haga falta guardar.' },
  DOCUMENTO_FINAL: { etiqueta: 'Documento final', tono: 'exito', descripcion: 'Lo que entrega la entidad: es el que cierra el trámite.' },
}

/** Las clases que se suben con «Subir archivo»: el documento final entra al cerrar el trámite. */
export const CLASES_QUE_SE_SUBEN = ['CARGO', 'RECIBO', 'OTRO'] as const
