import { moneda, porcentaje, type CodigoMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Una cifra calculada se lee en las dos unidades a la vez: el porcentaje y lo
 * que vale en plata (DKS, 27/10/2026, «toda la matemática sea porcentaje y
 * costo»). Lo primero va con el peso de la cifra y lo segundo al lado, en
 * suave, siempre en el mismo orden para que el ojo no tenga que leer la
 * etiqueta dos veces.
 *
 *   <PorcentajeYCosto porcentaje={40} costo={3200} />          → **40 %** · S/ 3,200.00
 *   <PorcentajeYCosto porcentaje={12.5} costo={1234} primero="costo" decimales={1} />
 *                                                               → **S/ 1,234.00** · 12,5 %
 *
 * Sin porcentaje (no hay total contra qué medir) o sin costo (no hay monto)
 * sale solo lo que hay, y con los dos en nulo, «—». El formateo es el de
 * `src/lib/format.ts`; aquí no se calcula nada.
 */
export function PorcentajeYCosto({
  porcentaje: pct,
  costo,
  moneda: codigo = 'PEN',
  primero = 'porcentaje',
  decimales = 0,
  tono,
  className,
  separador = ' · ',
}: {
  porcentaje: number | string | null | undefined
  costo: number | string | null | undefined
  moneda?: CodigoMoneda
  /** Cuál de las dos lleva el peso: por defecto el porcentaje. */
  primero?: 'porcentaje' | 'costo'
  decimales?: number
  /** Clase de color de la cifra principal (`text-peligro`, `text-exito`…). */
  tono?: string
  className?: string
  separador?: string
}) {
  const textoPct = pct === null || pct === undefined ? null : porcentaje(pct, decimales)
  const textoCosto = costo === null || costo === undefined ? null : moneda(costo, codigo)
  if (textoPct === null && textoCosto === null) return <span className={cn('tabular text-texto-tenue', className)}>—</span>

  const [principal, secundario] = primero === 'costo' ? [textoCosto, textoPct] : [textoPct, textoCosto]
  // Si falta la principal, la otra pasa a ser la cifra.
  const grande = principal ?? secundario
  const chica = principal === null ? null : secundario

  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      <span className={cn('font-medium', tono ?? 'text-texto')}>{grande}</span>
      {chica !== null && <span className="text-texto-suave">{separador}{chica}</span>}
    </span>
  )
}
