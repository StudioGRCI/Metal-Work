import type { ReactNode } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { estadoDelPlazo, faltaDe, type PlazoDeCompra } from '@/lib/dominio/plazos'
import { cantidad, fecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * La OC o la OS contra la fecha que prometió el proveedor (Plan 4.1). Los días
 * los cuenta la base por fecha de Lima.
 *
 * Va en dos piezas, porque en la fila se leen en dos lugares: la insignia
 * (atrasada, llegó tarde o a tiempo) junto a la de en qué va, para que en el
 * teléfono se vea arriba de la ficha; y las fechas y lo que falta, debajo.
 *
 * `undefined` es que la base no dio el plazo (la pantalla ya avisa arriba si no
 * se pudo leer).
 */
export function InsigniaDelPlazo({ plazo, servicio = false }: { plazo: PlazoDeCompra | undefined; servicio?: boolean }) {
  const estado = estadoDelPlazo(plazo, { servicio })
  return estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
}

/**
 * La fecha prometida, cuándo llegó o volvió y, de la OC que llegó a medias, lo
 * que falta. Sin fecha prometida lo dice, para que se note que falta.
 *
 * `fechaDelDocumento` es la fecha que la fila ya muestra (la de fin de la OS):
 * si es la misma, no se repite.
 */
export function PlazoDeLaCompra({
  plazo,
  servicio = false,
  fechaDelDocumento,
  className,
}: {
  plazo: PlazoDeCompra | undefined
  servicio?: boolean
  fechaDelDocumento?: string | null
  className?: string
}) {
  if (!plazo) return null
  const hoy = hoyLima()
  const repetida = fechaDelDocumento !== undefined && plazo.esperada === fechaDelDocumento
  const prometida = !plazo.esperada
    ? null
    : plazo.esperada === hoy && !plazo.completa_en
      ? 'hoy'
      : fecha(plazo.esperada)
  const falta = plazo.por_llegar ?? []

  const partes: ReactNode[] = []
  if (!repetida) {
    partes.push(
      prometida ? (
        <span key="prometida">
          {servicio ? 'Debe volver' : 'Prometida'} <span className="tabular font-medium text-texto">{prometida}</span>
        </span>
      ) : (
        <span key="prometida" className="text-texto-tenue">
          {servicio ? 'Sin fecha de fin' : 'Sin fecha prometida'}
        </span>
      ),
    )
  }
  if (plazo.completa_en) {
    partes.push(
      <span key="llego">
        {servicio ? 'Volvió conforme' : 'Completa'} <span className="tabular">{fecha(plazo.completa_en)}</span>
      </span>,
    )
  } else if (plazo.llego_en) {
    // Lo que el conductor dejó y Almacén no valida todavía no falta: está por
    // validar. Lo que falta lo dice el pliegue de abajo: «llegó en parte» mentía
    // cuando Almacén observó todo y no entró nada.
    partes.push(
      <span key="llego">
        Dejada en almacén <span className="tabular">{fecha(plazo.llego_en)}</span>
        {plazo.por_validar && ', por validar'}
      </span>,
    )
  }

  if (partes.length === 0 && falta.length === 0) return null
  return (
    <div
      className={cn('space-y-1', className)}
      data-plazo={plazo.atrasada ? 'atrasada' : plazo.completa_en ? 'completa' : plazo.por_validar ? 'por-validar' : 'abierta'}
    >
      {partes.length > 0 && (
        <p className="text-xs text-texto-suave">
          {partes.map((p, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {p}
            </span>
          ))}
        </p>
      )}
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
