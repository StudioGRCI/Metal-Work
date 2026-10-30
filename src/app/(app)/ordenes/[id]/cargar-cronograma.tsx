'use client'

import { AlertTriangle, CalendarRange, Download } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { EstadoDelEnvio, useEnvioDeLaVentana } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import { MAXIMO_ADJUNTO_MB, NO_SE_SABE_SI_QUEDO, subirAdjunto } from '@/lib/adjuntos'
import { leerCronograma, type AreaDelTaller, type LecturaCronograma } from '@/lib/cronograma'
import { ENTRO_OTRA_CUENTA, explicarFallo, laPestanaEsDeOtraCuenta, mientrasSeEnvia, pasoTrasLoQueQuedo, refrescarSiEsDeLaPestana } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { fecha as fmtFecha, numero } from '@/lib/format'
import { NO_QUEDO_SIN_RESPUESTA } from '@/lib/subida-privada'

import { cargarCronograma } from './acciones-actividades'

const ACEPTA_EXCEL = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Por qué no quedó el Excel, sin repetir «No se pudo subir el archivo» y
 * diciendo cómo se vuelve a intentar: la ventana ya se cerró, y lo que queda es
 * subir otra vez el cronograma, que actualiza lo que ya estaba.
 */
function motivoDelExcel(error: string): string {
  const motivo = error.replace(/^No se pudo subir el archivo\. /, '')
  const otraVez = 'sube otra vez el cronograma con el mismo Excel; las actividades no se duplican.'
  // Sin respuesta dos veces y el Excel retirado: no quedó, y se sube otra vez igual.
  if (motivo.startsWith('Revisa la señal') || motivo === NO_QUEDO_SIN_RESPUESTA) return `Revisa la señal y ${otraVez}`
  if (motivo.startsWith('Inténtalo de nuevo')) return `Para guardarlo, ${otraVez} Si vuelve a pasar, avisa al administrador.`
  // Entró otra cuenta antes de subirlo: no salió a su nombre, y se sube igual cuando vuelva la tuya.
  if (motivo === ENTRO_OTRA_CUENTA) return `${motivo} Para guardarlo, ${otraVez}`
  return motivo
}

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
  // Por qué el Excel elegido no se pudo leer: va en su campo, no con los errores de cargar.
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null)
  // Lo que entró, con la pantalla de la orden: si «Nueva tarea» o una pestaña
  // desmontan el botón con la ventana cerrada en vuelo, se dice cuando vuelve.
  const [aviso, setAviso] = useEstadoCompartido<string | null>(`cronograma:${ordenId}:aviso`, null, { guardar: true })
  // Lo del Excel va aparte: si no quedó, se lee como aviso y no como el éxito del cronograma.
  const [excel, setExcel] = useEstadoCompartido<{ ok: true } | { ok: false; error: string } | { ok: false; incierto: true } | null>(
    `cronograma:${ordenId}:excel`,
    null,
    { guardar: true },
  )
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)
  // Cerrada mientras va: el botón que la abre gira y el desenlace se dice a su lado.
  const fuera = useEnvioDeLaVentana(`cronograma:${ordenId}`)
  // Cerrada mientras va, o mientras la página se pone al día tras el ok: no se abre otra.
  const ocupado = fuera.sigue || (enviando && !abierto)

  // La X, Escape, el fondo y «Cancelar»: todos cierran igual, y si va en camino
  // el desenlace se dice junto al botón.
  function cerrar() {
    fuera.cerrar()
    setAbierto(false)
  }

  function abrir() {
    setArchivo(null)
    setLectura(null)
    setError(null)
    setAvisoArchivo(null)
    setAviso(null)
    setExcel(null)
    setGuardarExcel(true)
    setAbierto(true)
  }

  async function leer(elegido: File | undefined) {
    if (!elegido) return
    setLectura(null)
    setError(null)
    const noSirve = /\.xls$/i.test(elegido.name)
      ? 'Es un .xls: guárdalo como «Libro de Excel» (.xlsx) y elígelo otra vez'
      : await revisarArchivo(elegido, ACEPTA_EXCEL, MAXIMO_ADJUNTO_MB)
    setArchivo(elegido)
    setAvisoArchivo(noSirve)
    if (noSirve) return
    setLeyendo(true)
    try {
      // La librería solo hace falta aquí: se carga cuando se elige el archivo.
      const { readSheet } = await import('read-excel-file/browser')
      const datos = (await readSheet(elegido)) as unknown as unknown[][]
      setLectura(leerCronograma(datos, areasPropias))
    } catch {
      setAvisoArchivo('No se pudo leer: si está abierto en la computadora, ciérralo y elígelo otra vez')
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
    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setError(null)
    // Como en `useAccion`: «Volver a cargar», el del aviso de arriba tras un
    // despliegue, espera a que vuelvan el cronograma y su Excel, y si algo no
    // entró no recarga encima de su aviso. Recargaba a los 180 ms y el Excel
    // quedaba subido sin anotar (D17 y crítica de la trigesimotercera pasada).
    iniciar(() => mientrasSeEnvia(async (entro) => {
      // Cómo terminó, por si la ventana se cierra mientras va (`useEnvioDeLaVentana`).
      const terminar = fuera.empezar()
      let comoTermino: string | null = null
      const noEntro = (porque: string) => {
        comoTermino = porque
        setError(porque)
      }
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
          noEntro(r.error)
          return
        }

        // El cronograma ya entró: lo del Excel es de más, y si falla se dice,
        // pero no se pierde el aviso de lo que sí quedó.
        let guardado: typeof excel = null
        if (guardarExcel && archivo) {
          try {
            const subida = await pasoTrasLoQueQuedo(() => subirAdjunto(ordenId, archivo, 'CRONOGRAMA'))
            guardado = subida.ok
              ? { ok: true }
              : subida.error === NO_SE_SABE_SI_QUEDO
                ? { ok: false, incierto: true }
                : { ok: false, error: motivoDelExcel(subida.error) }
          } catch {
            guardado = { ok: false, incierto: true }
          }
        }
        setAviso(r.mensaje ?? 'Cronograma cargado.')
        setExcel(guardado)
        setAbierto(false)
        if (!guardado || guardado.ok) entro()
        iniciar(() => refrescarSiEsDeLaPestana(router))
      } catch (e) {
        // Lo mismo que en useAccion: sin señal, la pantalla entera caía y se
        // perdía el Excel leído.
        noEntro(explicarFallo(e))
      } finally {
        enCurso.current = false
        terminar(comoTermino)
      }
    }))
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton variante="secundario" tamano="sm" onClick={abrir} ocupado={ocupado} aria-describedby={fuera.sigue ? fuera.idDelEstado : undefined}>
          {!ocupado && <CalendarRange aria-hidden className="size-3.5" />}
          Subir cronograma
        </Boton>
        {/* Montada siempre: cerrada en vuelo, es lo único que dice que entró. */}
        <span role="status" className={aviso ? 'text-xs' : 'sr-only'}>
          {aviso && <span className="font-medium text-exito">{aviso}</span>}
          {excel?.ok && (
            <>
              {' '}El Excel quedó guardado en la orden:{' '}
              <Link href={`/ordenes/${ordenId}?vista=resumen`} className="font-medium text-acento underline">
                verlo en Resumen
              </Link>
              .
            </>
          )}
          {excel && !excel.ok && 'incierto' in excel && (
            <span className="font-medium text-aviso">
              {' '}No se sabe si el Excel quedó guardado:{' '}
              <Link href={`/ordenes/${ordenId}?vista=resumen`} className="underline">
                míralo en Resumen
              </Link>{' '}
              antes de volver a subirlo.
            </span>
          )}
          {excel && !excel.ok && 'error' in excel && (
            <span className="font-medium text-aviso"> El Excel no quedó guardado en la orden. {excel.error}</span>
          )}
        </span>
        <EstadoDelEnvio id={fuera.idDelEstado} sigue={fuera.sigue} desenlace={fuera.desenlace} registro="El cronograma" />
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={cerrar}
        titulo="Subir el cronograma"
        descripcion="Un Excel con una fila por actividad: Área, Actividad, Referencia, Peso (%), Inicio y Fin. Con las fechas, cada supervisor ve qué le toca reportar y qué se atrasó. Nada se carga hasta que confirmes."
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

          <Campo etiqueta="Excel del cronograma" htmlFor={`cronograma-${ordenId}`}>
            <ElegirArchivo
              id={`cronograma-${ordenId}`}
              accept={ACEPTA_EXCEL}
              texto="Elegir el Excel del cronograma"
              hastaMb={MAXIMO_ADJUNTO_MB}
              archivo={archivo}
              aviso={avisoArchivo}
              estado={leyendo ? 'Leyendo el Excel…' : null}
              aria-invalid={Boolean(lectura?.error)}
              onChange={(e) => void leer(e.target.files?.[0])}
            />
          </Campo>

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
            <Boton type="button" variante="contorno" onClick={cerrar}>
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
