'use client'

import { AlertTriangle, Check, Hash, MessageSquareWarning, RefreshCw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition, type FormEvent, type Ref } from 'react'

import { EstadoDelEnvio, useEnvioDeLaVentana } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import { VistaPreviaPdf } from '@/components/ui/vista-previa-pdf'
import { motivoDeSubida } from '@/lib/acciones'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { fecha } from '@/lib/format'
import { leerArchivoOrden } from '@/lib/archivo-orden'
import type { DatosOrdenPdf } from '@/lib/orden-pdf'
import { ACEPTA_COTIZACION, ayudaDelMonto, leerCabeceraDeArchivo, tipoDeCotizacion, totalDelDocumentoSiNoCalza } from '@/lib/archivo-cotizacion'
import { normalizar, type TotalCotizacion } from '@/lib/cotizacion-pdf'
import { anotarQueSeVa, enviosEnCamino, laPestanaEsDeLaVersionAnterior, laPestanaEsDeOtraCuenta, mientrasSeEnvia, NO_SE_GUARDO_OTRA_CUENTA, OtraCuentaEnLaPestana, quitarConLaCuenta, refrescarSiEsDeLaPestana, SE_ACTUALIZO_EL_SISTEMA, seguirConLaCuentaDeLaPestana, useCursorAlRechazo, useEnvio, useEnviosEnCamino } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { createClient } from '@/lib/supabase/client'

import { cargarCodigoYOt, corregirCotizacionPdf, quitarCotizacionPdf, revisarCotizacionPdf } from './acciones'

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
 * Gerencia: aprobar la cotización con un toque, o rechazarla diciendo por qué.
 * El código interno y la OT los carga después Administración (migración
 * 20261027200000); la corrección de una que ya tiene OT los conserva.
 */
export function RevisarCotizacion({ id, conOrden }: { id: string; conOrden: boolean }) {
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
          {conOrden ? 'Aprobar la corrección' : 'Aprobar'}
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
  aprobada = false,
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
  /** La aprobada que se corrige vuelve a Gerencia y no se factura hasta que apruebe esta versión. */
  aprobada?: boolean
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
  const [totalLeido, setTotalLeido] = useState<TotalCotizacion | null>(null)
  const totalDelDocumento = totalDelDocumentoSiNoCalza(total, totalLeido)
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
  // Cerrada mientras va: el botón que la abre gira y el desenlace se dice a su
  // lado, también que entró (no hay otro aviso: la tarjeta cambia callada).
  // Ese verde dura lo que la versión que dejó por revisar: cuando Gerencia la
  // aprueba o la rechaza, ya no la «revisa» (D1 de la trigesimosexta pasada).
  const fuera = useEnvioDeLaVentana(`corregir-cotizacion:${id}`, {
    alEntrar: { dice: 'quedó guardada: Gerencia revisa esta versión.', mientras: `por-revisar:${version + 1}` },
    ahora: `${rechazada || aprobada ? 'decidida' : 'por-revisar'}:${version}`,
  })
  // Cerrada mientras va, o mientras la página se pone al día tras el ok: no se abre otra.
  const ocupado = fuera.sigue || (enviando && !abierto)
  const campoArchivo = useRef<HTMLInputElement>(null)
  // Al volver de un rechazo, el cursor va al aviso: la ventana estuvo trabada.
  const avisoError = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => avisoError.current)
  // Lo que la persona escribió a mano: la lectura del archivo no lo pisa.
  const aMano = useRef(new Set<'monto' | 'moneda' | 'igv'>())

  // La X, Escape, el fondo y «Cancelar»: todos cierran igual (`useEnvioDeLaVentana`).
  function cerrar() {
    fuera.cerrar()
    setAbierto(false)
  }

  function abrir() {
    aMano.current.clear()
    setArchivo(null)
    setDice(null)
    setError(null)
    setAvisoArchivo(null)
    setTotal({ monto: null, moneda: null })
    setTotalLeido(null)
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
    setTotalLeido(null)
    setError(null)
    const noSirve = await revisarArchivo(elegido, ACEPTA_COTIZACION, MAXIMO_ADJUNTO_MB)
    setArchivo(elegido)
    setAvisoArchivo(noSirve)
    if (noSirve) return
    setLeyendo(true)
    try {
      const lectura = await leerCabeceraDeArchivo(elegido, setProgreso)
      setDice(lectura.cabecera.numero)
      setTotalLeido(lectura.total)
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

    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setError(null)
    // Como en `useAccion`: «Volver a cargar», el del aviso de arriba tras un
    // despliegue, espera a que la corrección vuelva, y si no entró no recarga
    // (D17 de la trigesimotercera pasada, en «Subir cotización»).
    iniciar(() => mientrasSeEnvia(async (entro, decirArriba) => {
      // Cómo terminó, por si la ventana se cierra mientras va (`useEnvioDeLaVentana`).
      const terminar = fuera.empezar(decirArriba)
      let comoTermino: string | null = null
      const noEntro = (porque: string) => {
        comoTermino = porque
        setError(porque)
      }
      const supabase = createClient()
      const ruta = `cot/${id}/${crypto.randomUUID()}.${tipo.extension}`
      let subido = false
      try {
        // La pestaña ya se sabe de antes del último despliegue: lo que lo
        // registraría no va a entrar, así que ni se sube (trigésima pasada).
        if (laPestanaEsDeLaVersionAnterior()) {
          noEntro(SE_ACTUALIZO_EL_SISTEMA)
          return
        }
        const { error: falla } = await subirARutaNueva(supabase.storage.from('cotizaciones-pdf'), ruta, archivo, tipo.mime, quitarConLaCuenta)
        // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
        if (falla) seguirConLaCuentaDeLaPestana()
        if (falla) {
          noEntro(`No se pudo subir el ${tipo.etiqueta}. ${motivoDeSubida(falla)}`)
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
          noEntro(r.error)
          return
        }
        setAbierto(false)
        entro()
        iniciar(() => refrescarSiEsDeLaPestana(router))
      } catch (e) {
        // Entró otra cuenta a media cadena: no sigue, y el archivo que haya
        // subido se quita cuando vuelva la tuya (`anotarSinDejarloSuelto`). La
        // ventana dice que no se guardó: al volver, el cursor va ahí.
        if (e instanceof OtraCuentaEnLaPestana) {
          noEntro(NO_SE_GUARDO_OTRA_CUENTA)
          return
        }
        // Lo que se cae acá es la subida: la corrección todavía no se anotó.
        if (subido) await quitarConLaCuenta(() => supabase.storage.from('cotizaciones-pdf').remove([ruta]))
        noEntro('No se pudo subir la corrección. Vuelve a intentar.')
      } finally {
        enCurso.current = false
        terminar(comoTermino)
      }
    }))
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton type="button" tamano="sm" onClick={abrir} ocupado={ocupado} aria-describedby={fuera.sigue ? fuera.idDelEstado : undefined}>
          {!ocupado && <RefreshCw aria-hidden className="size-3.5" />}
          {rechazada ? 'Subir corrección' : 'Editar cotización'}
        </Boton>
        <EstadoDelEnvio id={fuera.idDelEstado} sigue={fuera.sigue} desenlace={fuera.desenlace} registro="La corrección" femenino />
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={cerrar}
        titulo={`Corregir la cotización ${numero}`}
        descripcion={
          aprobada
            ? 'Reemplaza el PDF o Word y corrige los datos. Conserva el número y el archivo anterior. Vuelve a Por revisar: no se factura hasta que Gerencia apruebe esta versión.'
            : 'Reemplaza el PDF o Word y corrige los datos. Conserva el número y el archivo anterior; Gerencia revisará esta versión.'
        }
        ancho="md"
      >
        <form onSubmit={enviar} className="space-y-4">
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

          {/* Uno debajo del otro: lado a lado, en esta ventana la razón social
              se cortaba («TRANSPORTES SAN RO…») y no se sabía qué cliente era. */}
          <div className="grid gap-3">
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

          <div className="grid gap-3 sm:grid-cols-2">
            {/* El monto, en su propia fila: la ventana es angosta y en un tercio su
                ayuda y su aviso se partían en tres renglones. El aviso va pegado a él. */}
            <div className="space-y-1.5 sm:col-span-2">
              <Campo etiqueta="Monto total de venta" htmlFor="corregir-monto" ayuda={ayudaDelMonto(total, totalLeido)} requerido>
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
              {totalDelDocumento && (
                <p role="status" className="text-xs text-pretty text-aviso">
                  El documento dice {totalDelDocumento}: revisa el total.
                </p>
              )}
            </div>
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

          </fieldset>

          <Falla ref={avisoError} texto={error} />

          {/* Fuera de lo trabado: «Cancelar» cierra también mientras se envía, como la X (D2 de la trigesimosexta pasada). */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={cerrar}>
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

// La OT que entró y no fue a su tarjeta (`vaSolaALaTarjeta`): la dice el
// encabezado (`EstadoDeLaOt`). Sin `guardar`: al salir de Cotización ya no se
// dice, como el «PDF guardado» que se iba de la orden (Y2 de la trigesimosexta pasada).
const OT_CARGADA = 'codigo-y-ot:cargada'
type OtCargada = { id: string; numero: string }

// La última vez que la persona tocó la pantalla o una tecla: si fue después de
// cerrar la ventana de la OT, ya está en otra cosa.
let tocoEn = -1
if (typeof window !== 'undefined')
  for (const tipo of ['pointerdown', 'keydown'] as const) window.addEventListener(tipo, () => void (tocoEn = performance.now()), true)

/**
 * La ida a la tarjeta de la OT que acaba de entrar sale en el acto o no sale.
 * Esperar a que no quedara nada en camino ni otra ventana abierta la dejaba
 * armada: salía minutos después, desde otra pantalla, y se llevaba lo escrito
 * allí (Y1 de la crítica de la trigesimosexta pasada). Sale si la persona
 * sigue en Cotización con su cuenta, si este es el único envío en camino (la
 * navegación de Next espera a los que van en transición, y montaba la lista
 * entera con otra ventana abierta encima) y, si su ventana se cerró mientras
 * iba, si desde entonces no tocó nada: el menú o la búsqueda que pidió en ese
 * rato quedaban en cola, y la ida los reemplazaba (funcionalidad H2 de la
 * trigesimoséptima). Si no sale, lo dice el encabezado, con el camino a la tarjeta.
 */
function vaSolaALaTarjeta(cerradaEn: number | null) {
  if (window.location.pathname !== '/cotizaciones/pdf' || laPestanaEsDeOtraCuenta()) return false
  if (enviosEnCamino() > 1) return false
  return cerradaEn === null || tocoEn <= cerradaEn
}

/**
 * A la tarjeta de la cotización, resaltada (`target:`), sin recargar: la
 * recarga se llevaba el rechazo de otra OT que se acababa de decir (F1 de la
 * trigesimosexta pasada). En «Aprobadas sin código» la recién cargada se iba
 * de la lista: se va a la lista entera. Next la trae a la vista al pintarla,
 * pero el navegador la resalta solo cuando lo de después de «#» cambia por su
 * cuenta, no por `pushState`: se le quita y se le vuelve a poner.
 *
 * `trasEnviar`, la que sale sola al entrar la OT: si cambia la pantalla (desde
 * un filtro o una búsqueda), en la pestaña de otro despliegue Next la carga
 * entera, y «Volver a cargar» no recarga encima (`anotarQueSeVa`). «Ver su
 * tarjeta» no envió nada: anotarla hacía decir arriba «Lo que enviaste ya
 * entró» sin envío, o de una OT que la base rechazó (Z1 de la crítica de la
 * trigesimoséptima pasada).
 */
function irALaTarjeta(id: string, router: ReturnType<typeof useRouter>, { trasEnviar = false } = {}) {
  const destino = `/cotizaciones/pdf#${id}`
  if (trasEnviar && window.location.search !== '') anotarQueSeVa(destino)
  router.push(destino)
  const hasta = performance.now() + 15_000
  const resaltar = () => {
    const aqui = window.location
    if (aqui.pathname === '/cotizaciones/pdf' && aqui.search === '' && aqui.hash === `#${id}` && document.getElementById(id)) {
      // Sin pasar por Next (lleva su estado): su dirección ya es esta.
      const estado = window.history.state
      window.history.replaceState(estado, '', aqui.pathname)
      aqui.replace(`#${id}`)
      // Ir al ancla deja la entrada sin el estado de Next, y Next no atiende el
      // «Atrás» o «Adelante» que llega a una entrada sin el suyo: cambiaba la
      // dirección y no la pantalla (H1 de los tres auditores, trigesimoséptima pasada).
      window.history.replaceState(estado, '', aqui.href)
    } else if (performance.now() < hasta) requestAnimationFrame(resaltar)
  }
  requestAnimationFrame(resaltar)
}

/**
 * Junto a los estados del encabezado: la OT que entró sin ir a su tarjeta, y el
 * camino a ella. Dice lo que pasó y no cómo quedó: Gerencia puede anular esa OT
 * después, y «ya tiene su código y su OT» seguía (funcionalidad H3 de la
 * trigesimoséptima pasada); la tarjeta dice cómo está. «Ver su tarjeta» se
 * apaga mientras algo va en camino: la navegación esperaba a que volviera, la
 * línea se iba sin llevar a ningún lado y con dos idas juntas quedaba «#A#B»
 * (Z2 de la crítica).
 */
export function EstadoDeLaOt() {
  const router = useRouter()
  const [cargada, setCargada] = useEstadoCompartido<OtCargada | null>(OT_CARGADA, null)
  const enCamino = useEnviosEnCamino() > 0
  const id = useId()
  return (
    <div className={cargada ? 'flex flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end' : 'sr-only'}>
      <span role="status" className="text-xs font-medium text-exito">
        {cargada && `Se cargó el código y la OT de la cotización ${cargada.numero}.`}
      </span>
      {cargada && (
        <>
          <Boton
            type="button"
            tamano="sm"
            variante="secundario"
            disabled={enCamino}
            aria-describedby={enCamino ? id : undefined}
            onClick={() => {
              if (enviosEnCamino() > 0) return
              setCargada(null)
              irALaTarjeta(cargada.id, router)
            }}
          >
            Ver su tarjeta
          </Boton>
          {enCamino && (
            <span id={id} className="text-xs text-texto-suave">
              Se puede ver cuando vuelva lo que se está enviando.
            </span>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Administración, con la cotización ya aprobada por Gerencia, le da el código
 * interno que tendrá la unidad —nuevo, o uno que ya existe del mismo cliente— y
 * sube la OT: su PDF, su número, si es semirremolque o carrocería montada y la
 * fecha de entrega al cliente. El tipo viene propuesto por la carrocería de la
 * cotización cuando el catálogo lo sabe. La base hace todo junto o nada
 * (migración 20261027200000): desde ahí Diseño ve la OT dentro del código y
 * Contabilidad ya la puede facturar.
 */
export function CargarCodigoYOt({
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
  // Cerrada mientras va: el botón que la abre gira y el desenlace se dice a su lado.
  const fuera = useEnvioDeLaVentana(`codigo-y-ot:${cotizacionId}`)
  const [, setCargada] = useEstadoCompartido<OtCargada | null>(OT_CARGADA, null)
  // Cerrada mientras va, o mientras la página se pone al día tras el ok: no se abre otra.
  const ocupado = fuera.sigue || (enviando && !abierto)
  // Al volver de un rechazo, el cursor va al número repetido o al código que no
  // sirve, que se dicen junto a su campo, o al aviso: la ventana estuvo trabada.
  // Lo del código salía en el aviso de abajo, lejos del campo (vigesimoquinta pasada).
  const avisoError = useRef<HTMLParagraphElement>(null)
  const campoNumero = useRef<HTMLInputElement>(null)
  const campoCodigo = useRef<HTMLInputElement>(null)
  const errorNumero = error && /^(Ya hay una OT|El número de la OT)/.test(error) ? error : null
  const errorCodigo = error && /^(Escribe el código interno|El código interno|PLANTA no es una unidad)/.test(error) ? error : null
  useCursorAlRechazo(enviando, error, () => (errorNumero ? campoNumero.current : errorCodigo ? campoCodigo.current : avisoError.current))
  // Lo que la persona escribió a mano: la lectura del PDF, aunque termine
  // después o sea de otro PDF, no lo pisa.
  const aMano = useRef(new Set<'numero' | 'fecha' | 'tipo'>())
  // Si el número escrito no es el del PDF, se dice.
  const otroNumero =
    !leyendo && datosLeidos?.numero && numeroOrden.trim() && !mismaOt(numeroOrden, datosLeidos.numero) ? datosLeidos.numero : null
  // Y la fecha de entrega escrita, si no es la del PDF.
  const otraFecha =
    !leyendo && datosLeidos?.fechaEntrega && fechaEntrega && fechaEntrega !== datosLeidos.fechaEntrega ? datosLeidos.fechaEntrega : null

  // La X, Escape, el fondo y «Cancelar»: todos cierran igual (`useEnvioDeLaVentana`).
  function cerrar() {
    fuera.cerrar()
    setAbierto(false)
  }

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
      // va el del PDF, que trae el año. Si el año lo trae solo lo escrito, se
      // queda lo escrito: la base completaría el del PDF con el año de hoy.
      const leido = datos.numero
      const numeroAMano = aMano.current.has('numero')
      if (leido) {
        setNumeroOrden((escrito) => {
          if (!numeroAMano || !escrito.trim()) return leido
          if (!mismaOt(escrito, leido)) return escrito
          return conAnio(escrito) && !conAnio(leido) ? escrito : leido
        })
      }
      if (datos.fechaEntrega && !aMano.current.has('fecha')) setFechaEntrega(datos.fechaEntrega)
      if (datos.tipoUnidad && !aMano.current.has('tipo')) setTipo(datos.tipoUnidad)
      setAvisoLectura(datos.numero || datos.fechaEntrega ? 'Datos leídos del PDF. Confírmalos antes de guardar.' : 'No se reconocieron los datos. Complétalos mirando el PDF.')
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
      campoCodigo.current?.focus()
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

    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setError(null)
    // Como en `useAccion`: «Volver a cargar», el del aviso de arriba tras un
    // despliegue, espera a que la OT vuelva; si no entró no recarga, y si entró
    // deja que vaya a su tarjeta (D17 de la trigesimotercera pasada).
    iniciar(() => mientrasSeEnvia(async (entro, decirArriba) => {
      // Cómo terminó, por si la ventana se cierra mientras va (`useEnvioDeLaVentana`).
      const terminar = fuera.empezar(decirArriba)
      let comoTermino: string | null = null
      const noEntro = (porque: string) => {
        comoTermino = porque
        setError(porque)
      }
      const supabase = createClient()
      // El identificador de la orden se decide acá para que el PDF viaje a su
      // carpeta antes de que la orden exista: así la base las crea juntas.
      const ordenId = crypto.randomUUID()
      const ruta = `ot/${ordenId}/${crypto.randomUUID()}.pdf`
      let subido = false
      try {
        // La pestaña ya se sabe de antes del último despliegue: lo que lo
        // registraría no va a entrar, así que ni se sube (trigésima pasada).
        if (laPestanaEsDeLaVersionAnterior()) {
          noEntro(SE_ACTUALIZO_EL_SISTEMA)
          return
        }
        const { error: falla } = await subirARutaNueva(supabase.storage.from('adjuntos-ot'), ruta, archivo, 'application/pdf', quitarConLaCuenta)
        // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
        if (falla) seguirConLaCuentaDeLaPestana()
        if (falla) {
          noEntro(`No se pudo subir el PDF de la orden. ${motivoDeSubida(falla)}`)
          return
        }
        subido = true

        datos.set('cotizacion_id', cotizacionId)
        datos.set('orden_id', ordenId)
        datos.set('ruta_pdf', ruta)
        datos.set('nombre_pdf', archivo.name.slice(0, 200))
        datos.set('tamano_pdf', String(archivo.size))

        // Si no se guardó, el PDF que ya viajó se quita, para que no quede un
        // archivo que ninguna OT nombra. Sin respuesta se pregunta otra vez con
        // la misma orden: si la primera entró, la base no crea otra, y el PDF
        // que una OT nombra la política no lo deja quitar.
        const r = await anotarSinDejarloSuelto({
          bucket: 'adjuntos-ot',
          ruta,
          anotar: () => cargarCodigoYOt(null, datos),
          sinRespuesta: 'No llegó la respuesta. Recarga la página y mira si la cotización ya tiene su código antes de volver a intentar.',
        })
        subido = false
        if (!r.ok) {
          noEntro(r.error)
          return
        }
        setAbierto(false)
        entro()
        // A su tarjeta, ya con el código y la OT: en «Aprobadas sin código» se
        // iba de la lista y no se veía que había quedado. Si no puede ir sin
        // llevarse otra cosa, lo dice el encabezado.
        if (vaSolaALaTarjeta(fuera.cerradaMientrasIba())) irALaTarjeta(cotizacionId, router, { trasEnviar: true })
        else setCargada({ id: cotizacionId, numero })
      } catch (e) {
        // Entró otra cuenta a media cadena: no sigue, y el archivo que haya
        // subido se quita cuando vuelva la tuya (`anotarSinDejarloSuelto`). La
        // ventana dice que no se guardó: al volver, el cursor va ahí.
        if (e instanceof OtraCuentaEnLaPestana) {
          noEntro(NO_SE_GUARDO_OTRA_CUENTA)
          return
        }
        // Lo que se cae acá es la subida: todavía no se guardó.
        if (subido) await quitarConLaCuenta(() => supabase.storage.from('adjuntos-ot').remove([ruta]))
        noEntro('No se pudo subir el PDF de la orden. Revisa la conexión y vuelve a intentar.')
      } finally {
        enCurso.current = false
        terminar(comoTermino)
      }
    }))
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton type="button" tamano="sm" onClick={abrir} ocupado={ocupado} aria-describedby={fuera.sigue ? fuera.idDelEstado : undefined}>
          {!ocupado && <Hash aria-hidden className="size-3.5" />}
          Dar código y cargar la OT
        </Boton>
        <EstadoDelEnvio id={fuera.idDelEstado} sigue={fuera.sigue} desenlace={fuera.desenlace} registro="La OT" femenino />
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={cerrar}
        titulo={`Código interno y OT de la ${numero}`}
        descripcion="Gerencia ya la aprobó. El cliente y la carrocería salen de la cotización; el código y la OT se guardan juntos."
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
            error={errorCodigo ?? undefined}
            requerido
          >
            <Entrada
              ref={campoCodigo}
              id="eo-codigo-interno"
              name="codigo_interno"
              autoComplete="off"
              autoCapitalize="characters"
              required
              minLength={2}
              maxLength={40}
              value={codigo}
              onChange={(e) => {
                if (errorCodigo) setError(null)
                setCodigo(e.target.value)
              }}
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
              aviso={rechazado?.motivo ?? (faltaPdf ? 'Falta el PDF de la OT: sin él no se guarda' : null)}
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

          {/* «Fecha de entrega prometida» no se entendía (observación de Gerencia, 27/10). */}
          <Campo
            etiqueta="Fecha de entrega al cliente"
            htmlFor="eo-fecha"
            ayuda="El día prometido al cliente para entregarle la unidad, según la OT"
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
          {otraFecha && (
            <p role="status" className="-mt-2 text-xs text-aviso">
              El PDF dice la entrega el {fecha(otraFecha)}: revisa la fecha.
            </p>
          )}

          </fieldset>

          <Falla ref={avisoError} texto={errorNumero || errorCodigo ? null : error} />

          {/* Fuera de lo trabado: «Cancelar» cierra también mientras se envía, como la X (D2 de la trigesimosexta pasada). */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              Guardar código y OT
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

/** «390-2025» trae el año; «390» no. */
const conAnio = (t: string) => /-\d{4}$/.test(t.trim())

/** 390, 0390 y 0390-2026 son la misma OT; el año, si se escribe en los dos, se compara. */
function mismaOt(a: string, b: string) {
  const partes = (t: string) => /^0*(\d+)(?:-(\d{4}))?$/.exec(t.trim())
  const x = partes(a)
  const y = partes(b)
  if (!x || !y) return a.trim() === b.trim()
  return x[1] === y[1] && (!x[2] || !y[2] || x[2] === y[2])
}
