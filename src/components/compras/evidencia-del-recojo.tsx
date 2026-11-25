import { CircleSlash } from 'lucide-react'

import { Miniaturas } from '@/components/avance/miniaturas'
import type { CompraParaRecojo } from '@/lib/datos/logistica'
import { fechaHora, hora } from '@/lib/format'

/**
 * Las fotos que el conductor tomó al recogerla. Las ven el conductor y
 * Logística, en /recojos y en Gestión de compras. Si los enlaces no llegaron, se
 * dice cuántas hay en vez de no pintar nada.
 */
export function FotosDelRecojo({ compra }: { compra: Pick<CompraParaRecojo, 'fotos' | 'nombre'> }) {
  if (compra.fotos.length === 0) return null
  const enlaces = Object.fromEntries(compra.fotos.flatMap((f) => (f.url ? [[f.ruta, f.url]] : [])))
  const cuantas = compra.fotos.length === 1 ? '1 foto' : `${compra.fotos.length} fotos`
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-texto-suave">Fotos del recojo ({cuantas})</p>
      {Object.keys(enlaces).length > 0 ? (
        <Miniaturas fotos={compra.fotos.map((f) => ({ id: f.ruta, ruta_storage: f.ruta }))} enlaces={enlaces} alt={`Foto del recojo de la ${compra.nombre}`} />
      ) : (
        <p className="text-xs text-texto-suave">No se pudieron abrir ahora: recarga la pantalla para verlas.</p>
      )}
    </div>
  )
}

/**
 * La última vez que el conductor no pudo recogerla: qué dijo, cuándo y quién.
 * Para Logística es el porqué de que haya vuelto a «Por programar»; para el
 * conductor, lo que pasó la vez anterior.
 */
export function NoSeLogroRecoger({ compra }: { compra: Pick<CompraParaRecojo, 'no_logrado'> }) {
  const n = compra.no_logrado
  if (!n) return null
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-base)] border border-borde bg-aviso-suave px-3 py-2 text-sm text-texto">
      <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-aviso" />
      <p>
        <span className="font-medium">
          No se pudo recoger{n.veces > 1 ? ` (${n.veces} veces)` : ''}.
        </span>{' '}
        {n.quien ?? 'El conductor'} el {fechaHora(n.registrado_en)}
        {n.salio_en ? `, había salido a las ${hora(n.salio_en)}` : ''}: «{n.motivo}»
      </p>
    </div>
  )
}
