'use client'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { useEstadoCompartido } from '@/lib/estado-compartido'

export const CLAVE_LO_QUE_ENTRO = 'recojos:lo-que-entro'
export type LoQueEntro = { vez: number; texto: string }

/**
 * Lo que el conductor acaba de enviar desde una tarjeta que ya no está: con
 * «No se pudo recoger» la compra sale de su lista y la tarjeta se va con su
 * botón. Sin esto la compra se esfumaba sin una palabra y el cursor caía a la
 * página. Se lleva el cursor (`AvisoEnfocado`), una vez por envío.
 */
export function LoQueEntroEnRecojos() {
  const [entro] = useEstadoCompartido<LoQueEntro | null>(CLAVE_LO_QUE_ENTRO, null)
  if (!entro) return null
  return <AvisoEnfocado key={entro.vez}>{entro.texto}</AvisoEnfocado>
}
