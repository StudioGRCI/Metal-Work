'use client'

import { Pencil } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { editarCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'

export function EditarCarroceria({
  id,
  nombre,
  descripcion,
}: {
  id: string
  nombre: string
  descripcion: string | null
  /**
   * Ya no se envía: si está activa lo decide el botón del catálogo, y la acción
   * lee la de ahora. Mandar la de cuando se pintó la página reactivaba la que
   * otro había desactivado mientras tanto.
   */
  activo?: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  // Corrige lo que el catálogo muestra: se cierra con la fila ya al día (`corrige`).
  const { alEnviar, enviando, error } = useEnvio(editarCarroceria, () => setAbierta(false), { corrige: true })
  // El rechazo del nombre va junto a su campo, que queda marcado y recibe el
  // cursor; lo demás («no se pudo guardar»), en el aviso de abajo, con el cursor.
  const delNombre = Boolean(error && /nombre/i.test(error))
  const campoNombre = useRef<HTMLInputElement>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, useCallback(() => (delNombre ? campoNombre.current : aviso.current), [delNombre]))
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={() => setAbierta(true)}>
        <Pencil aria-hidden className="size-3.5" /> Editar
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Editar ${nombre}`} descripcion="Cambia los datos visibles del catálogo. La ficha técnica del taller se conserva." ancho="md">
        <form onSubmit={alEnviar} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Nombre" htmlFor={`carroceria-nombre-${id}`} requerido error={delNombre ? error ?? undefined : undefined}>
            <Entrada ref={campoNombre} id={`carroceria-nombre-${id}`} name="nombre" defaultValue={nombre} required maxLength={120} />
          </Campo>
          <Campo etiqueta="Descripción" htmlFor={`carroceria-desc-${id}`}>
            <AreaTexto id={`carroceria-desc-${id}`} name="descripcion" defaultValue={descripcion ?? ''} maxLength={1000} rows={3} />
          </Campo>
          {error && !delNombre && <p ref={aviso} role="alert" tabIndex={-1} className="text-sm text-peligro outline-none">{error}</p>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" disabled={enviando} onClick={() => setAbierta(false)}>Cancelar</Boton>
            <Boton type="submit" cargando={enviando}>Guardar cambios</Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
