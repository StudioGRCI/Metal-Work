'use client'

import { FileUp } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import {
  AvisoFacturaDeLaOrden,
  CamposDeLaFactura,
  faltaEnLaFactura,
  useDatosDeFactura,
  useDetectorDeFactura,
} from '@/app/(app)/compras/ordenes/detector-oc'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { yaEntroEnLaVentana, yaEntroLaPrimeraVez, yaEntroSinVentana } from '@/lib/acciones'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'
import { registrarDocumentoCompra } from './acciones-documentos'
import { subirArchivoPrivado } from '@/lib/subida-privada'

const TIPOS = [
  // La cotización o proforma del proveedor; antes se subía como «Orden de compra» u «Otro».
  ['COTIZACION', 'Cotización del proveedor'],
  ['ORDEN_COMPRA', 'Orden de compra'],
  ['ORDEN_PAGO', 'Orden de pago'],
  ['ORDEN_SERVICIO', 'Orden de servicio'],
  ['FACTURA', 'Factura'],
  // Sin factura igual se pide un comprobante: boleta, nota de venta o recibo.
  ['COMPROBANTE', 'Boleta, nota de venta o recibo'],
  ['OTRO', 'Otro documento'],
] as const

const ACEPTA_PDF = 'application/pdf,.pdf'

export function SubirDocumentoCompra({ ordenCompraId, solicitudId, tipoInicial, orden, alSalir, alAdjuntar, alCerrar, verAdquisiciones = false }: {
  ordenCompraId: string
  /**
   * El id del documento, que también es su ruta: el reintento de un envío sin
   * respuesta usa el mismo. Después de adjuntar, el siguiente lleva otro; si
   * la ventana se cierra y se vuelve a abrir, `alAdjuntar` le avisa a quien lo
   * guarda para que no vuelva con el del documento que ya entró. Si quien lo
   * guarda con `useIdDelEnvio` (el que pasa `alSalir`) lo cambia —la base dijo
   * que aquel entró—, el formulario toma el nuevo sin borrar lo elegido. Sin
   * `alSalir` vale solo el primero: en el tablero de la OT nace en el servidor
   * con cada repintado, y seguirlo borraba el PDF elegido y mandaba el
   * reintento a otra ruta (decimoséptima pasada).
   */
  solicitudId: string
  /** Al enviar: quien guarda el id lo conserva hasta saber cómo terminó (`useIdDelEnvio`). */
  alSalir?: () => void
  alAdjuntar?: () => void
  /**
   * Dentro de una ventana: tras «ya quedó» el formulario se traba y solo queda
   * «Cerrar». Sin él quedaban la X y un «Adjuntar» apagado (decimoquinta pasada).
   */
  alCerrar?: () => void
  /** El que pide la compra: FACTURA, o COMPROBANTE si es sin factura. */
  tipoInicial?: 'FACTURA' | 'COMPROBANTE'
  /**
   * El número, el total con IGV y la moneda de la orden: el detector compara la
   * factura con ellos. En la OC sin número, el número es su referencia, que es
   * lo que cita la factura; el nombre es con el que se la nombra.
   */
  orden?: { numero: string; nombre?: string; total: number; moneda: string }
  /** Si quien anexa entra a Adquisiciones (`adquisiciones.ver`): sin él, el enlace a la OC lo dejaría en la puerta. */
  verAdquisiciones?: boolean
}) {
  const [id, setId] = useState(solicitudId)
  const [dado, setDado] = useState(solicitudId)
  if (alSalir && solicitudId !== dado) {
    setDado(solicitudId)
    setId(solicitudId)
  }
  // El formulario se rehace al empezar otro documento, no cada vez que cambia el
  // id: la nota de que aquel entró llega con la ventana ya abierta, y rehacerlo
  // borraba lo elegido y dejaba el cursor en la página (decimoséptima pasada).
  const [vez, setVez] = useState(0)
  const [tipo, setTipo] = useState<string>(tipoInicial ?? '')
  // La OC que llega en partes: esta boleta es solo de una parte y el resto llega con factura.
  const [parte, setParte] = useState(false)
  const detector = useDetectorDeFactura(ACEPTA_PDF, 20)
  const factura = useDatosDeFactura()
  const [mensaje, setMensaje] = useState<string | null>(null)
  // La factura no alcanza para la OC, o la OC quedó pagada dos veces: el mensaje
  // pide algo, no dice que todo salió bien.
  const [revisar, setRevisar] = useState(false)
  const [avisaTesoreria, setAvisaTesoreria] = useState(false)
  // El id con el que la base dijo «ya quedó»: mientras siga siendo el de la
  // ventana, el formulario queda trabado y solo se cierra. Al cerrarla se
  // empieza otro (`alYaEntrar`); en la lista, sin ventana, en el acto.
  const [entroCon, setEntroCon] = useState<string | null>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  // En el tablero, sin ventana, el formulario se rehace al adjuntar y el botón
  // que tenía el cursor desaparece: el cursor caía a la página. Va al tipo del
  // siguiente (decimoctava pasada), cuando deja de estar trabado por el envío.
  const tipoRef = useRef<HTMLSelectElement>(null)
  const enfocarTipo = useRef(false)
  function empezarOtro() {
    setId(crypto.randomUUID())
    setVez((v) => v + 1)
    setParte(false)
    alAdjuntar?.()
    factura.vaciar()
    void detector.leer(undefined)
  }
  const { alEnviar, enviando, error } = useEnvio(async (_previo, datos) => {
    const archivo = datos.get('archivo')
    if (!(archivo instanceof File) || archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
      return { ok: false, error: 'Selecciona un PDF válido de hasta 20 MB.' }
    }
    // El número y la fecha se revisan antes de subir el PDF, no después.
    const falta = tipo === 'FACTURA' ? faltaEnLaFactura(factura.numero, factura.fecha) : null
    if (falta) return { ok: false, error: falta }
    if (tipo === 'COMPROBANTE' && parte) {
      if (!String(datos.get('parte_numero') ?? '').trim()) return { ok: false, error: 'Escribe el número de la boleta, como B001-45.' }
      const monto = String(datos.get('parte_monto') ?? '').trim()
      if (!/^\d{1,9}([.,]\d{1,2})?$/.test(monto) || Number(monto.replace(',', '.')) <= 0) {
        return { ok: false, error: 'Escribe el monto de la boleta, mayor que cero y con hasta dos decimales.' }
      }
    }
    datos.delete('archivo')
    datos.set('nombre_archivo', archivo.name.trim().slice(0, 200))
    alSalir?.()
    const r = await subirArchivoPrivado({
      bucket: 'documentos-compras', ruta: `compra/${ordenCompraId}/${id}.pdf`,
      archivo, contentType: 'application/pdf', registrar: () => registrarDocumentoCompra(null, datos),
    })
    if (!r.ok && yaEntroLaPrimeraVez(r.error)) setEntroCon(id)
    return r
  }, (r) => {
    setMensaje(r.mensaje ?? 'Documento adjuntado.')
    setRevisar(r.datos?.revisar ?? false)
    setAvisaTesoreria(r.datos?.avisaTesoreria ?? false)
    if (!alCerrar) enfocarTipo.current = true
    empezarOtro()
  }, { alYaEntrar: empezarOtro, siSeVa: { que: 'el documento de la compra', enlace: 'Volver a la compra' }, documento: ordenCompraId })
  const yaEntro = yaEntroLaPrimeraVez(error)
  const trabado = yaEntro && entroCon === id
  // El botón se apaga mientras envía y el cursor caía a la página: Tab salía de
  // la ventana y Escape ya no la cerraba (decimoquinta pasada). Tras el envío
  // va al aviso, como en `PieDeVentana`.
  useCursorAlRechazo(enviando, error, () => aviso.current)
  useEffect(() => {
    if (!enfocarTipo.current || enviando) return
    enfocarTipo.current = false
    tipoRef.current?.focus()
  }, [vez, enviando])
  const quieto = enviando || trabado
  return <div className="min-w-0 rounded-xl border border-borde bg-superficie p-4">
  {/* El aviso del documento anterior se vacía aquí y no dentro del envío: dentro
      de la transición no se pintaba, y el segundo «Documento adjuntado» seguido
      no se anunciaba (vigésima pasada). */}
  <form key={vez} onSubmit={(e) => {
    setMensaje(null)
    setRevisar(false)
    setAvisaTesoreria(false)
    alEnviar(e)
  }} className="grid min-w-0 gap-4 sm:grid-cols-2 sm:items-end">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
    <Campo etiqueta="Tipo de documento" htmlFor={`tipo-doc-compra-${ordenCompraId}`}>
      <Seleccion ref={tipoRef} id={`tipo-doc-compra-${ordenCompraId}`} name="tipo" required disabled={quieto} value={tipo} onChange={(e) => {
        setTipo(e.target.value)
        // En la OC con factura, la boleta que llega es la de una parte: la casilla sale marcada.
        if (e.target.value === 'COMPROBANTE' && tipoInicial === 'FACTURA') setParte(true)
      }}>
        <option value="" disabled>Elige el tipo</option>
        {TIPOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Documento PDF" htmlFor={`archivo-compra-${ordenCompraId}`} ayuda="Se conserva en la compra y queda disponible para Contabilidad y Tesorería.">
      {/* Se lee sea cual sea el tipo, por si después se elige «Factura»; el «Leyendo…» solo se dice para la factura. */}
      {/* Trabado tras «ya quedó», el detector no dice «puedes seguir igual»: ya no hay cómo seguir. */}
      <ElegirArchivo id={`archivo-compra-${ordenCompraId}`} name="archivo" accept={ACEPTA_PDF} hastaMb={20} required disabled={quieto}
        aviso={trabado ? undefined : detector.aviso} estado={tipo === 'FACTURA' ? detector.leyendo : null}
        onChange={(e) => {
          // Lo leído del archivo anterior se va con él; lo escrito a mano se queda.
          factura.soltarLeido()
          void detector.leer(e.target.files?.[0]).then(factura.completar)
        }} />
    </Campo>
    {tipo === 'FACTURA' && (
      <>
        <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
          <CamposDeLaFactura id={`factura-compra-${ordenCompraId}`} datos={factura} requerido disabled={quieto} />
        </div>
        {!trabado && (
          <div className="sm:col-span-2">
            <AvisoFacturaDeLaOrden lectura={detector.lectura} total={orden?.total ?? null}
              moneda={orden?.moneda ?? 'PEN'} numero={orden?.numero} nombre={orden?.nombre} anotada={factura.numero} parcialPosible />
          </div>
        )}
      </>
    )}
    {tipo === 'COMPROBANTE' && (
      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="parte" value="si" className="size-4" checked={parte} disabled={quieto}
            onChange={(e) => setParte(e.target.checked)} />
          <span>Es la boleta de solo una parte de la OC</span>
        </label>
        {parte && (
          <>
            <Campo etiqueta="Número de la boleta" htmlFor={`parte-numero-${ordenCompraId}`} requerido ayuda="Serie y número, como B001-45.">
              <Entrada id={`parte-numero-${ordenCompraId}`} name="parte_numero" required disabled={quieto} minLength={3} maxLength={40}
                autoComplete="off" placeholder="B001-45" className="tabular" />
            </Campo>
            <Campo etiqueta="Fecha de la boleta" htmlFor={`parte-fecha-${ordenCompraId}`} requerido>
              <Entrada id={`parte-fecha-${ordenCompraId}`} name="parte_fecha" type="date" required disabled={quieto} max={hoyLima()} />
            </Campo>
            <Campo etiqueta={`Monto de la boleta (${orden?.moneda === 'USD' ? 'US$' : 'S/'})`} htmlFor={`parte-monto-${ordenCompraId}`} requerido
              ayuda="Lo que dice la boleta. Tesorería le paga esto y lo demás de la OC se paga por su factura.">
              <Entrada id={`parte-monto-${ordenCompraId}`} name="parte_monto" inputMode="decimal" required disabled={quieto}
                autoComplete="off" placeholder="0.00" className="tabular" />
            </Campo>
            <Campo etiqueta="¿Trae IGV?" htmlFor={`parte-igv-${ordenCompraId}`} requerido ayudaEnIcono={false}
              ayuda="La boleta lo trae aunque no lo separe; la nota de venta, el recibo y el Nuevo RUS, no.">
              <Seleccion id={`parte-igv-${ordenCompraId}`} name="parte_igv" required disabled={quieto} defaultValue="">
                <option value="" disabled>Elige…</option>
                <option value="si">Sí, trae IGV</option>
                <option value="no">No trae IGV</option>
              </Seleccion>
            </Campo>
          </>
        )}
      </div>
    )}
    {/* Lo que ya entró no es un rechazo: va sin rojo, como en `PieDeVentana`. */}
    {error && (
      <p ref={aviso} role="alert" tabIndex={-1} data-ya-entro={yaEntro || undefined}
        className={yaEntro ? 'rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-xs text-texto sm:col-span-2' : 'text-xs text-peligro sm:col-span-2'}>
        {trabado ? yaEntroEnLaVentana(error) : yaEntro ? yaEntroSinVentana(error, 'el de la primera vez ya está adjunto a la compra') : error}
      </p>
    )}
    {/* Al final, debajo de lo que depende del tipo: en el teléfono se ve la casilla de la parte antes de adjuntar. */}
    <div className="flex justify-end sm:col-span-2">
      {trabado && alCerrar ? (
        <Boton type="button" variante="contorno" tamano="sm" onClick={alCerrar}>
          Cerrar
        </Boton>
      ) : (
        <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando} disabled={trabado}>
          <FileUp aria-hidden className="size-4" />Adjuntar
        </Boton>
      )}
    </div>
  </form>
  {/* Fuera del formulario, que se rehace al adjuntar, y siempre puesto: el aviso
      que nacía ya con su texto, dentro, no lo leía el lector de pantalla
      (decimonovena pasada). */}
  <div role="status">
    {mensaje && (
      <p key={vez} className={`mt-4 text-xs ${revisar || avisaTesoreria ? 'text-aviso' : 'text-exito'}`}>
        {mensaje}
        {revisar && verAdquisiciones && (
          <>
            {' '}
            <Link href={`/adquisiciones${orden?.numero ? `?q=${encodeURIComponent(orden.numero)}` : ''}`} className="font-medium underline">
              Ver la OC en Adquisiciones
            </Link>
          </>
        )}
      </p>
    )}
  </div>
  </div>
}
