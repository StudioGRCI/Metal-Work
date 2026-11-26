import { FilePlus2 } from 'lucide-react'
import Link from 'next/link'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { EtapaAbiertaDelArea } from '@/lib/datos/tiempos-entrega'
import { pesoDeSemaforo, plazoEnPalabras, SEMAFORO_DE_CODIGO } from '@/lib/dominio/tiempos-entrega'
import { fecha } from '@/lib/format'

/** Un código que pide el reporte de hoy y no lo tiene, con sus etapas abiertas. */
export type CodigoSinReporte = { codigo: string; etapas: EtapaAbiertaDelArea[] }

/** Lo que más aprieta primero: el peor color y, a igual color, menos días hábiles. */
const masUrgente = (a: EtapaAbiertaDelArea, b: EtapaAbiertaDelArea) =>
  pesoDeSemaforo(a.semaforo) - pesoDeSemaforo(b.semaforo) || (a.dias_habiles ?? 9999) - (b.dias_habiles ?? 9999)

/** La etapa que nadie marcó «Empezó» lo dice, sin llamarlo atraso: eso lo dice el semáforo. */
function sinEmpezar(e: EtapaAbiertaDelArea, hoy: string): string | null {
  if (e.inicio_real) return null
  if (e.inicio_plan === hoy) return 'inicio planeado hoy, sin marcar «Empezó»'
  if (e.inicio_plan) return `inicio planeado el ${fecha(e.inicio_plan)}, sin marcar «Empezó»`
  return 'sin marcar «Empezó»'
}

/**
 * Los códigos con una etapa de su área que pide el reporte de hoy y no lo
 * tiene (Plan 1, entrega 1.3), arriba de «Planos y etapas»: es lo que le toca
 * al supervisor antes de irse. El plazo es el semáforo del tablero de tiempos
 * de entrega, con días hábiles, tal como lo da la base: aquí no se calcula. El
 * reporte que cuenta es el de cualquier supervisor del área.
 *
 * `codigos` es `null` si no se pudieron leer las etapas: se dice, no se pinta
 * vacío (vacío diría que ya está todo reportado).
 */
export function SinReporteDeHoy({ codigos, piden, hoy }: { codigos: CodigoSinReporte[] | null; piden: number; hoy: string }) {
  if (codigos === null) {
    return (
      <p role="status" className="mb-4 text-sm text-aviso" data-sin-reporte="sin-leer">
        No se pudo saber qué códigos esperan el reporte de hoy. Recarga la página; si continúa, avisa al administrador.
      </p>
    )
  }
  if (piden === 0) return null
  const ordenados = codigos
    .map((c) => ({ ...c, etapas: [...c.etapas].sort(masUrgente) }))
    .sort((a, b) => masUrgente(a.etapas[0], b.etapas[0]) || a.codigo.localeCompare(b.codigo))

  return (
    <Tarjeta className={codigos.length > 0 ? 'mb-4 border-aviso' : 'mb-4'} data-sin-reporte={codigos.length}>
      <TarjetaCabecera
        titulo={codigos.length > 0 ? `Sin reporte de hoy (${codigos.length})` : 'Reporte de hoy'}
        ayuda="Los códigos con una etapa de tu área en marcha, o que ya debía empezar, que todavía no tienen el reporte diario de hoy de tu área. El plazo es el del tablero de tiempos de entrega, en días hábiles. Toca el código para ver sus etapas con la fecha planeada y la real."
      />
      {codigos.length === 0 ? (
        <TarjetaCuerpo>
          <SinDatos compacto titulo={piden === 1 ? 'El código en marcha ya tiene su reporte de hoy' : `Los ${piden} códigos en marcha ya tienen su reporte de hoy`} />
        </TarjetaCuerpo>
      ) : (
        <ul className="divide-y divide-borde" aria-label="Códigos sin reporte de hoy">
          {ordenados.map(({ codigo, etapas }) => {
            const peor = etapas[0]
            const plazo = SEMAFORO_DE_CODIGO[peor.semaforo]
            return (
              <li key={codigo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-codigo-sin-reporte={codigo}>
                <div className="min-w-0 flex-1 basis-56 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/planos?q=${encodeURIComponent(codigo)}`}
                      className="inline-flex min-h-11 items-center font-mono font-medium break-all text-acento hover:underline sm:min-h-0 sm:pointer-coarse:min-h-11"
                    >
                      {codigo}
                    </Link>
                    <Insignia tono={plazo.tono}>{plazoEnPalabras(peor.semaforo, peor.dias_habiles, { fechaPlan: peor.fin_plan, hoy })}</Insignia>
                  </p>
                  <p className="text-xs break-words text-texto-suave">
                    {etapas.length === 1 ? 'Etapa' : 'Etapas'}:{' '}
                    {etapas
                      .map((e) => {
                        const falta = sinEmpezar(e, hoy)
                        return falta ? `${e.nombre} (${falta})` : e.nombre
                      })
                      .join(', ')}
                  </p>
                </div>
                <EnlaceBoton href={`/reportes-diarios/nuevo?codigo=${encodeURIComponent(codigo)}`} tamano="sm" variante="secundario">
                  <FilePlus2 aria-hidden className="size-4" />
                  Subir el reporte
                </EnlaceBoton>
              </li>
            )
          })}
        </ul>
      )}
    </Tarjeta>
  )
}
