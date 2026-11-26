import Link from 'next/link'
import { Check, Circle, Route } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import type { DocumentoDelCodigo, ResumenCodigo } from '@/lib/datos/codigos-internos'
import type { FacturadoDelCodigo } from '@/lib/datos/facturacion'
import { ESTADO_DOCUMENTO_CODIGO, costoDelCodigo, enlaceCodigo } from '@/lib/dominio/codigos-internos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { fecha, moneda, porcentaje, type CodigoMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Hecho, en curso o todavía no: el mismo lenguaje del recorrido de cada documento. */
type Situacion = 'HECHO' | 'AHORA' | 'FALTA'

type Paso = {
  clave: 'cotizacion' | 'orden' | 'costo' | 'facturado' | 'cobrado'
  titulo: string
  situacion: Situacion
  /** La cifra o el documento, en una línea. */
  valor: string
  /** Lo que la acompaña: estado, fecha, cuánto falta. */
  pie?: string | null
  tono?: 'exito' | 'aviso' | 'peligro' | 'neutro'
  enlace?: { href: string; texto: string } | null
}

const montos = (r: Record<CodigoMoneda, number>) =>
  (['PEN', 'USD'] as const)
    .filter((m) => r[m] > 0)
    .map((m) => moneda(r[m], m))
    .join(' + ') || moneda(0)

const ENTREGADA = new Set(['ENTREGADA', 'FACTURADA'])

/**
 * El código de la cotización al cobro, en una fila (plan 12, entrega 12.3): la
 * cotización, la OT, el costo contra el presupuesto, lo facturado y lo cobrado,
 * cada paso con su estado y su enlace a donde se ve entero. No calcula nada: las
 * cifras son las del resumen y el costeo del código (`codigos_internos_costo`),
 * lo facturado de `facturadoDelCodigo` y los documentos de
 * `codigo_interno_documentos`, los mismos que la sección «RQ, OT y cotización».
 *
 * Cada paso sale solo con su permiso: el presupuesto con el precio de venta
 * (`venta` llega en nulo sin él), lo facturado y cobrado con quien lo lee, y el
 * enlace a la OT y a la cotización con quien las abre.
 */
export function RecorridoDelCodigo({
  codigo,
  c,
  documentos,
  facturado,
  abreOrden,
  abreCotizacion,
}: {
  codigo: string
  c: ResumenCodigo
  /** `null`: no se pudieron leer; el paso lo dice en vez de decir «sin OT». */
  documentos: DocumentoDelCodigo[] | null
  facturado: FacturadoDelCodigo | null
  abreOrden: boolean
  abreCotizacion: boolean
}) {
  const pasos: Paso[] = []

  // 1. La cotización: la aprobada manda; si no hay, la que esté en camino.
  const cotizaciones = (documentos ?? []).filter((d) => d.tipo === 'COTIZACION' && d.estado !== 'ANULADA')
  const cotizacion = cotizaciones.find((d) => d.estado === 'APROBADA') ?? cotizaciones[0]
  if (documentos === null) {
    pasos.push({ clave: 'cotizacion', titulo: 'Cotización', situacion: 'FALTA', valor: 'No se pudo leer', tono: 'aviso' })
  } else if (!cotizacion) {
    pasos.push({ clave: 'cotizacion', titulo: 'Cotización', situacion: 'FALTA', valor: 'Sin cotización', pie: 'Sale cuando la unidad del código tiene su OT de cotización' })
  } else {
    const e = definir(ESTADO_DOCUMENTO_CODIGO, cotizacion.estado)
    pasos.push({
      clave: 'cotizacion',
      titulo: 'Cotización',
      situacion: cotizacion.estado === 'APROBADA' ? 'HECHO' : 'AHORA',
      valor: cotizacion.numero,
      pie: [e.etiqueta, cotizacion.fecha && `del ${fecha(cotizacion.fecha)}`, cotizaciones.length > 1 && `y ${cotizaciones.length - 1} más`].filter(Boolean).join(' · '),
      tono: e.tono === 'peligro' ? 'peligro' : undefined,
      enlace: abreCotizacion ? { href: `/cotizaciones/pdf?${new URLSearchParams({ q: cotizacion.numero })}`, texto: 'Ver la cotización' } : null,
    })
  }

  // 2. La OT: su estado, y el expediente, que dice el plan contra lo real.
  const ordenes = (documentos ?? []).filter((d) => d.tipo === 'OT' && d.estado !== 'ANULADA')
  const orden = ordenes[0]
  if (documentos === null) {
    pasos.push({ clave: 'orden', titulo: 'Orden de trabajo', situacion: 'FALTA', valor: 'No se pudo leer', tono: 'aviso' })
  } else if (!orden) {
    pasos.push({ clave: 'orden', titulo: 'Orden de trabajo', situacion: 'FALTA', valor: 'Sin OT', pie: 'Sale cuando una unidad con este código tiene su OT' })
  } else {
    const e = definir(ESTADO_OT, orden.estado)
    pasos.push({
      clave: 'orden',
      titulo: 'Orden de trabajo',
      situacion: ENTREGADA.has(orden.estado) || c.entregada_el ? 'HECHO' : 'AHORA',
      valor: `OT ${orden.numero}`,
      pie: [e.etiqueta, c.entregada_el && `entregada el ${fecha(c.entregada_el)}`, ordenes.length > 1 && `y ${ordenes.length - 1} más`].filter(Boolean).join(' · '),
      enlace: abreOrden ? { href: `/ordenes/${orden.id}/expediente`, texto: 'Ver el expediente' } : null,
    })
  }

  // 3. El costo contra el presupuesto: las cifras del costeo, sin volver a calcularlas.
  const costo = costoDelCodigo(c)
  const presupuesto = c.venta?.presupuesto_pen ?? null
  const consumido = c.venta?.consumido_pct ?? null
  pasos.push({
    clave: 'costo',
    titulo: presupuesto !== null ? 'Costo contra presupuesto' : 'Costo',
    situacion: c.cierre ? 'HECHO' : costo.pen + costo.usd > 0 ? 'AHORA' : 'FALTA',
    valor: presupuesto !== null ? `${moneda(costo.pen)} de ${moneda(presupuesto)}` : `${moneda(costo.pen)}${costo.usd > 0 ? ` + ${moneda(costo.usd, 'USD')}` : ''}`,
    pie: [
      consumido !== null && `${porcentaje(consumido)} del presupuesto`,
      c.venta?.semaforo === 'EXCEDIDO' && 'se pasó',
      c.cierre ? `costeo cerrado el ${fecha(c.cierre.cerrado_en)}` : 'hasta hoy',
    ]
      .filter(Boolean)
      .join(' · '),
    tono: c.venta?.semaforo === 'EXCEDIDO' ? 'peligro' : c.venta?.semaforo === 'AJUSTADO' ? 'aviso' : undefined,
    enlace: { href: enlaceCodigo(codigo, 'costeo'), texto: 'Ver el costeo' },
  })

  // 4 y 5. Lo facturado y lo cobrado, para quien los lee.
  if (facturado) {
    const facturaYCobro = { href: enlaceCodigo(codigo, 'facturacion'), texto: 'Ver factura y cobro' }
    const sinFactura = facturado.facturas === 0
    const porCobrar = facturado.saldo.PEN + facturado.saldo.USD > 0
    pasos.push({
      clave: 'facturado',
      titulo: 'Facturado',
      situacion: sinFactura ? 'FALTA' : 'HECHO',
      valor: sinFactura ? 'Sin factura' : montos(facturado.total),
      pie: sinFactura ? 'La registra Contabilidad sobre la cotización aprobada' : `en ${facturado.facturas} ${facturado.facturas === 1 ? 'factura' : 'facturas'}`,
      enlace: facturaYCobro,
    })
    pasos.push({
      clave: 'cobrado',
      titulo: 'Cobrado',
      situacion: sinFactura ? 'FALTA' : porCobrar ? 'AHORA' : 'HECHO',
      valor: sinFactura ? '—' : montos(facturado.cobrado),
      pie: sinFactura ? null : porCobrar ? `por cobrar ${montos(facturado.saldo)}` : 'todo cobrado',
      // Un solo «Ver factura y cobro»: el de lo facturado lleva al mismo lugar.
    })
  }

  return (
    <section aria-labelledby="recorrido-del-codigo" className="rounded-[var(--radius-base)] border border-borde bg-superficie" data-recorrido-del-codigo>
      <h2 id="recorrido-del-codigo" className="flex items-center gap-1.5 border-b border-borde px-4 py-2 text-sm font-medium text-texto">
        <Route aria-hidden className="size-4 text-texto-suave" />
        De la cotización al cobro
      </h2>
      <ol className={cn('grid divide-y divide-borde md:divide-x md:divide-y-0', pasos.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-3')}>
        {pasos.map((p) => (
          <li key={p.clave} className="flex gap-2 px-4 py-3" data-paso={p.clave} data-situacion={p.situacion}>
            <Marca situacion={p.situacion} />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs text-texto-suave">{p.titulo}</p>
              <p className={cn('tabular text-sm font-medium break-words', p.situacion === 'FALTA' ? 'text-texto-suave' : 'text-texto')}>
                {p.tono ? <Insignia tono={p.tono}>{p.valor}</Insignia> : p.valor}
              </p>
              {p.pie && <p className="text-xs text-texto-suave">{p.pie}</p>}
              {p.enlace && (
                <Link href={p.enlace.href} className="inline-flex min-h-11 items-center text-xs font-medium text-acento hover:underline md:min-h-0">
                  {p.enlace.texto}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Marca({ situacion }: { situacion: Situacion }) {
  if (situacion === 'HECHO') {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-exito-suave text-exito">
        <Check aria-hidden className="size-3.5" />
        <span className="sr-only">Hecho:</span>
      </span>
    )
  }
  if (situacion === 'AHORA') {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-acento-suave text-acento">
        <Circle aria-hidden className="size-2.5 fill-current" />
        <span className="sr-only">En curso:</span>
      </span>
    )
  }
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-borde text-texto-suave">
      <span className="sr-only">Todavía no:</span>
    </span>
  )
}
