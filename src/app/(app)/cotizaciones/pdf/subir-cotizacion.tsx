'use client'

import { FileUp, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { createClient } from '@/lib/supabase/client'

import { registrarCotizacionPdf } from './acciones'

/**
 * Subir la cotización que se le mandó al cliente (migración 101). La cotización
 * se arma en Excel y se manda en PDF: acá solo se sube ese papel con lo poco
 * que el sistema necesita para seguirle el rastro —de quién es, qué se fabrica
 * y el número que ya trae el documento—.
 *
 * El PDF viaja del navegador a Storage y recién después se anota; si la
 * anotación falla, el archivo se quita y no queda nada suelto.
 */
export function SubirCotizacion({
  clientes,
  carrocerias,
}: {
  clientes: { id: string; razon_social: string }[]
  carrocerias: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  function abrir() {
    setArchivo(null)
    setError(null)
    setAviso(null)
    setAbierto(true)
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return

    const datos = new FormData(evento.currentTarget)
    if (!archivo) {
      setError('Elige el PDF de la cotización.')
      return
    }
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) {
      setError('La cotización se sube en PDF.')
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
      const id = crypto.randomUUID()
      const ruta = `cot/${id}/${crypto.randomUUID()}.pdf`
      try {
        const { error: falla } = await supabase.storage
          .from('cotizaciones-pdf')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError('No se pudo subir el PDF. Revisa la señal y vuelve a intentar.')
          return
        }

        datos.set('id', id)
        datos.set('ruta_storage', ruta)
        datos.set('nombre_archivo', archivo.name.slice(0, 200))
        datos.set('tamano_bytes', String(archivo.size))

        const r = await registrarCotizacionPdf(null, datos)
        if (!r.ok) {
          await supabase.storage.from('cotizaciones-pdf').remove([ruta])
          setError(r.error)
          return
        }
        setAviso(r.mensaje ?? 'Cotización subida.')
        setAbierto(false)
        iniciar(() => router.refresh())
      } finally {
        enCurso.current = false
      }
    })
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton onClick={abrir}>
          <Upload aria-hidden className="size-4" />
          Subir cotización
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Subir la cotización"
        descripcion="El PDF que se le mandó al cliente. Solo hace falta de quién es, qué se fabrica y el número que ya dice el documento; lo demás está en el PDF."
        ancho="md"
      >
        <form onSubmit={enviar} className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileUp aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el PDF'}</span>
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

          <Campo etiqueta="Número de la cotización" htmlFor="cot-numero" ayuda="El que dice el PDF" requerido>
            <Entrada id="cot-numero" name="numero" required maxLength={40} placeholder="3643-2026" autoComplete="off" />
          </Campo>

          <Campo etiqueta="Cliente" htmlFor="cot-cliente" requerido>
            <Seleccion id="cot-cliente" name="cliente_id" required defaultValue={clientes.length === 1 ? clientes[0].id : ''}>
              {clientes.length !== 1 && (
                <option value="" disabled>
                  Elige el cliente
                </option>
              )}
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Qué se fabrica" htmlFor="cot-carroceria" ayuda="La carrocería, del catálogo de la casa" requerido>
            <Seleccion id="cot-carroceria" name="tipo_carroceria_id" required defaultValue="">
              <option value="" disabled>
                Elige la carrocería
              </option>
              {carrocerias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} className="w-full sm:w-auto">
              Subir y mandar a Gerencia
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
