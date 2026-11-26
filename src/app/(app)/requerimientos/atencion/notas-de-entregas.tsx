import Link from 'next/link'

import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { loAnotado, type NotaDeConformidad } from '@/lib/datos/conformidad'
import { cantidad, fechaHora } from '@/lib/format'

import { ResponderNota } from './responder-nota'

/**
 * Las notas abiertas de las entregas, arriba de Atención (plan 2, entrega
 * 2.2): quien pidió el RQ dice que una salida no le llegó o le llegó
 * incompleta. Almacén responde qué hizo y la nota se cierra. La salida del
 * kardex no cambia. Sin notas abiertas, la tarjeta no se pinta.
 */
export function NotasDeLasEntregas({ notas }: { notas: NotaDeConformidad[] }) {
  if (notas.length === 0) return null
  return (
    <Tarjeta className="mb-5 overflow-hidden" data-notas-de-entregas={notas.length}>
      <TarjetaCabecera
        titulo={`Notas de las entregas · ${notas.length} ${notas.length === 1 ? 'abierta' : 'abiertas'}`}
        descripcion="Quien pidió dice que una salida no llegó o llegó incompleta. Responde qué hiciste: la nota se cierra y le llega el aviso."
        ayuda="La salida del kardex no cambia con la nota. Si hay que reponer, se registra otra salida contra el mismo requerimiento."
      />
      <ul className="divide-y divide-borde border-t border-borde">
        {notas.map((n) => {
          const anotado = loAnotado(n, cantidad)
          return (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-nota={n.id}>
              <div className="min-w-0 flex-1 basis-72 space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/requerimientos?rq=${n.requerimientoId}`} className="tabular font-semibold text-acento hover:underline">
                    {n.requerimiento}
                  </Link>
                  <Insignia tono={n.tipo === 'NO_LLEGO' ? 'peligro' : 'aviso'}>{anotado}</Insignia>
                  <DiasEnEspera dias={n.dias} desde={n.anotadoEn} quien="Almacén" />
                </p>
                <p className="break-words text-texto">
                  <span className="tabular">Ítem {n.item}</span> · {n.material}
                </p>
                <p className="text-xs text-texto-suave">
                  Salió{' '}
                  <span className="tabular">
                    {cantidad(n.salio)}
                    {n.unidad ? ` ${n.unidad}` : ''}
                  </span>
                  {n.numeroSalida && <span className="tabular"> · {n.numeroSalida}</span>} · {fechaHora(n.salioEn)}
                </p>
                <p className="break-words text-texto">«{n.nota}»</p>
                <p className="text-xs text-texto-suave">
                  {n.anotadoPor ?? 'Quien pidió'} · {fechaHora(n.anotadoEn)}
                </p>
              </div>
              {n.puedeAtender && (
                <ResponderNota
                  id={n.id}
                  titulo={`Responder la nota del ${n.requerimiento}`}
                  resumen={`${anotado}: ${n.material}, ítem ${n.item}. «${n.nota}»`}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Tarjeta>
  )
}
