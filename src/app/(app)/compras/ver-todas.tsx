import Link from 'next/link'

import { INACTIVA, PASTILLA } from '@/components/estructura/pastilla-filtro'
import { cn } from '@/lib/utils'

/**
 * «Ver todas», para salir del filtro «Atrasadas» cuando no deja nada: la misma
 * pantalla sin `ver`, con el resto de lo buscado (el código de la OS).
 */
export function VerTodas({ ruta, params }: { ruta: string; params: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams()
  for (const [nombre, valor] of Object.entries(params)) {
    if (nombre === 'ver' || nombre === 'pagina') continue
    if (typeof valor === 'string') {
      if (valor) query.set(nombre, valor)
    } else if (Array.isArray(valor)) {
      for (const uno of valor) if (uno) query.append(nombre, uno)
    }
  }
  const cadena = query.toString()
  return (
    <Link href={cadena ? `${ruta}?${cadena}` : ruta} className={cn(PASTILLA, INACTIVA)}>
      Ver todas
    </Link>
  )
}
