'use client'

import { Boton } from '@/components/ui/boton'
import { OTRA_CUENTA } from '@/lib/envio'
import { cn } from '@/lib/utils'

/**
 * Lo que dice una ventana al volver a abrirse cuando el envío anterior, del que
 * no llegó la respuesta, sí entró (`useIdDelEnvio`): cuál quedó, y que lo que se
 * registre ahora es otro. Sin rojo, porque no es un error. La región está
 * siempre montada para que el lector de pantalla lo lea al aparecer: la base
 * contesta con la ventana ya abierta. Es `aria-live` y no `role="status"`: el
 * aviso de la ventana es su primer `status`, y una región vacía delante lo
 * tapaba para quien lo busca por su papel.
 *
 * Si en otra pestaña entró otra cuenta (`OTRA_CUENTA`), va en el tono de aviso y
 * con el botón que recarga: desde esa pantalla no se envía nada (vigésima
 * pasada). Antes la ventana abría limpia y el envío salía en rojo como un
 * problema de permiso.
 */
export function EnvioAnterior({ texto }: { texto: string | null }) {
  const otraCuenta = texto === OTRA_CUENTA
  return (
    <div aria-live="polite" aria-atomic="true">
      {texto && (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-base)] px-3 py-2 text-sm text-texto',
            otraCuenta ? 'bg-aviso-suave' : 'bg-info-suave',
          )}
        >
          <p data-envio-anterior className="min-w-0 flex-1 basis-60">
            {texto}
          </p>
          {otraCuenta && (
            <Boton type="button" variante="contorno" tamano="sm" onClick={() => window.location.reload()}>
              Recargar la pantalla
            </Boton>
          )}
        </div>
      )}
    </div>
  )
}
