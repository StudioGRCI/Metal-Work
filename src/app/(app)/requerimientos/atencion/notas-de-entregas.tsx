import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { loAnotado, type NotaParaAlmacen } from '@/lib/datos/conformidad'
import { cantidad, fechaHora } from '@/lib/format'

import { ResponderNota } from './responder-nota'

/** Las que se ven sin abrir nada: las que más esperan. El resto va plegado, para no empujar la bandeja. */
const A_LA_VISTA = 3

/**
 * Las notas abiertas de las entregas, arriba de Atención (plan 2, entrega
 * 2.2): quien pidió el RQ dice que una salida no le llegó o le llegó
 * incompleta. Almacén responde qué hizo y la nota se cierra. La salida del
 * kardex no cambia. Sin notas abiertas, la tarjeta no se pinta.
 */
export function NotasDeLasEntregas({ notas }: { notas: NotaParaAlmacen[] }) {
  if (notas.length === 0) return null
  // Vienen de la más antigua a la más nueva: arriba, la que más espera.
  const vistas = notas.slice(0, A_LA_VISTA)
  const resto = notas.slice(A_LA_VISTA)
  const masVieja = notas[0]
  return (
    <Tarjeta className="mb-5 overflow-hidden" data-notas-de-entregas={notas.length}>
      <TarjetaCabecera
        titulo={`Notas de las entregas · ${notas.length} ${notas.length === 1 ? 'abierta' : 'abiertas'}`}
        descripcion={`La más antigua, del ${masVieja.requerimiento}, se anotó el ${fechaHora(masVieja.anotadoEn)}`}
        ayuda="Quien pidió el requerimiento dice que una salida no llegó o llegó incompleta. Responde qué hiciste: la nota se cierra y le llega el aviso. La salida del kardex no cambia con la nota; si hay que reponer, se registra otra salida contra el mismo requerimiento."
      />
      <ul className="divide-y divide-borde border-t border-borde">
        {vistas.map((n) => (
          <Nota key={n.id} nota={n} />
        ))}
      </ul>
      {resto.length > 0 && (
        <Pliegue titulo={`Ver ${resto.length === 1 ? 'la otra nota' : `las otras ${resto.length}`}`} className="border-t border-borde px-4" data-notas-plegadas={String(resto.length)}>
          <ul className="-mx-4 divide-y divide-borde border-t border-borde">
            {resto.map((n) => (
              <Nota key={n.id} nota={n} />
            ))}
          </ul>
        </Pliegue>
      )}
    </Tarjeta>
  )
}

function Nota({ nota: n }: { nota: NotaParaAlmacen }) {
  const anotado = loAnotado(n, cantidad)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-nota={n.id}>
      <div className="min-w-0 flex-1 basis-72 space-y-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/requerimientos?rq=${n.requerimientoId}`} className="tabular font-semibold text-acento hover:underline">
            {n.requerimiento}
          </Link>
          <Insignia tono={n.tipo === 'NO_LLEGO' ? 'peligro' : 'aviso'}>{anotado}</Insignia>
          <DiasEnEspera dias={n.dias} desde={n.anotadoEn} quien="Almacén" />
        </p>
        <p className="break-words text-texto-suave">
          {[n.area, n.codigoInterno].filter(Boolean).join(' · ')}
          {(n.area || n.codigoInterno) && ' · '}
          <span className="text-texto">
            <span className="tabular">Ítem {n.item}</span> · {n.material}
          </span>
        </p>
        <p className="text-xs text-texto-suave">
          Salió{' '}
          <span className="tabular">
            {cantidad(n.salio)}
            {n.unidad ? ` ${n.unidad}` : ''}
          </span>
          {n.numeroSalida && <span className="tabular"> · {n.numeroSalida}</span>} · {fechaHora(n.salioEn)}
          {n.recibio && <span className="break-words"> · recibió {n.recibio}</span>}
          {n.conFoto && (
            <>
              {' · '}
              <a
                href={`/requerimientos/salidas/${n.movimientoId}/foto`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center gap-1 px-1 font-medium text-acento hover:underline pointer-fine:min-h-0"
              >
                Ver foto
                <ExternalLink aria-hidden className="size-3.5" />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          )}
        </p>
        <p className="break-words text-texto">«{n.nota}»</p>
        <p className="text-xs text-texto-suave">
          {n.anotadoPor ?? 'Quien pidió'} · {fechaHora(n.anotadoEn)}
        </p>
      </div>
      {n.puedeAtender && <ResponderNota id={n.id} requerimiento={n.requerimiento} resumen={`${anotado}: ${n.material}, ítem ${n.item}. «${n.nota}»`} />}
    </li>
  )
}
