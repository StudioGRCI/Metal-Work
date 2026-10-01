'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { CRITERIOS_DISENO, ESCALA_DISENO, criteriosPorGrupo, mesDeIngreso } from '@/lib/dominio/evaluacion-diseno'
import { useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'
import { guardarEvaluacionDiseno } from './acciones'

type Inicial = {
  id: string
  evaluado_nombre: string
  puesto: string
  area_servicio: string
  evaluador_cargo: string | null
  fecha_ingreso: string | null
  fecha_evaluacion: string
  respuestas: number[]
  comentarios: string
}

const GRUPOS = criteriosPorGrupo()

/**
 * El formato de evaluación en pantalla: los datos de la persona y los veinte
 * comportamientos con su escala de 1 a 5, como se marcan con una X en el papel.
 * El puntaje total se ve mientras se califica. Guardar no envía: la evaluación
 * se revisa en su ficha y desde ahí se manda a Administración.
 */
export function FormularioEvaluacion({ inicial, hoy, cargo, nombres }: {
  inicial?: Inicial
  hoy: string
  cargo: string
  nombres: string[]
}) {
  const router = useRouter()
  const [id] = useState(() => inicial?.id ?? crypto.randomUUID())
  const [puntajes, setPuntajes] = useState<(number | null)[]>(
    () => inicial?.respuestas ?? CRITERIOS_DISENO.map(() => null),
  )
  const envio = useEnvio(
    guardarEvaluacionDiseno,
    (resultado) => router.push(`/diseno/evaluaciones/${resultado.datos?.id ?? id}`),
    { refrescar: false },
  )

  const calificados = puntajes.filter((p) => p !== null).length
  const total = puntajes.reduce<number>((suma, p) => suma + (p ?? 0), 0)
  const faltan = CRITERIOS_DISENO.length - calificados

  function marcar(indice: number, valor: number) {
    setPuntajes((antes) => antes.map((p, i) => (i === indice ? valor : p)))
  }

  return (
    <form onSubmit={envio.alEnviar} className="space-y-6">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="nueva" value={inicial ? 'no' : 'si'} />

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-texto">Datos de la evaluación</legend>
        <Campo etiqueta="Evaluado" htmlFor="ev-nombre" requerido>
          <Entrada id="ev-nombre" name="evaluado_nombre" list="ev-equipo" maxLength={120} required autoComplete="off"
            defaultValue={inicial?.evaluado_nombre} placeholder="Nombre y apellido" />
          <datalist id="ev-equipo">{nombres.map((n) => <option key={n} value={n} />)}</datalist>
        </Campo>
        <Campo etiqueta="Puesto" htmlFor="ev-puesto" requerido>
          <Entrada id="ev-puesto" name="puesto" maxLength={100} required defaultValue={inicial?.puesto} placeholder="Ej.: Diseñador" />
        </Campo>
        <Campo etiqueta="Fecha de ingreso" htmlFor="ev-ingreso" ayuda="Mes y año en que entró a la empresa.">
          <Entrada id="ev-ingreso" name="fecha_ingreso" type="month" pattern="\d{4}-\d{2}" placeholder="AAAA-MM"
            defaultValue={mesDeIngreso(inicial?.fecha_ingreso) ?? ''} />
        </Campo>
        <Campo etiqueta="Fecha de evaluación" htmlFor="ev-fecha" requerido>
          <Entrada id="ev-fecha" name="fecha_evaluacion" type="date" required max={hoy}
            defaultValue={inicial?.fecha_evaluacion ?? hoy} />
        </Campo>
        <Campo etiqueta="Área / servicio" htmlFor="ev-area" requerido>
          <Entrada id="ev-area" name="area_servicio" maxLength={60} required defaultValue={inicial?.area_servicio ?? 'Ingeniería'} />
        </Campo>
        <Campo etiqueta="Tu cargo, como va bajo tu firma" htmlFor="ev-cargo">
          <Entrada id="ev-cargo" name="evaluador_cargo" maxLength={100}
            defaultValue={inicial ? (inicial.evaluador_cargo ?? '') : cargo} placeholder="Ej.: Supervisor de diseño" />
        </Campo>
      </fieldset>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-texto">Áreas del desempeño</h3>
          <p className="mt-1 text-sm text-texto-suave">
            En qué grado cree usted que el trabajador tiene desarrolladas estas competencias. Marque el número que refleja su opinión.
          </p>
        </div>
        <ul className="grid gap-1 text-xs text-texto-suave sm:grid-cols-5" aria-label="La escala">
          {ESCALA_DISENO.map((e) => (
            <li key={e.valor} className="rounded-[var(--radius-base)] bg-superficie-2 px-2 py-1.5">
              <span className="tabular font-semibold text-texto">{e.valor}</span> {e.nivel}
              <span className="block text-[11px] text-texto-tenue">{e.rendimiento}</span>
            </li>
          ))}
        </ul>

        {GRUPOS.map((g) => (
          <fieldset key={g.grupo} className="rounded-[var(--radius-base)] border border-borde">
            <legend className="ml-3 px-1 text-xs font-semibold tracking-wide text-acento uppercase">{g.grupo}</legend>
            <ol className="divide-y divide-borde">
              {g.criterios.map(({ indice, nombre }) => (
                <li key={indice} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <p id={`ev-criterio-${indice}`} className="text-sm text-texto">
                    <span className="tabular mr-1 text-texto-tenue">{indice + 1}.</span>{nombre}
                  </p>
                  <div role="radiogroup" aria-labelledby={`ev-criterio-${indice}`} className="grid grid-cols-5 gap-1.5 sm:w-64">
                    {ESCALA_DISENO.map((e) => (
                      <label key={e.valor} className="relative" title={e.nivel}>
                        <input
                          type="radio"
                          name={`puntaje_${indice}`}
                          value={e.valor}
                          required
                          checked={puntajes[indice] === e.valor}
                          onChange={() => marcar(indice, e.valor)}
                          className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                          aria-label={`${e.valor}: ${e.nivel}`}
                        />
                        <span
                          aria-hidden
                          className={cn(
                            'tabular flex h-10 items-center justify-center rounded-[var(--radius-base)] border border-borde text-sm font-medium text-texto-suave',
                            'peer-hover:border-acento peer-checked:border-acento peer-checked:bg-acento peer-checked:text-acento-texto',
                            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-acento',
                          )}
                        >
                          {e.valor}
                        </span>
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </fieldset>
        ))}
      </div>

      <Campo etiqueta="Comentarios" htmlFor="ev-comentarios" ayuda="Lo adicional que quiera remarcar.">
        <AreaTexto id="ev-comentarios" name="comentarios" maxLength={3000} rows={4} defaultValue={inicial?.comentarios} />
      </Campo>

      {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
      {/* En escritorio el total queda a la vista mientras se califica. En el
          teléfono no: la barra de secciones va fija abajo y lo taparía. */}
      <div className="-mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 rounded-b-[var(--radius-base)] border-t border-borde bg-superficie px-4 py-3 lg:sticky lg:bottom-0 lg:z-10">
        <p className="text-sm text-texto" aria-live="polite">
          Puntaje total <span className="tabular text-lg font-semibold">{total}</span>
          <span className="text-texto-suave"> de 100</span>
          {faltan > 0 && <span className="block text-xs text-aviso">Faltan {faltan} {faltan === 1 ? 'criterio' : 'criterios'} por calificar</span>}
        </p>
        <Boton type="submit" cargando={envio.enviando}>{inicial ? 'Guardar corrección' : 'Guardar evaluación'}</Boton>
      </div>
    </form>
  )
}
