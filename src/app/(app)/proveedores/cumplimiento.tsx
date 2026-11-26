import { Fragment, type ReactNode } from 'react'

import type { CumplimientoDelProveedor } from '@/lib/datos/proveedores'
import { cn } from '@/lib/utils'

const veces = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`

/**
 * Cómo le fue a un proveedor (Plan 4.3): cuántas compras se le hicieron; de las
 * que llegaron, cuántas a tiempo contra la fecha que prometió al emitirlas;
 * cuántas pasaron esa fecha sin llegar, y de cuántas OC Almacén le devolvió
 * algo. La que se atrasó por causa nuestra (pago, transporte o aprobación,
 * según el último motivo anotado antes de que llegara) se dice aparte y no cuenta. Lo que pesa contra el proveedor va en tono de aviso, siempre con su
 * texto. Solo cuentas, sin importes. En la columna va en renglones; bajo el
 * nombre, en uno solo.
 */
export function Cumplimiento({
  datos,
  enLinea = false,
  className,
}: {
  datos: CumplimientoDelProveedor | undefined
  enLinea?: boolean
  className?: string
}) {
  const c = datos ?? { compras: 0, llegaron: 0, medidas: 0, a_tiempo: 0, devueltas: 0, atrasadas: 0, sin_fecha: 0, nuestras: 0 }
  const partes: { clave: string; texto: ReactNode; aviso?: boolean; fuerte?: boolean }[] = []
  if (c.compras === 0) {
    partes.push({ clave: 'nada', texto: 'Sin compras todavía' })
  } else {
    partes.push({ clave: 'compras', texto: veces(c.compras, 'compra', 'compras'), fuerte: true })
    if (c.llegaron === 0) partes.push({ clave: 'tiempo', texto: 'Ninguna llegó completa todavía' })
    else if (c.medidas > 0)
      partes.push({
        clave: 'tiempo',
        texto: (
          <>
            <span className="tabular">
              {c.a_tiempo} de {c.medidas}
            </span>{' '}
            {c.medidas === 1 ? 'llegada' : 'llegadas'} a tiempo
          </>
        ),
        // En aviso también si otras pasaron la fecha sin llegar: «1 de 1» no es un proveedor sin falla.
        aviso: c.a_tiempo < c.medidas || c.atrasadas > 0,
      })
    if (c.sin_fecha > 0)
      partes.push({ clave: 'sin-fecha', texto: `${veces(c.sin_fecha, 'llegó', 'llegaron')} sin fecha prometida` })
    if (c.atrasadas > 0)
      partes.push({ clave: 'atrasadas', texto: `${veces(c.atrasadas, 'atrasada', 'atrasadas')} sin llegar completa${c.atrasadas === 1 ? '' : 's'}`, aviso: true })
    if (c.nuestras > 0)
      partes.push({ clave: 'nuestras', texto: `${veces(c.nuestras, 'atrasada', 'atrasadas')} por pago, transporte o aprobación (no ${c.nuestras === 1 ? 'cuenta' : 'cuentan'})` })
    partes.push(
      c.devueltas > 0
        ? { clave: 'devueltas', texto: `${c.devueltas} con devolución`, aviso: true }
        : { clave: 'devueltas', texto: 'Sin devoluciones' },
    )
  }
  return (
    <p
      data-cumplimiento
      className={cn('text-texto-suave', enLinea ? 'text-xs' : 'flex flex-col text-sm', className)}
    >
      {partes.map((p, i) => (
        <Fragment key={p.clave}>
          {/* Entre partes, un separador sin color: a la vista «·» en el renglón; al lector, un punto y coma también en la columna (las partes llevan comas). */}
          {i > 0 && (enLinea ? ' · ' : <span className="sr-only">; </span>)}
          {/* Sin `whitespace-nowrap`: una parte larga entera ensanchaba la columna del nombre y corría la tabla a 1 024 px. */}
          <span className={cn(p.fuerte && 'text-texto', p.aviso && 'text-aviso')}>
            {enLinea && i > 0 && typeof p.texto === 'string' ? p.texto.charAt(0).toLowerCase() + p.texto.slice(1) : p.texto}
          </span>
        </Fragment>
      ))}
    </p>
  )
}
