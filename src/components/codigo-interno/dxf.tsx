import { Download, FileArchive, FileCode } from 'lucide-react'
import type { ReactNode } from 'react'

import { LecturaDelAviso, subidoPor } from '@/components/codigo-interno/quien-subio-y-quien-leyo'
import type { DxfDeCodigo } from '@/lib/datos/diseno-codigos'
import type { QuienSubioYQuienLeyo } from '@/lib/datos/quien-subio-y-quien-leyo'
import { fechaHora, tamanoArchivo } from '@/lib/format'

/** Los archivos de un mismo envío juntos, en el orden en que llegaron los envíos y por nombre adentro. */
function porEnvio(archivos: DxfDeCodigo[]) {
  const grupos = new Map<string, DxfDeCodigo[]>()
  for (const d of archivos) grupos.set(d.envio, [...(grupos.get(d.envio) ?? []), d])
  return [...grupos.values()].map((g) => g.sort((a, b) => a.nombre_archivo.localeCompare(b.nombre_archivo, 'es', { numeric: true })))
}

/** Cuándo llegó el envío: el primero de sus archivos, no el primero por nombre. */
function llegada(grupo: DxfDeCodigo[]) {
  return grupo.reduce((antes, d) => (d.subido_en < antes ? d.subido_en : antes), grupo[0].subido_en)
}

/**
 * Los DXF de un código para el corte (migración 20261106100000): qué traen, el
 * archivo para descargarlo con su nombre y cuándo se subió. Los que Diseño
 * subió juntos van bajo una sola descripción. Diseño pone en `acciones` el
 * botón para quitarlo; Maestranza y Producción solo los descargan. Diseño
 * pasa `lecturas`: quién subió cada envío y si cada área leyó su aviso.
 */
export function ListaDxf({
  archivos,
  acciones,
  accionesDeEnvio,
  lecturas,
}: {
  archivos: DxfDeCodigo[]
  acciones?: (d: DxfDeCodigo) => ReactNode
  accionesDeEnvio?: (grupo: DxfDeCodigo[]) => ReactNode
  /** Solo para Diseño: por envío, quién lo subió y si Maestranza y Producción leyeron su aviso. */
  lecturas?: Map<string, QuienSubioYQuienLeyo>
}) {
  return (
    <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {porEnvio(archivos).map((grupo) => {
        const v = lecturas?.get(grupo[0].envio)
        return (
        <li key={grupo[0].envio} className="p-3" data-envio={grupo[0].envio}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium wrap-anywhere text-texto">{grupo[0].descripcion}</p>
              <p className="text-xs text-texto-suave">
                {grupo.length === 1 ? '1 archivo' : `${grupo.length} archivos`} · {v ? subidoPor(v, grupo.length === 1 ? 'subido' : 'subidos') : fechaHora(llegada(grupo))}
              </p>
              {v && (
                <div className="flex flex-wrap items-center gap-2">
                  <LecturaDelAviso areas={v.areas} />
                </div>
              )}
            </div>
            {accionesDeEnvio?.(grupo)}
          </div>
          <ul className="mt-2 grid gap-1">
            {grupo.map((d) => {
              const Icono = /\.dxf$/i.test(d.nombre_archivo) ? FileCode : FileArchive
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-[var(--radius-base)] hover:bg-superficie-2" data-dxf={d.nombre_archivo}>
                  <Icono aria-hidden className="size-5 shrink-0 text-texto-suave" />
                  <p className="min-w-0 flex-1 text-sm text-texto">
                    <span className="wrap-anywhere">{d.nombre_archivo}</span>{' '}
                    <span className="text-xs whitespace-nowrap text-texto-suave">· {tamanoArchivo(d.tamano_bytes)}</span>
                  </p>
                  <a
                    href={d.url}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
                    aria-label={`Descargar ${d.nombre_archivo}`}
                  >
                    <Download aria-hidden className="size-4" />
                    Descargar
                  </a>
                  {acciones?.(d)}
                </li>
              )
            })}
          </ul>
        </li>
        )
      })}
    </ul>
  )
}
