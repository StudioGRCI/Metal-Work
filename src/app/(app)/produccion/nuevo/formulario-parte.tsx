'use client'

import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'

import { crearParte } from '../acciones'

export function FormularioParte({
  sedes,
  sedePorDefecto,
}: {
  sedes: { id: string; nombre: string }[]
  sedePorDefecto: string | null
}) {
  const [resultado, ejecutar, pendiente] = useActionState(crearParte, null)
  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <form action={ejecutar} className="max-w-xl space-y-4">
      <Tarjeta>
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Fecha"
            htmlFor="fecha"
            requerido
            ayuda="No se admiten partes con fecha futura"
          >
            <Entrada id="fecha" name="fecha" type="date" required max={hoy} defaultValue={hoy} />
          </Campo>

          <Campo etiqueta="Taller" htmlFor="sede_id" requerido>
            <Seleccion
              id="sede_id"
              name="sede_id"
              required
              defaultValue={sedePorDefecto ?? sedes[0]?.id ?? ''}
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2">
            <AreaTexto
              id="observaciones"
              name="observaciones"
              rows={2}
              autoComplete="off"
              placeholder="Novedades del día: cortes de energía, ausencias, incidentes"
            />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      {resultado && !resultado.ok && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {resultado.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {/* Cancelar navega, no ejecuta: por eso es enlace con pinta de botón y no
            un Boton. Las clases salían copiadas a mano y ya no coincidían. */}
        <EnlaceBoton href="/produccion" variante="fantasma">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente}>
          Crear parte
        </Boton>
      </div>
    </form>
  )
}
