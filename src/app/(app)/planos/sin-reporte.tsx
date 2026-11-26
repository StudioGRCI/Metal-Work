import { FilePlus2 } from 'lucide-react'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { EtapaDeCodigo } from '@/lib/datos/diseno-codigos'
import { plazoEtapa } from '@/lib/dominio/diseno-codigos'
import { fecha } from '@/lib/format'

/** Un código en marcha sin reporte de hoy, con sus etapas abiertas. */
export type CodigoSinReporte = { codigo: string; etapas: EtapaDeCodigo[] }

/** Del más grave al más tranquilo, para decir el plazo que más aprieta. */
const GRAVEDAD: Tono[] = ['peligro', 'aviso', 'info', 'exito', 'acento', 'neutro']

/**
 * La etapa está en marcha hoy: empezó, o su inicio planeado ya llegó (debió
 * empezar), y no terminó. La que todavía no llega a su inicio no pide reporte.
 */
export const enMarchaHoy = (e: EtapaDeCodigo, hoy: string) => !e.fin_real && Boolean(e.inicio_real || (e.inicio_plan && e.inicio_plan <= hoy))

/**
 * Los códigos con una etapa del área en marcha que todavía no tienen el
 * reporte diario de hoy (Plan 1, entrega 1.3), arriba de «Planos y etapas»: es
 * lo que le toca al supervisor antes de irse. El plazo de cada uno es el del
 * semáforo de la etapa (`plazoEtapa` con el límite de la base), el mismo que
 * pinta la tarjeta del código: no se calcula otro.
 *
 * Cuenta el reporte de cualquier supervisor del área, no solo el de quien
 * mira: lo da la base por etapa (`ultimo_reporte`).
 */
export function SinReporteDeHoy({
  codigos,
  enMarcha,
  hoy,
  limite,
}: {
  codigos: CodigoSinReporte[]
  /** Cuántos códigos tienen hoy una etapa en marcha, reportados o no. */
  enMarcha: number
  hoy: string
  limite: string | null
}) {
  if (enMarcha === 0) return null
  // El que más aprieta arriba: el semáforo de su etapa más grave y, a igual
  // color, la fecha comprometida más cercana.
  const ordenados = codigos
    .map((c) => {
      const [primera] = c.etapas
        .map((e) => ({ fin: e.fin_plan ?? '9999-12-31', plazo: plazoEtapa(e, hoy, limite) }))
        .sort((a, b) => GRAVEDAD.indexOf(a.plazo.tono) - GRAVEDAD.indexOf(b.plazo.tono) || a.fin.localeCompare(b.fin))
      return { ...c, masUrgente: primera?.plazo, gravedad: GRAVEDAD.indexOf(primera?.plazo.tono ?? 'neutro'), fin: primera?.fin ?? '9999-12-31' }
    })
    .sort((a, b) => a.gravedad - b.gravedad || a.fin.localeCompare(b.fin) || a.codigo.localeCompare(b.codigo))

  return (
    <Tarjeta className={codigos.length > 0 ? 'mb-4 border-aviso' : 'mb-4'} data-sin-reporte={codigos.length}>
      <TarjetaCabecera
        titulo={codigos.length > 0 ? `Sin reporte de hoy (${codigos.length})` : 'Reporte de hoy'}
        descripcion={codigos.length > 0 ? 'Códigos con una etapa de tu área en marcha que todavía no tienen el reporte diario de hoy.' : undefined}
      />
      {codigos.length === 0 ? (
        <TarjetaCuerpo>
          <SinDatos
            compacto
            titulo={enMarcha === 1 ? 'El código en marcha ya tiene su reporte de hoy' : `Los ${enMarcha} códigos en marcha ya tienen su reporte de hoy`}
          />
        </TarjetaCuerpo>
      ) : (
        <ul className="divide-y divide-borde" aria-label="Códigos sin reporte de hoy">
          {ordenados.map(({ codigo, etapas, masUrgente }) => (
            <li key={codigo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-codigo-sin-reporte={codigo}>
              <div className="min-w-0 flex-1 basis-56 space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono font-medium break-all text-texto">{codigo}</span>
                  {masUrgente && <Insignia tono={masUrgente.tono}>{masUrgente.etiqueta}</Insignia>}
                </p>
                <p className="text-xs break-words text-texto-suave">
                  {etapas.length === 1 ? 'Etapa' : 'Etapas'}:{' '}
                  {etapas.map((e) => (e.inicio_real || !e.inicio_plan ? e.nombre : `${e.nombre} (debía empezar el ${fecha(e.inicio_plan)})`)).join(', ')}
                </p>
              </div>
              <EnlaceBoton href={`/reportes-diarios/nuevo?codigo=${encodeURIComponent(codigo)}`} tamano="sm" variante="secundario">
                <FilePlus2 aria-hidden className="size-4" />
                Subir el reporte
              </EnlaceBoton>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}
