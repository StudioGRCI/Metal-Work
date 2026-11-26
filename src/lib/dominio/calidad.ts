import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * Calidad (migración 20261126700000): la inspección por código interno y etapa.
 * Lo que la pantalla y las acciones comparten con la base.
 */

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

export const RESULTADOS_INSPECCION = ['CONFORME', 'NO_CONFORME'] as const
export type ResultadoInspeccion = (typeof RESULTADOS_INSPECCION)[number]

export const RESULTADO_INSPECCION: Record<string, Def> = {
  CONFORME: { etiqueta: 'Conforme', tono: 'exito', descripcion: 'Está bien hecho. Queda anotado y no le llega nada al área.' },
  NO_CONFORME: {
    etiqueta: 'No conforme',
    tono: 'peligro',
    descripcion: 'Algo hay que corregir: escribe qué y, si puedes, pon una foto. Le llega al área. No detiene la etapa siguiente.',
  },
}

/** En quién está la inspección (`calidad_inspecciones.estado`). */
export const ESTADO_INSPECCION: Record<string, Def> = {
  CONFORME: { etiqueta: 'Conforme', tono: 'exito', descripcion: 'Sin observación.' },
  OBSERVADA: { etiqueta: 'Por corregir', tono: 'peligro', descripcion: 'Observada: espera que el área la corrija.' },
  CORREGIDA: { etiqueta: 'Por revisar', tono: 'aviso', descripcion: 'El área dice que la corrigió: la revisa Calidad.' },
  LEVANTADA: { etiqueta: 'Levantada', tono: 'exito', descripcion: 'Calidad dio la corrección por buena.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'neutro', descripcion: 'Quedó sin efecto, con su motivo.' },
}

/** Los estados en que la inspección todavía espera a alguien. */
export const ESTADOS_ABIERTOS = ['OBSERVADA', 'CORREGIDA'] as const

export const TIPOS_PASO_CALIDAD = ['CORREGIDA', 'OBSERVADA_DE_NUEVO', 'LEVANTADA'] as const
export type TipoPasoCalidad = (typeof TIPOS_PASO_CALIDAD)[number]

/** Cómo se lee cada paso del recorrido. */
export const PASO_CALIDAD: Record<string, Def> = {
  CORREGIDA: { etiqueta: 'El área la corrigió', tono: 'aviso' },
  OBSERVADA_DE_NUEVO: { etiqueta: 'Calidad la volvió a observar', tono: 'peligro' },
  LEVANTADA: { etiqueta: 'Calidad la levantó', tono: 'exito' },
}

/** El bucket privado de las fotos: la ruta es `{cuenta}/{inspección}/{foto}.jpg`. */
export const BUCKET_FOTOS_CALIDAD = 'fotos-calidad'

/** Hasta cuatro fotos por inspección y por paso, como exige `calidad_anotar_fotos`. */
export const MAXIMO_FOTOS_CALIDAD = 4

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_CALIDAD = 5

/** «hoy», «hace 1 día», «hace 3 días»: lo que lleva abierta, contado en la base con la fecha de Lima. */
export function diasAbierta(dias: number | null): string | null {
  if (dias === null) return null
  if (dias <= 0) return 'hoy'
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * Lo que dice el verde según a quién le llegó el aviso (`calidad_avisar_al_area`):
 * nunca «le avisamos al área» si no le llegó a nadie.
 */
export function aQuienLlego(avisado: string | null, area: string): string {
  switch (avisado) {
    case 'RESPONSABLE':
      return `Le llegó a la cuenta responsable de ${area}.`
    case 'AREA':
      return `Le llegó a las cuentas de ${area}.`
    case 'GERENCIA':
      return `${area} no tiene otra cuenta activa: le llegó a Gerencia.`
    case 'CALIDAD':
      return 'Le llegó a Calidad.'
    default:
      return 'No hay a quién avisarle por la campana: cuéntaselo en persona.'
  }
}
