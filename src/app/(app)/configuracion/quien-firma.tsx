'use client'

import { PenLine } from 'lucide-react'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cn } from '@/lib/utils'

import { guardarQuienFirma } from './acciones'

/**
 * Quién firma las cotizaciones.
 *
 * En esta empresa es siempre el gerente general, y el papel cerraba con el
 * nombre del vendedor porque el sistema dio por hecho que quien atiende es quien
 * firma. Se elige acá, y no se deduce del rol al imprimir: hoy hay un solo
 * gerente y deducirlo funcionaría, pero el día que haya dos el documento saldría
 * firmado por el que tocara en el orden de la consulta —y un papel que sale del
 * taller con el nombre equivocado debajo de «Atentamente» no se arregla después.
 */
export function QuienFirma({
  gerenteId,
  candidatos,
  puedeEditar,
}: {
  gerenteId: string | null
  candidatos: { id: string; nombres: string; apellidos: string; cargo: string | null }[]
  puedeEditar: boolean
}) {
  const [resultado, accion, guardando] = useActionState(guardarQuienFirma, null)
  const elegido = candidatos.find((c) => c.id === gerenteId)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Quién firma las cotizaciones"
        descripcion="Su nombre y su cargo cierran el papel, debajo de «Atentamente». El vendedor sale aparte, como dato."
      />
      <TarjetaCuerpo className="space-y-3">
        {elegido ? (
          <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2.5 text-sm">
            <span className="font-semibold text-texto">
              {elegido.nombres} {elegido.apellidos}
            </span>
            <span className="text-texto-suave"> · {elegido.cargo ?? 'Gerente general'}</span>
          </p>
        ) : (
          // Sin elegir, el papel cierra con la razón social. No es un error,
          // pero tampoco es lo que la empresa pidió.
          <p
            role="status"
            className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2.5 text-sm text-aviso"
          >
            Todavía no hay nadie elegido: las cotizaciones cierran con el nombre de la empresa.
          </p>
        )}

        {puedeEditar && (
          <form action={accion} className="flex flex-wrap items-end gap-2">
            <Campo etiqueta="Gerente general" htmlFor="gerente_general_id" className="min-w-52 flex-1">
              <Seleccion
                id="gerente_general_id"
                name="gerente_general_id"
                defaultValue={gerenteId ?? ''}
              >
                <option value="">Cierra con el nombre de la empresa</option>
                {candidatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombres} {c.apellidos}
                    {c.cargo ? ` · ${c.cargo}` : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Boton type="submit" tamano="sm" cargando={guardando}>
              <PenLine aria-hidden className="size-3.5" />
              Guardar
            </Boton>
            {resultado && (
              <p
                role={resultado.ok === false ? 'alert' : 'status'}
                className={cn(
                  'w-full rounded-[var(--radius-base)] px-3 py-2 text-xs',
                  resultado.ok === false
                    ? 'bg-peligro-suave text-peligro'
                    : 'bg-exito-suave text-exito',
                )}
              >
                {resultado.ok === false ? resultado.error : resultado.mensaje}
              </p>
            )}
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
