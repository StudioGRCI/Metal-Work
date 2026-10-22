import { Fragment } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import type { MaterialEnStock } from '@/lib/datos/stock-almacen'
import { redondearCantidad } from '@/lib/dominio/almacen'
import { cantidad } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Para qué código es lo que no está libre, con el RQ que lo separó, y si se separó más de lo que hay. */
export function SeparadoPara({ material: m, className }: { material: MaterialEnStock; className?: string }) {
  // Lo separado pasa lo que hay: se separó dos veces lo mismo o salió por otro
  // lado. Lo libre queda en cero y Almacén tiene que revisarlo.
  const deMas = m.de_mas
  return (
    <ul className={cn('space-y-0.5 text-xs', className)}>
      {m.por_codigo.map((c) => (
        <li key={c.codigo}>
          <span className="font-mono text-texto">{c.codigo}</span>{' '}
          <span className="tabular whitespace-nowrap text-texto-suave">
            {cantidad(c.cantidad)} {m.unidad}
          </span>
          {c.requerimientos.length > 0 && (
            <span className="tabular block text-[11px] text-texto-suave">
              {c.requerimientos.map((n, i) => (
                <Fragment key={n}>
                  {i > 0 && ', '}
                  <span className="whitespace-nowrap">{n}</span>
                </Fragment>
              ))}
            </span>
          )}
          {/* El accesorio que entró para la unidad y ningún RQ tomó: quien pide para ese código lo puede usar. */}
          {c.cantidad > c.de_requerimientos && (
            <span className="tabular block text-[11px] text-texto-suave" data-para-la-unidad>
              {cantidad(redondearCantidad(c.cantidad - c.de_requerimientos))} {m.unidad} para la unidad, sin RQ
            </span>
          )}
        </li>
      ))}
      {m.reservado_ot > 0 && (
        <li className="text-texto-suave">
          Pedidos de OT: <span className="tabular">{cantidad(m.reservado_ot)} {m.unidad}</span>
        </li>
      )}
      {deMas > 0 && (
        <li className="pt-0.5">
          <Insignia tono="aviso" className="whitespace-normal" data-separado-de-mas>
            Se separó {cantidad(deMas)} {m.unidad} más de lo que hay
          </Insignia>
        </li>
      )}
    </ul>
  )
}
