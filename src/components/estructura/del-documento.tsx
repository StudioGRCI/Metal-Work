'use client'

import type { ReactNode } from 'react'

import { DocumentoDeLaPantalla } from '@/lib/envio'

/**
 * Lo de dentro es de `documento`, que eligió la búsqueda (?codigo=, ?semana=).
 * Next no vuelve a montar la pantalla cuando solo cambia la búsqueda: el
 * formulario del código A seguía con lo escrito para A y el código B oculto, y
 * su reenvío guardaba el plano de A en el B (X1 de la crítica, cuadragésima
 * quinta pasada). Con otro documento todo se monta de nuevo, y cada formulario
 * de dentro dice de cuál es (`DocumentoDeLaPantalla`).
 */
export function DelDocumento({ documento, children }: { documento: string; children: ReactNode }) {
  return (
    <DocumentoDeLaPantalla key={documento} value={documento}>
      {children}
    </DocumentoDeLaPantalla>
  )
}
