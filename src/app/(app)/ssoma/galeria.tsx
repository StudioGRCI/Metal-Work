import type { FotoSsoma } from '@/lib/datos/ssoma'

/** Las fotos de un reporte, de un cierre o de una charla: cada una abre su enlace firmado en otra pestaña. */
export function Galeria({ fotos, texto }: { fotos: FotoSsoma[]; texto: (f: FotoSsoma) => string }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {fotos.map((f) => (
        <li key={f.id}>
          {f.enlace ? (
            <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
              {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
              <img src={f.enlace} alt={texto(f)} className="aspect-square w-full object-cover" loading="lazy" />
            </a>
          ) : (
            <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
              La foto {f.orden} no se pudo abrir ahora
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
