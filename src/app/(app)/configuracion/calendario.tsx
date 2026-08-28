'use client'

import { CalendarPlus, Hammer } from 'lucide-react'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { Feriado } from '@/lib/datos/configuracion'
import { fecha as formatearFecha } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  agregarFeriado,
  alternarFeriadoLaborable,
  guardarDiasLaborables,
  sembrarFeriados,
} from './acciones'

const DIAS = [
  { numero: 1, nombre: 'Lunes' },
  { numero: 2, nombre: 'Martes' },
  { numero: 3, nombre: 'Miércoles' },
  { numero: 4, nombre: 'Jueves' },
  { numero: 5, nombre: 'Viernes' },
  { numero: 6, nombre: 'Sábado' },
  { numero: 7, nombre: 'Domingo' },
]

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/** Qué días de la semana hay taller. Los plazos en días hábiles salen de acá. */
export function DiasLaborables({
  dias,
  puedeEditar,
}: {
  dias: number[]
  puedeEditar: boolean
}) {
  const [resultado, accion, enviando] = useActionState(guardarDiasLaborables, null)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Días de taller"
        descripcion="Los plazos en días hábiles saltan los días apagados y los feriados."
      />
      <TarjetaCuerpo>
        <form action={accion} className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-0 sm:gap-y-4">
            {DIAS.map((d) => (
              // La etiqueta entera es el blanco: una casilla de 16 px no se
              // marca con el dedo, y menos con guante. En el monitor vuelve a
              // medir lo de siempre.
              <label
                key={d.numero}
                className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0"
              >
                <input
                  type="checkbox"
                  name="dia"
                  value={d.numero}
                  defaultChecked={dias.includes(d.numero)}
                  disabled={!puedeEditar}
                  className="size-5 accent-[var(--acento)] sm:size-4"
                />
                {d.nombre}
              </label>
            ))}
          </div>
          {puedeEditar && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              {/* «Guardar» a secas no dice qué: en esta pantalla también se
                  guardan feriados. */}
              <Boton type="submit" tamano="sm" cargando={enviando}>
                <Hammer aria-hidden className="size-3.5" />
                Guardar días de taller
              </Boton>
            </div>
          )}
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Los feriados del año, con la siembra nacional y los propios de la empresa. */
export function Feriados({
  anio,
  feriados,
  puedeEditar,
}: {
  anio: number
  feriados: Feriado[]
  puedeEditar: boolean
}) {
  const [resultadoSiembra, sembrar, sembrando] = useActionState(sembrarFeriados, null)
  const [resultadoAlta, agregar, agregando] = useActionState(agregarFeriado, null)
  const [, alternar] = useActionState(alternarFeriadoLaborable, null)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={`Feriados de ${anio}`}
        descripcion="Los nacionales se cargan de una vez; los de la empresa se agregan a mano."
        acciones={
          puedeEditar && (
            <form action={sembrar}>
              <input type="hidden" name="anio" value={anio} />
              <Boton type="submit" variante="secundario" tamano="sm" cargando={sembrando}>
                <CalendarPlus aria-hidden className="size-3.5" />
                Cargar nacionales {anio}
              </Boton>
            </form>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        <Aviso resultado={resultadoSiembra} />

        {puedeEditar && (
          <form action={agregar} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <Campo etiqueta="Fecha" htmlFor="fecha-feriado" requerido className="min-w-36 flex-1 sm:flex-initial">
              <Entrada id="fecha-feriado" name="fecha" type="date" required />
            </Campo>
            {/* Sin `autoComplete="off"` el navegador ofrece el nombre del que
                está sentado como nombre del feriado. */}
            <Campo etiqueta="Nombre" htmlFor="nombre-feriado" requerido className="min-w-56 flex-1">
              <Entrada
                id="nombre-feriado"
                name="nombre"
                required
                autoComplete="off"
                placeholder="Aniversario de la empresa"
              />
            </Campo>
            <Boton type="submit" tamano="sm" cargando={agregando}>
              Agregar feriado
            </Boton>
            <div className="w-full">
              <Aviso resultado={resultadoAlta} />
            </div>
          </form>
        )}

        {feriados.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-texto">Este año todavía no tiene feriados cargados.</p>
            {/* El estado vacío dice cuál es el siguiente paso y dónde está el
                botón que lo da; sin feriados los plazos en días hábiles salen
                cortos y nadie se entera hasta que la entrega se pasa. */}
            <p className="mt-1 text-xs text-texto-suave">
              {puedeEditar
                ? `Empieza con «Cargar nacionales ${anio}», arriba, y agrega después los de la empresa.`
                : 'Mientras no los haya, los plazos en días hábiles cuentan como si se trabajara todo el año.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-borde">
            {feriados.map((f) => (
              // `flex-wrap`: en el teléfono la fecha, el nombre y el botón no
              // entran en una línea, y sin esto el nombre quedaba en un hilo.
              <li key={f.fecha} className="flex flex-wrap items-center gap-x-3 py-1.5 text-sm">
                <span className="tabular w-28 shrink-0 whitespace-nowrap text-texto-suave">
                  {formatearFecha(f.fecha)}
                </span>
                <span
                  className={cn(
                    'min-w-40 flex-1 text-texto',
                    f.laborable && 'line-through opacity-60',
                  )}
                >
                  {f.nombre}
                  <span className="ml-2 text-[11px] text-texto-tenue">
                    {f.ambito === 'NACIONAL' ? 'nacional' : 'de la empresa'}
                  </span>
                </span>
                {puedeEditar && (
                  <form action={alternar}>
                    <input type="hidden" name="fecha" value={f.fecha} />
                    <input type="hidden" name="laborable" value={f.laborable ? 'no' : 'si'} />
                    {/* El texto solo dice «Se trabaja»: con veinte filas
                        iguales, el lector de pantalla necesita saber de cuál. */}
                    <button
                      type="submit"
                      aria-label={
                        f.laborable
                          ? `Volver a marcar ${f.nombre} como feriado`
                          : `Marcar que el día de ${f.nombre} se trabaja`
                      }
                      className="inline-flex min-h-11 items-center text-[11px] text-texto-tenue hover:text-acento sm:min-h-0"
                    >
                      {f.laborable ? 'Volver a feriado' : 'Se trabaja'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
