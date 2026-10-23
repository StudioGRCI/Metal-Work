'use client'

import { Camera, Images, RotateCcw, X } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

import { comprimirFoto } from '@/lib/comprimir-foto'
import { laPestanaEsDeOtraCuenta } from '@/lib/envio'
import { tamanoArchivo } from '@/lib/format'
import { subirARutaNueva } from '@/lib/ruta-nueva'
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
// Lo que puede pesar la foto tal como sale de la cámara cuando se va a achicar antes de subirla.
const MAXIMO_ORIGINAL_MB = 40
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
// Los mismos que acepta el bucket (migración 078); el mensaje sale de esta lista.
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const TIPOS_TEXTO = 'JPG, PNG, WEBP o HEIC'

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

/** Las que no llegaron: el reporte no debería salir sin decirlo. */
export function hayFallidas(fotos: FotoLista[]) {
  return fotos.some((f) => f.error)
}

// Las que se retiraron mientras subían o se achicaban.
const retiradas = new WeakSet<FotoLista>()

/**
 * Al cerrar sin registrar, las fotos ya subidas quedan sueltas en Storage: se
 * retiran (la política deja a su dueño quitar las que ningún registro nombra)
 * y se sueltan sus miniaturas. Sin esperar: si falla, la foto queda suelta y
 * nadie más la ve.
 *
 * La que todavía sube se anota (`retiradas`): cuando termina, se quita sola.
 * Antes llegaba a Storage después de cerrar y quedaba suelta (vigesimosegunda
 * pasada).
 */
export function quitarFotosSueltas(bucket: string, fotos: FotoLista[]) {
  for (const f of fotos) if (f.subiendo) retiradas.add(f)
  const rutas = fotos.flatMap((f) => (f.ruta ? [f.ruta] : []))
  if (rutas.length > 0) void createClient().storage.from(bucket).remove(rutas)
  soltarMiniaturas(fotos)
}

/** Las miniaturas viven en la memoria del navegador hasta que se sueltan. */
export function soltarMiniaturas(fotos: FotoLista[]) {
  for (const f of fotos) if (f.vistaPrevia) URL.revokeObjectURL(f.vistaPrevia)
}

// El campo de verdad está oculto: el anillo de foco del teclado lo lleva el
// mosaico, igual que la caja de ElegirArchivo.
const MOSAICO =
  'flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde text-texto-suave hover:bg-superficie-2 hover:text-texto has-[:focus-visible]:border-acento has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-anillo-foco'

/** Qué le pasó a la subida, en palabras del taller. */
function explicarFalla(mensaje: string) {
  const m = mensaje.toLowerCase()
  if (m.includes('mime') || m.includes('type')) return 'El servidor no acepta este tipo de foto.'
  if (m.includes('size') || m.includes('large') || m.includes('too big')) return `Pesa más de ${MAXIMO_MB} MB.`
  if (m.includes('row-level') || m.includes('policy') || m.includes('unauthorized')) return 'No tienes permiso para subir fotos acá.'
  return 'No se pudo subir: revisa la señal y vuelve a intentar.'
}

/**
 * El selector de fotos del taller, uno solo para el avance de las órdenes y
 * para las unidades sin orden.
 *
 * Dos entradas: «Tomar foto» abre la cámara y «De la galería» abre las que ya
 * se tomaron durante el día, que es como trabaja el supervisor —fotografía a
 * la mañana y reporta a la tarde—. Con `capture` puesto en una sola entrada el
 * teléfono no ofrecía la galería y las fotos del día no se podían adjuntar.
 * Con ratón no hay cámara (las dos abrían el mismo explorador): queda una sola,
 * «Elegir fotos», decidido por el puntero como en `ElegirArchivo`.
 *
 * No es `ElegirArchivo` porque es otra cosa: varias fotos a la vez, cada una
 * con su miniatura, su subida y su «Reintentar», y en HEIC si viene del iPhone.
 * Lo que dice sí es lo mismo: formatos y tope antes de elegir, y el motivo con
 * las mismas palabras cuando una no sirve.
 *
 * La foto viaja del navegador a Storage sin pasar por el servidor de la
 * aplicación; acá solo se guarda su ruta, y la acción la escribe cuando se
 * registra el reporte. El estado vive en el padre —es un componente
 * controlado— porque es el padre quien decide si puede enviar (`haySubiendo`)
 * y quien vacía la lista al abrir de nuevo, sin efectos.
 *
 * `prefijoRuta` es la carpeta: las políticas de Storage leen la ruta para
 * decidir quién ve la foto (`ot/{orden}/…` hereda la orden; `flota/{unidad}/…`
 * queda para quien ve el taller; en el reporte diario, `{cuenta}/{reporte}/…`).
 *
 * Con `comprimir`, la foto se achica en el teléfono antes de subirla (ver
 * `comprimirFoto`) y sube siempre como JPEG; `maximoMb` es entonces lo que puede
 * pesar ya achicada.
 */
export function SelectorFotos({
  fotos,
  alCambiar,
  prefijoRuta,
  maximo,
  bucket = 'fotos-avance',
  comprimir = false,
  maximoMb = MAXIMO_MB,
  titulo = 'Fotos',
}: {
  fotos: FotoLista[]
  alCambiar: Dispatch<SetStateAction<FotoLista[]>>
  prefijoRuta: string
  maximo?: number
  bucket?: string
  comprimir?: boolean
  maximoMb?: number
  /** `null` cuando el formulario ya le pone su propio título a la sección. */
  titulo?: string | null
}) {
  async function subir(foto: FotoLista) {
    const supabase = createClient()
    const extension = comprimir
      ? (EXTENSION[foto.archivo.type] ?? 'jpg')
      : (foto.archivo.name.split('.').pop() ?? 'jpg').toLowerCase()
    const ruta = `${prefijoRuta}/${crypto.randomUUID()}.${extension}`

    const { error } = await subirARutaNueva(supabase.storage.from(bucket), ruta, foto.archivo, foto.archivo.type)
    // Se cerró sin registrar mientras subía: nada la va a nombrar.
    if (retiradas.has(foto)) {
      if (!error) void supabase.storage.from(bucket).remove([ruta])
      return
    }

    alCambiar((f) =>
      f.map((item) =>
        item === foto
          ? {
              ...item,
              subiendo: false,
              ruta: error ? undefined : ruta,
              error: error ? explicarFalla(error.message) : undefined,
            }
          : item,
      ),
    )
  }

  async function agregar(lista: FileList | null) {
    // Cada foto sube al elegirla, con la sesión que haya: si es de otra cuenta,
    // no se sube y la pantalla se traba (vigesimosegunda pasada).
    if (!lista || laPestanaEsDeOtraCuenta()) return

    const disponibles = Math.max(0, (maximo ?? Number.POSITIVE_INFINITY) - fotos.length)
    for (const archivo of Array.from(lista).slice(0, disponibles)) {
      // Con las mismas palabras que el campo de los documentos (ElegirArchivo).
      const tope = comprimir ? MAXIMO_ORIGINAL_MB : maximoMb
      const noSirve = !TIPOS.includes(archivo.type)
        ? `No es una foto ${TIPOS_TEXTO}: elige otra.`
        : archivo.size === 0
          ? 'Está vacía: elige otra.'
          : archivo.size > tope * 1024 * 1024
            ? `Pesa ${tamanoArchivo(archivo.size)} y el tope es ${tope} MB: elige otra.`
            : null
      if (noSirve) {
        alCambiar((f) => [...f, { archivo, vistaPrevia: '', subiendo: false, error: noSirve }])
        continue
      }

      const foto: FotoLista = { archivo, vistaPrevia: URL.createObjectURL(archivo), subiendo: true }
      alCambiar((f) => [...f, foto])
      if (!comprimir) {
        await subir(foto)
        // Se cerró mientras subía: las que siguen ya no tienen ventana.
        if (retiradas.has(foto)) break
        continue
      }

      // Mientras se achica, la miniatura ya está con «subiendo…» encima.
      let achicada: File | null = null
      try {
        achicada = await comprimirFoto(archivo)
      } catch {
        achicada = null
      }
      if (retiradas.has(foto)) break
      const falla = !achicada
        ? 'No se pudo abrir esta foto: tómala de nuevo o elige otra.'
        : achicada.size > maximoMb * 1024 * 1024
          ? `Aun achicada pesa más de ${maximoMb} MB.`
          : null
      if (!achicada || falla) {
        // Sin miniatura no se ofrece «Reintentar»: volvería a fallar igual.
        URL.revokeObjectURL(foto.vistaPrevia)
        alCambiar((f) => f.map((item) => (item === foto ? { ...item, vistaPrevia: '', subiendo: false, error: falla ?? undefined } : item)))
        continue
      }
      const lista: FotoLista = { ...foto, archivo: achicada }
      alCambiar((f) => f.map((item) => (item === foto ? lista : item)))
      await subir(lista)
      if (retiradas.has(lista)) break
    }
  }

  /** Volver a intentar con el mismo archivo: solo tiene sentido si falló la subida, no el tipo o el peso. */
  function reintentar(foto: FotoLista) {
    if (laPestanaEsDeOtraCuenta()) return
    const otraVez: FotoLista = { ...foto, subiendo: true, error: undefined }
    alCambiar((f) => f.map((item) => (item === foto ? otraVez : item)))
    void subir(otraVez)
  }

  async function quitar(foto: FotoLista) {
    if (foto.ruta) {
      const supabase = createClient()
      await supabase.storage.from(bucket).remove([foto.ruta])
    }
    if (foto.vistaPrevia) URL.revokeObjectURL(foto.vistaPrevia)
    alCambiar((f) => f.filter((item) => item !== foto))
  }

  const fallidas = fotos.filter((f) => f.error)

  return (
    <div>
      {titulo && <p className="mb-1.5 text-sm font-medium text-texto">{titulo}</p>}
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
              <p className="p-1.5 text-[11px] text-peligro">No entró</p>
            )}

            {foto.subiendo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
                subiendo…
              </div>
            )}

            {foto.error && !foto.subiendo && foto.vistaPrevia && (
              <button
                type="button"
                onClick={() => reintentar(foto)}
                aria-label={`Volver a subir ${foto.archivo.name}`}
                className="absolute inset-x-0 bottom-0 flex min-h-11 items-center justify-center gap-1 bg-black/60 text-xs font-medium text-white hover:bg-black/80 sm:min-h-0 sm:py-1"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                Reintentar
              </button>
            )}

            {/* Sin confirmación a propósito: la foto todavía no es parte de
                ningún reporte y se vuelve a poner con el mismo botón de al lado.
                Blanco de 44 px en el teléfono: con guante se fallaba o se quitaba
                la de al lado. */}
            <button
              type="button"
              onClick={() => quitar(foto)}
              aria-label={`Quitar ${foto.archivo.name}`}
              className="absolute top-0 right-0 flex size-11 items-center justify-center text-white drop-shadow hover:text-peligro-suave sm:size-6"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-black/60 sm:size-5">
                <X aria-hidden className="size-3.5" />
              </span>
            </button>
          </div>
        ))}

        {(maximo === undefined || fotos.length < maximo) && <label className={cn(MOSAICO, 'pointer-fine:hidden')}>
          <Camera aria-hidden className="size-5" />
          <span className="text-[11px]">Tomar foto</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>}

        {(maximo === undefined || fotos.length < maximo) && <label className={MOSAICO}>
          <Images aria-hidden className="size-5" />
          <span className="text-[11px] pointer-fine:hidden">De la galería</span>
          <span className="hidden text-[11px] pointer-fine:inline">{maximo === 1 ? 'Elegir foto' : 'Elegir fotos'}</span>
          <input
            type="file"
            accept="image/*"
            multiple={maximo !== 1}
            className="sr-only"
            onChange={(e) => {
              void agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>}
      </div>

      {fallidas.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Fotos que no entraron">
          {fallidas.map((f, i) => (
            <li key={`${f.archivo.name}-falla-${i}`} role="alert" className="text-xs text-peligro">
              <span className="font-medium">{f.archivo.name}:</span> {f.error}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-[11px] text-texto-tenue">
        {comprimir
          ? `${maximo ? `Hasta ${maximo} ${maximo === 1 ? 'foto' : 'fotos'}` : 'Varias a la vez desde la galería'}, en ${TIPOS_TEXTO}, de hasta ${MAXIMO_ORIGINAL_MB} MB cada una. Se achican en el teléfono antes de subir.`
          : `${maximo === 1 ? 'Una foto' : 'Varias a la vez desde la galería'}. Hasta ${maximoMb} MB por foto, en ${TIPOS_TEXTO}.`}
      </p>
    </div>
  )
}
