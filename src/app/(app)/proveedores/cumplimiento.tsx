import type { CumplimientoDelProveedor } from '@/lib/datos/proveedores'
import { cn } from '@/lib/utils'

const veces = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`

/**
 * Cómo le fue a un proveedor (Plan 4.3): cuántas compras se le hicieron, de las
 * que ya llegaron cuántas a tiempo contra la fecha que prometió al emitirlas, y
 * de cuántas OC Almacén le devolvió algo. Solo cuentas, sin importes. En la
 * columna va en renglones; en el teléfono, en uno solo bajo el nombre.
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
  const c = datos ?? { compras: 0, medidas: 0, a_tiempo: 0, devueltas: 0 }
  const partes =
    c.compras === 0
      ? [<span key="nada">Sin compras todavía</span>]
      : [
          <span key="compras" className="text-texto">
            {veces(c.compras, 'compra', 'compras')}
          </span>,
          <span key="tiempo">
            {c.medidas === 0 ? (
              'ninguna llegó todavía'
            ) : (
              <>
                <span className="tabular">
                  {c.a_tiempo} de {c.medidas}
                </span>{' '}
                a tiempo
              </>
            )}
          </span>,
          ...(c.devueltas > 0
            ? [
                <span key="devueltas" className="text-aviso">
                  {c.devueltas} con devolución
                </span>,
              ]
            : []),
        ]
  return (
    <p data-cumplimiento className={cn('text-xs text-texto-suave', enLinea ? '' : 'flex flex-col', className)}>
      {enLinea
        ? partes.map((parte, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {parte}
            </span>
          ))
        : partes}
    </p>
  )
}
