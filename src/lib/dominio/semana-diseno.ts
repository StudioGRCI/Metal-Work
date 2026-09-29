const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function inicioSemanaDiseno(dia: string): string {
  if (!FECHA.test(dia)) throw new Error('Indica una fecha válida.')
  const fecha = new Date(`${dia}T12:00:00Z`)
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== dia) {
    throw new Error('Indica una fecha válida.')
  }
  fecha.setUTCDate(fecha.getUTCDate() - ((fecha.getUTCDay() + 6) % 7))
  return fecha.toISOString().slice(0, 10)
}

export function finSemanaDiseno(inicio: string): string {
  const fecha = new Date(`${inicioSemanaDiseno(inicio)}T12:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() + 6)
  return fecha.toISOString().slice(0, 10)
}
