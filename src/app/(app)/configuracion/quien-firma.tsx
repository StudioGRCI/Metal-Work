'use client'

import { PenLine } from 'lucide-react'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cn } from '@/lib/utils'

import { guardarQuienFirma } from './acciones'

/**
 * Quién firma las cotizaciones.
 *
 * En esta empresa es siempre el gerente general, y el papel cerraba con el
 * nombre del vendedor porque el sistema dio por hecho que quien atiende es quien
 * firma.
 *
 * Es un nombre escrito y no una cuenta del sistema, y eso fue una corrección:
 * al principio se ató a la tabla de usuarios, lo que obliga a darle acceso a
 * alguien que a lo mejor nunca va a entrar y deja el papel sin firma el día que
 * esa cuenta se dé de baja. Quien firma un documento y quien usa el programa no
 * son la misma lista.
 */
export function QuienFirma({
  nombre,
  cargo,
  puedeEditar,
}: {
  nombre: string | null
  cargo: string | null
  puedeEditar: boolean
}) {
  const [resultado, accion, guardando] = useActionState(guardarQuienFirma, null)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Quién firma las cotizaciones"
        descripcion="Su nombre y su cargo cierran el papel, debajo de «Atentamente». El vendedor sale aparte, como dato."
      />
      <TarjetaCuerpo className="space-y-3">
        {nombre ? (
          <div className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2.5">
            <p className="text-sm font-semibold text-texto">{nombre}</p>
            <p className="text-xs text-texto-suave">{cargo ?? 'Gerente General'}</p>
          </div>
        ) : (
          // Sin nombre, el papel cierra con la razón social. No es un error,
          // pero tampoco es lo que la empresa pidió.
          <p
            role="status"
            className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2.5 text-sm text-aviso"
          >
            Todavía no hay nadie puesto: las cotizaciones cierran con el nombre de la empresa.
          </p>
        )}

        {puedeEditar && (
          <form action={accion} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Nombre"
                htmlFor="firma_nombre"
                ayuda="Tal como va impreso. En sus cotizaciones va en mayúsculas."
              >
                <Entrada
                  id="firma_nombre"
                  name="firma_nombre"
                  defaultValue={nombre ?? ''}
                  autoComplete="off"
                  placeholder="YHON SANDOVAL JUAREZ"
                />
              </Campo>

              <Campo etiqueta="Cargo" htmlFor="firma_cargo">
                <Entrada
                  id="firma_cargo"
                  name="firma_cargo"
                  defaultValue={cargo ?? ''}
                  autoComplete="off"
                  placeholder="Gerente General"
                />
              </Campo>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Boton type="submit" tamano="sm" cargando={guardando}>
                <PenLine aria-hidden className="size-3.5" />
                Guardar
              </Boton>
              {resultado && (
                <p
                  role={resultado.ok === false ? 'alert' : 'status'}
                  className={cn(
                    'rounded-[var(--radius-base)] px-3 py-2 text-xs',
                    resultado.ok === false
                      ? 'bg-peligro-suave text-peligro'
                      : 'bg-exito-suave text-exito',
                  )}
                >
                  {resultado.ok === false ? resultado.error : resultado.mensaje}
                </p>
              )}
            </div>
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
