import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { moneda } from '@/lib/format'
import {
  agruparPorVencimiento,
  NOMBRE_DEL_GRUPO,
  totalesPorMoneda,
  type GrupoDeVencimiento,
  type TotalesPorMoneda,
} from '@/lib/dominio/vencimiento'

/** El color del rótulo: lo vencido en rojo, lo de hoy en ámbar; lo demás, sin alarma. */
const TONO: Record<GrupoDeVencimiento | 'APARTE', string> = {
  VENCIDO: 'text-peligro',
  HOY: 'text-aviso',
  SEMANA: 'text-texto',
  DESPUES: 'text-texto',
  SIN_FECHA: 'text-texto-suave',
  APARTE: 'text-texto-suave',
}

/** «S/ 1,200.00 · US$ 300.00»: cada moneda con lo suyo, sin pasar una a la otra. */
export function TotalPorMoneda({ totales, className }: { totales: TotalesPorMoneda; className?: string }) {
  const partes = (['PEN', 'USD'] as const).filter((m) => totales[m] > 0)
  if (partes.length === 0) return null
  return (
    <span className={cn('tabular', className)}>
      {partes.map((m, i) => (
        <span key={m} className="whitespace-nowrap" data-total-moneda={m}>
          {i > 0 && <span className="text-texto-suave"> · </span>}
          {moneda(totales[m], m)}
        </span>
      ))}
    </span>
  )
}

/**
 * Un grupo de la lista: su rótulo, cuántos documentos y su total en cada
 * moneda, y debajo sus filas. `aparte` es el grupo del final con lo que no se
 * paga todavía: va gris y no se confunde con los de fecha.
 */
function Grupo({
  lista,
  clave,
  titulo,
  cuantos,
  totales,
  aparte = false,
  children,
}: {
  lista: string
  clave: GrupoDeVencimiento | 'APARTE'
  titulo: string
  cuantos: string
  totales: TotalesPorMoneda | null
  aparte?: boolean
  children: ReactNode
}) {
  const id = `${lista}-${clave.toLowerCase()}`
  return (
    <section aria-labelledby={id} className="space-y-3" data-grupo-vencimiento={clave}>
      <header className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-1', aparte ? 'border-dashed border-borde' : 'border-borde')}>
        {/* `scroll-mt-20`: el índice de arriba salta aquí sin que la barra tape el rótulo. Pesa como el nombre de cada fila. */}
        <h3 id={id} className={cn('scroll-mt-20 text-base font-semibold', TONO[clave])}>
          {titulo}
          <span className="font-normal text-texto-suave"> · {cuantos}</span>
        </h3>
        {totales && <TotalPorMoneda totales={totales} className="text-sm font-semibold text-texto" />}
      </header>
      {children}
    </section>
  )
}

/**
 * Una lista de documentos por cobrar o por pagar repartida por vencimiento
 * (plan 11.1): «Vencido», «Vence hoy», «Esta semana», «Después» y, si los hay,
 * los que no tienen fecha. Cada grupo con su total en soles y en dólares por
 * separado. Cada fila la pinta quien llama, tal como ya la pintaba: el grupo no
 * le quita nada.
 *
 * `aparte` son las filas que no se pueden pagar todavía (esperan a otra área):
 * van al final, en su propio grupo y con su propio total, para que no inflen lo
 * que vence.
 */
export function GruposPorVencimiento<T>({
  lista,
  filas,
  hoy,
  dia,
  moneda: monedaDe,
  monto,
  clave,
  nombre: [uno, varios],
  fila,
  aparte,
}: {
  /** Nombre corto y único en la pantalla (por pagar tiene tres listas): arma el id de cada rótulo. */
  lista: string
  filas: readonly T[]
  hoy: string
  dia: (fila: T) => string | null | undefined
  moneda: (fila: T) => string | null
  monto: (fila: T) => number
  clave: (fila: T) => string
  /** Cómo se cuentan: ['factura', 'facturas']. */
  nombre: [string, string]
  fila: (fila: T) => ReactNode
  aparte?: { titulo: string; filas: readonly T[]; conTotal?: boolean }
}) {
  const cuantos = (n: number) => `${n} ${n === 1 ? uno : varios}`
  const grupos = agruparPorVencimiento(filas, dia, hoy)
  // El índice de la lista: cada grupo con su total, para saber de un vistazo cuánto vence hoy o esta
  // semana sin bajar (en el teléfono la lista mide miles de píxeles). Con un solo grupo no hace falta.
  const indice = [
    ...grupos.map((g) => ({ clave: g.grupo as GrupoDeVencimiento | 'APARTE', titulo: NOMBRE_DEL_GRUPO[g.grupo], totales: totalesPorMoneda(g.filas, monedaDe, monto), n: g.filas.length })),
    ...(aparte && aparte.filas.length > 0
      ? [{ clave: 'APARTE' as const, titulo: aparte.titulo, totales: aparte.conTotal === false ? null : totalesPorMoneda(aparte.filas, monedaDe, monto), n: aparte.filas.length }]
      : []),
  ]
  return (
    <div className="space-y-4">
      {indice.length > 1 && (
        <nav aria-label={`Ir a un grupo de la lista`} data-indice-vencimiento={lista}>
          <ul className="flex flex-wrap gap-2">
            {indice.map((g) => (
              <li key={g.clave}>
                <a
                  href={`#${lista}-${g.clave.toLowerCase()}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde px-3 text-xs hover:border-acento sm:min-h-9"
                >
                  <span className={cn('font-semibold', TONO[g.clave])}>{g.titulo}</span>
                  {g.totales ? <TotalPorMoneda totales={g.totales} className="font-medium text-texto" /> : <span className="text-texto-suave">{cuantos(g.n)}</span>}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {grupos.map((g) => (
        <Grupo
          key={g.grupo}
          lista={lista}
          clave={g.grupo}
          titulo={NOMBRE_DEL_GRUPO[g.grupo]}
          cuantos={cuantos(g.filas.length)}
          totales={totalesPorMoneda(g.filas, monedaDe, monto)}
        >
          {g.filas.map((f) => (
            <div key={clave(f)}>{fila(f)}</div>
          ))}
        </Grupo>
      ))}
      {aparte && aparte.filas.length > 0 && (
        <Grupo
          lista={lista}
          clave="APARTE"
          titulo={aparte.titulo}
          cuantos={cuantos(aparte.filas.length)}
          totales={aparte.conTotal === false ? null : totalesPorMoneda(aparte.filas, monedaDe, monto)}
          aparte
        >
          {aparte.filas.map((f) => (
            <div key={clave(f)}>{fila(f)}</div>
          ))}
        </Grupo>
      )}
    </div>
  )
}
