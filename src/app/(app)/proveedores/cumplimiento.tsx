import { Fragment, type ReactNode } from 'react'

import type { CumplimientoDelProveedor } from '@/lib/datos/proveedores'
import { cn } from '@/lib/utils'

const veces = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`

/**
 * Cómo le fue a un proveedor (Plan 4.3): cuántas compras se le hicieron; de las
 * que llegaron, cuántas a tiempo contra la fecha que prometió al emitirlas;
 * cuántas pasaron esa fecha sin llegar, y de cuántas OC Almacén le devolvió
 * algo. Lo que pesa contra el proveedor va en tono de aviso, siempre con su
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
  const c = datos ?? { compras: 0, llegaron: 0, medidas: 0, a_tiempo: 0, devueltas: 0, atrasadas: 0 }
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
    if (c.llegaron > c.medidas)
      partes.push({
        clave: 'sin-fecha',
        texto: `${veces(c.llegaron - c.medidas, 'llegó', 'llegaron')} sin fecha prometida`,
      })
    if (c.atrasadas > 0)
      partes.push({ clave: 'atrasadas', texto: `${veces(c.atrasadas, 'atrasada', 'atrasadas')} sin llegar completa${c.atrasadas === 1 ? '' : 's'}`, aviso: true })
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
          {/* Entre partes, un separador sin color: a la vista «·» en el renglón; al lector, una coma también en la columna. */}
          {i > 0 && (enLinea ? ' · ' : <span className="sr-only">, </span>)}
          {/* En el renglón, cada parte entera: corta entre partes, no a mitad de frase. */}
          <span className={cn(p.fuerte && 'text-texto', p.aviso && 'text-aviso', enLinea && 'whitespace-nowrap')}>
            {enLinea && i > 0 && typeof p.texto === 'string' ? p.texto.charAt(0).toLowerCase() + p.texto.slice(1) : p.texto}
          </span>
        </Fragment>
      ))}
    </p>
  )
}
