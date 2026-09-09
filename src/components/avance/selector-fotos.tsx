'use client'

import { Plus, X } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export type FotoLista = {
  archivo: File
  vistaPrevia: string
  ruta?: string
  subiendo: boolean
  error?: string
}

const MAXIMO_MB = 10
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

/** Lo que viaja a la acción: solo las que llegaron a Storage, con su ruta. */
export function fotosParaEnviar(fotos: FotoLista[]) {
  return fotos
    .filter((f) => f.ruta)
    .map((f) => ({
      ruta_storage: f.ruta as string,
      nombre_archivo: f.archivo.name,
      mime_type: f.archivo.type,
      tamano_bytes: f.archivo.size,
    }))
}

/** Mientras haya una en vuelo el formulario no se manda: se iría sin ella y en silencio. */
export function haySubiendo(fotos: FotoLista[]) {
  return fotos.some((f) => f.subiendo)
}

/**
 * El selector de fotos del taller, uno solo para el avance de las órdenes y
 * para las unidades sin orden.
 *
 * La foto viaja del navegador a Storage sin pasar por el servidor de la
 * aplicación; acá solo se guarda su ruta, y la acción la escribe cuando se
 * registra el reporte. El estado vive en el padre —es un componente
 * controlado— porque es el padre quien decide si puede enviar (`haySubiendo`)
 * y quien vacía la lista al abrir de nuevo, sin efectos.
 *
 * `prefijoRuta` es la carpeta: las políticas de Storage leen la ruta para
 * decidir quién ve la foto (`ot/{orden}/…` hereda la orden; `flota/{unidad}/…`
 * queda para quien ve el taller).
 */
export function SelectorFotos({
  fotos,
  alCambiar,
  prefijoRuta,
}: {
  fotos: FotoLista[]
  alCambiar: Dispatch<SetStateAction<FotoLista[]>>
  prefijoRuta: string
}) {
  async function agregar(lista: FileList | null) {
    if (!lista) return
    const supabase = createClient()

    for (const archivo of Array.from(lista)) {
      if (!TIPOS.includes(archivo.type)) {
        alCambiar((f) => [
          ...f,
          { archivo, vistaPrevia: '', subiendo: false, error: 'Solo fotos JPG, PNG o WEBP.' },
        ])
        continue
      }
      if (archivo.size > MAXIMO_MB * 1024 * 1024) {
        alCambiar((f) => [
          ...f,
          {
            archivo,
            vistaPrevia: '',
            subiendo: false,
            error: `La foto pesa más de ${MAXIMO_MB} MB.`,
          },
        ])
        continue
      }

      const vistaPrevia = URL.createObjectURL(archivo)
      alCambiar((f) => [...f, { archivo, vistaPrevia, subiendo: true }])

      const extension = (archivo.name.split('.').pop() ?? 'jpg').toLowerCase()
      const ruta = `${prefijoRuta}/${crypto.randomUUID()}.${extension}`

      const { error } = await supabase.storage
        .from('fotos-avance')
        .upload(ruta, archivo, { contentType: archivo.type, upsert: false })

      alCambiar((f) =>
        f.map((item) =>
          item.archivo === archivo
            ? {
                ...item,
                subiendo: false,
                ruta: error ? undefined : ruta,
                error: error ? 'No se pudo subir la foto.' : undefined,
              }
            : item,
        ),
      )
    }
  }

  async function quitar(foto: FotoLista) {
    if (foto.ruta) {
      const supabase = createClient()
      await supabase.storage.from('fotos-avance').remove([foto.ruta])
    }
    if (foto.vistaPrevia) URL.revokeObjectURL(foto.vistaPrevia)
    alCambiar((f) => f.filter((item) => item !== foto))
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-texto">Fotos</p>
      <div className="flex flex-wrap gap-2">
        {fotos.map((foto, i) => (
          <div
            key={`${foto.archivo.name}-${i}`}
            className={cn(
              'relative size-24 overflow-hidden rounded-[var(--radius-base)] border',
              foto.error ? 'border-peligro' : 'border-borde',
            )}
          >
            {foto.vistaPrevia ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto.vistaPrevia} alt={foto.archivo.name} className="size-full object-cover" />
            ) : (
              <p className="p-1.5 text-[10px] text-peligro">{foto.error}</p>
            )}

            {foto.subiendo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-medium text-white">
                subiendo…
              </div>
            )}

            {/* Sin confirmación a propósito: la foto todavía no es parte de
                ningún reporte y se vuelve a poner con el mismo botón de al lado. */}
            <button
              type="button"
              onClick={() => quitar(foto)}
              aria-label={`Quitar ${foto.archivo.name}`}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 sm:p-0.5"
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        ))}

        <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde text-texto-suave hover:bg-superficie-2 hover:text-texto">
          <Plus aria-hidden className="size-5" />
          <span className="text-[11px]">Agregar</span>
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-[11px] text-texto-tenue">
        Desde el celular abre la cámara. Hasta {MAXIMO_MB} MB por foto.
      </p>
    </div>
  )
}
