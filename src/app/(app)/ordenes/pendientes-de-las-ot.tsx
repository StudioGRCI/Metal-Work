import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import type { PendienteDeOt, PendientesDeLasOt as Pendientes } from '@/lib/datos/pendientes-de-las-ot'

/**
 * Las que se ven sin abrir nada; el resto, en un pliegue. Tres: en el teléfono
 * cada una ocupa unos 160 px y con seis la lista de OT empezaba a 1 136 px.
 */
const A_LA_VISTA = 3

/**
 * Lo que la oficina tiene por completar en las OT (plan 8, entrega 8.1): la
 * cotización aprobada que se quedó sin OT y la OT abierta sin código interno o
 * sin fecha de entrega comprometida. Lo más viejo primero, con sus días en
 * espera (los cuenta la base, por fecha de Lima) y el salto adonde se completa:
 * la tarjeta de la cotización («Dar código y cargar la OT») o la OT con «Editar
 * OT» ya abierta (`?editar=1`), que pide la fecha y el código. Si el código no
 * se puede poner desde la OT (sin unidad, o la unidad es también de otra OT),
 * la fila lo dice en vez de ofrecer un botón que no lo resuelve.
 *
 * `null` es que no se pudo leer: se dice, nunca se presenta como «nada pendiente».
 */
export function PendientesDeLasOt({ pendientes: leidos }: { pendientes: Pendientes | null }) {
  const pendientes = leidos?.filas ?? null
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
      <Tarjeta className="mb-4 p-4" data-pendientes-ot="0">
        <SinDatos
          compacto
          titulo="Nada por completar"
          descripcion="Toda cotización aprobada tiene su OT, y cada OT abierta, su código interno y su fecha de entrega."
        />
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

  // La base corta en 500: si hay más, se dice cuántas y que estas son las más antiguas.
  const total = leidos?.total ?? pendientes.length
  const cortada = total > pendientes.length
  const vista = pendientes.slice(0, A_LA_VISTA)
  const resto = pendientes.slice(A_LA_VISTA)

  return (
    <Tarjeta className="mb-4 overflow-hidden" data-pendientes-ot={pendientes.length}>
      <TarjetaCabecera
        titulo="Por completar"
        descripcion={
          cortada
            ? `${resumen.join(' · ')}, entre las ${pendientes.length} más antiguas de ${total}. Lo más antiguo primero.`
            : `${resumen.join(' · ')}. Lo más antiguo primero.`
        }
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

/** Por qué «Editar OT» no puede ponerle el código: el código va en la unidad. */
const CODIGO_BLOQUEADO = {
  SIN_UNIDAD: 'No tiene unidad registrada y el código interno va en la unidad: desde la OT no se puede poner. Avisa al administrador del sistema.',
  UNIDAD_COMPARTIDA: 'Su unidad está también en otra OT y sus datos no se cambian desde una sola: desde la OT no se puede poner el código. Avisa al administrador del sistema.',
} as const

function Fila({ p }: { p: PendienteDeOt }) {
  const esCotizacion = p.clase === 'COTIZACION'
  // Lo que «Editar OT» sí puede completar en esta OT.
  const codigoAqui = p.faltaCodigo && !p.codigoBloqueado
  const completa = esCotizacion || codigoAqui || p.faltaFecha
  // La cotización se completa en su tarjeta, buscada por su número; la OT, en su
  // detalle con «Editar OT» ya abierta.
  const destino = esCotizacion
    ? `/cotizaciones/pdf?q=${encodeURIComponent(p.numero)}#${p.documento}`
    : completa
      ? `/ordenes/${p.documento}?editar=1`
      : `/ordenes/${p.documento}`
  const accion = esCotizacion
    ? 'Cargar la OT'
    : codigoAqui && p.faltaFecha
      ? 'Completar'
      : codigoAqui
        ? 'Poner el código'
        : p.faltaFecha
          ? 'Poner la fecha'
          : 'Ver la OT'
  const documento = esCotizacion ? `Cotización ${p.numero}` : `OT ${p.numero}`
  const nota = p.otAnulada
    ? `Su OT ${p.otAnulada} se anuló. Cárgala otra vez solo si la venta sigue.`
    : p.codigoBloqueado
      ? CODIGO_BLOQUEADO[p.codigoBloqueado]
      : null
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      data-pendiente-ot={p.numero}
      data-clase={p.clase}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          {/* Un solo enlace por fila, el botón: el número es su rótulo. */}
          <span className="tabular font-semibold text-texto">{documento}</span>
          {p.faltaOt && <Insignia tono="aviso">Sin OT</Insignia>}
          {p.faltaCodigo && <Insignia tono="aviso">Sin código interno</Insignia>}
          {p.faltaFecha && <Insignia tono="aviso">Sin fecha de entrega</Insignia>}
        </p>
        <p className="text-xs break-words text-texto-suave">
          {/* La razón social va en mayúsculas, como en sus documentos. */}
          {p.cliente ? <span className="text-texto uppercase">{p.cliente}</span> : <span className="text-aviso">Sin cliente todavía</span>}
          {p.trabajo && <> · {p.trabajo}</>}
        </p>
        {nota && (
          <p className="text-xs text-pretty text-aviso" data-pendiente-ot-nota>
            {nota}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DiasEnEspera
          dias={p.dias}
          desde={p.desde}
          quien="Administración"
          className="whitespace-nowrap"
        />
        <EnlaceBoton
          href={destino}
          variante={completa ? 'contorno' : 'fantasma'}
          tamano="sm"
          aria-label={`${accion}: ${documento}`}
        >
          {accion}
        </EnlaceBoton>
      </div>
    </li>
  )
}
