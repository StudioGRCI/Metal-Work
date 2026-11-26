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

/** «Maestranza leyó el aviso el …», con las mismas palabras en la insignia y en su ayuda. */
export function avisoEnPalabras(a: LecturaDelArea): { texto: string; ayuda: string } {
  switch (situacionDelAviso(a)) {
    case 'sin-aviso':
      return {
        texto: `${a.areaNombre}: sin aviso`,
        ayuda: `Ninguna cuenta de ${a.areaNombre} recibió el aviso: es de antes de los avisos o el área no tenía supervisor activo.`,
      }
    case 'sin-leer':
      return { texto: `${a.areaNombre} no leyó el aviso`, ayuda: `El aviso le llegó a ${a.areaNombre} y todavía no lo abre.` }
    case 'parcial':
      return {
        texto: `${a.areaNombre}: ${a.leidos} de ${a.destinatarios} leyeron el aviso`,
        ayuda: `Lo leyó primero el ${fechaHora(a.primeraLectura)}; falta${a.destinatarios - a.leidos === 1 ? '' : 'n'} ${a.destinatarios - a.leidos}.`,
      }
    case 'leido':
      return {
        texto: `${a.areaNombre} leyó el aviso el ${fechaHora(a.ultimaLectura)}`,
        ayuda: 'Leído quiere decir que abrió el aviso o marcó todos como leídos; no dice que abrió el archivo.',
      }
  }
}

/** Una insignia por área: si su supervisor ya leyó el aviso de esta versión. */
export function LecturaDelAviso({ areas }: { areas: LecturaDelArea[] }) {
  return (
    <>
      {areas.map((a) => {
        const situacion = situacionDelAviso(a)
        const { texto, ayuda } = avisoEnPalabras(a)
        const Icono = situacion === 'leido' || situacion === 'parcial' ? Eye : EyeOff
        return (
          <Insignia key={a.area} tono={situacion === 'leido' ? 'exito' : 'neutro'} title={ayuda} data-aviso-area={a.area} data-aviso={situacion}>
            <Icono aria-hidden className="size-3.5" />
            {texto}
          </Insignia>
        )
      })}
    </>
  )
}

/** «Subido por Diseño el …»: el puesto de quien lo subió, nunca su nombre. */
export function subidoPor(v: QuienSubioYQuienLeyo, palabra = 'Subido', cuando: (valor: string) => string = fechaHora) {
  return `${palabra}${v.subidoPor ? ` por ${v.subidoPor}` : ''} el ${cuando(v.subidoEn)}`
}
