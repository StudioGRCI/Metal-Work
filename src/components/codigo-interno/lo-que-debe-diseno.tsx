import { Check, Circle } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  compromisoEnPalabras,
  planoMasUrgente,
  puntosDeDiseno,
  resumenDeLoQueFalta,
  type CompromisoDelPlano,
  type LoQueDebeDiseno,
} from '@/lib/dominio/lo-que-debe-diseno'
import { cn } from '@/lib/utils'

/**
 * Lo que Diseño entrega por código interno, en una línea para las listas: los
 * cinco puntos con hecho o pendiente y, si hay, el plano vencido o por vencer
 * más urgente. El detalle (cuántos, desde cuándo, la fecha de cada área) va en
 * el código. Va en las listas de Diseño, en Códigos internos (Administración y
 * Gerencia) y en Planos y
 * etapas (el supervisor, solo su área con `areas`), en lectura. Los días los
 * cuenta la base; aquí no se calcula nada.
 *
 * `null` es «no se pudo leer», y se dice: no es lo mismo que «pendiente».
 */
export function LineaLoQueDebeDiseno({
  d,
  areas,
  propia = false,
  className,
}: {
  d: LoQueDebeDiseno | undefined | null
  /** Las áreas cuyo plano interesa a quien mira (el supervisor, la suya); sin esto, todas. */
  areas?: readonly string[]
  /** La lee Diseño en sus propias listas: «Falta cargar», no «Diseño todavía no carga». */
  propia?: boolean
  className?: string
}) {
  if (d === null) return <NoSeLeyo className={className} />
  const puntos = puntosDeDiseno(d)
  const resumen = resumenDeLoQueFalta(puntos)
  const urgente = planoMasUrgente((d?.compromisos ?? []).filter((c) => !areas || areas.includes(c.area)))
  // Sin nada cargado, una línea en letra suave y no cinco casillas vacías: con
  // casi todos los códigos así (188 de 191 en el banco local), las casillas se
  // repetían en toda la lista y la
  // fila que sí tenía algo no se distinguía (hallazgo 4 del plan de orden y
  // diseño; entrega 5). Los cinco puntos siguen dichos, y con sus marcas.
  if (!urgente && puntos.every((p) => !p.hecho)) {
    return (
      <div className={className} data-lo-que-debe-diseno={d?.codigo} data-sin-nada="">
        <p className="sr-only">{resumen}.</p>
        <ul aria-hidden className="flex flex-wrap items-center gap-x-1 text-xs text-texto-suave" title={resumen}>
          <li>{propia ? 'Falta cargar:' : 'Diseño todavía no carga:'}</li>
          {puntos.map((p, i) => (
            <li key={p.clave} data-punto={p.clave} data-hecho={p.hecho}>
              {p.etiqueta === p.etiqueta.toUpperCase() ? p.etiqueta : p.etiqueta.toLowerCase()}
              {/* Con una etapa ya puesta (la del área, o una sola de las dos de
                  Diseño), «etapas» a secas contradecía lo que se ve en la tarjeta. */}
              {p.clave === 'etapas' && (d?.etapas ?? 0) > 0 && ` (${p.detalle.charAt(0).toLowerCase()}${p.detalle.slice(1)})`}
              {i < puntos.length - 1 ? ',' : '.'}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className={className} data-lo-que-debe-diseno={d?.codigo}>
      <p className="sr-only">
        {resumen}.{urgente && ` ${urgente.insignia}: ${compromisoEnPalabras(urgente.compromiso).texto}.`}
      </p>
      <ul aria-hidden className="flex flex-wrap items-center gap-2" title={resumen}>
        {puntos.map((p) => (
          <li key={p.clave} data-punto={p.clave} data-hecho={p.hecho}>
            <Insignia tono={p.hecho ? 'exito' : 'neutro'}>
              {p.hecho ? <Check className="size-3" /> : <Circle className="size-3" />}
              {p.etiqueta}
            </Insignia>
          </li>
        ))}
        {urgente && (
          <li data-compromiso={urgente.compromiso.area} data-situacion={urgente.compromiso.situacion}>
            {/* La fecha, al pasar el puntero: en la lista se leía como la de la etapa. */}
            <Insignia tono={urgente.tono} title={`Plano de ${urgente.compromiso.areaNombre}: ${compromisoEnPalabras(urgente.compromiso).texto}`}>
              {urgente.insignia}
            </Insignia>
          </li>
        )}
      </ul>
    </div>
  )
}

/**
 * La tarjeta del código en Diseño, junto a sus cifras: los cinco puntos en una
 * fila, el plano de cada área contra el día en que lo necesita, y el detalle de
 * cada punto plegado.
 */
export function TarjetaLoQueDebeDiseno({ d }: { d: LoQueDebeDiseno | undefined | null }) {
  const puntos = puntosDeDiseno(d ?? undefined)
  const hechos = puntos.filter((p) => p.hecho).length
  return (
    <Tarjeta data-lo-que-debe-diseno={d?.codigo} data-tarjeta-lo-que-debe>
      <TarjetaCabecera
        titulo="Lo que Diseño entrega"
        descripcion={d === null ? undefined : `${hechos} de ${puntos.length} · ${resumenDeLoQueFalta(puntos)}.`}
        ayuda="Los cinco puntos que Diseño le entrega al taller por cada unidad, y el plano de Maestranza y de Producción contra el día en que el área lo necesita: cuando empieza la etapa que Diseño le puso (Habilitado o Ensamblaje). El plano no dice de qué juego es: con varios juegos se mide el primero. Supervisión y Administración ven lo mismo, sin poder cambiarlo."
      />
      <TarjetaCuerpo className="space-y-3">
        {d === null ? (
          <NoSeLeyo />
        ) : (
          <>
            <ul aria-hidden className="flex flex-wrap items-center gap-2">
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
            <Pliegue titulo="Ver cada punto" data-detalle-de-diseno="">
              <ul className="space-y-1">
                {puntos.map((p) => (
                  <li key={p.clave} className="text-sm break-words text-texto-suave" data-detalle={p.clave}>
                    <span className="font-medium text-texto">{p.etiqueta}</span>
                    <span className="sr-only"> ({p.hecho ? 'hecho' : 'pendiente'})</span>: {p.detalle}
                  </li>
                ))}
              </ul>
            </Pliegue>
          </>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Compromisos({ compromisos }: { compromisos: readonly CompromisoDelPlano[] }) {
  return (
    <ul className="space-y-1" aria-label="El plano de cada área">
      {compromisos.map((c) => {
        const { texto, insignia, tono } = compromisoEnPalabras(c)
        return (
          <li key={c.area} className="text-sm text-texto-suave" data-compromiso={c.area} data-situacion={c.situacion}>
            <span className="break-words">
              <span className="font-medium text-texto">Plano de {c.areaNombre}:</span> {texto}
            </span>{' '}
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
