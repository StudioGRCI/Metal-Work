/**
 * El «Formato para evaluación del desempeño laboral del personal de la empresa
 * Metal Work Perú SAC», tal como lo llena Diseño e Ingeniería. Los textos son
 * los del formato, palabra por palabra: la evaluación se imprime, se firma y
 * Administración la compara con la de papel.
 *
 * El orden importa: la base guarda solo las veinte respuestas en este orden
 * (`diseno_evaluaciones.respuestas`). Cambiar un texto de lugar cambiaría lo
 * que dicen las evaluaciones ya enviadas.
 */
export const CRITERIOS_DISENO = [
  { grupo: 'Orientación de resultados', nombre: 'Termina su trabajo oportunamente' },
  { grupo: 'Orientación de resultados', nombre: 'Cumple con las tareas que se le encomienda' },
  { grupo: 'Orientación de resultados', nombre: 'Realiza un volumen adecuado de trabajo' },
  { grupo: 'Calidad', nombre: 'No comete errores en el trabajo' },
  { grupo: 'Calidad', nombre: 'Hace uso racional de los recursos' },
  { grupo: 'Calidad', nombre: 'No requiere de supervisión frecuente' },
  { grupo: 'Calidad', nombre: 'Se muestra profesional en el trabajo' },
  { grupo: 'Calidad', nombre: 'Se muestra respetuoso y amable en el trato' },
  { grupo: 'Relaciones interpersonales', nombre: 'Se muestra cortés con el personal y con sus compañeros' },
  { grupo: 'Relaciones interpersonales', nombre: 'Brinda una adecuada orientación a sus compañeros' },
  { grupo: 'Relaciones interpersonales', nombre: 'Evita los conflictos dentro del trabajo' },
  { grupo: 'Iniciativa', nombre: 'Muestra nuevas ideas para mejorar los procesos' },
  { grupo: 'Iniciativa', nombre: 'Se muestra asequible al cambio' },
  { grupo: 'Iniciativa', nombre: 'Se anticipa a las dificultades' },
  { grupo: 'Iniciativa', nombre: 'Tiene gran capacidad para resolver problemas' },
  { grupo: 'Trabajo en equipo', nombre: 'Muestra aptitud para integrarse al equipo' },
  { grupo: 'Trabajo en equipo', nombre: 'Se identifica fácilmente con los objetivos del equipo' },
  { grupo: 'Organización', nombre: 'Planifica sus actividades' },
  { grupo: 'Organización', nombre: 'Hace uso de indicadores' },
  { grupo: 'Organización', nombre: 'Se preocupa por alcanzar las metas' },
] as const

/** Los criterios agrupados por área del desempeño, con su número de orden. */
export function criteriosPorGrupo() {
  const grupos: { grupo: string; criterios: { indice: number; nombre: string }[] }[] = []
  CRITERIOS_DISENO.forEach((criterio, indice) => {
    const ultimo = grupos.at(-1)
    if (ultimo?.grupo === criterio.grupo) ultimo.criterios.push({ indice, nombre: criterio.nombre })
    else grupos.push({ grupo: criterio.grupo, criterios: [{ indice, nombre: criterio.nombre }] })
  })
  return grupos
}

/** La escala del formato: cada puntaje es un nivel, de muy bajo a muy alto. */
export const ESCALA_DISENO = [
  { valor: 1, nivel: 'Muy bajo', rendimiento: 'Inferior. Rendimiento laboral no aceptable.' },
  { valor: 2, nivel: 'Bajo', rendimiento: 'Inferior al promedio. Rendimiento laboral regular.' },
  { valor: 3, nivel: 'Moderado', rendimiento: 'Promedio. Rendimiento laboral bueno.' },
  { valor: 4, nivel: 'Alto', rendimiento: 'Superior al promedio. Rendimiento laboral muy bueno.' },
  { valor: 5, nivel: 'Muy alto', rendimiento: 'Superior. Rendimiento laboral excelente.' },
] as const

export const TITULO_FORMATO_EVALUACION =
  'Formato para evaluación del desempeño laboral del personal de la empresa Metal Work Perú SAC'

export const PREGUNTA_EVALUACION =
  'En qué grado cree usted que el trabajador tiene desarrolladas las competencias que se presentan a continuación. Marque con una X el número que refleja su opinión.'

/** Las instrucciones del formato, en su orden. */
export const INSTRUCCIONES_EVALUACION = [
  'Antes de iniciar la evaluación del personal a su cargo, lea bien las instrucciones; si tiene duda, consulte con el personal responsable de la unidad de Personal.',
  'Lea bien el contenido de la competencia y comportamiento a evaluar.',
  'En forma objetiva y de conciencia asigne el puntaje correspondiente.',
  'Recuerde que, en la escala para ser utilizada por el evaluador, cada puntaje corresponde a un nivel que va de Muy bajo a Muy alto.',
  'En el espacio relacionado a comentarios, es necesario que anote lo adicional que usted quiere remarcar.',
  'Los formatos de evaluación deben hacerse en duplicado, y deben estar firmados por el evaluador y el ratificador (jefe del evaluador), si es necesario agregar algún comentario general a la evaluación.',
  'No se olvide firmar todas las hojas de evaluación.',
  'La entrega de los formatos de evaluación es con documento dirigido a la Dirección correspondiente, bajo responsabilidad funcional, como máximo a los dos (02) días de recepcionado el formato.',
] as const

/** Veinte respuestas de 1 a 5 suman el puntaje total, sobre 100 %. */
export function puntajeDiseno(respuestas: readonly number[]): number {
  if (respuestas.length !== CRITERIOS_DISENO.length ||
      respuestas.some(valor => !Number.isInteger(valor) || valor < 1 || valor > 5)) {
    throw new Error('La evaluación requiere veinte puntajes entre 1 y 5.')
  }
  return respuestas.reduce((total, valor) => total + valor, 0)
}

/** El puntaje de un área del desempeño y su máximo posible. */
export function puntajeDeGrupo(respuestas: readonly number[], grupo: string) {
  let puntaje = 0
  let maximo = 0
  CRITERIOS_DISENO.forEach((criterio, i) => {
    if (criterio.grupo !== grupo) return
    puntaje += respuestas[i] ?? 0
    maximo += 5
  })
  return { puntaje, maximo }
}

export type EstadoEvaluacion = 'BORRADOR' | 'ENVIADA' | 'OBSERVADA' | 'RECIBIDA'

/** El mes de ingreso viaja como «2026-08» desde el formulario y se guarda como el día 1. */
export function mesDeIngreso(valor: string | null | undefined): string | null {
  const partes = valor ? /^(\d{4})-(\d{2})/.exec(valor.trim()) : null
  return partes ? `${partes[1]}-${partes[2]}` : null
}
