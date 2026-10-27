'use client'

import { useRouter } from 'next/navigation'

import { Seleccion } from '@/components/ui/campos'

/** Una opción del filtro ya resuelta a su enlace: la arma `PastillaFiltro` en el servidor. */
export type OpcionResuelta = { etiqueta: string; href: string; activa: boolean }

/**
 * El mismo filtro que las pastillas, en una lista desplegable para el teléfono:
 * nueve pastillas en cuatro filas dejaban el primer resultado a media pantalla
 * (Cotización, Adquisiciones, el kardex; auditoría del 27/10/2026). Elegir una
 * navega al enlace que la pastilla llevaba, así que conserva lo demás de la URL.
 */
export function SeleccionDeFiltro({ etiqueta, opciones, className }: { etiqueta: string; opciones: OpcionResuelta[]; className?: string }) {
  const router = useRouter()
  const activa = opciones.find((o) => o.activa) ?? opciones[0]
  return (
    <Seleccion aria-label={etiqueta} value={activa?.href ?? ''} onChange={(e) => router.push(e.target.value)} className={className}>
      {opciones.map((o) => (
        <option key={o.href} value={o.href}>
          {o.etiqueta}
        </option>
      ))}
    </Seleccion>
  )
}
