'use client'

import { FileUp, XCircle } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { BUCKET_GUIAS_REMISION, MAXIMO_MB_GUIA, NUMERO_GUIA, normalizarNumeroGuia, rutaGuiaRemision } from '@/lib/dominio/logistica'
import { useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import { anularGuiaRemision, registrarGuiaRemision } from './acciones-guia'

/**
 * Contabilidad carga la guía de la OC: número, fecha de emisión y el PDF, en una
 * ventana para no alargar la fila. El PDF sube primero al almacenamiento y
 * después la acción lo comprueba y lo registra; si el registro falla, el PDF
 * suelto se retira (ver `subirArchivoPrivado`).
 */
export function CargarGuia({
  ordenCompraId,
  solicitudId,
  numero,
  peso,
  hoy,
}: {
  ordenCompraId: string
  /** El id de la guía lo decide el servidor: el PDF viaja a su ruta antes de que la fila exista. */
  solicitudId: string
  numero: string
  peso: number
  hoy: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(solicitudId)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      const guia = normalizarNumeroGuia(String(datos.get('numero') ?? ''))
      if (!NUMERO_GUIA.test(guia)) {
        return { ok: false, error: 'Escribe el número de la guía como figura en ella: serie y número, por ejemplo T001-00000123.' }
      }
      const archivo = datos.get('archivo')
      if (
        !(archivo instanceof File) ||
        archivo.size < 1 ||
        archivo.size > MAXIMO_MB_GUIA * 1024 * 1024 ||
        (await archivo.slice(0, 5).text()) !== '%PDF-'
      ) {
        return { ok: false, error: `Elige el PDF de la guía, de hasta ${MAXIMO_MB_GUIA} MB.` }
      }
      datos.delete('archivo')
      datos.set('numero', guia)
      datos.set('nombre_archivo', archivo.name.trim().slice(0, 200) || `${guia}.pdf`)
      return subirArchivoPrivado({
        bucket: BUCKET_GUIAS_REMISION,
        ruta: rutaGuiaRemision(ordenCompraId, id),
        archivo,
        contentType: 'application/pdf',
        registrar: () => registrarGuiaRemision(null, datos),
      })
    },
    () => {
      setAbierta(false)
      setId(crypto.randomUUID())
    },
  )
  return (
    <>
      <Boton type="button" tamano="sm" onClick={() => setAbierta(true)}>
        <FileUp aria-hidden className="size-4" />
        Cargar guía
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Guía de remisión de ${numero}`}
        descripcion={`Emítela con el peso que puso Logística: ${cantidad(peso)} kg. El conductor la ve en su lista en cuanto la cargas.`}
        ancho="sm"
      >
        <form key={id} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          <Campo etiqueta="N.º de guía" htmlFor={`guia-numero-${ordenCompraId}`} requerido>
            <Entrada
              id={`guia-numero-${ordenCompraId}`}
              name="numero"
              placeholder="T001-00000123"
              autoComplete="off"
              autoCapitalize="characters"
              required
              disabled={enviando}
            />
          </Campo>
          <Campo etiqueta="Emitida el" htmlFor={`guia-fecha-${ordenCompraId}`} requerido>
            <Entrada id={`guia-fecha-${ordenCompraId}`} name="fecha" type="date" max={hoy} defaultValue={hoy} required disabled={enviando} />
          </Campo>
          <Campo etiqueta="PDF de la guía" htmlFor={`guia-pdf-${ordenCompraId}`} requerido>
            <Entrada id={`guia-pdf-${ordenCompraId}`} name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Cargar guía
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Anular una guía mal emitida, con su motivo. Queda como evidencia. */
export function AnularGuia({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularGuiaRemision, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)}>
        <XCircle aria-hidden className="size-4" />
        Anular guía
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la guía ${numero}`}
        descripcion="La guía queda en el sistema como anulada, con su motivo, y al conductor le llega el aviso de que ya no vale. Después cargas la buena."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Por qué se anula" htmlFor={`motivo-guia-${id}`} requerido>
            <AreaTexto id={`motivo-guia-${id}`} name="motivo" rows={3} minLength={5} maxLength={500} required disabled={enviando} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular guía
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
