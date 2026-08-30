'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { AlertTriangle, CalendarClock, Lock } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { cn } from '@/lib/utils'

import { guardarProgramaTaller } from '../../acciones'

export type EtapaProgramada = {
  id: string
  dias: number
  orden_secuencia: number
  etapa: { id: string; nombre: string; dias_estandar: number | null } | null
}

/**
 * Cuánto tiempo para la unidad en cada área.
 *
 * Es la parte de la cotización de trabajo que contesta «¿para cuándo?». La suma
 * de estas casillas es el plazo de fabricación, y cuando la cotización aprobada
 * se convierte en orden, cada área baja al taller con su fecha de inicio y de
 * fin ya contada con el calendario laboral.
 *
 * El total se muestra mientras se escribe y no solo al guardar: quien costea
 * está negociando contra una fecha que Ventas ya prometió, y necesita ver el
 * efecto de sumarle tres días a pintura en el momento en que lo escribe.
 */
export function ProgramaDeTaller({
  cotizacionId,
  etapas,
  editable,
  estado,
  plazoOfrecido,
}: {
  cotizacionId: string
  etapas: EtapaProgramada[]
  /** Lo calcula la página cruzando el estado con `cotizaciones.costear`. */
  editable: boolean
  /** Para contar por qué no se puede tocar cuando `editable` viene en falso. */
  estado?: string
  /**
   * Los días que Ventas le prometió al cliente. Van opcionales: si nadie
   * prometió nada todavía, no se inventa una comparación contra cero.
   */
  plazoOfrecido?: number | null
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  // Lo escrito en las casillas, para poder sumar sin ir al servidor. Arranca en
  // lo que hay guardado.
  const [dias, setDias] = useState<Record<string, string>>(() =>
    Object.fromEntries(etapas.map((e) => [e.id, String(e.dias)])),
  )

  const total = etapas.reduce((suma, e) => {
    const escrito = Number(dias[e.id])
    return suma + (Number.isFinite(escrito) ? escrito : 0)
  }, 0)

  const sinProgramar = etapas.filter((e) => Number(dias[e.id]) === 0).length
  // Prometer 45 días y programar 123 no es un detalle: es la fecha por la que
  // responde la empresa. Se dice acá, mientras todavía se puede negociar.
  const seExcede = Boolean(plazoOfrecido && total > plazoOfrecido)

  async function enviar(datos: FormData) {
    setError(null)
    setGuardado(false)
    setEnviando(true)
    const resultado = await guardarProgramaTaller(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setGuardado(true)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  if (etapas.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCabecera
          titulo="Tiempo por área"
          descripcion="El programa aparece cuando la cotización entra a costeo."
        />
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Tiempo por área"
        descripcion="Cuántos días de taller para la unidad en cada área. La suma es el plazo de fabricación, y al abrir la orden cada área baja con su fecha ya contada sin domingos ni feriados."
        acciones={
          !editable && estado ? (
            <span className="flex items-center gap-1.5 text-xs text-texto-suave">
              <Lock className="size-3.5" aria-hidden />
              Cerrado en {estado.toLowerCase().replace('_', ' ')}
            </span>
          ) : undefined
        }
      />

      <form action={enviar}>
        <input type="hidden" name="cotizacion_id" value={cotizacionId} />

        <div className="overflow-x-auto">
          <Tabla>
            <TablaCabecera>
              <TR>
                <TH className="w-10">#</TH>
                <TH>Área</TH>
                <TH className="w-28 text-right">Días</TH>
                <TH className="w-32 text-right">Lo habitual</TH>
              </TR>
            </TablaCabecera>
            <tbody>
              {etapas.map((e, i) => {
                const escrito = Number(dias[e.id])
                const estandar = e.etapa?.dias_estandar ?? null
                const noPasa = escrito === 0
                // Se marca solo lo que se aleja de veras: media jornada arriba o
                // abajo del estándar no le dice nada a nadie.
                const seAleja =
                  estandar !== null && estandar > 0 && Math.abs(escrito - estandar) > estandar / 2

                return (
                  <TR key={e.id} className={cn(noPasa && 'text-texto-tenue')}>
                    <TD className="text-texto-tenue tabular-nums">{i + 1}</TD>
                    <TD className={cn('font-medium', noPasa && 'font-normal line-through')}>
                      {e.etapa?.nombre ?? 'Área sin nombre'}
                    </TD>
                    <TD className="text-right">
                      {editable ? (
                        <Entrada
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={365}
                          step={1}
                          name={`dias_${e.id}`}
                          aria-label={`Días en ${e.etapa?.nombre ?? 'el área'}`}
                          value={dias[e.id] ?? ''}
                          onChange={(ev) =>
                            setDias((previo) => ({ ...previo, [e.id]: ev.target.value }))
                          }
                          className={cn('w-20 text-right tabular-nums', seAleja && 'border-aviso')}
                        />
                      ) : (
                        <span className="tabular-nums">{e.dias}</span>
                      )}
                    </TD>
                    <TD className="text-right text-xs text-texto-suave tabular-nums">
                      {estandar !== null ? `${estandar} d` : '—'}
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Tabla>
        </div>

        <TarjetaCuerpo className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div>
              <p className="text-[11px] tracking-wide text-texto-tenue uppercase">
                Plazo de fabricación
              </p>
              <p className="flex items-center gap-2 text-lg font-semibold text-texto tabular-nums">
                <CalendarClock className="size-4 text-texto-suave" aria-hidden />
                {total} días de taller
              </p>
            </div>

            {plazoOfrecido ? (
              <div className="text-right">
                <p className="text-[11px] tracking-wide text-texto-tenue uppercase">
                  Ventas ofreció
                </p>
                <p
                  className={cn(
                    'text-lg font-semibold tabular-nums',
                    seExcede ? 'text-aviso' : 'text-texto',
                  )}
                >
                  {plazoOfrecido} días
                </p>
              </div>
            ) : null}
          </div>

          {seExcede && (
            <p className="flex items-start gap-2 rounded-md bg-aviso-suave px-3 py-2 text-sm text-aviso">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              El taller necesita {total - (plazoOfrecido ?? 0)} días más de los que se le
              prometieron al cliente. Corrige el programa o pídele a Ventas que corrija el plazo
              antes de mandarla a Gerencia.
            </p>
          )}

          {sinProgramar > 0 && (
            <p className="text-xs text-texto-suave">
              {sinProgramar === 1
                ? 'Un área en cero: la unidad no pasa por ahí y no consume calendario.'
                : `${sinProgramar} áreas en cero: la unidad no pasa por ahí y no consumen calendario.`}
            </p>
          )}

          {error && <p className="text-sm text-peligro">{error}</p>}
          {guardado && !error && <p className="text-sm text-exito">Programa de taller guardado.</p>}

          {editable && (
            <div className="flex justify-end">
              <Boton type="submit" cargando={enviando}>
                Guardar el programa
              </Boton>
            </div>
          )}
        </TarjetaCuerpo>
      </form>
    </Tarjeta>
  )
}
