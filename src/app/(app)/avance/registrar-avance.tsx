'use client'

import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'

import { CampoPorcentaje, CampoTraba, FechaDelReporte } from '@/components/avance/campos-reporte'
import {
  SelectorFotos,
  fotosParaEnviar,
  haySubiendo,
  quitarFotosSueltas,
  quitarLasQueNadieNombre,
  soltarMiniaturas,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { pudoHaberEntrado } from '@/lib/acciones'
import { useEnvio } from '@/lib/envio'
import { porcentaje } from '@/lib/format'

import { registrarAvance } from './acciones'

export type EtapaElegible = { id: string; nombre: string; estado: string; avance: number }

/**
 * El parte visual del día. La foto viaja del navegador a Storage sin pasar por
 * el servidor de la aplicación, igual que los documentos; acá solo se guarda su
 * ubicación cuando el avance se registra.
 *
 * Pensado para el teléfono: la foto primero —es lo que se hace parado frente a
 * la unidad—, la fecha de hoy ya puesta, el porcentaje con un toque y la traba
 * de ayer escrita, para que un reporte nuevo no la quite sin que nadie lo diga.
 */
export function RegistrarAvance({
  ordenId,
  etapas,
  trabaActual = null,
  compacto = false,
}: {
  ordenId: string
  etapas: EtapaElegible[]
  /** La traba del último avance, que sigue vigente mientras nadie la quite. */
  trabaActual?: string | null
  compacto?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const [etapaId, setEtapaId] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  // Al guardar, la ventana se cierra y la línea nueva aparece arriba del
  // diario; el aviso queda al lado del botón para que nadie dude de si entró.
  // Antes la ventana quedaba abierta con «Registrar» activo, y un segundo toque
  // era un segundo avance.
  // Se cerró mientras se enviaba: las fotos quedaron en manos del envío.
  const cerradaEnviando = useRef(false)
  // Lo mismo, para pintar: el rechazo de un envío sin ventana se dice junto al botón.
  const [sinVentana, setSinVentana] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    async (previo: unknown, datos: FormData) => {
      let r: Awaited<ReturnType<typeof registrarAvance>>
      try {
        r = await registrarAvance(previo, datos)
      } catch (e) {
        // Se cerró mientras iba y no volvió nada: nadie va a reintentar.
        if (cerradaEnviando.current) quitarLasQueNadieNombre('fotos-avance', fotos, { pausa: true })
        throw e
      }
      // Se cerró mientras iba y no volvió un sí: la ventana ya no está para
      // quitarlas (vigesimotercera pasada). Sin respuesta, el avance pudo entrar
      // con ellas: se espera y solo se va la que ningún avance nombra.
      if (!r.ok && cerradaEnviando.current) quitarLasQueNadieNombre('fotos-avance', fotos, { pausa: pudoHaberEntrado(r.error) })
      return r
    },
    (r) => {
      // El avance entró sin sus fotos: ya subidas, ningún registro las nombra.
      if (r.datos?.fotosSueltas) quitarFotosSueltas('fotos-avance', fotos)
      setAbierto(false)
      setAviso(r.mensaje ?? 'Avance registrado.')
    },
  )

  const enCurso = etapas.filter((e) => !['TERMINADA', 'OMITIDA'].includes(e.estado))
  const etapa = enCurso.find((e) => e.id === etapaId)

  // Sin registrar, las fotos ya subidas no las nombra ningún avance: se quitan
  // de Storage, como en el ingreso del vehículo. Antes quedaban sueltas. Si se
  // cierra mientras se envía, se quedan: el avance que está entrando las nombra,
  // y quitarlas lo dejaba con fotos que no abren (vigesimosegunda pasada); si
  // la base lo rechaza, las quita el envío.
  function cerrar() {
    if (enviando) {
      cerradaEnviando.current = true
      setSinVentana(true)
      soltarMiniaturas(fotos)
    } else {
      quitarFotosSueltas('fotos-avance', fotos)
    }
    setFotos([])
    setAbierto(false)
  }

  // Cada vez que se abre empieza limpia: sin el error ni las fotos de la vez
  // anterior. Es un evento, no un efecto.
  function abrir() {
    limpiar()
    setAviso(null)
    cerradaEnviando.current = false
    setSinVentana(false)
    setFotos([])
    setEtapaId('')
    setAbierto(true)
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton tamano={compacto ? 'sm' : undefined} variante={compacto ? 'secundario' : undefined} onClick={abrir}>
          <Camera aria-hidden className={compacto ? 'size-3.5' : 'size-4'} />
          Registrar avance
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
        {/* Con la ventana cerrada mientras se enviaba, su aviso no lo vería nadie. */}
        {sinVentana && !abierto && error && (
          <span role="alert" className="text-xs text-peligro">
            El avance que se estaba enviando: {error}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={cerrar}
        titulo="Avance del día"
        descripcion="Qué se hizo hoy en esta unidad. Con la foto, el cliente y la gerencia ven cómo va sin tener que bajar al taller."
        ancho="lg"
      >
        <form
          onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos))))}
          className="space-y-4"
        >
          <input type="hidden" name="orden_id" value={ordenId} />

          {/* La ruta empieza por ot/{orden_id}: las políticas de Storage se
              apoyan en esa convención para decidir quién puede ver la foto. */}
          <SelectorFotos fotos={fotos} alCambiar={setFotos} prefijoRuta={`ot/${ordenId}/avance`} />

          <Campo etiqueta="Qué se hizo" htmlFor="descripcion" requerido>
            <AreaTexto
              id="descripcion"
              name="descripcion"
              rows={3}
              required
              placeholder="Se soldaron los travesaños del piso y se dejó lista la compuerta para pintura."
            />
          </Campo>

          <FechaDelReporte id="fecha" />

          <Campo etiqueta="Etapa" htmlFor="etapa_id" ayuda="En qué está la unidad ahora">
            <Seleccion
              id="etapa_id"
              name="etapa_id"
              value={etapaId}
              onChange={(e) => setEtapaId(e.target.value)}
            >
              <option value="">Sin etapa en particular</option>
              {enCurso.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · {porcentaje(e.avance)}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {/* Con `key`: al cambiar de etapa, el porcentaje arranca de nuevo
              en lo que esa etapa ya tenía, no en lo que se tocó para otra. */}
          <CampoPorcentaje
            key={etapaId || 'sin-etapa'}
            id="avance_porcentaje"
            name="avance_porcentaje"
            etiqueta="Avance de la etapa"
            ayuda={
              etapa
                ? `A cuánto quedó. Iba en ${porcentaje(etapa.avance)}.`
                : 'Elige primero la etapa para poder moverla.'
            }
            defaultValue={null}
            disabled={!etapa}
          />

          <CampoTraba
            id="impedimento"
            actual={trabaActual}
            ayuda="Material que falta, plano pendiente, pieza en el proveedor"
          />

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          {/* En el teléfono, «Registrar» ocupa todo el ancho y queda arriba de
              «Cancelar»: es el que se busca con el pulgar. */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton
              type="submit"
              tamano="lg"
              cargando={enviando}
              disabled={haySubiendo(fotos)}
              className="w-full sm:w-auto"
            >
              Registrar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
