'use client'

import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { PRIORIDAD, opciones } from '@/lib/dominio/estados'
import { nombreDeUnidad, type UnidadNombrable } from '@/lib/dominio/unidades'

import { crearRequerimiento } from '../../acciones'

const PRIORIDADES = opciones(PRIORIDAD)

export function FormularioRequerimiento({
  ordenes,
  almacenes,
  ordenInicial,
}: {
  ordenes: { id: string; numero: string; cliente: string | null; unidad: UnidadNombrable | null }[]
  almacenes: { id: string; nombre: string }[]
  ordenInicial?: string
}) {
  const [resultado, ejecutar, pendiente] = useActionState(crearRequerimiento, null)
  const [ordenId, setOrdenId] = useState(ordenInicial ?? '')

  return (
    <form action={ejecutar} className="max-w-2xl space-y-4">
      <Tarjeta>
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Orden de trabajo" htmlFor="orden_id" requerido className="sm:col-span-2">
            <SeleccionBuscable
              id="orden_id"
              name="orden_id"
              requerido
              permiteVaciar={false}
              valor={ordenId}
              onChange={setOrdenId}
              marcador="Selecciona la orden"
              marcadorBusqueda="Número, cliente o unidad"
              opciones={ordenes.map((o) => ({
                valor: o.id,
                etiqueta: o.numero,
                // La unidad se nombra en un solo sitio: la carrocería que aún no
                // tiene placa se llama por su código de fabricación o por su
                // chasis, y el renglón no queda a medias.
                detalle: [o.cliente, nombreDeUnidad(o.unidad)].filter(Boolean).join(' · '),
              }))}
            />
          </Campo>

          <Campo etiqueta="Almacén" htmlFor="almacen_id" ayuda="De dónde saldrá el material">
            <Seleccion id="almacen_id" name="almacen_id" defaultValue={almacenes[0]?.id ?? ''}>
              <option value="">Sin especificar</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Prioridad" htmlFor="prioridad">
            <Seleccion id="prioridad" name="prioridad" defaultValue="NORMAL">
              {PRIORIDADES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo
            etiqueta="Fecha requerida"
            htmlFor="fecha_requerida"
            ayuda="Cuándo se necesita en el taller"
          >
            <Entrada id="fecha_requerida" name="fecha_requerida" type="date" />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2">
            <AreaTexto id="observaciones" name="observaciones" rows={2} />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      {resultado && !resultado.ok && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {resultado.error}
        </p>
      )}

      {/* En el teléfono los dos botones ocupan el ancho y el que sigue el
          camino queda arriba, bajo el pulgar; `sm:` devuelve la fila de
          siempre, con Cancelar a la izquierda. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <EnlaceBoton href="/almacen/requerimientos" variante="fantasma" className="justify-center">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente} className="justify-center">
          Crear y agregar materiales
        </Boton>
      </div>
    </form>
  )
}
