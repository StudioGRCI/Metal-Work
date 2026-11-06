import { Download, FileArchive } from 'lucide-react'
import type { ReactNode } from 'react'

import type { DxfDeCodigo } from '@/lib/datos/diseno-codigos'
import { fechaHora, tamanoArchivo } from '@/lib/format'

/**
 * Los DXF comprimidos de un código (migración 20261106100000): qué traen, el
 * archivo para descargarlo con su nombre y cuándo se subió. Diseño pone en
 * `acciones` el botón para quitarlo; Maestranza solo los descarga.
 */
export function ListaDxf({ archivos, acciones }: { archivos: DxfDeCodigo[]; acciones?: (d: DxfDeCodigo) => ReactNode }) {
  return (
    <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {archivos.map((d) => (
        <li key={d.id} className="flex items-center gap-3 p-3" data-dxf={d.nombre_archivo}>
          <FileArchive aria-hidden className="size-5 shrink-0 text-texto-suave" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-texto">{d.descripcion}</p>
            <p className="text-xs break-all text-texto-suave">
              {d.nombre_archivo} · {tamanoArchivo(d.tamano_bytes)} · {fechaHora(d.subido_en)}
            </p>
          </div>
          {d.url ? (
            <a
              href={d.url}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
              aria-label={`Descargar ${d.nombre_archivo}`}
            >
              <Download aria-hidden className="size-4" />
              Descargar
            </a>
          ) : (
            <span className="shrink-0 text-xs text-texto-tenue">No se pudo preparar la descarga: recarga la página.</span>
          )}
          {acciones?.(d)}
        </li>
      ))}
    </ul>
  )
}
