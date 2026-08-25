'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { PRIORIDAD, opciones } from '@/lib/dominio/estados'

import { crearRequerimiento } from '../../acciones'

const PRIORIDADES = opciones(PRIORIDAD)

export function FormularioRequerimiento({
  ordenes,
  almacenes,
  ordenInicial,
}: {
  ordenes: { id: string; numero: string; cliente: string | null; placa: string | null }[]
  almacenes: { id: string; nombre: string }[]
  ordenInicial?: string
}) {
  const [resultado, ejecutar, pendiente] = useActionState(crearRequerimiento, null)

  return (
    <form action={ejecutar} className="max-w-2xl space-y-4">
      <Tarjeta>
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Orden de trabajo" htmlFor="orden_id" requerido className="sm:col-span-2">
            <Seleccion id="orden_id" name="orden_id" required defaultValue={ordenInicial ?? ''}>
              <option value="">Selecciona la orden</option>
              {ordenes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.numero} · {o.cliente ?? ''} {o.placa ? `(${o.placa})` : ''}
                </option>
              ))}
            </Seleccion>
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

      <div className="flex justify-end gap-2">
        <Link
          href="/almacen/requerimientos"
          className="inline-flex h-9 items-center rounded-[var(--radius-base)] px-4 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </Link>
        <Boton type="submit" cargando={pendiente}>
          Crear y agregar materiales
        </Boton>
      </div>
    </form>
  )
}
