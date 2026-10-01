import { fecha } from '@/lib/format'
import { diaDeLima, dias, diasEntre, rangoDelGrafico, type EtapaEnGrafico } from '@/lib/dominio/expediente'

type FilaPlan = EtapaEnGrafico & { id: string; nombre: string; area: string | null }

/**
 * Cada etapa en dos barras sobre el mismo calendario: arriba lo que se
 * programó, abajo lo que de verdad tomó. Se lee de un vistazo qué etapa se
 * estiró y cuánto se corrió la siguiente.
 *
 * Es un gráfico de énfasis: lo real en el acento y lo programado en gris, que
 * es contexto. Las cifras exactas no van sobre las barras —saturarían el
 * dibujo—: van en el globo al pasar el puntero y en la tabla de al lado, que es
 * la versión legible por lector de pantalla.
 */
export function PlanContraReal({ etapas, hoy, viva }: { etapas: FilaPlan[]; hoy: string; viva: boolean }) {
  const rango = rangoDelGrafico(etapas, hoy, viva)
  if (!rango) {
    return (
      <p className="text-sm text-texto-suave">
        Las etapas todavía no tienen fechas. Administración las programa en la pestaña Etapas.
      </p>
    )
  }
  const marcaHoy = viva && hoy >= rango.desde && hoy <= rango.hasta ? rango.marca(hoy) : null

  return (
    <figure aria-label="Plan contra real de las etapas. El detalle está en la tabla de etapas.">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-texto-suave">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-5 rounded-[4px] bg-borde-fuerte/50" /> Programado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-5 rounded-[4px] bg-acento" /> Real
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-5 rounded-[4px] bg-acento/45" /> En curso, hasta hoy
        </span>
        {marcaHoy !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px bg-texto-suave" /> Hoy
          </span>
        )}
      </figcaption>

      {/* La marca de hoy, rotulada arriba de las barras: una raya sin nombre
          no se distinguía del borde de una barra. */}
      {marcaHoy !== null && (
        <div aria-hidden className="grid grid-cols-1 sm:grid-cols-[minmax(10rem,15rem)_1fr] sm:gap-3">
          <span className="hidden sm:block" />
          <div className="relative h-4">
            <span
              className="absolute -translate-x-1/2 rounded-full bg-superficie-2 px-1.5 text-[10px] font-medium text-texto-suave"
              style={{ left: `${marcaHoy}%` }}
            >
              Hoy
            </span>
          </div>
        </div>
      )}

      <div aria-hidden className="space-y-2">
        {etapas.map((e) => {
          const plan = e.inicio_programado && e.fin_programado ? rango.tramo(e.inicio_programado, e.fin_programado) : null
          const ini = diaDeLima(e.inicio_real)
          const fin = diaDeLima(e.fin_real)
          const hasta = fin ?? (ini && viva ? hoy : null)
          const real = ini && hasta && hasta >= ini ? rango.tramo(ini, hasta) : null
          const retraso = fin && e.fin_programado ? diasEntre(e.fin_programado, fin) : null
          const globo = [
            plan ? `Programado: ${fecha(e.inicio_programado)} → ${fecha(e.fin_programado)}` : 'Sin programar',
            ini ? `Real: ${fecha(ini)} → ${fin ? fecha(fin) : 'en curso'}` : 'Sin empezar',
            retraso !== null && retraso > 0 ? `${dias(retraso)} tarde` : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <div key={e.id} title={globo} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(10rem,15rem)_1fr] sm:items-center sm:gap-3">
              {/* El área va debajo del nombre: en la misma línea se cortaba
                  («Habilitado de casco y mamparos · Ma…»). */}
              <p className="min-w-0 text-sm leading-tight text-texto">
                <span className="line-clamp-2">{e.nombre}</span>
                {e.area && <span className="block text-xs text-texto-tenue">{e.area}</span>}
              </p>
              <div className="relative h-9 rounded-[4px] bg-superficie-2">
                {marcaHoy !== null && (
                  <span className="absolute inset-y-0 w-px bg-texto-suave" style={{ left: `${marcaHoy}%` }} />
                )}
                {plan && (
                  <span
                    className="absolute top-1.5 h-2.5 rounded-[4px] bg-borde-fuerte/50"
                    style={{ left: `${plan.izquierda}%`, width: `${plan.ancho}%` }}
                  />
                )}
                {real && (
                  <span
                    className={fin ? 'absolute bottom-1.5 h-2.5 rounded-[4px] bg-acento' : 'absolute bottom-1.5 h-2.5 rounded-[4px] bg-acento/45'}
                    style={{ left: `${real.izquierda}%`, width: `${real.ancho}%` }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div aria-hidden className="mt-2 grid grid-cols-1 sm:grid-cols-[minmax(10rem,15rem)_1fr] sm:gap-3">
        <span className="hidden sm:block" />
        <div className="tabular flex justify-between text-[11px] text-texto-tenue">
          <span>{fecha(rango.desde)}</span>
          <span>{fecha(rango.hasta)}</span>
        </div>
      </div>
    </figure>
  )
}
