import { Check, Circle } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  compromisoEnPalabras,
  puntosDeDiseno,
  resumenDeLoQueFalta,
  type CompromisoDelPlano,
  type LoQueDebeDiseno,
} from '@/lib/dominio/lo-que-debe-diseno'
import { cn } from '@/lib/utils'

/**
 * Lo que Diseño entrega por código interno, en una línea: los cinco puntos con
 * hecho o pendiente, y la fecha comprometida del plano de cada área contra la
 * real. Va en las listas de Diseño, en Códigos internos (Administración y
 * Gerencia, en lectura) y en Planos y etapas (Supervisión, en lectura). Los
 * días los cuenta la base; aquí no se calcula nada.
 *
 * `null` es «no se pudo leer», y se dice: no es lo mismo que «pendiente».
 */
export function LineaLoQueDebeDiseno({ d, className }: { d: LoQueDebeDiseno | undefined | null; className?: string }) {
  if (d === null) return <NoSeLeyo className={className} />
  const puntos = puntosDeDiseno(d)
  const resumen = resumenDeLoQueFalta(puntos)
  return (
    <div className={cn('space-y-1', className)} data-lo-que-debe-diseno={d?.codigo}>
      <p className="sr-only">{resumen}.</p>
      <ul aria-hidden className="flex flex-wrap items-center gap-1.5" title={resumen}>
        {puntos.map((p) => (
          <li key={p.clave} data-punto={p.clave} data-hecho={p.hecho}>
            <Insignia tono={p.hecho ? 'exito' : 'neutro'}>
              {p.hecho ? <Check className="size-3" /> : <Circle className="size-3" />}
              {p.etiqueta}
            </Insignia>
          </li>
        ))}
      </ul>
      {d && d.compromisos.length > 0 && <Compromisos compromisos={d.compromisos} />}
    </div>
  )
}

/**
 * Los cinco puntos con su detalle (cuántos y desde cuándo, o qué falta) y la
 * fecha del plano de cada área. Es la tarjeta del código en Diseño.
 */
export function TarjetaLoQueDebeDiseno({ d }: { d: LoQueDebeDiseno | undefined | null }) {
  const puntos = puntosDeDiseno(d ?? undefined)
  const hechos = puntos.filter((p) => p.hecho).length
  return (
    <Tarjeta data-lo-que-debe-diseno={d?.codigo}>
      <TarjetaCabecera
        titulo="Lo que Diseño entrega"
        descripcion={d === null ? undefined : `${hechos} de ${puntos.length} · ${resumenDeLoQueFalta(puntos)}.`}
        ayuda="Los cinco puntos que Diseño le entrega al taller por cada unidad, y para cuándo se comprometió el plano de cada área: el día en que empieza la etapa que Diseño le puso a esa área. Supervisión y Administración ven lo mismo, sin poder cambiarlo."
      />
      <TarjetaCuerpo className="space-y-4">
        {d === null ? (
          <NoSeLeyo />
        ) : (
          <>
            <ul className="divide-y divide-borde">
              {puntos.map((p) => (
                <li key={p.clave} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0" data-punto={p.clave} data-hecho={p.hecho}>
                  <span
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                      p.hecho ? 'bg-exito-suave text-exito' : 'bg-neutro-suave text-texto-suave',
                    )}
                  >
                    {p.hecho ? <Check aria-hidden className="size-3.5" /> : <Circle aria-hidden className="size-3" />}
                  </span>
                  <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                    <p className="text-sm font-medium text-texto">
                      {p.etiqueta}
                      <span className="sr-only">: {p.hecho ? 'hecho' : 'pendiente'}.</span>
                    </p>
                    <p className="text-xs text-texto-suave sm:text-right">{p.detalle}</p>
                  </div>
                </li>
              ))}
            </ul>
            {d && d.compromisos.length > 0 && (
              <section aria-label="Fecha comprometida del plano" className="space-y-1.5 border-t border-borde pt-3">
                <h3 className="text-sm font-semibold text-texto">El plano de cada área</h3>
                <Compromisos compromisos={d.compromisos} />
              </section>
            )}
          </>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Compromisos({ compromisos }: { compromisos: readonly CompromisoDelPlano[] }) {
  return (
    <ul className="space-y-1">
      {compromisos.map((c) => {
        const { texto, insignia, tono } = compromisoEnPalabras(c)
        return (
          <li key={c.area} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-texto-suave" data-compromiso={c.area} data-situacion={c.situacion}>
            <span className="min-w-0 break-words">
              <span className="font-medium text-texto">Plano de {c.areaNombre}:</span> {texto}
            </span>
            {insignia && <Insignia tono={tono}>{insignia}</Insignia>}
          </li>
        )
      })}
    </ul>
  )
}

function NoSeLeyo({ className }: { className?: string }) {
  return (
    <p role="status" className={cn('text-xs text-aviso', className)} data-lo-que-debe-diseno="sin-leer">
      No se pudo leer lo que Diseño entregó. Recarga la página; si continúa, avisa al administrador.
    </p>
  )
}
