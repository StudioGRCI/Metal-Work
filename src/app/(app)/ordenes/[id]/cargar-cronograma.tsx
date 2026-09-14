'use client'

import { AlertTriangle, CalendarRange, Download, FileSpreadsheet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { Ventana } from '@/components/ui/ventana'
import { subirAdjunto } from '@/lib/adjuntos'
import { leerCronograma, type AreaDelTaller, type LecturaCronograma } from '@/lib/cronograma'
import { fecha as fmtFecha, numero } from '@/lib/format'

import { cargarCronograma } from './acciones-actividades'

/**
 * Subir el cronograma de la orden desde un Excel: una fila por actividad, con
 * su área, su peso y desde cuándo hasta cuándo (migración 099).
 *
 * El archivo se lee en el navegador y se muestra lo que se va a cargar, área
 * por área, con lo que falla marcado en su fila, antes de tocar nada. Recién
 * al confirmar va a la base, que lo carga todo o nada: lo que ya estaba con el
 * mismo nombre se actualiza y lo nuevo se agrega. El Excel, si se quiere,
 * queda guardado en la orden.
 */
export function CargarCronograma({ ordenId, areasPropias }: { ordenId: string; areasPropias: AreaDelTaller[] }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [lectura, setLectura] = useState<LecturaCronograma | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [guardarExcel, setGuardarExcel] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  function abrir() {
    setArchivo(null)
    setLectura(null)
    setError(null)
    setAviso(null)
    setGuardarExcel(true)
    setAbierto(true)
  }

  async function leer(elegido: File | undefined) {
    if (!elegido) return
    setArchivo(elegido)
    setLectura(null)
    setError(null)
    if (!/\.xlsx$/i.test(elegido.name)) {
      setError('Tiene que ser un Excel .xlsx. Si está en .xls, guárdalo como «Libro de Excel».')
      return
    }
    setLeyendo(true)
    try {
      // La librería solo hace falta aquí: se carga cuando se elige el archivo.
      const { readSheet } = await import('read-excel-file/browser')
      const datos = (await readSheet(elegido)) as unknown as unknown[][]
      setLectura(leerCronograma(datos, areasPropias))
    } catch {
      setError('No se pudo leer el archivo. ¿Es un Excel (.xlsx) y está cerrado en la computadora?')
    } finally {
      setLeyendo(false)
    }
  }

  const filas = lectura?.filas ?? []
  const conError = filas.filter((f) => f.errores.length > 0)
  const porArea = [...new Set(filas.map((f) => f.area))].map((area) => {
    const lista = filas.filter((f) => f.area === area)
    return { area, lista, total: lista.reduce((s, f) => s + f.peso_pct, 0) }
  })
  const listo = filas.length > 0 && conError.length === 0 && !lectura?.error

  function cargar() {
    if (enCurso.current || !listo) return
    enCurso.current = true
    setError(null)
    iniciar(async () => {
      try {
        const datos = new FormData()
        datos.set('orden_id', ordenId)
        datos.set(
          'filas',
          JSON.stringify(
            filas.map((f) => ({
              area_id: f.area_id,
              nombre: f.nombre,
              referencia: f.referencia,
              peso_pct: f.peso_pct,
              inicio: f.inicio,
              fin: f.fin,
            })),
          ),
        )
        const r = await cargarCronograma(null, datos)
        if (!r.ok) {
          setError(r.error)
          return
        }

        // El cronograma ya entró: lo del Excel es de más, y si falla se dice,
        // pero no se pierde el aviso de lo que sí quedó.
        let mensaje = r.mensaje ?? 'Cronograma cargado.'
        if (guardarExcel && archivo) {
          try {
            const guardado = await subirAdjunto(ordenId, archivo, 'CRONOGRAMA')
            if (!guardado.ok) mensaje += ` El Excel no quedó guardado en la orden: ${guardado.error}`
          } catch {
            mensaje += ' El Excel no quedó guardado en la orden.'
          }
        }
        setAviso(mensaje)
        setAbierto(false)
        iniciar(() => router.refresh())
      } finally {
        enCurso.current = false
      }
    })
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton variante="secundario" tamano="sm" onClick={abrir}>
          <CalendarRange aria-hidden className="size-3.5" />
          Subir cronograma
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Subir el cronograma"
        descripcion="Un Excel con una fila por actividad: Área, Actividad, Referencia, Peso (%), Inicio y Fin. Con las fechas, cada supervisor ve qué le toca reportar y qué se atrasó."
        ancho="lg"
      >
        <div className="space-y-4">
          <a
            href="/plantillas/cronograma-actividades.xlsx"
            download
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
          >
            <Download aria-hidden className="size-4" />
            Bajar la plantilla
          </a>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileSpreadsheet aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el Excel'}</span>
            <span className="text-xs">{leyendo ? 'Leyendo…' : 'Solo .xlsx. Nada se carga hasta que confirmes.'}</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                void leer(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          {lectura?.error && <Falla texto={lectura.error} />}

          {filas.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-texto">
                {filas.length} {filas.length === 1 ? 'actividad' : 'actividades'} en {porArea.length}{' '}
                {porArea.length === 1 ? 'área' : 'áreas'}
                {conError.length > 0 && (
                  <span className="text-peligro">
                    {' '}
                    · {conError.length} con algo que corregir en el Excel
                  </span>
                )}
              </p>

              {porArea.map(({ area, lista, total }) => (
                <div key={area} className="rounded-[var(--radius-base)] border border-borde">
                  <p className="flex items-center justify-between gap-2 border-b border-borde px-3 py-2 text-sm font-medium text-texto">
                    {area}
                    <span className={total > 100 ? 'tabular text-peligro' : 'tabular text-texto-suave'}>
                      suman {numero(total, 0)} %{total > 100 ? ': pasa de 100' : ''}
                    </span>
                  </p>
                  <ul className="divide-y divide-borde">
                    {lista.map((f) => (
                      <li key={f.fila} className="px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-medium text-texto">
                            {f.nombre || '(sin actividad)'}
                            {f.referencia && <span className="font-normal text-texto-suave"> · {f.referencia}</span>}
                          </span>
                          <span className="tabular text-xs text-texto-suave">
                            {numero(f.peso_pct, 0)} % · {f.inicio ? fmtFecha(f.inicio) : '—'} →{' '}
                            {f.fin ? fmtFecha(f.fin) : '—'}
                          </span>
                        </div>
                        {f.errores.length > 0 && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-peligro">
                            <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                            Fila {f.fila}: {f.errores.join('; ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p className="text-xs text-texto-tenue">
                Lo que ya estaba en la hoja con el mismo nombre se actualiza —peso, referencia y fechas—;
                lo demás se agrega. No se borra ninguna actividad. Si con lo que ya estaba un área pasa de
                100 %, no se carga nada y se dice cuál.
              </p>

              <label className="flex items-center gap-2 text-sm text-texto">
                <input
                  type="checkbox"
                  checked={guardarExcel}
                  onChange={(e) => setGuardarExcel(e.target.checked)}
                  className="size-4 accent-[var(--acento)]"
                />
                Guardar también el Excel en la orden
              </label>
            </div>
          )}

          {error && <Falla texto={error} />}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton
              type="button"
              tamano="lg"
              onClick={cargar}
              cargando={enviando}
              disabled={!listo || leyendo}
              className="w-full sm:w-auto"
            >
              {listo ? `Cargar ${filas.length} ${filas.length === 1 ? 'actividad' : 'actividades'}` : 'Cargar'}
            </Boton>
          </div>
        </div>
      </Ventana>
    </>
  )
}

function Falla({ texto }: { texto: string }) {
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}
