'use client'

import { useState } from 'react'

import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'

import { NuevaPlanilla } from './formularios'

/**
 * «Crear planilla del mes», abierta si al entrar no había ninguna: es lo único
 * que se puede hacer. El valor se fija una vez; si siguiera a los datos, al crear
 * la primera se cerraba y tapaba su «Planilla creada», y las otras dos del mes
 * pedían volver a abrirla.
 */
export function CrearPlanilla({ sinPlanillas }: { sinPlanillas: boolean }) {
  const [abierta] = useState(sinPlanillas)
  return (
    <SeccionDesplegable titulo="Crear planilla del mes" abierta={abierta} className="mb-5">
      <NuevaPlanilla />
    </SeccionDesplegable>
  )
}
