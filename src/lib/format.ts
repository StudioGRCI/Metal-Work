/** Formateo para Perú: soles, fechas cortas y cantidades de almacén. */

const MONEDAS = { PEN: 'S/', USD: 'US$' } as const

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

export function fecha(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fechaHora(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fechaLarga(valor: string | Date | null | undefined) {
  if (!valor) return '—'
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
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

/** Días entre hoy y una fecha, negativo si ya pasó. Sirve para los vencimientos. */
export function diasHasta(valor: string | Date | null | undefined): number | null {
  if (!valor) return null
  const d = typeof valor === 'string' ? new Date(valor) : valor
  if (Number.isNaN(d.getTime())) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const objetivo = new Date(d)
  objetivo.setHours(0, 0, 0, 0)
  return Math.round((objetivo.getTime() - hoy.getTime()) / 86400000)
}

export function iniciales(nombres?: string | null, apellidos?: string | null) {
  return `${nombres?.[0] ?? ''}${apellidos?.[0] ?? ''}`.toUpperCase() || '—'
}
