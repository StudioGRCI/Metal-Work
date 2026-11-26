import Link from 'next/link'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import type { PendienteDeOt } from '@/lib/datos/pendientes-de-las-ot'

/** Las que se ven sin abrir nada; el resto, en un pliegue. */
const A_LA_VISTA = 6

/**
 * Lo que la oficina tiene por completar en las OT (plan 8, entrega 8.1): la
 * cotización aprobada que se quedó sin OT y la OT abierta sin código interno o
 * sin fecha de entrega comprometida. Lo más viejo primero, con sus días en
 * espera (los cuenta la base, por fecha de Lima) y el salto adonde se completa:
 * la tarjeta de la cotización («Dar código y cargar la OT») o la OT («Editar
 * OT», que pide la fecha y el código).
 *
 * `null` es que no se pudo leer: se dice, nunca se presenta como «nada pendiente».
 */
export function PendientesDeLasOt({ pendientes }: { pendientes: PendienteDeOt[] | null }) {
  if (pendientes === null) {
    return (
      <Tarjeta className="mb-4 border-aviso" data-pendientes-ot="sin-leer">
        <p role="status" className="p-4 text-sm text-texto">
          No se pudo leer lo que falta completar en las OT. Recarga la página; si continúa, avisa al administrador.
        </p>
      </Tarjeta>
    )
  }
  if (pendientes.length === 0) {
    return (
      <Tarjeta className="mb-4" data-pendientes-ot="0">
        <p className="p-4 text-sm text-texto-suave">
          <span className="font-medium text-texto">Nada por completar.</span> Toda cotización aprobada tiene su OT, y cada
          OT abierta, su código interno y su fecha de entrega.
        </p>
      </Tarjeta>
    )
  }

  const cotizaciones = pendientes.filter((p) => p.faltaOt).length
  const sinCodigo = pendientes.filter((p) => p.faltaCodigo).length
  const sinFecha = pendientes.filter((p) => p.faltaFecha).length
  const resumen = [
    cotizaciones > 0 && `${cotizaciones} ${cotizaciones === 1 ? 'cotización aprobada' : 'cotizaciones aprobadas'} sin OT`,
    sinCodigo > 0 && `${sinCodigo} OT sin código interno`,
    sinFecha > 0 && `${sinFecha} OT sin fecha de entrega`,
  ].filter(Boolean)

  const vista = pendientes.slice(0, A_LA_VISTA)
  const resto = pendientes.slice(A_LA_VISTA)

  return (
    <Tarjeta className="mb-4 overflow-hidden" data-pendientes-ot={pendientes.length}>
      <TarjetaCabecera
        titulo="Por completar"
        descripcion={`${resumen.join(' · ')}. Lo más antiguo primero.`}
        ayuda="Sin la OT, el código interno y la fecha de entrega comprometida, Diseño, el taller y el seguimiento de entregas no tienen con qué trabajar. La OT se puede cargar sin fecha y completarla después: queda aquí hasta que la tenga."
      />
      <ul className="divide-y divide-borde border-t border-borde">
        {vista.map((p) => (
          <Fila key={`${p.clase}-${p.documento}`} p={p} />
        ))}
      </ul>
      {resto.length > 0 && (
        <Pliegue
          titulo={`Ver ${resto.length === 1 ? 'el otro pendiente' : `los ${resto.length} pendientes más`}`}
          className="border-t border-borde px-4"
          data-pendientes-ot-resto={String(resto.length)}
        >
          <ul className="-mx-4 divide-y divide-borde border-t border-borde">
            {resto.map((p) => (
              <Fila key={`${p.clase}-${p.documento}`} p={p} />
            ))}
          </ul>
        </Pliegue>
      )}
    </Tarjeta>
  )
}

function Fila({ p }: { p: PendienteDeOt }) {
  const esCotizacion = p.clase === 'COTIZACION'
  // La cotización se completa en su tarjeta, buscada por su número; la OT, en su detalle.
  const destino = esCotizacion
    ? `/cotizaciones/pdf?q=${encodeURIComponent(p.numero)}#${p.documento}`
    : `/ordenes/${p.documento}`
  const accion = esCotizacion ? 'Cargar la OT' : p.faltaCodigo && p.faltaFecha ? 'Completar' : p.faltaCodigo ? 'Poner el código' : 'Poner la fecha'
  const documento = esCotizacion ? `Cotización ${p.numero}` : `OT ${p.numero}`
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      data-pendiente-ot={p.numero}
      data-clase={p.clase}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={destino} className="tabular font-semibold text-acento hover:underline">
            {documento}
          </Link>
          {p.faltaOt && <Insignia tono="aviso">Sin OT</Insignia>}
          {p.faltaCodigo && <Insignia tono="aviso">Sin código interno</Insignia>}
          {p.faltaFecha && <Insignia tono="aviso">Sin fecha de entrega</Insignia>}
        </p>
        <p className="text-xs break-words text-texto-suave">
          {/* La razón social va en mayúsculas, como en sus documentos. */}
          {p.cliente ? <span className="text-texto uppercase">{p.cliente}</span> : <span className="text-aviso">Sin cliente todavía</span>}
          {p.trabajo && <> · {p.trabajo}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DiasEnEspera
          dias={p.dias}
          desde={p.desde}
          quien="Administración"
          className="whitespace-nowrap"
        />
        <EnlaceBoton href={destino} variante="contorno" tamano="sm" aria-label={`${accion}: ${documento}`}>
          {accion}
        </EnlaceBoton>
      </div>
    </li>
  )
}
