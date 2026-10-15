import { FileCheck2, History } from 'lucide-react'

import type { CorreccionVista } from '@/lib/datos/correcciones'
import { fechaHora } from '@/lib/format'

/**
 * Las correcciones de un documento, plegadas bajo «Corregido N veces»: cuándo,
 * qué área, el motivo, lo que cambió y su justificante. No se editan ni se
 * borran: son la evidencia.
 */
export function HistorialDeCorrecciones({ correcciones }: { correcciones: CorreccionVista[] | undefined }) {
  if (!correcciones || correcciones.length === 0) return null
  const veces = correcciones.length
  return (
    <details className="group mt-1 text-xs">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 font-medium text-acento hover:underline sm:min-h-0 [&::-webkit-details-marker]:hidden">
        <History aria-hidden className="size-3.5" />
        Corregido {veces === 1 ? 'una vez' : `${veces} veces`}
      </summary>
      <ol className="mt-1 space-y-2 border-l-2 border-borde pl-3 text-left">
        {correcciones.map((c) => (
          <li key={c.id}>
            <p className="text-[11px] text-texto-suave">
              {fechaHora(c.corregido_en)} · {c.quien}
            </p>
            <p className="text-texto">{c.motivo}</p>
            {c.cambios.length > 0 && (
              <ul className="mt-0.5 list-disc pl-4 text-texto-suave">
                {c.cambios.map((cambio) => (
                  <li key={cambio} className="tabular">
                    {cambio}
                  </li>
                ))}
              </ul>
            )}
            {c.justificante.url ? (
              <a
                href={c.justificante.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex min-h-9 items-center gap-1 text-acento hover:underline sm:min-h-0"
              >
                <FileCheck2 aria-hidden className="size-3.5" />
                Justificante: {c.justificante.nombre}
              </a>
            ) : (
              <p className="mt-0.5 text-texto-suave">Justificante: {c.justificante.nombre}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
