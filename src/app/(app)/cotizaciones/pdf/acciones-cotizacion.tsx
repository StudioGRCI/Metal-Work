'use client'

import { AlertTriangle, Check, Hash, MessageSquareWarning, RefreshCw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent, type Ref } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import { VistaPreviaPdf } from '@/components/ui/vista-previa-pdf'
import { motivoDeSubida } from '@/lib/acciones'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { leerArchivoOrden } from '@/lib/archivo-orden'
import type { DatosOrdenPdf } from '@/lib/orden-pdf'
import { ACEPTA_COTIZACION, ayudaDelMonto, leerCabeceraDeArchivo, tipoDeCotizacion } from '@/lib/archivo-cotizacion'
import { normalizar, type TotalCotizacion } from '@/lib/cotizacion-pdf'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { aprobarCotizacionConOt, corregirCotizacionPdf, quitarCotizacionPdf, revisarCotizacionPdf } from './acciones'

/** El rechazo de un envío; con `ref`, recibe el cursor al volver (`useCursorAlRechazo`). */
function Falla({ texto, ref }: { texto: string | null; ref?: Ref<HTMLParagraphElement> }) {
  if (!texto) return null
  return (
    <p ref={ref} role="alert" tabIndex={-1} className="w-full rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * Gerencia: aprobar la cotización, o rechazarla diciendo por qué. La que no
 * tiene OT se aprueba con su código interno y su OT, en la misma ventana; la
 * corrección de una que ya tiene OT se aprueba con un toque, como antes.
 */
export function RevisarCotizacion({
  id,
  numero,
  tipoUnidad,
  conOrden,
}: {
  id: string
  numero: string
  tipoUnidad?: string | null
  conOrden: boolean
}) {
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
      {conOrden ? (
        <form onSubmit={aprobar.alEnviar} className="contents">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="APROBADA" />
          <Boton type="submit" tamano="sm" cargando={aprobar.enviando}>
            <Check aria-hidden className="size-3.5" />
            Aprobar la corrección
          </Boton>
        </form>
      ) : (
        <AprobarConOt cotizacionId={id} numero={numero} tipoUnidad={tipoUnidad} yaAprobada={false} />
      )}
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

/**
 * Ventas reemplaza el documento y corrige datos. La versión previa queda en el
 * historial y Gerencia revisa otra vez; si ya tenía OT, conserva su código y su OT.
 *
 * Antes de subir se lee el número del archivo: si dice otra cotización, se
 * avisa. No se impide —el vendedor puede haber corregido justo el número—,
 * pero equivocarse de Word en la carpeta es lo más fácil que hay.
 */
export function CorregirCotizacion({
  id,
  numero,
  observacion,
  rechazada = false,
  version,
  clienteId,
  carroceriaId,
  clientes,
  carrocerias,
}: {
  id: string
  numero: string
  observacion: string | null
  /** La rechazada solo se corrige —no se quita—, y el botón lo dice así. */
  rechazada?: boolean
  version: number
  clienteId: string
  carroceriaId: string
  clientes: { id: string; razon_social: string }[]
  carrocerias: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [dice, setDice] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [total, setTotal] = useState<TotalCotizacion>({ monto: null, moneda: null })
  const [montoLeido, setMontoLeido] = useState<string | null>(null)
  // Una versión nueva vuelve a preguntar por el IGV: el PDF corregido puede decir otra cosa.
  const [incluyeIgv, setIncluyeIgv] = useState<'' | 'si' | 'no'>('')
  const [cliente, setCliente] = useState(clienteId)
  const [carroceria, setCarroceria] = useState(carroceriaId)
  const [motivo, setMotivo] = useState('')
  const [progreso, setProgreso] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Por qué el archivo elegido no sirve: va en su campo, no con los errores de enviar.
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)
  const campoArchivo = useRef<HTMLInputElement>(null)
  // Al volver de un rechazo, el cursor va al aviso: la ventana estuvo trabada.
  const avisoError = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => avisoError.current)
  // Lo que la persona escribió a mano: la lectura del archivo no lo pisa.
  const aMano = useRef(new Set<'monto' | 'moneda' | 'igv'>())

  function abrir() {
    aMano.current.clear()
    setArchivo(null)
    setDice(null)
    setError(null)
    setAvisoArchivo(null)
    setTotal({ monto: null, moneda: null })
    setMontoLeido(null)
    setIncluyeIgv('')
    setCliente(clienteId)
    setCarroceria(carroceriaId)
    setMotivo('')
    setProgreso('')
    setAbierto(true)
  }

  async function elegir(elegido: File | undefined) {
    if (!elegido) return
    setDice(null)
    setMontoLeido(null)
    setError(null)
    const noSirve = await revisarArchivo(elegido, ACEPTA_COTIZACION, MAXIMO_ADJUNTO_MB)
    setArchivo(elegido)
    setAvisoArchivo(noSirve)
    if (noSirve) return
    setLeyendo(true)
    try {
      const lectura = await leerCabeceraDeArchivo(elegido, setProgreso)
      setDice(lectura.cabecera.numero)
      setMontoLeido(lectura.total.monto)
      const montoAMano = aMano.current.has('monto')
      const monedaAMano = aMano.current.has('moneda')
      setTotal((v) => ({ monto: montoAMano ? v.monto : lectura.total.monto, moneda: monedaAMano ? v.moneda : lectura.total.moneda }))
      if (!aMano.current.has('igv')) setIncluyeIgv(lectura.incluyeIgv === null ? '' : lectura.incluyeIgv ? 'si' : 'no')
    } finally {
      setLeyendo(false)
    }
  }

  const otroNumero = dice !== null && normalizar(dice) !== normalizar(numero)

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return
    // Lo que falta o no sirve del archivo lo dice su campo, y el cursor va ahí.
    if (!archivo || avisoArchivo) {
      if (!archivo) setAvisoArchivo('Falta el archivo corregido: elige el PDF o el Word')
      campoArchivo.current?.focus()
      return
    }

    const tipo = archivo ? tipoDeCotizacion(archivo) : null
    if (!archivo || !tipo) {
      setError(archivo ? 'La corrección se sube en PDF o en Word.' : 'Elige el archivo corregido.')
      return
    }
    if (!total.monto || !Number.isFinite(Number(total.monto)) || Number(total.monto) <= 0 || !total.moneda) {
      setError('Confirma el monto total de venta y su moneda antes de enviar la corrección.')
      return
    }
    if (!incluyeIgv) {
      setError('Indica si el total de la cotización corregida incluye IGV.')
      return
    }
    if (archivo.size > MAXIMO_ADJUNTO_MB * 1024 * 1024) {
      setError(`El archivo pesa más de ${MAXIMO_ADJUNTO_MB} MB.`)
      return
    }
    if (!cliente || !carroceria || motivo.trim().length < 5) {
      setError('Elige cliente y carrocería, e indica por qué corriges la cotización.')
      return
    }

    enCurso.current = true
    setError(null)
    iniciar(async () => {
      const supabase = createClient()
      const ruta = `cot/${id}/${crypto.randomUUID()}.${tipo.extension}`
      let subido = false
      try {
        const { error: falla } = await supabase.storage
          .from('cotizaciones-pdf')
          .upload(ruta, archivo, { contentType: tipo.mime, upsert: false })
        if (falla) {
          setError(`No se pudo subir el ${tipo.etiqueta}. ${motivoDeSubida(falla)}`)
          return
        }
        subido = true

        const datos = new FormData()
        datos.set('id', id)
        datos.set('version', String(version))
        datos.set('cliente_id', cliente)
        datos.set('tipo_carroceria_id', carroceria)
        datos.set('motivo_correccion', motivo.trim())
        datos.set('nombre_archivo', archivo.name.slice(0, 200))
        datos.set('ruta_storage', ruta)
        datos.set('mime_type', tipo.mime)
        datos.set('tamano_bytes', String(archivo.size))
        datos.set('monto_venta', total.monto ?? '')
        datos.set('moneda', total.moneda ?? '')
        datos.set('incluye_igv', incluyeIgv)

        // Si la base dice que no, o no responde y la corrección no quedó, el
        // archivo nuevo se quita: uno que ninguna fila nombra no lo ve nadie.
        const r = await anotarSinDejarloSuelto({
          bucket: 'cotizaciones-pdf',
          ruta,
          anotar: () => corregirCotizacionPdf(null, datos),
          sinRespuesta: 'No llegó la respuesta. Recarga la lista y mira si la corrección quedó antes de volver a subirla.',
        })
        subido = false
        if (!r.ok) {
          setError(r.error)
          return
        }
        setAbierto(false)
        iniciar(() => router.refresh())
      } catch {
        // Lo que se cae acá es la subida: la corrección todavía no se anotó.
        if (subido) await supabase.storage.from('cotizaciones-pdf').remove([ruta])
        setError('No se pudo subir la corrección. Vuelve a intentar.')
      } finally {
        enCurso.current = false
      }
    })
  }

  return (
    <>
      <Boton type="button" tamano="sm" onClick={abrir}>
        <RefreshCw aria-hidden className="size-3.5" />
        {rechazada ? 'Subir corrección' : 'Editar cotización'}
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Corregir la cotización ${numero}`}
        descripcion="Reemplaza el PDF o Word y corrige los datos. Conserva el número y el archivo anterior; Gerencia revisará esta versión."
        ancho="md"
      >
        <form onSubmit={enviar}>
          {/* Mientras se registra, nada se cambia: queda lo que se envió. */}
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
          {observacion && (
            <div className="flex items-start gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
              <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-medium">Lo que observó Gerencia:</span> {observacion}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Cliente" htmlFor={`corregir-cliente-${id}`} requerido>
              <Seleccion id={`corregir-cliente-${id}`} value={cliente} onChange={e => setCliente(e.target.value)} required>
                <option value="" disabled>Elige el cliente</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Carrocería" htmlFor={`corregir-carroceria-${id}`} requerido>
              <Seleccion id={`corregir-carroceria-${id}`} value={carroceria} onChange={e => setCarroceria(e.target.value)} required>
                <option value="" disabled>Elige la carrocería</option>
                {carrocerias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Seleccion>
            </Campo>
          </div>
          <Campo etiqueta="Motivo de la corrección" htmlFor={`corregir-motivo-${id}`} requerido>
            <AreaTexto id={`corregir-motivo-${id}`} value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} minLength={5} maxLength={500} required placeholder="Qué dato o documento se corrigió" />
          </Campo>

          <Campo etiqueta="Archivo corregido" htmlFor={`corregir-archivo-${id}`} requerido>
            <ElegirArchivo
              ref={campoArchivo}
              id={`corregir-archivo-${id}`}
              required
              accept={ACEPTA_COTIZACION}
              texto="Elegir el archivo corregido"
              hastaMb={MAXIMO_ADJUNTO_MB}
              archivo={archivo}
              aviso={avisoArchivo}
              estado={leyendo ? progreso || 'Leyendo el archivo…' : null}
              onChange={(e) => void elegir(e.target.files?.[0])}
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-[1fr_9rem_11rem]">
            <Campo etiqueta="Monto total de venta" htmlFor="corregir-monto" ayuda={ayudaDelMonto(total.monto, montoLeido)} requerido>
              <Entrada
                id="corregir-monto"
                value={total.monto ?? ''}
                onChange={(e) => {
                  aMano.current.add('monto')
                  setTotal((v) => ({ ...v, monto: e.target.value }))
                }}
                inputMode="decimal"
                required
              />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor="corregir-moneda" requerido>
              <Seleccion
                id="corregir-moneda"
                value={total.moneda ?? ''}
                onChange={(e) => {
                  aMano.current.add('moneda')
                  setTotal((v) => ({ ...v, moneda: e.target.value === 'PEN' || e.target.value === 'USD' ? e.target.value : null }))
                }}
                required
              >
                <option value="" disabled>Confirma</option>
                <option value="PEN">Soles (S/)</option>
                <option value="USD">Dólares (US$)</option>
              </Seleccion>
            </Campo>
            <Campo etiqueta="¿Incluye IGV?" htmlFor="corregir-igv" requerido>
              <Seleccion
                id="corregir-igv"
                value={incluyeIgv}
                onChange={(e) => {
                  aMano.current.add('igv')
                  setIncluyeIgv(e.target.value === 'si' || e.target.value === 'no' ? e.target.value : '')
                }}
                required
              >
                <option value="" disabled>Confirma</option>
                <option value="si">Sí, incluye IGV</option>
                <option value="no">No, es sin IGV</option>
              </Seleccion>
            </Campo>
          </div>

          {otroNumero && (
            <p role="status" className="flex items-start gap-2 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-aviso">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              El archivo dice {dice} y esta cotización es la {numero}. Revisa que sea el archivo correcto antes de subirlo.
            </p>
          )}

          <Falla ref={avisoError} texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              Guardar versión y enviar a Gerencia
            </Boton>
          </div>
          </fieldset>
        </form>
      </Ventana>
    </>
  )
}

/** Quitar la que se subió mal, mientras nadie la revisó y nunca tuvo orden (migraciones 102 y 20261020161000). La rechazada se corrige: no se quita. */
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

// Lo que se fabrica, y nada más (migración 104): la misma división que usan el
// catálogo de carrocerías y las cotizaciones.
const TIPOS_UNIDAD = [
  ['SEMIRREMOLQUE', 'Semirremolque'],
  ['CARROCERIA_MONTADA', 'Carrocería montada'],
] as const

/**
 * Gerencia aprueba la cotización dando el código interno que tendrá la unidad
 * —nuevo, o uno que ya existe del mismo cliente— y subiendo la OT: su PDF, su
 * número, si es semirremolque o carrocería montada y la fecha prometida. El
 * tipo viene propuesto por la carrocería de la cotización cuando el catálogo lo
 * sabe. La base hace todo junto o nada (migración 20261016900000): desde ahí
 * Diseño ve la OT dentro del código y Contabilidad ya la puede facturar.
 *
 * `yaAprobada` es la que Gerencia aprobó antes de este cambio y quedó sin OT:
 * la misma ventana le da su código y su OT.
 */
export function AprobarConOt({
  cotizacionId,
  numero,
  tipoUnidad,
  yaAprobada,
}: {
  cotizacionId: string
  numero: string
  tipoUnidad?: string | null
  yaAprobada: boolean
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  // El que no sirve se queda a la vista en su campo, con el motivo; `archivo` es solo el que sí.
  const [rechazado, setRechazado] = useState<{ archivo: File; motivo: string } | null>(null)
  const [faltaPdf, setFaltaPdf] = useState(false)
  const campoPdf = useRef<HTMLInputElement>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [avisoLectura, setAvisoLectura] = useState('')
  const [numeroOrden, setNumeroOrden] = useState('')
  const [codigo, setCodigo] = useState('')
  const [tipo, setTipo] = useState(tipoUnidad ?? '')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [datosLeidos, setDatosLeidos] = useState<DatosOrdenPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)
  // Al volver de un rechazo, el cursor va al número repetido, que se dice junto
  // a su campo, o al aviso: la ventana estuvo trabada.
  const avisoError = useRef<HTMLParagraphElement>(null)
  const campoNumero = useRef<HTMLInputElement>(null)
  const errorNumero = error?.startsWith('Ya hay una OT') ? error : null
  useCursorAlRechazo(enviando, error, () => (errorNumero ? campoNumero.current : avisoError.current))
  // Lo que la persona escribió a mano: la lectura del PDF, aunque termine
  // después o sea de otro PDF, no lo pisa.
  const aMano = useRef(new Set<'numero' | 'fecha' | 'tipo'>())
  // Si el número escrito no es el del PDF, se dice.
  const otroNumero =
    !leyendo && datosLeidos?.numero && numeroOrden.trim() && !mismaOt(numeroOrden, datosLeidos.numero) ? datosLeidos.numero : null

  function abrir() {
    aMano.current.clear()
    setArchivo(null)
    setRechazado(null)
    setFaltaPdf(false)
    setAvisoLectura('')
    setNumeroOrden('')
    setCodigo('')
    setTipo(tipoUnidad ?? '')
    setFechaEntrega('')
    setDatosLeidos(null)
    setError(null)
    setAbierto(true)
  }

  async function elegirArchivo(elegido: File | undefined) {
    if (!elegido) return
    setError(null)
    setAvisoLectura('')
    setDatosLeidos(null)
    setFaltaPdf(false)
    const motivo = await revisarArchivo(elegido, 'application/pdf,.pdf', MAXIMO_ADJUNTO_MB)
    setArchivo(motivo ? null : elegido)
    setRechazado(motivo ? { archivo: elegido, motivo } : null)
    if (motivo) return
    setLeyendo(true)
    try {
      const datos = await leerArchivoOrden(elegido, setAvisoLectura)
      setDatosLeidos(datos)
      // El número escrito a mano se queda, salvo que sea la misma OT: entonces
      // va el del PDF, que trae el año.
      const leido = datos.numero
      const numeroAMano = aMano.current.has('numero')
      if (leido) setNumeroOrden((escrito) => (numeroAMano && escrito.trim() && !mismaOt(escrito, leido) ? escrito : leido))
      if (datos.fechaEntrega && !aMano.current.has('fecha')) setFechaEntrega(datos.fechaEntrega)
      if (datos.tipoUnidad && !aMano.current.has('tipo')) setTipo(datos.tipoUnidad)
      setAvisoLectura(datos.numero || datos.fechaEntrega ? 'Datos leídos del PDF. Confírmalos antes de aprobar.' : 'No se reconocieron los datos. Complétalos mirando el PDF.')
    } catch {
      setAvisoLectura('No se pudo leer el PDF. Completa los datos mirando la vista previa.')
    } finally {
      setLeyendo(false)
    }
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return

    const datos = new FormData(evento.currentTarget)
    if (codigo.trim().length < 2) {
      setError('Escribe el código interno que tendrá la unidad.')
      return
    }
    if (!archivo) {
      // Lo dice su campo, como en la orden nueva, y el cursor va ahí.
      if (!rechazado) setFaltaPdf(true)
      campoPdf.current?.focus()
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
      let subido = false
      try {
        const { error: falla } = await supabase.storage
          .from('adjuntos-ot')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError(`No se pudo subir el PDF de la orden. ${motivoDeSubida(falla)}`)
          return
        }
        subido = true

        datos.set('cotizacion_id', cotizacionId)
        datos.set('orden_id', ordenId)
        datos.set('ruta_pdf', ruta)
        datos.set('nombre_pdf', archivo.name.slice(0, 200))
        datos.set('tamano_pdf', String(archivo.size))

        // Si no se aprobó, el PDF que ya viajó se quita, para que no quede un
        // archivo que ninguna OT nombra. Sin respuesta se pregunta otra vez con
        // la misma orden: si la primera entró, la base no crea otra.
        const r = await anotarSinDejarloSuelto({
          bucket: 'adjuntos-ot',
          ruta,
          anotar: () => aprobarCotizacionConOt(null, datos),
          sinRespuesta: 'No llegó la respuesta. Recarga la lista y mira si la cotización quedó aprobada antes de volver a intentar.',
        })
        subido = false
        if (!r.ok) {
          setError(r.error)
          return
        }
        setAbierto(false)
        iniciar(() => router.refresh())
      } catch {
        // Lo que se cae acá es la subida: todavía no se aprobó.
        if (subido) await supabase.storage.from('adjuntos-ot').remove([ruta])
        setError('No se pudo aprobar con la OT. Vuelve a intentar.')
      } finally {
        enCurso.current = false
      }
    })
  }

  return (
    <>
      <Boton type="button" tamano="sm" onClick={abrir}>
        {yaAprobada ? <Hash aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />}
        {yaAprobada ? 'Dar código y cargar la OT' : 'Aprobar'}
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={yaAprobada ? `Código interno y OT de la ${numero}` : `Aprobar la ${numero}`}
        descripcion={
          yaAprobada
            ? 'Ya está aprobada pero no tiene OT. Escribe el código interno que tendrá la unidad y sube la OT: desde ahí Diseño la ve dentro del código y Contabilidad ya la puede facturar.'
            : 'Se aprueba con el código interno que tendrá la unidad y su OT, todo junto. El cliente y la carrocería salen de la cotización. Desde ahí Diseño ve la OT dentro del código y Contabilidad ya la puede facturar.'
        }
        ancho="panoramico"
      >
        <form onSubmit={enviar} className="space-y-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-5 lg:space-y-0">
          {/* Con margen a la izquierda: la columna corta lo que sale de ella, y el anillo de foco sale 5 px. */}
          <div className="space-y-4 lg:-ml-2 lg:min-h-0 lg:overflow-y-auto lg:pr-2 lg:pl-2">
          {/* Mientras se registra, nada se cambia: queda lo que se envió. */}
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
          <Campo
            etiqueta="Código interno"
            htmlFor="eo-codigo-interno"
            ayuda="El que tendrá la unidad, como VSC_SR_O4_6_26/30. Si ya existe para este cliente, la OT se suma a esa unidad."
            requerido
          >
            <Entrada
              id="eo-codigo-interno"
              name="codigo_interno"
              autoComplete="off"
              autoCapitalize="characters"
              required
              minLength={2}
              maxLength={40}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="font-mono"
            />
          </Campo>

          <Campo etiqueta="PDF de la OT" htmlFor={`aprobar-pdf-${cotizacionId}`} requerido>
            <ElegirArchivo
              ref={campoPdf}
              id={`aprobar-pdf-${cotizacionId}`}
              required
              accept="application/pdf,.pdf"
              texto="Elegir el PDF de la OT"
              hastaMb={MAXIMO_ADJUNTO_MB}
              archivo={archivo ?? rechazado?.archivo ?? null}
              aviso={rechazado?.motivo ?? (faltaPdf ? 'Falta el PDF de la OT: sin él no se aprueba' : null)}
              estado={leyendo ? avisoLectura || 'Leyendo el PDF…' : null}
              onChange={(e) => void elegirArchivo(e.target.files?.[0])}
            />
          </Campo>

          {!leyendo && avisoLectura && <p role="status" className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-sm text-texto-suave">{avisoLectura}</p>}
          {datosLeidos && (datosLeidos.cliente || datosLeidos.producto) && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-xs text-texto-suave">
            {datosLeidos.cliente && <><dt>Cliente</dt><dd className="text-texto">{datosLeidos.cliente}</dd></>}
            {datosLeidos.producto && <><dt>Producto</dt><dd className="text-texto">{datosLeidos.producto}</dd></>}
          </dl>}

          {/* El número lo trae el papel (migración 108): el sistema ya no le
              pone otro, para que la OT en la mano y la de la pantalla sean la
              misma. */}
          <Campo
            etiqueta="N.º de la OT"
            htmlFor="eo-numero"
            ayuda="El que trae su PDF: 2922, o 2922-2026 si quieres escribir el año"
            error={errorNumero ?? undefined}
            requerido
          >
            <Entrada
              ref={campoNumero}
              id="eo-numero"
              name="numero"
              autoComplete="off"
              // Texto y no `numeric`: el teclado de cifras del iPhone no trae el guion del año.
              inputMode="text"
              required
              maxLength={11}
              value={numeroOrden}
              onChange={(e) => {
                aMano.current.add('numero')
                if (errorNumero) setError(null)
                setNumeroOrden(e.target.value)
              }}
              placeholder="2922"
            />
          </Campo>
          {otroNumero && (
            <p role="status" className="-mt-2 text-xs text-aviso">
              El PDF dice la OT {otroNumero}: revisa el número.
            </p>
          )}

          <div className="grid gap-4">
            <Campo
              etiqueta="Tipo"
              htmlFor="eo-tipo"
              ayuda={tipoUnidad ? 'Propuesto por la carrocería de la cotización' : undefined}
              requerido
            >
              <Seleccion
                id="eo-tipo"
                name="tipo_unidad"
                required
                value={tipo}
                onChange={(e) => {
                  aMano.current.add('tipo')
                  setTipo(e.target.value)
                }}
              >
                <option value="" disabled>
                  Elige el tipo
                </option>
                {TIPOS_UNIDAD.map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <h3 className="text-sm font-medium sm:col-span-2">Datos del chasis</h3>
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
            ayuda="La que se le dijo al cliente: es la que manda al medir si la OT se entregó a tiempo"
            requerido
          >
            <Entrada
              id="eo-fecha"
              name="fecha_entrega"
              type="date"
              required
              value={fechaEntrega}
              onChange={(e) => {
                aMano.current.add('fecha')
                setFechaEntrega(e.target.value)
              }}
            />
          </Campo>

          <Falla ref={avisoError} texto={errorNumero ? null : error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              {yaAprobada ? 'Guardar código y OT' : 'Aprobar con código y OT'}
            </Boton>
          </div>
          </fieldset>
          </div>
          <aside aria-label="Vista previa de la orden de trabajo" className="flex min-h-[22rem] flex-col overflow-hidden rounded-[var(--radius-base)] border border-borde bg-superficie-2 lg:min-h-0">
            <div className="border-b border-borde px-4 py-3">
              <p className="text-sm font-semibold text-texto">Vista previa de la OT</p>
              <p className="truncate text-xs text-texto-suave">{archivo?.name ?? 'Elige el PDF para comparar los datos'}</p>
            </div>
            {archivo ? <VistaPreviaPdf key={`${archivo.name}-${archivo.lastModified}-${archivo.size}`} archivo={archivo} titulo="PDF de la orden de trabajo" /> : <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-texto-suave">El PDF aparecerá aquí al seleccionarlo.</div>}
          </aside>
        </form>
      </Ventana>
    </>
  )
}

/** 390, 0390 y 0390-2026 son la misma OT; el año, si se escribe en los dos, se compara. */
function mismaOt(a: string, b: string) {
  const partes = (t: string) => /^0*(\d+)(?:-(\d{4}))?$/.exec(t.trim())
  const x = partes(a)
  const y = partes(b)
  if (!x || !y) return a.trim() === b.trim()
  return x[1] === y[1] && (!x[2] || !y[2] || x[2] === y[2])
}
