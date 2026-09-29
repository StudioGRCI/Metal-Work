/** Criterios del formato de evaluación de Diseño e Ingeniería de Metal Work. */
export const CRITERIOS_DISENO = [
  { grupo: 'Orientación a resultados', nombre: 'Termina su trabajo oportunamente' },
  { grupo: 'Orientación a resultados', nombre: 'Cumple las tareas encomendadas' },
  { grupo: 'Orientación a resultados', nombre: 'Realiza un volumen adecuado de trabajo' },
  { grupo: 'Calidad', nombre: 'No comete errores en el trabajo' },
  { grupo: 'Calidad', nombre: 'Usa racionalmente los recursos' },
  { grupo: 'Calidad', nombre: 'No requiere supervisión frecuente' },
  { grupo: 'Calidad', nombre: 'Se muestra profesional en el trabajo' },
  { grupo: 'Calidad', nombre: 'Es respetuoso y amable en el trato' },
  { grupo: 'Relaciones interpersonales', nombre: 'Es cortés con el personal y sus compañeros' },
  { grupo: 'Relaciones interpersonales', nombre: 'Orienta adecuadamente a sus compañeros' },
  { grupo: 'Relaciones interpersonales', nombre: 'Evita conflictos dentro del trabajo' },
  { grupo: 'Iniciativa', nombre: 'Propone ideas para mejorar los procesos' },
  { grupo: 'Iniciativa', nombre: 'Se adapta a los cambios' },
  { grupo: 'Iniciativa', nombre: 'Se anticipa a las dificultades' },
  { grupo: 'Iniciativa', nombre: 'Resuelve problemas' },
  { grupo: 'Trabajo en equipo', nombre: 'Se integra al equipo' },
  { grupo: 'Trabajo en equipo', nombre: 'Se identifica con los objetivos del equipo' },
  { grupo: 'Organización', nombre: 'Planifica sus actividades' },
  { grupo: 'Organización', nombre: 'Usa indicadores' },
  { grupo: 'Organización', nombre: 'Busca alcanzar las metas' },
] as const

/** Veinte respuestas de 1 a 5 suman un puntaje directo sobre 100. */
export function puntajeDiseno(respuestas: readonly number[]): number {
  if (respuestas.length !== CRITERIOS_DISENO.length ||
      respuestas.some(valor => !Number.isInteger(valor) || valor < 1 || valor > 5)) {
    throw new Error('La evaluación requiere veinte puntajes entre 1 y 5.')
  }
  return respuestas.reduce((total, valor) => total + valor, 0)
}
