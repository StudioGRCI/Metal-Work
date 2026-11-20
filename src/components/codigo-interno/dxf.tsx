import { Download, FileArchive, FileCode } from 'lucide-react'
import type { ReactNode } from 'react'

import type { DxfDeCodigo } from '@/lib/datos/diseno-codigos'
import { fechaHora, tamanoArchivo } from '@/lib/format'

/** Los archivos de un mismo envío juntos, en el orden en que llegaron los envíos y por nombre adentro. */
function porEnvio(archivos: DxfDeCodigo[]) {
  const grupos = new Map<string, DxfDeCodigo[]>()
  for (const d of archivos) grupos.set(d.envio, [...(grupos.get(d.envio) ?? []), d])
  return [...grupos.values()].map((g) => g.sort((a, b) => a.nombre_archivo.localeCompare(b.nombre_archivo, 'es', { numeric: true })))
}

/**
 * Los DXF de un código para el corte (migración 20261106100000): qué traen, el
 * archivo para descargarlo con su nombre y cuándo se subió. Los que Diseño
 * subió juntos van bajo una sola descripción. Diseño pone en `acciones` el
 * botón para quitarlo; Maestranza y Producción solo los descargan.
 */
export function ListaDxf({ archivos, acciones }: { archivos: DxfDeCodigo[]; acciones?: (d: DxfDeCodigo) => ReactNode }) {
  return (
    <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {porEnvio(archivos).map((grupo) => (
        <li key={grupo[0].envio} className="p-3">
          <p className="text-sm font-medium text-texto">{grupo[0].descripcion}</p>
          <p className="text-xs text-texto-suave">
            {grupo.length === 1 ? '1 archivo' : `${grupo.length} archivos`} · {fechaHora(grupo[0].subido_en)}
          </p>
          <ul className="mt-2 grid gap-1">
            {grupo.map((d) => {
              const Icono = /\.dxf$/i.test(d.nombre_archivo) ? FileCode : FileArchive
              return (
                <li key={d.id} className="flex items-center gap-3" data-dxf={d.nombre_archivo}>
                  <Icono aria-hidden className="size-5 shrink-0 text-texto-suave" />
                  <p className="min-w-0 flex-1 text-sm break-all text-texto">
                    {d.nombre_archivo} <span className="text-xs text-texto-suave">· {tamanoArchivo(d.tamano_bytes)}</span>
                  </p>
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
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
