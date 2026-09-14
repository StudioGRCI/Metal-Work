'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { eliminarReporte } from '@/app/(app)/avance/acciones-revision'
import { Boton } from '@/components/ui/boton'
import { useEnvio } from '@/lib/envio'
import type { ClaseReporte } from '@/lib/sesion'

/**
 * Borrar un reporte, con una segunda confirmación en el mismo lugar: no se
 * deshace y, si trae fotos, se van con él. Al borrar, la pantalla se repinta y
 * el reporte desaparece de la lista.
 */
export function EliminarReporte({
  clase,
  id,
  conFotos = false,
}: {
  clase: ClaseReporte
  id: string
  conFotos?: boolean
}) {
  const [confirmando, setConfirmando] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(eliminarReporte)

  if (!confirmando) {
    return (
      <Boton
        type="button"
        tamano="sm"
        variante="fantasma"
        onClick={() => {
          limpiar()
          setConfirmando(true)
        }}
      >
        <Trash2 aria-hidden className="size-3.5 text-peligro" />
        Eliminar
      </Boton>
    )
  }

  return (
    <form
      onSubmit={alEnviar}
      className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2"
    >
      <input type="hidden" name="clase" value={clase} />
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-peligro">
        ¿Eliminar este reporte?{conFotos ? ' Se van también sus fotos.' : ''} No se puede deshacer.
      </span>
      <span className="flex gap-2">
        <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
          Sí, eliminar
        </Boton>
        <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setConfirmando(false)}>
          No
        </Boton>
      </span>
      {error && (
        <p role="alert" className="w-full text-xs font-medium text-peligro">
          {error}
        </p>
      )}
    </form>
  )
}
