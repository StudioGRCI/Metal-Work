'use client'

import { Check } from 'lucide-react'

import { useAvisos } from '@/components/estructura/use-avisos'
import { Boton } from '@/components/ui/boton'
import type { Notificacion } from '@/lib/datos/notificaciones'
import { fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * La lista de la página de avisos: la misma que la campana, a ancho completo
 * y con «Marcar todos leídos» arriba. Lo tocado se pinta leído al instante y
 * el refresco lo confirma.
 */
export function ListaAvisos({ avisos, sinLeer }: { avisos: Notificacion[]; sinLeer: number }) {
  const { abrir, marcarTodos, marcando, error } = useAvisos()
  const quedan = sinLeer

  return (
    <div>
      {error && <p role="alert" className="m-4 rounded-xl bg-peligro-suave p-3 text-sm text-peligro">{error}</p>}
      {quedan > 0 && (
        <div className="flex justify-end border-b border-borde px-4 py-2">
          <Boton
            variante="fantasma"
            tamano="sm"
            cargando={marcando}
            onClick={marcarTodos}
          >
            <Check aria-hidden className="size-3.5" />
            Marcar los {quedan} como leídos
          </Boton>
        </div>
      )}

      {avisos.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-texto-suave">
          No hay avisos. Acá llega lo que te toca mover.
        </p>
      ) : (
        <ul className="divide-y divide-borde">
          {avisos.map((a) => {
            const leido = Boolean(a.leida_en)
            const contenido = (
              <>
                <p className={cn('text-sm', leido ? 'text-texto-suave' : 'font-semibold text-texto')}>{a.titulo}</p>
                {a.cuerpo && <p className="mt-0.5 text-xs leading-snug text-texto-suave">{a.cuerpo}</p>}
                <p className="mt-0.5 text-[11px] text-texto-tenue">{fechaHora(a.creado_en)}</p>
              </>
            )
            const clase = cn('block w-full px-4 py-3 text-left hover:bg-superficie-2', !leido && 'bg-acento-suave/40')
            return (
              <li key={a.id}>
                  <button type="button" disabled={marcando} onClick={() => abrir(a)} className={clase}>
                    {contenido}
                  </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
