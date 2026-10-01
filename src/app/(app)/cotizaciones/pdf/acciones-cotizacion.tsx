'use client'

import { AlertTriangle, Check, FileSearch, FileUp, MessageSquareWarning, RefreshCw, Trash2, Truck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { VistaPreviaPdf } from '@/components/ui/vista-previa-pdf'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { leerArchivoOrden } from '@/lib/archivo-orden'
import type { DatosOrdenPdf } from '@/lib/orden-pdf'
import { ACEPTA_COTIZACION, leerCabeceraDeArchivo, tipoDeCotizacion } from '@/lib/archivo-cotizacion'
import { normalizar, type TotalCotizacion } from '@/lib/cotizacion-pdf'
import { useEnvio } from '@/lib/envio'
import { createClient } from '@/lib/supabase/client'

import { corregirCotizacionPdf, emitirOrdenDeCotizacion, quitarCotizacionPdf, revisarCotizacionPdf } from './acciones'

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

/**
 * Ventas reemplaza el documento y corrige datos antes de emitir OT o liberar
 * a Tesorería. La versión previa queda en el historial y Gerencia revisa otra vez.
 *
 * Antes de subir se lee el número del archivo: si dice otra cotización, se
 * avisa. No se impide —el vendedor puede haber corregido justo el número—,
 * pero equivocarse de Word en la carpeta es lo más fácil que hay.
 */
export function CorregirCotizacion({
  id,
  numero,
  observacion,
  version,
  clienteId,
  carroceriaId,
  clientes,
  carrocerias,
}: {
  id: string
  numero: string
  observacion: string | null
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
  // Una versión nueva vuelve a preguntar por el IGV: el PDF corregido puede decir otra cosa.
  const [incluyeIgv, setIncluyeIgv] = useState<'' | 'si' | 'no'>('')
  const [cliente, setCliente] = useState(clienteId)
  const [carroceria, setCarroceria] = useState(carroceriaId)
  const [motivo, setMotivo] = useState('')
  const [progreso, setProgreso] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  function abrir() {
    setArchivo(null)
    setDice(null)
    setError(null)
    setTotal({ monto: null, moneda: null })
    setIncluyeIgv('')
    setCliente(clienteId)
    setCarroceria(carroceriaId)
    setMotivo('')
    setProgreso('')
    setAbierto(true)
  }

  async function elegir(elegido: File | undefined) {
    if (!elegido) return
    setArchivo(elegido)
    setDice(null)
    setError(null)
    if (!tipoDeCotizacion(elegido)) {
      setError('La corrección se sube en PDF o en Word.')
      return
    }
    setLeyendo(true)
    try {
      const lectura = await leerCabeceraDeArchivo(elegido, setProgreso)
      setDice(lectura.cabecera.numero)
      setTotal(lectura.total)
      setIncluyeIgv(lectura.incluyeIgv === null ? '' : lectura.incluyeIgv ? 'si' : 'no')
    } finally {
      setLeyendo(false)
    }
  }

  const otroNumero = dice !== null && normalizar(dice) !== normalizar(numero)

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return

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
          setError(`No se pudo subir el ${tipo.etiqueta}. Revisa la señal y vuelve a intentar.`)
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

        const r = await corregirCotizacionPdf(null, datos)
        if (!r.ok) {
          await supabase.storage.from('cotizaciones-pdf').remove([ruta])
          subido = false
          setError(r.error)
          return
        }
        subido = false
        setAbierto(false)
        iniciar(() => router.refresh())
      } catch {
        // Si la anotación se cae, el archivo nuevo se quita: uno que ninguna
        // fila nombra no lo ve nadie y no lo borra nadie.
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
        Editar cotización
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Corregir la cotización ${numero}`}
        descripcion="Reemplaza el PDF o Word y corrige los datos. Conserva el número y el archivo anterior; Gerencia revisará esta versión."
        ancho="md"
      >
        <form onSubmit={enviar} className="space-y-4">
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

          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileUp aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el archivo corregido'}</span>
            <span className="text-xs">{leyendo ? progreso || 'Leyendo…' : `PDF o Word · hasta ${MAXIMO_ADJUNTO_MB} MB`}</span>
            <input
              type="file"
              accept={ACEPTA_COTIZACION}
              className="sr-only"
              onChange={(e) => {
                void elegir(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_9rem_11rem]">
            <Campo etiqueta="Monto total de venta" htmlFor="corregir-monto" ayuda={total.monto ? 'Detectado en el documento; confirma o corrige el total final.' : 'No se encontró el total automáticamente; escríbelo como aparece en la cotización.'} requerido>
              <Entrada id="corregir-monto" value={total.monto ?? ''} onChange={(e) => setTotal((v) => ({ ...v, monto: e.target.value }))} inputMode="decimal" required />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor="corregir-moneda" requerido>
              <Seleccion id="corregir-moneda" value={total.moneda ?? ''} onChange={(e) => setTotal((v) => ({ ...v, moneda: e.target.value === 'PEN' || e.target.value === 'USD' ? e.target.value : null }))} required>
                <option value="" disabled>Confirma</option>
                <option value="PEN">Soles (S/)</option>
                <option value="USD">Dólares (US$)</option>
              </Seleccion>
            </Campo>
            <Campo etiqueta="¿Incluye IGV?" htmlFor="corregir-igv" requerido>
              <Seleccion
                id="corregir-igv"
                value={incluyeIgv}
                onChange={(e) => setIncluyeIgv(e.target.value === 'si' || e.target.value === 'no' ? e.target.value : '')}
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

          <Falla texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              Guardar versión y enviar a Gerencia
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Quitar la que se subió mal o la que Gerencia rechazó, si nunca tuvo orden (migración 102). */
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
 * Administración emite la orden desde la cotización aprobada: si es un
 * semirremolque o una carrocería montada, el código interno de la unidad, la fecha
 * prometida y el PDF de la orden. El tipo viene propuesto por la carrocería de
 * la cotización cuando el catálogo lo sabe. La base crea la orden aprobada,
 * con sus etapas y con el PDF pegado; de ahí en adelante el taller ya trabaja.
 */
export function EmitirOrden({
  cotizacionId,
  numero,
  tipoUnidad,
}: {
  cotizacionId: string
  numero: string
  tipoUnidad?: string | null
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [avisoLectura, setAvisoLectura] = useState('')
  const [numeroOrden, setNumeroOrden] = useState('')
  const [tipo, setTipo] = useState(tipoUnidad ?? '')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [datosLeidos, setDatosLeidos] = useState<DatosOrdenPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  function abrir() {
    setArchivo(null)
    setAvisoLectura('')
    setNumeroOrden('')
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
    setArchivo(null)
    if (elegido.size > MAXIMO_ADJUNTO_MB * 1024 * 1024) {
      setError(`El PDF pesa más de ${MAXIMO_ADJUNTO_MB} MB.`)
      return
    }
    if (!/\.pdf$/i.test(elegido.name) || new TextDecoder().decode(await elegido.slice(0, 5).arrayBuffer()) !== '%PDF-') {
      setError('El archivo debe ser un PDF válido.')
      return
    }
    setArchivo(elegido)
    setLeyendo(true)
    try {
      const datos = await leerArchivoOrden(elegido, setAvisoLectura)
      setDatosLeidos(datos)
      if (datos.numero) setNumeroOrden(datos.numero)
      if (datos.fechaEntrega) setFechaEntrega(datos.fechaEntrega)
      if (datos.tipoUnidad) setTipo(datos.tipoUnidad)
      setAvisoLectura(datos.numero || datos.fechaEntrega ? 'Datos leídos del PDF. Confírmalos antes de emitir.' : 'No se reconocieron los datos. Complétalos mirando el PDF.')
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
      let subido = false
      try {
        const { error: falla } = await supabase.storage
          .from('adjuntos-ot')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError('No se pudo subir el PDF de la orden. Revisa la señal y vuelve a intentar.')
          return
        }
        subido = true

        datos.set('cotizacion_id', cotizacionId)
        datos.set('orden_id', ordenId)
        datos.set('ruta_pdf', ruta)
        datos.set('nombre_pdf', archivo.name.slice(0, 200))
        datos.set('tamano_pdf', String(archivo.size))

        const r = await emitirOrdenDeCotizacion(null, datos)
        if (!r.ok) {
          await supabase.storage.from('adjuntos-ot').remove([ruta])
          subido = false
          setError(r.error)
          return
        }
        subido = false
        setAbierto(false)
        if (r.datos) router.push(`/ordenes/${r.datos.id}`)
      } catch {
        // La orden no se emitió: el PDF que ya viajó se quita, para que no
        // quede un archivo que ninguna orden nombra.
        if (subido) await supabase.storage.from('adjuntos-ot').remove([ruta])
        setError('No se pudo emitir la orden. Vuelve a intentar.')
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
        descripcion="El cliente y la carrocería salen de la cotización. Falta el número de la orden —el de su papel—, si es semirremolque o carrocería montada, el código interno, la fecha prometida y el PDF. Al emitirla queda aprobada, con sus etapas, y el taller ya puede armar su lista."
        ancho="panoramico"
      >
        <form onSubmit={enviar} className="space-y-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-5 lg:space-y-0">
          <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileUp aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el PDF de la orden'}</span>
            <span className="text-xs">Hasta {MAXIMO_ADJUNTO_MB} MB</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                void elegirArchivo(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          {leyendo && <p role="status" className="flex items-center gap-2 text-sm text-texto-suave"><FileSearch aria-hidden className="size-4" />{avisoLectura || 'Leyendo el PDF…'}</p>}
          {!leyendo && avisoLectura && <p role="status" className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-sm text-texto-suave">{avisoLectura}</p>}
          {datosLeidos && (datosLeidos.cliente || datosLeidos.producto) && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-xs text-texto-suave">
            {datosLeidos.cliente && <><dt>Cliente</dt><dd className="text-texto">{datosLeidos.cliente}</dd></>}
            {datosLeidos.producto && <><dt>Producto</dt><dd className="text-texto">{datosLeidos.producto}</dd></>}
          </dl>}

          {/* El número lo trae el papel (migración 108): el sistema ya no le
              pone otro, para que la OT en la mano y la de la pantalla sean la
              misma. */}
          <Campo
            etiqueta="N.º de la orden"
            htmlFor="eo-numero"
            ayuda="El que trae su PDF: 2922, o 2922-2026 si quieres escribir el año"
            requerido
          >
            <Entrada
              id="eo-numero"
              name="numero"
              autoComplete="off"
              inputMode="numeric"
              required
              maxLength={11}
              value={numeroOrden}
              onChange={(e) => setNumeroOrden(e.target.value)}
              placeholder="2922"
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
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
                onChange={(e) => setTipo(e.target.value)}
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
            <Campo etiqueta="Código interno" htmlFor="eo-codigo-interno" ayuda="Identifica la unidad dentro del taller">
              <Entrada id="eo-codigo-interno" name="codigo_interno" autoComplete="off" autoCapitalize="characters" maxLength={40} />
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
            <Entrada id="eo-fecha" name="fecha_entrega" type="date" required value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
          </Campo>

          <Falla texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              Emitir la orden
            </Boton>
          </div>
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
