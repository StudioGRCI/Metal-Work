'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Paperclip, Upload } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { createClient } from '@/lib/supabase/client'

import { registrarDocumento } from '@/app/(app)/documentos/acciones'

export type TipoDocumento = {
  id: string
  codigo: string
  nombre: string
  bucket: string
  extensiones_permitidas: string[]
  tamano_maximo_mb: number
}

/**
 * Sube el archivo directo del navegador a Supabase Storage y después registra el
 * documento en la base: el archivo no pasa por el servidor de la aplicación.
 */
export function SubirDocumento({
  tipos,
  entidadTabla,
  entidadId,
  ordenId,
  etiqueta = 'Adjuntar documento',
}: {
  tipos: TipoDocumento[]
  entidadTabla: string
  entidadId: string
  ordenId?: string
  etiqueta?: string
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [tipoId, setTipoId] = useState(tipos[0]?.id ?? '')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)

  const tipo = tipos.find((t) => t.id === tipoId)

  function abrir() {
    setError(null)
    setArchivo(null)
    setAbierto(true)
  }

  async function enviar(datos: FormData) {
    setError(null)

    if (!archivo) {
      setError('Selecciona el archivo que quieres adjuntar.')
      return
    }
    if (!tipo) {
      setError('Selecciona el tipo de documento.')
      return
    }

    const extension = (archivo.name.split('.').pop() ?? '').toLowerCase()

    if (!tipo.extensiones_permitidas.includes(extension)) {
      setError(
        `El tipo ${tipo.nombre} solo admite archivos ${tipo.extensiones_permitidas.join(', ')}.`,
      )
      return
    }
    if (archivo.size > tipo.tamano_maximo_mb * 1024 * 1024) {
      setError(`El archivo supera el máximo de ${tipo.tamano_maximo_mb} MB.`)
      return
    }

    setSubiendo(true)
    const supabase = createClient()

    // La ruta empieza por ot/{orden_id} cuando el documento cuelga de una orden:
    // las políticas de Storage se apoyan en esa convención para decidir quién
    // puede descargarlo.
    const carpeta = ordenId ? `ot/${ordenId}` : `${entidadTabla}/${entidadId}`
    const nombre = `${crypto.randomUUID()}.${extension}`
    const ruta = `${carpeta}/${nombre}`

    const { error: errorSubida } = await supabase.storage
      .from(tipo.bucket)
      .upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: false })

    if (errorSubida) {
      setSubiendo(false)
      setError(`No se pudo subir el archivo: ${errorSubida.message}`)
      return
    }

    datos.set('bucket', tipo.bucket)
    datos.set('ruta_storage', ruta)
    datos.set('nombre_archivo', archivo.name)
    datos.set('extension', extension)
    datos.set('tamano_bytes', String(archivo.size))
    datos.set('mime_type', archivo.type)
    datos.set('entidad_tabla', entidadTabla)
    datos.set('entidad_id', entidadId)
    if (ordenId) datos.set('orden_id', ordenId)

    const resultado = await registrarDocumento(null, datos)
    setSubiendo(false)

    if (resultado.ok) {
      setAbierto(false)
      setArchivo(null)
      iniciarTransicion(() => router.refresh())
      return
    }

    // El registro falló: se retira el archivo para no dejar basura en Storage.
    await supabase.storage.from(tipo.bucket).remove([ruta])
    setError(resultado.error)
  }

  return (
    <>
      <Boton variante="secundario" tamano="sm" onClick={abrir}>
        <Paperclip aria-hidden className="size-3.5" />
        {etiqueta}
      </Boton>

      {/* La `Ventana` del sistema pinta el fondo, la caja, el título y el botón
          de cerrar, y no cierra al tocar el fondo: el archivo elegido y el
          título escrito ya no se pierden con un roce mientras se sube. */}
      <Ventana abierta={abierto} alCerrar={() => setAbierto(false)} titulo="Adjuntar documento">
        <form action={enviar} className="space-y-4">
          <Campo etiqueta="Tipo de documento" htmlFor="tipo_documento_id" requerido>
            <Seleccion
              id="tipo_documento_id"
              name="tipo_documento_id"
              required
              value={tipoId}
              onChange={(e) => setTipoId(e.target.value)}
            >
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo
            etiqueta="Archivo"
            htmlFor="archivo"
            requerido
            ayuda={
              tipo
                ? `${tipo.extensiones_permitidas.join(', ')} · máximo ${tipo.tamano_maximo_mb} MB`
                : undefined
            }
          >
            <input
              id="archivo"
              type="file"
              required
              accept={tipo?.extensiones_permitidas.map((e) => `.${e}`).join(',')}
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="w-full rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-superficie-2 file:px-3 file:py-1 file:text-xs file:text-texto"
            />
          </Campo>

          <Campo etiqueta="Título" htmlFor="titulo" requerido>
            <Entrada
              id="titulo"
              name="titulo"
              required
              minLength={3}
              defaultValue={tipo?.nombre ?? ''}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Número externo"
              htmlFor="numero_externo"
              ayuda="Factura, guía o código del documento"
            >
              <Entrada id="numero_externo" name="numero_externo" />
            </Campo>

            <Campo etiqueta="Fecha del documento" htmlFor="fecha_documento">
              <Entrada id="fecha_documento" name="fecha_documento" type="date" />
            </Campo>
          </div>

          <Campo etiqueta="Descripción" htmlFor="descripcion">
            <AreaTexto id="descripcion" name="descripcion" rows={2} />
          </Campo>

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" cargando={subiendo}>
              <Upload aria-hidden className="size-3.5" />
              Subir y adjuntar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
