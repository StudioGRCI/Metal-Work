import Link from 'next/link'

import { cn } from '@/lib/utils'

const SECCIONES = [
  { ruta: '/almacen', titulo: 'Existencias' },
  { ruta: '/almacen/movimientos', titulo: 'Movimientos' },
  { ruta: '/almacen/requerimientos', titulo: 'Requerimientos' },
  { ruta: '/almacen/compras', titulo: 'Órdenes de compra' },
  { ruta: '/almacen/materiales', titulo: 'Materiales' },
  { ruta: '/almacen/proveedores', titulo: 'Proveedores' },
]

export function SubNavegacionAlmacen({ activa }: { activa: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-borde" aria-label="Secciones de almacén">
      {SECCIONES.map((s) => {
        const esActiva = s.ruta === activa
        return (
          <Link
            key={s.ruta}
            href={s.ruta}
            aria-current={esActiva ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
              esActiva
                ? 'border-acento font-medium text-acento'
                : 'border-transparent text-texto-suave hover:border-borde-fuerte hover:text-texto',
            )}
          >
            {s.titulo}
          </Link>
        )
      })}
    </nav>
  )
}
