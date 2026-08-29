'use client'

import { Pencil, Ruler } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { cn } from '@/lib/utils'

import { guardarMedidasCarroceria } from './acciones'

export type CarroceriaConMedidas = {
  id: string
  nombre: string
  activo: boolean
  horas_hombre_estandar: number
  modelo: string | null
  tipo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad: string | null
  peso_neto_tn: number | null
}

/** Lo que la cotización va a copiar, resumido en un renglón. */
function resumen(c: CarroceriaConMedidas): string | null {
  const medidas = [c.largo_m, c.ancho_m, c.alto_m].filter((m) => m !== null)
  const partes = [
    c.modelo,
    medidas.length > 0 ? `${medidas.join(' × ')} m` : null,
    c.capacidad,
    c.peso_neto_tn ? `${c.peso_neto_tn} tn` : null,
  ].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * Las medidas con las que la casa fabrica cada carrocería.
 *
 * No es un adorno del catálogo: es lo que la cotización copia al elegir el tipo.
 * Sin esto, la ficha del papel salía con rayas en Modelo, Medidas, Capacidad y
 * Peso neto, y había que escribirlas a mano en cada cotización —o no
 * escribirlas—. Copiadas, se corrigen en la cotización sin tocar este catálogo,
 * porque no todas terminan igual.
 */
export function MedidasCarroceria({
  carroceria,
  puedeEditar,
}: {
  carroceria: CarroceriaConMedidas
  puedeEditar: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [resultado, accion, guardando] = useActionState(guardarMedidasCarroceria, null)

  const dice = resumen(carroceria)

  return (
    <div className="flex items-start justify-between gap-3 border-b border-borde py-1.5 text-sm last:border-0">
      <div className="min-w-0">
        <p className="text-texto">
          {carroceria.nombre}
          {!carroceria.activo && (
            <span className="ml-2 text-[11px] text-texto-tenue">(inactivo)</span>
          )}
        </p>
        {/* Sin medidas se dice, y se dice qué se pierde: una lista de nombres no
            deja ver cuáles están a medio cargar. */}
        <p className={cn('text-xs', dice ? 'text-texto-suave' : 'text-texto-tenue')}>
          {dice ?? 'Sin medidas: la cotización de este tipo saldrá con la ficha en blanco'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="tabular text-xs text-texto-suave">
          {carroceria.horas_hombre_estandar} h
        </span>
        {puedeEditar && (
          <Boton
            type="button"
            variante="fantasma"
            tamano="sm"
            aria-label={`Medidas de ${carroceria.nombre}`}
            onClick={() => setAbierta(true)}
          >
            <Pencil aria-hidden className="size-3.5" />
          </Boton>
        )}
      </div>

      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={carroceria.nombre}
        descripcion="Lo que la cotización copia al elegir este tipo. Una vez copiado se corrige en la cotización, sin tocar el catálogo."
      >
        <form action={accion} className="space-y-3">
          <input type="hidden" name="id" value={carroceria.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Modelo" htmlFor={`mc-modelo-${carroceria.id}`}>
              <Entrada
                id={`mc-modelo-${carroceria.id}`}
                name="modelo"
                defaultValue={carroceria.modelo ?? ''}
                autoComplete="off"
                placeholder="MW-TV18"
              />
            </Campo>

            <Campo etiqueta="Tipo" htmlFor={`mc-tipo-${carroceria.id}`}>
              <Entrada
                id={`mc-tipo-${carroceria.id}`}
                name="tipo"
                defaultValue={carroceria.tipo ?? ''}
                autoComplete="off"
                placeholder="Volquete"
              />
            </Campo>
          </div>

          {/* `step` de centímetro e `inputMode` decimal: en el teléfono saca el
              teclado con punto, que es donde se escriben estas cifras. */}
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['largo_m', 'Largo (m)', carroceria.largo_m, '6.20'],
                ['ancho_m', 'Ancho (m)', carroceria.ancho_m, '2.40'],
                ['alto_m', 'Alto (m)', carroceria.alto_m, '1.60'],
              ] as const
            ).map(([campo, etiqueta, valor, ejemplo]) => (
              <Campo key={campo} etiqueta={etiqueta} htmlFor={`mc-${campo}-${carroceria.id}`}>
                <Entrada
                  id={`mc-${campo}-${carroceria.id}`}
                  name={campo}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  defaultValue={valor ?? ''}
                  placeholder={ejemplo}
                  className="tabular text-right"
                />
              </Campo>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Capacidad"
              htmlFor={`mc-capacidad-${carroceria.id}`}
              ayuda="Tal como va en el papel. Es texto porque no siempre es un volumen: hay fichas que dicen «2 compartimientos»."
            >
              <Entrada
                id={`mc-capacidad-${carroceria.id}`}
                name="capacidad"
                defaultValue={carroceria.capacidad ?? ''}
                autoComplete="off"
                placeholder="18 m³"
              />
            </Campo>

            <Campo etiqueta="Peso neto (tn)" htmlFor={`mc-peso-${carroceria.id}`}>
              <Entrada
                id={`mc-peso-${carroceria.id}`}
                name="peso_neto_tn"
                type="number"
                inputMode="decimal"
                step="0.001"
                min={0}
                defaultValue={carroceria.peso_neto_tn ?? ''}
                placeholder="4.850"
                className="tabular text-right"
              />
            </Campo>
          </div>

          {resultado && (
            <p
              role={resultado.ok ? 'status' : 'alert'}
              className={cn(
                'rounded-[var(--radius-base)] px-3 py-2 text-xs',
                resultado.ok ? 'bg-exito-suave text-exito' : 'bg-peligro-suave text-peligro',
              )}
            >
              {resultado.ok ? resultado.mensaje : resultado.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {/* «Cerrar» y no «Cancelar» después de guardar: la regla del
                proyecto prohíbe cerrar la ventana desde un efecto. */}
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierta(false)}>
              {resultado?.ok ? 'Cerrar' : 'Cancelar'}
            </Boton>
            <Boton type="submit" tamano="sm" cargando={guardando}>
              <Ruler aria-hidden className="size-3.5" />
              Guardar medidas
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
