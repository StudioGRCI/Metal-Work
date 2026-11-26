import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { estadoDelPlazo, faltaDe, type PlazoDeCompra } from '@/lib/dominio/plazos'
import { cantidad, fecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * La OC o la OS contra la fecha que prometió el proveedor: la fecha, cuándo
 * llegó o volvió, si está atrasada o llegó tarde, y de la OC que llegó a medias,
 * lo que falta (Plan 4.1). Los días los cuenta la base por fecha de Lima.
 *
 * `undefined` es que la base no dio el plazo (la pantalla ya avisa arriba si no
 * se pudo leer); sin fecha prometida lo dice, para que se note que falta.
 */
export function PlazoDeLaCompra({
  plazo,
  servicio = false,
  className,
}: {
  plazo: PlazoDeCompra | undefined
  servicio?: boolean
  className?: string
}) {
  if (!plazo) return null
  const estado = estadoDelPlazo(plazo, { servicio })
  const hoy = hoyLima()
  const prometida = !plazo.esperada
    ? null
    : plazo.esperada === hoy && !plazo.completa_en
      ? 'hoy'
      : fecha(plazo.esperada)
  const falta = plazo.por_llegar ?? []
  return (
    <div className={cn('space-y-1', className)} data-plazo={plazo.atrasada ? 'atrasada' : plazo.completa_en ? 'completa' : 'abierta'}>
      <p className="text-xs text-texto-suave">
        {prometida ? (
          <>
            {servicio ? 'Debe volver' : 'Prometida'}{' '}
            <span className="tabular font-medium text-texto">{prometida}</span>
          </>
        ) : (
          <span className="text-texto-tenue">{servicio ? 'Sin fecha de fin' : 'Sin fecha prometida'}</span>
        )}
        {plazo.completa_en ? (
          <>
            {' · '}
            {servicio ? 'Volvió conforme' : 'Completa'} <span className="tabular">{fecha(plazo.completa_en)}</span>
          </>
        ) : (
          plazo.llego_en && (
            <>
              {' · '}Llegó en parte <span className="tabular">{fecha(plazo.llego_en)}</span>
            </>
          )
        )}
      </p>
      {estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
      {falta.length > 0 && (
        <Pliegue
          titulo={falta.length === 1 ? 'Falta 1 material' : `Faltan ${falta.length} materiales`}
          className="text-left"
          data-lo-que-falta={String(falta.length)}
        >
          <ul className="space-y-1 text-xs">
            {falta.map((l, i) => (
              <li key={`${l.material}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0 break-words text-texto">{l.material}</span>
                <span className="tabular whitespace-nowrap text-texto-suave">{faltaDe(l, cantidad)}</span>
              </li>
            ))}
          </ul>
        </Pliegue>
      )}
    </div>
  )
}
