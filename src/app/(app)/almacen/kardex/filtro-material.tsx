'use client'

import { useState } from 'react'

import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'

/**
 * El material del filtro del kardex, con buscador: el almacén tiene cientos y
 * el desplegable del navegador obligaba a rodar hasta dar con el nombre. Va en
 * el `<form method="get">` de la página como el `select` al que reemplaza.
 */
export function FiltroMaterial({ id, inicial, materiales }: {
  id: string
  inicial: string
  materiales: { valor: string; etiqueta: string; detalle: string | null }[]
}) {
  const [valor, setValor] = useState(inicial)
  return (
    <SeleccionBuscable
      id={id}
      name="material"
      opciones={materiales}
      valor={valor}
      onChange={setValor}
      marcador="Todo el almacén"
      marcadorBusqueda="Nombre o código del material"
    />
  )
}
