/** Formateo para Perú: soles, fechas cortas y cantidades de almacén. */

const MONEDAS = { PEN: 'S/', USD: 'US$' } as const

/**
 * Todo se lee en hora de Lima, corra donde corra. Sin fijarla, el servidor
 * -que está en UTC- y el navegador del taller muestran horas distintas, y un
 * parte cargado a las nueve de la noche aparece con la fecha del día siguiente.
 */
const ZONA = 'America/Lima'

/**
 * Las versiones de ICU no se ponen de acuerdo en qué espacio va antes de "a. m.":
 * unas ponen el fino, otras el duro. Da igual cuál sea, pero tiene que ser el
 * mismo en el servidor y en el navegador o React rehace el árbol al hidratar.
 */
function espaciosNormales(texto: string) {
  return texto.replace(/[\u202f\u00a0]/g, ' ')
}

export type CodigoMoneda = keyof typeof MONEDAS

export function moneda(valor: number | string | null | undefined, codigo: CodigoMoneda = 'PEN') {
  const n = Number(valor ?? 0)
  return `${MONEDAS[codigo] ?? 'S/'} ${n.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function numero(valor: number | string | null | undefined, decimales = 2) {
  return Number(valor ?? 0).toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

/** Cantidades de almacén: sin decimales inútiles (12 y no 12,0000). */
export function cantidad(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0)
  return n.toLocaleString('es-PE', { maximumFractionDigits: 4 })
}

export function porcentaje(valor: number | string | null | undefined, decimales = 0) {
  return `${Number(valor ?? 0).toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}%`
}

/**
 * Una fecha sin hora es un día del calendario, no un instante: la fecha de una
 * factura es la que dice el papel, y no cambia porque el servidor esté en otro
 * huso. Por eso se reordena el texto tal cual, sin convertir nada.
 */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

export function fecha(valor: string | Date | null | undefined) {
  if (!valor) return '—'

  if (typeof valor === 'string') {
    const partes = SOLO_FECHA.exec(valor.trim())
    if (partes) return `${partes[3]}/${partes[2]}/${partes[1]}`
  }

  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return espaciosNormales(
    d.toLocaleDateString('es-PE', {
      timeZone: ZONA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
  )
}

export function fechaHora(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return espaciosNormales(
    d.toLocaleString('es-PE', {
      timeZone: ZONA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  )
}

/** La hora de Lima, «13:39»: para decir a qué hora entró un reporte del día. */
export function hora(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return espaciosNormales(
    d.toLocaleTimeString('es-PE', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }),
  )
}

export function fechaLarga(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  // Igual que en fecha(): un día del calendario se lee tal cual.
  const d =
    typeof valor === 'string'
      ? new Date(SOLO_FECHA.test(valor.trim()) ? `${valor.trim()}T12:00:00` : valor)
      : valor
  if (Number.isNaN(d.getTime())) return '—'
  return espaciosNormales(
    d.toLocaleDateString('es-PE', {
      timeZone: ZONA,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  )
}

/** "hace 3 días", "en 2 semanas" — para la bitácora de la orden. */
export function tiempoRelativo(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'

  const segundos = Math.round((d.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('es-PE', { numeric: 'auto' })
  const tramos: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]

  for (const [unidad, factor] of tramos) {
    if (Math.abs(segundos) >= factor) return rtf.format(Math.round(segundos / factor), unidad)
  }
  return rtf.format(segundos, 'second')
}

/**
 * Días entre hoy y una fecha, negativo si ya pasó. Sirve para los vencimientos.
 *
 * La cuenta va sobre el calendario del taller, no sobre la zona en que corra el
 * servidor. Con `new Date()` y `setHours` el corte del día caía a las siete de
 * la tarde de Lima en Vercel —un requerimiento para hoy salía «vencido» desde
 * esa hora— y un día antes en una máquina con la zona de Lima, porque
 * `new Date('2026-09-05')` se lee como medianoche UTC. Las dos fechas se pasan
 * a la medianoche UTC de su día de Lima y ahí sí se restan.
 */
export function diasHasta(valor: string | Date | null | undefined): number | null {
  if (!valor) return null
  const objetivo = typeof valor === 'string' ? diaDeLima(valor) : diaUtcDe(valor)
  if (objetivo === null) return null
  const hoy = Date.parse(`${hoyLima()}T00:00:00Z`)
  return Math.round((objetivo - hoy) / 86400000)
}

/** El día que le toca a un texto de la base: si trae hora, se lee en Lima. */
function diaDeLima(texto: string): number | null {
  if (SOLO_FECHA.test(texto)) return Date.parse(`${texto}T00:00:00Z`)
  const d = new Date(texto)
  return Number.isNaN(d.getTime()) ? null : diaUtcDe(d)
}

/** La medianoche UTC del día que ese instante tiene en Lima. */
function diaUtcDe(d: Date): number | null {
  if (Number.isNaN(d.getTime())) return null
  const enLima = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return Date.parse(`${enLima}T00:00:00Z`)
}

/** Las iniciales de un texto de hasta dos palabras: «Jefe de producción» → «JP». */
export function iniciales(texto?: string | null) {
  const partes = (texto ?? '').trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(p))
  return `${partes[0]?.[0] ?? ''}${partes[1]?.[0] ?? ''}`.toUpperCase() || '—'
}

/**
 * Una fecha plana (YYYY-MM-DD) más o menos días, como texto: se opera al
 * mediodía UTC para que ninguna zona horaria la corra un día.
 */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * El puesto con el que se muestra una cuenta —el cargo, o el rol si no lo
 * tiene—, nunca el nombre de la persona (migración 109). Las cuentas son por
 * puesto: cuando cambia quien la usa, «Aprobada por Gerencia» sigue siendo
 * verdad. `puesto` es la columna calculada de `usuarios`; se pide en el
 * `select` como cualquier otra.
 */
export function puesto(cuenta?: { puesto?: string | null } | null): string {
  return cuenta?.puesto?.trim() || '—'
}

/**
 * Las etiquetas de un desplegable de cuentas: el puesto y, solo cuando dos
 * cuentas se llaman igual —hoy, dos soldadores—, el usuario del correo para
 * distinguirlas: «Soldador estructural · soldador2».
 */
export function etiquetasDePuesto<T extends { id: string; puesto?: string | null; correo?: string | null }>(
  cuentas: T[],
): Map<string, string> {
  const veces = new Map<string, number>()
  for (const c of cuentas) {
    const p = puesto(c)
    veces.set(p, (veces.get(p) ?? 0) + 1)
  }
  return new Map(
    cuentas.map((c) => {
      const p = puesto(c)
      const usuario = c.correo?.split('@')[0]
      return [c.id, (veces.get(p) ?? 0) > 1 && usuario ? `${p} · ${usuario}` : p]
    }),
  )
}

/**
 * La fecha de hoy en el taller (America/Lima), como YYYY-MM-DD comparable con
 * las fechas planas de la base. new Date().toISOString() daría la de UTC, que
 * de noche ya es la de mañana.
 */
export function hoyLima(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

