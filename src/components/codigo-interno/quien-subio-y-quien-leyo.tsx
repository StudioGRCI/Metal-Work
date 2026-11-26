import { Eye, EyeOff } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import type { LecturaDelArea, QuienSubioYQuienLeyo } from '@/lib/datos/quien-subio-y-quien-leyo'
import { fechaHora } from '@/lib/format'

/** Leído, sin leer, leído por algunas cuentas o sin aviso: lo que pasó con el aviso en un área. */
export function situacionDelAviso(a: LecturaDelArea) {
  if (a.destinatarios === 0) return 'sin-aviso' as const
  if (a.leidos === 0) return 'sin-leer' as const
  if (a.leidos < a.destinatarios) return 'parcial' as const
  return 'leido' as const
}

/**
 * Lo que pasó con el aviso de un área, en dos partes: la insignia, corta para
 * que quepa en el teléfono, y el detalle que va a su lado (la fecha, cuántos
 * faltan, por qué no hubo aviso). `texto` es las dos juntas, para decirlo en
 * una línea. `cuando` formatea la fecha: con hora en la versión vigente, sin
 * hora en las anteriores.
 */
export function avisoEnPalabras(
  a: LecturaDelArea,
  cuando: (valor: string | null) => string = fechaHora,
): { insignia: string; detalle: string | null; texto: string } {
  const juntar = (insignia: string, detalle: string | null) => ({
    insignia,
    detalle,
    texto: detalle ? `${insignia} ${detalle}` : insignia,
  })
  switch (situacionDelAviso(a)) {
    case 'sin-aviso':
      return juntar(`${a.areaNombre} sin aviso`, '(nadie del área lo recibió)')
    case 'sin-leer':
      return juntar(`${a.areaNombre} no leyó el aviso`, null)
    case 'parcial': {
      const faltan = a.destinatarios - a.leidos
      return juntar(
        `${a.areaNombre}: ${a.leidos} de ${a.destinatarios} leyeron el aviso`,
        `(primero el ${cuando(a.primeraLectura)}; falta${faltan === 1 ? '' : 'n'} ${faltan})`,
      )
    }
    case 'leido':
      return juntar(`${a.areaNombre} leyó el aviso`, `el ${cuando(a.ultimaLectura)}`)
  }
}

/**
 * Qué quiere decir cada estado del aviso. Va en la ayuda de la tarjeta, una
 * vez, y no en cada insignia: en el teléfono no hay cómo ver un `title`.
 */
export const QUE_DICE_EL_AVISO =
  ' «Leyó el aviso» quiere decir que el supervisor del área abrió el aviso o marcó todos como leídos; no dice que abrió el archivo.' +
  ' «Sin aviso» quiere decir que nadie del área lo recibió: no había supervisor activo cuando se subió, o el que había ya no es de esa área.'

/** Por área: si su supervisor ya leyó el aviso de esta versión, y cuándo. */
export function LecturaDelAviso({ areas }: { areas: LecturaDelArea[] }) {
  return (
    <>
      {areas.map((a) => {
        const situacion = situacionDelAviso(a)
        const { insignia, detalle } = avisoEnPalabras(a)
        const Icono = situacion === 'leido' || situacion === 'parcial' ? Eye : EyeOff
        return (
          <span
            key={a.area}
            className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1"
            data-aviso-area={a.area}
            data-aviso={situacion}
          >
            <Insignia tono={situacion === 'leido' ? 'exito' : 'neutro'}>
              <Icono aria-hidden className="size-3.5" />
              {insignia}
            </Insignia>
            {detalle && <span className="text-xs text-texto-suave">{detalle}</span>}
          </span>
        )
      })}
    </>
  )
}

/** «Subido por Diseño el …»: el puesto de quien lo subió, nunca su nombre. */
export function subidoPor(v: QuienSubioYQuienLeyo, palabra = 'Subido', cuando: (valor: string) => string = fechaHora) {
  return `${palabra}${v.subidoPor ? ` por ${v.subidoPor}` : ''} el ${cuando(v.subidoEn)}`
}
