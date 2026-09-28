'use client'

import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { editarCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

export function EditarCarroceria({
  id,
  nombre,
  descripcion,
  activo,
}: {
  id: string
  nombre: string
  descripcion: string | null
  activo: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(editarCarroceria, () => setAbierta(false))
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={() => setAbierta(true)}>
        <Pencil aria-hidden className="size-3.5" /> Editar
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Editar ${nombre}`} descripcion="Cambia los datos visibles del catálogo. La ficha técnica del taller se conserva." ancho="md">
        <form onSubmit={alEnviar} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="activo" value={String(activo)} />
          <Campo etiqueta="Nombre" htmlFor={`carroceria-nombre-${id}`} requerido>
            <Entrada id={`carroceria-nombre-${id}`} name="nombre" defaultValue={nombre} required maxLength={120} />
          </Campo>
          <Campo etiqueta="Descripción" htmlFor={`carroceria-desc-${id}`}>
            <AreaTexto id={`carroceria-desc-${id}`} name="descripcion" defaultValue={descripcion ?? ''} maxLength={1000} rows={3} />
          </Campo>
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" onClick={() => setAbierta(false)}>Cancelar</Boton>
            <Boton type="submit" cargando={enviando}>Guardar cambios</Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
