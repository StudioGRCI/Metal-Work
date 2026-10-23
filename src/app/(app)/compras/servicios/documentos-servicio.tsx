'use client'

import { Ban, FileText, Paperclip } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import type { DocumentoDeServicio } from '@/lib/datos/logistica'
import { COMPROBANTES_DE_SERVICIO, etiquetaDocumentoServicio, TIPO_DOCUMENTO_SERVICIO } from '@/lib/dominio/adquisiciones'
import { BUCKET_DOCUMENTOS_SERVICIO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'

import { adjuntarDocumentoServicio, anularDocumentoServicio } from './acciones'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'
const esComprobante = (tipo: string) => (COMPROBANTES_DE_SERVICIO as readonly string[]).includes(tipo)

/**
 * Los documentos de una OS (migración 20261020210000): la factura, la boleta o
 * el recibo con que se paga y el contrato del trabajo, cada uno con su enlace.
 * Quien los adjunta los anula con su motivo; no se borran.
 */
export function ListaDocumentosServicio({ documentos, anula }: { documentos: DocumentoDeServicio[]; anula: boolean }) {
  if (documentos.length === 0) return null
  return (
    <ul className="mt-1 space-y-1" aria-label="Documentos de la orden de servicio">
      {documentos.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {d.url ? (
            <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-0 items-center gap-1 font-medium text-acento hover:underline sm:min-h-0">
              <FileText aria-hidden className="size-3.5 shrink-0" />
              <span className="tabular truncate">{etiquetaDocumentoServicio(d)}</span>
            </a>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1 text-texto">
              <FileText aria-hidden className="size-3.5 shrink-0" />
              <span className="tabular truncate">{etiquetaDocumentoServicio(d)}</span>
            </span>
          )}
          {/* Antes del «Anular» que recomienda: el archivo que ya no está no vuelve recargando. */}
          {!d.url &&
            (d.faltaArchivo ? (
              <span className="block w-full text-aviso">
                {/* Nombra su botón: a la misma altura está el «Anular» de la OS entera. */}
                {anula ? `Sin archivo: anúlalo con «Anular ${queAnula(d.tipo)}» y vuelve a adjuntarlo.` : 'Sin archivo.'}
              </span>
            ) : (
              <span className="block w-full text-texto-suave">No se pudo abrir: recarga la pantalla.</span>
            ))}
          {anula && <AnularDocumentoServicio documentoId={d.id} tipo={d.tipo} etiqueta={etiquetaDocumentoServicio(d)} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * Logística o Tesorería adjunta a la OS su factura, boleta o recibo —con su
 * número, que la base cruza para que el mismo comprobante del proveedor no entre
 * en dos OS—, el contrato del trabajo u otro documento. El archivo sube primero a
 * `documentos-servicio/{orden de servicio}/…` y, si la anotación no entra, se
 * retira. El id vive fuera de la ventana (`useIdDelEnvio`): un reintento no
 * anota otro, y con un documento más en la OS el siguiente lleva otro.
 */
export function AdjuntarDocumentoServicio({ ordenServicioId, numero, documentos }: {
  ordenServicioId: string
  numero: string
  /** Cuántos documentos tiene ya la OS. */
  documentos: number
}) {
  const documento = useIdDelEnvio(documentos)
  const [abierta, setAbierta] = useState(false)
  const [tipo, setTipo] = useState('FACTURA')

  async function adjuntar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el archivo.' }
    if (!documento.id) return { ok: false, error: 'Vuelve a abrir el formulario.' }
    documento.salio()
    datos.set('nombre', archivo.name)
    return subirArchivoFinanzas(BUCKET_DOCUMENTOS_SERVICIO, ordenServicioId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return adjuntarDocumentoServicio(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    adjuntar,
    () => {
      setAbierta(false)
      documento.otro()
    },
    { alYaEntrar: documento.otro },
  )
  const campo = (nombre: string) => `${nombre}-documento-os-${ordenServicioId}`
  const pideNumero = esComprobante(tipo)

  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setTipo('FACTURA')
          documento.abrir()
          setAbierta(true)
        }}
        data-adjuntar-documento-servicio={numero}
      >
        <Paperclip aria-hidden className="size-4" />
        Adjuntar documento
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Documento de la ${numero}`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={documento.id ?? ''} />
          <input type="hidden" name="orden_servicio_id" value={ordenServicioId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Qué documento es" htmlFor={campo('tipo')} requerido>
              <Seleccion id={campo('tipo')} name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(TIPO_DOCUMENTO_SERVICIO).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            {pideNumero && (
              <Campo etiqueta="Número" htmlFor={campo('numero')} requerido ayuda="Con su serie, como sale en el comprobante: E001-45.">
                <Entrada id={campo('numero')} name="numero" required minLength={3} maxLength={30} autoComplete="off" className="tabular uppercase" />
              </Campo>
            )}
          </div>
          <Campo etiqueta="Archivo" htmlFor={campo('archivo')} requerido>
            <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Adjuntar" />
        </form>
      </Ventana>
    </>
  )
}

/** Lo que dice el botón: «Anular otro documento» se leía como anular uno distinto. */
function queAnula(tipo: string) {
  return tipo === 'OTRO' ? 'documento' : (TIPO_DOCUMENTO_SERVICIO[tipo] ?? 'documento').toLowerCase()
}

/**
 * Anular con su motivo un documento adjunto por error: queda en el historial.
 * El botón dice qué anula: en la fila de la OS está a la altura del «Anular» de la orden.
 */
function AnularDocumentoServicio({ documentoId, tipo, etiqueta }: { documentoId: string; tipo: string; etiqueta: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularDocumentoServicio, () => setAbierta(false))
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className="inline-flex min-h-11 items-center gap-1 text-texto-suave hover:text-peligro sm:min-h-0"
        aria-label={`Anular ${etiqueta}`}
        data-anular-documento-servicio={documentoId}
      >
        <Ban aria-hidden className="size-3.5" />
        Anular {queAnula(tipo)}
      </button>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular ${etiqueta}`}
        descripcion="No se borra: queda con su archivo, el motivo, quién y cuándo, y deja de contar para el pago."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={documentoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-documento-os-${documentoId}`} requerido>
            <AreaTexto
              id={`anular-documento-os-${documentoId}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: era la factura de otra orden de servicio."
            />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}
