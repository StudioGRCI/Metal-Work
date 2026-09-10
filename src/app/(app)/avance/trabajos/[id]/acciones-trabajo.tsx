'use client'

import { Camera, CheckCircle2, Lock, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { SelectorFotos, fotosParaEnviar, haySubiendo, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'

import { cambiarEstadoFlota, reportarFlota } from '../../acciones-flota'

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * Los gestos sobre un trabajo sin orden: reportar el día (con foto), darlo por
 * terminado o retomarlo, y cerrarlo. Cada ventana limpia lo suyo al abrirse —es
 * un evento, no un efecto—, así que la segunda vez no arrastra ni el error ni
 * las fotos de la anterior.
 */
export function AccionesTrabajo({
  trabajo,
  areas,
  areaPropia,
  puedeReportar,
  puedeArmar,
}: {
  /** `esUnidad`: si tiene placa, al cerrarlo se anota quién se la llevó. */
  trabajo: { id: string; estado: string; nombre: string; esUnidad: boolean }
  /** Las áreas en las que esta persona puede reportar: la suya, o todas. */
  areas: { id: string; codigo: string; nombre: string }[]
  areaPropia: string | null
  puedeReportar: boolean
  puedeArmar: boolean
}) {
  const cerrado = trabajo.estado === 'SALIO'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {puedeReportar && !cerrado && areas.length > 0 && (
        <Reportar flotaId={trabajo.id} areas={areas} areaPropia={areaPropia} />
      )}
      {puedeArmar && trabajo.estado === 'EN_TALLER' && (
        <CambiarEstado id={trabajo.id} estado="LISTA" icono={CheckCircle2} texto="Marcar terminado" />
      )}
      {puedeArmar && trabajo.estado === 'LISTA' && (
        <CambiarEstado id={trabajo.id} estado="EN_TALLER" icono={Undo2} texto="Retomar" />
      )}
      {puedeArmar && !cerrado && <Cerrar id={trabajo.id} nombre={trabajo.nombre} esUnidad={trabajo.esUnidad} />}
    </div>
  )
}

function Reportar({
  flotaId,
  areas,
  areaPropia,
}: {
  flotaId: string
  areas: { id: string; codigo: string; nombre: string }[]
  areaPropia: string | null
}) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  // Al guardar, la ventana se cierra y el reporte aparece arriba de la lista;
  // el aviso queda al lado del botón para que nadie dude de si entró.
  const { alEnviar, enviando, error, limpiar } = useEnvio(reportarFlota, (r) => {
    setAbierto(false)
    setAviso(r.mensaje ?? 'Reporte registrado.')
  })

  const hoy = hoyLima()
  const areaInicial = areas.some((a) => a.id === areaPropia) ? areaPropia : areas[0]?.id

  function abrir() {
    limpiar()
    setAviso(null)
    setFotos([])
    setAbierto(true)
  }

  return (
    <>
      <Boton onClick={abrir}>
        <Camera aria-hidden className="size-4" />
        Reportar
      </Boton>
      {aviso && (
        <p role="status" className="text-xs font-medium text-exito">
          {aviso}
        </p>
      )}

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Qué se hizo hoy"
        descripcion="Lo del día, con la foto de cómo quedó. Si recién empieza, cuenta cómo está: esa foto es la que vale después."
        ancho="lg"
      >
        <form
          onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos))))}
          className="space-y-3"
        >
          <input type="hidden" name="flota_id" value={flotaId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Fecha" htmlFor="rf-fecha" requerido>
              <Entrada id="rf-fecha" name="fecha" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta="Área" htmlFor="rf-area" requerido>
              <Seleccion id="rf-area" name="area_id" required defaultValue={areaInicial ?? ''}>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Qué se hizo" htmlFor="rf-descripcion" requerido>
            <AreaTexto
              id="rf-descripcion"
              name="descripcion"
              rows={3}
              required
              placeholder="Se desmontó la compuerta y se cortó el refuerzo rajado. Mañana va la nueva."
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Cuánto va"
              htmlFor="rf-avance"
              ayuda="Del 0 al 100, como lo ves. No hace falta afinar."
            >
              <Entrada
                id="rf-avance"
                name="avance_porcentaje"
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="5"
                placeholder="70"
              />
            </Campo>
            <Campo
              etiqueta="¿Algo lo traba?"
              htmlFor="rf-impedimento"
              ayuda="Material que falta, decisión del cliente, pieza en el proveedor"
            >
              <Entrada id="rf-impedimento" name="impedimento" autoComplete="off" placeholder="Nada" />
            </Campo>
          </div>

          {/* La ruta empieza por flota/{trabajo}: la base comprueba que cada foto
              cuelgue de este trabajo y las políticas de Storage la dejan ver a
              quien ve el taller. */}
          <SelectorFotos fotos={fotos} alCambiar={setFotos} prefijoRuta={`flota/${flotaId}`} />

          <Error_ texto={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando} disabled={haySubiendo(fotos)}>
              Registrar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

function CambiarEstado({
  id,
  estado,
  icono: Icono,
  texto,
}: {
  id: string
  estado: 'LISTA' | 'EN_TALLER'
  icono: typeof CheckCircle2
  texto: string
}) {
  const { alEnviar, enviando, error } = useEnvio(cambiarEstadoFlota)

  return (
    <form onSubmit={alEnviar} className="contents">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="estado" value={estado} />
      <Boton type="submit" variante="secundario" cargando={enviando}>
        <Icono aria-hidden className="size-4" />
        {texto}
      </Boton>
      <Error_ texto={error} />
    </form>
  )
}

function Cerrar({ id, nombre, esUnidad }: { id: string; nombre: string; esUnidad: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(cambiarEstadoFlota, () => setAbierto(false))

  function abrir() {
    limpiar()
    setAbierto(true)
  }

  return (
    <>
      <Boton variante="contorno" onClick={abrir}>
        <Lock aria-hidden className="size-4" />
        Cerrar
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Cerrar ${nombre}`}
        descripcion="Queda con fecha y firma, y no se reabre: si vuelve o hay que retomarlo, se registra otra vez."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="estado" value="SALIO" />

          {esUnidad && (
            <Campo etiqueta="Quién se la llevó" htmlFor="sf-retiro" ayuda="Nombre y documento, como lo apunta el vigilante">
              <Entrada id="sf-retiro" name="retiro" autoComplete="off" maxLength={200} />
            </Campo>
          )}

          <Error_ texto={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Cerrar el trabajo
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
