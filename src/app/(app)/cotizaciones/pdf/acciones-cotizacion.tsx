'use client'

import { Check, FileUp, MessageSquareWarning, Trash2, Truck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

import { emitirOrdenDeCotizacion, quitarCotizacionPdf, revisarCotizacionPdf } from './acciones'

function Falla({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="w-full rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/** Gerencia: aprobar la cotización, o rechazarla diciendo por qué. */
export function RevisarCotizacion({ id }: { id: string }) {
  const [rechazando, setRechazando] = useState(false)
  const aprobar = useEnvio(revisarCotizacionPdf)
  const rechazar = useEnvio(revisarCotizacionPdf, () => setRechazando(false))

  if (rechazando) {
    return (
      <form onSubmit={rechazar.alEnviar} className="w-full space-y-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="RECHAZADA" />
        <AreaTexto
          name="observacion"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          autoFocus
          aria-label="Por qué se rechaza"
          placeholder="Por qué se rechaza: el precio, el plazo, falta una condición…"
        />
        <Falla texto={rechazar.error} />
        <div className="flex flex-wrap gap-2">
          <Boton type="submit" tamano="sm" variante="peligro" cargando={rechazar.enviando}>
            Rechazar la cotización
          </Boton>
          <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setRechazando(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={aprobar.alEnviar} className="contents">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="APROBADA" />
        <Boton type="submit" tamano="sm" cargando={aprobar.enviando}>
          <Check aria-hidden className="size-3.5" />
          Aprobar
        </Boton>
      </form>
      <Boton
        type="button"
        tamano="sm"
        variante="fantasma"
        onClick={() => {
          rechazar.limpiar()
          setRechazando(true)
        }}
      >
        <MessageSquareWarning aria-hidden className="size-3.5" />
        Rechazar
      </Boton>
      <Falla texto={aprobar.error} />
    </div>
  )
}

/** Quitar la que se subió mal, mientras Gerencia no la haya visto. */
export function QuitarCotizacion({ id, numero }: { id: string; numero: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(quitarCotizacionPdf)

  if (!confirmando) {
    return (
      <Boton
        type="button"
        tamano="sm"
        variante="fantasma"
        onClick={() => {
          limpiar()
          setConfirmando(true)
        }}
      >
        <Trash2 aria-hidden className="size-3.5 text-peligro" />
        Quitar
      </Boton>
    )
  }

  return (
    <form onSubmit={alEnviar} className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-peligro">¿Quitar la cotización {numero} y su PDF?</span>
      <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
        Sí, quitar
      </Boton>
      <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setConfirmando(false)}>
        No
      </Boton>
      <Falla texto={error} />
    </form>
  )
}

const TIPOS_VEHICULO = [
  ['SEMIRREMOLQUE', 'Semirremolque'],
  ['VOLQUETE', 'Volquete'],
  ['TRACTO', 'Tracto'],
  ['CAMION', 'Camión'],
  ['REMOLQUE', 'Remolque'],
  ['FURGON', 'Furgón'],
  ['OTRO', 'Otro'],
] as const

/**
 * Administración emite la orden desde la cotización aprobada: la unidad, la
 * fecha prometida y el PDF de la orden. La base la crea aprobada, con sus
 * etapas y con el PDF pegado; de ahí en adelante el taller ya trabaja.
 */
export function EmitirOrden({ cotizacionId, numero }: { cotizacionId: string; numero: string }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  function abrir() {
    setArchivo(null)
    setError(null)
    setAbierto(true)
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return

    const datos = new FormData(evento.currentTarget)
    if (!archivo) {
      setError('Elige el PDF de la orden de trabajo.')
      return
    }
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) {
      setError('La orden se sube en PDF.')
      return
    }
    if (archivo.size > MAXIMO_ADJUNTO_MB * 1024 * 1024) {
      setError(`El PDF pesa más de ${MAXIMO_ADJUNTO_MB} MB.`)
      return
    }

    enCurso.current = true
    setError(null)
    iniciar(async () => {
      const supabase = createClient()
      // El identificador de la orden se decide acá para que el PDF viaje a su
      // carpeta antes de que la orden exista: así la base las crea juntas.
      const ordenId = crypto.randomUUID()
      const ruta = `ot/${ordenId}/${crypto.randomUUID()}.pdf`
      try {
        const { error: falla } = await supabase.storage
          .from('adjuntos-ot')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError('No se pudo subir el PDF de la orden. Revisa la señal y vuelve a intentar.')
          return
        }

        datos.set('cotizacion_id', cotizacionId)
        datos.set('orden_id', ordenId)
        datos.set('ruta_pdf', ruta)
        datos.set('nombre_pdf', archivo.name.slice(0, 200))
        datos.set('tamano_pdf', String(archivo.size))

        const r = await emitirOrdenDeCotizacion(null, datos)
        if (!r.ok) {
          await supabase.storage.from('adjuntos-ot').remove([ruta])
          setError(r.error)
          return
        }
        setAbierto(false)
        if (r.datos) router.push(`/ordenes/${r.datos.id}`)
      } finally {
        enCurso.current = false
      }
    })
  }

  return (
    <>
      <Boton type="button" tamano="sm" onClick={abrir}>
        <Truck aria-hidden className="size-3.5" />
        Emitir la OT
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Emitir la orden de la ${numero}`}
        descripcion="El cliente y lo que se fabrica salen de la cotización. Falta la unidad, la fecha prometida y el PDF de la orden. Al emitirla queda aprobada, con sus etapas, y el taller ya puede armar su lista."
        ancho="md"
      >
        <form onSubmit={enviar} className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileUp aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el PDF de la orden'}</span>
            <span className="text-xs">Hasta {MAXIMO_ADJUNTO_MB} MB</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null)
                setError(null)
                e.target.value = ''
              }}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Placa" htmlFor="eo-placa" ayuda="Si todavía no tiene, marca y modelo le dan nombre">
              <Entrada id="eo-placa" name="placa" autoComplete="off" autoCapitalize="characters" placeholder="ABC-123" maxLength={20} />
            </Campo>
            <Campo etiqueta="Tipo de vehículo" htmlFor="eo-tipo">
              <Seleccion id="eo-tipo" name="tipo_vehiculo" defaultValue="SEMIRREMOLQUE">
                {TIPOS_VEHICULO.map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Marca" htmlFor="eo-marca">
              <Entrada id="eo-marca" name="marca" autoComplete="off" placeholder="Volvo" maxLength={80} />
            </Campo>
            <Campo etiqueta="Modelo" htmlFor="eo-modelo">
              <Entrada id="eo-modelo" name="modelo" autoComplete="off" placeholder="FMX 8x4" maxLength={80} />
            </Campo>
          </div>

          <Campo
            etiqueta="Fecha de entrega prometida"
            htmlFor="eo-fecha"
            ayuda="La que se le dijo al cliente: es la que manda en Control de plazos"
            requerido
          >
            <Entrada id="eo-fecha" name="fecha_entrega" type="date" required min={hoyLima()} />
          </Campo>

          <Falla texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} className="w-full sm:w-auto">
              Emitir la orden
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
